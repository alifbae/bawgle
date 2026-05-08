// BAWGLE_ENVIRONMENT=development should relax the minimum round time
// from 60s to 5s so iteration on the results screen doesn't require
// a full minute between rounds. Production must keep the strict floor.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function freshRooms(env: string | undefined) {
  // rooms.ts reads BAWGLE_ENVIRONMENT at call-time in updateSettings,
  // so resetting modules + mutating process.env is sufficient.
  vi.resetModules();
  if (env === undefined) {
    delete process.env.BAWGLE_ENVIRONMENT;
  } else {
    process.env.BAWGLE_ENVIRONMENT = env;
  }
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
  send(_data: string): void {}
  close(): void {
    this.readyState = this.CLOSED;
  }
}

describe("roundSeconds floor by environment", () => {
  let tmp: string;
  let priorEnv: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "bawgle-devmin-"));
    priorEnv = process.env.BAWGLE_ENVIRONMENT;
  });
  afterEach(() => {
    if (priorEnv === undefined) delete process.env.BAWGLE_ENVIRONMENT;
    else process.env.BAWGLE_ENVIRONMENT = priorEnv;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("clamps to 60s minimum in production", async () => {
    const { rooms, storage, dictionary } = await freshRooms("production");
    storage.initStorage(join(tmp, "test.db"));
    dictionary.loadDictionary();

    const ws = new FakeSocket() as unknown as import("ws").WebSocket;
    const { room, playerId } = rooms.joinRoom(ws, "PROD", "HOST", "c-h");
    rooms.updateSettings(room!, playerId!, { roundSeconds: 5 });
    expect(room!.state.settings.roundSeconds).toBe(60);

    storage.closeStorage();
  });

  it("allows 5s minimum in development", async () => {
    const { rooms, storage, dictionary } = await freshRooms("development");
    storage.initStorage(join(tmp, "test.db"));
    dictionary.loadDictionary();

    const ws = new FakeSocket() as unknown as import("ws").WebSocket;
    const { room, playerId } = rooms.joinRoom(ws, "DEV", "HOST", "c-h");
    rooms.updateSettings(room!, playerId!, { roundSeconds: 5 });
    expect(room!.state.settings.roundSeconds).toBe(5);

    storage.closeStorage();
  });

  it("still clamps below the dev floor in development", async () => {
    const { rooms, storage, dictionary } = await freshRooms("development");
    storage.initStorage(join(tmp, "test.db"));
    dictionary.loadDictionary();

    const ws = new FakeSocket() as unknown as import("ws").WebSocket;
    const { room, playerId } = rooms.joinRoom(ws, "DEV2", "HOST", "c-h");
    rooms.updateSettings(room!, playerId!, { roundSeconds: 1 });
    expect(room!.state.settings.roundSeconds).toBe(5);

    storage.closeStorage();
  });

  it("enforces the 300s ceiling in both environments", async () => {
    const { rooms, storage, dictionary } = await freshRooms("development");
    storage.initStorage(join(tmp, "test.db"));
    dictionary.loadDictionary();

    const ws = new FakeSocket() as unknown as import("ws").WebSocket;
    const { room, playerId } = rooms.joinRoom(ws, "CAP", "HOST", "c-h");
    rooms.updateSettings(room!, playerId!, { roundSeconds: 10_000 });
    expect(room!.state.settings.roundSeconds).toBe(300);

    storage.closeStorage();
  });
});
