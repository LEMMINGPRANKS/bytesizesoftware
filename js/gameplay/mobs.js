// Mob system: spawns/despawns cows around the player and updates them.
import * as THREE from "three";
import { Cow } from "../entities/cow.js";
import { isSolid, B } from "../world/blocks.js";

export class MobSystem {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.mobs = [];
    this.targetCount = 8;
    this.spawnTimer = 0;
  }
  _findSpawn(playerPos) {
    // Pick a random surface block within 8–24 blocks of the player.
    for (let attempt = 0; attempt < 8; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * 16;
      const x = Math.floor(playerPos.x + Math.cos(ang) * r);
      const z = Math.floor(playerPos.z + Math.sin(ang) * r);
      const y = this.world.surfaceHeight(x, z);
      if (y > 0 && y < 60) {
        // Make sure spawn is on solid ground and air above.
        if (isSolid(this.world.getBlock(x, y, z)) &&
            this.world.getBlock(x, y + 1, z) === B.AIR &&
            this.world.getBlock(x, y + 2, z) === B.AIR) {
          return new THREE.Vector3(x + 0.5, y + 1, z + 0.5);
        }
      }
    }
    return null;
  }
  update(dt, playerPos) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.mobs.length < this.targetCount) {
      this.spawnTimer = 2 + Math.random() * 3;
      const spawn = this._findSpawn(playerPos);
      if (spawn) this.mobs.push(new Cow(spawn, this.scene, this.world));
    }
    // Update + cull
    const keep = [];
    for (const m of this.mobs) {
      const alive = m.update(dt);
      const tooFar = m.pos.distanceTo(playerPos) > 80;
      if (alive && !tooFar) keep.push(m);
      else m.remove();
    }
    this.mobs = keep;
  }
  // Returns the closest cow hit by a ray from origin/dir within maxDist, or null.
  raycast(origin, dir, maxDist) {
    let best = null, bestDist = maxDist;
    for (const m of this.mobs) {
      if (!m.alive) continue;
      const center = m.pos.clone();
      center.y += m.height / 2;
      const toC = center.clone().sub(origin);
      const proj = toC.dot(dir);
      if (proj < 0 || proj > maxDist) continue;
      const closestPt = origin.clone().add(dir.clone().multiplyScalar(proj));
      const d = closestPt.distanceTo(center);
      if (d < 0.7 && proj < bestDist) {
        best = m;
        bestDist = proj;
      }
    }
    return best;
  }
}
