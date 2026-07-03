// Voxel raycast (DDA) + mining/placing logic + per-target mining progress.
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { B, BLOCKS, isSolid } from "../world/blocks.js";

export function raycastVoxel(world, origin, dir, maxDist) {
  // Amanatides & Woo DDA.
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  const fx = stepX > 0 ? (x + 1 - origin.x) : (origin.x - x);
  const fy = stepY > 0 ? (y + 1 - origin.y) : (origin.y - y);
  const fz = stepZ > 0 ? (z + 1 - origin.z) : (origin.z - z);
  let tMaxX = dir.x !== 0 ? tDeltaX * fx : Infinity;
  let tMaxY = dir.y !== 0 ? tDeltaY * fy : Infinity;
  let tMaxZ = dir.z !== 0 ? tDeltaZ * fz : Infinity;

  let face = null;
  let dist = 0;
  while (dist <= maxDist) {
    const b = world.getBlock(x, y, z);
    if (b !== B.AIR && !BLOCKS[b]?.liquid) {
      return { x, y, z, face, dist };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; dist = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY; dist = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0];
    } else {
      z += stepZ; dist = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ];
    }
  }
  return null;
}

// Mining state per current target.
export class MiningController {
  constructor(world, scene, onBreak) {
    this.world = world;
    this.scene = scene;
    this.onBreak = onBreak;
    this.progress = 0;
    this.targetKey = null;
    this.range = CONFIG.mining.range;
    this._wire = null;
  }
  _key(t) { return t ? `${t.x},${t.y},${t.z}` : null; }

  // Returns the current target block as {x,y,z,face} or null.
  acquire(player) {
    const o = player.eyePos();
    const d = player.lookDir();
    return raycastVoxel(this.world, o, d, this.range);
  }

  update(dt, player, miningDown, targetOverride = null) {
    const t = targetOverride ?? (miningDown ? this.acquire(player) : null);
    const k = this._key(t);
    if (!t) {
      this.progress = 0; this.targetKey = null; this._clearWire(); return null;
    }
    if (k !== this.targetKey) { this.progress = 0; this.targetKey = k; }
    const id = this.world.getBlock(t.x, t.y, t.z);
    const def = BLOCKS[id];
    if (!def || def.hardness === Infinity) { this._clearWire(); return t; }
    this.progress += dt;
    const time = def.hardness * CONFIG.mining.baseTime;
    if (this.progress >= time) {
      // Break it.
      if (def.treeHealth) {
        // Tree log: damage global tree health system via onBreak hook.
        const broken = this.onBreak?.("tree", id, t.x, t.y, t.z);
        if (!broken) { /* tree still alive; don't drop block, but visual stays */ }
      } else {
        this.onBreak?.("block", id, t.x, t.y, t.z);
      }
      this.progress = 0;
      this.targetKey = null;
    }
    this._drawWire(t);
    return t;
  }

  _drawWire(t) {
    if (!this._wire) {
      const geo = new THREE.BoxGeometry(1.02, 1.02, 1.02);
      const edges = new THREE.EdgesGeometry(geo);
      const mat = new THREE.LineBasicMaterial({ color: 0x000000 });
      this._wire = new THREE.LineSegments(edges, mat);
      this.scene.add(this._wire);
    }
    this._wire.visible = true;
    this._wire.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
  }
  _clearWire() { if (this._wire) this._wire.visible = false; }
}
