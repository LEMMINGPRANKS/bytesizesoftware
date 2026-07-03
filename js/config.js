// All tunable values in one place.
export const CONFIG = {
  world: {
    chunkSize: 16,        // x/z size of a chunk in blocks
    chunkHeight: 64,      // y size
    renderDistance: 4,    // chunks in each direction from player
    seaLevel: 12,
    baseHeight: 18,
    hillHeight: 22,
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
    iron:    { minDepth: 6,  rarity: 0.04, color: "#caa472" },
    gold:    { minDepth: 14, rarity: 0.012, color: "#ffd700" },
    diamond: { minDepth: 22, rarity: 0.006, color: "#7afcff" },
    platinum:{ minDepth: 28, rarity: 0.0035, color: "#e8e8f0" },
  },
  tree: {
    minHeight: 4,
    maxHeight: 7,
    health: 6,            // per log block
    density: 0.012,       // chance per surface column
  },
};
