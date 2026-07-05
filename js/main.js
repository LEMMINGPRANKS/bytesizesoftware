// Entry: wire renderer → world → player → mining/placing → crafting → HUD.
import * as THREE from "three";
import { CONFIG } from "./config.js";
import { createRenderer } from "./engine/renderer.js";
import { Loop } from "./engine/loop.js";
import { Input } from "./engine/input.js";
import { DayNight } from "./engine/daynight.js";
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
import { atlasUV, getTexture } from "./world/textures.js";
import {
  listSlots, loadSlot, saveSlot, deleteSlot, MAX_SLOTS,
  exportSlot, importToSlot, exportFilename,
} from "./save/saveManager.js";
import { getSettings, saveSettings, applySettings, DEFAULTS } from "./save/settings.js";

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

  const { renderer, scene, camera, sun, ambient, hemi } = createRenderer(canvas);
  const dayNight = new DayNight(scene, camera, sun, ambient, hemi);

  // Torch light pool. Each torch in the world is eligible to drive one of
  // these PointLights; we reassign them to the nearest N torches each tick.
  // Capped because Three.js re-renders every lit face per light — too many
  // lights tanks FPS.
  const TORCH_LIGHT_COUNT = 6;
  const TORCH_LIGHT_RANGE = 12;
  const TORCH_LIGHT_INTENSITY = 1.6;
  const torchLights = [];
  for (let i = 0; i < TORCH_LIGHT_COUNT; i++) {
    const l = new THREE.PointLight("#ffb060", 0, TORCH_LIGHT_RANGE, 2.0);
    scene.add(l);
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
      } else {
        tl.intensity = 0;
      }
    }
  }
  // World/player/etc. are created when a slot is chosen — seed depends on slot.
  let world, player, input, mining, trees, mobs, inv, hud;
  let hunger = 20;
  let lastHungerTick = performance.now();
  let attackCooldown = 0;
  let creativeMode = false;
  let activeSlot = null;
  let lastAutoSave = performance.now();

  function applyMode(mode) {
    if (mode === "creative") {
      creativeMode = true;
      player.fly = true;
      const palette = [
        B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.PLANKS, B.WALL_STONE, B.BRICK, B.GLASS, B.TORCH,
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
      name: activeSlot?.name || "World",
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
    if (activeSlot == null) return;
    saveSlot(activeSlot.slot, snapshot());
  }

  // ---- Block-event handlers (defined once; bound after world exists) ----
  function onBreak(kind, id, x, y, z, drop = true) {
    if (kind === "tree") {
      const res = trees.hitLog(x, y, z);
      if (res) {
        inv.add(B.WOOD, res.logs);
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
    if (drop) inv.add(id, 1);
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
      if (world.getBlock(x, y + 1, z) === B.DOOR_TOP) world.setBlock(x, y + 1, z, B.AIR);
      world.doors.delete(`${x},${y},${z}`);
    } else if (id === B.DOOR_TOP) {
      if (world.getBlock(x, y - 1, z) === B.DOOR) {
        world.setBlock(x, y - 1, z, B.AIR);
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
    if (def?.item) return; // don't place tools/items in the world
    if (!t) return;
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
    world.setBlock(px, py, pz, sel);
    if (sel === B.DOOR) world.setBlock(px, py + 1, pz, B.DOOR_TOP);
    inv.remove(sel, 1);
    hud.refresh();
  }
  function toggleDoorAt(x, y, z) {
    // `y` may be either half of the door — find the bottom.
    let by = y;
    if (world.getBlock(x, y, z) === B.DOOR_TOP) by = y - 1;
    if (world.getBlock(x, by, z) !== B.DOOR) return;
    world.toggleDoor(x, by, z);
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
    world = new World(scene, seed);
    player = new Player(camera, world);
    input = new Input(canvas);
    mining = new MiningController(world, scene, onBreak, () => inv?.selected());
    trees = new TreeSystem(world);
    mobs = new MobSystem(world, scene);
    inv = new Inventory();
    hud = new HUD(inv);
    hunger = 20;
    lastHungerTick = performance.now();
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
      if (v === B.TORCH) world.torches.add(k);
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
    input.requestLock();
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
    if (input.justPressed.has("KeyR") && !chestOpen) openNearestChest();
    if (input.justPressed.has("KeyF")) player.toggleFly();
    if (input.justPressed.has("Escape") && chestOpen) closeChest();
    if (input.justPressed.has("Escape") && tradeOpen) closeTrader();

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

    dayNight.update(dt);

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

    mobs.update(dt, player.pos);

    const nowMs = performance.now();
    if (!creativeMode && nowMs - lastHungerTick > 24000) {
      lastHungerTick = nowMs;
      hunger = Math.max(0, hunger - 0.25);
      hud.setHunger(hunger);
    }

    if (target) {
      const id = world.getBlock(target.x, target.y, target.z);
      hud.setTarget(BLOCKS[id]?.name || "");
    } else hud.setTarget(null);

    world.update(player.pos.x, player.pos.z);

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
