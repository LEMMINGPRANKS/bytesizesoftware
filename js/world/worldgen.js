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
      // Domain warp: distort the input coordinates using a low-frequency
      // noise so coastlines and biomes curve organically instead of
      // lining up with the chunk grid.
      const warpX = (noise.height(wx * 0.004 + 333, wz * 0.004, 2) - 0.5) * 18;
      const warpZ = (noise.height(wx * 0.004 - 222, wz * 0.004 + 111, 2) - 0.5) * 18;
      const sx = wx + warpX, sz = wz + warpZ;

      // Layered height: gentle hills + occasional dramatic mountains.
      let hill = (noise.height(sx * 0.012, sz * 0.012, 5) - 0.5) * 2;
      const mtnNoise = noise.height(sx * 0.005 + 100, sz * 0.005 - 50, 3);
      const mtnMask = Math.max(0, mtnNoise - 0.55) / 0.45;
      const mtn = mtnMask * mtnMask;

      // Continent mask — smooth, continuous. `oceanFactor` runs 0 (deep
      // ocean) → 1 (interior) and is squared for flatter seabeds. No hard
      // cutoff means no cliffs at the coast.
      let cont = noise.height(sx * 0.0015 + 999, sz * 0.0015 - 999, 2);
      // Pull origin onto land: bias continent up within ~150 blocks of (0,0)
      // so the player always spawns on solid ground even if the global
      // continent noise would otherwise put us mid-ocean.
      const distFromSpawn = Math.hypot(wx, wz);
      const centerBias = Math.max(0, 1 - distFromSpawn / 150) * 0.45;
      cont = Math.min(1, cont + centerBias);
      const oceanFactor = Math.max(0, Math.min(1, cont / 0.55)); // 0..1
      const dip = (1 - oceanFactor) * (1 - oceanFactor) * 48;    // 0..48
      hill *= 0.25 + oceanFactor * 0.75;                          // flatten hills underwater

      const h = Math.floor(W.baseHeight + hill * W.hillHeight + mtn * W.mountainHeight - dip);
      const surface = Math.max(1, Math.min(CHUNK_HEIGHT - 6, h));

      for (let y = 0; y <= surface; y++) {
        let id;
        if (y === 0) id = B.BEDROCK;
        else if (y === surface) id = surface <= W.seaLevel + 1 ? B.SAND : B.GRASS;
        else if (y >= surface - 3) id = B.DIRT;
        else id = B.STONE;

        // Ore veins underground. Use value noise above a per-ore threshold so
        // veins cluster naturally; deeper ores are rarer and deeper-only.
        if (id === B.STONE) {
          for (const [oreId, ore] of ORE_TABLE) {
            const depth = surface - y;
            if (depth >= ore.minDepth &&
                noise.noise3(wx * 0.1 + oreId, y * 0.1, wz * 0.1) > ore.threshold) {
              id = oreId; break;
            }
          }
        }

        // Caves: tunnels carved by 3D noise. Two noises multiplied → wormy veins
        // instead of blobs. Only carve below surface so the ground stays solid.
        if (id === B.STONE && y < surface - 2 && y > 1) {
          const a = noise.noise3(wx * 0.05, y * 0.08, wz * 0.05);
          const b = noise.noise3(wx * 0.13 + 500, y * 0.13, wz * 0.13 - 500);
          if (a < 0.18 && b < 0.4) id = B.AIR;
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
