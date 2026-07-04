// Recipe definitions. Each recipe: output block id + count, and a list of
// inputs {id, count}. Plus some "decorative" variants.
import { B } from "../world/blocks.js";

export const RECIPES = [
  { out: [B.PLANKS, 4],    in: [{ id: B.WOOD, count: 1 }],            name: "Planks ×4" },
  { out: [B.BEAM, 2],      in: [{ id: B.PLANKS, count: 2 }],          name: "Beams ×2" },
  { out: [B.WALL_WOOD, 1], in: [{ id: B.PLANKS, count: 1 }, { id: B.BEAM, count: 1 }], name: "Wood Wall" },
  { out: [B.COBBLE, 1],    in: [{ id: B.STONE, count: 1 }],           name: "Cobblestone" },
  { out: [B.WALL_STONE, 1],in: [{ id: B.COBBLE, count: 4 }],          name: "Stone Wall" },
  { out: [B.BRICK, 4],     in: [{ id: B.COBBLE, count: 2 }],          name: "Bricks ×4" },
  { out: [B.GLASS, 1],     in: [{ id: B.SAND, count: 1 }],            name: "Glass" },
  { out: [B.FIREPLACE, 1], in: [{ id: B.COBBLE, count: 4 }, { id: B.WOOD, count: 1 }], name: "Fireplace" },
  { out: [B.TORCH, 4],     in: [{ id: B.WOOD, count: 1 }],            name: "Torch ×4" },
  { out: [B.ARCH, 1],      in: [{ id: B.BEAM, count: 2 }, { id: B.PLANKS, count: 1 }], name: "Arch" },
  { out: [B.IRON_BLOCK, 1], in: [{ id: B.IRON_ORE, count: 9 }],       name: "Iron Block" },
  { out: [B.GOLD_BLOCK, 1], in: [{ id: B.GOLD_ORE, count: 9 }],       name: "Gold Block" },
  { out: [B.DIAMOND_BLOCK, 1], in: [{ id: B.DIAMOND_ORE, count: 9 }], name: "Diamond Block" },
  { out: [B.PLATINUM_BLOCK, 1], in: [{ id: B.PLATINUM_ORE, count: 9 }], name: "Platinum Block" },
  { out: [B.COOKED_BEEF, 1], in: [{ id: B.RAW_BEEF, count: 1 }], name: "Cook Raw Beef (needs fireplace)", needsFire: true },
  { out: [B.COOKED_FISH, 1], in: [{ id: B.RAW_FISH, count: 1 }], name: "Cook Raw Fish (needs fireplace)", needsFire: true },
  { out: [B.PICKAXE_WOOD, 1],     in: [{ id: B.PLANKS, count: 3 }, { id: B.BEAM, count: 1 }],            name: "Wood Pickaxe (mines stone)" },
  { out: [B.PICKAXE_STONE, 1],    in: [{ id: B.COBBLE, count: 3 }, { id: B.BEAM, count: 1 }],            name: "Stone Pickaxe (mines iron, gold)" },
  { out: [B.PICKAXE_IRON, 1],     in: [{ id: B.IRON_BLOCK, count: 1 }, { id: B.BEAM, count: 1 }],        name: "Iron Pickaxe (mines diamond)" },
  { out: [B.PICKAXE_DIAMOND, 1],  in: [{ id: B.DIAMOND_BLOCK, count: 1 }, { id: B.BEAM, count: 1 }],     name: "Diamond Pickaxe (mines platinum)" },
  { out: [B.PICKAXE_PLATINUM, 1], in: [{ id: B.PLATINUM_BLOCK, count: 1 }, { id: B.BEAM, count: 1 }],    name: "Platinum Pickaxe (best — mines everything)" },
];

// Tool tier hints (informational): wood < stone < iron < gold < diamond < platinum.
export const TOOL_TIERS = ["Wood", "Stone", "Iron", "Gold", "Diamond", "Platinum"];
