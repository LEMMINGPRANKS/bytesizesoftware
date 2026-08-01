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

export function generateChunk(cx, cz, noise, world) {
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
      // Very low frequency noise + domain warp → big flowing biomes with
      // curving boundaries. Spawn is forced to temperate within a radius so
      // the first day isn't a glacier or vast desert.
      const distFromSpawn = Math.hypot(wx, wz);
      const bwx = (noise.height(wx * 0.005 + 555, wz * 0.005, 2) - 0.5) * BI.warpAmp;
      const bwz = (noise.height(wx * 0.005 - 999, wz * 0.005 + 888, 2) - 0.5) * BI.warpAmp;
      const biomeNoise = noise.height((wx + bwx) * BI.freq + 7777, (wz + bwz) * BI.freq - 7777, 3);
      const adjustedBiome = distFromSpawn < BI.spawnSafeRadius
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

        // Decorative stone veins — granite, marble, basalt ribbons through the
        // stone layers to make caves visually distinct. Each block has its own
        // low-frequency noise so the veins don't overlap into a mess.
        if (id === B.STONE) {
          const gA = noise.noise3(wx * 0.08 + 11, y * 0.08 + 22, wz * 0.08 + 33);
          const gB = noise.noise3(wx * 0.18 + 44, y * 0.18 + 55, wz * 0.18 + 66);
          if (gA > 0.55 && gB > 0.45) id = B.GRANITE;
          else if (gA < -0.55 && gB < -0.4) {
            // Marble likes shallower depths (decorative capstone).
            if (surface - y < 16) id = B.MARBLE;
          } else {
            // Basalt likes depth — volcanic dark pockets.
            const bn = noise.noise3(wx * 0.07 + 700, y * 0.07 + 700, wz * 0.07 + 700);
            if (bn > 0.6 && surface - y > 14) id = B.BASALT;
          }
        }

        // Caves: tunnels carved by 3D noise. Two noises multiplied → wormy veins
        // instead of blobs. Only carve below surface so the ground stays solid.
        if (id === B.STONE && y < surface - 2 && y > 1) {
          const a = noise.noise3(wx * 0.05, y * 0.08, wz * 0.05);
          const b = noise.noise3(wx * 0.13 + 500, y * 0.13, wz * 0.13 - 500);
          if (a < 0.18 && b < 0.4) id = B.AIR;
        }
        // Lava pools: low caves near bedrock flood with lava. Risk-reward for
        // deep mining — diamonds + platinum sit at the same depth.
        if (id === B.AIR && y <= 6) id = B.LAVA;
        // Vibrant caves: place crystals (deep) and glow mushrooms (shallow) on
        // cave floors. The cell below is already written because columns are
        // built bottom-up. We can't have decor in lava, so the y<=6 check above
        // takes priority.
        if (id === B.AIR && y > 7 && y < surface - 2) {
          const below = chunk.blocks[chunk.idx(x, y - 1, z)];
          const isFloor = below === B.STONE || below === B.COBBLE ||
                          below === B.GRANITE || below === B.MARBLE ||
                          below === B.BASALT || below === B.DIRT;
          if (isFloor) {
            const depth = surface - y;
            // Crystals — deep, near diamond depth. Rare clusters.
            if (depth >= 12 && depth <= 30) {
              const cn = noise.noise3(wx * 0.4 + 17, y * 0.4 + 23, wz * 0.4 + 31);
              if (cn > 0.78) id = B.CRYSTAL;
            }
            // Glow mushrooms — shallower caves. Sparser, but enough to read.
            if (id === B.AIR && depth >= 4 && depth < 14) {
              const mn = noise.noise3(wx * 0.5 + 200, y * 0.5 + 200, wz * 0.5 + 200);
              if (mn > 0.82) id = B.GLOW_MUSHROOM;
            }
          }
        }
        chunk.blocks[chunk.idx(x, y, z)] = id;
      }

      // ---- Water / ice fill ----
      // Oceans and lakes fill with water normally; ice biome freezes the top
      // few layers into solid ICE so the player can walk across. Glaciers
      // rise a couple of blocks above sea level in the ice biome for relief.
      if (surface < W.seaLevel) {
        const fillTop = W.seaLevel;
        const depth = W.seaLevel - surface;
        for (let y = surface + 1; y <= fillTop; y++) {
          const isSurfaceLayer = y >= fillTop - 2;
          chunk.blocks[chunk.idx(x, y, z)] =
            (adjustedBiome === "ice" && isSurfaceLayer) ? B.ICE : B.WATER;
        }
        // Seagrass on the seabed if it's not too deep (≤ 4 blocks of water).
        if (depth <= 4 &&
            (chunk.blocks[chunk.idx(x, surface, z)] === B.SAND ||
             chunk.blocks[chunk.idx(x, surface, z)] === B.DIRT) &&
            noise.hash(wx, 29, wz) < 0.08) {
          chunk.blocks[chunk.idx(x, surface + 1, z)] = B.SEAGRASS;
        }
        // Kelp forests: tall strands in shallow temperate waters. Each kelp
        // column is 3-7 blocks tall, anchored to a sand/dirt seabed. Hash
        // keys on a higher freq so kelp clumps into patches.
        if (adjustedBiome === "normal" && depth >= 2 && depth <= 8 &&
            (chunk.blocks[chunk.idx(x, surface, z)] === B.SAND ||
             chunk.blocks[chunk.idx(x, surface, z)] === B.DIRT) &&
            noise.hash(wx * 0.6, 71, wz * 0.6) < 0.05) {
          const kH = 3 + Math.floor(noise.hash(wx, 73, wz) * 5);
          for (let i = 1; i <= kH && surface + i < W.seaLevel; i++) {
            chunk.blocks[chunk.idx(x, surface + i, z)] = B.KELP;
          }
        }
        // Coral reefs: warm shallow normal-biome waters only. Sparser than
        // kelp so reefs read as distinct clusters, not wallpaper.
        if (adjustedBiome === "normal" && depth >= 1 && depth <= 5 &&
            chunk.blocks[chunk.idx(x, surface, z)] === B.SAND &&
            noise.hash(wx * 0.8, 91, wz * 0.8) < 0.025) {
          chunk.blocks[chunk.idx(x, surface + 1, z)] = B.CORAL;
        }
      }

      // ---- Surface lava pools (volcanic patches) ----
      // Rare surface vents in desert + normal biomes, away from spawn so the
      // first day isn't "spawn into lava". A coarse hash carves out a small
      // basin: surrounding ring → COBBLE walls, interior → STONE floor with
      // LAVA pooling 1-2 blocks below the rim. Continuous with the terrain
      // so it doesn't look stamped-on.
      if (surface > W.seaLevel + 2 && distFromSpawn > 80 &&
          (adjustedBiome === "desert" || adjustedBiome === "normal")) {
        const volcanoN = noise.height(wx * 0.012 + 1234, wz * 0.012 - 4321, 3);
        if (volcanoN > 0.86) {
          // Carve a shallow bowl: deepen the column by 2-3 blocks.
          const dipDepth = 2 + Math.floor(noise.hash(wx, 5656, wz) * 2);
          for (let dy = 0; dy < dipDepth; dy++) {
            chunk.blocks[chunk.idx(x, surface - dy, z)] = B.AIR;
          }
          // Floor: stone, then lava on top.
          const floorY = surface - dipDepth;
          chunk.blocks[chunk.idx(x, floorY, z)] = B.STONE;
          if (floorY + 1 < CHUNK_HEIGHT) {
            chunk.blocks[chunk.idx(x, floorY + 1, z)] = B.LAVA;
          }
          // Rim ring: cells that are at the edge of the volcanic patch (per
          // a slightly wider noise threshold) become raised cobble so the
          // pool reads as a basin rather than a flat spill.
          const ringN = noise.height(wx * 0.012 + 1234, wz * 0.012 - 4321, 4);
          if (ringN > 0.82 && ringN <= volcanoN) {
            chunk.blocks[chunk.idx(x, surface + 1, z)] = B.COBBLE;
          }
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

// ---- Moon dimension generation ----
// Low rolling grey hills + impact craters + dense platinum veins (it's the
// moon, after all). No water, no atmosphere — surface is moon_dust on top,
// moon_rock underneath, moon_stone at depth. Rare lava pockets deep below.
export function generateMoonChunk(cx, cz, noise) {
  const chunk = new Chunk(cx, cz);
  const baseX = cx * CHUNK_SIZE, baseZ = cz * CHUNK_SIZE;

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = baseX + x, wz = baseZ + z;

      // Gentle rolling surface.
      let h = noise.height(wx * 0.01, wz * 0.01, 4);
      h = Math.floor(20 + (h - 0.5) * 14);

      // Impact craters: scattered depressions. A coarse noise picks crater
      // centres; the radial profile is bowl-shaped with a raised rim.
      const cn = noise.height(wx * 0.04 + 777, wz * 0.04 - 333, 3);
      if (cn > 0.85) {
        // Bowl depth proportional to noise intensity.
        const depth = (cn - 0.85) * 80;
        h = Math.max(8, h - Math.floor(depth));
      }

      const surface = Math.max(2, Math.min(CHUNK_HEIGHT - 6, h));

      for (let y = 0; y <= surface; y++) {
        let id;
        if (y === 0) id = B.BEDROCK;
        else if (y === surface) id = B.MOON_DUST;
        else if (y >= surface - 2) id = B.MOON_ROCK;
        else id = B.MOON_STONE;

        // Abundant platinum veins — much more common than on Earth.
        if (id === B.MOON_STONE) {
          const a = noise.noise3(wx * 0.18 + 9, y * 0.18 + 9, wz * 0.18 + 9);
          const b2 = noise.noise3(wx * 0.4 + 50, y * 0.4 + 50, wz * 0.4 + 50);
          if (a > 0.4 && b2 > 0.25) id = B.PLATINUM_ORE;
        }

        // Carved-out caves — fewer, smaller than overworld.
        if (id === B.MOON_STONE && y < surface - 3 && y > 2) {
          const a = noise.noise3(wx * 0.06, y * 0.09, wz * 0.06);
          if (a < 0.12) id = B.AIR;
        }
        // Rare deep lava pockets (not the focus, just risk).
        if (id === B.AIR && y <= 4) id = B.LAVA;
        chunk.blocks[chunk.idx(x, y, z)] = id;
      }
    }
  }

  chunk.dirty = true;
  return chunk;
}

