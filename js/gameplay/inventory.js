// Inventory: { blockId: count }. Hotbar holds up to 9 selected items.
import { B, BLOCKS } from "../world/blocks.js";

export class Inventory {
  constructor() {
    this.items = {};            // id -> count
    this.hotbar = [null, null, null, null, null, null, null, null, null];
    this.active = 0;
  }
  add(id, count = 1) {
    if (id === B.AIR) return;
    this.items[id] = (this.items[id] || 0) + count;
    if (!this.hotbar.includes(id)) {
      const slot = this.hotbar.findIndex((s) => s === null);
      if (slot >= 0) this.hotbar[slot] = id;
    }
  }
  remove(id, count = 1) {
    if ((this.items[id] || 0) < count) return false;
    this.items[id] -= count;
    if (this.items[id] <= 0) delete this.items[id];
    // Clean hotbar slots that no longer have stock.
    for (let i = 0; i < this.hotbar.length; i++) {
      if (this.hotbar[i] === id && (this.items[id] || 0) === 0) this.hotbar[i] = null;
    }
    return true;
  }
  count(id) { return this.items[id] || 0; }
  has(id, n = 1) { return this.count(id) >= n; }
  selected() { return this.hotbar[this.active]; }
  name(id) { return BLOCKS[id]?.name || "?"; }
}
