import { Inventory } from "./inventory.js";
import { RECIPES } from "./recipes.js";

export function canCraft(inv, recipe, context = {}) {
  if (recipe.needsFire && !context.nearFire) return false;
  return recipe.in.every((c) => inv.has(c.id, c.count));
}

export function craft(inv, recipe, context = {}) {
  if (!canCraft(inv, recipe, context)) return false;
  for (const c of recipe.in) inv.remove(c.id, c.count);
  const [outId, outCount] = recipe.out;
  inv.add(outId, outCount);
  return true;
}
