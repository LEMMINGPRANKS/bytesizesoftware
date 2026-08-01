// Moon Rock Golem — boss entity spawned on first moon entry.
// Slow, relentless melee bruiser with high HP. Built from boxes wrapped in
// a procedural platinum-rock plate texture. On death: drops PLATINUM_TROPHY.
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { isSolid, B } from "../world/blocks.js";

function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

// Procedural plate texture: pale platinum base with darker seams + bright
// crystalline inclusions. Cached so all golems share one GPU texture.
let golemTexCache = null;
function golemTexture() {
  if (golemTexCache) return golemTexCache;
  const S = 32;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");
  // Base plate gradient.
  const grad = ctx.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, "#d8d8e0");
  grad.addColorStop(1, "#9a9aa6");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  const rng = mulberry(777);
  // Plate seams: dark cracks dividing the surface into chunks.
  ctx.strokeStyle = "rgba(40,40,55,0.7)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    const x = (rng() * S) | 0;
    ctx.moveTo(x, 0);
    let y = 0, cx = x;
    while (y < S) {
      y += 4 + (rng() * 3);
      cx += (rng() - 0.5) * 6;
      ctx.lineTo(cx, y);
    }
    ctx.stroke();
  }
  // Crystalline bright inclusions (looks like platinum ore veins).
  ctx.fillStyle = "#f4f4ff";
  for (let i = 0; i < 8; i++) {
    const px = (rng() * S) | 0, py = (rng() * S) | 0;
    ctx.fillRect(px, py, 1 + ((rng() * 2) | 0), 1 + ((rng() * 2) | 0));
  }
  // Small dark pits for "rock" feel.
  ctx.fillStyle = "rgba(20,20,30,0.6)";
  for (let i = 0; i < 5; i++) {
    const px = (rng() * S) | 0, py = (rng() * S) | 0;
    ctx.fillRect(px, py, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  golemTexCache = tex;
  return tex;
}
function mulberry(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MoonGolem {
  constructor(pos, scene, world) {
    this.world = world;
    this.scene = scene;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.maxHealth = 200;
    this.health = 200;
    this.width = 1.4;
    this.height = 2.6;
    this.onGround = false;
    this.alive = true;
    this.deathT = 0;
    this.attackCooldown = 0;
    this.stunned = 0;
    this.isBoss = true;
    this.isFish = false;
    this.hitFlash = 0;

    this.group = new THREE.Group();
    const tex = golemTexture();
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a3a48 });

    // Torso: chunky 1.6×1.6×1.0 slab.
    const body = box(1.6, 1.6, 1.0, mat);
    body.position.set(0, 1.6, 0);
    body.castShadow = true;
    this.group.add(body);

    // Glowing eyes — two small emissive cubes on the front of the head.
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3020 });
    const e1 = box(0.12, 0.12, 0.05, eyeMat); e1.position.set(-0.25, 2.35, 0.5); this.group.add(e1);
    const e2 = box(0.12, 0.12, 0.05, eyeMat); e2.position.set(0.25, 2.35, 0.5); this.group.add(e2);

    // Head: smaller box on top, slightly forward.
    const head = box(0.8, 0.7, 0.7, mat);
    head.position.set(0, 2.3, 0);
    head.castShadow = true;
    this.group.add(head);

    // Shoulder pauldrons — two angled chunks either side.
    const sL = box(0.5, 0.5, 0.9, mat); sL.position.set(-0.95, 2.1, 0); this.group.add(sL);
    const sR = box(0.5, 0.5, 0.9, mat); sR.position.set(0.95, 2.1, 0); this.group.add(sR);

    // Arms — thick slabby cylinders (boxes for simplicity).
    this.armL = box(0.45, 1.3, 0.55, mat); this.armL.position.set(-1.0, 1.4, 0); this.armL.userData.baseY = 1.4; this.group.add(this.armL);
    this.armR = box(0.45, 1.3, 0.55, mat); this.armR.position.set(1.0, 1.4, 0); this.armR.userData.baseY = 1.4; this.group.add(this.armR);

    // Legs: short, stumpy.
    this.legL = box(0.5, 0.9, 0.5, dark); this.legL.position.set(-0.35, 0.45, 0); this.legL.userData.baseY = 0.45; this.group.add(this.legL);
    this.legR = box(0.5, 0.9, 0.5, dark); this.legR.position.set(0.35, 0.45, 0); this.legR.userData.baseY = 0.45; this.group.add(this.legR);

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
    this.stunned = 0.25;
    this.hitFlash = 0.15;
    // Apply knockback away from attacker.
    const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z;
    const len = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / len) * 5;
    this.vel.z += (dz / len) * 5;
    if (this.health <= 0) this._die();
  }

  _die() {
    this.alive = false;
    this.deathT = 1.5;
  }

  update(dt, playerPos) {
    if (!this.alive) {
      this.deathT -= dt;
      // Crumble animation: tip + sink.
      this.group.rotation.z = Math.min(Math.PI / 2, this.group.rotation.z + dt * 1.5);
      this.group.position.y -= dt * 0.8;
      return this.deathT > 0;
    }

    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.stunned = Math.max(0, this.stunned - dt);

    // AI: face player, walk toward them when > 2 blocks away, attack < 2.
    if (playerPos && this.stunned <= 0) {
      const dx = playerPos.x - this.pos.x;
      const dz = playerPos.z - this.pos.z;
      const distSq = dx * dx + dz * dz;
      this.yaw = Math.atan2(dx, dz);
      if (distSq > 6) {
        const len = Math.sqrt(distSq) || 1;
        const speed = 2.4; // slow but relentless
        this.vel.x = (dx / len) * speed;
        this.vel.z = (dz / len) * speed;
      } else {
        this.vel.x *= 0.5; this.vel.z *= 0.5;
        // Melee attack: trigger callback (hunger damage to player) via
        // world._bossAttackCallback, set from main.js.
        if (this.attackCooldown <= 0) {
          this.attackCooldown = 1.2;
          if (this.world._bossAttackCallback) this.world._bossAttackCallback();
          // Windmill arm swing — visual tell.
          this._swingT = 0.4;
        }
      }
    }

    // Gravity (moon gravity handled by world's bossGravity flag if set, else
    // default — golem uses half player gravity since it's heavy).
    this.vel.y -= CONFIG.player.gravity * 0.5 * dt;
    if (this.vel.y < -30) this.vel.y = -30;

    // Move per-axis with sliding.
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

    // Friction
    this.vel.x *= 0.85;
    this.vel.z *= 0.85;

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;

    // Arm swing animation.
    if (this._swingT > 0) {
      this._swingT -= dt;
      const phase = 1 - this._swingT / 0.4; // 0..1
      const swing = Math.sin(phase * Math.PI);
      this.armR.rotation.x = -swing * 1.5;
      this.armL.rotation.x = -swing * 0.3;
    } else {
      this.armR.rotation.x *= 0.8;
      this.armL.rotation.x *= 0.8;
    }

    // Hit flash: tint the body red briefly.
    const flash = this.hitFlash > 0;
    this.group.traverse(o => {
      if (o.material && o.material.emissive !== undefined && !o.material.isMeshBasicMaterial) {
        o.material.emissive.setHex(flash ? 0x551010 : 0x000000);
      }
    });

    return true;
  }

  remove() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      // Don't dispose shared material — texture is cached.
    });
  }
}
