// HTTP surface for the /result page. Spins up a minimal server with
// just the round endpoints attached and hits them like a real client
// would. We don't boot the full index.ts — that drags in the WS
// upgrade, admin routes, and log sweepers; the round handlers only
// need rooms + storage to be initialized.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

async function freshApi() {
  vi.resetModules();
  const rooms = await import("../../src/server/rooms.ts");
  const storage = await import("../../src/server/storage.ts");
  const metrics = await import("../../src/server/metrics.ts");
  const dictionary = await import("../../src/server/dictionary.ts");
  metrics.configureLogging({ dir: null });

  // Rebuild just the round endpoints onto a local Hono app.
  const app = new Hono();
  app.get("/api/round/:id", (c) => {
    const id = Number(c.req.param("id") ?? "");
    if (!Number.isFinite(id) || id <= 0 || !Number.isInteger(id)) {
      return c.json({ status: "not_found" }, 404);
    }
    const round = rooms.fetchRoundById(id);
    if (!round) return c.json({ status: "not_found" }, 404);
    return c.json({
      status: "ok",
      round,
      roomStatus: rooms.getRoomStatus(round.roomCode),
    });
  });
  app.get("/api/room/:code/round", (c) => {
    const code = (c.req.param("code") ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 4);
    if (!code) return c.json({ status: "not_found" }, 404);
    const round = rooms.fetchLatestRoundForRoom(code);
    if (round) {
      return c.json({
        status: "ok",
        round,
        roomStatus: rooms.getRoomStatus(code),
      });
    }
    const phase = rooms.getRoomPhase(code);
    if (phase === null) return c.json({ status: "not_found" }, 404);
    return c.json({ status: "in_progress", phase }, 200);
  });

  return { app, rooms, storage, dictionary };
}

class FakeSocket {
  readyState = 1;
  readonly OPEN = 1;
  readonly CLOSED = 3;
  send(_data: string): void {}
  close(): void {
    this.readyState = this.CLOSED;
  }
}

function seedRound(
  storage: Awaited<ReturnType<typeof freshApi>>["storage"],
  overrides: Partial<Parameters<typeof storage.insertRound>[0]> = {},
): number {
  return storage.insertRound({
    roomCode: "RND1",
    startedAt: 1_000_000,
    endedAt: 1_060_000,
    board: Array.from({ length: 16 }, (_, i) => String.fromCharCode(65 + i)),
    settings: { roundSeconds: 60, size: 4 },
    hostId: "p1",
    players: [
      { id: "p1", name: "AAAA", score: 3, words: ["cab"] },
    ],
    possibleWords: ["cab", "dab"],
    ...overrides,
  });
}

describe("round API — /api/round/:id", () => {
  let tmp: string;
  let api: Awaited<ReturnType<typeof freshApi>>;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "bawgle-api-"));
    api = await freshApi();
    api.storage.initStorage(join(tmp, "test.db"));
    api.dictionary.loadDictionary();
  });
  afterEach(() => {
    api.storage.closeStorage();
    rmSync(tmp, { recursive: true, force: true });
  });

  async function req(path: string) {
    const res = await api.app.request(path);
    return { status: res.status, body: await res.json() };
  }

  it("404s for a non-existent numeric id", async () => {
    const { status, body } = await req("/api/round/9999");
    expect(status).toBe(404);
    expect((body as { status: string }).status).toBe("not_found");
  });

  it("404s for a non-numeric id", async () => {
    const { status } = await req("/api/round/hello");
    expect(status).toBe(404);
  });

  it("returns the round + roomStatus for an existing id", async () => {
    const id = seedRound(api.storage);
    const { status, body } = await req(`/api/round/${id}`);
    expect(status).toBe(200);
    const ok = body as { status: string; round: { id: number; roomCode: string }; roomStatus: string };
    expect(ok.status).toBe("ok");
    expect(ok.round.id).toBe(id);
    expect(ok.round.roomCode).toBe("RND1");
    // Room isn't in memory (never joined) → status should be 'closed'.
    expect(ok.roomStatus).toBe("closed");
  });

  it("reports 'active' roomStatus when a player is connected to the same room", async () => {
    const id = seedRound(api.storage);
    const ws = new FakeSocket() as unknown as import("ws").WebSocket;
    api.rooms.joinRoom(ws, "RND1", "HOST", "c-h");
    const { body } = await req(`/api/round/${id}`);
    const ok = body as { roomStatus: string };
    expect(ok.roomStatus).toBe("active");
  });
});

describe("round API — /api/room/:code/round", () => {
  let tmp: string;
  let api: Awaited<ReturnType<typeof freshApi>>;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "bawgle-api2-"));
    api = await freshApi();
    api.storage.initStorage(join(tmp, "test.db"));
    api.dictionary.loadDictionary();
  });
  afterEach(() => {
    api.storage.closeStorage();
    rmSync(tmp, { recursive: true, force: true });
  });

  async function req(path: string) {
    const res = await api.app.request(path);
    return { status: res.status, body: await res.json() };
  }

  it("404s for a room that has never existed", async () => {
    const { status, body } = await req("/api/room/NONE/round");
    expect(status).toBe(404);
    expect((body as { status: string }).status).toBe("not_found");
  });

  it("returns 'in_progress' when the room exists but has no completed rounds", async () => {
    const ws = new FakeSocket() as unknown as import("ws").WebSocket;
    api.rooms.joinRoom(ws, "LIVE", "HOST", "c-h");
    const { status, body } = await req("/api/room/LIVE/round");
    expect(status).toBe(200);
    expect((body as { status: string }).status).toBe("in_progress");
  });

  it("returns the most recent round for the requested code", async () => {
    seedRound(api.storage, { roomCode: "TWO", endedAt: 1_000_000 });
    seedRound(api.storage, { roomCode: "TWO", endedAt: 2_000_000 });
    const { body } = await req("/api/room/TWO/round");
    const ok = body as { status: string; round: { endedAt: number } };
    expect(ok.status).toBe("ok");
    expect(ok.round.endedAt).toBe(2_000_000);
  });

  it("is case-insensitive on the room code", async () => {
    seedRound(api.storage, { roomCode: "CASE" });
    const { body } = await req("/api/room/case/round");
    expect((body as { status: string }).status).toBe("ok");
  });
});
