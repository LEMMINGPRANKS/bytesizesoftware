// Cow entity: a wandering mob that can be killed for raw beef.
// Built from primitive boxes — body, head, 4 legs, snout, horns.
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { isSolid, B } from "../world/blocks.js";

function box(w, h, d, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.MeshLambertMaterial({ color });
  return new THREE.Mesh(g, m);
}

// Procedural cow-patch texture. Base white with brown blobs and a pinkish
// belly band. Cached so every cow shares the same texture.
let cowTexCache = null;
function cowTexture() {
  if (cowTexCache) return cowTexCache;
  const S = 32;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f0e8d8";
  ctx.fillRect(0, 0, S, S);
  // Pink belly band
  ctx.fillStyle = "#e8c0c8";
  ctx.fillRect(0, S * 0.6, S, S * 0.25);
  // Brown patches
  ctx.fillStyle = "#5a3a1a";
  const rng = mulberry(12345);
  for (let i = 0; i < 9; i++) {
    const px = rng() * S, py = rng() * S * 0.6;
    const w = 4 + rng() * 6, h = 4 + rng() * 6;
    ctx.beginPath();
    ctx.ellipse(px, py, w / 2, h / 2, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // Speckles
  ctx.fillStyle = "#3a2410";
  for (let i = 0; i < 12; i++) ctx.fillRect(rng() * S, rng() * S, 1, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  cowTexCache = tex;
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

function boxTex(w, h, d, tex) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.MeshLambertMaterial({ map: tex });
  return new THREE.Mesh(g, m);
}

export class Cow {
  constructor(pos, scene, world) {
    this.world = world;
    this.scene = scene;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.health = 10;
    this.fleeing = 0;
    this.hitFlash = 0;
    this.state = "idle";
    this.stateT = 1 + Math.random() * 3;
    this.width = 0.7;
    this.height = 0.9;
    this.onGround = false;
    this.alive = true;
    this.deathT = 0;

    this.group = new THREE.Group();
    const dark = 0x4a3219, snout = 0xd8b8a0, udder = 0xe6a8b0, horn = 0xece5d0;
    const tex = cowTexture();

    const body = boxTex(1.0, 0.55, 0.6, tex);
    body.position.y = 0.55;
    this.group.add(body);

    const head = boxTex(0.4, 0.4, 0.4, tex);
    head.position.set(0.7, 0.7, 0);
    this.group.add(head);
    const snoutM = box(0.18, 0.18, 0.1, snout);
    snoutM.position.set(0.92, 0.62, 0);
    this.group.add(snoutM);
    // Horns
    const h1 = box(0.08, 0.18, 0.08, horn); h1.position.set(0.68, 0.95, -0.13); this.group.add(h1);
    const h2 = box(0.08, 0.18, 0.08, horn); h2.position.set(0.68, 0.95,  0.13); this.group.add(h2);

    // Legs
    const legPositions = [[0.35, 0, -0.2], [0.35, 0, 0.2], [-0.35, 0, -0.2], [-0.35, 0, 0.2]];
    this.legs = [];
    for (const [lx, ly, lz] of legPositions) {
      const leg = box(0.18, 0.4, 0.18, dark);
      leg.position.set(lx, 0.2, lz);
      leg.userData.baseY = 0.2;
      leg.userData.phase = Math.random() * Math.PI * 2;
      this.group.add(leg);
      this.legs.push(leg);
    }
    // Udder
    const u = box(0.25, 0.12, 0.2, udder);
    u.position.set(0, 0.32, 0);
    this.group.add(u);

    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  // AABB collision test similar to player but smaller.
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
    this.fleeing = 3;
    this.hitFlash = 0.15;
    // Flee direction away from attacker.
    const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z;
    const len = Math.hypot(dx, dz) || 1;
    this.yaw = Math.atan2(-dz / len, -dx / len); // model faces +x, so yaw rotates around y
    this.yaw += Math.PI; // face away from player
    if (this.health <= 0) this._die();
  }

  _die() {
    this.alive = false;
    this.deathT = 1.0; // play dead for 1s then despawn
  }

  update(dt) {
    if (!this.alive) {
      this.deathT -= dt;
      // Tip over animation.
      this.group.rotation.z = Math.min(Math.PI / 2, this.group.rotation.z + dt * 4);
      this.group.position.y -= dt * 0.5;
      return this.deathT > 0;
    }

    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.stateT -= dt;
    this.fleeing = Math.max(0, this.fleeing - dt);

    if (this.stateT <= 0) {
      if (this.fleeing > 0) {
        this.state = "walk";
        this.stateT = 0.3 + Math.random() * 0.4;
      } else {
        // pick a new state
        const r = Math.random();
        if (r < 0.4) { this.state = "idle"; this.stateT = 2 + Math.random() * 4; }
        else {
          this.state = "walk";
          this.yaw = Math.random() * Math.PI * 2;
          this.stateT = 1.5 + Math.random() * 2.5;
        }
      }
    }

    // Movement
    let speed = this.fleeing > 0 ? 6.0 : 1.6;
    if (this.state === "walk") {
      const dir = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
      this.vel.x = dir.x * speed;
      this.vel.z = dir.z * speed;
    } else {
      this.vel.x *= 0.5; this.vel.z *= 0.5;
    }

    // Gravity
    this.vel.y -= CONFIG.player.gravity * dt;
    if (this.vel.y < -30) this.vel.y = -30;

    // Jump if blocked horizontally and on ground.
    if (this.state === "walk" && this.onGround) {
      const ahead = new THREE.Vector3(this.pos.x + Math.sign(this.vel.x) * 0.5, this.pos.y, this.pos.z + Math.sign(this.vel.z) * 0.5);
      if (isSolid(this.world.getBlock(Math.floor(ahead.x), Math.floor(ahead.y), Math.floor(ahead.z)))) {
        this.vel.y = 6;
      }
    }

    // Move per-axis
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

    // Out of world rescue
    if (this.pos.y < -5) return false;

    // Update group transform
    this.group.position.copy(this.pos);
    this.group.rotation.y = -this.yaw + Math.PI / 2;

    // Leg animation
    if (this.state === "walk") {
      const t = performance.now() * 0.008;
      for (const leg of this.legs) {
        leg.position.y = leg.userData.baseY + Math.sin(t + leg.userData.phase) * 0.06;
      }
    }
    // Hit flash: tint body red briefly when hurt.
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
