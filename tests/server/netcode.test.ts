// End-to-end netcode tests. A real http.Server + real ws clients drive
// the whole upgrade → join → message → close pipeline. We tune the
// abuse-control knobs to something that fires quickly instead of the
// 30-second heartbeat / 20-msg-burst defaults.

import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

// Fresh module graph per test so rooms/metrics/storage don't leak.
async function freshServer(
  opts: {
    maxConnsPerIp?: number;
    msgBucketSize?: number;
    msgBucketRate?: number;
    heartbeatMs?: number;
    maxFrameBytes?: number;
  } = {}
): Promise<{
  url: string;
  http: HttpServer;
  close: () => Promise<void>;
}> {
  vi.resetModules();
  const [netcode, storage, metrics, dictionary] = await Promise.all([
    import("../../server/netcode.ts"),
    import("../../server/storage.ts"),
    import("../../server/metrics.ts"),
    import("../../server/dictionary.ts"),
  ]);

  const tmp = mkdtempSync(join(tmpdir(), "bawgle-net-"));
  storage.initStorage(join(tmp, "test.db"));
  dictionary.loadDictionary();
  metrics.configureLogging({ dir: null });

  const http = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });

  const handle = netcode.attachNetcode(http, opts);

  await new Promise<void>((resolve) => {
    http.listen(0, "127.0.0.1", resolve);
  });
  const port = (http.address() as AddressInfo).port;
  const url = `ws://127.0.0.1:${port}/ws`;

  return {
    url,
    http,
    async close() {
      // Terminate all live sockets and wait for their 'close' events
      // to drain. Storage can only be closed once rooms.leaveRoom →
      // persist() has stopped firing.
      const clients = [...handle.wss.clients];
      const drained = Promise.all(
        clients.map(
          (c) =>
            new Promise<void>((resolve) => {
              if (c.readyState === c.CLOSED) return resolve();
              c.once("close", () => resolve());
              c.terminate();
            })
        )
      );
      handle.close();
      await drained;
      await new Promise<void>((resolve) => http.close(() => resolve()));
      storage.closeStorage();
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

async function waitForOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return;
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

async function waitForMessage<T = unknown>(ws: WebSocket): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    ws.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()) as T);
      } catch (e) {
        reject(e);
      }
    });
    ws.once("error", reject);
  });
}

