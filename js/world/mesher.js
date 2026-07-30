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

// Adds a 3D torch: a thin stick box with a small flame cube on top. The
// stick samples only the brown-stick column of the torch tile, and the
// flame samples only the orange-flame top — otherwise every face of every
// box shows a full torch sprite and one placed torch looks like a cluster.
// Real lighting comes from the PointLight pool in main.js.
function addBoxUV(layer, x0, y0, z0, x1, y1, z1, u0, v0, u1, v1) {
  const faces = [
    { dir: [ 1, 0, 0], corners: [[x1,y0,z1],[x1,y1,z1],[x1,y1,z0],[x1,y0,z0]] },
    { dir: [-1, 0, 0], corners: [[x0,y0,z0],[x0,y1,z0],[x0,y1,z1],[x0,y0,z1]] },
    { dir: [ 0, 1, 0], corners: [[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]] },
    { dir: [ 0,-1, 0], corners: [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]] },
    { dir: [ 0, 0, 1], corners: [[x0,y0,z1],[x0,y1,z1],[x1,y1,z1],[x1,y0,z1]] },
    { dir: [ 0, 0,-1], corners: [[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z0]] },
  ];
  for (const f of faces) {
    const vi = layer.positions.length / 3;
    for (const c of f.corners) layer.positions.push(c[0], c[1], c[2]);
    for (let i = 0; i < 4; i++) layer.normals.push(f.dir[0], f.dir[1], f.dir[2]);
    layer.uvs.push(u0, v1, u0, v0, u1, v0, u1, v1);
    layer.indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  }
}
function addTorch(layer, x, y, z, id) {
  // Sub-rect within the torch tile. Tile pixel coords are 0..16 with V
  // flipped to match Three.js. Stick = central brown column (px x:7..9,
  // y:6..16). Flame = orange head (px x:6..10, y:3..7).
  const [tu0, tv0, tu1, tv1] = atlasUV(id, 2);
  const lerp = (a, b, t) => a + (b - a) * t;
  // Stick sub-rect (centre column, lower 5/8 of tile).
  const su0 = lerp(tu0, tu1, 7 / 16);
  const su1 = lerp(tu0, tu1, 9 / 16);
  // Tile V is bottom-up; the stick occupies the bottom portion (y=6..16 in
  // top-down canvas pixels = top 10/16 of the flipped tile, so we take the
  // bottom 10/16 of the tile).
  const sv0 = lerp(tv0, tv1, 0);
  const sv1 = lerp(tv0, tv1, 10 / 16);
  addBoxUV(layer, x + 0.43, y + 0.00, z + 0.43, x + 0.57, y + 0.55, z + 0.57, su0, sv0, su1, sv1);
  // Flame sub-rect (top-centre 4x4 px block).
  const fu0 = lerp(tu0, tu1, 6 / 16);
  const fu1 = lerp(tu0, tu1, 10 / 16);
  // Flame is at top-down y:3..7 → bottom-up: 16-7=9 to 16-3=13 → mid tile.
  const fv0 = lerp(tv0, tv1, 9 / 16);
  const fv1 = lerp(tv0, tv1, 13 / 16);
  addBoxUV(layer, x + 0.38, y + 0.55, z + 0.38, x + 0.62, y + 0.72, z + 0.62, fu0, fv0, fu1, fv1);
}

// Door panel — thin slab (0.15 thick) that spans the cell. Two quads (front +
// back). Orientation depends on whether the door is open: closed = panel in
// the Z=0 plane (faces ±Z); open = swung to the X=0 plane (faces ±X).
function addDoor(layer, x, y, z, id, isOpen) {
  const [u0, v0, u1, v1] = atlasUV(id, 2);
  let minA, maxA, minB, maxB;
  if (isOpen) {
    // Panel runs along Z; occupies x≈0..0.15
    minA = [x + 0.0,  y, z + 0.0];
    maxA = [x + 0.15, y + 1, z + 1.0];
  } else {
    // Panel runs along X; occupies z≈0..0.15
    minA = [x + 0.0,  y, z + 0.0];
    maxA = [x + 1.0,  y + 1, z + 0.15];
  }
  const quad = (a, b, c, d, nx, ny, nz) => {
    const vi = layer.positions.length / 3;
    for (const p of [a, b, c, d]) layer.positions.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) layer.normals.push(nx, ny, nz);
    layer.uvs.push(u0, v0, u0, v1, u1, v1, u1, v0);
    layer.indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  };
  // Front + back face of the thin slab.
  if (isOpen) {
    quad([minA[0], minA[1], minA[2]], [minA[0], maxA[1], minA[2]],
         [minA[0], maxA[1], maxA[2]], [minA[0], minA[1], maxA[2]], -1, 0, 0);
    quad([maxA[0], minA[1], maxA[2]], [maxA[0], maxA[1], maxA[2]],
         [maxA[0], maxA[1], minA[2]], [maxA[0], minA[1], minA[2]], 1, 0, 0);
  } else {
    quad([minA[0], minA[1], minA[2]], [maxA[0], minA[1], minA[2]],
         [maxA[0], maxA[1], minA[2]], [minA[0], maxA[1], minA[2]], 0, 0, -1);
    quad([minA[0], maxA[1], maxA[2]], [maxA[0], maxA[1], maxA[2]],
         [maxA[0], minA[1], maxA[2]], [minA[0], minA[1], maxA[2]], 0, 0, 1);
  }
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
        if (id === B.DOOR || id === B.DOOR_TOP) {
          // Open/closed state lives on the bottom block (same x,z; y-1 for top).
          const baseY = id === B.DOOR ? y : y - 1;
          const isOpen = world.isDoorOpen(baseX + x, baseY, baseZ + z);
          addDoor(transparent, x, y, z, id, isOpen);
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
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  const om = makeMesh(opaque, getOpaqueMat());
  const tm = makeMesh(transparent, getTransparentMat());
  if (om) { chunk.mesh = om; world.group.add(om); }
  if (tm) { chunk.transparentMesh = tm; world.group.add(tm); }
  chunk.dirty = false;
}
