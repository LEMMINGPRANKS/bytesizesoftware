// First-person player: AABB voxel collision, walking, jumping, gravity, fly.
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { isSolid, isLiquid } from "../world/blocks.js";
import { B } from "../world/blocks.js";

const TMP = new THREE.Vector3();

export class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    const cfg = CONFIG.player;
    this.half = cfg.width / 2;
    this.height = cfg.height;
    this.eye = cfg.eyeHeight;
    this.pos = new THREE.Vector3(8, 40, 8);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.fly = false;
    this.inWater = false;
  }

  spawn() {
    // Search outward in expanding rings for a column above sea level so we
    // never spawn marooned in an endless ocean.
    const sea = CONFIG.world.seaLevel;
    const start = new THREE.Vector3(8.5, 40, 8.5);
    const tryAt = (sx, sz) => {
      const cx = Math.floor(sx / CONFIG.world.chunkSize), cz = Math.floor(sz / CONFIG.world.chunkSize);
      this.world.ensureChunk(cx, cz);
      const h = this.world.surfaceHeight(sx, sz);
      return h > sea + 1 ? h : -1;
    };
    for (let r = 0; r <= 96; r += 4) {
      const steps = Math.max(8, r * 6);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const sx = 8 + Math.round(Math.cos(a) * r);
        const sz = 8 + Math.round(Math.sin(a) * r);
        const h = tryAt(sx, sz);
        if (h > 0) { start.set(sx + 0.5, h + 2, sz + 0.5); return this._applySpawn(start); }
      }
    }
    // Fallback: spawn at origin even if it's underwater.
    const h0 = tryAt(8, 8);
    start.set(8.5, Math.max(h0, sea + 1) + 2, 8.5);
    return this._applySpawn(start);
  }
  _applySpawn(v) {
    this.pos.copy(v);
    this.vel.set(0, 0, 0);
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0025;
    this.pitch -= dy * 0.0025;
    const lim = Math.PI / 2 - 0.001;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  _collides(wx, wy, wz) {
    const x0 = Math.floor(wx - this.half), x1 = Math.floor(wx + this.half);
    const y0 = Math.floor(wy), y1 = Math.floor(wy + this.height - 0.001);
    const z0 = Math.floor(wz - this.half), z1 = Math.floor(wz + this.half);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          if (isSolid(this.world.getBlock(x, y, z))) return true;
    return false;
  }

  update(dt, input) {
    const cfg = CONFIG.player;

    // Look
    this.look(input.dx, input.dy);

    // Determine if in water (head or feet)
    const headBlock = this.world.getBlock(
      Math.floor(this.pos.x), Math.floor(this.pos.y + this.eye), Math.floor(this.pos.z)
    );
    const feetBlock = this.world.getBlock(
      Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z)
    );
    this.inWater = isLiquid(headBlock) || isLiquid(feetBlock);

    // Movement input
    const fwd = (input.keys.has("KeyW") ? 1 : 0) - (input.keys.has("KeyS") ? 1 : 0);
    const strafe = (input.keys.has("KeyD") ? 1 : 0) - (input.keys.has("KeyA") ? 1 : 0);
    const sprint = input.keys.has("ShiftLeft") || input.keys.has("ShiftRight");
    let speed = (this.fly ? cfg.flySpeed : (sprint ? cfg.sprint : cfg.speed));
    if (this.inWater && !this.fly) speed *= 0.6;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = (-sin * fwd + cos * strafe);
    const wishZ = (-cos * fwd - sin * strafe);
    const wishLen = Math.hypot(wishX, wishZ) || 1;
    const vx = (wishX / wishLen) * speed * (Math.abs(fwd) + Math.abs(strafe) > 0 ? 1 : 0);
    const vz = (wishZ / wishLen) * speed * (Math.abs(fwd) + Math.abs(strafe) > 0 ? 1 : 0);

    if (this.fly) {
      this.vel.x = vx; this.vel.z = vz;
      this.vel.y = (input.keys.has("Space") ? 1 : 0) - (input.keys.has("KeyC") ? 1 : 0) * cfg.flySpeed;
      this.vel.y *= cfg.flySpeed;
    } else {
      this.vel.x = vx; this.vel.z = vz;
      this.vel.y -= cfg.gravity * dt;
      if (this.inWater) {
        this.vel.y *= 0.6;
        if (input.keys.has("Space")) this.vel.y = 3.5;
      } else if (input.keys.has("Space") && this.onGround) {
        this.vel.y = cfg.jump;
      }
    }

    // Move per-axis to allow sliding.
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

    // Out-of-world rescue.
    if (this.pos.y < -10) this.spawn();

    // Camera follow.
    this.camera.position.set(this.pos.x, this.pos.y + this.eye, this.pos.z);
    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    this.camera.lookAt(
      this.camera.position.x + dir.x,
      this.camera.position.y + dir.y,
      this.camera.position.z + dir.z
    );
  }

  // Position the camera is looking from, used for raycasts.
  eyePos() { return TMP.set(this.pos.x, this.pos.y + this.eye, this.pos.z); }
  // Look direction as unit vector.
  lookDir() {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
  }

  toggleFly() { this.fly = !this.fly; this.vel.set(0,0,0); }
}
