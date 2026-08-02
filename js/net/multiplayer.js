// Multiplayer layer using Photon Realtime (cloud relay).
//
// MVP scope (v1.1):
//   * connect(appId, region) — authenticate with Photon cloud
//   * hostRoom(seed)         — create a room with a 5-char code, share seed
//   * joinRoom(code)         — join an existing room
//   * onPlayerJoin/Leave     — callbacks for avatar spawn/despawn
//   * sendBlockEdit(x,y,z,id) / onRemoteBlockEdit — block sync
//   * sendPlayerState(pos, yaw, pitch) / onRemotePlayerState — avatar sync
//
// The room code doubles as the world seed: everyone typing the same code
// generates identical baseline terrain. Block edits broadcast as Photon
// "raise events" so all clients converge on the same world state.
//
// Chests/doors/mobs stay host-authoritative for v1.1 (simpler conflict
// story) — only host can open them; guests see locked state.

const APP_ID = "18f74b73-1dd0-4926-82d8-48f7ac9386b9";
const APP_VERSION = "1.0.0";
const REGION = "EU"; // closest to UK — adjust if Freddie's away
const EVENT_CODES = {
  BLOCK_EDIT: 1,
  PLAYER_STATE: 2,
  CHAT: 3,
  WORLD_DUMP: 4,
  PISTON_STATE: 5,
};

let client = null;
let connected = false;
let inRoom = false;
let localPlayer = null;

// Public callbacks — main.js assigns these to hook into game state.
export const callbacks = {
  onConnected: null,            // () — nameserver + master connected
  onRoomJoined: null,           // (roomCode, isHost) — in a room, ready to play
  onPlayerEnter: null,          // (playerId, name) — spawn an avatar
  onPlayerLeave: null,          // (playerId) — despawn the avatar
  onRemoteBlockEdit: null,      // ({x,y,z,id}, playerId)
  onRemotePlayerState: null,    // ({x,y,z,yaw,pitch}, playerId)
  onRemoteChat: null,           // (text, playerId)
  onRemoteWorldDump: null,      // ({ entries: [{x,y,z,id}], done: bool }, playerId)
  onRemotePistonState: null,    // ({x,y,z,fx,fy,fz,sticky}, playerId)
  onError: null,                // (msg)
  onStatus: null,               // (msg) — diagnostic state chatter
};

function code() {
  // 5-char A–Z room code. Easy to type, plenty of uniqueness for an indie
  // game: 26^5 ≈ 11.8M combinations.
  let s = "";
  for (let i = 0; i < 5; i++) s += String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return s;
}

export function isConnected() { return connected; }
export function isInRoom() { return inRoom; }
export function getLocalPlayer() { return localPlayer; }
export function getLocalActorNr() { return localPlayer?.actorNr ?? 0; }
export function getLocalName() { return localPlayer?.name ?? "Player"; }

// Connect to Photon cloud. Returns a promise that resolves on master server
// connect. Safe to call once per session — re-calling creates a fresh client.
export function connect() {
  return new Promise((resolve, reject) => {
    if (!window.Photon) {
      reject(new Error("Photon SDK not loaded"));
      return;
    }
    if (client) { resolve(); return; }
    const Photon = window.Photon;
    const LBC = Photon.LoadBalancing.LoadBalancingClient;
    const lb = new LBC(Photon.ConnectionProtocol.Wss, APP_ID, APP_VERSION);
    // name lives on the local actor, not on the client itself.
    lb.myActor().setName("Player" + ((Math.random() * 9999) | 0));

    lb.onStateChange = (state) => {
      // LBC.StateToName prints readable state strings for debugging.
      const name = LBC.StateToName(state);
      console.log("[mp] state", state, name);
      callbacks.onStatus?.(`state: ${name}`);
      const S = LBC.State;
      if (state === S.ConnectedToNameServer) {
        lb.connectToRegionMaster(REGION);
      } else if (state === S.ConnectedToMaster) {
        connected = true;
        callbacks.onConnected?.();
        resolve();
      }
    };
    lb.onEvent = (code, data, actorNr) => {
      handleEvent(code, data, actorNr);
    };
    lb.onActorJoin = (actor) => {
      // Skip ourselves — Photon fires this for local player too on join.
      if (actor.isLocal) {
        localPlayer = actor;
        return;
      }
      callbacks.onPlayerEnter?.(actor.actorNr, actor.name);
    };
    lb.onActorLeave = (actor) => {
      if (actor.isLocal) return;
      callbacks.onPlayerLeave?.(actor.actorNr);
    };
    lb.onError = (errorCode, errorMsg) => {
      const msg = `Photon error ${errorCode}: ${errorMsg}`;
      callbacks.onError?.(msg);
      if (!connected) reject(new Error(msg));
    };

    try {
      lb.connectToNameServer();
    } catch (e) {
      reject(e);
    }
    client = lb;
  });
}

