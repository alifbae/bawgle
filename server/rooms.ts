import { WebSocket } from "ws";
import { rollBoard, wordPathExists } from "../shared/board.ts";
import {
  DEFAULT_SETTINGS,
  DEV_MIN_ROUND_SECONDS,
  SETTINGS_LIMITS,
  scoreWord,
  type Player,
  type RoomSettings,
  type RoomState,
  type ServerMsg,
} from "../shared/types.ts";
import { isWord, solveBoard } from "./dictionary.ts";
import { recordEvent } from "./metrics.ts";
import {
  deleteRoom,
  findStaleRoomCodes,
  getLatestRoundForRoom,
  getRoundById,
  insertRound,
  loadAllRooms,
  saveRoom,
  type StoredRound,
} from "./storage.ts";

interface RoomConn {
  ws: WebSocket;
  playerId: string;
}

interface Room {
  state: RoomState;
  conns: Map<string, RoomConn>;
  timer: NodeJS.Timeout | null;
  solved: string[];
  // The original host's player id. If they disconnect briefly and the
  // transient host transfer moves the crown, this lets us give it back
  // when they reconnect instead of permanently demoting them.
  originalHostId: string | null;
  // ID of the most recent persisted round for this room, set when
  // endRound() inserts into the `rounds` table. Used by the live
  // results screen to generate a stable share link.
  lastRoundId: number | null;
  // Timestamp the current round started; preserved for persistence
  // into the rounds table so share links show accurate timing.
  roundStartedAt: number | null;
}

const rooms = new Map<string, Room>();

// Bound total rooms so a bot can't mint unique 4-char codes indefinitely
// and OOM the process. ~1k rooms is far more than this game will ever
// legitimately host; past that we refuse new rooms until existing ones
// are garbage-collected (today: manual purgeRoom / process restart).
const MAX_ROOMS = 1000;
// Bound per-room players so one joker can't shove 10k fake players into
// a single room and blow up broadcast fanout.
const MAX_PLAYERS_PER_ROOM = 32;

// Rooms are considered abandoned after this long with no persisted
// activity. `persist(room)` bumps the row's `updated_at` on every
// meaningful change (join, leave, word, phase transition, settings),
// so "no persist" really does mean "nobody touched it".
const ROOM_TTL_MS = 72 * 60 * 60 * 1000;
// How often the sweeper runs. Hourly keeps expired rooms from lingering
// much past their TTL while keeping the wake-up overhead negligible.
const ROOM_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Half-closed socket (TCP RST race, queue full) — let the close
    // handler reap it. Don't propagate; a send failure to one peer
    // shouldn't take down the whole broadcast.
    try {
      ws.terminate();
    } catch {
      /* already gone */
    }
  }
}

function broadcast(room: Room, msg: ServerMsg) {
  const payload = JSON.stringify(msg);
  for (const { ws } of room.conns.values()) {
    if (ws.readyState !== ws.OPEN) continue;
    try {
      ws.send(payload);
    } catch {
      // Same deal as `send` above: if one recipient's socket is wedged
      // we forcibly close it so the per-room conns map catches up.
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
    }
  }
}

function publicState(room: Room): RoomState {
  return {
    ...room.state,
    lastRoundId: room.lastRoundId,
    players: room.state.players.map((p) => ({ ...p })),
  };
}

function persist(room: Room) {
  try {
    saveRoom({
      code: room.state.code,
      state: room.state,
      solved: room.solved,
    });
  } catch (err) {
    // Persist can fail during shutdown if storage has been closed while
    // a socket teardown is still draining. Swallow "not initialized"
    // errors since losing the last couple writes during shutdown is
    // benign; rethrow anything else so real bugs surface.
    const msg = (err as Error).message;
    if (!/not initialized/i.test(msg)) throw err;
  }
}

