// Save/load to localStorage. Up to 10 slots. Each slot stores the seed,
// player state, inventory, hunger, and the player's block edits as a delta
// map keyed by "x,y,z". On load, the world regenerates from the seed and
// then the delta is replayed — so we never persist whole chunks.
const KEY = (slot) => `wildcraft:slot:${slot}`;
export const MAX_SLOTS = 10;

export function listSlots() {
  const out = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    const raw = localStorage.getItem(KEY(i));
    if (!raw) { out.push(null); continue; }
    try {
      const data = JSON.parse(raw);
      out.push({
        slot: i,
        name: data.name || `World ${i + 1}`,
        mode: data.mode || "survival",
        seed: data.seed,
        timestamp: data.timestamp || 0,
        editCount: data.modified ? Object.keys(data.modified).length : 0,
      });
    } catch {
      out.push(null);
    }
  }
  return out;
}

export function loadSlot(slot) {
  const raw = localStorage.getItem(KEY(slot));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function saveSlot(slot, data) {
  data.timestamp = Date.now();
  try {
    localStorage.setItem(KEY(slot), JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn("save failed", e);
    return false;
  }
}

export function deleteSlot(slot) {
  localStorage.removeItem(KEY(slot));
}
