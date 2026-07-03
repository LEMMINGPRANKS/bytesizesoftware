// World manager: owns chunks, generation, block get/set across boundaries,
// and per-frame chunk streaming around the player.
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { generateChunk } from "./worldgen.js";
import { Noise } from "./noise.js";
import { Chunk, CHUNK_SIZE } from "./chunk.js";
import { buildChunkMesh } from "./mesher.js";
import { B } from "./blocks.js";

export class World {
  constructor(scene, seed = (Math.random() * 1e9) | 0) {
    this.scene = scene;
    this.seed = seed;
    this.noise = new Noise(seed);
    this.chunks = new Map(); // `${cx},${cz}` -> Chunk
    this.group = new THREE.Group();
    scene.add(this.group);
    this.treesHealth = new Map(); // `${wx},${wy},${wz}` -> hp
  }
  key(cx, cz) { return `${cx},${cz}`; }

  getChunk(cx, cz) { return this.chunks.get(this.key(cx, cz)); }

  ensureChunk(cx, cz) {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = generateChunk(cx, cz, this.noise);
      this.chunks.set(k, c);
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
    c.set(lx, wy, lz, v);
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
    // Ensure chunks exist
    for (let dx = -R; dx <= R; dx++)
      for (let dz = -R; dz <= R; dz++) {
        this.ensureChunk(pcx + dx, pcz + dz);
      }
    // Build dirty chunk meshes (limit per frame to avoid hitches).
    let budget = 3;
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
