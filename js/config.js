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
    // thresholds for the rare tiers so they appear more often despite each
    // vein being smaller.
    iron:    { minDepth: 4,  threshold: 0.80, color: "#caa472", freq: 0.16 },
    gold:    { minDepth: 10, threshold: 0.84, color: "#ffd700", freq: 0.16 },
    diamond: { minDepth: 18, threshold: 0.88, color: "#7afcff", freq: 0.18 },
    platinum:{ minDepth: 28, threshold: 0.90, color: "#e8e8f0", freq: 0.18 },
  },
  tree: {
    minHeight: 4,
    maxHeight: 7,
    health: 6,            // per log block
    density: 0.012,       // chance per surface column
  },
};
