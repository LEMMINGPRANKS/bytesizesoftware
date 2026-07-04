// Builds a chunk's geometry by face-culling against neighbours. Produces a
// SINGLE mesh per chunk per layer (opaque + transparent), using a shared
// texture atlas and per-face UV lookup. Two draw calls per chunk total.
import * as THREE from "three";
import { B, BLOCKS } from "./blocks.js";
import { CHUNK_SIZE, CHUNK_HEIGHT } from "./chunk.js";
import { atlasUV, getAtlasTexture } from "./textures.js";

const MCS = CHUNK_SIZE, MCH = CHUNK_HEIGHT;

const FACES = [
  { dir: [ 1, 0, 0], corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
  { dir: [-1, 0, 0], corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] },
  { dir: [ 0, 1, 0], corners: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] },
  { dir: [ 0,-1, 0], corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
  { dir: [ 0, 0, 1], corners: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]] },
  { dir: [ 0, 0,-1], corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] },
];

let opaqueMat = null, transparentMat = null;
function getOpaqueMat() {
  if (!opaqueMat) opaqueMat = new THREE.MeshLambertMaterial({ map: getAtlasTexture() });
  return opaqueMat;
}
function getTransparentMat() {
  if (!transparentMat) {
    transparentMat = new THREE.MeshLambertMaterial({
      map: getAtlasTexture(), transparent: true, alphaTest: 0.3, depthWrite: true,
    });
  }
  return transparentMat;
}

function disposeMesh(m) {
  if (!m) return;
  if (m.geometry) m.geometry.dispose();
}

// Crossed quads that span the cell — used for seagrass. `w` is half-width
// in x/z, `h` is height in y.
function addCross(layer, x, y, z, id, w, h) {
  const cx = x + 0.5, cz = z + 0.5;
  const baseY = y, topY = y + h;
  const [u0, v0, u1, v1] = atlasUV(id, 2);
  const pts = [
    [
      [cx - w, baseY, cz - w],
      [cx - w, topY,  cz - w],
      [cx + w, topY,  cz + w],
      [cx + w, baseY, cz + w],
    ],
    [
      [cx + w, baseY, cz - w],
      [cx + w, topY,  cz - w],
      [cx - w, topY,  cz + w],
      [cx - w, baseY, cz + w],
    ],
  ];
  for (const quadPts of pts) {
    const vIdx = layer.positions.length / 3;
    for (const p of quadPts) layer.positions.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) layer.normals.push(0, 0, 1);
    layer.uvs.push(u0, v0, u0, v1, u1, v1, u1, v0);
    layer.indices.push(vIdx, vIdx + 1, vIdx + 2, vIdx, vIdx + 2, vIdx + 3);
  }
}

// Adds a torch as two crossed quads centered in the cell, smaller than full block.
function addTorch(layer, x, y, z, id) {
  const cx = x + 0.5, cz = z + 0.5;
  const w = 0.18;           // half-width at top/bottom
  const baseY = y, topY = y + 0.65;
  const [u0, v0, u1, v1] = atlasUV(id, 2);  // use "top" face UVs

  // Plane 1: diagonal +x+z to -x-z
  let vIdx = layer.positions.length / 3;
  const pts1 = [
    [cx - w, baseY, cz - w],
    [cx - w, topY,  cz - w],
    [cx + w, topY,  cz + w],
    [cx + w, baseY, cz + w],
  ];
  for (const p of pts1) layer.positions.push(p[0], p[1], p[2]);
  for (let i = 0; i < 4; i++) layer.normals.push(0, 0, 1);
  layer.uvs.push(u0, v0, u0, v1, u1, v1, u1, v0);
  layer.indices.push(vIdx, vIdx + 1, vIdx + 2, vIdx, vIdx + 2, vIdx + 3);

  // Plane 2: diagonal -x+z to +x-z
  vIdx = layer.positions.length / 3;
  const pts2 = [
    [cx + w, baseY, cz - w],
    [cx + w, topY,  cz - w],
    [cx - w, topY,  cz + w],
    [cx - w, baseY, cz + w],
  ];
  for (const p of pts2) layer.positions.push(p[0], p[1], p[2]);
  for (let i = 0; i < 4; i++) layer.normals.push(0, 0, 1);
  layer.uvs.push(u0, v0, u0, v1, u1, v1, u1, v0);
  layer.indices.push(vIdx, vIdx + 1, vIdx + 2, vIdx, vIdx + 2, vIdx + 3);
}

