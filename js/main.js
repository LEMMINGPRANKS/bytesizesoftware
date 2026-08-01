// Entry: wire renderer → world → player → mining/placing → crafting → HUD.
import * as THREE from "three";
import { CONFIG } from "./config.js";
import { createRenderer } from "./engine/renderer.js";
import { Loop } from "./engine/loop.js";
import { Input } from "./engine/input.js";
import { DayNight } from "./engine/daynight.js";
import { World } from "./world/world.js";
import { Player } from "./entities/player.js";
import { MoonGolem } from "./entities/moongolem.js";
import { MiningController, raycastVoxel } from "./gameplay/mining.js";
import { Inventory } from "./gameplay/inventory.js";
import { HUD } from "./ui/hud.js";
import { RECIPES } from "./gameplay/recipes.js";
import { canCraft, craft } from "./gameplay/crafting.js";
import { MobSystem } from "./gameplay/mobs.js";
import { B, BLOCKS, isSolid, isLiquid } from "./world/blocks.js";
import { atlasUV, getTexture } from "./world/textures.js";
import {
  listSlots, loadSlot, saveSlot, deleteSlot, MAX_SLOTS,
  exportSlot, importToSlot, exportFilename,
  loadMpSave, saveMpSave,
} from "./save/saveManager.js";
import { getSettings, saveSettings, applySettings, DEFAULTS } from "./save/settings.js";
const { connect, hostRoom, joinRoom, leaveRoom, callbacks, isConnected, isInRoom, sendBlockEdit, sendPlayerState, sendChat, sendWorldDump, actorName, getLocalActorNr, getLocalName } = window;

const $ = (s) => document.querySelector(s);

// Unlock the AudioContext on the very first user gesture anywhere in the
// document — browsers refuse to start audio without one, and the play
// button itself is sometimes too late if the user fiddles with settings.
window.addEventListener("pointerdown", () => resume(), { once: true });
window.addEventListener("keydown", () => resume(), { once: true });

function setStatus(msg) {
  const el = document.getElementById("boot-status");
  if (el) el.textContent = msg;
}