function getOrCreateRoom(code: string): Room | null {
  let room = rooms.get(code);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) return null;
    room = {
      state: {
        code,
        phase: "lobby",
        board: null,
        endsAt: null,
        startsAt: null,
        players: [],
        hostId: null,
        settings: { ...DEFAULT_SETTINGS },
        possibleCount: 0,
        possibleWords: [],
        lastRoundId: null,
      },
      conns: new Map(),
      timer: null,
      solved: [],
      originalHostId: null,
      lastRoundId: null,
      roundStartedAt: null,
    };
    rooms.set(code, room);
    persist(room);
  }
  return room;
}

function emitState(room: Room) {
  broadcast(room, { t: "state", state: publicState(room) });
}

export function joinRoom(
  ws: WebSocket,
  code: string,
  name: string,
  clientId: string
): { room: Room; playerId: string } | { room: null; playerId: null; reason: string } {
  const safeCode = code.trim().toUpperCase().slice(0, 4) || "ROOM";
  const safeName =
    (name || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 4) || "????";
  const room = getOrCreateRoom(safeCode);
  if (!room) {
    send(ws, { t: "error", message: "Server at capacity, try again later" });
    recordEvent("server_full", { code: safeCode, name: safeName });
    return { room: null, playerId: null, reason: "server_full" };
  }

  const existing = room.state.players.find((p) => p.clientId === clientId);
  // A reconnect is only safe to claim if the previous socket is closed.
  // If it's still OPEN, this must be a second live tab on the same browser
  // — give it a brand new identity instead of hijacking the existing slot.
  const prevConn = existing ? room.conns.get(existing.id) : undefined;
  const prevAlive =
    prevConn?.ws && prevConn.ws !== ws && prevConn.ws.readyState === prevConn.ws.OPEN;

  if (existing && !prevAlive) {
    const wasOriginalHost = room.originalHostId === existing.id;

    existing.connected = true;
    existing.name = safeName;
    if (room.state.phase !== "playing") {
      existing.ready = false;
    }
    room.conns.set(existing.id, { ws, playerId: existing.id });

    if (!room.state.hostId) {
      room.state.hostId = existing.id;
      // Only seed originalHostId if it hasn't been set yet. A mid-
      // session crown transfer (host drops, someone else becomes
      // host, original reconnects) must NOT overwrite the record
      // of who owns the room.
      if (!room.originalHostId) room.originalHostId = existing.id;
    } else if (wasOriginalHost && room.state.hostId !== existing.id) {
      room.state.hostId = existing.id;
    }

    send(ws, {
      t: "joined",
      you: existing.id,
      clientId: existing.clientId,
      state: publicState(room),
    });
    emitState(room);
    persist(room);
    recordEvent("join", {
      code: safeCode,
      name: safeName,
      playerId: existing.id,
      reconnect: true,
    });
    return { room, playerId: existing.id };
  }

  // If there's a live tab with this clientId, mint a distinct internal id
  // so the new tab shows up as its own player.
  const effectiveClientId = prevAlive ? `${clientId}:${makeId()}` : clientId;

  if (room.state.players.length >= MAX_PLAYERS_PER_ROOM) {
    send(ws, { t: "error", message: "Room is full" });
    recordEvent("room_full", { code: safeCode, name: safeName });
    return { room: null, playerId: null, reason: "room_full" };
  }

  const playerId = makeId();
  const player: Player = {
    id: playerId,
    clientId: effectiveClientId,
    name: safeName,
    connected: true,
    // Mid-round joiners are implicitly ready — they don't need to confirm
    // for the next round if they're already in the current one. In lobby
    // they start unready so the host has to see everyone opt-in.
    ready: room.state.phase === "playing",
    score: 0,
    words: [],
  };
  room.state.players.push(player);
  room.conns.set(playerId, { ws, playerId });
  if (!room.state.hostId) {
    room.state.hostId = playerId;
    // Preserve the original host marker across transient drops.
    // If someone has owned this room before, they get the crown back
    // when they reconnect — we shouldn't overwrite that just because
    // a new arrival is the only live player right now.
    if (!room.originalHostId) room.originalHostId = playerId;
  }

  send(ws, {
    t: "joined",
    you: playerId,
    clientId: player.clientId,
    state: publicState(room),
  });
  emitState(room);
  persist(room);
  recordEvent("join", {
    code: safeCode,
    name: safeName,
    playerId,
    reconnect: false,
    playerCount: room.state.players.length,
  });

  return { room, playerId };
}

