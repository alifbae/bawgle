import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RoomState } from "../../shared/types.ts";
import { DEFAULT_SETTINGS } from "../../shared/types.ts";
import {
  closeStorage,
  deleteRoom,
  findStaleRoomCodes,
  initStorage,
  loadAllRooms,
  saveRoom,
} from "../../server/storage.ts";

// Storage is process-global; use a fresh tmp DB per test so assertions
// don't bleed across cases.

function makeState(code: string, overrides: Partial<RoomState> = {}): RoomState {
  return {
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
    ...overrides,
  };
}

describe("storage", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "bawgle-store-"));
    initStorage(join(tmp, "test.db"));
  });

  afterEach(() => {
    closeStorage();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("round-trips a lobby-phase room with no players", () => {
    const state = makeState("ROOM");
    saveRoom({ code: "ROOM", state, solved: [] });

    const rows = loadAllRooms();
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("ROOM");
    expect(rows[0].state.phase).toBe("lobby");
    expect(rows[0].state.players).toEqual([]);
    expect(rows[0].solved).toEqual([]);
  });

  it("round-trips a playing-phase room with players, scores, and words", () => {
    const state = makeState("GAME", {
      phase: "playing",
      board: ["C", "A", "T", "S"],
      endsAt: 123456789,
      possibleCount: 12,
      possibleWords: ["cat", "cats"],
      hostId: "p1",
      players: [
        {
          id: "p1",
          clientId: "c1",
          name: "AAAA",
          connected: true,
          ready: true,
          score: 5,
          words: ["cat", "cats"],
        },
        {
          id: "p2",
          clientId: "c2",
          name: "BBBB",
          connected: true,
          ready: false,
          score: 3,
          words: ["cat"],
        },
      ],
    });
    saveRoom({ code: "GAME", state, solved: ["cat", "cats"] });

    const [row] = loadAllRooms();
    expect(row.state.phase).toBe("playing");
    expect(row.state.board).toEqual(["C", "A", "T", "S"]);
    expect(row.state.endsAt).toBe(123456789);
    expect(row.state.possibleCount).toBe(12);
    expect(row.state.hostId).toBe("p1");
    expect(row.state.players).toHaveLength(2);
    expect(row.state.players[0].words).toEqual(["cat", "cats"]);
    expect(row.state.players[0].score).toBe(5);
    expect(row.solved).toEqual(["cat", "cats"]);
  });

  it("always restores players as connected=false and ready=false", () => {
    // Live sockets don't survive a restart, and any ready flag is stale.
    const state = makeState("SESN", {
      players: [
        {
          id: "p1",
          clientId: "c1",
          name: "AAAA",
          connected: true,
          ready: true,
          score: 0,
          words: [],
        },
      ],
    });
    saveRoom({ code: "SESN", state, solved: [] });

    const [row] = loadAllRooms();
    expect(row.state.players[0].connected).toBe(false);
    expect(row.state.players[0].ready).toBe(false);
  });

  it("upsert replaces player list wholesale (no stale rows)", () => {
    const state = makeState("SWAP", {
      players: [
        {
          id: "p1",
          clientId: "c1",
          name: "ALFA",
          connected: true,
          ready: false,
          score: 0,
          words: [],
        },
        {
          id: "p2",
          clientId: "c2",
          name: "BETA",
          connected: true,
          ready: false,
          score: 0,
          words: [],
        },
      ],
    });
    saveRoom({ code: "SWAP", state, solved: [] });

    // Remove p1, add p3. Save again — only p2 and p3 should remain.
    const next = makeState("SWAP", {
      players: [
        state.players[1],
        {
          id: "p3",
          clientId: "c3",
          name: "GAMA",
          connected: true,
          ready: false,
          score: 0,
          words: [],
        },
      ],
    });
    saveRoom({ code: "SWAP", state: next, solved: [] });

    const [row] = loadAllRooms();
    expect(row.state.players.map((p) => p.id).sort()).toEqual(["p2", "p3"]);
  });

  it("deleteRoom removes the row (and cascades players)", () => {
    saveRoom({
      code: "GONE",
      state: makeState("GONE", {
        players: [
          {
            id: "p1",
            clientId: "c1",
            name: "ZZZZ",
            connected: true,
            ready: false,
            score: 0,
            words: [],
          },
        ],
      }),
      solved: [],
    });
    expect(loadAllRooms()).toHaveLength(1);
    deleteRoom("GONE");
    expect(loadAllRooms()).toHaveLength(0);
  });

  it("findStaleRoomCodes returns codes with updated_at older than the cutoff", async () => {
    saveRoom({ code: "OLD", state: makeState("OLD"), solved: [] });
    saveRoom({ code: "NEW", state: makeState("NEW"), solved: [] });

    // `findStaleRoomCodes(maxAge)` returns rows where updated_at <
    // (Date.now() - maxAge). A negative argument yields a cutoff in
    // the future, which matches every row — so both codes come back.
    expect(findStaleRoomCodes(-1).sort()).toEqual(["NEW", "OLD"]);
    // A huge cutoff is firmly in the past → no row qualifies.
    expect(findStaleRoomCodes(365 * 24 * 3600 * 1000)).toEqual([]);
  });
});
