import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Rooms keeps a module-global Map. Each test boots a fresh copy of the
// module graph so rooms, storage, and metrics are isolated from each
// other. This is a bit expensive (~50ms / test) but worth it — the
// alternative is adding a reset() export that exists only for tests.
async function freshRooms() {
  vi.resetModules();
  const rooms = await import("../../src/server/rooms.ts");
  const storage = await import("../../src/server/storage.ts");
  const metrics = await import("../../src/server/metrics.ts");
  const dictionary = await import("../../src/server/dictionary.ts");
  // Silence log-to-disk during tests.
  metrics.configureLogging({ dir: null });
  return { rooms, storage, dictionary };
}

// Minimal fake that satisfies what rooms.ts uses: readyState/OPEN/send.
class FakeSocket {
  readyState = 1; // OPEN
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

function firstMsg<T = unknown>(ws: FakeSocket): T {
  return JSON.parse(ws.sent[0]!) as T;
}

function lastMsg<T = unknown>(ws: FakeSocket): T {
  return JSON.parse(ws.sent[ws.sent.length - 1]!) as T;
}

describe("rooms", () => {
  let tmp: string;
  let mod: Awaited<ReturnType<typeof freshRooms>>;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "bawgle-rooms-"));
    mod = await freshRooms();
    mod.storage.initStorage(join(tmp, "test.db"));
    // Load the real dictionary once per test — room start depends on
    // solveBoard, and we don't want to drag fake words in.
    mod.dictionary.loadDictionary();
  });

  afterEach(() => {
    mod.storage.closeStorage();
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("joinRoom", () => {
    it("creates a room on first join and makes the joiner the host", () => {
      const ws = new FakeSocket();
      const r = mod.rooms.joinRoom(ws as never, "ABCD", "alfa", "client-1");
      if (r.playerId === null) throw new Error("expected a player");
      expect(r.room.state.code).toBe("ABCD");
      expect(r.room.state.hostId).toBe(r.playerId);
      expect(r.room.state.players).toHaveLength(1);
      // The `joined` frame is sent directly on this socket before any
      // broadcast. `state` frames follow from emitState.
      const msg = firstMsg<{ t: string; you: string }>(ws);
      expect(msg.t).toBe("joined");
      expect(msg.you).toBe(r.playerId);
    });

    it("sanitizes the code and name on join", () => {
      const ws = new FakeSocket();
      const r = mod.rooms.joinRoom(ws as never, "  a b  ", "foo!@bar", "c1");
      if (r.playerId === null) throw new Error();
      // Code: trimmed, uppercased, sliced to 4 chars. Whitespace in the
      // middle is NOT stripped — this is intentional so users get
      // feedback that "AB CD" is a different room than "ABCD".
      expect(r.room.state.code).toBe("A B");
      // name: uppercased, non-alnum stripped, limited to 4 chars.
      expect(r.room.state.players[0].name).toBe("FOOB");
    });

    it("reconnecting the same clientId reuses the same player slot", () => {
      const ws1 = new FakeSocket();
      const first = mod.rooms.joinRoom(ws1 as never, "ROOM", "alfa", "client-1");
      if (first.playerId === null) throw new Error();

      // Simulate the first socket closing before reconnect.
      ws1.readyState = ws1.CLOSED;

      const ws2 = new FakeSocket();
      const second = mod.rooms.joinRoom(ws2 as never, "ROOM", "alfa", "client-1");
      if (second.playerId === null) throw new Error();

      expect(second.playerId).toBe(first.playerId);
      expect(second.room.state.players).toHaveLength(1);
    });

    it("a second live tab with the same clientId gets a distinct identity", () => {
      const ws1 = new FakeSocket();
      const first = mod.rooms.joinRoom(ws1 as never, "ROOM", "alfa", "client-1");
      if (first.playerId === null) throw new Error();

      // ws1 stays OPEN; second join with same clientId should NOT claim
      // the same slot.
      const ws2 = new FakeSocket();
      const second = mod.rooms.joinRoom(ws2 as never, "ROOM", "beta", "client-1");
      if (second.playerId === null) throw new Error();

      expect(second.playerId).not.toBe(first.playerId);
      expect(second.room.state.players).toHaveLength(2);
      // The server also minted a distinguished clientId for the second tab.
      const joined = firstMsg<{ t: string; clientId: string }>(ws2);
      expect(joined.t).toBe("joined");
      expect(joined.clientId).not.toBe("client-1");
      expect(joined.clientId.startsWith("client-1:")).toBe(true);
    });

    it("rejects new players when the per-room cap is hit", () => {
      // MAX_PLAYERS_PER_ROOM = 32. Fill it up.
      const first = mod.rooms.joinRoom(new FakeSocket() as never, "FULL", "alfa", "c0");
      if (first.playerId === null) throw new Error();

      for (let i = 1; i < 32; i++) {
        const r = mod.rooms.joinRoom(
          new FakeSocket() as never,
          "FULL",
          "u" + i,
          "c" + i
        );
        if (r.playerId === null) throw new Error(`unexpected reject at ${i}`);
      }

      const ws = new FakeSocket();
      const r = mod.rooms.joinRoom(ws as never, "FULL", "late", "c99");
      expect(r.playerId).toBeNull();
      if (r.playerId !== null) throw new Error();
      expect(r.reason).toBe("room_full");
      const msg = lastMsg<{ t: string; message: string }>(ws);
      expect(msg.t).toBe("error");
      expect(msg.message).toMatch(/full/i);
    });
  });

  describe("leaveRoom + host transfer", () => {
    it("marks the player disconnected and transfers host to another connected player", () => {
      const ws1 = new FakeSocket();
      const ws2 = new FakeSocket();
      const a = mod.rooms.joinRoom(ws1 as never, "HOST", "alfa", "c1");
      const b = mod.rooms.joinRoom(ws2 as never, "HOST", "beta", "c2");
      if (a.playerId === null || b.playerId === null) throw new Error();

      mod.rooms.leaveRoom(a.room, a.playerId);
      expect(b.room.state.hostId).toBe(b.playerId);
      const leaver = b.room.state.players.find((p) => p.id === a.playerId);
      expect(leaver?.connected).toBe(false);
    });

    it("restores the original host when they reconnect", () => {
      const ws1 = new FakeSocket();
      const ws2 = new FakeSocket();
      const host = mod.rooms.joinRoom(ws1 as never, "BACK", "host", "c1");
      const guest = mod.rooms.joinRoom(ws2 as never, "BACK", "gues", "c2");
      if (host.playerId === null || guest.playerId === null) throw new Error();

      // Host drops; guest takes over.
      ws1.readyState = ws1.CLOSED;
      mod.rooms.leaveRoom(host.room, host.playerId);
      expect(guest.room.state.hostId).toBe(guest.playerId);

      // Host reconnects — crown comes back.
      const ws3 = new FakeSocket();
      const back = mod.rooms.joinRoom(ws3 as never, "BACK", "host", "c1");
      if (back.playerId === null) throw new Error();
      expect(back.room.state.hostId).toBe(host.playerId);
    });
  });

  describe("ready + round lifecycle", () => {
    it("ignores ready toggles during a round", () => {
      const ws = new FakeSocket();
      const host = mod.rooms.joinRoom(ws as never, "RDY1", "host", "c1");
      if (host.playerId === null) throw new Error();

      mod.rooms.startRound(host.room, host.playerId); mod.rooms.__beginRoundForTests(host.room);
      expect(host.room.state.phase).toBe("playing");
      mod.rooms.setReady(host.room, host.playerId, true);
      // No change — still playing, ready untouched.
      expect(host.room.state.phase).toBe("playing");
    });

    it("start requires all non-host players ready", () => {
      const host = mod.rooms.joinRoom(new FakeSocket() as never, "RDY2", "host", "c1");
      const guest = mod.rooms.joinRoom(new FakeSocket() as never, "RDY2", "gues", "c2");
      if (host.playerId === null || guest.playerId === null) throw new Error();

      // Guest not ready — start is a no-op.
      mod.rooms.startRound(host.room, host.playerId); mod.rooms.__beginRoundForTests(host.room);
      expect(host.room.state.phase).toBe("lobby");

      // Ready up, try again.
      mod.rooms.setReady(host.room, guest.playerId, true);
      mod.rooms.startRound(host.room, host.playerId); mod.rooms.__beginRoundForTests(host.room);
      expect(host.room.state.phase).toBe("playing");
      expect(host.room.state.board).not.toBeNull();
      expect(host.room.state.endsAt).not.toBeNull();
    });

    it("non-host start attempts are ignored", () => {
      const host = mod.rooms.joinRoom(new FakeSocket() as never, "HOP", "host", "c1");
      const guest = mod.rooms.joinRoom(new FakeSocket() as never, "HOP", "gues", "c2");
      if (host.playerId === null || guest.playerId === null) throw new Error();
      mod.rooms.setReady(host.room, guest.playerId, true);
      mod.rooms.startRound(host.room, guest.playerId);
      expect(host.room.state.phase).toBe("lobby");
    });
  });

  describe("submitWord", () => {
    it("rejects words outside playing phase", () => {
      const host = mod.rooms.joinRoom(new FakeSocket() as never, "W1", "host", "c1");
      if (host.playerId === null) throw new Error();
      const r = mod.rooms.submitWord(host.room, host.playerId, "cat");
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/not active/i);
    });

    it("rejects too-short words and non-letter input", () => {
      const host = mod.rooms.joinRoom(new FakeSocket() as never, "W2", "host", "c1");
      if (host.playerId === null) throw new Error();
      mod.rooms.startRound(host.room, host.playerId); mod.rooms.__beginRoundForTests(host.room);

      expect(mod.rooms.submitWord(host.room, host.playerId, "ab").ok).toBe(false);
      expect(mod.rooms.submitWord(host.room, host.playerId, "cat1").ok).toBe(false);
    });

    it("rejects duplicate submissions from the same player", () => {
      // Pin a known board so we can test a specific word.
      const host = mod.rooms.joinRoom(new FakeSocket() as never, "W3", "host", "c1");
      if (host.playerId === null) throw new Error();
      mod.rooms.startRound(host.room, host.playerId); mod.rooms.__beginRoundForTests(host.room);

      // Seed the player's word list as if they already scored "catsup".
      const p = host.room.state.players[0];
      p.words = ["hello"];
      const r = mod.rooms.submitWord(host.room, host.playerId, "hello");
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/already/i);
    });
  });

  describe("updateSettings", () => {
    it("clamps round seconds and rejects unsupported sizes", () => {
      const host = mod.rooms.joinRoom(new FakeSocket() as never, "SET1", "host", "c1");
      if (host.playerId === null) throw new Error();
      mod.rooms.updateSettings(host.room, host.playerId, {
        roundSeconds: 9999,
        size: 7 as 4,
      });
      // Clamped to maxRoundSeconds=300, size stays at default 4.
      expect(host.room.state.settings.roundSeconds).toBe(300);
      expect(host.room.state.settings.size).toBe(4);
    });

    it("rejects changes from non-hosts", () => {
      const host = mod.rooms.joinRoom(new FakeSocket() as never, "SET2", "host", "c1");
      const guest = mod.rooms.joinRoom(new FakeSocket() as never, "SET2", "gues", "c2");
      if (host.playerId === null || guest.playerId === null) throw new Error();
      mod.rooms.updateSettings(host.room, guest.playerId, { size: 5 });
      expect(host.room.state.settings.size).toBe(4);
    });

    it("rejects changes during a round", () => {
      const host = mod.rooms.joinRoom(new FakeSocket() as never, "SET3", "host", "c1");
      if (host.playerId === null) throw new Error();
      mod.rooms.startRound(host.room, host.playerId); mod.rooms.__beginRoundForTests(host.room);
      mod.rooms.updateSettings(host.room, host.playerId, { size: 5 });
      expect(host.room.state.settings.size).toBe(4);
    });
  });

  describe("sweepStaleRooms", () => {
    it("leaves live rooms alone even when their timestamp is old", async () => {
      const ws = new FakeSocket();
      const host = mod.rooms.joinRoom(ws as never, "LIVE", "host", "c1");
      if (host.playerId === null) throw new Error();
      // Room is in memory and has a live conn — sweeper must spare it.
      const purged = mod.rooms.sweepStaleRooms(Date.now() + 365 * 24 * 3600 * 1000);
      expect(purged).toBe(0);
      expect(mod.rooms.roomsSummary().total).toBe(1);
    });
  });

  describe("snapshots", () => {
    it("roomsSummary aggregates phases and player counts", () => {
      mod.rooms.joinRoom(new FakeSocket() as never, "A", "alfa", "c1");
      const b = mod.rooms.joinRoom(new FakeSocket() as never, "B", "beta", "c2");
      if (b.playerId === null) throw new Error();
      mod.rooms.startRound(b.room, b.playerId); mod.rooms.__beginRoundForTests(b.room);
      const summary = mod.rooms.roomsSummary();
      expect(summary.total).toBe(2);
      expect(summary.playing).toBe(1);
      expect(summary.lobby).toBe(1);
    });

    it("roomsSnapshot sorts playing rooms first", () => {
      const a = mod.rooms.joinRoom(new FakeSocket() as never, "AAAA", "alfa", "c1");
      const b = mod.rooms.joinRoom(new FakeSocket() as never, "BBBB", "beta", "c2");
      if (b.playerId === null) throw new Error();
      mod.rooms.startRound(b.room, b.playerId); mod.rooms.__beginRoundForTests(b.room);
      const snap = mod.rooms.roomsSnapshot();
      expect(snap[0].phase).toBe("playing");
      expect(snap[0].code).toBe("BBBB");
      void a;
    });
  });
});
