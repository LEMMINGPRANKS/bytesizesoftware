// World manager: owns chunks, generation, block get/set across boundaries,
// and per-frame chunk streaming around the player.
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { generateChunk } from "./worldgen.js";
import { Noise } from "./noise.js";
import { Chunk, CHUNK_SIZE } from "./chunk.js";
import { buildChunkMesh } from "./mesher.js";
import { B, BLOCKS } from "./blocks.js";

// Trade pool: each entry is {id, count, cost}. Traders roll a small random
// selection from this list. Costs are in gold-coin units (player pays with
// GOLD_BLOCK items, which are 9 ore → fair-priced for early-game access).
const TRADE_POOL = [
  { id: B.RAW_BEEF,     count: 2, cost: 1 },
  { id: B.RAW_FISH,     count: 3, cost: 1 },
  { id: B.COOKED_BEEF,  count: 1, cost: 2 },
  { id: B.COOKED_FISH,  count: 2, cost: 2 },
  { id: B.TORCH,        count: 8, cost: 1 },
  { id: B.PLANKS,       count: 16, cost: 1 },
  { id: B.BRICK,        count: 8, cost: 2 },
  { id: B.GLASS,        count: 6, cost: 2 },
  { id: B.PICKAXE_IRON, count: 1, cost: 3 },
  { id: B.PICKAXE_DIAMOND, count: 1, cost: 6 },
  { id: B.CHEST,        count: 1, cost: 2 },
  { id: B.DOOR,         count: 2, cost: 1 },
  { id: B.IRON_BLOCK,   count: 1, cost: 4 },
  { id: B.GOLD_BLOCK,   count: 1, cost: 5 },
];
function makeTraderOffers() {
  // Pick 5 distinct items from the pool, copying so callers can mutate counts.
  const pool = TRADE_POOL.slice();
  const offers = [];
  for (let i = 0; i < 5 && pool.length; i++) {
    const idx = (Math.random() * pool.length) | 0;
    const o = pool.splice(idx, 1)[0];
    offers.push({ id: o.id, count: o.count, cost: o.cost });
  }
  return offers;
}

export class World {
  constructor(scene, seed = (Math.random() * 1e9) | 0) {
    this.scene = scene;
    this.seed = seed;
    this.noise = new Noise(seed);
    this.chunks = new Map(); // `${cx},${cz}` -> Chunk
    this.group = new THREE.Group();
    scene.add(this.group);
    this.treesHealth = new Map(); // `${wx},${wy},${wz}` -> hp
    this.modified = new Map();   // `${wx},${wy},${wz}` -> blockId (player edits)
    this.chests = new Map();     // `${wx},${wy},${wz}` -> Array(27) of slot ids or null
    this.doors = new Set();      // `${bx},${by},${bz}` (bottom block) of open doors
    this.torches = new Set();    // `${wx},${wy},${wz}` of placed torches
    this.traders = new Map();    // `${wx},${wy},${wz}` -> [{id, count, cost}, ...]
  }
  static modKey(x, y, z) { return `${x},${y},${z}`; }
  // 27-slot chest inventory at a position, created lazily.
  getChest(x, y, z) {
    const k = World.modKey(x, y, z);
    let c = this.chests.get(k);
    if (!c) { c = new Array(27).fill(null); this.chests.set(k, c); }
    return c;
  }
  removeChest(x, y, z) { this.chests.delete(World.modKey(x, y, z)); }
  // Per-position trader inventory. A trader is a block with a small set of
  // trade offers generated when the structure is built. Returns the offers
  // array, creating it lazily so legacy saves without trader data work too.
  getTrader(x, y, z) {
    const k = World.modKey(x, y, z);
    let t = this.traders.get(k);
    if (!t) { t = makeTraderOffers(); this.traders.set(k, t); }
    return t;
  }
  removeTrader(x, y, z) { this.traders.delete(World.modKey(x, y, z)); }
  // Door open/closed state. `bx,by,bz` is the BOTTOM block of the door.
  isDoorOpen(bx, by, bz) { return this.doors.has(`${bx},${by},${bz}`); }
  toggleDoor(bx, by, bz) {
    const k = `${bx},${by},${bz}`;
    if (this.doors.has(k)) this.doors.delete(k);
    else this.doors.add(k);
  }
  key(cx, cz) { return `${cx},${cz}`; }

  getChunk(cx, cz) { return this.chunks.get(this.key(cx, cz)); }