export function leaveRoom(room: Room, playerId: string) {
  room.conns.delete(playerId);
  const p = room.state.players.find((p) => p.id === playerId);
  if (p) p.connected = false;

  if (room.state.hostId === playerId) {
    const next = room.state.players.find((q) => q.connected);
    room.state.hostId = next ? next.id : null;
  }

  emitState(room);
  persist(room);
  recordEvent("leave", {
    code: room.state.code,
    playerId,
    name: p?.name,
    remaining: room.state.players.filter((q) => q.connected).length,
  });
}

export function updateSettings(
  room: Room,
  requesterId: string,
  next: Partial<RoomSettings>
) {
  if (requesterId !== room.state.hostId) return;
  if (room.state.phase === "playing") return;

  const cur = room.state.settings;
  // Dev builds let hosts drop the round to a few seconds for quick
  // results-screen iteration. Production keeps the strict 60s floor.
  const minRoundSeconds =
    process.env.BAWGLE_ENVIRONMENT === "development"
      ? DEV_MIN_ROUND_SECONDS
      : SETTINGS_LIMITS.minRoundSeconds;
  const merged: RoomSettings = {
    roundSeconds:
      typeof next.roundSeconds === "number"
        ? clamp(
            Math.round(next.roundSeconds),
            minRoundSeconds,
            SETTINGS_LIMITS.maxRoundSeconds
          )
        : cur.roundSeconds,
    size:
      typeof next.size === "number" &&
      (SETTINGS_LIMITS.sizes as readonly number[]).includes(next.size)
        ? (next.size as RoomSettings["size"])
        : cur.size,
  };

  if (merged.roundSeconds === cur.roundSeconds && merged.size === cur.size) {
    return;
  }
  room.state.settings = merged;
  emitState(room);
  persist(room);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// How long the pre-round countdown lasts. Long enough that remote
// players can see it and bring hands back to the board, short enough
// it doesn't drag.
const COUNTDOWN_MS = 5_000;

export function startRound(room: Room, requesterId?: string) {
  if (room.state.phase === "playing") return;
  if (requesterId && requesterId !== room.state.hostId) return;
  // Host pressing "start" again while the countdown is already running
  // is a no-op rather than a reset, to keep remote players in sync.
  if (room.state.startsAt !== null) return;

  // Everyone who's connected (except the host) must be ready. The host
  // clicking "start" implies readiness.
  const connected = room.state.players.filter((p) => p.connected);
  if (connected.length === 0) return;
  const others = connected.filter((p) => p.id !== room.state.hostId);
  if (others.some((p) => !p.ready)) return;

  // Enter the countdown. Actual round setup (board roll, solver run)
  // is deferred to the timer so `startsAt` is the only mutation every
  // client needs to react to.
  room.state.startsAt = Date.now() + COUNTDOWN_MS;
  if (room.timer) clearTimeout(room.timer);
  room.timer = setTimeout(() => beginRound(room), COUNTDOWN_MS);
  emitState(room);
  persist(room);
  recordEvent("round_countdown", {
    code: room.state.code,
    durationMs: COUNTDOWN_MS,
  });
}

/**
 * Transition the room from countdown into the actual round. Called by
 * the setTimeout scheduled in `startRound`. Players' scores and word
 * lists reset here — we wait until the countdown actually fires so a
 * host clicking start by accident and nobody else being ready doesn't
 * wipe the lobby. (startRound guards that, but belt-and-suspenders.)
 */
function beginRound(room: Room) {
  room.state.startsAt = null;

  const { size, roundSeconds } = room.state.settings;

  for (const p of room.state.players) {
    p.score = 0;
    p.words = [];
  }
  room.state.board = rollBoard(size);
  room.solved = solveBoard(room.state.board, size);
  room.state.possibleCount = room.solved.length;
  room.state.possibleWords = [];
  room.state.endsAt = Date.now() + roundSeconds * 1000;
  room.roundStartedAt = Date.now();
  room.state.phase = "playing";

  if (room.timer) clearTimeout(room.timer);
  room.timer = setTimeout(() => endRound(room), roundSeconds * 1000);

  emitState(room);
  persist(room);
  recordEvent("round_start", {
    code: room.state.code,
    size,
    roundSeconds,
    players: room.state.players.filter((p) => p.connected).length,
    possibleWords: room.solved.length,
  });
}

function endRound(room: Room) {
  const endedAt = Date.now();
  room.state.phase = "results";
  room.state.endsAt = null;
  room.state.possibleWords = room.solved;
  // Clear ready flags so next round requires everyone to confirm again.
  for (const p of room.state.players) p.ready = false;

  // Persist the completed round to the history table. We capture a
  // deep copy of players so later mutations (play-again resets scores)
  // don't retroactively change the record.
  try {
    const roundId = insertRound({
      roomCode: room.state.code,
      startedAt: room.roundStartedAt ?? endedAt,
      endedAt,
      board: room.state.board ? [...room.state.board] : [],
      settings: { ...room.state.settings },
      hostId: room.state.hostId,
      players: room.state.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        words: [...p.words],
      })),
      possibleWords: [...room.solved],
    });
    room.lastRoundId = roundId;
  } catch (err) {
    // Storage failure at shutdown shouldn't kill the round-end broadcast.
    const msg = (err as Error).message;
    if (!/not initialized/i.test(msg)) {
      console.error("[bawgle] failed to persist round:", msg);
    }
  }

  emitState(room);
  persist(room);
  recordEvent("round_end", {
    code: room.state.code,
    roundId: room.lastRoundId,
    topScore: Math.max(0, ...room.state.players.map((p) => p.score)),
    foundCount: room.state.players.reduce((sum, p) => sum + p.words.length, 0),
    possibleCount: room.solved.length,
  });
}