async function main() {
  try {
    setStatus("Loading Three.js…");
    const root = $("#game-root");
    const canvas = document.createElement("canvas");
    root.appendChild(canvas);

  const { renderer, scene, camera, sun, ambient, hemi, worldLayer } = createRenderer(canvas);
  const dayNight = new DayNight(scene, camera, sun, ambient, hemi);

  // Torch light pool. Each torch in the world is eligible to drive one of
  // these PointLights; we reassign them to the nearest N torches each tick.
  // Three.js runs every light through every chunk's fragment shader as long
  // as the light is `visible` — so we toggle `visible=false` on unused slots
  // to actually remove them from the shader. Keeping the pool small matters
  // most in caves where many torches cluster and chunk face counts are high.
  const TORCH_LIGHT_COUNT = 3;
  const TORCH_LIGHT_RANGE = 10;
  const TORCH_LIGHT_INTENSITY = 2.2;
  const torchLights = [];
  for (let i = 0; i < TORCH_LIGHT_COUNT; i++) {
    const l = new THREE.PointLight("#ffb060", 0, TORCH_LIGHT_RANGE, 2.0);
    l.visible = false;
    worldLayer.add(l);
    torchLights.push(l);
  }
  let torchLightAcc = 0;
  function updateTorchLights(playerPos) {
    const candidates = [];
    for (const key of world.torches) {
      const parts = key.split(",");
      const tx = +parts[0], ty = +parts[1], tz = +parts[2];
      const dx = tx + 0.5 - playerPos.x;
      const dy = ty + 0.4 - playerPos.y;
      const dz = tz + 0.5 - playerPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > TORCH_LIGHT_RANGE * TORCH_LIGHT_RANGE * 1.5) continue;
      candidates.push({ x: tx + 0.5, y: ty + 0.45, z: tz + 0.5, d2 });
    }
    candidates.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < TORCH_LIGHT_COUNT; i++) {
      const tl = torchLights[i];
      const c = candidates[i];
      if (c) {
        tl.position.set(c.x, c.y, c.z);
        tl.intensity = TORCH_LIGHT_INTENSITY;
        tl.visible = true;
      } else {
        // visible=false removes the light from the shader uniform list
        // entirely, so distant/empty areas don't pay for unused lights.
        tl.visible = false;
      }
    }
  }
  // World/player/etc. are created when a slot is chosen — seed depends on slot.
  let world, player, input, mining, mobs, inv, hud;
  let hunger = 20;
  let lastHungerTick = performance.now();
  let attackCooldown = 0;
  let creativeMode = false;
  let activeSlot = null;
  // Dimension state — overworldReturn is set when leaving for the moon so we
  // can pop back to the same spot. bossGolem holds the active Moon Rock
  // Golem instance so we can show its HP bar and clean it up on return.
  let overworldReturn = null;
  let bossGolem = null;
  let gameWon = false;
  // Floating origin: snaps to a grid so the player stays within ~8 blocks of
  // scene-space (0,0,0). Set every frame after player.update(). Only X/Z — Y
  // is bounded 0..chunkHeight so doesn't need rebasing.
  const floatingOrigin = new THREE.Vector3(0, 0, 0);
  let mpActiveSlot = null; // set when world was launched via Host/Join
  let mpIsHost = false;    // only host streams world dumps to newcomers
  let lastAutoSave = performance.now();
  let lavaAcc = 0;
  let portalAcc = 0;
  let inPortal = false;
  // Remote player avatars: actorNr -> { group, body, head, label, target: Vector3 }
  const remoteAvatars = new Map();
  let mpStateAcc = 0; // accumulates dt for 15Hz position broadcast
  // SFX cadence state — kept module-scoped so they survive HUD redraws.
  let footstepAcc = 0;       // horizontal distance walked since last footstep
  let miningTapAcc = 0;      // seconds of active mining since last tap sound
  let prevOnGround = true;   // for landing detection
  let prevPos = new THREE.Vector3();

  function applyMode(mode) {
    if (mode === "creative") {
      creativeMode = true;
      player.fly = true;
      const palette = [
        B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.PLANKS, B.BRICK, B.GLASS, B.TORCH, B.WOOD,
        B.PLATINUM_BLOCK, B.LAVA, B.WATER, B.LEAVES, B.SAND, B.GOLD_BLOCK, B.IRON_BLOCK,
      ];
      for (let i = 0; i < palette.length && i < 9; i++) {
        inv.hotbar[i] = palette[i];
        inv.items[palette[i]] = Infinity;
      }
      hunger = 20;
      hud.setHunger(hunger);
      hud.refresh();
    }
  }

  function snapshot() {
    return {
      version: 1,
      name: (mpActiveSlot?.name) || activeSlot?.name || "World",
      mode: creativeMode ? "creative" : "survival",
      seed: world.seed,
      player: {
        x: player.pos.x, y: player.pos.y, z: player.pos.z,
        yaw: player.yaw, pitch: player.pitch,
        fly: player.fly,
      },
      inventory: {
        items: Object.fromEntries(
          Object.entries(inv.items).map(([k, v]) => [k, v === Infinity ? null : v])
        ),
        hotbar: inv.hotbar,
        main: inv.main,
        active: inv.active,
      },
      hunger,
      modified: Object.fromEntries(world.modified),
      chests: Object.fromEntries(world.chests),
      doors: Array.from(world.doors),
      traders: Object.fromEntries(world.traders),
    };
  }

  function doSave() {
    if (mpActiveSlot) {
      saveMpSave(mpActiveSlot.name.replace("MP ", ""), snapshot());
      return;
    }
    if (activeSlot == null) return;
    saveSlot(activeSlot.slot, snapshot());
  }

  // ---- Block-event handlers (defined once; bound after world exists) ----
  // Map block ids to one of the sfx material strings so a single helper
  // covers both break + mining-tap sounds. Defaults to "stone" for anything
  // hard (ores, brick, etc.) — the caller doesn't have to special-case.
  function materialOf(id) {
    const d = BLOCKS[id];
    if (!d) return "stone";
    if (d.liquid) return "dirt";
    if (id === B.WOOD || id === B.PLANKS) return "wood";
    if (id === B.LEAVES) return "leaves";
    if (id === B.CACTUS) return "wood";
    if (id === B.SAND || id === B.SNOW) return "sand";
    if (id === B.DIRT || id === B.GRASS) return "dirt";
    if (id === B.ICE || id === B.GLASS) return "glass";
    if (id === B.IRON_BLOCK || id === B.GOLD_BLOCK || id === B.DOOR) return "metal";
    return "stone";
  }
  // MP-aware block setter: writes locally AND broadcasts to the room. Use this
  // everywhere the local player edits the world so guests/host converge.
  function mpSetBlock(x, y, z, id) {
    world.setBlock(x, y, z, id);
    if (isInRoom()) sendBlockEdit(x, y, z, id);
  }

  // Dimension travel: called when the player stands in a PORTAL block.
  // Overworld → moon saves return position + spawns the boss once. Moon →
  // overworld restores return position and despawns the golem. Physics
  // (gravity, jump) scales down on the moon so jumps feel low-g.
  function travelDimension() {
    const goingToMoon = world.dimension === "overworld";
    if (goingToMoon) {
      overworldReturn = { x: player.pos.x, y: player.pos.y, z: player.pos.z,
                          yaw: player.yaw, pitch: player.pitch };
      CONFIG.player.gravity = 6;   // ~1/4 Earth — bouncy low-g
      CONFIG.player.jump = 7;
      world.switchDimension("moon");
      world.ensureChunk(0, 0);
      const h = world.surfaceHeight(8, 8);
      player.pos.set(8.5, h + 2, 8.5);
      player.vel.set(0, 0, 0);
      pushChat("MOON", "You step through the portal. Low gravity. Beware the Golem.");
      if (typeof window.humm === "function") window.humm();
      if (!bossGolem && !gameWon) {
        world.ensureChunk(1, 0);
        const bx = 20, bz = 8;
        const bh = world.surfaceHeight(bx, bz);
        bossGolem = new MoonGolem(
          new THREE.Vector3(bx + 0.5, bh + 1, bz + 0.5),
          worldLayer, world,
        );
      }
    } else {
      CONFIG.player.gravity = 24;
      CONFIG.player.jump = 8;
      world.switchDimension("overworld");
      const r = overworldReturn || { x: 8.5, y: 50, z: 8.5 };
      player.pos.set(r.x, r.y, r.z);
      player.vel.set(0, 0, 0);
      if (r.yaw !== undefined) { player.yaw = r.yaw; player.pitch = r.pitch; }
      overworldReturn = null;
      pushChat("MOON", "You return to Earth.");
      if (bossGolem) { bossGolem.remove(); bossGolem = null; }
    }
    player.fly = creativeMode;
    inPortal = true;
  }
  function mpApplyRemoteBlock(edit) {
    if (!world) return;
    world.setBlock(edit.x, edit.y, edit.z, edit.id);
  }
  // Spawn / despawn capsule avatars for remote players.
  function makeNameSprite(text) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#fff";
    g.font = "bold 28px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, c.width / 2, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(1.2, 0.3, 1);
    sp.position.set(0, 2.2, 0);
    return sp;
  }
  function spawnRemoteAvatar(actorNr, name) {
    if (remoteAvatars.has(actorNr)) return;
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x55aaff });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 8), bodyMat);
    body.position.y = 0.9;
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffcc88 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), headMat);
    head.position.y = 1.75;
    // Look dir cone so we can see which way the remote player is facing.
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.2, 6),
      new THREE.MeshLambertMaterial({ color: 0x222222 }),
    );
    nose.position.set(0, 1.75, -0.35);
    group.add(body, head, nose, makeNameSprite(name || "Player"));
    worldLayer.add(group);
    remoteAvatars.set(actorNr, {
      group, body, head,
      target: new THREE.Vector3(0, 0, 0),
      yaw: 0,
      active: false,
    });
  }
  function despawnRemoteAvatar(actorNr) {
    const a = remoteAvatars.get(actorNr);
    if (!a) return;
    worldLayer.remove(a.group);
    a.body.geometry.dispose(); a.head.geometry.dispose();
    remoteAvatars.delete(actorNr);
  }
  function clearAllRemoteAvatars() {
    for (const id of Array.from(remoteAvatars.keys())) despawnRemoteAvatar(id);
  }
  function applyRemotePlayerState(actorNr, st) {
    let a = remoteAvatars.get(actorNr);
    // We may receive a state packet before the join callback fires — spawn a
    // placeholder so the position isn't lost.
    if (!a) {
      spawnRemoteAvatar(actorNr, "Player");
      a = remoteAvatars.get(actorNr);
    }
    a.target.set(st.x, st.y, st.z);
    a.yaw = st.yaw || 0;
    a.active = true;
  }
  function updateRemoteAvatars(dt) {
    // Lerp avatars toward their target for smooth motion even at low send rates.
    const k = 1 - Math.pow(0.001, dt);
    for (const a of remoteAvatars.values()) {
      a.group.position.lerp(a.target, k);
      a.group.rotation.y = a.yaw;
    }
  }
  function onBreak(kind, id, x, y, z, drop = true) {
    mpSetBlock(x, y, z, B.AIR);
    blockBreak(materialOf(id));
    if (drop) inv.add(id, 1);
    // Single wood block: 50% chance to also drop a twig.
    if (drop && id === B.WOOD && Math.random() < 0.5) inv.add(B.TWIG, 1);
    // If we just broke a chest, dump its contents into the player inventory.
    if (id === B.CHEST) {
      const slots = world.chests.get(World.modKey(x, y, z));
      if (slots) {
        for (const sid of slots) if (sid != null) inv.add(sid, 1);
        world.removeChest(x, y, z);
      }
    }
    // Breaking either half of a door drops one door item and clears the other.
    if (id === B.DOOR) {
      if (world.getBlock(x, y + 1, z) === B.DOOR_TOP) mpSetBlock(x, y + 1, z, B.AIR);
      world.doors.delete(`${x},${y},${z}`);
    } else if (id === B.DOOR_TOP) {
      if (world.getBlock(x, y - 1, z) === B.DOOR) {
        mpSetBlock(x, y - 1, z, B.AIR);
        world.doors.delete(`${x},${y - 1},${z}`);
      }
      // The top half isn't a placeable item — drop a regular door instead.
      if (drop) { inv.remove(B.DOOR_TOP, 1); inv.add(B.DOOR, 1); }
    }
    // Mining a trader drops the trader block only — its offer list is a
    // service, not physical inventory, so there's nothing else to spill.
    if (id === B.TRADER) {
      world.removeTrader(x, y, z);
    }
    hud.refresh();
    return true;
  }

  function placeBlock() {
    const t = mining.acquire(player);
    if (t) {
      const hitId = world.getBlock(t.x, t.y, t.z);
      const hitDef = BLOCKS[hitId];
      // Right-clicking an interactive block always uses it, even with a tool
      // or food selected — otherwise you couldn't open chests while holding
      // a pickaxe.
      if (hitDef?.interactive) {
        if (hitId === B.CHEST) { openChest(t.x, t.y, t.z); return; }
        if (hitId === B.DOOR)  { toggleDoorAt(t.x, t.y, t.z); return; }
        if (hitId === B.TRADER) { openTrader(t.x, t.y, t.z); return; }
      }
    }
    const sel = inv.selected();
    if (sel === null) return;
    const def = BLOCKS[sel];
    if (def?.food) { eat(sel); return; }
    if (def?.bucket) { useBucket(sel, t); return; }
    if (def?.item) return; // don't place tools/items in the world
    if (!t) return;
    // Raycast returns face=null when the player's eye starts inside a solid
    // block (e.g. mid-jump inside a door). Without a face we don't know which
    // neighbour to place into, so just bail.
    if (!t.face) return;
    const px = t.x + t.face[0], py = t.y + t.face[1], pz = t.z + t.face[2];
    if (py < 0 || py >= CONFIG.world.chunkHeight) return;
    const minX = player.pos.x - player.half, maxX = player.pos.x + player.half;
    const minY = player.pos.y, maxY = player.pos.y + player.height;
    const minZ = player.pos.z - player.half, maxZ = player.pos.z + player.half;
    // Doors are 2 cells tall — extend the AABB overlap check upward.
    const cellTop = (sel === B.DOOR) ? py + 2 : py + 1;
    if (px + 1 > minX && px < maxX && cellTop > minY && py < maxY && pz + 1 > minZ && pz < maxZ) return;
    if (world.getBlock(px, py, pz) !== B.AIR) return;
    // Doors occupy 2 vertical cells — bail if the head cell is blocked.
    if (sel === B.DOOR) {
      if (py + 1 >= CONFIG.world.chunkHeight) return;
      if (world.getBlock(px, py + 1, pz) !== B.AIR) return;
    }
    mpSetBlock(px, py, pz, sel);
    if (sel === B.DOOR) mpSetBlock(px, py + 1, pz, B.DOOR_TOP);
    inv.remove(sel, 1);
    place();
    hud.refresh();
  }

  // Pick block (middle-click): grab whatever block the player is aiming at
  // into the selected hotbar slot. Creative gives infinite; survival only
  // works if the block is already in the inventory (just selects it).
  function pickBlock() {
    const t = mining.acquire(player);
    if (!t) return;
    const id = world.getBlock(t.x, t.y, t.z);
    if (id === B.AIR) return;
    const def = BLOCKS[id];
    if (!def) return;
    // Don't pick bedrock, portal blocks, or non-item blocks you shouldn't
    // be able to place (e.g. torches are fine, doors are fine).
    if (id === B.BEDROCK || def.portal) return;
    if (creativeMode) {
      const slot = inv.active ?? 0;
      inv.hotbar[slot] = id;
      inv.items[id] = Infinity;
    } else {
      // Survival: only select if already owned. Otherwise no-op.
      if (!inv.has(id)) return;
      const existing = inv.hotbar.indexOf(id);
      if (existing >= 0) inv.active = existing;
    }
    hud.refresh();
  }

  // Bucket use: empty picks up the clicked water/lava source block; full
  // places a source block at the targeted empty cell and empties the bucket.
  // The swap is `inv.remove` + `inv.add` so the bucket slot moves around as
  // expected (matching Minecraft behaviour).
  function useBucket(sel, t) {
    const def = BLOCKS[sel];
    if (def.empty) {
      if (!t) return;
      const target = world.getBlock(t.x, t.y, t.z);
      if (target !== B.WATER && target !== B.LAVA) return;
      // Only pick up source blocks (those without a liquid level entry).
      if (world.liquidLevels.has(World.modKey(t.x, t.y, t.z))) return;
      mpSetBlock(t.x, t.y, t.z, B.AIR);
      inv.remove(sel, 1);
      inv.add(target === B.WATER ? B.WATER_BUCKET : B.LAVA_BUCKET, 1);
      place();
      hud.refresh();
    } else {
      // Place contents: target the empty neighbour cell, same as placing a
      // normal block. Bail if there's no face (eye in solid block).
      if (!t || !t.face) return;
      const px = t.x + t.face[0], py = t.y + t.face[1], pz = t.z + t.face[2];
      if (py < 0 || py >= CONFIG.world.chunkHeight) return;
      if (world.getBlock(px, py, pz) !== B.AIR) return;
      const placed = def.contains === "WATER" ? B.WATER : B.LAVA;
      mpSetBlock(px, py, pz, placed);
      inv.remove(sel, 1);
      inv.add(B.BUCKET, 1);
      place();
      hud.refresh();
    }
  }
  function toggleDoorAt(x, y, z) {
    // `y` may be either half of the door — find the bottom.
    let by = y;
    if (world.getBlock(x, y, z) === B.DOOR_TOP) by = y - 1;
    if (world.getBlock(x, by, z) !== B.DOOR) return;
    const wasOpen = world.isDoorOpen(x, by, z);
    world.toggleDoor(x, by, z);
    door(!wasOpen);
    // Re-mesh the chunk(s) that contain the door so the panel swings.
    const cx = Math.floor(x / CONFIG.world.chunkSize), cz = Math.floor(z / CONFIG.world.chunkSize);
    const c = world.getChunk(cx, cz);
    if (c) c.dirty = true;
  }

  function eat(id) {
    const def = BLOCKS[id];
    if (!def?.food) return;
    if (hunger >= 20) return;
    if (!inv.remove(id, 1)) return;
    hunger = Math.min(20, hunger + def.food);
    // SFX live on window.eat (shadowed by this local function name).
    if (typeof window.eat === "function") window.eat();
    hud.setHunger(hunger);
    hud.refresh();
  }

  function nearFireplace() {
    const px = Math.floor(player.pos.x), py = Math.floor(player.pos.y + 1), pz = Math.floor(player.pos.z);
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++)
        for (let dz = -2; dz <= 2; dz++)
          if (world.getBlock(px + dx, py + dy, pz + dz) === B.FIREPLACE) return true;
    return false;
  }

  function attack() {
    if (attackCooldown > 0) return;
    attackCooldown = 0.4;
    const origin = player.eyePos();
    const dir = player.lookDir();
    // Boss first: if you're pointing at the golem, hits land there even if
    // a cow is technically in the same arc — boss fights take priority.
    if (bossGolem && bossGolem.alive) {
      const bc = bossGolem.pos.clone(); bc.y += bossGolem.height / 2;
      const toC = bc.clone().sub(origin);
      const proj = toC.dot(dir);
      if (proj > 0 && proj < CONFIG.mining.range + 2) {
        const closestPt = origin.clone().add(dir.clone().multiplyScalar(proj));
        if (closestPt.distanceTo(bc) < 1.4) {
          const wasAlive = bossGolem.alive;
          const carried = getCarried();
          // Tool-tier damage: pickaxes hurt more; platinum pickaxe hurts most.
          let dmg = 4;
          const carriedDef = carried !== null ? BLOCKS[carried] : null;
          if (carriedDef?.toolTier) dmg = 4 + carriedDef.toolTier * 2;
          bossGolem.hit(dmg, player.pos);
          if (wasAlive && !bossGolem.alive) {
            // Trophy drop + victory flag.
            inv.add(B.PLATINUM_TROPHY, 1);
            gameWon = true;
            pushChat("MOON", "The Moon Rock Golem crumbles. YOU HAVE BEATEN WILDCRAFT.");
            if (typeof window.humm === "function") window.humm();
          }
          if (typeof window.hurt === "function") window.hurt();
          return;
        }
      }
    }
    const cow = mobs.raycast(origin, dir, CONFIG.mining.range + 1);
    if (cow) {
      const wasAlive = cow.alive;
      cow.hit(cow.isFish ? 4 : 4, player.pos);
      if (wasAlive && !cow.alive) {
        if (cow.isFish) {
          inv.add(B.RAW_FISH, 1);
        } else {
          const drop = 2 + (Math.random() * 2 | 0);
          inv.add(B.RAW_BEEF, drop);
        }
        hud.refresh();
      }
    }
  }

  // ---- World list / start-screen wiring ----
  const startScreen = $("#start-screen");
  const craftPanel = $("#craft-panel");
  const invPanel = $("#inv-panel");
  const resumeOverlay = $("#resume-overlay");
  const worldList = $("#world-list");
  const newWorldForm = $("#new-world-form");
  let gameStarted = false;
  let craftOpen = false;
  let invOpen = false;
  let invCarried = null; // {id} when dragging a stack between slots
  let pendingNewSlot = null;

  // Floating ghost item that follows the cursor during drag-and-drop.
  const carriedGhost = $("#carried-ghost");
  function getCarried() {
    return invCarried || chestCarried;
  }
  function setCarried(c) {
    if (chestOpen) chestCarried = c;
    else invCarried = c;
  }
  function refreshGhost() {
    const c = getCarried();
    if (!c) { carriedGhost.style.display = "none"; return; }
    const tex = getTexture(c.id, "side");
    carriedGhost.style.backgroundImage = `url(${tex.image.toDataURL?.() || tex.image.src})`;
    carriedGhost.style.display = "block";
    carriedGhost.textContent = "";
  }
  document.addEventListener("mousemove", (e) => {
    if (carriedGhost.style.display === "block") {
      carriedGhost.style.transform = `translate(${e.clientX + 6}px, ${e.clientY + 6}px)`;
    }
  });
  let dragSource = null; // slot element where current drag started
  function bindSlotEvents(slot, pickFn, dropFn) {
    slot.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      pickFn();
      dragSource = slot;
      refreshGhost();
    });
    slot.addEventListener("mouseup", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      // Drop on the slot under the cursor. If that's the same slot we picked
      // up from, dropFn just puts the item back — a no-op drag.
      dropFn();
      dragSource = null;
      refreshGhost();
    });
  }

  // Pre-warm the texture atlas up front so it's ready when a world loads.
  for (const idStr of Object.keys(BLOCKS)) {
    const id = Number(idStr);
    if (id === B.AIR || id === B.WATER) continue;
    for (let f = 0; f < 6; f++) atlasUV(id, f);
  }

  function fmtTime(ts) {
    if (!ts) return "never";
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function renderWorldList() {
    worldList.innerHTML = "";
    const slots = listSlots();
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = slots[i];
      const row = document.createElement("div");
      row.className = "world-row";
      if (s) {
        row.innerHTML = `<div class="world-info">
            <div class="world-name">${escapeHtml(s.name)}</div>
            <div class="world-meta">${s.mode} · seed ${s.seed} · ${s.editCount} edits · ${fmtTime(s.timestamp)}</div>
          </div>`;
        const play = document.createElement("button");
        play.textContent = "Play";
        play.onclick = () => startGame(i);
        const exp = document.createElement("button");
        exp.textContent = "Export";
        exp.onclick = () => doExport(i);
        const del = document.createElement("button");
        del.textContent = "Delete";
        del.className = "danger";
        del.onclick = () => {
          if (confirm(`Delete "${s.name}"? This cannot be undone.`)) {
            deleteSlot(i);
            renderWorldList();
          }
        };
        const btns = document.createElement("div");
        btns.className = "world-btns";
        btns.append(play, exp, del);
        row.append(btns);
      } else {
        row.classList.add("empty");
        row.innerHTML = `<div class="world-info"><div class="world-name">Slot ${i + 1} — Empty</div></div>`;
        const create = document.createElement("button");
        create.textContent = "Create";
        create.onclick = () => openNewWorldForm(i);
        const imp = document.createElement("button");
        imp.textContent = "Import";
        imp.onclick = () => doImport(i);
        const btns = document.createElement("div");
        btns.className = "world-btns";
        btns.append(create, imp);
        row.append(btns);
      }
      worldList.append(row);
    }
  }

  // ---- Export / Import handlers ----
  function doExport(slot) {
    const text = exportSlot(slot);
    if (!text) return;
    const meta = listSlots()[slot];
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = exportFilename(meta?.name, slot);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function doImport(slot) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const res = importToSlot(slot, String(reader.result));
        if (res === true) {
          renderWorldList();
        } else {
          alert("Import failed: " + res);
        }
      };
      reader.readAsText(f);
    };
    inp.click();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function openNewWorldForm(slot) {
    pendingNewSlot = slot;
    newWorldForm.classList.remove("hidden");
    $("#new-world-name").value = "";
    $("#new-world-name").focus();
  }

  $("#new-world-cancel").addEventListener("click", () => {
    newWorldForm.classList.add("hidden");
    pendingNewSlot = null;
  });
  $("#new-world-create").addEventListener("click", () => {
    if (pendingNewSlot == null) return;
    const name = $("#new-world-name").value.trim() || `World ${pendingNewSlot + 1}`;
    const mode = document.querySelector('input[name="newmode"]:checked')?.value || "survival";
    const seed = (Math.random() * 1e9) | 0;
    activeSlot = { slot: pendingNewSlot, name, mode, seed };
    newWorldForm.classList.add("hidden");
    pendingNewSlot = null;
    bootWorld(mode, seed, null);
  });
  $("#new-world-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#new-world-create").click();
  });

  function bootWorld(mode, seed, saved) {
    setStatus("Generating world…");
    world = new World(worldLayer, seed);
    player = new Player(camera, world);
    input = new Input(canvas);
    mining = new MiningController(world, worldLayer, onBreak, () => inv?.selected());
    mobs = new MobSystem(world, worldLayer);
    inv = new Inventory();
    hud = new HUD(inv);
    hunger = 20;
    lastHungerTick = performance.now();
    // Wire the boss attack callback — when the golem lands a hit on the
    // moon, drain hunger + flash the hurt sound. Creative mode is immune.
    world._bossAttackCallback = () => {
      if (creativeMode) return;
      hunger = Math.max(0, hunger - 3);
      hud.setHunger(hunger);
      if (typeof window.hurt === "function") window.hurt();
      if (hunger <= 0) {
        player.spawn();
        hunger = 6;
        hud.setHunger(hunger);
      }
    };
    attackCooldown = 0;
    creativeMode = false;

    if (saved && saved.modified) {
      for (const [k, v] of Object.entries(saved.modified)) world.modified.set(k, v);
    }
    if (saved && saved.chests) {
      for (const [k, v] of Object.entries(saved.chests)) world.chests.set(k, v);
    }
    if (saved && saved.doors) {
      for (const k of saved.doors) world.doors.add(k);
    }
    if (saved && saved.traders) {
      for (const [k, v] of Object.entries(saved.traders)) world.traders.set(k, v);
    }
    // Rebuild the torch index from persisted block edits so the light pool
    // works immediately on load.
    for (const [k, v] of world.modified) {
      if (v !== B.AIR && BLOCKS[v] && BLOCKS[v].light) world.torches.add(k);
    }

    // Pre-generate spawn chunks so player has ground.
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        world.ensureChunk(dx, dz);

    if (saved && saved.player) {
      player.pos.set(saved.player.x, saved.player.y, saved.player.z);
      player.yaw = saved.player.yaw || 0;
      player.pitch = saved.player.pitch || 0;
      if (saved.player.fly) player.fly = true;
    } else {
      player.spawn();
    }

    if (saved && saved.inventory) {
      inv.items = saved.inventory.items || {};
      inv.hotbar = saved.inventory.hotbar || inv.hotbar;
      inv.main = saved.inventory.main || inv.main;
      inv.active = saved.inventory.active || 0;
      for (const k of Object.keys(inv.items)) if (inv.items[k] === null) inv.items[k] = Infinity;
    } else {
      inv.add(B.PLANKS, 8);
    }

    if (saved && typeof saved.hunger === "number") hunger = saved.hunger;

    if (mode === "creative") applyMode("creative");

    world.update(player.pos.x, player.pos.z);
    hud.refresh();
    hud.setHunger(hunger);
    applySettings({ renderer, camera, scene });

    startScreen.classList.add("hidden");
    hud.show(true);
    gameStarted = true;
    resume();
    startAmbient();
    // Footstep / landing state resets so a freshly booted world doesn't
    // immediately play a thud from stale prev-frame data.
    prevOnGround = player.onGround;
    footstepAcc = 0;
    miningTapAcc = 0;
    input.requestLock().catch(() => {
      // Pointer lock can fail on first boot (user gesture consumed by heavy
      // chunk gen, or Electron sandbox quirks). Show the resume overlay so the
      // next real click re-requests the lock with a fresh gesture.
      showResume();
    });
    setStatus("Ready");
  }

  function startGame(slot) {
    const data = loadSlot(slot);
    if (!data) { renderWorldList(); return; }
    activeSlot = { slot, name: data.name, mode: data.mode, seed: data.seed };
    bootWorld(data.mode || "survival", data.seed, data);
  }

  function showResume() {
    resumeOverlay.classList.remove("hidden");
    doSave(); // save on pause
  }
  function hideResume() { resumeOverlay.classList.add("hidden"); }

  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    if (gameStarted && !locked && !craftOpen && !invOpen && !chestOpen && startScreen.classList.contains("hidden")) {
      showResume();
    } else if (locked) {
      hideResume();
    }
  });
  resumeOverlay.addEventListener("click", () => input?.requestLock());
  $("#exit-world-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    doSave();
    location.reload();
  });

  // ---- Settings panel ----
  const settingsPanel = $("#settings-panel");
  const rdInput = $("#set-render-distance");
  function syncSettingsUI() {
    const s = getSettings();
    rdInput.value = s.renderDistance;
    $("#rd-val").textContent = s.renderDistance;
    for (const b of document.querySelectorAll("#set-pixel-ratio button")) {
      b.classList.toggle("active", Number(b.dataset.v) === s.pixelRatio);
    }
    $("#set-antialias").checked = s.antialias;
    $("#set-fog").checked = s.fog;
  }
  function openSettings() {
    syncSettingsUI();
    settingsPanel.classList.remove("hidden");
    document.exitPointerLock?.();
  }
  function closeSettings() {
    settingsPanel.classList.add("hidden");
    if (gameStarted && !craftOpen) showResume();
  }
  rdInput.addEventListener("input", () => $("#rd-val").textContent = rdInput.value);
  for (const b of document.querySelectorAll("#set-pixel-ratio button")) {
    b.addEventListener("click", () => {
      for (const o of document.querySelectorAll("#set-pixel-ratio button")) o.classList.remove("active");
      b.classList.add("active");
    });
  }
  $("#settings-apply").addEventListener("click", () => {
    const prBtn = document.querySelector("#set-pixel-ratio button.active");
    saveSettings({
      renderDistance: Number(rdInput.value),
      pixelRatio: Number(prBtn?.dataset.v ?? DEFAULTS.pixelRatio),
      antialias: $("#set-antialias").checked,
      fog: $("#set-fog").checked,
    });
    applySettings({ renderer, camera, scene });
    const note = $("#settings-note");
    note.classList.remove("hidden");
    setTimeout(() => note.classList.add("hidden"), 1500);
  });
  $("#settings-close").addEventListener("click", closeSettings);
  $("#open-settings-start").addEventListener("click", openSettings);
  $("#open-settings-pause").addEventListener("click", (e) => {
    e.stopPropagation();
    openSettings();
  });

  // Save on tab close / page hide.
  window.addEventListener("beforeunload", () => doSave());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) doSave();
  });

  $("#craft-close").addEventListener("click", () => {
    craftPanel.classList.add("hidden");
    craftOpen = false;
    showResume();
  });

  // ---- Inventory panel (Tab) ----
  const invGrid = $("#inv-grid");
  const invHotbar = $("#inv-hotbar");
  function buildInvSlots() {
    invGrid.innerHTML = "";
    invHotbar.innerHTML = "";
    for (let i = 0; i < 9; i++) {
      const s = document.createElement("div");
      s.className = "inv-slot hotbar";
      s.dataset.kind = "hotbar";
      s.dataset.idx = i;
      bindSlotEvents(s, () => onInvSlotPick("hotbar", i), () => onInvSlotDrop("hotbar", i));
      invHotbar.append(s);
    }
    for (let i = 0; i < 27; i++) {
      const s = document.createElement("div");
      s.className = "inv-slot";
      s.dataset.kind = "main";
      s.dataset.idx = i;
      bindSlotEvents(s, () => onInvSlotPick("main", i), () => onInvSlotDrop("main", i));
      invGrid.append(s);
    }
  }
  function refreshInvPanel() {
    if (!invOpen) return;
    const drawSlot = (el, id) => {
      if (id == null) {
        el.classList.add("empty");
        el.style.backgroundImage = "";
        el.textContent = "";
      } else {
        el.classList.remove("empty");
        const tex = getTexture(id, "side");
        el.style.backgroundImage = `url(${tex.image.toDataURL?.() || tex.image.src})`;
        const c = inv.count(id);
        el.textContent = c === Infinity ? "∞" : (c > 1 ? String(c) : "");
      }
    };
    invHotbar.querySelectorAll(".inv-slot").forEach((el) => {
      const idx = +el.dataset.idx;
      drawSlot(el, inv.hotbar[idx]);
      el.classList.toggle("active", idx === inv.active);
    });
    invGrid.querySelectorAll(".inv-slot").forEach((el) => {
      drawSlot(el, inv.main[+el.dataset.idx]);
    });
  }
  function onInvSlotClick(kind, idx) {
    const arr = kind === "hotbar" ? inv.hotbar : inv.main;
    invCarried = inv.swapWith(arr, idx, invCarried);
    hud.refresh();
    refreshInvPanel();
  }
  // mousedown: pick up the slot's contents (only if nothing already carried).
  function onInvSlotPick(kind, idx) {
    if (invCarried) return;
    const arr = kind === "hotbar" ? inv.hotbar : inv.main;
    const cur = arr[idx];
    if (cur == null) return;
    invCarried = { id: cur };
    arr[idx] = null;
    hud.refresh();
    refreshInvPanel();
  }
  // mouseup: drop the carried item into the slot (swap if occupied).
  function onInvSlotDrop(kind, idx) {
    if (!invCarried) return;
    const arr = kind === "hotbar" ? inv.hotbar : inv.main;
    const cur = arr[idx];
    if (cur == null) { arr[idx] = invCarried.id; invCarried = null; }
    else if (cur === invCarried.id) { invCarried = null; }
    else { arr[idx] = invCarried.id; invCarried = { id: cur }; }
    hud.refresh();
    refreshInvPanel();
  }
  function toggleInv() {
    invOpen = !invOpen;
    invPanel.classList.toggle("hidden", !invOpen);
    if (invOpen) {
      document.exitPointerLock?.();
      buildInvSlots();
      refreshInvPanel();
    } else {
      showResume();
    }
  }
  $("#inv-close").addEventListener("click", toggleInv);

  // ---- Creative picker (P) ----
  // Shows every placeable block; click to drop onto the currently selected
  // hotbar slot. Survival mode never opens it.
  const creativePanel = $("#creative-panel");
  const creativeGrid = $("#creative-grid");
  let creativeOpen = false;
  // Curated block list (skips AIR + non-block items that don't render in the
  // world: raw food, tools, individual ore blocks would be redundant with
  // their block-tier versions).
  const CREATIVE_PALETTE = [
    B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.SAND, B.WOOD, B.PLANKS, B.BEAM,
    B.BRICK, B.GLASS, B.WALL_STONE, B.WALL_WOOD, B.ARCH, B.LEAVES,
    B.IRON_BLOCK, B.GOLD_BLOCK, B.DIAMOND_BLOCK, B.PLATINUM_BLOCK,
    B.TORCH, B.FIREPLACE, B.CHEST, B.DOOR, B.TRADER,
    B.SAND, B.SNOW, B.ICE, B.CACTUS, B.SEAGRASS, B.KELP, B.CORAL,
    B.WATER, B.LAVA,
    B.MOON_ROCK, B.MOON_DUST, B.MOON_STONE,
    B.PLATINUM_TROPHY,
    B.IRON_ORE, B.GOLD_ORE, B.DIAMOND_ORE, B.PLATINUM_ORE,
    B.PICKAXE_WOOD, B.PICKAXE_STONE, B.PICKAXE_IRON, B.PICKAXE_DIAMOND, B.PICKAXE_PLATINUM,
    B.RAW_BEEF, B.COOKED_BEEF, B.RAW_FISH, B.COOKED_FISH,
    B.BUCKET, B.WATER_BUCKET, B.LAVA_BUCKET,
  ];
  function buildCreativeGrid() {
    creativeGrid.innerHTML = "";
    for (const id of CREATIVE_PALETTE) {
      const def = BLOCKS[id]; if (!def) continue;
      const el = document.createElement("div");
      el.className = "creative-slot";
      el.title = def.name || "?";
      const tex = getTexture(id, "side");
      const src = tex.image.toDataURL?.() || tex.image.src;
      el.style.backgroundImage = `url(${src})`;
      el.addEventListener("click", () => {
        const slot = inv.active ?? 0;
        inv.hotbar[slot] = id;
        inv.items[id] = Infinity;
        if (typeof window.place === "function") window.place();
        hud.refresh();
      });
      creativeGrid.append(el);
    }
  }
  function toggleCreative() {
    if (!creativeMode) return;
    creativeOpen = !creativeOpen;
    creativePanel.classList.toggle("hidden", !creativeOpen);
    if (creativeOpen) {
      document.exitPointerLock?.();
      buildCreativeGrid();
    } else {
      showResume();
    }
  }
  $("#creative-close").addEventListener("click", toggleCreative);

  // ---- Chest panel ----
  const chestPanel = $("#chest-panel");
  const chestGrid = $("#chest-grid");
  const chestPlayerGrid = $("#chest-player-grid");
  const chestPlayerHotbar = $("#chest-player-hotbar");
  let chestOpen = false;
  let chestPos = null;       // {x,y,z} of currently open chest
  let chestCarried = null;   // {id} held while swapping

  function buildChestSlots() {
    chestGrid.innerHTML = "";
    chestPlayerGrid.innerHTML = "";
    chestPlayerHotbar.innerHTML = "";
    for (let i = 0; i < 27; i++) {
      const s = document.createElement("div");
      s.className = "inv-slot";
      s.dataset.kind = "chest";
      s.dataset.idx = i;
      bindSlotEvents(s, () => onChestSlotPick("chest", i), () => onChestSlotDrop("chest", i));
      chestGrid.append(s);
    }
    for (let i = 0; i < 27; i++) {
      const s = document.createElement("div");
      s.className = "inv-slot";
      s.dataset.kind = "main";
      s.dataset.idx = i;
      bindSlotEvents(s, () => onChestSlotPick("main", i), () => onChestSlotDrop("main", i));
      chestPlayerGrid.append(s);
    }
    for (let i = 0; i < 9; i++) {
      const s = document.createElement("div");
      s.className = "inv-slot hotbar";
      s.dataset.kind = "hotbar";
      s.dataset.idx = i;
      bindSlotEvents(s, () => onChestSlotPick("hotbar", i), () => onChestSlotDrop("hotbar", i));
      chestPlayerHotbar.append(s);
    }
  }
  function refreshChestPanel() {
    if (!chestOpen || !chestPos) return;
    const drawSlot = (el, id, count) => {
      if (id == null) {
        el.classList.add("empty");
        el.style.backgroundImage = "";
        el.textContent = "";
      } else {
        el.classList.remove("empty");
        const tex = getTexture(id, "side");
        el.style.backgroundImage = `url(${tex.image.toDataURL?.() || tex.image.src})`;
        el.textContent = count === Infinity ? "∞" : (count > 1 ? String(count) : "");
      }
    };
    const slots = world.chests.get(World.modKey(chestPos.x, chestPos.y, chestPos.z)) || new Array(27).fill(null);
    chestGrid.querySelectorAll(".inv-slot").forEach((el) => {
      const idx = +el.dataset.idx;
      drawSlot(el, slots[idx], slots[idx] != null ? inv.count(slots[idx]) || 1 : 0);
    });
    chestPlayerGrid.querySelectorAll(".inv-slot").forEach((el) => {
      const id = inv.main[+el.dataset.idx];
      drawSlot(el, id, id != null ? inv.count(id) : 0);
    });
    chestPlayerHotbar.querySelectorAll(".inv-slot").forEach((el) => {
      const idx = +el.dataset.idx;
      const id = inv.hotbar[idx];
      drawSlot(el, id, id != null ? inv.count(id) : 0);
      el.classList.toggle("active", idx === inv.active);
    });
  }
  function onChestSlotClick(kind, idx) {
    if (kind === "chest") {
      if (!chestPos) return;
      const slots = world.getChest(chestPos.x, chestPos.y, chestPos.z);
      const cur = slots[idx];
      if (chestCarried && cur == null) { slots[idx] = chestCarried.id; chestCarried = null; }
      else if (chestCarried && cur != null && cur === chestCarried.id) { chestCarried = null; }
      else if (chestCarried && cur != null) { slots[idx] = chestCarried.id; chestCarried = { id: cur }; }
      else if (!chestCarried && cur != null) { chestCarried = { id: cur }; slots[idx] = null; }
    } else {
      const arr = kind === "hotbar" ? inv.hotbar : inv.main;
      invCarried = inv.swapWith(arr, idx, invCarried);
    }
    hud.refresh();
    refreshChestPanel();
  }
  // Resolve a chest-panel slot to its underlying array.
  function chestArrFor(kind) {
    if (kind === "chest") return chestPos ? world.getChest(chestPos.x, chestPos.y, chestPos.z) : null;
    return kind === "hotbar" ? inv.hotbar : inv.main;
  }
  function onChestSlotPick(kind, idx) {
    if (chestCarried) return;
    const arr = chestArrFor(kind);
    if (!arr) return;
    const cur = arr[idx];
    if (cur == null) return;
    chestCarried = { id: cur };
    arr[idx] = null;
    hud.refresh();
    refreshChestPanel();
  }
  function onChestSlotDrop(kind, idx) {
    if (!chestCarried) return;
    const arr = chestArrFor(kind);
    if (!arr) return;
    const cur = arr[idx];
    if (cur == null) { arr[idx] = chestCarried.id; chestCarried = null; }
    else if (cur === chestCarried.id) { chestCarried = null; }
    else { arr[idx] = chestCarried.id; chestCarried = { id: cur }; }
    hud.refresh();
    refreshChestPanel();
  }
  function openChest(x, y, z) {
    chestPos = { x, y, z };
    chestOpen = true;
    uiPanel();
    invCarried = null; chestCarried = null;
    document.exitPointerLock?.();
    chestPanel.classList.remove("hidden");
    buildChestSlots();
    refreshChestPanel();
  }
  // Scan nearby blocks for a chest and open the closest one. Used so the
  // player doesn't have to aim precisely at the chest block.
  function openNearestChest() {
    const px = Math.floor(player.pos.x), py = Math.floor(player.pos.y + 1), pz = Math.floor(player.pos.z);
    let best = null, bestD = Infinity;
    const R = 5;
    for (let dx = -R; dx <= R; dx++)
      for (let dy = -2; dy <= 3; dy++)
        for (let dz = -R; dz <= R; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > R) continue;
          const bx = px + dx, by = py + dy, bz = pz + dz;
          if (world.getBlock(bx, by, bz) !== B.CHEST) continue;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestD) { bestD = d; best = { x: bx, y: by, z: bz }; }
        }
    if (best) openChest(best.x, best.y, best.z);
  }
  function closeChest() {
    chestOpen = false;
    chestPos = null;
    chestPanel.classList.add("hidden");
    showResume();
  }

  // ---- Trade panel (right-click trader block) ----
  const tradePanel = $("#trade-panel");
  const tradeList = $("#trade-list");
  const tradeGold = $("#trade-gold");
  let tradeOpen = false;
  let tradePos = null;
  function goldCount() { return inv.count(B.GOLD_ORE) + inv.count(B.GOLD_BLOCK) * 9; }
  function spendGold(amount) {
    // Prefer ore first (1 each), then break blocks into 9 ore as needed.
    let remaining = amount;
    const oreUsed = Math.min(inv.count(B.GOLD_ORE), remaining);
    if (oreUsed > 0) { inv.remove(B.GOLD_ORE, oreUsed); remaining -= oreUsed; }
    while (remaining > 0 && inv.count(B.GOLD_BLOCK) > 0) {
      inv.remove(B.GOLD_BLOCK, 1);
      inv.add(B.GOLD_ORE, 9);
      const use = Math.min(9, remaining);
      inv.remove(B.GOLD_ORE, use);
      remaining -= use;
    }
    return remaining === 0;
  }
  function refreshTradePanel() {
    if (!tradeOpen || !tradePos) return;
    const offers = world.traders.get(World.modKey(tradePos.x, tradePos.y, tradePos.z)) || [];
    const gold = goldCount();
    tradeGold.textContent = `Your gold: ${gold} (ore = 1, block = 9)`;
    tradeList.innerHTML = "";
    offers.forEach((o, i) => {
      const row = document.createElement("div");
      row.className = "trade-row" + (gold < o.cost ? " out" : "");
      const icon = document.createElement("div");
      icon.className = "icon";
      const tex = getTexture(o.id, "side");
      icon.style.backgroundImage = `url(${tex.image.toDataURL?.() || tex.image.src})`;
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = `${BLOCKS[o.id]?.name || "?"} ×${o.count}`;
      const cost = document.createElement("div");
      cost.className = "cost";
      cost.textContent = `Cost: ${o.cost} gold`;
      const btn = document.createElement("button");
      btn.textContent = "Buy";
      btn.disabled = gold < o.cost;
      btn.addEventListener("click", () => {
        if (!spendGold(o.cost)) return;
        inv.add(o.id, o.count);
        hud.refresh();
        refreshTradePanel();
      });
      row.append(icon, name, cost, btn);
      tradeList.append(row);
    });
  }
  function openTrader(x, y, z) {
    tradePos = { x, y, z };
    tradeOpen = true;
    uiPanel();
    world.getTrader(x, y, z); // lazily create offers if missing
    document.exitPointerLock?.();
    tradePanel.classList.remove("hidden");
    refreshTradePanel();
  }
  function closeTrader() {
    tradeOpen = false;
    tradePos = null;
    tradePanel.classList.add("hidden");
    showResume();
  }
  $("#trade-close").addEventListener("click", closeTrader);
  $("#chest-close").addEventListener("click", closeChest);

  let recipeSig = "";
  function renderRecipes() {
    const list = $("#recipe-list");
    list.innerHTML = "";
    const ctx = { nearFire: nearFireplace() };
    for (const r of RECIPES) {
      const div = document.createElement("div");
      div.className = "recipe";
      const cost = r.in.map((c) => `${c.count} ${BLOCKS[c.id].name} (have ${inv.count(c.id)})`).join(" + ");
      const ok = canCraft(inv, r, ctx);
      div.innerHTML = `<div><div>${r.name}</div><div class="cost">${cost}</div></div>`;
      const btn = document.createElement("button");
      btn.textContent = "Craft";
      btn.disabled = !ok;
      btn.onclick = () => { if (craft(inv, r, ctx)) { hud.refresh(); refreshCraftIfOpen(); } };
      div.appendChild(btn);
      list.appendChild(div);
    }
  }
  function refreshCraftIfOpen() {
    if (!craftOpen) return;
    const ctx = { nearFire: nearFireplace() };
    const sig = RECIPES.map(r => r.in.map(c => c.id + ":" + inv.count(c.id)).join(",") + (r.needsFire ? ";f:" + ctx.nearFire : "")).join("|");
    if (sig !== recipeSig) { recipeSig = sig; renderRecipes(); }
  }

  let lastFpsT = performance.now();
  let frames = 0;

  function toggleCraft() {
    craftOpen = !craftOpen;
    craftPanel.classList.toggle("hidden", !craftOpen);
    if (craftOpen) {
      document.exitPointerLock?.();
      recipeSig = "";
      refreshCraftIfOpen();
    } else {
      showResume();
    }
  }

  const loop = new Loop((dt, now) => {
    if (!gameStarted) { renderer.render(scene, camera); return; }
    // Hotbar selection
    for (let i = 0; i < 9; i++) {
      if (input.justPressed.has(`Digit${i + 1}`)) { inv.active = i; hud.refresh(); }
    }
    if (input.justPressed.has("KeyE")) {
      if (chestOpen) closeChest();
      else if (tradeOpen) closeTrader();
      else toggleCraft();
    }
    if (input.justPressed.has("Tab") || input.justPressed.has("KeyI")) toggleInv();
    if (input.justPressed.has("KeyP")) toggleCreative();
    if (input.justPressed.has("KeyR") && !chestOpen) openNearestChest();
    if (input.justPressed.has("KeyF")) player.toggleFly();
    if (input.justPressed.has("Escape") && chestOpen) closeChest();
    if (input.justPressed.has("Escape") && tradeOpen) closeTrader();
    if (input.justPressed.has("Escape") && creativeOpen) toggleCreative();
    if (input.justPressed.has("KeyT") && isInRoom() && !chatOpen && !craftOpen && !invOpen && !chestOpen && !tradeOpen) openChat();

    if (craftOpen) {
      refreshCraftIfOpen();
      input.endFrame();
      renderer.render(scene, camera);
      return;
    }
    if (invOpen) {
      input.endFrame();
      renderer.render(scene, camera);
      return;
    }
    if (chestOpen) {
      refreshChestPanel();
      input.endFrame();
      renderer.render(scene, camera);
      return;
    }
    if (tradeOpen) {
      input.endFrame();
      renderer.render(scene, camera);
      return;
    }

    if (!input.locked) {
      input.endFrame();
      renderer.render(scene, camera);
      return;
    }

    attackCooldown = Math.max(0, attackCooldown - dt);

    player.update(dt, input);

    // Floating origin: snap to a 16-block grid so chunks render near scene
    // origin. player.update set the camera in world coords; subtract origin
    // so the camera ends up in scene space too.
    floatingOrigin.set(
      Math.round(player.pos.x / 16) * 16,
      0,
      Math.round(player.pos.z / 16) * 16,
    );
    worldLayer.position.set(-floatingOrigin.x, 0, -floatingOrigin.z);
    camera.position.sub(floatingOrigin);

    // --- SFX: footsteps, mining taps, landing ---
    // Footstep cadence is driven by horizontal distance travelled while
    // grounded — every ~2.2 blocks a footstep fires with the surface the
    // player is standing on. Falling/jumping skips the cadence so air time
    // is silent. Mining taps run on a time accumulator while the player
    // holds MINE, with pitch tracking the crack stage.
    const moved = Math.hypot(player.pos.x - prevPos.x, player.pos.z - prevPos.z);
    if (player.onGround && moved > 0.0001 && !player.fly) {
      footstepAcc += moved;
      // Cadence scales slightly with speed so sprinting isn't just louder,
      // it actually steps faster.
      const stride = 2.0;
      if (footstepAcc >= stride) {
        footstepAcc = 0;
        const below = world.getBlock(
          Math.floor(player.pos.x),
          Math.floor(player.pos.y - 0.2),
          Math.floor(player.pos.z)
        );
        footstep(materialOf(below));
      }
    } else {
      footstepAcc = 0;
    }
    // Landing: only fires when transitioning from air → ground, with a
    // heavier thud the further the fall. Skipped on first frame after boot.
    if (!prevOnGround && player.onGround && prevPos.y - player.pos.y > -0.01) {
      const drop = Math.max(0, prevPos.y - player.pos.y);
      land(Math.min(1.5, 0.4 + drop * 0.15));
    }
    prevOnGround = player.onGround;
    prevPos.copy(player.pos);

    // Mining tap cadence: while the player is actively mining (LMB held +
    // aiming at a block), fire a tap every ~0.13s of progress.
    if (input.mouseDown[0]) {
      const t2 = mining.acquire(player);
      if (t2) {
        const id2 = world.getBlock(t2.x, t2.y, t2.z);
        const d2 = BLOCKS[id2];
        if (d2 && d2.hardness !== Infinity) {
          miningTapAcc += dt;
          if (miningTapAcc >= 0.13) {
            miningTapAcc = 0;
            mineHit(materialOf(id2), mining.crackStage());
          }
        }
      } else {
        miningTapAcc = 0;
      }
    } else {
      miningTapAcc = 0;
    }

    dayNight.update(dt, {
      x: player.pos.x - floatingOrigin.x,
      y: player.pos.y - floatingOrigin.y,
      z: player.pos.z - floatingOrigin.z,
    });

    // --- Underwater / lava fog: applied AFTER DayNight so the sky tint it
    // sets each frame doesn't clobber our submersion look. When the head is
    // submerged, swap in a deep tint + pull fog close. Lava submersion is
    // even thicker so the player can barely see.
    const headBlock = world.getBlock(
      Math.floor(player.pos.x),
      Math.floor(player.pos.y + player.eye),
      Math.floor(player.pos.z),
    );
    if (headBlock === B.WATER) {
      scene.background.set("#1f4a72");
      scene.fog.color.set("#1f4a72");
      scene.fog.near = 1;
      scene.fog.far = 22;
    } else if (headBlock === B.LAVA) {
      scene.background.set("#5a1a08");
      scene.fog.color.set("#5a1a08");
      scene.fog.near = 0.5;
      scene.fog.far = 6;
    } else {
      const s = getSettings();
      scene.fog.near = Math.max(8, s.renderDistance * 8);
      scene.fog.far = Math.max(40, s.renderDistance * 16 + 8);
    }

    // --- Moon sky override: no atmosphere on the moon, so force a near-black
    // starfield regardless of day/night cycle. Done AFTER DayNight + fog
    // logic so we win every frame.
    if (world.dimension === "moon" && headBlock !== B.WATER && headBlock !== B.LAVA) {
      scene.background.set("#050510");
      scene.fog.color.set("#050510");
      scene.fog.near = Math.max(20, getSettings().renderDistance * 12);
      scene.fog.far = Math.max(60, getSettings().renderDistance * 24);
    }

    // --- Portal trigger: standing in a PORTAL block swaps dimension. The
    // trip is one-shot per entry (cooldown via inPortal flag) so the player
    // can stand on the destination portal without bouncing back instantly.
    portalAcc += dt;
    if (portalAcc > 0.5) {
      const footId = world.getBlock(
        Math.floor(player.pos.x),
        Math.floor(player.pos.y + 0.5),
        Math.floor(player.pos.z),
      );
      if (footId === B.PORTAL && !inPortal) {
        inPortal = true;
        travelDimension();
      } else if (footId !== B.PORTAL) {
        inPortal = false;
      }
      portalAcc = 0;
    }
    // Wind ambient: quieter during full day, slightly louder at dawn/dusk
    // and night, so the world feels stiller when the sun is up.
    setAmbient(0.08 + (1 - dayNight.dayFactor()) * 0.08);

    // Reassign torch lights to the nearest torches a few times per second —
    // doing it every frame is wasteful since torches don't move.
    torchLightAcc += dt;
    if (torchLightAcc >= 0.1) {
      torchLightAcc = 0;
      updateTorchLights(player.pos);
    }

    if (input.mouseJust[0]) attack();
    const miningAim = !mobs.raycast(player.eyePos(), player.lookDir(), CONFIG.mining.range + 1);
    const target = mining.update(dt, player, input.mouseDown[0] && miningAim);
    if (input.mouseJust[2] || input.justPressed.has("KeyQ")) placeBlock();
    if (input.mouseJust[1]) pickBlock();

    mobs.update(dt, player.pos);

    // Tick the boss if it exists; clean up once the death anim finishes.
    if (bossGolem) {
      const alive = bossGolem.update(dt, player.pos);
      if (!alive) { bossGolem.remove(); bossGolem = null; }
    }
    // Boss HP bar at top of HUD — only visible while the golem is alive.
    const bossBar = $("#boss-hp-bar");
    if (bossBar) {
      if (bossGolem && bossGolem.alive) {
        bossBar.style.display = "block";
        const pct = Math.max(0, (bossGolem.health / bossGolem.maxHealth) * 100);
        const fill = $("#boss-hp-fill");
        if (fill) fill.style.width = pct + "%";
        const lbl = $("#boss-hp-label");
        if (lbl) lbl.textContent = `Moon Rock Golem  ${Math.ceil(bossGolem.health)}/${bossGolem.maxHealth}`;
      } else {
        bossBar.style.display = "none";
      }
    }

    const nowMs = performance.now();
    if (!creativeMode && nowMs - lastHungerTick > 24000) {
      lastHungerTick = nowMs;
      hunger = Math.max(0, hunger - 0.25);
      hud.setHunger(hunger);
    }
    // Lava damage: drains hunger fast and respawns the player at zero so a
    // brief dip is survivable but standing in lava is bad. Creative mode is
    // immune — same as hunger.
    if (!creativeMode && player.inLava) {
      lavaAcc += dt;
      if (lavaAcc >= 0.4) {
        lavaAcc = 0;
        hunger = Math.max(0, hunger - 2);
        hud.setHunger(hunger);
        if (typeof window.hurt === "function") window.hurt();
        if (hunger <= 0) {
          // Rescue: teleport out and refill a sliver so they don't die twice.
          player.spawn();
          hunger = 6;
          hud.setHunger(hunger);
        }
      }
    } else {
      lavaAcc = 0;
    }

    if (target) {
      const id = world.getBlock(target.x, target.y, target.z);
      hud.setTarget(BLOCKS[id]?.name || "");
    } else hud.setTarget(null);

    world.update(player.pos.x, player.pos.z);
    world.tickLiquids();

    // Multiplayer: broadcast our position at ~15Hz and lerp remote avatars.
    if (isInRoom()) {
      mpStateAcc += dt;
      if (mpStateAcc >= 1 / 15) {
        mpStateAcc = 0;
        sendPlayerState(player.pos, player.yaw, player.pitch);
      }
      updateRemoteAvatars(dt);
    }

    // Auto-save every 30s.
    if (nowMs - lastAutoSave > 30000) {
      lastAutoSave = nowMs;
      doSave();
    }

    frames++;
    if (now - lastFpsT > 500) {
      hud.setFps(((frames * 1000) / (now - lastFpsT)).toFixed(0));
      frames = 0; lastFpsT = now;
    }
    hud.setPos(player.pos);

    renderer.render(scene, camera);
    input.endFrame();
  });
  loop.start();

  // ---- Multiplayer UI wiring (v1.1) ----
  // Host/Join lives on the title screen. Connection state is mirrored to a
  // small status div so the player can see what's happening.
  const mpStatus = $("#mp-status");
  const mpPlayers = $("#mp-players");
  const mpHostBtn = $("#mp-host-btn");
  const mpJoinBtn = $("#mp-join-btn");
  const mpLeaveBtn = $("#mp-leave-btn");
  const mpCodeInput = $("#mp-join-code");
  const connectedPlayers = new Map(); // actorNr -> name

  function mpSetStatus(msg) { if (mpStatus) mpStatus.textContent = msg; }
  function mpRefreshPlayers() {
    if (!mpPlayers) return;
    if (connectedPlayers.size === 0) { mpPlayers.textContent = ""; return; }
    const names = Array.from(connectedPlayers.values()).join(", ");
    mpPlayers.textContent = `In room: ${names}`;
  }

  // Wire the callbacks so avatar/spawn/despawn hooks can be added later.
  callbacks.onConnected = () => mpSetStatus("Connected to Photon cloud.");
  callbacks.onRoomJoined = (roomCode, isHost) => {
    mpSetStatus(`${isHost ? "Hosting" : "Joined"} room ${roomCode}`);
    mpHostBtn.disabled = true;
    mpJoinBtn.disabled = true;
    mpCodeInput.disabled = true;
    mpLeaveBtn.classList.remove("hidden");
  };
  callbacks.onPlayerEnter = (id, name) => {
    connectedPlayers.set(id, name);
    mpRefreshPlayers();
  };
  callbacks.onPlayerLeave = (id) => {
    connectedPlayers.delete(id);
    mpRefreshPlayers();
  };
  const mpRoomEl = $("#mp-room");
  function mpShowRoomCode(code) {
    if (mpRoomEl) mpRoomEl.textContent = code ? ` · Room ${code}` : "";
  }
  callbacks.onError = (msg) => mpSetStatus(`Error: ${msg}`);
  callbacks.onStatus = (msg) => mpSetStatus(msg);
  callbacks.onPlayerEnter = (actorNr, name) => {
    spawnRemoteAvatar(actorNr, name);
    connectedPlayers.set(actorNr, name || `Player ${actorNr}`);
    mpRefreshPlayers();
    // Host streams the world delta to any newcomer so they see the same
    // buildings/edits as everyone else. Chunked to stay under the per-event
    // payload cap; sent on next tick so the joiner's world has time to boot.
    if (mpIsHost && world) {
      const entries = Array.from(world.modified.entries())
        .map(([k, v]) => { const [x, y, z] = k.split(",").map(Number); return { x, y, z, id: v }; });
      const CHUNK = 400;
      let seq = 0;
      for (let i = 0; i < entries.length; i += CHUNK) {
        const slice = entries.slice(i, i + CHUNK);
        const done = i + CHUNK >= entries.length;
        // Stagger slightly so we don't blast the joiner all at once.
        setTimeout(() => sendWorldDump(slice, seq++, done), 200 + seq * 150);
      }
    }
  };
  callbacks.onRemoteWorldDump = (data) => {
    if (!world || !data?.entries) return;
    for (const e of data.entries) world.setBlock(e.x, e.y, e.z, e.id);
    if (data.done) mpSetStatus(`World sync complete.`);
  };
  callbacks.onPlayerLeave = (actorNr) => {
    despawnRemoteAvatar(actorNr);
    connectedPlayers.delete(actorNr);
    mpRefreshPlayers();
  };
  callbacks.onRemoteBlockEdit = (edit) => { mpApplyRemoteBlock(edit); };
  callbacks.onRemotePlayerState = (st, actorNr) => { applyRemotePlayerState(actorNr, st); };
  callbacks.onRemoteChat = (text, actorNr) => {
    if (typeof text !== "string" || !text.trim()) return;
    pushChat(actorName(actorNr), text.slice(0, 120));
  };

  // ---- Chat ----
  const chatLogEl = $("#mp-chat-log");
  const chatBoxEl = $("#mp-chat-box");
  const chatInputEl = $("#mp-chat-input");
  let chatOpen = false;
  function pushChat(who, text) {
    if (!chatLogEl) return;
    const el = document.createElement("div");
    el.className = "msg";
    const w = document.createElement("span"); w.className = "who"; w.textContent = who + ":";
    const t = document.createTextNode(" " + text);
    el.appendChild(w); el.appendChild(t);
    chatLogEl.appendChild(el);
    // Keep the log bounded — old messages fall off as new ones arrive.
    while (chatLogEl.children.length > 6) chatLogEl.removeChild(chatLogEl.firstChild);
    setTimeout(() => el.remove(), 8000);
  }
  function openChat() {
    if (!chatBoxEl) return;
    chatOpen = true;
    chatBoxEl.classList.remove("hidden");
    chatInputEl.value = "";
    chatInputEl.focus();
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function closeChat() {
    chatOpen = false;
    chatBoxEl.classList.add("hidden");
    if (gameStarted) input?.requestLock().catch(() => showResume());
  }
  function sendChatFromInput() {
    const text = (chatInputEl.value || "").trim();
    if (text) {
      sendChat(text.slice(0, 120));
      pushChat(getLocalName ? getLocalName() : "Me", text.slice(0, 120));
    }
    closeChat();
  }
  chatInputEl?.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); sendChatFromInput(); }
    else if (e.key === "Escape") { e.preventDefault(); closeChat(); }
  });
  // Stop the global keydown handler from firing while typing.
  chatInputEl?.addEventListener("keyup", (e) => e.stopPropagation());

  mpHostBtn?.addEventListener("click", async () => {
    mpSetStatus("Connecting…");
    try {
      await connect();
      const seed = (Math.random() * 1e9) | 0;
      const code2 = await hostRoom(seed);
      mpSetStatus(`Hosting room ${code2} (seed ${seed})`);
      mpLeaveBtn?.classList.remove("hidden");
      mpShowRoomCode(code2);
      mpIsHost = true;
      bootWorld("survival", seed, null);
      mpActiveSlot = { slot: -1, name: `MP ${code2}`, mode: "survival", seed };
    } catch (e) { mpSetStatus(`Host failed: ${e.message}`); }
  });
  mpJoinBtn?.addEventListener("click", async () => {
    const c = (mpCodeInput.value || "").toUpperCase().trim();
    if (c.length !== 5) { mpSetStatus("Code must be 5 letters"); return; }
    mpSetStatus("Connecting…");
    try {
      await connect();
      const r = await joinRoom(c);
      mpSetStatus(`Joined room ${r.code} (seed ${r.seed ?? "?"})`);
      mpLeaveBtn?.classList.remove("hidden");
      mpShowRoomCode(r.code);
      // Restore local snapshot if we've played in this room before — picks up
      // inventory, position, and the modified-block delta as we last saw it.
      const saved = loadMpSave(r.code);
      const seed = (saved && saved.seed != null) ? saved.seed : (r.seed ?? ((Math.random() * 1e9) | 0));
      bootWorld("survival", seed, saved);
      mpActiveSlot = { slot: -1, name: `MP ${r.code}`, mode: "survival", seed };
      mpIsHost = false;
    } catch (e) { mpSetStatus(`Join failed: ${e.message}`); }
  });
  mpLeaveBtn?.addEventListener("click", () => {
    doSave(); // persist local MP snapshot before disconnecting
    leaveRoom();
    mpIsHost = false;
    mpShowRoomCode("");
    connectedPlayers.clear();
    clearAllRemoteAvatars();
    mpRefreshPlayers();
    mpHostBtn.disabled = false;
    mpJoinBtn.disabled = false;
    mpCodeInput.disabled = false;
    mpLeaveBtn.classList.add("hidden");
    mpSetStatus("Left room.");
  });
  mpCodeInput?.addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
  });

  renderWorldList();
  setStatus("Ready — pick a world or create a new one");
  } catch (err) {
    setStatus("Init failed: " + err.message);
    const el = document.getElementById("error-overlay");
    if (el) { el.style.display = "block"; el.textContent = "Init failed: " + err.message + "\n" + err.stack; }
    console.error(err);
  }
}

main();
