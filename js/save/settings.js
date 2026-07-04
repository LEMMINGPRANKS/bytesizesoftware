// Settings: persist + apply graphics/render options. Stored in localStorage
// under `wildcraft:settings` so they survive page reloads.
import { CONFIG } from "../config.js";

const KEY = "wildcraft:settings";

export const DEFAULTS = {
  renderDistance: 3,    // chunks in each direction
  pixelRatio: 1,        // 0.5 / 0.75 / 1.0
  antialias: false,     // requires reload to apply
  fog: true,
};

let current = null;

export function getSettings() {
  if (current) return current;
  try {
    const raw = localStorage.getItem(KEY);
    current = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    current = { ...DEFAULTS };
  }
  return current;
}

export function saveSettings(s) {
  current = { ...DEFAULTS, ...current, ...s };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch {}
  return current;
}

// Apply runtime-applicable settings to a renderer/world/camera triple.
export function applySettings({ renderer, camera, scene }) {
  const s = getSettings();
  if (renderer) renderer.setPixelRatio(s.pixelRatio);
  CONFIG.world.renderDistance = s.renderDistance;
  if (camera) {
    camera.far = Math.max(80, s.renderDistance * 18 + 40);
    camera.updateProjectionMatrix();
  }
  if (scene && scene.fog) {
    const near = Math.max(8, s.renderDistance * 8);
    const far = Math.max(40, s.renderDistance * 16 + 8);
    scene.fog.near = near;
    scene.fog.far = s.fog ? far : far * 10; // fog off = push way out
  }
}