/** Toggle a player's ready flag. Ignored outside the lobby phase. */
export function setReady(room: Room, playerId: string, ready: boolean) {
  if (room.state.phase === "playing") return;
  const player = room.state.players.find((p) => p.id === playerId);
  if (!player) return;
  if (player.ready === ready) return;
  player.ready = ready;
  emitState(room);
  persist(room);
}

/**
 * Host-only. Takes the room out of the results phase and back to lobby so
 * players can ready up for another round. Safe to call anytime except
 * during an active round — we never interrupt live play.
 */
export function returnToLobby(room: Room, requesterId?: string) {
  if (requesterId && requesterId !== room.state.hostId) return;
  if (room.state.phase === "playing") return;
  room.state.phase = "lobby";
  room.state.board = null;
  room.state.endsAt = null;
  room.state.startsAt = null;
  room.state.possibleWords = [];
  room.state.possibleCount = 0;
  for (const p of room.state.players) {
    p.score = 0;
    p.words = [];
    p.ready = false;
  }
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  emitState(room);
  persist(room);
}

export function submitWord(
  room: Room,
  playerId: string,
  rawWord: string
): { ok: boolean; reason?: string; points?: number } {
  if (room.state.phase !== "playing") {
    recordEvent("word_rejected", {});
    return { ok: false, reason: "Round not active" };
  }
  const player = room.state.players.find((p) => p.id === playerId);
  if (!player) {
    recordEvent("word_rejected", {});
    return { ok: false, reason: "Not in room" };
  }

  const word = rawWord.trim().toLowerCase();
  if (word.length < 3) {
    recordEvent("word_rejected", {});
    return { ok: false, reason: "Too short" };
  }
  if (!/^[a-z]+$/.test(word)) {
    recordEvent("word_rejected", {});
    return { ok: false, reason: "Letters only" };
  }
  if (player.words.includes(word)) {
    recordEvent("word_rejected", {});
    return { ok: false, reason: "Already found" };
  }
  if (!wordPathExists(room.state.board!, word, room.state.settings.size)) {
    recordEvent("word_rejected", {});
    return { ok: false, reason: "Not on board" };
  }
  if (!isWord(word)) {
    recordEvent("word_rejected", {});
    return { ok: false, reason: "Not a word" };
  }

  const points = scoreWord(word);
  player.words.push(word);
  player.score += points;
  emitState(room);
  persist(room);
  recordEvent("word_accepted", {});
  return { ok: true, points };
}

