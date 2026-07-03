// Builds a chunk's geometry by face-culling against neighbours. Produces one
// THREE.Mesh per (blockId, faceIndex, transparent) bucket. Simple and correct
// at the cost of more draw calls.
import * as THREE from "three";
import { B, BLOCKS } from "./blocks.js";
import { getMaterials } from "./textures.js";
import { CHUNK_SIZE, CHUNK_HEIGHT } from "./chunk.js";

const CS = CHUNK_SIZE, CH = CHUNK_HEIGHT;

const FACES = [
  { dir: [ 1, 0, 0], corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
  { dir: [-1, 0, 0], corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] },
  { dir: [ 0, 1, 0], corners: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] },
  { dir: [ 0,-1, 0], corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
  { dir: [ 0, 0, 1], corners: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]] },
  { dir: [ 0, 0,-1], corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] },
];

const materialCache = new Map();
function getMat(id, faceIdx) {
  const key = `${id}:${faceIdx}`;
  if (materialCache.has(key)) return materialCache.get(key);
  const m = getMaterials(id)[faceIdx];
  materialCache.set(key, m);
  return m;
}

function disposeGroup(group) {
  if (!group) return;
  group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
}

export function buildChunkMesh(chunk, world) {
  if (chunk.mesh) { world.group.remove(chunk.mesh); disposeGroup(chunk.mesh); chunk.mesh = null; }
  if (chunk.transparentMesh) { world.group.remove(chunk.transparentMesh); disposeGroup(chunk.transparentMesh); chunk.transparentMesh = null; }

  const buckets = new Map();
  const baseX = chunk.cx * CS, baseZ = chunk.cz * CS;

  for (let y = 0; y < CH; y++)
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++) {
        const id = chunk.blocks[chunk.idx(x, y, z)];
        if (id === B.AIR) continue;
        const transparent = !!BLOCKS[id]?.transparent;
        const liquid = !!BLOCKS[id]?.liquid;
        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = x + face.dir[0], ny = y + face.dir[1], nz = z + face.dir[2];
          const neighbour = world.getBlock(baseX + nx, ny, baseZ + nz);
          if (neighbour === B.AIR) {
            // Always render against air.
          } else if (BLOCKS[neighbour]?.liquid) {
            // Don't render block faces against same liquid (e.g. water-water).
            if (liquid) continue;
          } else if (BLOCKS[neighbour]?.transparent) {
            if (neighbour === id) continue;
          } else {
            continue; // opaque neighbour hides face
          }

          const matKey = `${id}:${f}:${transparent ? "t" : "o"}`;
          let b = buckets.get(matKey);
          if (!b) {
            b = { positions: [], normals: [], uvs: [], indices: [], id, faceIdx: f, transparent };
            buckets.set(matKey, b);
          }
          const vIdx = b.positions.length / 3;
          for (const c of face.corners) {
            b.positions.push(x + c[0], y + c[1], z + c[2]);
            b.normals.push(face.dir[0], face.dir[1], face.dir[2]);
          }
          b.uvs.push(0, 0, 0, 1, 1, 1, 1, 0);
          b.indices.push(vIdx, vIdx + 1, vIdx + 2, vIdx, vIdx + 2, vIdx + 3);
        }
      }

  if (buckets.size === 0) { chunk.dirty = false; return; }

  const opaqueGroup = new THREE.Group();
  const transGroup = new THREE.Group();
  for (const b of buckets.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(b.positions, 3));
    geo.setAttribute("normal",  new THREE.Float32BufferAttribute(b.normals, 3));
    geo.setAttribute("uv",      new THREE.Float32BufferAttribute(b.uvs, 2));
    geo.setIndex(b.indices);
    const mesh = new THREE.Mesh(geo, getMat(b.id, b.faceIdx));
    mesh.position.set(chunk.cx * CS, 0, chunk.cz * CS);
    (b.transparent ? transGroup : opaqueGroup).add(mesh);
  }
  if (opaqueGroup.children.length) {
    chunk.mesh = opaqueGroup;
    world.group.add(opaqueGroup);
  }
  if (transGroup.children.length) {
    chunk.transparentMesh = transGroup;
    world.group.add(transGroup);
  }
  chunk.dirty = false;
}
