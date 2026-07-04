// All tunable values in one place.
export const CONFIG = {
  world: {
    chunkSize: 16,        // x/z size of a chunk in blocks
    chunkHeight: 120,     // y size
    renderDistance: 3,    // chunks in each direction from player
    seaLevel: 14,
    baseHeight: 22,
    hillHeight: 20,
    mountainHeight: 45,   // peaks when mountain noise is high
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
    baseTime: 0.32,       // seconds per block hardness unit
  },
  ores: {
    iron:    { minDepth: 4,  threshold: 0.82, color: "#caa472" },
    gold:    { minDepth: 12, threshold: 0.90, color: "#ffd700" },
    diamond: { minDepth: 22, threshold: 0.93, color: "#7afcff" },
    platinum:{ minDepth: 32, threshold: 0.95, color: "#e8e8f0" },
  },
  tree: {
    minHeight: 4,
    maxHeight: 7,
    health: 6,            // per log block
    density: 0.012,       // chance per surface column
  },
};