export function buildChunkMesh(chunk, world) {
  if (chunk.mesh) { world.group.remove(chunk.mesh); disposeMesh(chunk.mesh); chunk.mesh = null; }
  if (chunk.transparentMesh) { world.group.remove(chunk.transparentMesh); disposeMesh(chunk.transparentMesh); chunk.transparentMesh = null; }

  // Per-layer arrays.
  const opaque = { positions: [], normals: [], uvs: [], indices: [] };
  const transparent = { positions: [], normals: [], uvs: [], indices: [] };

  const baseX = chunk.cx * MCS, baseZ = chunk.cz * MCS;

  for (let y = 0; y < MCH; y++)
    for (let z = 0; z < MCS; z++)
      for (let x = 0; x < MCS; x++) {
        const id = chunk.blocks[chunk.idx(x, y, z)];
        if (id === B.AIR) continue;
        const def = BLOCKS[id];
        const isTransparent = !!def?.transparent;
        const isLiquid = !!def?.liquid;

        // Decor: torches and seagrass render as crossed quads.
        if (id === B.TORCH) {
          addTorch(transparent, x, y, z, id);
          continue;
        }
        if (id === B.SEAGRASS) {
          // Crossed blades + waterlogged cube faces (so it doesn't look like
          // an air bubble). Render water faces that abut AIR or non-water
          // transparent neighbours; skip faces touching other water.
          addCross(transparent, x, y, z, id, 0.45, 1.0);
          for (let f = 0; f < 6; f++) {
            const face = FACES[f];
            const nx = x + face.dir[0], ny = y + face.dir[1], nz = z + face.dir[2];
            const nb = world.getBlock(baseX + nx, ny, baseZ + nz);
            const ndef = BLOCKS[nb];
            const isWater = nb === B.WATER;
            // Render water face if neighbour is air, or transparent-non-water.
            const shouldRender = nb === B.AIR ||
              (ndef?.transparent && !ndef?.liquid && !ndef?.solid);
            if (!shouldRender) continue;
            const vIdx = transparent.positions.length / 3;
            for (const c of face.corners) {
              transparent.positions.push(x + c[0], y + c[1], z + c[2]);
              transparent.normals.push(face.dir[0], face.dir[1], face.dir[2]);
            }
            const [u0, v0, u1, v1] = atlasUV(B.WATER, f);
            transparent.uvs.push(u0, v0, u0, v1, u1, v1, u1, v0);
            transparent.indices.push(vIdx, vIdx + 1, vIdx + 2, vIdx, vIdx + 2, vIdx + 3);
          }
          continue;
        }

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = x + face.dir[0], ny = y + face.dir[1], nz = z + face.dir[2];
          const neighbour = world.getBlock(baseX + nx, ny, baseZ + nz);
          if (neighbour === B.AIR) {
            // ok
          } else if (BLOCKS[neighbour]?.liquid) {
            if (isLiquid) continue;
          } else if (BLOCKS[neighbour]?.transparent) {
            if (neighbour === id) continue;
            // Waterlog: water surface shouldn't render against seagrass —
            // seagrass is treated as waterlogged so the cells visually merge.
            if (isLiquid && neighbour === B.SEAGRASS) continue;
          } else {
            continue;
          }

          const layer = isTransparent ? transparent : opaque;
          const vIdx = layer.positions.length / 3;
          for (const c of face.corners) {
            layer.positions.push(x + c[0], y + c[1], z + c[2]);
            layer.normals.push(face.dir[0], face.dir[1], face.dir[2]);
          }
          const [u0, v0, u1, v1] = atlasUV(id, f);
          // corners are 0..3 in this order; UVs map (0,0)(0,1)(1,1)(1,0).
          layer.uvs.push(u0, v0, u0, v1, u1, v1, u1, v0);
          layer.indices.push(vIdx, vIdx + 1, vIdx + 2, vIdx, vIdx + 2, vIdx + 3);
        }
      }

  function makeMesh(layer, material) {
    if (layer.positions.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(layer.positions, 3));
    geo.setAttribute("normal",  new THREE.Float32BufferAttribute(layer.normals, 3));
    geo.setAttribute("uv",      new THREE.Float32BufferAttribute(layer.uvs, 2));
    geo.setIndex(layer.indices);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(chunk.cx * MCS, 0, chunk.cz * MCS);
    return mesh;
  }

  const om = makeMesh(opaque, getOpaqueMat());
  const tm = makeMesh(transparent, getTransparentMat());
  if (om) { chunk.mesh = om; world.group.add(om); }
  if (tm) { chunk.transparentMesh = tm; world.group.add(tm); }
  chunk.dirty = false;
}