  ensureChunk(cx, cz) {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = generateChunk(cx, cz, this.noise, this);
      this.chunks.set(k, c);
      // Replay any player edits that land inside this chunk.
      if (this.modified.size) {
        const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
        const x1 = x0 + CHUNK_SIZE - 1, z1 = z0 + CHUNK_SIZE - 1;
        for (const [key, v] of this.modified) {
          const parts = key.split(",");
          const wx = +parts[0], wy = +parts[1], wz = +parts[2];
          if (wx < x0 || wx > x1 || wz < z0 || wz > z1) continue;
          if (wy < 0 || wy >= CONFIG.world.chunkHeight) continue;
          c.set(wx - x0, wy, wz - z0, v);
        }
      }
      // Register any light-emitting blocks the worldgen placed (trader-stall
      // torches, etc.) so the PointLight pool can find them. Player edits go
      // through setBlock which keeps this set in sync afterwards.
      const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
      for (let y = 0; y < CONFIG.world.chunkHeight; y++) {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const id = c.get(lx, y, lz);
            if (id !== B.AIR && BLOCKS[id] && BLOCKS[id].light) {
              this.torches.add(World.modKey(x0 + lx, y, z0 + lz));
            }
          }
        }
      }
    }
    return c;
  }

  getBlock(wx, wy, wz) {
    if (wy < 0 || wy >= CONFIG.world.chunkHeight) return B.AIR;
    const cx = Math.floor(wx / CHUNK_SIZE), cz = Math.floor(wz / CHUNK_SIZE);
    const c = this.getChunk(cx, cz);
    if (!c) return B.AIR;
    const lx = wx - cx * CHUNK_SIZE, lz = wz - cz * CHUNK_SIZE;
    return c.get(lx, wy, lz);
  }

  setBlock(wx, wy, wz, v) {
    if (wy < 0 || wy >= CONFIG.world.chunkHeight) return;
    const cx = Math.floor(wx / CHUNK_SIZE), cz = Math.floor(wz / CHUNK_SIZE);
    const c = this.ensureChunk(cx, cz);
    const lx = wx - cx * CHUNK_SIZE, lz = wz - cz * CHUNK_SIZE;
    const k = World.modKey(wx, wy, wz);
    // Keep the torch index in sync with player edits so the light pool can
    // find them quickly without scanning the whole modified map each frame.
    const emits = v !== B.AIR && BLOCKS[v] && BLOCKS[v].light;
    if (emits) this.torches.add(k);
    else if (this.torches.has(k)) this.torches.delete(k);
    c.set(lx, wy, lz, v);
    this.modified.set(k, v);
    // mark neighbours dirty if on border
    if (lx === 0) { const n = this.getChunk(cx - 1, cz); if (n) n.dirty = true; }
    if (lx === CHUNK_SIZE - 1) { const n = this.getChunk(cx + 1, cz); if (n) n.dirty = true; }
    if (lz === 0) { const n = this.getChunk(cx, cz - 1); if (n) n.dirty = true; }
    if (lz === CHUNK_SIZE - 1) { const n = this.getChunk(cx, cz + 1); if (n) n.dirty = true; }
  }

  // Update which chunks exist & are meshed around player position.
  update(px, pz) {
    const pcx = Math.floor(px / CHUNK_SIZE), pcz = Math.floor(pz / CHUNK_SIZE);
    const R = CONFIG.world.renderDistance;
    // Ensure chunks exist — but cap generation to 1 per frame to avoid FPS spikes.
    // Priority: closest first.
    let genBudget = 1;
    for (let radius = 0; radius <= R && genBudget > 0; radius++) {
      for (let dx = -radius; dx <= radius && genBudget > 0; dx++) {
        for (let dz = -radius; dz <= radius && genBudget > 0; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const k = this.key(pcx + dx, pcz + dz);
          if (!this.chunks.has(k)) {
            this.ensureChunk(pcx + dx, pcz + dz);
            genBudget--;
          }
        }
      }
    }
    // Build dirty chunk meshes (limit per frame to avoid hitches).
    let budget = 2;
    for (let dx = -R; dx <= R && budget > 0; dx++) {
      for (let dz = -R; dz <= R && budget > 0; dz++) {
        const c = this.getChunk(pcx + dx, pcz + dz);
        if (c && c.dirty) { buildChunkMesh(c, this); budget--; }
      }
    }
    // Unload distant chunks
    for (const [k, c] of this.chunks) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (Math.max(Math.abs(dx), Math.abs(dz)) > R + 1) {
        if (c.mesh) { this.group.remove(c.mesh); c.mesh.traverse(o => o.geometry?.dispose?.()); }
        if (c.transparentMesh) { this.group.remove(c.transparentMesh); c.transparentMesh.traverse(o => o.geometry?.dispose?.()); }
        this.chunks.delete(k);
      }
    }
  }

  // Highest non-air, non-liquid block at column.
  surfaceHeight(wx, wz) {
    for (let y = CONFIG.world.chunkHeight - 1; y >= 0; y--) {
      const b = this.getBlock(wx, y, wz);
      if (b !== B.AIR && b !== B.WATER && b !== B.LEAVES) return y;
    }
    return 0;
  }
}
