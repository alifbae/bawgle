// SQLite-backed persistence for boggle rooms and players.
//
// The server operates in memory for speed (room state is kept in JS objects),
// and this module mirrors every mutation to disk so that a restart recovers
// where we left off. WebSocket connections can't survive restarts, so on
// boot all players are marked `connected: false` until they reconnect.

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Board, Player, RoomState } from "../shared/types.ts";

const SCHEMA_VERSION = 1;

export interface PersistedRoom {
  code: string;
  state: RoomState;
  solved: string[];
}

let db: Database.Database | null = null;

export function initStorage(dbPath: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      phase TEXT NOT NULL,
      board_json TEXT,          -- JSON array of cell faces, or null
      ends_at INTEGER,          -- epoch ms, nullable
      host_id TEXT,
      settings_json TEXT NOT NULL,
      possible_count INTEGER NOT NULL DEFAULT 0,
      possible_words_json TEXT NOT NULL DEFAULT '[]',
      solved_json TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      client_id TEXT NOT NULL,
      name TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      words_json TEXT NOT NULL DEFAULT '[]',
      ready INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_code);

    -- Immutable round history. Every completed round gets one row.
    -- Survives room purges so shareable /result links keep working
    -- after the 72h room TTL or a host clicking "play again."
    CREATE TABLE IF NOT EXISTS rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      board_json TEXT NOT NULL,
      settings_json TEXT NOT NULL,
      host_id TEXT,
      players_json TEXT NOT NULL,
      possible_words_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rounds_room
      ON rounds(room_code, ended_at DESC);
  `);

  // Forward-compatible: add `ready` to older DBs that predate this column.
  const cols = db.prepare("PRAGMA table_info(players)").all() as Array<{
    name: string;
  }>;
  if (!cols.some((c) => c.name === "ready")) {
    db.exec("ALTER TABLE players ADD COLUMN ready INTEGER NOT NULL DEFAULT 0");
  }

  const existing = db
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  if (!existing) {
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
      "schema_version",
      String(SCHEMA_VERSION)
    );
  }

  console.log(`[bawgle] storage ready at ${dbPath}`);
}

function requireDb(): Database.Database {
  if (!db) throw new Error("storage not initialized");
  return db;
}

/** Write a room's full state to disk, replacing whatever's there. */
export function saveRoom(room: PersistedRoom): void {
  const d = requireDb();
  const now = Date.now();

  const upsertRoom = d.prepare(`
    INSERT INTO rooms (
      code, phase, board_json, ends_at, host_id, settings_json,
      possible_count, possible_words_json, solved_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      phase = excluded.phase,
      board_json = excluded.board_json,
      ends_at = excluded.ends_at,
      host_id = excluded.host_id,
      settings_json = excluded.settings_json,
      possible_count = excluded.possible_count,
      possible_words_json = excluded.possible_words_json,
      solved_json = excluded.solved_json,
      updated_at = excluded.updated_at;
  `);

  const deletePlayers = d.prepare("DELETE FROM players WHERE room_code = ?");
  const insertPlayer = d.prepare(`
    INSERT INTO players (id, room_code, client_id, name, score, words_json, ready, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?);
  `);

  const tx = d.transaction((r: PersistedRoom) => {
    upsertRoom.run(
      r.code,
      r.state.phase,
      r.state.board ? JSON.stringify(r.state.board) : null,
      r.state.endsAt,
      r.state.hostId,
      JSON.stringify(r.state.settings),
      r.state.possibleCount,
      JSON.stringify(r.state.possibleWords),
      JSON.stringify(r.solved),
      now
    );
    deletePlayers.run(r.code);
    r.state.players.forEach((p, i) => {
      insertPlayer.run(
        p.id,
        r.code,
        p.clientId,
        p.name,
        p.score,
        JSON.stringify(p.words),
        p.ready ? 1 : 0,
        i
      );
    });
  });

  tx(room);
}

export function deleteRoom(code: string): void {
  const d = requireDb();
  d.prepare("DELETE FROM rooms WHERE code = ?").run(code);
}

/**
 * Return codes of rooms whose last persist was older than `maxAgeMs`.
 * Caller is responsible for the actual delete so it can also evict any
 * in-memory copy and decide whether live rooms should be spared.
 */
export function findStaleRoomCodes(maxAgeMs: number): string[] {
  const d = requireDb();
  const cutoff = Date.now() - maxAgeMs;
  const rows = d
    .prepare("SELECT code FROM rooms WHERE updated_at < ?")
    .all(cutoff) as Array<{ code: string }>;
  return rows.map((r) => r.code);
}

/**
 * Load all rooms from disk. All players are returned with connected=false
 * since their WebSockets are gone after a restart — the first reconnect by
 * clientId will flip them back to true via the existing join flow.
 */
export function loadAllRooms(): PersistedRoom[] {
  const d = requireDb();
  const rows = d
    .prepare(
      `SELECT code, phase, board_json, ends_at, host_id, settings_json,
              possible_count, possible_words_json, solved_json
       FROM rooms`
    )
    .all() as Array<{
    code: string;
    phase: RoomState["phase"];
    board_json: string | null;
    ends_at: number | null;
    host_id: string | null;
    settings_json: string;
    possible_count: number;
    possible_words_json: string;
    solved_json: string;
  }>;

  const playerStmt = d.prepare(
    `SELECT id, client_id, name, score, words_json, ready
     FROM players
     WHERE room_code = ?
     ORDER BY position`
  );

  return rows.map((r) => {
    const playerRows = playerStmt.all(r.code) as Array<{
      id: string;
      client_id: string;
      name: string;
      score: number;
      words_json: string;
      ready: number;
    }>;

    const players: Player[] = playerRows.map((p) => ({
      id: p.id,
      clientId: p.client_id,
      name: p.name,
      connected: false, // restored without live sockets
      // Any ready flag from a previous session is stale — a fresh connection
      // is required to re-confirm readiness for the next round.
      ready: false,
      score: p.score,
      words: JSON.parse(p.words_json),
    }));

    const board: Board | null = r.board_json ? JSON.parse(r.board_json) : null;

    return {
      code: r.code,
      state: {
        code: r.code,
        phase: r.phase,
        board,
        endsAt: r.ends_at,
        startsAt: null,
        players,
        hostId: r.host_id,
        settings: JSON.parse(r.settings_json),
        possibleCount: r.possible_count,
        possibleWords: JSON.parse(r.possible_words_json),
        // Restored via rooms.restoreRooms() from the latest round row.
        lastRoundId: null,
        // Transient lobby coordination; not persisted.
        forceStartReadyAt: null,
      },
      solved: JSON.parse(r.solved_json),
    };
  });
}

export function closeStorage(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ─── Round history ──────────────────────────────────────────────────
// Rounds are immutable: inserted once by rooms.endRound(), never
// updated. Retained independently of the room's lifecycle so shareable
// links survive the 72h room TTL.

export interface RoundInsert {
  roomCode: string;
  startedAt: number;
  endedAt: number;
  board: string[];
  settings: unknown;
  hostId: string | null;
  players: unknown; // snapshot array; caller serializes
  possibleWords: string[];
}

export interface StoredRound {
  id: number;
  roomCode: string;
  startedAt: number;
  endedAt: number;
  board: string[];
  settings: unknown;
  hostId: string | null;
  players: unknown;
  possibleWords: string[];
}

/** Insert a completed round and return its new id. */
export function insertRound(r: RoundInsert): number {
  const d = requireDb();
  const info = d
    .prepare(
      `INSERT INTO rounds
         (room_code, started_at, ended_at, board_json, settings_json,
          host_id, players_json, possible_words_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      r.roomCode,
      r.startedAt,
      r.endedAt,
      JSON.stringify(r.board),
      JSON.stringify(r.settings),
      r.hostId,
      JSON.stringify(r.players),
      JSON.stringify(r.possibleWords)
    );
  return Number(info.lastInsertRowid);
}