/**
 * Rehydrate rooms from the database on server boot. All restored players
 * come back with `connected: false` since their WS died with the process;
 * reconnect-by-clientId restores them when they visit.
 *
 * If a round was live when the server stopped, handle the timer:
 *   - endsAt in the future: reschedule the remaining ms
 *   - endsAt in the past:   end the round immediately (reveal words)
 */
export function restoreRooms(): void {
  const rows = loadAllRooms();
  for (const { code, state, solved } of rows) {
    // Re-seed lastRoundId from the most recent persisted round, so
    // clients that reconnect into a lobby still see the previous
    // round's id for a share link.
    const lastRound = getLatestRoundForRoom(code);
    const room: Room = {
      state: {
        ...state,
        lastRoundId: lastRound?.id ?? null,
        // A pending countdown is tied to a live timer; discard it on
        // restart rather than rescheduling.
        startsAt: null,
      },
      conns: new Map(),
      timer: null,
      solved,
      // Treat the persisted host as the original on restore. A subsequent
      // leaveRoom may transfer the crown temporarily; reconnect restores it.
      originalHostId: state.hostId,
      lastRoundId: lastRound?.id ?? null,
      roundStartedAt: null,
    };
    rooms.set(code, room);

    if (state.phase === "playing" && state.endsAt) {
      const remain = state.endsAt - Date.now();
      if (remain > 0) {
        room.timer = setTimeout(() => endRound(room), remain);
      } else {
        // Round finished while we were down; resolve now.
        endRound(room);
      }
    }
  }
  console.log(`[bawgle] restored ${rows.length} room(s) from disk`);
}

/**
 * Evict rooms that haven't persisted activity for longer than
 * `ROOM_TTL_MS`. A room with any live WebSocket connection is always
 * spared, even if its `updated_at` is somehow stale — `persist()` is
 * called on every state change, so an idle-but-occupied room is an
 * unlikely edge case rather than the norm, and we'd rather keep a
 * live room than axe one mid-play.
 *
 * Returns the number of rooms purged, mostly for logging/testing.
 */
export function sweepStaleRooms(now: number = Date.now()): number {
  const codes = findStaleRoomCodes(ROOM_TTL_MS);
  let purged = 0;
  for (const code of codes) {
    const room = rooms.get(code);
    // Skip rooms with any live connection — a user is mid-session.
    if (room && room.conns.size > 0) continue;
    if (room?.timer) clearTimeout(room.timer);
    rooms.delete(code);
    deleteRoom(code);
    purged += 1;
    recordEvent("room_purged", { code, reason: "ttl" });
  }
  if (purged > 0) {
    const hours = Math.round(ROOM_TTL_MS / 3_600_000);
    console.log(
      `[bawgle] sweep: purged ${purged} room(s) idle >${hours}h at ${new Date(now).toISOString()}`
    );
  }
  return purged;
}

/**
 * Kick off the periodic sweeper. The returned timer is `unref()`ed so
 * it doesn't keep the event loop alive during shutdown. Idempotent-ish:
 * caller should hold onto the handle if they want to stop it.
 */
export function startRoomSweeper(): NodeJS.Timeout {
  // Sweep once at boot so rooms that expired while the process was
  // down get cleaned up immediately instead of lingering for an hour.
  sweepStaleRooms();
  const handle = setInterval(() => {
    try {
      sweepStaleRooms();
    } catch (err) {
      console.error(`[bawgle] sweep failed:`, err);
    }
  }, ROOM_SWEEP_INTERVAL_MS);
  handle.unref();
  return handle;
}

/** Exposed for tooling/admin; drops a room everywhere. */
export function purgeRoom(code: string) {
  const room = rooms.get(code);
  if (room?.timer) clearTimeout(room.timer);
  rooms.delete(code);
  deleteRoom(code);
  recordEvent("room_purged", { code, reason: "manual" });
}

