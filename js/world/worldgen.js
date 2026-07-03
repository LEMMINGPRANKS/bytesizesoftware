// World generator: terrain heightmap + dirt/stone layering, ores, sand at sea,
// and scattered trees. Returns a fully populated Chunk.
import { CONFIG } from "../config.js";
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from "./chunk.js";
import { B } from "./blocks.js";

const W = CONFIG.world;
const ORE_TABLE = [
  [B.PLATINUM_ORE, CONFIG.ores.platinum],
  [B.DIAMOND_ORE, CONFIG.ores.diamond],
  [B.GOLD_ORE,    CONFIG.ores.gold],
  [B.IRON_ORE,    CONFIG.ores.iron],
];

export function generateChunk(cx, cz, noise) {
  const chunk = new Chunk(cx, cz);
  const baseX = cx * CHUNK_SIZE, baseZ = cz * CHUNK_SIZE;
  const treesHere = [];

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = baseX + x, wz = baseZ + z;
      const h = Math.floor(
        W.baseHeight + (noise.height(wx * 0.012, wz * 0.012, 5) - 0.5) * 2 * W.hillHeight
      );
      const surface = Math.max(1, Math.min(CHUNK_HEIGHT - 6, h));

      for (let y = 0; y <= surface; y++) {
        let id;
        if (y === 0) id = B.BEDROCK;
        else if (y === surface) id = surface <= W.seaLevel + 1 ? B.SAND : B.GRASS;
        else if (y >= surface - 3) id = B.DIRT;
        else id = B.STONE;

        // Ore veins underground.
        if (id === B.STONE) {
          for (const [oreId, ore] of ORE_TABLE) {
            const depth = surface - y;
            if (depth >= ore.minDepth && noise.noise3(wx * 0.06, y * 0.06, wz * 0.06) > (1 - ore.rarity)) {
              id = oreId; break;
            }
          }
        }
        chunk.blocks[chunk.idx(x, y, z)] = id;
      }
      // Water fill up to sea level.
      if (surface < W.seaLevel) {
        for (let y = surface + 1; y <= W.seaLevel; y++) {
          chunk.blocks[chunk.idx(x, y, z)] = B.WATER;
        }
      }
      // Trees on grass, above sea, not at chunk border so we don't straddle.
      if (chunk.blocks[chunk.idx(x, surface, z)] === B.GRASS &&
          x > 2 && x < CHUNK_SIZE - 3 && z > 2 && z < CHUNK_SIZE - 3 &&
          noise.hash(wx, 7, wz) < CONFIG.tree.density) {
        treesHere.push({ x, y: surface + 1, z, height: CONFIG.tree.minHeight +
          Math.floor(noise.hash(wx, 13, wz) * (CONFIG.tree.maxHeight - CONFIG.tree.minHeight + 1)) });
      }
    }
  }

  for (const t of treesHere) {
    if (t.y + t.height >= CHUNK_HEIGHT) continue;
    for (let i = 0; i < t.height; i++) chunk.blocks[chunk.idx(t.x, t.y + i, t.z)] = B.WOOD;
    // Leaves: a 5x5x3 blob at top.
    const top = t.y + t.height - 1;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy) > 4) continue;
          const lx = t.x + dx, ly = top + dy, lz = t.z + dz;
          if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
          if (chunk.blocks[chunk.idx(lx, ly, lz)] === B.AIR)
            chunk.blocks[chunk.idx(lx, ly, lz)] = B.LEAVES;
        }
  }

  chunk.dirty = true;
  return chunk;
}
