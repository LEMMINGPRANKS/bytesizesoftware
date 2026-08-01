// Recipe definitions. Each recipe: output block id + count, and a list of
// inputs {id, count}. Plus some "decorative" variants.
import { B } from "../world/blocks.js";

export const RECIPES = [
  { out: [B.PLANKS, 4],    in: [{ id: B.WOOD, count: 1 }],            name: "Planks ×4" },
  { out: [B.COBBLE, 1],    in: [{ id: B.STONE, count: 1 }],           name: "Cobblestone" },
  { out: [B.BRICK, 4],     in: [{ id: B.COBBLE, count: 2 }],          name: "Bricks ×4" },
  { out: [B.GLASS, 1],     in: [{ id: B.SAND, count: 1 }],            name: "Glass" },
  { out: [B.FIREPLACE, 1], in: [{ id: B.COBBLE, count: 4 }, { id: B.WOOD, count: 1 }], name: "Fireplace" },
  { out: [B.TORCH, 4],     in: [{ id: B.WOOD, count: 1 }],            name: "Torch ×4" },
  { out: [B.CHEST, 1],     in: [{ id: B.PLANKS, count: 4 }], name: "Chest (27 storage slots)" },
  { out: [B.DOOR, 1],      in: [{ id: B.PLANKS, count: 3 }], name: "Door (right-click to open)" },
  { out: [B.TRADER, 1],    in: [{ id: B.PLANKS, count: 4 }, { id: B.GOLD_ORE, count: 2 }], name: "Trader stall (build your own market)" },
  { out: [B.IRON_BLOCK, 1], in: [{ id: B.IRON_ORE, count: 9 }],       name: "Iron Block" },
  { out: [B.GOLD_BLOCK, 1], in: [{ id: B.GOLD_ORE, count: 9 }],       name: "Gold Block" },
  { out: [B.DIAMOND_BLOCK, 1], in: [{ id: B.DIAMOND_ORE, count: 9 }], name: "Diamond Block" },
  { out: [B.PLATINUM_BLOCK, 1], in: [{ id: B.PLATINUM_ORE, count: 9 }], name: "Platinum Block" },
  { out: [B.COOKED_BEEF, 1], in: [{ id: B.RAW_BEEF, count: 1 }], name: "Cook Raw Beef (needs fireplace)", needsFire: true },
  { out: [B.COOKED_FISH, 1], in: [{ id: B.RAW_FISH, count: 1 }], name: "Cook Raw Fish (needs fireplace)", needsFire: true },
  { out: [B.PICKAXE_WOOD, 1],     in: [{ id: B.PLANKS, count: 3 }, { id: B.TWIG, count: 1 }],            name: "Wood Pickaxe (mines stone)" },
  { out: [B.PICKAXE_STONE, 1],    in: [{ id: B.COBBLE, count: 3 }, { id: B.TWIG, count: 1 }],            name: "Stone Pickaxe (mines iron, gold)" },
  { out: [B.PICKAXE_IRON, 1],     in: [{ id: B.IRON_BLOCK, count: 1 }, { id: B.TWIG, count: 1 }],        name: "Iron Pickaxe (mines diamond)" },
  { out: [B.PICKAXE_DIAMOND, 1],  in: [{ id: B.DIAMOND_BLOCK, count: 1 }, { id: B.TWIG, count: 1 }],     name: "Diamond Pickaxe (mines platinum)" },
  { out: [B.PICKAXE_PLATINUM, 1], in: [{ id: B.PLATINUM_BLOCK, count: 1 }, { id: B.TWIG, count: 1 }],    name: "Platinum Pickaxe (best — mines everything)" },
  { out: [B.SHOVEL_WOOD,     1], in: [{ id: B.PLANKS, count: 3 },        { id: B.TWIG, count: 1 }], name: "Wood Shovel (digs dirt/sand)" },
  { out: [B.SHOVEL_STONE,    1], in: [{ id: B.COBBLE, count: 3 },        { id: B.TWIG, count: 1 }], name: "Stone Shovel" },
  { out: [B.SHOVEL_IRON,     1], in: [{ id: B.IRON_BLOCK, count: 1 },    { id: B.TWIG, count: 1 }], name: "Iron Shovel" },
  { out: [B.SHOVEL_DIAMOND,  1], in: [{ id: B.DIAMOND_BLOCK, count: 1 }, { id: B.TWIG, count: 1 }], name: "Diamond Shovel" },
  { out: [B.SHOVEL_PLATINUM, 1], in: [{ id: B.PLATINUM_BLOCK, count: 1 },{ id: B.TWIG, count: 1 }], name: "Platinum Shovel (fastest dig)" },
  { out: [B.BUCKET, 1], in: [{ id: B.IRON_BLOCK, count: 1 }], name: "Bucket (pick up & place water/lava)" },
  { out: [B.WIRE, 8], in: [{ id: B.IRON_ORE, count: 1 }], name: "Wire ×8 (carries power from levers to lamps)" },
  { out: [B.LEVER, 1], in: [{ id: B.PLANKS, count: 1 }, { id: B.COBBLE, count: 1 }], name: "Lever (click to toggle power)" },
  { out: [B.LAMP, 1], in: [{ id: B.IRON_BLOCK, count: 1 }, { id: B.TORCH, count: 1 }], name: "Lamp (lights up when powered)" },
  { out: [B.GRANITE, 4], in: [{ id: B.STONE, count: 4 }], name: "Granite ×4" },
  { out: [B.MARBLE, 4], in: [{ id: B.STONE, count: 4 }, { id: B.SAND, count: 1 }], name: "Marble ×4" },
  { out: [B.BASALT, 4], in: [{ id: B.COBBLE, count: 4 }], name: "Basalt ×4" },
];

// Tool tier hints (informational): wood < stone < iron < gold < diamond < platinum.
export const TOOL_TIERS = ["Wood", "Stone", "Iron", "Gold", "Diamond", "Platinum"];
