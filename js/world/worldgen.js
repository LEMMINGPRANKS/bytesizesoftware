// World generator: terrain heightmap + dirt/stone layering, ores, sand at sea,
// and scattered trees. Returns a fully populated Chunk.
import { CONFIG } from "../config.js";
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from "./chunk.js";
import { B } from "./blocks.js";

const W = CONFIG.world;
const BI = CONFIG.biomes;
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
  const cactiHere = [];

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = baseX + x, wz = baseZ + z;
      // Domain warp: distort the input coordinates using a low-frequency
      // noise so coastlines and biomes curve organically instead of
      // lining up with the chunk grid.
      const warpX = (noise.height(wx * 0.004 + 333, wz * 0.004, 2) - 0.5) * 18;
      const warpZ = (noise.height(wx * 0.004 - 222, wz * 0.004 + 111, 2) - 0.5) * 18;
      const sx = wx + warpX, sz = wz + warpZ;

      // ---- Biome selection ----
      // Low-frequency noise carved into bands. Spawn is forced to normal
      // temperate within ~120 blocks so day-1 isn't a glacier or vast
      // desert — those are out there to be discovered.
      const distFromSpawn = Math.hypot(wx, wz);
      const biomeNoise = noise.height(sx * BI.freq + 7777, sz * BI.freq - 7777, 3);
      const adjustedBiome = distFromSpawn < 120
        ? "normal"
        : biomeNoise < BI.iceBand
          ? "ice"
          : biomeNoise > BI.desertBand
            ? "desert"
            : "normal";

      // Layered height: gentle hills + occasional dramatic mountains.
      let hill = (noise.height(sx * 0.012, sz * 0.012, 5) - 0.5) * 2;
      const mtnNoise = noise.height(sx * 0.005 + 100, sz * 0.005 - 50, 3);
      const mtnMask = Math.max(0, mtnNoise - 0.6) / 0.4;
      // Higher power → flatter plains with sharper dramatic peaks.
      const mtn = mtnMask * mtnMask * mtnMask * mtnMask;

      // Continent mask — smooth, continuous. `oceanFactor` runs 0 (deep
      // ocean) → 1 (interior) and is squared for flatter seabeds. No hard
      // cutoff means no cliffs at the coast.
      let cont = noise.height(sx * 0.0015 + 999, sz * 0.0015 - 999, 2);
      // Pull origin onto land: bias continent up within ~150 blocks of (0,0)
      // so the player always spawns on solid ground even if the global
      // continent noise would otherwise put us mid-ocean.
      const centerBias = Math.max(0, 1 - distFromSpawn / 150) * 0.45;
      cont = Math.min(1, cont + centerBias);
      const oceanFactor = Math.max(0, Math.min(1, cont / 0.55)); // 0..1
      const dip = (1 - oceanFactor) * (1 - oceanFactor) * 48;    // 0..48
      hill *= 0.25 + oceanFactor * 0.75;                          // flatten hills underwater

      // Lakes: a separate low-freq noise creates depressions below sea
      // level on land. Lake bed drops by up to BI.lakeDepth. Ice biome
      // lakes freeze solid (handled below).
      const lakeN = noise.height(sx * BI.lakeFreq + 314, sz * BI.lakeFreq - 271, 3);
      const lakeMask = oceanFactor > 0.5 && lakeN > 0.62 ? (lakeN - 0.62) / 0.38 : 0;
      const lakeDip = lakeMask * lakeMask * BI.lakeDepth;

      const h = Math.floor(W.baseHeight + hill * W.hillHeight + mtn * W.mountainHeight - dip - lakeDip);
      const surface = Math.max(1, Math.min(CHUNK_HEIGHT - 6, h));
      const isLake = lakeDip > 1 && surface < W.baseHeight + 4;

      for (let y = 0; y <= surface; y++) {
        let id;
        if (y === 0) id = B.BEDROCK;
        else if (y === surface) {
          // Surface block depends on biome + height + lake state.
          if (surface <= W.seaLevel + 1) id = B.SAND;
          else if (adjustedBiome === "desert") id = B.SAND;
          else if (adjustedBiome === "ice") id = B.SNOW;
          else if (isLake) id = B.DIRT;
          else id = B.GRASS;
        }
        else if (y >= surface - 3) {
          // Subsurface: sand in desert, dirt elsewhere. Ice biome keeps a
          // thin dirt layer under the snow so the player isn't walking on
          // permafrost down to stone.
          id = adjustedBiome === "desert" ? B.SAND : B.DIRT;
        }
        else id = B.STONE;

        // Ore veins underground. Two-octave noise check produces smaller,
        // more scattered veins than a single threshold.
        if (id === B.STONE) {
          for (const [oreId, ore] of ORE_TABLE) {
            const depth = surface - y;
            if (depth < ore.minDepth) continue;
            const f = ore.freq || 0.15;
            const a = noise.noise3(wx * f + oreId, y * f, wz * f);
            const b = noise.noise3(wx * f * 2.3 + 99, y * f * 2.3 + 99, wz * f * 2.3 - 99);
            // Both octaves must clear (threshold - margin) so veins stay small.
            if (a > ore.threshold && b > ore.threshold - 0.08) {
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

      // ---- Water / ice fill ----
      // Oceans and lakes fill with water normally; ice biome freezes the top
      // few layers into solid ICE so the player can walk across. Glaciers
      // rise a couple of blocks above sea level in the ice biome for relief.
      if (surface < W.seaLevel) {
        const fillTop = W.seaLevel;
        for (let y = surface + 1; y <= fillTop; y++) {
          const isSurfaceLayer = y >= fillTop - 2;
          chunk.blocks[chunk.idx(x, y, z)] =
            (adjustedBiome === "ice" && isSurfaceLayer) ? B.ICE : B.WATER;
        }
        // Seagrass on the seabed if it's not too deep (≤ 4 blocks of water).
        if (W.seaLevel - surface <= 4 &&
            (chunk.blocks[chunk.idx(x, surface, z)] === B.SAND ||
             chunk.blocks[chunk.idx(x, surface, z)] === B.DIRT) &&
            noise.hash(wx, 29, wz) < 0.08) {
          chunk.blocks[chunk.idx(x, surface + 1, z)] = B.SEAGRASS;
        }
      }

      // Glaciers in ice biome: occasional column rises 1-3 blocks of ice
      // above the snow surface to give the landscape relief.
      if (adjustedBiome === "ice" && surface > W.seaLevel &&
          noise.hash(wx, 19, wz) < BI.glacierChance) {
        const glacierH = 1 + Math.floor(noise.hash(wx, 23, wz) * 3);
        for (let dy = 0; dy < glacierH; dy++) {
          if (surface + 1 + dy < CHUNK_HEIGHT)
            chunk.blocks[chunk.idx(x, surface + 1 + dy, z)] = B.ICE;
        }
      }

      // Trees: only in normal biome on grass, away from chunk borders.
      if (adjustedBiome === "normal" &&
          chunk.blocks[chunk.idx(x, surface, z)] === B.GRASS &&
          x > 2 && x < CHUNK_SIZE - 3 && z > 2 && z < CHUNK_SIZE - 3 &&
          noise.hash(wx, 7, wz) < CONFIG.tree.density) {
        treesHere.push({ x, y: surface + 1, z, height: CONFIG.tree.minHeight +
          Math.floor(noise.hash(wx, 13, wz) * (CONFIG.tree.maxHeight - CONFIG.tree.minHeight + 1)) });
      }
      // Cacti: in desert biome, 1-3 blocks tall. Same interior-border rule
      // so a cactus never straddles a chunk boundary.
      if (adjustedBiome === "desert" &&
          chunk.blocks[chunk.idx(x, surface, z)] === B.SAND &&
          x > 1 && x < CHUNK_SIZE - 2 && z > 1 && z < CHUNK_SIZE - 2 &&
          noise.hash(wx, 91, wz) < BI.cactusDensity) {
        cactiHere.push({ x, y: surface + 1, z,
          height: 1 + Math.floor(noise.hash(wx, 17, wz) * 3) });
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
  for (const c of cactiHere) {
    if (c.y + c.height > CHUNK_HEIGHT) continue;
    for (let i = 0; i < c.height; i++)
      chunk.blocks[chunk.idx(c.x, c.y + i, c.z)] = B.CACTUS;
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

  // Trading house: rare, deterministic structure (~1 per 250 blocks).
  tryPlaceTradingHouse(chunk, baseX, baseZ, noise);

  chunk.dirty = true;
  return chunk;
}

// Probability per chunk ≈ CHUNK_SIZE² / 250². A hash on chunk coords decides
// whether this chunk gets a house. Density is roughly one house per 250×250
// block area — explorable but not dense.
const TRADER_DENSITY = (CHUNK_SIZE * CHUNK_SIZE) / (250 * 250);
function tryPlaceTradingHouse(chunk, baseX, baseZ, noise) {
  // Deterministic per-chunk hash so the house is at the same place every load.
  if (noise.hash(baseX, 4242, baseZ) >= TRADER_DENSITY) return false;
  // House footprint: 5x5 centered at (cx, _, cz), well inside chunk bounds.
  const cx = 7, cz = 7;
  const floorY = Math.max(W.seaLevel + 1, surfaceHeightAt(chunk, cx, cz));
  if (floorY + 5 >= CHUNK_HEIGHT) return false;
  // Bail if the ground floor is water — we don't want houses in the ocean.
  const ground = chunk.blocks[chunk.idx(cx, floorY - 1, cz)];
  if (ground === B.WATER || ground === B.AIR) return false;
  // Center the 5x5 footprint on (cx, cz): columns cx-2..cx+2.
  const x0 = cx - 2, x1 = cx + 2, z0 = cz - 2, z1 = cz + 2;
  for (let y = floorY; y <= floorY + 4; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const isWall = (x === x0 || x === x1 || z === z0 || z === z1);
        if (y === floorY) {
          // Solid plank floor so the trader has a clean surface.
          chunk.blocks[chunk.idx(x, y, z)] = B.PLANKS;
        } else if (y === floorY + 4) {
          // Roof: wood-bordered planks.
          chunk.blocks[chunk.idx(x, y, z)] = (x === x0 || x === x1 || z === z0 || z === z1) ? B.WOOD : B.PLANKS;
        } else if (isWall) {
          // Walls: planks with a door on the +z side and a torch opposite.
          if (x === cx && z === z1) {
            // Door gap — handled below.
            chunk.blocks[chunk.idx(x, y, z)] = B.AIR;
          } else {
            chunk.blocks[chunk.idx(x, y, z)] = B.PLANKS;
          }
        } else {
          // Interior: clear air, drop a trader block in the centre on the
          // first above-floor layer.
          chunk.blocks[chunk.idx(x, y, z)] = B.AIR;
        }
      }
    }
  }
  // Place the trader block in the centre on the floor.
  chunk.blocks[chunk.idx(cx, floorY + 1, cz)] = B.TRADER;
  // Door on the +z face, two blocks tall.
  chunk.blocks[chunk.idx(cx, floorY + 1, z1)] = B.DOOR;
  chunk.blocks[chunk.idx(cx, floorY + 2, z1)] = B.DOOR_TOP;
  // Torch on the back wall for light.
  chunk.blocks[chunk.idx(cx, floorY + 2, z0)] = B.TORCH;
  // Mark this chunk as containing a trader so the World class can resolve
  // initial offers later (via lazy generation in world.getTrader).
  chunk.hasTrader = true;
  return true;
}
// Local surface height (highest non-air, non-liquid block in column).
function surfaceHeightAt(chunk, x, z) {
  for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
    const b = chunk.blocks[chunk.idx(x, y, z)];
    if (b !== B.AIR && b !== B.WATER && b !== B.LEAVES) return y;
  }
  return 0;
}
