// Fish: small aquatic mob that swims in water. Drops RAW_FISH when killed.
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { isSolid, isLiquid, B } from "../world/blocks.js";

function box(w, h, d, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.MeshLambertMaterial({ color });
  return new THREE.Mesh(g, m);
}

export class Fish {
  constructor(pos, scene, world) {
    this.world = world;
    this.scene = scene;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.health = 4;
    this.hitFlash = 0;
    this.state = "swim";
    this.stateT = 1 + Math.random() * 3;
    this.width = 0.4;
    this.height = 0.3;
    this.alive = true;
    this.deathT = 0;
    this.isFish = true; // tag for drop logic

    this.group = new THREE.Group();
    const body = 0x3a78a8, belly = 0xc8d8e0;
    const b = box(0.55, 0.28, 0.18, body);
    b.position.y = 0.14; this.group.add(b);
    const bel = box(0.5, 0.12, 0.16, belly);
    bel.position.y = 0.08; this.group.add(bel);
    const tail = box(0.08, 0.18, 0.04, body);
    tail.position.set(-0.32, 0.14, 0); this.group.add(tail);
    this.tail = tail;
    const eye = box(0.04, 0.04, 0.04, 0x111111);
    eye.position.set(0.22, 0.22, 0.09); this.group.add(eye);

    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  hit(dmg) {
    if (!this.alive) return;
    this.health -= dmg;
    this.hitFlash = 0.15;
    if (this.health <= 0) { this.alive = false; this.deathT = 0.8; }
  }

  update(dt) {
    if (!this.alive) {
      this.deathT -= dt;
      this.group.rotation.z = Math.min(Math.PI / 2, this.group.rotation.z + dt * 4);
      this.group.position.y -= dt * 0.3;
      return this.deathT > 0;
    }
    this.stateT -= dt;
    if (this.stateT <= 0) {
      const r = Math.random();
      this.yaw = Math.random() * Math.PI * 2;
      this.state = r < 0.3 ? "idle" : "swim";
      this.stateT = 1.5 + Math.random() * 3;
    }
    const speed = this.state === "swim" ? 1.6 : 0.0;
    const dir = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    this.vel.x = dir.x * speed;
    this.vel.z = dir.z * speed;

    // Gentle vertical bob — fish tries to stay submerged.
    const headBlock = this.world.getBlock(
      Math.floor(this.pos.x), Math.floor(this.pos.y + 0.3), Math.floor(this.pos.z)
    );
    if (!isLiquid(headBlock)) this.vel.y -= 6 * dt;          // sink if out of water
    else this.vel.y += (Math.sin(performance.now() * 0.003) * 0.4 - this.vel.y) * 0.05;

    const nx = this.pos.x + this.vel.x * dt;
    const ny = this.pos.y + this.vel.y * dt;
    const nz = this.pos.z + this.vel.z * dt;
    // Simple solid-block collision.
    if (!isSolid(this.world.getBlock(Math.floor(nx), Math.floor(this.pos.y), Math.floor(this.pos.z)))) {
      this.pos.x = nx;
    } else { this.yaw = -this.yaw; }
    if (!isSolid(this.world.getBlock(Math.floor(this.pos.x), Math.floor(ny), Math.floor(this.pos.z)))) {
      this.pos.y = ny;
    }
    if (!isSolid(this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(nz)))) {
      this.pos.z = nz;
    } else { this.yaw = -this.yaw; }

    // Fish out of water for too long despawns.
    if (this.pos.y < -5) return false;
    if (!isLiquid(this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z)))) {
      this._airTime = (this._airTime || 0) + dt;
      if (this._airTime > 6) return false;
    } else this._airTime = 0;

    this.group.position.copy(this.pos);
    this.group.rotation.y = -this.yaw + Math.PI / 2;
    if (this.tail) this.tail.rotation.y = Math.sin(performance.now() * 0.012) * 0.4;
    // Hit flash: tint body red briefly when hurt.
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    const flashing = this.hitFlash > 0;
    this.group.traverse(o => {
      if (o.material && o.material.emissive !== undefined && !o.material.isMeshBasicMaterial) {
        o.material.emissive.setHex(flashing ? 0x551010 : 0x000000);
      }
    });
    return true;
  }

  remove() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
