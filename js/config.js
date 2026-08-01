// All tunable values in one place.
export const CONFIG = {
  world: {
    chunkSize: 16,        // x/z size of a chunk in blocks
    chunkHeight: 120,     // y size
    renderDistance: 3,    // chunks in each direction from player
    seaLevel: 14,
    baseHeight: 22,
    hillHeight: 20,
    mountainHeight: 90,   // peaks when mountain noise is high
    dayLengthSeconds: 600, // 10 real minutes per in-game day
  },
  player: {
    eyeHeight: 1.6,
    width: 0.6,
    height: 1.8,
    speed: 4.3,           // m/s walking
    sprint: 7.0,
    jump: 8.0,
    gravity: 24,
    flySpeed: 9,
  },
  mining: {
    range: 5,
    baseTime: 0.55,       // seconds per block hardness unit
  },
  ores: {
    // Higher frequency in worldgen → smaller, more scattered veins. Lower
    // thresholds = ore appears more often. Tuned for 1.0 so the underground
    // feels generous without becoming a treasure chest.
    iron:    { minDepth: 3,  threshold: 0.74, color: "#7a6a55", freq: 0.16 },
    gold:    { minDepth: 8,  threshold: 0.78, color: "#807038", freq: 0.16 },
    diamond: { minDepth: 14, threshold: 0.82, color: "#5a6868", freq: 0.18 },
    platinum:{ minDepth: 18, threshold: 0.78, color: "#a8acb0", freq: 0.18 },
  },
  tree: {
    minHeight: 4,
    maxHeight: 7,
    health: 6,            // per log block
    density: 0.012,       // chance per surface column
  },
  biomes: {
    // Very low frequency noise + strong domain warp → big flowing biomes
    // with curving organic boundaries (not stripes, not squares).
    freq: 0.0014,
    warpAmp: 180,
    iceBand: 0.40,
    desertBand: 0.60,
    cactusDensity: 0.025,
    lakeFreq: 0.012,
    lakeDepth: 6,
    glacierChance: 0.4,
    spawnSafeRadius: 120,
  },
};
