// Entry: wire renderer → world → player → mining/placing → crafting → HUD.
import * as THREE from "three";
import { CONFIG } from "./config.js";
import { createRenderer } from "./engine/renderer.js";
import { Loop } from "./engine/loop.js";
import { Input } from "./engine/input.js";
import { World } from "./world/world.js";
import { Player } from "./entities/player.js";
import { MiningController, raycastVoxel } from "./gameplay/mining.js";
import { Inventory } from "./gameplay/inventory.js";
import { HUD } from "./ui/hud.js";
import { RECIPES } from "./gameplay/recipes.js";
import { canCraft, craft } from "./gameplay/crafting.js";
import { TreeSystem } from "./gameplay/trees.js";
import { MobSystem } from "./gameplay/mobs.js";
import { B, BLOCKS, isSolid, isLiquid } from "./world/blocks.js";
import { atlasUV } from "./world/textures.js";

const $ = (s) => document.querySelector(s);

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

  const { renderer, scene, camera } = createRenderer(canvas);
  const world = new World(scene);
  const player = new Player(camera, world);
  const input = new Input(canvas);
  const mining = new MiningController(world, scene, onBreak);
  const trees = new TreeSystem(world);
  const mobs = new MobSystem(world, scene);
  const inv = new Inventory();
  const hud = new HUD(inv);
  let hunger = 20;            // 0..20
  let lastHungerTick = performance.now();
  let attackCooldown = 0;

  // Starter inventory: a few planks to bootstrap.
  inv.add(B.PLANKS, 8);

  setStatus("Generating world…");
  // Pre-warm the texture atlas so chunk meshing never triggers a re-upload mid-game.
  for (const idStr of Object.keys(BLOCKS)) {
    const id = Number(idStr);
    if (id === B.AIR || id === B.WATER) continue;
    for (let f = 0; f < 6; f++) atlasUV(id, f);
  }
  // Pre-generate chunks around spawn so player spawns on solid ground.
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++)
      world.ensureChunk(dx, dz);
  player.spawn();
  world.update(player.pos.x, player.pos.z);
  hud.refresh();
  hud.setHunger(hunger);
  setStatus("Ready — click Play!");

  function onBreak(kind, id, x, y, z) {
    if (kind === "tree") {
      const res = trees.hitLog(x, y, z);
      if (res) {
        // Tree fell: drop logs.
        inv.add(B.WOOD, res.logs);
        // Also some leaves drop.
        for (let dx = -2; dx <= 2; dx++)
          for (let dy = -2; dy <= 2; dy++)
            for (let dz = -2; dz <= 2; dz++) {
              if (world.getBlock(x + dx, y + dy, z + dz) === B.LEAVES) {
                world.setBlock(x + dx, y + dy, z + dz, B.AIR);
              }
            }
        hud.refresh();
        return true;
      }
      return false;
    }
    world.setBlock(x, y, z, B.AIR);
    inv.add(id, 1);
    hud.refresh();
    return true;
  }

  function placeBlock() {
    const sel = inv.selected();
    if (sel === null) return;
    // If selected item is food, eat instead of placing.
    if (BLOCKS[sel]?.food) { eat(sel); return; }
    const t = mining.acquire(player);
    if (!t) return;
    const px = t.x + t.face[0], py = t.y + t.face[1], pz = t.z + t.face[2];
    if (py < 0 || py >= CONFIG.world.chunkHeight) return;
    // Don't place inside the player.
    const minX = player.pos.x - player.half, maxX = player.pos.x + player.half;
    const minY = player.pos.y, maxY = player.pos.y + player.height;
    const minZ = player.pos.z - player.half, maxZ = player.pos.z + player.half;
    if (px + 1 > minX && px < maxX && py + 1 > minY && py < maxY && pz + 1 > minZ && pz < maxZ) return;
    if (world.getBlock(px, py, pz) !== B.AIR) return;
    world.setBlock(px, py, pz, sel);
    inv.remove(sel, 1);
    hud.refresh();
  }

  function eat(id) {
    const def = BLOCKS[id];
    if (!def?.food) return;
    if (hunger >= 20) return; // full
    if (!inv.remove(id, 1)) return;
    hunger = Math.min(20, hunger + def.food);
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
    const cow = mobs.raycast(origin, dir, CONFIG.mining.range + 1);
    if (cow) {
      const wasAlive = cow.alive;
      cow.hit(4, player.pos);
      if (wasAlive && !cow.alive) {
        // Cow just died — drop 2–3 raw beef.
        const drop = 2 + (Math.random() * 2 | 0);
        inv.add(B.RAW_BEEF, drop);
        hud.refresh();
      }
    }
  }

  // ---- UI wiring ----
  const startScreen = $("#start-screen");
  const craftPanel = $("#craft-panel");
  const resumeOverlay = $("#resume-overlay");
  let gameStarted = false;

  function showResume() { resumeOverlay.classList.remove("hidden"); }
  function hideResume() { resumeOverlay.classList.add("hidden"); }

  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    if (gameStarted && !locked && !craftOpen && startScreen.classList.contains("hidden")) {
      showResume();
    } else if (locked) {
      hideResume();
    }
  });
  resumeOverlay.addEventListener("click", () => input.requestLock());

  $("#start-btn").addEventListener("click", () => {
    startScreen.classList.add("hidden");
    hud.show(true);
    gameStarted = true;
    input.requestLock();
  });
  $("#craft-close").addEventListener("click", () => {
    craftPanel.classList.add("hidden");
    craftOpen = false;
    showResume();
  });

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

  // ---- Loop ----
  let lastFpsT = performance.now();
  let frames = 0;
  let craftOpen = false;

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
    // Hotbar selection
    for (let i = 0; i < 9; i++) {
      if (input.justPressed.has(`Digit${i + 1}`)) { inv.active = i; hud.refresh(); }
    }
    if (input.justPressed.has("KeyE")) toggleCraft();
    if (input.justPressed.has("KeyF")) player.toggleFly();

    if (craftOpen) {
      refreshCraftIfOpen();
      input.endFrame();
      renderer.render(scene, camera);
      return;
    }

    if (!input.locked) {
      // Paused: still render but don't simulate.
      input.endFrame();
      renderer.render(scene, camera);
      return;
    }

    attackCooldown = Math.max(0, attackCooldown - dt);

    player.update(dt, input);

    // Left-click: attack cow if aimed at one, otherwise mine.
    if (input.mouseJust[0]) attack();
    const miningAim = !mobs.raycast(player.eyePos(), player.lookDir(), CONFIG.mining.range + 1);
    const target = mining.update(dt, player, input.mouseDown[0] && miningAim);
    if (input.mouseJust[2] || input.justPressed.has("KeyQ")) placeBlock();

    // Mobs
    mobs.update(dt, player.pos);

    // Hunger tick
    const nowMs = performance.now();
    if (nowMs - lastHungerTick > 6000) {       // every 6s
      lastHungerTick = nowMs;
      hunger = Math.max(0, hunger - 0.5);
      hud.setHunger(hunger);
      if (hunger <= 0) {
        // Starving: nudge the player upward less jump and slow them.
        // Light penalty only — no death for now.
      }
    }
    if (input.mouseJust[0] && target && !BLOCKS[world.getBlock(target.x, target.y, target.z)]?.treeHealth) {
      // single-tap also fine; the hold loop does the work
    }

    // Target info text
    if (target) {
      const id = world.getBlock(target.x, target.y, target.z);
      hud.setTarget(BLOCKS[id]?.name || "");
    } else hud.setTarget(null);

    world.update(player.pos.x, player.pos.z);

    // FPS counter
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
  } catch (err) {
    setStatus("Init failed: " + err.message);
    const el = document.getElementById("error-overlay");
    if (el) { el.style.display = "block"; el.textContent = "Init failed: " + err.message + "\n" + err.stack; }
    console.error(err);
  }
}

main();
