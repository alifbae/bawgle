// Tests for the round-history table and its helpers. Paired with
// multiplayer.test.ts which exercises the timer path that triggers an
// insert; here we focus on the raw storage + lookup surface the share
// endpoint and /result page rely on.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeStorage,
  getLatestRoundForRoom,
  getRoundById,
  initStorage,
  insertRound,
  pruneOldRounds,
} from "../../server/storage.ts";

describe("rounds storage", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "bawgle-rounds-"));
    initStorage(join(tmp, "test.db"));
  });

  afterEach(() => {
    closeStorage();
    rmSync(tmp, { recursive: true, force: true });
  });

  function seed(roomCode: string, endedAt: number) {
    return insertRound({
      roomCode,
      startedAt: endedAt - 60_000,
      endedAt,
      board: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"],
      settings: { roundSeconds: 60, size: 4 },
      hostId: "p1",
      players: [
        { id: "p1", name: "ALFA", score: 5, words: ["cab", "dab"] },
        { id: "p2", name: "BETA", score: 3, words: ["ab"] },
      ],
      possibleWords: ["cab", "dab", "ab", "fab"],
    });
  }

  it("inserts a round and returns a positive numeric id", () => {
    const id = seed("ROOM", 1_000_000);
    expect(id).toBeGreaterThan(0);
    expect(Number.isInteger(id)).toBe(true);
  });

  it("round-trips every field via getRoundById", () => {
    const id = seed("ROOM", 2_000_000);
    const row = getRoundById(id);
    expect(row).not.toBeNull();
    expect(row!.id).toBe(id);
    expect(row!.roomCode).toBe("ROOM");
    expect(row!.startedAt).toBe(1_940_000);
    expect(row!.endedAt).toBe(2_000_000);
    expect(row!.board).toHaveLength(16);
    expect(row!.hostId).toBe("p1");
    const players = row!.players as Array<{ name: string; score: number; words: string[] }>;
    expect(players).toHaveLength(2);
    expect(players[0].name).toBe("ALFA");
    expect(players[0].words).toEqual(["cab", "dab"]);
    expect(row!.possibleWords).toContain("fab");
  });

  it("returns null for a missing round id", () => {
    expect(getRoundById(99999)).toBeNull();
  });

  it("getLatestRoundForRoom returns the most recently ended round", () => {
    seed("ROOM", 1_000_000);
    seed("ROOM", 3_000_000);
    seed("ROOM", 2_000_000);
    const latest = getLatestRoundForRoom("ROOM");
    expect(latest).not.toBeNull();
    expect(latest!.endedAt).toBe(3_000_000);
  });

  it("scopes latest-for-room to the requested code", () => {
    seed("AAAA", 1_000_000);
    seed("BBBB", 5_000_000);
    const latest = getLatestRoundForRoom("AAAA");
    expect(latest!.endedAt).toBe(1_000_000);
  });

  it("returns null when a room has no recorded rounds", () => {
    expect(getLatestRoundForRoom("NONE")).toBeNull();
  });

  describe("pruneOldRounds", () => {
    it("removes only rounds older than the cutoff", () => {
      const fresh = seed("ROOM", Date.now() - 1_000);
      const old = seed("ROOM", Date.now() - 60 * 24 * 60 * 60 * 1000);
      const removed = pruneOldRounds(30 * 24 * 60 * 60 * 1000);
      expect(removed).toBe(1);
      expect(getRoundById(fresh)).not.toBeNull();
      expect(getRoundById(old)).toBeNull();
    });

    it("is a no-op when everything is inside the retention window", () => {
      seed("ROOM", Date.now() - 1_000);
      expect(pruneOldRounds(30 * 24 * 60 * 60 * 1000)).toBe(0);
    });
  });
});
