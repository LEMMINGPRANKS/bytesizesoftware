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
import {
  listSlots, loadSlot, saveSlot, deleteSlot, MAX_SLOTS,
} from "./save/saveManager.js";

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
        active: inv.active,
      },
      hunger,
      modified: Object.fromEntries(world.modified),
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
    hud.refresh();
    return true;
  }

  function placeBlock() {
    const sel = inv.selected();
    if (sel === null) return;
    const def = BLOCKS[sel];
    if (def?.food) { eat(sel); return; }
    if (def?.item) return; // don't place tools/items in the world
    const t = mining.acquire(player);
    if (!t) return;
    const px = t.x + t.face[0], py = t.y + t.face[1], pz = t.z + t.face[2];
    if (py < 0 || py >= CONFIG.world.chunkHeight) return;
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
      cow.hit(4, player.pos);
      if (wasAlive && !cow.alive) {
        const drop = 2 + (Math.random() * 2 | 0);
        inv.add(B.RAW_BEEF, drop);
        hud.refresh();
      }
    }
  }

  // ---- World list / start-screen wiring ----
  const startScreen = $("#start-screen");
  const craftPanel = $("#craft-panel");
  const resumeOverlay = $("#resume-overlay");
  const worldList = $("#world-list");
  const newWorldForm = $("#new-world-form");
  let gameStarted = false;
  let craftOpen = false;
  let pendingNewSlot = null;

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
        btns.append(play, del);
        row.append(btns);
      } else {
        row.classList.add("empty");
        row.innerHTML = `<div class="world-info"><div class="world-name">Slot ${i + 1} — Empty</div></div>`;
        const create = document.createElement("button");
        create.textContent = "Create";
        create.onclick = () => openNewWorldForm(i);
        const btns = document.createElement("div");
        btns.className = "world-btns";
        btns.append(create);
        row.append(btns);
      }
      worldList.append(row);
    }
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
      // Pre-seed the modified map before any chunk is generated so they
      // get applied lazily as chunks come into view.
      for (const [k, v] of Object.entries(saved.modified)) world.modified.set(k, v);
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
      inv.active = saved.inventory.active || 0;
      // Convert any serialised Infinity (JSON has no Infinity) back.
      for (const k of Object.keys(inv.items)) if (inv.items[k] === null) inv.items[k] = Infinity;
    } else {
      inv.add(B.PLANKS, 8);
    }

    if (saved && typeof saved.hunger === "number") hunger = saved.hunger;

    if (mode === "creative") applyMode("creative");

    world.update(player.pos.x, player.pos.z);
    hud.refresh();
    hud.setHunger(hunger);

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
    if (gameStarted && !locked && !craftOpen && startScreen.classList.contains("hidden")) {
      showResume();
    } else if (locked) {
      hideResume();
    }
  });
  resumeOverlay.addEventListener("click", () => input?.requestLock());

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
    if (input.justPressed.has("KeyE")) toggleCraft();
    if (input.justPressed.has("KeyF")) player.toggleFly();

    if (craftOpen) {
      refreshCraftIfOpen();
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

    if (input.mouseJust[0]) attack();
    const miningAim = !mobs.raycast(player.eyePos(), player.lookDir(), CONFIG.mining.range + 1);
    const target = mining.update(dt, player, input.mouseDown[0] && miningAim);
    if (input.mouseJust[2] || input.justPressed.has("KeyQ")) placeBlock();

    mobs.update(dt, player.pos);

    const nowMs = performance.now();
    if (!creativeMode && nowMs - lastHungerTick > 12000) {
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
