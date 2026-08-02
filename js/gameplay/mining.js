// Voxel raycast (DDA) + mining/placing logic + per-target mining progress.
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { B, BLOCKS, isSolid } from "../world/blocks.js";
import { getCrackTexture } from "../world/textures.js";

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
  constructor(world, scene, onBreak, getSelectedItem) {
    this.world = world;
    this.scene = scene;
    this.onBreak = onBreak;
    this.getSelectedItem = getSelectedItem || (() => null);
    this.progress = 0;
    this.targetKey = null;
    this.range = CONFIG.mining.range;
    this._wire = null;
    this._crack = null;
    this._crackMat = null;
  }
  _key(t) { return t ? `${t.x},${t.y},${t.z}` : null; }
  // Current crack stage (0..9) — exposed so the SFX layer can pitch-shift
  // mining taps as the block weakens without peeking into private state.
  crackStage() { return this._lastStage || 0; }

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
    if (!def || def.hardness === Infinity) {
      this._drawWire(t); this._clearCrack(); return t;
    }
    if (miningDown) this.progress += dt;
    // Speed up if the selected item is a pickaxe of sufficient tier.
    const selected = this.getSelectedItem?.();
    const selDef = selected != null ? BLOCKS[selected] : null;
    // Shovel bonus: dirt/sand/grass/snow/moon_dust dig much faster with a
    // shovel. No tier gate on these blocks — any shovel works on any dirt.
    const softBlock = def.name === "dirt" || def.name === "sand" ||
                      def.name === "grass" || def.name === "snow" ||
                      def.name === "moon_dust";
    // Axe bonus: wood, planks, beams, wood walls, chests, doors, cactus,
    // kelp — any woody/plant block chops faster with an axe.
    const woodyBlock = def.name === "wood" || def.name === "planks" ||
                       def.name === "beam" || def.name === "wall_wood" ||
                       def.name === "chest" || def.name === "door" ||
                       def.name === "cactus" || def.name === "kelp" ||
                       def.name === "leaves" || def.name === "twig";
    const toolMul = selDef?.tool === "shovel" && softBlock
      ? 3.0
      : selDef?.tool === "axe" && woodyBlock
        ? 3.0
        : (selDef?.tool === "pickaxe" && selDef?.toolTier >= (def.toolTier || 0) ? 2.2 : 1.0);
    const time = def.hardness * CONFIG.mining.baseTime / toolMul;
    if (this.progress >= time) {
      // Tool-tier gate: can't break protected blocks without the right pickaxe.
      if ((def.toolTier || 0) > 0 && (selDef?.tool !== "pickaxe" || (selDef?.toolTier || 0) < def.toolTier)) {
        // Wrong tool: block doesn't drop, but the block does break visually.
        this.onBreak?.("block", id, t.x, t.y, t.z, /*drop=*/false);
      } else {
        this.onBreak?.("block", id, t.x, t.y, t.z, /*drop=*/true);
      }
      this.progress = 0;
      this.targetKey = null;
    }
    this._drawWire(t);
    this._drawCrack(t, time > 0 ? this.progress / time : 0);
    return t;
  }

  _drawWire(t) {
    if (!this._wire) {
      const geo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
      const edges = new THREE.EdgesGeometry(geo);
      const mat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 });
      this._wire = new THREE.LineSegments(edges, mat);
      this.scene.add(this._wire);
    }
    this._wire.visible = true;
    this._wire.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
  }
  _clearWire() { if (this._wire) this._wire.visible = false; }

  _drawCrack(t, frac) {
    if (!this._crack) {
      const geo = new THREE.BoxGeometry(1.01, 1.01, 1.01);
      this._crackMat = new THREE.MeshBasicMaterial({
        map: null, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      this._crack = new THREE.Mesh(geo, this._crackMat);
      this._crack.renderOrder = 2;
      this.scene.add(this._crack);
    }
    this._crack.visible = true;
    this._crack.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
    const stage = Math.floor(frac * 10);
    if (stage !== this._lastStage) {
      this._crackMat.map = getCrackTexture(stage);
      this._crackMat.needsUpdate = true;
      this._lastStage = stage;
    }
  }
  _clearCrack() { if (this._crack) this._crack.visible = false; }
}
