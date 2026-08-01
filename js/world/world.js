// World manager: owns chunks, generation, block get/set across boundaries,
// and per-frame chunk streaming around the player.
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { generateChunk, generateMoonChunk } from "./worldgen.js";
import { Noise } from "./noise.js";
import { Chunk, CHUNK_SIZE } from "./chunk.js";
import { buildChunkMesh } from "./mesher.js";
import { B, BLOCKS } from "./blocks.js";
import { tryLightPortal, tryExtinguishPortal } from "./portal.js";

// Max interior height for a portal — used when scanning for broken frames.
const INTERIOR_H_MAX = 3;

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
    // Moon has its own noise field derived from a different seed so the
    // terrain doesn't rhyme with the overworld's — no shared hills/valleys
    // between dimensions despite using the same Noise class.
    this.moonNoise = new Noise((seed ^ 0x5f5f5f) | 0);
    this.dimension = "overworld";
    this.chunks = new Map(); // `${cx},${cz}` -> Chunk
    this.group = new THREE.Group();
    scene.add(this.group);
    this.treesHealth = new Map(); // `${wx},${wy},${wz}` -> hp
    this.modified = new Map();   // `${wx},${wy},${wz}` -> blockId (player edits)
    this.chests = new Map();     // `${wx},${wy},${wz}` -> Array(27) of slot ids or null
    this.doors = new Set();      // `${bx},${by},${bz}` (bottom block) of open doors
    this.torches = new Set();    // `${wx},${wy},${wz}` of placed torches
    this.traders = new Map();    // `${wx},${wy},${wz}` -> [{id, count, cost}, ...]
    // Liquid sim: activeLiquids is the queue of cells to (re)evaluate;
    // liquidLevels stores the flow distance from a source (0 = source).
    this.activeLiquids = new Set();
    this.liquidLevels = new Map();
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
      c = this.dimension === "moon"
        ? generateMoonChunk(cx, cz, this.moonNoise)
        : generateChunk(cx, cz, this.noise, this);
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
  // Internal: read a block without the early-return for chunkHeight, used by
  // the liquid sim so it can probe just below y=0 safely.
  _blockAt(wx, wy, wz) {
    if (wy < 0) return B.BEDROCK; // treat below-world as solid so liquids don't drain out the bottom
    return this.getBlock(wx, wy, wz);
  }

  setBlock(wx, wy, wz, v) {
    if (wy < 0 || wy >= CONFIG.world.chunkHeight) return;
    const cx = Math.floor(wx / CHUNK_SIZE), cz = Math.floor(wz / CHUNK_SIZE);
    const c = this.ensureChunk(cx, cz);
    const lx = wx - cx * CHUNK_SIZE, lz = wz - cz * CHUNK_SIZE;
    const k = World.modKey(wx, wy, wz);
    const prev = c.get(lx, wy, lz);
    // Queue liquid-spread checks for any adjacent liquid blocks whenever a
    // cell changes — covers "break block next to water" and "place block in
    // ocean" without needing the caller to know about fluid sim.
    if (prev !== v) {
      const NB = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
      for (const [dx, dy, dz] of NB) {
        const nb = this._blockAt(wx + dx, wy + dy, wz + dz);
        if (nb === B.WATER || nb === B.LAVA) {
          this.activeLiquids.add(`${wx+dx},${wy+dy},${wz+dz}`);
        }
      }
      // If we just removed a flowing-liquid block, re-check its supporters.
      if (prev === B.WATER || prev === B.LAVA) {
        this.activeLiquids.add(`${wx},${wy},${wz}`);
        this.liquidLevels.delete(k);
      }
    }
    // Keep the torch index in sync with player edits so the light pool can
    // find them quickly without scanning the whole modified map each frame.
    const emits = v !== B.AIR && BLOCKS[v] && BLOCKS[v].light;
    if (emits) this.torches.add(k);
    else if (this.torches.has(k)) this.torches.delete(k);
    c.set(lx, wy, lz, v);
    this.modified.set(k, v);
    // Portal hooks: placing LAVA inside a platinum frame lights the portal;
    // breaking a frame block extinguishes any portal that depended on it.
    if (v === B.LAVA) {
      if (tryLightPortal(this, wx, wy, wz)) {
        // Portal fill dirties the chunk for us; just flag neighbours below.
      }
    }
    if (prev === B.PLATINUM_BLOCK && v !== B.PLATINUM_BLOCK) {
      // Search the 3×3 neighbourhood for any PORTAL block whose frame is now
      // broken and extinguish it.
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -INTERIOR_H_MAX; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            if (this.getBlock(wx + dx, wy + dy, wz + dz) === B.PORTAL) {
              tryExtinguishPortal(this, wx + dx, wy + dy, wz + dz);
            }
          }
    }
    // mark neighbours dirty if on border
    if (lx === 0) { const n = this.getChunk(cx - 1, cz); if (n) n.dirty = true; }
    if (lx === CHUNK_SIZE - 1) { const n = this.getChunk(cx + 1, cz); if (n) n.dirty = true; }
    if (lz === 0) { const n = this.getChunk(cx, cz - 1); if (n) n.dirty = true; }
    if (lz === CHUNK_SIZE - 1) { const n = this.getChunk(cx, cz + 1); if (n) n.dirty = true; }
  }

  // Process the liquid-sim queue. Throttled by budget per call so a sudden
  // flood (e.g. breaking a sea wall) doesn't lock the frame. Rules:
  //   * Source (level 0) = generated ocean/lake water OR formed by 2+ horizontal
  //     source neighbours (infinite-source trick).
  //   * Liquid flows down forever (falling water creates source below if the
  //     cell above is a source, else flowing water with level+1).
  //   * Horizontal spread: flowing water at level N spreads to side air as
  //     level N+1. Capped at MAX_LEVEL.
  //   * Removing a liquid's support causes downstream blocks to dry up.
  tickLiquids() {
    if (this.activeLiquids.size === 0) return;
    const MAX_LEVEL = 7;
    let budget = 24;
    const next = new Set();
    // Snapshot so setBlock mutations during the loop don't perturb iteration.
    const queue = Array.from(this.activeLiquids);
    this.activeLiquids.clear();
    for (const key of queue) {
      if (budget-- <= 0) { next.add(key); continue; }
      const [x, y, z] = key.split(",").map(Number);
      const id = this._blockAt(x, y, z);
      if (id !== B.WATER && id !== B.LAVA) {
        // Block is no longer liquid — cascade: recheck neighbours which may
        // have been relying on it as a source.
        for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
          const nb = this._blockAt(x+dx, y+dy, z+dz);
          if (nb === B.WATER || nb === B.LAVA) next.add(`${x+dx},${y+dy},${z+dz}`);
        }
        continue;
      }
      const k = World.modKey(x, y, z);
      const isLava = id === B.LAVA;
      // Determine current level
      let level = this.liquidLevels.has(k) ? this.liquidLevels.get(k) : 0;
      // Source check: count horizontal+below source neighbours.
      const below = this._blockAt(x, y - 1, z);
      const isBelowSolid = below !== B.AIR && below !== B.WATER && below !== B.LAVA;
      // Source if: this is a generated lake block (level undefined and has
      // water on at least 2 horizontal sides or solid below + water above),
      // OR it has 2+ horizontal source neighbours (infinite-source).
      let horizSources = 0;
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nk = World.modKey(x+dx, y, z+dz);
        const nb = this._blockAt(x+dx, y, z+dz);
        if (nb === id && !this.liquidLevels.has(nk)) horizSources++;
      }
      if (level !== 0 && horizSources >= 2) {
        // Promote to source — infinite water-source rule.
        this.liquidLevels.delete(k);
        level = 0;
      }
      const isSource = level === 0;
      // Flow down.
      if (below === B.AIR) {
        this.setBlock(x, y - 1, z, id);
        if (!isSource) this.liquidLevels.set(World.modKey(x, y - 1, z), level + 1);
        next.add(`${x},${y - 1},${z}`);
      }
      // Flow sideways (only sources or first-level flow spreads horizontally
      // — this matches roughly how Minecraft throttles spread).
      if (isSource || level < MAX_LEVEL) {
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const sx = x + dx, sz = z + dz;
          const side = this._blockAt(sx, y, sz);
          if (side === B.AIR) {
            this.setBlock(sx, y, sz, id);
            this.liquidLevels.set(World.modKey(sx, y, sz), isSource ? 1 : level + 1);
            next.add(`${sx},${y},${sz}`);
          } else if (side === id) {
            // Refresh neighbour so it can re-evaluate its own level.
            next.add(`${sx},${y},${sz}`);
          }
        }
      }
      // Lava is sluggish — only process half as often (caller throttles).
    }
    // Merge anything setBlock queued during this pass into the next round.
    for (const k of this.activeLiquids) next.add(k);
    this.activeLiquids = next;
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

  // Switch dimension and tear down every loaded chunk so they regenerate
  // from the new worldgen function on next ensureChunk. Player-modified
  // blocks (this.modified) are preserved so builds survive the trip; chest
  // contents, door state, etc. are kept too.
  switchDimension(dim) {
    this.dimension = dim;
    for (const [, c] of this.chunks) {
      if (c.mesh) { this.group.remove(c.mesh); c.mesh.traverse(o => o.geometry?.dispose?.()); }
      if (c.transparentMesh) { this.group.remove(c.transparentMesh); c.transparentMesh.traverse(o => o.geometry?.dispose?.()); }
    }
    this.chunks.clear();
    this.activeLiquids.clear();
    this.liquidLevels.clear();
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
