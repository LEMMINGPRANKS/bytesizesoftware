// Skeleton — fast hostile enemy. Bone-white, brittle. Drops BONE on death.
// Melee for now (a future release can add bow-and-arrow projectiles).
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { isSolid } from "../world/blocks.js";

function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

// Procedural bone texture: off-white with hairline cracks + a couple of
// grey pits. Cached for all skeletons to share.
let boneCache = null;
function boneTexture() {
  if (boneCache) return boneCache;
  const S = 32;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#e8e0c8";
  ctx.fillRect(0, 0, S, S);
  let a = 33792 | 0;
  const rng = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Subtle shading patches.
  ctx.fillStyle = "rgba(180,170,140,0.5)";
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(rng() * S, rng() * S, 3 + rng() * 4, 3 + rng() * 4);
  }
  // Hairline cracks.
  ctx.strokeStyle = "rgba(80,70,50,0.6)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(rng() * S, rng() * S);
    ctx.lineTo(rng() * S, rng() * S);
    ctx.stroke();
  }
  // A few dark pits.
  ctx.fillStyle = "#5a503a";
  for (let i = 0; i < 4; i++) ctx.fillRect(rng() * S, rng() * S, 1, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  boneCache = tex;
  return boneCache;
}

export class Skeleton {
  constructor(pos, scene, world) {
    this.world = world;
    this.scene = scene;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.health = 12;
    this.maxHealth = 12;
    this.width = 0.55;
    this.height = 1.85;
    this.onGround = false;
    this.alive = true;
    this.deathT = 0;
    this.attackCooldown = 0;
    this.stunned = 0;
    this.hitFlash = 0;
    this.isHostile = true;
    this.isFish = false;
    this._swingT = 0;

    this.group = new THREE.Group();
    const boneMat = new THREE.MeshLambertMaterial({ map: boneTexture() });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x303040 });

    // Ribcage torso: thin slab.
    const body = box(0.5, 0.85, 0.28, boneMat);
    body.position.set(0, 1.15, 0);
    body.castShadow = true;
    this.group.add(body);

    // Head: bare skull, slightly forward-tilted.
    const head = box(0.45, 0.45, 0.45, boneMat);
    head.position.set(0, 1.85, 0.02);
    head.castShadow = true;
    this.group.add(head);

    // Eye sockets — empty black holes.
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const e1 = box(0.1, 0.12, 0.04, eyeMat); e1.position.set(-0.11, 1.88, 0.24); this.group.add(e1);
    const e2 = box(0.1, 0.12, 0.04, eyeMat); e2.position.set(0.11, 1.88, 0.24); this.group.add(e2);

    // Arms — thin bone sticks.
    this.armL = box(0.14, 0.75, 0.14, boneMat);
    this.armL.position.set(-0.32, 1.45, 0);
    this.armL.userData.baseRotX = 0;
    this.group.add(this.armL);
    this.armR = box(0.14, 0.75, 0.14, boneMat);
    this.armR.position.set(0.32, 1.45, 0);
    this.armR.userData.baseRotX = 0;
    this.group.add(this.armR);

    // Legs — narrow.
    this.legL = box(0.18, 0.85, 0.18, darkMat); this.legL.position.set(-0.13, 0.42, 0); this.legL.userData.baseY = 0.42; this.group.add(this.legL);
    this.legR = box(0.18, 0.85, 0.18, darkMat); this.legR.position.set(0.13, 0.42, 0); this.legR.userData.baseY = 0.42; this.group.add(this.legR);

    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  _collides(wx, wy, wz) {
    const w = this.width / 2;
    const x0 = Math.floor(wx - w), x1 = Math.floor(wx + w);
    const y0 = Math.floor(wy), y1 = Math.floor(wy + this.height - 0.01);
    const z0 = Math.floor(wz - w), z1 = Math.floor(wz + w);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          if (isSolid(this.world.getBlock(x, y, z))) return true;
    return false;
  }

  hit(dmg, fromPos) {
    if (!this.alive) return;
    this.health -= dmg;
    this.stunned = 0.18;
    this.hitFlash = 0.15;
    const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z;
    const len = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / len) * 5;
    this.vel.z += (dz / len) * 5;
    if (this.health <= 0) this._die();
  }

  _die() {
    this.alive = false;
    this.deathT = 0.9;
  }

  update(dt, playerPos) {
    if (!this.alive) {
      this.deathT -= dt;
      // Skeletons shatter — tip + drop fast.
      this.group.rotation.z = Math.min(Math.PI / 2, this.group.rotation.z + dt * 3);
      this.group.position.y -= dt * 0.7;
      return this.deathT > 0;
    }

    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.stunned = Math.max(0, this.stunned - dt);

    // AI: fast strafing pursuit. Skeletons are quicker than zombies and
    // back off slightly when too close (so they don't stack on the player).
    if (playerPos && this.stunned <= 0) {
      const dx = playerPos.x - this.pos.x;
      const dz = playerPos.z - this.pos.z;
      const distSq = dx * dx + dz * dz;
      this.yaw = Math.atan2(dx, dz);
      const len = Math.sqrt(distSq) || 1;
      let speed = 2.6;
      let dir = 1;
      if (distSq < 1.8) dir = -0.4; // back off a hair
      if (distSq > 1.6) {
        this.vel.x = (dx / len) * speed * dir;
        this.vel.z = (dz / len) * speed * dir;
      } else {
        this.vel.x *= 0.6; this.vel.z *= 0.6;
        if (this.attackCooldown <= 0) {
          this.attackCooldown = 0.85;
          if (this.world._hostileAttackCallback) this.world._hostileAttackCallback(3);
          this._swingT = 0.3;
        }
      }
    }

    this.vel.y -= CONFIG.player.gravity * dt;
    if (this.vel.y < -30) this.vel.y = -30;

    if (this.onGround && (Math.abs(this.vel.x) > 0.1 || Math.abs(this.vel.z) > 0.1)) {
      const fx = Math.floor(this.pos.x + Math.sign(this.vel.x) * 0.4);
      const fz = Math.floor(this.pos.z + Math.sign(this.vel.z) * 0.4);
      if (isSolid(this.world.getBlock(fx, Math.floor(this.pos.y), fz))) {
        this.vel.y = 7;
      }
    }

    let nx = this.pos.x + this.vel.x * dt;
    let ny = this.pos.y + this.vel.y * dt;
    let nz = this.pos.z + this.vel.z * dt;
    this.onGround = false;
    if (!this._collides(nx, this.pos.y, this.pos.z)) this.pos.x = nx;
    else this.vel.x = 0;
    if (!this._collides(this.pos.x, ny, this.pos.z)) {
      this.pos.y = ny;
    } else {
      if (this.vel.y < 0) this.onGround = true;
      this.vel.y = 0;
    }
    if (!this._collides(this.pos.x, this.pos.y, nz)) this.pos.z = nz;
    else this.vel.z = 0;

    if (this.pos.y < -10) return false;

    this.vel.x *= 0.84;
    this.vel.z *= 0.84;

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;

    // Sprinty leg pump.
    if (Math.abs(this.vel.x) > 0.05 || Math.abs(this.vel.z) > 0.05) {
      const t = performance.now() * 0.012;
      this.legL.position.y = this.legL.userData.baseY + Math.sin(t) * 0.1;
      this.legR.position.y = this.legR.userData.baseY + Math.sin(t + Math.PI) * 0.1;
    }

    if (this._swingT > 0) {
      this._swingT -= dt;
      const phase = 1 - this._swingT / 0.3;
      const s = Math.sin(phase * Math.PI);
      this.armR.rotation.x = -s * 1.4;
    } else {
      this.armR.rotation.x *= 0.8;
    }

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
    });
  }
}
