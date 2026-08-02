// Zombie — hostile melee enemy. Slow shamble, attacks on contact.
// Drops ROTTEN_FLESH on death. Skin is sickly green; tunic is torn purple.
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { isSolid } from "../world/blocks.js";

function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

// Procedural zombie-skin texture: mottled green with darker splotches + a
// few stitches. Cached so every zombie shares one GPU texture.
let skinCache = null, tunicCache = null;
function makeTex(palette, seed) {
  const S = 32;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");
  ctx.fillStyle = palette[0];
  ctx.fillRect(0, 0, S, S);
  let a = seed | 0;
  const rng = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Mottle
  for (let i = 0; i < 22; i++) {
    ctx.fillStyle = palette[1 + ((rng() * (palette.length - 1)) | 0)];
    const x = rng() * S, y = rng() * S;
    const w = 2 + rng() * 5, h = 2 + rng() * 5;
    ctx.fillRect(x, y, w, h);
  }
  // Stitching: thin dark lines crossing the surface.
  ctx.strokeStyle = palette[palette.length - 1];
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(rng() * S, rng() * S);
    ctx.lineTo(rng() * S, rng() * S);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}
function skinTexture() {
  if (!skinCache) skinCache = makeTex(["#5a7a4a", "#3a5a32", "#7a9a5a", "#2a3a20"], 4242);
  return skinCache;
}
function tunicTexture() {
  if (!tunicCache) tunicCache = makeTex(["#3a2848", "#241830", "#4a3858", "#180818"], 99);
  return tunicCache;
}

export class Zombie {
  constructor(pos, scene, world) {
    this.world = world;
    this.scene = scene;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.health = 15;
    this.maxHealth = 15;
    this.width = 0.6;
    this.height = 1.8;
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
    const skinMat = new THREE.MeshLambertMaterial({ map: skinTexture() });
    const tunicMat = new THREE.MeshLambertMaterial({ map: tunicTexture() });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x202018 });

    // Torso: tunic-covered block.
    const body = box(0.6, 0.9, 0.3, tunicMat);
    body.position.set(0, 1.15, 0);
    body.castShadow = true;
    this.group.add(body);

    // Head: green skin, slightly oversized.
    const head = box(0.5, 0.5, 0.5, skinMat);
    head.position.set(0, 1.85, 0);
    head.castShadow = true;
    this.group.add(head);

    // Eyes — small dark sockets glowing red (zombie infection).
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    const e1 = box(0.1, 0.1, 0.04, eyeMat); e1.position.set(-0.13, 1.88, 0.26); this.group.add(e1);
    const e2 = box(0.1, 0.1, 0.04, eyeMat); e2.position.set(0.13, 1.88, 0.26); this.group.add(e2);

    // Arms — outstretched classic zombie pose (rotated forward at shoulders).
    this.armL = box(0.18, 0.8, 0.18, skinMat);
    this.armL.position.set(-0.42, 1.5, 0.2);
    this.armL.rotation.x = -Math.PI / 2.3;
    this.group.add(this.armL);
    this.armR = box(0.18, 0.8, 0.18, skinMat);
    this.armR.position.set(0.42, 1.5, 0.2);
    this.armR.rotation.x = -Math.PI / 2.3;
    this.group.add(this.armR);

    // Legs — dark trousers.
    this.legL = box(0.22, 0.85, 0.22, darkMat); this.legL.position.set(-0.15, 0.42, 0); this.legL.userData.baseY = 0.42; this.group.add(this.legL);
    this.legR = box(0.22, 0.85, 0.22, darkMat); this.legR.position.set(0.15, 0.42, 0); this.legR.userData.baseY = 0.42; this.group.add(this.legR);

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
    this.stunned = 0.2;
    this.hitFlash = 0.15;
    const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z;
    const len = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / len) * 4;
    this.vel.z += (dz / len) * 4;
    if (this.health <= 0) this._die();
  }

  _die() {
    this.alive = false;
    this.deathT = 1.0;
  }

  update(dt, playerPos) {
    if (!this.alive) {
      this.deathT -= dt;
      this.group.rotation.z = Math.min(Math.PI / 2, this.group.rotation.z + dt * 2);
      this.group.position.y -= dt * 0.5;
      return this.deathT > 0;
    }

    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.stunned = Math.max(0, this.stunned - dt);

    // AI: shamble toward player. Slow speed (1.6) — they're tireless but
    // shambling. Jump if blocked horizontally.
    if (playerPos && this.stunned <= 0) {
      const dx = playerPos.x - this.pos.x;
      const dz = playerPos.z - this.pos.z;
      const distSq = dx * dx + dz * dz;
      this.yaw = Math.atan2(dx, dz);
      if (distSq > 1.6) {
        const len = Math.sqrt(distSq) || 1;
        const speed = 1.6;
        this.vel.x = (dx / len) * speed;
        this.vel.z = (dz / len) * speed;
      } else {
        this.vel.x *= 0.5; this.vel.z *= 0.5;
        if (this.attackCooldown <= 0) {
          this.attackCooldown = 1.0;
          if (this.world._hostileAttackCallback) this.world._hostileAttackCallback(2);
          this._swingT = 0.35;
        }
      }
    }

    this.vel.y -= CONFIG.player.gravity * dt;
    if (this.vel.y < -30) this.vel.y = -30;

    // Auto-jump if blocked.
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

    this.vel.x *= 0.82;
    this.vel.z *= 0.82;

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;

    // Leg shuffle.
    if (Math.abs(this.vel.x) > 0.05 || Math.abs(this.vel.z) > 0.05) {
      const t = performance.now() * 0.008;
      this.legL.position.y = this.legL.userData.baseY + Math.sin(t) * 0.08;
      this.legR.position.y = this.legR.userData.baseY + Math.sin(t + Math.PI) * 0.08;
    }

    // Arm swing on attack.
    if (this._swingT > 0) {
      this._swingT -= dt;
      const phase = 1 - this._swingT / 0.35;
      const s = Math.sin(phase * Math.PI);
      this.armR.rotation.x = -Math.PI / 2.3 - s * 0.8;
      this.armL.rotation.x = -Math.PI / 2.3 - s * 0.3;
    } else {
      this.armR.rotation.x = -Math.PI / 2.3;
      this.armL.rotation.x = -Math.PI / 2.3;
    }

    // Hit flash: red emissive.
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