/**
 * Test hook: synchronously skip the pre-round countdown and enter
 * the playing phase. Used by existing tests that predate the
 * countdown and assume startRound → playing is one call. Production
 * code never invokes this.
 */
export function __beginRoundForTests(room: Room): void {
  if (room.state.startsAt === null) return;
  if (room.timer) clearTimeout(room.timer);
  beginRound(room);
}

/**
 * Fetch a specific round by its numeric id. Use for /result?round=N
 * share links — lookup survives room purge and server restart.
 */
export function fetchRoundById(id: number): StoredRound | null {
  return getRoundById(id);
}

/**
 * Fetch the most recent completed round for a room code. Use for
 * /result?room=XXXX share links where the caller doesn't know a
 * specific round id.
 */
export function fetchLatestRoundForRoom(code: string): StoredRound | null {
  return getLatestRoundForRoom(code.toUpperCase());
}

/** Best-effort read of a room's live phase for disambiguating empty states. */
export function getRoomPhase(code: string): RoomState["phase"] | null {
  const room = rooms.get(code.toUpperCase());
  return room ? room.state.phase : null;
}

/**
 * Higher-level status derived from room state. Used by the shared
 * /result page to show a coloured badge next to the room code.
 *
 *   active   — someone is connected OR a round is live
 *   inactive — room exists but idle (no live connections, not playing)
 *   closed   — room was purged (or never existed)
 */
export type RoomStatus = "active" | "inactive" | "closed";

export function getRoomStatus(code: string): RoomStatus {
  const room = rooms.get(code.toUpperCase());
  if (!room) return "closed";
  if (room.conns.size > 0 || room.state.phase === "playing") return "active";
  return "inactive";
}

/**
 * Read-only snapshot of current rooms for the admin dashboard. Returns a
 * plain object per room (no internal references, no live WS handles).
 */
export interface RoomSnapshot {
  code: string;
  phase: RoomState["phase"];
  size: number;
  roundSeconds: number;
  playerCount: number;
  connectedCount: number;
  hostName: string | null;
  endsAt: number | null;
  possibleCount: number;
  liveConnections: number;
}

export function roomsSnapshot(): RoomSnapshot[] {
  const out: RoomSnapshot[] = [];
  for (const room of rooms.values()) {
    const host = room.state.players.find((p) => p.id === room.state.hostId);
    out.push({
      code: room.state.code,
      phase: room.state.phase,
      size: room.state.settings.size,
      roundSeconds: room.state.settings.roundSeconds,
      playerCount: room.state.players.length,
      connectedCount: room.state.players.filter((p) => p.connected).length,
      hostName: host ? host.name : null,
      endsAt: room.state.endsAt,
      possibleCount: room.state.possibleCount,
      liveConnections: room.conns.size,
    });
  }
  // Sort: playing rooms first, then by player count desc, then code.
  out.sort((a, b) => {
    const phaseRank = (p: RoomSnapshot["phase"]) =>
      p === "playing" ? 0 : p === "results" ? 1 : 2;
    const pr = phaseRank(a.phase) - phaseRank(b.phase);
    if (pr !== 0) return pr;
    if (b.connectedCount !== a.connectedCount)
      return b.connectedCount - a.connectedCount;
    return a.code.localeCompare(b.code);
  });
  return out;
}

/**
 * Aggregate rollups used by the admin dashboard header. Cheaper than
 * iterating rooms again client-side.
 */
export function roomsSummary() {
  let total = 0;
  let playing = 0;
  let lobby = 0;
  let results = 0;
  let connectedPlayers = 0;
  let totalPlayers = 0;
  let liveConns = 0;
  for (const room of rooms.values()) {
    total += 1;
    if (room.state.phase === "playing") playing += 1;
    else if (room.state.phase === "results") results += 1;
    else lobby += 1;
    totalPlayers += room.state.players.length;
    connectedPlayers += room.state.players.filter((p) => p.connected).length;
    liveConns += room.conns.size;
  }
  return { total, playing, lobby, results, connectedPlayers, totalPlayers, liveConns };
}
