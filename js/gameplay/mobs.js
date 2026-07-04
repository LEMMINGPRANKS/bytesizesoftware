// Mob system: spawns/despawns cows on land + fish in water and updates them.
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { Cow } from "../entities/cow.js";
import { Fish } from "../entities/fish.js";
import { isSolid, isLiquid, B } from "../world/blocks.js";

export class MobSystem {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.mobs = [];
    this.targetCount = 8;
    this.fishTargetCount = 6;    // separate cap so cows can't starve fish
    this.spawnTimer = 0;
    this._aiAcc = 0;             // throttle AI updates for perf
  }
  _findSpawn(playerPos) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * 16;
      const x = Math.floor(playerPos.x + Math.cos(ang) * r);
      const z = Math.floor(playerPos.z + Math.sin(ang) * r);
      const y = this.world.surfaceHeight(x, z);
      if (y > 0 && y < 60) {
        if (isSolid(this.world.getBlock(x, y, z)) &&
            this.world.getBlock(x, y + 1, z) === B.AIR &&
            this.world.getBlock(x, y + 2, z) === B.AIR) {
          return new THREE.Vector3(x + 0.5, y + 1, z + 0.5);
        }
      }
    }
    return null;
  }
  _findWaterSpawn(playerPos) {
    // The old check required water AT y+1 (the cell above the fish) AND
    // y-1 to be non-air. At the surface (y = seaLevel), y+1 is air, so the
    // check failed at every surface cell — fish essentially never spawned.
    // Now we accept any submerged cell with solid ground below, scanning
    // a wider ring with more attempts.
    const sea = CONFIG.world.seaLevel;
    for (let attempt = 0; attempt < 14; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 22;
      const x = Math.floor(playerPos.x + Math.cos(ang) * r);
      const z = Math.floor(playerPos.z + Math.sin(ang) * r);
      for (let y = sea; y > 1; y--) {
        const here = this.world.getBlock(x, y, z);
        const below = this.world.getBlock(x, y - 1, z);
        if (here === B.WATER && below !== B.AIR && below !== B.WATER) {
          return new THREE.Vector3(x + 0.5, y, z + 0.5);
        }
      }
    }
    return null;
  }
  _fishCount() { return this.mobs.reduce((n, m) => n + (m.isFish ? 1 : 0), 0); }
  _cowCount() { return this.mobs.reduce((n, m) => n + (m.isFish ? 0 : 1), 0); }
  update(dt, playerPos) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.5 + Math.random() * 2.5;
      // Spawn fish and cows independently up to their own caps so a saturated
      // cow population doesn't block fish from ever appearing.
      if (this._fishCount() < this.fishTargetCount) {
        const s = this._findWaterSpawn(playerPos);
        if (s) { this.mobs.push(new Fish(s, this.scene, this.world)); return; }
      }
      if (this._cowCount() < this.targetCount) {
        const s = this._findSpawn(playerPos);
        if (s) this.mobs.push(new Cow(s, this.scene, this.world));
      }
    }
    // Throttle AI: only step physics every ~100ms. dt between is skipped.
    // Movement still looks smooth because mob speeds are slow.
    this._aiAcc += dt;
    const step = this._aiAcc >= 0.1;
    if (step) this._aiAcc = 0;
    const keep = [];
    for (const m of this.mobs) {
      const alive = step ? m.update(Math.min(dt, 0.1)) : (m.alive || m.deathT > 0);
      const tooFar = m.pos.distanceTo(playerPos) > 80;
      if (alive && !tooFar) keep.push(m);
      else m.remove();
    }
    this.mobs = keep;
  }
  raycast(origin, dir, maxDist) {
    let best = null, bestDist = maxDist;
    for (const m of this.mobs) {
      if (!m.alive) continue;
      const center = m.pos.clone();
      center.y += (m.height || 0.7) / 2;
      const toC = center.clone().sub(origin);
      const proj = toC.dot(dir);
      if (proj < 0 || proj > maxDist) continue;
      const closestPt = origin.clone().add(dir.clone().multiplyScalar(proj));
      const d = closestPt.distanceTo(center);
      const radius = m.isFish ? 0.5 : 0.7;
      if (d < radius && proj < bestDist) {
        best = m;
        bestDist = proj;
      }
    }
    return best;
  }
}
