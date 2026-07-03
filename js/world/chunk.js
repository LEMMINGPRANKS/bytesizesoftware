// Voxel chunk: a flat Uint8Array of block IDs.
import { CONFIG } from "../config.js";
const CS = CONFIG.world.chunkSize;
const CH = CONFIG.world.chunkHeight;

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.blocks = new Uint8Array(CS * CS * CH);
    this.dirty = true;        // needs re-mesh
    this.mesh = null;         // opaque mesh
    this.transparentMesh = null;
  }
  idx(x, y, z) { return (y * CS + z) * CS + x; }
  get(x, y, z) {
    if (x < 0 || x >= CS || z < 0 || z >= CS || y < 0 || y >= CH) return 0;
    return this.blocks[this.idx(x, y, z)];
  }
  set(x, y, z, v) {
    if (x < 0 || x >= CS || z < 0 || z >= CS || y < 0 || y >= CH) return;
    this.blocks[this.idx(x, y, z)] = v;
    this.dirty = true;
  }
}
export const CHUNK_SIZE = CS;
export const CHUNK_HEIGHT = CH;
