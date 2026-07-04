import * as THREE from "three";
import { getSettings } from "../save/settings.js";

export function createRenderer(canvas) {
  const s = getSettings();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: s.antialias, powerPreference: "high-performance" });
  renderer.setPixelRatio(s.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#87ceeb");
  const fogFar = Math.max(40, s.renderDistance * 16 + 8);
  scene.fog = new THREE.Fog("#87ceeb", Math.max(8, s.renderDistance * 8), s.fog ? fogFar : fogFar * 10);

  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1,
    Math.max(80, s.renderDistance * 18 + 40));

  const sun = new THREE.DirectionalLight("#fff5d8", 1.05);
  sun.position.set(40, 80, 20);
  scene.add(sun);
  const ambient = new THREE.AmbientLight("#aebfd0", 0.55);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight("#bfe3ff", "#5a4a2a", 0.4);
  scene.add(hemi);

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", onResize);

  return { renderer, scene, camera, sun, ambient, hemi };
}