function collectMessages(ws: WebSocket): unknown[] {
  const received: unknown[] = [];
  ws.on("message", (data) => {
    try {
      received.push(JSON.parse(data.toString()));
    } catch {
      /* ignore malformed */
    }
  });
  return received;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("netcode — happy path", () => {
  let srv: Awaited<ReturnType<typeof freshServer>>;

  beforeEach(async () => {
    srv = await freshServer();
  });
  afterEach(async () => {
    await srv.close();
  });

  it("accepts an upgrade on /ws and completes a join handshake", async () => {
    const ws = new WebSocket(srv.url);
    await waitForOpen(ws);

    ws.send(JSON.stringify({ t: "join", code: "TEST", name: "AAAA", clientId: "c1" }));
    const msg = await waitForMessage<{ t: string; you: string }>(ws);
    expect(msg.t).toBe("joined");
    expect(msg.you).toMatch(/\w+/);

    ws.close();
  });

  it("rejects upgrades on any other path", async () => {
    const bad = new WebSocket(srv.url.replace("/ws", "/other"));
    // Server destroys the socket without sending a response; ws raises.
    const err = await new Promise<Error>((resolve) => {
      bad.once("error", (e: Error) => resolve(e));
      bad.once("open", () => resolve(new Error("unexpected open")));
    });
    expect(err.message).toMatch(/unexpected server response|socket hang up/i);
  });
});

describe("netcode — abuse controls", () => {
  it("closes a socket whose token bucket runs dry", async () => {
    // Tiny bucket and refill so the test finishes fast.
    const srv = await freshServer({ msgBucketSize: 3, msgBucketRate: 1 });
    try {
      const ws = new WebSocket(srv.url);
      await waitForOpen(ws);
      const msgs = collectMessages(ws);
      const closed = new Promise<{ code: number; reason: string }>((resolve) => {
        ws.once("close", (code, reason) =>
          resolve({ code, reason: reason.toString() })
        );
      });
      // Burn the bucket: 3 allowed, next several should fail.
      for (let i = 0; i < 8; i++) ws.send("not-json");
      const info = await closed;
      expect(info.code).toBe(1008);
      expect(info.reason.toLowerCase()).toContain("rate");
      // At least one error frame should have landed before the close.
      expect(msgs.some((m) => (m as { t?: string }).t === "error")).toBe(true);
    } finally {
      await srv.close();
    }
  });

  it("returns an error frame on malformed JSON without closing", async () => {
    const srv = await freshServer({ msgBucketSize: 20, msgBucketRate: 5 });
    try {
      const ws = new WebSocket(srv.url);
      await waitForOpen(ws);
      ws.send("definitely not json");
      const err = await waitForMessage<{ t: string; message: string }>(ws);
      expect(err.t).toBe("error");
      expect(err.message).toMatch(/bad json/i);
      // Socket still open.
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    } finally {
      await srv.close();
    }
  });

  it("rejects upgrades beyond the per-IP connection cap", async () => {
    const srv = await freshServer({ maxConnsPerIp: 2 });
    try {
      const a = new WebSocket(srv.url);
      const b = new WebSocket(srv.url);
      await waitForOpen(a);
      await waitForOpen(b);

      const c = new WebSocket(srv.url);
      const err = await new Promise<Error>((resolve) => {
        c.once("error", (e: Error) => resolve(e));
        c.once("open", () => resolve(new Error("unexpected open")));
      });
      expect(err.message).toMatch(/429|unexpected server response/i);

      a.close();
      b.close();
    } finally {
      await srv.close();
    }
  });

  it("enforces the maxPayload cap at the protocol level", async () => {
    const srv = await freshServer({ maxFrameBytes: 128 });
    try {
      const ws = new WebSocket(srv.url);
      await waitForOpen(ws);
      const closed = new Promise<number>((resolve) => {
        ws.once("close", (code) => resolve(code));
      });
      ws.send("a".repeat(256));
      const code = await closed;
      // ws protocol: 1009 = message too big.
      expect([1009, 1006]).toContain(code);
    } finally {
      await srv.close();
    }
  });
});

describe("netcode — heartbeat", () => {
  it("terminates sockets that do not respond to pings", async () => {
    const srv = await freshServer({ heartbeatMs: 50 });
    try {
      const ws = new WebSocket(srv.url);
      await waitForOpen(ws);

      // Swallow pings so we never pong back.
      ws.on("ping", () => {
        /* deliberately do nothing */
      });
      // ws auto-pongs by default; prevent that.
      (ws as unknown as { _autoPong?: boolean })._autoPong = false;

      const closed = new Promise<number>((resolve) => {
        ws.once("close", (code) => resolve(code));
      });
      // Wait for heartbeat * 2 — the server terminates on the second
      // tick that finds `alive` still false.
      const code = await Promise.race([closed, wait(300).then(() => -1)]);
      expect(code).not.toBe(-1);
    } finally {
      await srv.close();
    }
  });
});

describe("netcode — word play over the wire", () => {
  it(
    "reports word_result for a well-formed word submission",
    async () => {
      const srv = await freshServer();
      try {
      const ws = new WebSocket(srv.url);
      await waitForOpen(ws);

      ws.send(JSON.stringify({ t: "join", code: "PLAY", name: "ONE", clientId: "c1" }));
      const joined = await waitForMessage<{ t: string }>(ws);
      expect(joined.t).toBe("joined");

      // Start a round. The host first enters a 5s countdown (board
      // stays null) before the round actually begins and the board
      // gets rolled. Keep reading state frames until we see a non-null
      // board, which signals the round is live.
      ws.send(JSON.stringify({ t: "start" }));
      const deadline = Date.now() + 8_000;
      let gotBoard = false;
      while (Date.now() < deadline) {
        const next = await waitForMessage<{
          t: string;
          state?: { board: string[] | null };
        }>(ws);
        if (next.t === "state" && next.state?.board) {
          gotBoard = true;
          break;
        }
      }
      expect(gotBoard).toBe(true);

      // Submit a too-short word; we should get a rejection frame.
      ws.send(JSON.stringify({ t: "word", word: "ab" }));
      const result = await waitForMessage<{ t: string; ok: boolean }>(ws);
      expect(result.t).toBe("word_result");
      expect(result.ok).toBe(false);

      ws.close();
    } finally {
      await srv.close();
    }
  },
    10_000,
  );
});
