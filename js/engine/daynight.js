// Smooth day/night cycle. Owns a `time` value in [0,1) that advances each
// frame. Drives sun direction, sun intensity, ambient/hemisphere intensity,
// scene background colour, and fog colour.
//
// time: 0=midnight · 0.25=sunrise · 0.5=noon · 0.75=sunset
import * as THREE from "three";
import { CONFIG } from "../config.js";

const DAY_LENGTH = CONFIG.world.dayLengthSeconds; // seconds for a full cycle

// Sky/fog colour stops — [time, r, g, b]. Lerped between adjacent stops.
const SKY_STOPS = [
  [0.00, 0.04, 0.05, 0.10],   // midnight — deep blue-black
  [0.22, 0.10, 0.12, 0.22],   // pre-dawn
  [0.27, 0.85, 0.55, 0.40],   // sunrise — orange
  [0.35, 0.55, 0.75, 0.95],   // morning blue
  [0.50, 0.53, 0.81, 0.92],   // noon — bright sky (#87ceeb)
  [0.65, 0.55, 0.75, 0.95],   // afternoon blue
  [0.73, 0.95, 0.50, 0.30],   // sunset — orange
  [0.80, 0.25, 0.18, 0.30],   // dusk
  [1.00, 0.04, 0.05, 0.10],   // back to midnight
];

export class DayNight {
  constructor(scene, camera, sun, ambient, hemi) {
    this.scene = scene;
    this.camera = camera;
    this.sun = sun;
    this.ambient = ambient;
    this.hemi = hemi;
    this.time = 0.30; // start mid-morning so the player sees daylight immediately
  }
  // Sun elevation in [-1,1]: -1 = midnight (sun directly below), 0 = horizon
  // (sunrise/sunset), +1 = noon (overhead).
  elevation() { return -Math.cos(this.time * Math.PI * 2); }
  // Daylight mix factor [0,1]: 0 deep night, ~0.5 twilight, 1 full day.
  // Rises faster than the old linear curve so mornings read as daytime.
  dayFactor() { return Math.max(0, Math.min(1, this.elevation() * 0.6 + 0.5)); }
  update(dt, followPos) {
    this.time = (this.time + dt / DAY_LENGTH) % 1;

    // Sun angle: ang=0 at sunrise (time=0.25), π/2 at noon, π at sunset.
    // Sun travels east → overhead → west. Below horizon at night.
    const ang = (this.time - 0.25) * Math.PI * 2;
    const sx = Math.cos(ang);
    const sy = Math.sin(ang);
    const sz = 0.35; // slight tilt so shadows aren't perfectly axis-aligned
    // For shadow mapping the directional light's shadow camera is anchored
    // at sun.position, so we centre it on the player (in followPos) — that
    // keeps the shadow frustum around the action instead of around origin.
    const fx = followPos ? followPos.x : 0;
    const fy = followPos ? followPos.y : 0;
    const fz = followPos ? followPos.z : 0;
    this.sun.position.set(fx + sx * 80, fy + sy * 100, fz + sz * 80);
    this.sun.target.position.set(fx, fy, fz);
    this.sun.target.updateMatrixWorld();

    // Intensities — dim everything at night, but never fully dark so the
    // player can still see. Sun rises/falls with elevation. Mornings get a
    // strong ambient floor so the world doesn't feel dingy at low sun angles.
    const day = this.dayFactor();
    this.sun.intensity = 0.10 + day * 1.20;
    this.ambient.intensity = 0.35 + day * 0.55;
    this.hemi.intensity = 0.22 + day * 0.40;

    // Sun colour shifts warm at sunrise/sunset, white at noon, cool at night.
    const warm = Math.max(0, 1 - Math.abs(this.elevation()) * 1.5);
    const sunR = 1.00;
    const sunG = 0.96 - warm * 0.20;
    const sunB = 0.85 - warm * 0.45;
    this.sun.color.setRGB(sunR, sunG, sunB);

    // Sky + fog colour from stop table.
    const [r, g, b] = sampleStops(SKY_STOPS, this.time);
    const col = new THREE.Color(r, g, b);
    this.scene.background = col;
    if (this.scene.fog) this.scene.fog.color = col;
  }
}

function sampleStops(stops, t) {
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0]);
      return [
        a[1] + (b[1] - a[1]) * f,
        a[2] + (b[2] - a[2]) * f,
        a[3] + (b[3] - a[3]) * f,
      ];
    }
  }
  return [stops[0][1], stops[0][2], stops[0][3]];
}
