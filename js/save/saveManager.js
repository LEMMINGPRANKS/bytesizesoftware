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

// ---- Multiplayer saves ----
// Keyed by room code so rejoining the same code restores your local snapshot
// (inventory, position, the modified-block delta as you last saw it). Host
// always starts fresh because hosting mints a new code each click.
const MP_KEY = (code) => `wildcraft:mp:${code}`;

export function loadMpSave(code) {
  const raw = localStorage.getItem(MP_KEY(code));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function saveMpSave(code, data) {
  data.timestamp = Date.now();
  try {
    localStorage.setItem(MP_KEY(code), JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn("mp save failed", e);
    return false;
  }
}

export function deleteMpSave(code) {
  localStorage.removeItem(MP_KEY(code));
}

// List every MP save (for browsing/deleting in a future settings UI).
export function listMpSaves() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith("wildcraft:mp:")) continue;
    const code = k.slice("wildcraft:mp:".length);
    try {
      const data = JSON.parse(localStorage.getItem(k));
      out.push({
        code,
        name: data.name || `MP ${code}`,
        seed: data.seed,
        timestamp: data.timestamp || 0,
        editCount: data.modified ? Object.keys(data.modified).length : 0,
      });
    } catch { /* skip corrupt */ }
  }
  out.sort((a, b) => b.timestamp - a.timestamp);
  return out;
}

// ---- Export / Import (single-file portability across browsers) ----
// Versioned so future migrations can transform old shapes into new ones.

export const SAVE_VERSION = 1;

// Build a portable export blob for a slot.
export function exportSlot(slot) {
  const data = loadSlot(slot);
  if (!data) return null;
  return JSON.stringify({ ...data, version: data.version || SAVE_VERSION }, null, 2);
}

// Sanitise + persist an imported blob into the given slot.
// Returns true on success, or an error string on failure.
export function importToSlot(slot, text) {
  let data;
  try { data = JSON.parse(text); }
  catch { return "File is not valid JSON."; }
  if (typeof data !== "object" || data === null) return "File is empty or malformed.";
  if (typeof data.seed !== "number") return "Missing world seed — not a Wildcraft save?";
  if (!data.modified || typeof data.modified !== "object") data.modified = {};
  // Force the slot index onto the data so it lands where the user dropped it.
  data.version = data.version || SAVE_VERSION;
  data.timestamp = Date.now();
  data.name = (data.name && String(data.name).trim()) || `Imported World ${slot + 1}`;
  // Future: if (data.version < CURRENT_VERSION) data = migrate(data);
  try {
    localStorage.setItem(KEY(slot), JSON.stringify(data));
    return true;
  } catch (e) {
    return "Storage write failed: " + e.message;
  }
}

// Suggest a safe filename for a world.
export function exportFilename(name, slot) {
  const safe = String(name || `world-${slot + 1}`)
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 40)
    .replace(/^_|_$/g, "") || "world";
  return `wildcraft-${safe}.json`;
}
