// Pre-round countdown behavior. The host pressing "start" sets
// startsAt 5s into the future, broadcasts state, and schedules the
// actual round setup. Key invariants we want locked in:
//
//   - startsAt is populated, phase stays 'lobby' during the countdown
//   - calling startRound again during the countdown is a no-op (doesn't
//     reset the timer or skip it)
//   - after the countdown fires, phase flips to 'playing' and startsAt
//     clears
//   - restoreRooms() doesn't revive a stale countdown

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

class FakeSocket {
  readyState = 1;
  readonly OPEN = 1;
  readonly CLOSED = 3;
  sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = this.CLOSED;
  }
}

describe("pre-round countdown", () => {
  let tmp: string;
  let mods: Awaited<ReturnType<typeof freshRooms>>;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "bawgle-count-"));
    mods = await freshRooms();
    mods.storage.initStorage(join(tmp, "test.db"));
    mods.dictionary.loadDictionary();
  });
  afterEach(() => {
    mods.storage.closeStorage();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("sets startsAt and keeps phase 'lobby' when the host presses start", () => {
    const { rooms } = mods;
    const ws = new FakeSocket() as unknown as import("ws").WebSocket;
    const { room, playerId } = rooms.joinRoom(ws, "CNT", "HOST", "c-h");

    rooms.startRound(room!, playerId!);

    expect(room!.state.phase).toBe("lobby");
    expect(room!.state.startsAt).not.toBeNull();
    expect(room!.state.startsAt! - Date.now()).toBeGreaterThan(4_000);
    expect(room!.state.startsAt! - Date.now()).toBeLessThanOrEqual(5_000);
  });

  it("ignores repeat start presses while the countdown is running", () => {
    const { rooms } = mods;
    const ws = new FakeSocket() as unknown as import("ws").WebSocket;
    const { room, playerId } = rooms.joinRoom(ws, "REP", "HOST", "c-h");

    rooms.startRound(room!, playerId!);
    const firstStartsAt = room!.state.startsAt!;

    // Hammer start several times.
    rooms.startRound(room!, playerId!);
    rooms.startRound(room!, playerId!);

    expect(room!.state.startsAt).toBe(firstStartsAt);
  });

  it("ignores start from non-host players", () => {
    const { rooms } = mods;
    const hostWs = new FakeSocket() as unknown as import("ws").WebSocket;
    const peerWs = new FakeSocket() as unknown as import("ws").WebSocket;
    const { room } = rooms.joinRoom(hostWs, "NON", "HOST", "c-h");
    const peer = rooms.joinRoom(peerWs, "NON", "PEER", "c-p");
    expect(peer.room).toBe(room);

    // Peer tries to start — should no-op since they're not host.
    rooms.startRound(room!, peer.playerId!);

    expect(room!.state.startsAt).toBeNull();
    expect(room!.state.phase).toBe("lobby");
  });

  it("flips phase to 'playing' once the countdown elapses", async () => {
    vi.useFakeTimers();
    try {
      const { rooms } = mods;
      const ws = new FakeSocket() as unknown as import("ws").WebSocket;
      const { room, playerId } = rooms.joinRoom(ws, "TIC", "HOST", "c-h");

      rooms.startRound(room!, playerId!);
      expect(room!.state.phase).toBe("lobby");

      await vi.advanceTimersByTimeAsync(5_100);

      expect(room!.state.phase).toBe("playing");
      expect(room!.state.startsAt).toBeNull();
      expect(room!.state.board).not.toBeNull();
      expect(room!.state.endsAt).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't start if no connected players are present", () => {
    const { rooms } = mods;
    const ws = new FakeSocket() as unknown as import("ws").WebSocket;
    const { room, playerId } = rooms.joinRoom(ws, "EMP", "HOST", "c-h");
    rooms.leaveRoom(room!, playerId!);

    rooms.startRound(room!, playerId!);
    expect(room!.state.startsAt).toBeNull();
    expect(room!.state.phase).toBe("lobby");
  });

  it("returnToLobby clears a pending countdown", () => {
    const { rooms } = mods;
    const ws = new FakeSocket() as unknown as import("ws").WebSocket;
    const { room, playerId } = rooms.joinRoom(ws, "RTL", "HOST", "c-h");

    // Put the room in results so returnToLobby is legal.
    rooms.startRound(room!, playerId!);
    // Drive through to playing and then results... too slow via real
    // timers; just inspect that calling returnToLobby mid-countdown
    // by directly forcing phase results also clears the field.
    room!.state.phase = "results"; // test-only poke
    rooms.returnToLobby(room!, playerId!);
    expect(room!.state.startsAt).toBeNull();
    expect(room!.state.phase).toBe("lobby");
  });
});
