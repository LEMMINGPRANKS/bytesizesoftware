// Trees: store health per tree log position. When any log of a tree is hit,
// damage is dealt to the tree as a whole (a tree has a single shared hp).
// When hp reaches 0, every log in the tree is broken and dropped.
import { CONFIG } from "../config.js";
import { B, isSolid } from "../world/blocks.js";

export class TreeSystem {
  constructor(world) {
    this.world = world;
    // map: any logPosString -> treeId; treeId -> { hp, logs: Set(posString) }
    this.logToTree = new Map();
    this.trees = new Map();
    this.nextId = 1;
  }

  _key(x, y, z) { return `${x},${y},${z}`; }

  // When a player breaks a WOOD block, register the tree on demand and apply
  // damage. Returns true if the block should be removed.
  hitLog(x, y, z, dmg = 1) {
    const k = this._key(x, y, z);
    let treeId = this.logToTree.get(k);
    let tree;
    if (!treeId) {
      // Discover connected WOOD column by walking up/down from this log.
      const logs = new Set();
      // Find base (lowest log): walk down.
      let bx = x, by = y, bz = z;
      while (this.world.getBlock(bx, by - 1, bz) === B.WOOD) by--;
      // Walk up collecting all logs and any adjacent leaves.
      let cy = by;
      while (this.world.getBlock(bx, cy, bz) === B.WOOD) {
        logs.add(this._key(bx, cy, bz));
        cy++;
      }
      treeId = this.nextId++;
      tree = { hp: CONFIG.tree.health * logs.size, logs };
      for (const lk of logs) this.logToTree.set(lk, treeId);
      this.trees.set(treeId, tree);
    } else {
      tree = this.trees.get(treeId);
    }
    tree.hp -= dmg * 2; // a hit is meaningful
    if (tree.hp > 0) return false;
    // Tree felled: drop all logs.
    for (const lk of tree.logs) {
      const [lx, ly, lz] = lk.split(",").map(Number);
      this.world.setBlock(lx, ly, lz, B.AIR);
    }
    this.trees.delete(treeId);
    for (const lk of tree.logs) this.logToTree.delete(lk);
    return { logs: tree.logs.size };
  }
}
