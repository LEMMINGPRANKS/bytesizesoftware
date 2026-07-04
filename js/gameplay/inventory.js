// Inventory: hotbar (9 slots) + main (27 slots). Counts are stored as a
// flat map id→count; slot arrays just record which id lives where. An id
// can sit in either the hotbar or main; null means empty slot.
import { B, BLOCKS } from "../world/blocks.js";

const HOTBAR_SIZE = 9;
const MAIN_SIZE = 27;

export class Inventory {
  constructor() {
    this.items = {};
    this.hotbar = new Array(HOTBAR_SIZE).fill(null);
    this.main = new Array(MAIN_SIZE).fill(null);
    this.active = 0;
  }
  // Place an id into the first empty hotbar slot, then first empty main slot.
  _assign(id) {
    if (this.hotbar.includes(id) || this.main.includes(id)) return;
    let i = this.hotbar.findIndex((s) => s === null);
    if (i >= 0) { this.hotbar[i] = id; return; }
    i = this.main.findIndex((s) => s === null);
    if (i >= 0) this.main[i] = id;
  }
  add(id, count = 1) {
    if (id === B.AIR) return;
    this.items[id] = (this.items[id] || 0) + count;
    if (this.items[id] === Infinity) this.items[id] = Infinity;
    this._assign(id);
  }
  remove(id, count = 1) {
    if ((this.items[id] || 0) < count) return false;
    this.items[id] -= count;
    if ((this.items[id] || 0) <= 0) {
      delete this.items[id];
      for (let i = 0; i < this.hotbar.length; i++) if (this.hotbar[i] === id) this.hotbar[i] = null;
      for (let i = 0; i < this.main.length; i++) if (this.main[i] === id) this.main[i] = null;
    }
    return true;
  }
  count(id) { return this.items[id] || 0; }
  has(id, n = 1) { return this.count(id) >= n; }
  selected() { return this.hotbar[this.active]; }
  name(id) { return BLOCKS[id]?.name || "?"; }
  // Swap whatever's held (the carried stack) with the slot's contents.
  // `carried` is a mutable {id, count} ref or null. Returns updated carried.
  swapWith(slotArr, idx, carried) {
    const cur = slotArr[idx];
    if (carried && cur === null) {
      slotArr[idx] = carried.id;
      carried = null;
    } else if (carried && cur !== null && cur === carried.id) {
      // No-op: same id, count is already global
      carried = null;
    } else if (carried && cur !== null) {
      slotArr[idx] = carried.id;
      carried = { id: cur };
    } else if (!carried && cur !== null) {
      carried = { id: cur };
      slotArr[idx] = null;
    }
    return carried;
  }
}