function parseRound(row: {
  id: number;
  room_code: string;
  started_at: number;
  ended_at: number;
  board_json: string;
  settings_json: string;
  host_id: string | null;
  players_json: string;
  possible_words_json: string;
}): StoredRound {
  return {
    id: row.id,
    roomCode: row.room_code,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    board: JSON.parse(row.board_json),
    settings: JSON.parse(row.settings_json),
    hostId: row.host_id,
    players: JSON.parse(row.players_json),
    possibleWords: JSON.parse(row.possible_words_json),
  };
}

/** Fetch a single round by its numeric id. */
export function getRoundById(id: number): StoredRound | null {
  const d = requireDb();
  const row = d
    .prepare(
      `SELECT id, room_code, started_at, ended_at, board_json,
              settings_json, host_id, players_json, possible_words_json
       FROM rounds WHERE id = ?`
    )
    .get(id) as Parameters<typeof parseRound>[0] | undefined;
  return row ? parseRound(row) : null;
}

/** Fetch the most recent round for a room code, or null if none. */
export function getLatestRoundForRoom(roomCode: string): StoredRound | null {
  const d = requireDb();
  const row = d
    .prepare(
      `SELECT id, room_code, started_at, ended_at, board_json,
              settings_json, host_id, players_json, possible_words_json
       FROM rounds
       WHERE room_code = ?
       ORDER BY ended_at DESC
       LIMIT 1`
    )
    .get(roomCode) as Parameters<typeof parseRound>[0] | undefined;
  return row ? parseRound(row) : null;
}

/**
 * Delete rounds older than `maxAgeMs`. Returns the number of rows
 * dropped. Called by the daily sweeper so round history doesn't grow
 * unbounded.
 */
export function pruneOldRounds(maxAgeMs: number, now = Date.now()): number {
  const d = requireDb();
  const cutoff = now - maxAgeMs;
  const info = d.prepare("DELETE FROM rounds WHERE ended_at < ?").run(cutoff);
  return info.changes;
}
