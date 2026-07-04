import * as THREE from "three";

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#87ceeb");
  scene.fog = new THREE.Fog("#87ceeb", 30, 80);

  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 500);

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

  return { renderer, scene, camera, sun };
}
