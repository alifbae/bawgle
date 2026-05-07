// Coverage for server-side derivations the share endpoint exposes:
//
//   getRoomStatus  — active / inactive / closed classification
//   getRoomPhase   — reports the current phase (or null for unknown rooms)
//
// The status classification is what drives the colored pill + "back to
// room" button on the share page.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function freshRooms() {
  vi.resetModules();
  const rooms = await import("../../src/server/rooms.ts");
  const storage = await import("../../src/server/storage.ts");
  const metrics = await import("../../src/server/metrics.ts");
  const dictionary = await import("../../src/server/dictionary.ts");
  metrics.configureLogging({ dir: null });
  return { rooms, storage, dictionary };
}

// Minimal WebSocket shape rooms.ts touches. The fake defaults to OPEN
// so it counts as a live connection in conns.size. Typed via the `ws`
// library's WebSocket rather than the DOM one because rooms.ts takes
// that shape.
class FakeSocket {
  readyState = 1;
  readonly OPEN = 1;
  readonly CLOSED = 3;
  send(_data: string): void {}
  close(): void {
    this.readyState = this.CLOSED;
  }
}

function asWs(fake: FakeSocket): import("ws").WebSocket {
  return fake as unknown as import("ws").WebSocket;
}

describe("getRoomStatus", () => {
  let tmp: string;
  let freshMods: Awaited<ReturnType<typeof freshRooms>>;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "bawgle-status-"));
    freshMods = await freshRooms();
    freshMods.storage.initStorage(join(tmp, "test.db"));
    freshMods.dictionary.loadDictionary();
  });
  afterEach(() => {
    freshMods.storage.closeStorage();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns 'closed' for rooms that don't exist in memory", () => {
    const { rooms } = freshMods;
    expect(rooms.getRoomStatus("NONE")).toBe("closed");
  });

  it("returns 'active' for a room with any live connection", () => {
    const { rooms } = freshMods;
    const ws = asWs(new FakeSocket());
    const r = rooms.joinRoom(ws, "TEST", "AAAA", "c1");
    expect(r.playerId).not.toBeNull();
    expect(rooms.getRoomStatus("TEST")).toBe("active");
  });

  it("returns 'active' while a round is in play even if nobody's connected", async () => {
    const { rooms } = freshMods;
    const ws = asWs(new FakeSocket());
    const join = rooms.joinRoom(ws, "PLAY", "ONLY", "c-only");
    expect(join.room).not.toBeNull();
    // Force phase to playing via startRound → beginRound timing chain.
    // We don't want to wait 5s so drive the internal state directly.
    rooms.startRound(join.room!, join.playerId!);
    // Countdown is active; not yet 'playing'. Wait for beginRound.
    await new Promise((r) => setTimeout(r, 5200));
    expect(rooms.getRoomStatus("PLAY")).toBe("active");
  }, 10_000);

  it("returns 'inactive' when the room exists with no connections and no live round", () => {
    const { rooms } = freshMods;
    const ws = asWs(new FakeSocket());
    const { room, playerId } = rooms.joinRoom(ws, "IDLE", "AAAA", "c1");
    // Drop the only connection — room stays in memory but no live conns.
    rooms.leaveRoom(room!, playerId!);
    expect(rooms.getRoomStatus("IDLE")).toBe("inactive");
  });

  it("is case-insensitive on the room code", () => {
    const { rooms } = freshMods;
    const ws = asWs(new FakeSocket());
    rooms.joinRoom(ws, "Abc1", "NAME", "c1");
    // Stored uppercase; lookup should also accept lowercase.
    expect(rooms.getRoomStatus("abc1")).toBe("active");
    expect(rooms.getRoomStatus("ABC1")).toBe("active");
  });
});

describe("getRoomPhase", () => {
  let tmp: string;
  let freshMods: Awaited<ReturnType<typeof freshRooms>>;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "bawgle-phase-"));
    freshMods = await freshRooms();
    freshMods.storage.initStorage(join(tmp, "test.db"));
    freshMods.dictionary.loadDictionary();
  });
  afterEach(() => {
    freshMods.storage.closeStorage();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null for unknown rooms", () => {
    expect(freshMods.rooms.getRoomPhase("NONE")).toBeNull();
  });

  it("returns 'lobby' for a freshly-joined room", () => {
    const ws = asWs(new FakeSocket());
    freshMods.rooms.joinRoom(ws, "LB", "AAAA", "c1");
    expect(freshMods.rooms.getRoomPhase("LB")).toBe("lobby");
  });
});
