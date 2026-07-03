// Block registry. Each block: id, name, color (for texture), solidity, etc.
export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, WOOD: 5, LEAVES: 6,
  PLANKS: 7, BEAM: 8, WALL_STONE: 9, WALL_WOOD: 10, FIREPLACE: 11,
  IRON_ORE: 12, GOLD_ORE: 13, DIAMOND_ORE: 14, PLATINUM_ORE: 15,
  COBBLE: 16, GLASS: 17, BRICK: 18, ARCH: 19, TORCH: 20,
  IRON_BLOCK: 21, GOLD_BLOCK: 22, DIAMOND_BLOCK: 23, PLATINUM_BLOCK: 24,
  BEDROCK: 25, WATER: 26,
};

export const BLOCKS = {
  [B.AIR]:    { name: "air",     solid: false, transparent: true },
  [B.GRASS]:  { name: "grass",   solid: true,  hardness: 0.6, top: "#5fa83a", side: "#8a6a3a", bottom: "#6a4a2a" },
  [B.DIRT]:   { name: "dirt",    solid: true,  hardness: 0.6, color: "#6a4a2a" },
  [B.STONE]:  { name: "stone",   solid: true,  hardness: 1.5, color: "#888888" },
  [B.SAND]:   { name: "sand",    solid: true,  hardness: 0.5, color: "#e3d9a2" },
  [B.WOOD]:   { name: "wood",    solid: true,  hardness: 1.2, top: "#a07a3a", side: "#6b4a1f", treeHealth: true },
  [B.LEAVES]: { name: "leaves",  solid: true,  hardness: 0.3, color: "#3a7a2a", transparent: true },
  [B.PLANKS]: { name: "planks",  solid: true,  hardness: 1.0, color: "#c89656" },
  [B.BEAM]:   { name: "beam",    solid: true,  hardness: 1.0, color: "#8a5f28" },
  [B.WALL_STONE]: { name: "wall_stone", solid: true, hardness: 3.0, color: "#6e6e72" },
  [B.WALL_WOOD]:  { name: "wall_wood",  solid: true, hardness: 2.0, color: "#7a5a2a" },
  [B.FIREPLACE]: { name: "fireplace", solid: true, hardness: 3.5, color: "#3a2a1a", light: 14 },
  [B.IRON_ORE]: { name: "iron_ore", solid: true, hardness: 2.5, color: "#caa472" },
  [B.GOLD_ORE]: { name: "gold_ore", solid: true, hardness: 3.0, color: "#ffd700" },
  [B.DIAMOND_ORE]: { name: "diamond_ore", solid: true, hardness: 4.0, color: "#7afcff" },
  [B.PLATINUM_ORE]: { name: "platinum_ore", solid: true, hardness: 5.0, color: "#e8e8f0" },
  [B.COBBLE]: { name: "cobble", solid: true, hardness: 1.8, color: "#7c7c80" },
  [B.GLASS]:  { name: "glass", solid: true, hardness: 0.4, color: "#bcd8e8", transparent: true },
  [B.BRICK]:  { name: "brick", solid: true, hardness: 2.5, color: "#a23a2a" },
  [B.ARCH]:   { name: "arch", solid: false, hardness: 1.2, color: "#c89656", transparent: true, decor: true },
  [B.TORCH]:  { name: "torch", solid: false, hardness: 0.2, color: "#ffaa33", transparent: true, light: 12 },
  [B.IRON_BLOCK]: { name: "iron_block", solid: true, hardness: 3.5, color: "#dcdcdc" },
  [B.GOLD_BLOCK]: { name: "gold_block", solid: true, hardness: 3.5, color: "#ffe040" },
  [B.DIAMOND_BLOCK]: { name: "diamond_block", solid: true, hardness: 4.5, color: "#8af6ff" },
  [B.PLATINUM_BLOCK]: { name: "platinum_block", solid: true, hardness: 5.0, color: "#f0f0f8" },
  [B.BEDROCK]: { name: "bedrock", solid: true, hardness: Infinity, color: "#1a1a1a" },
  [B.WATER]:  { name: "water", solid: false, hardness: Infinity, color: "#3a6acc", transparent: true, liquid: true },
};

export const isSolid = (id) => id !== B.AIR && !!BLOCKS[id]?.solid;
export const isTransparent = (id) => id === B.AIR || !!BLOCKS[id]?.transparent;
export const isLiquid = (id) => !!BLOCKS[id]?.liquid;
export const isDecor = (id) => !!BLOCKS[id]?.decor;