// Host: create a new room with a fresh 5-char code. World seed = code.
export function hostRoom(worldSeed) {
  if (!client) return Promise.reject(new Error("not connected"));
  const roomCode = code();
  // Pass the seed explicitly as a creation property so the server stores it
  // on the room and serves it to guests in the join response.
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("host timeout")), 15000);
    const LBC = window.Photon.LoadBalancing.LoadBalancingClient;
    const orig = client.onStateChange;
    client.onStateChange = (state) => {
      orig?.(state);
      if (state === LBC.State.Joined) {
        clearTimeout(timeout);
        inRoom = true;
        callbacks.onRoomJoined?.(roomCode, true);
        resolve(roomCode);
      }
    };
    client.createRoom(roomCode, {
      maxPlayers: 8,
      customGameProperties: { seed: worldSeed, code: roomCode },
      propsListedInLobby: ["code"],
    });
  });
}

// Join: type a 5-char code.
export function joinRoom(roomCode) {
  if (!client) return Promise.reject(new Error("not connected"));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("join timeout")), 15000);
    const LBC = window.Photon.LoadBalancing.LoadBalancingClient;
    const orig = client.onStateChange;
    client.onStateChange = (state) => {
      orig?.(state);
      if (state === LBC.State.Joined) {
        clearTimeout(timeout);
        inRoom = true;
        const seed = client.myRoom().getCustomProperty("seed");
        callbacks.onRoomJoined?.(roomCode.toUpperCase(), false);
        resolve({ code: roomCode.toUpperCase(), seed });
      }
    };
    client.joinRoom(roomCode.toUpperCase());
  });
}

export function leaveRoom() {
  if (!client || !inRoom) return;
  client.leaveRoom();
  inRoom = false;
}

// ---- Outgoing events ----
export function sendBlockEdit(x, y, z, id) {
  if (!inRoom) return;
  client.raiseEvent(EVENT_CODES.BLOCK_EDIT, { x, y, z, id });
}
// Pistons need their facing direction broadcast separately because block IDs
// alone don't carry orientation. Receiver registers the piston via world.addPiston.
export function sendPistonState(x, y, z, facing, sticky) {
  if (!inRoom) return;
  try {
    client.raiseEvent(EVENT_CODES.PISTON_STATE, {
      x, y, z,
      fx: facing[0] | 0, fy: facing[1] | 0, fz: facing[2] | 0,
      sticky: !!sticky,
    });
  } catch (e) {
    callbacks.onError?.(`Piston state send failed: ${e?.message || e}`);
  }
}
export function sendPlayerState(pos, yaw, pitch) {
  if (!inRoom) return;
  client.raiseEvent(EVENT_CODES.PLAYER_STATE, {
    x: pos.x, y: pos.y, z: pos.z, yaw, pitch,
  });
}
export function sendChat(text) {
  if (!inRoom || !client) return;
  try {
    // Chat is rare + important — send reliably so a flaky connection doesn't
    // drop a message silently. Wrap in try/catch because some Photon builds
    // throw synchronously if the room is in a weird state mid-join.
    const LBC = window.Photon?.LoadBalancing?.LoadBalancingClient;
    const opts = LBC ? { receivers: LBC.ReceiverGroup.All, cache: LBC.EventCache.DoNotCache } : {};
    client.raiseEvent(EVENT_CODES.CHAT, { text: String(text || "").slice(0, 120) }, opts);
  } catch (e) {
    callbacks.onError?.(`Chat send failed: ${e.message || e}`);
  }
}

// Host → newcomer: stream the modified-block delta so a fresh joiner sees the
// same buildings/edits as everyone else. Sent in chunks to stay well under
// Photon's per-event payload cap (~100KB reliably).
export function sendWorldDump(entries, seq, done) {
  if (!inRoom) return;
  client.raiseEvent(EVENT_CODES.WORLD_DUMP, { entries, seq, done });
}

export function actorName(actorNr) {
  if (!client) return `Player ${actorNr}`;
  try {
    const room = client.myRoom();
    if (!room) return `Player ${actorNr}`;
    const a = room.getActor(actorNr);
    return a?.name || `Player ${actorNr}`;
  } catch {
    return `Player ${actorNr}`;
  }
}

// ---- Incoming event dispatch ----
function handleEvent(code, data, actorNr) {
  try {
    if (code === EVENT_CODES.BLOCK_EDIT) {
      callbacks.onRemoteBlockEdit?.(data, actorNr);
    } else if (code === EVENT_CODES.PLAYER_STATE) {
      callbacks.onRemotePlayerState?.(data, actorNr);
    } else if (code === EVENT_CODES.CHAT) {
      callbacks.onRemoteChat?.(data?.text, actorNr);
    } else if (code === EVENT_CODES.WORLD_DUMP) {
      callbacks.onRemoteWorldDump?.(data, actorNr);
    } else if (code === EVENT_CODES.PISTON_STATE) {
      callbacks.onRemotePistonState?.(data, actorNr);
    }
  } catch (e) {
    // Defensive: a malformed payload or missing callback shouldn't take down
    // the whole event loop. Log it and carry on.
    callbacks.onError?.(`Event ${code} handler failed: ${e?.message || e}`);
  }
}
