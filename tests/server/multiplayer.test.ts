// Multiplayer integration tests — two+ real WebSocket clients against a
// real http server. These exist because real multi-player issues
// (hosts not seeing new joins, stale state after "play again") kept
// slipping past the unit tests that exercise rooms.ts in isolation
// without real sockets.
//
// Each test spins up a fresh server instance so rooms/metrics state
// doesn't bleed across cases. The helpers here mirror netcode.test.ts.

import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { ServerMsg } from "../../shared/types.ts";

// Capture the real timer primitives at module load, BEFORE any test
// installs vi.useFakeTimers. The test helpers below (TestClient.next,
// nextMatching, wait) all use these captures so their timeouts tick on
// real wall time regardless of whether the test under them is faking
// setTimeout for server-side countdowns. Without this, a 2000ms
// message-wait in nextMatching would fire instantly inside an
// advanceTimersByTimeAsync(5_100) and reject before real WS messages
// could arrive over loopback.
const realSetTimeout: typeof setTimeout = globalThis.setTimeout.bind(globalThis);
const realClearTimeout: typeof clearTimeout =
  globalThis.clearTimeout.bind(globalThis);

async function freshServer(): Promise<{
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

  const tmp = mkdtempSync(join(tmpdir(), "bawgle-mp-"));
  storage.initStorage(join(tmp, "test.db"));
  dictionary.loadDictionary();
  metrics.configureLogging({ dir: null });

  const http = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  const handle = netcode.attachNetcode(http, {
    heartbeatMs: 30_000, // tests don't exercise heartbeat
    msgBucketSize: 100,
    msgBucketRate: 50,
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as AddressInfo).port;

  return {
    url: `ws://127.0.0.1:${port}/ws`,
    http,
    async close() {
      const clients = [...handle.wss.clients];
      const drained = Promise.all(
        clients.map(
          (c) =>
            new Promise<void>((resolve) => {
              if (c.readyState === c.CLOSED) return resolve();
              c.once("close", () => resolve());
              c.terminate();
            }),
        ),
      );
      handle.close();
      await drained;
      await new Promise<void>((resolve) => http.close(() => resolve()));
      storage.closeStorage();
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

/** Thin client wrapper that queues server messages for ordered consumption. */
class TestClient {
  readonly ws: WebSocket;
  private queue: ServerMsg[] = [];
  private waiters: ((m: ServerMsg) => void)[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (data) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(data.toString()) as ServerMsg;
      } catch {
        return;
      }
      const waiter = this.waiters.shift();
      if (waiter) waiter(msg);
      else this.queue.push(msg);
    });
  }

  async open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Await the next queued message, or the next to arrive. */
  next(timeoutMs = 2000): Promise<ServerMsg> {
    const immediate = this.queue.shift();
    if (immediate) return Promise.resolve(immediate);
    return new Promise<ServerMsg>((resolve, reject) => {
      // Real-timer setTimeout so this helper keeps ticking on wall
      // time even when a test installs vi.useFakeTimers to drive
      // server-side countdowns.
      const t = realSetTimeout(() => {
        const idx = this.waiters.indexOf(settle);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`no message within ${timeoutMs}ms`));
      }, timeoutMs);
      const settle = (m: ServerMsg) => {
        realClearTimeout(t);
        resolve(m);
      };
      this.waiters.push(settle);
    });
  }

  /** Keep consuming until a predicate hits, return the matched msg. */
  async nextMatching<T extends ServerMsg["t"]>(
    type: T,
    predicate: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true,
    timeoutMs = 2000,
  ): Promise<Extract<ServerMsg, { t: T }>> {
    // Deadline on real wall time — not fake — so tests with faked
    // setTimeout can still rely on this helper to time out correctly.
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const remaining = Math.max(10, timeoutMs - (Date.now() - start));
      const msg = await this.next(remaining);
      if (msg.t === type && predicate(msg as Extract<ServerMsg, { t: T }>)) {
        return msg as Extract<ServerMsg, { t: T }>;
      }
    }
    throw new Error(`no ${type} matching predicate within ${timeoutMs}ms`);
  }

  /** Drain messages already in the queue without blocking. */
  drain(): ServerMsg[] {
    const out = this.queue.slice();
    this.queue.length = 0;
    return out;
  }

  close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }

  terminate(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.ws.once("close", () => resolve());
      this.ws.terminate();
    });
  }
}

async function joinRoom(
  url: string,
  code: string,
  name: string,
  clientId: string,
): Promise<{ client: TestClient; playerId: string }> {
  const client = new TestClient(url);
  await client.open();
  client.send({ t: "join", code, name, clientId });
  const joined = await client.nextMatching("joined");
  return { client, playerId: joined.you };
}

function wait(ms: number): Promise<void> {
  // Real-timer wait, unaffected by vi.useFakeTimers.
  return new Promise((r) => realSetTimeout(r, ms));
}

describe("multiplayer — host sees each new player join", () => {
  let srv: Awaited<ReturnType<typeof freshServer>>;

  beforeEach(async () => {
    srv = await freshServer();
  });
  afterEach(async () => {
    await srv.close();
  });

  it("broadcasts state to host when a second player joins", async () => {
    const { client: host } = await joinRoom(srv.url, "ROOM", "HOST", "c-host");
    host.drain(); // clear initial state

    const { client: p2 } = await joinRoom(srv.url, "ROOM", "PTWO", "c-p2");

    // Host should see a state update with 2 players.
    const state = await host.nextMatching(
      "state",
      (m) => m.state.players.length === 2,
    );
    expect(state.state.players.map((p) => p.name)).toEqual(
      expect.arrayContaining(["HOST", "PTWO"]),
    );

    await host.close();
    await p2.close();
  });

  it(
    "broadcasts to host for every one of 6 players joining sequentially",
    async () => {
      // Reproduces the 6-player symptom: each new arrival should cause
      // a state update on every existing socket. If broadcast() silently
      // skipped any peer (zombie socket), the host's final state would
      // show fewer than 6 players.
      const { client: host } = await joinRoom(srv.url, "SIX", "HOST", "c-host");
      host.drain();

      const others: TestClient[] = [];
      for (let i = 0; i < 5; i++) {
        const { client } = await joinRoom(srv.url, "SIX", `P${i}`, `c-p${i}`);
        others.push(client);
      }

      // Host should have received at least 5 state updates. The final
      // one must reflect all 6 players connected.
      const finalState = await host.nextMatching(
        "state",
        (m) =>
          m.state.players.length === 6 &&
          m.state.players.every((p) => p.connected),
        3000,
      );
      expect(finalState.state.players).toHaveLength(6);

      await host.close();
      await Promise.all(others.map((c) => c.close()));
    },
  );
});

describe("multiplayer — reconnect and host preservation", () => {
  let srv: Awaited<ReturnType<typeof freshServer>>;

  beforeEach(async () => {
    srv = await freshServer();
  });
  afterEach(async () => {
    await srv.close();
  });

  it(
    "host keeps the crown through a transient socket drop + reconnect",
    async () => {
      // Host joins, socket dies mid-session, host reconnects with the
      // same clientId. They should regain host status (the bug report:
      // "first new player becomes host because host had to refresh").
      const hostA = await joinRoom(srv.url, "CRWN", "HOST", "c-host");
      const hostId = hostA.playerId;

      // A second player connects so there's a live socket to take the
      // crown if the server mis-transfers it.
      const p2 = await joinRoom(srv.url, "CRWN", "PTWO", "c-p2");

      // Nuke the host's socket (simulates NAT drop / tab kill).
      await hostA.client.terminate();

      // p2 should see a state update where connected drops to 1 and
      // the host slot potentially transfers.
      await p2.client.nextMatching(
        "state",
        (m) =>
          m.state.players.filter((p) => p.connected).length === 1,
        2000,
      );

      // Host reconnects with the same clientId.
      const hostB = new TestClient(srv.url);
      await hostB.open();
      hostB.send({ t: "join", code: "CRWN", name: "HOST", clientId: "c-host" });
      const rejoined = await hostB.nextMatching("joined");

      // Server re-used the original playerId, not minted a new one.
      expect(rejoined.you).toBe(hostId);
      expect(rejoined.state.hostId).toBe(hostId);

      await hostB.close();
      await p2.client.close();
    },
  );

  it(
    "new player arriving while host's socket is dead doesn't steal the host role",
    async () => {
      // Exact symptom in the bug report. Sequence:
      //   1. host joins (becomes host)
      //   2. host's socket dies (zombie or real close)
      //   3. a NEW player joins before host refreshes
      //   4. host reconnects
      //   5. host should still be host
      const hostA = await joinRoom(srv.url, "HSTK", "HOST", "c-host");
      const hostId = hostA.playerId;
      await hostA.client.terminate();

      // The close handler runs on the next tick and transfers the
      // crown. There's nobody else connected yet, so the only signal
      // we have is internal — poll briefly until the room sees the
      // host as disconnected via a fresh probe connection. Keeping
      // this deterministic stops the "new player joins before close
      // landed" flake on loaded runners.
      {
        const probe = new TestClient(srv.url);
        await probe.open();
        probe.send({
          t: "join",
          code: "HSTK",
          name: "PROB",
          clientId: "c-probe",
        });
        await probe.nextMatching(
          "joined",
          (m) => {
            const original = m.state.players.find((p) => p.id === hostId);
            return !!original && original.connected === false;
          },
          2000,
        );
        probe.send({ t: "leave" });
        await probe.close();
      }

      // New player joins while host is offline.
      const newbie = await joinRoom(srv.url, "HSTK", "NEWB", "c-newbie");

      // From newbie's perspective right now, they might be host since
      // they're the only connected player — that's acceptable transient
      // state. We care about the end state after host reconnects.

      const hostB = new TestClient(srv.url);
      await hostB.open();
      hostB.send({ t: "join", code: "HSTK", name: "HOST", clientId: "c-host" });
      const rejoined = await hostB.nextMatching("joined");

      expect(rejoined.you).toBe(hostId);
      expect(rejoined.state.hostId).toBe(hostId);

      // Newbie should also see a state update reflecting the crown
      // going back to the original host.
      await newbie.client.nextMatching(
        "state",
        (m) => m.state.hostId === hostId,
        2000,
      );

      await hostB.close();
      await newbie.client.close();
    },
  );
});

describe("multiplayer — state broadcasts after play-again", () => {
  let srv: Awaited<ReturnType<typeof freshServer>>;

  beforeEach(async () => {
    srv = await freshServer();
  });
  afterEach(async () => {
    await srv.close();
  });

  it("all connected players receive lobby state after host returns to lobby", async () => {
    // Reproduces "play again didn't refresh." Path:
    //   1. start a round
    //   2. wait for it to end naturally (short roundSeconds)
    //   3. host clicks play-again → returnToLobby
    //   4. every peer must receive the lobby-phase state
    const host = await joinRoom(srv.url, "PAGN", "HOST", "c-h");
    const a = await joinRoom(srv.url, "PAGN", "PONE", "c-a");
    const b = await joinRoom(srv.url, "PAGN", "PTWO", "c-b");

    // Shorten the round to 60s (min). That's still too long for a test,
    // but we'll drive the phase transition manually by ending the round
    // through the shared roomsFor-test API. Simpler: start the round,
    // then skip to results by having the host do nothing (we can't speed
    // up the server clock from here without touching internals). For the
    // purposes of verifying the broadcast plumbing, `lobby` from any
    // non-playing phase is equivalent. Force the results phase first
    // by bouncing through results indirectly — settings-update the
    // roundSeconds, start, and let it expire. Too flaky.
    //
    // Pragmatic alternative: drive rooms.ts directly via its imported
    // `returnToLobby` in another test. Here we verify the server emits
    // a state broadcast on ANY state mutation from any peer.
    a.client.send({ t: "ready", ready: true });
    b.client.send({ t: "ready", ready: true });
    await wait(50);
    host.client.drain();
    a.client.drain();
    b.client.drain();

    // Any non-playing state mutation should broadcast. Use settings
    // change as a proxy for "state broadcast reaches every peer."
    host.client.send({ t: "settings", settings: { roundSeconds: 90 } });

    const hostState = await host.client.nextMatching(
      "state",
      (m) => m.state.settings.roundSeconds === 90,
      2000,
    );
    const aState = await a.client.nextMatching(
      "state",
      (m) => m.state.settings.roundSeconds === 90,
      2000,
    );
    const bState = await b.client.nextMatching(
      "state",
      (m) => m.state.settings.roundSeconds === 90,
      2000,
    );

    expect(hostState.state.settings.roundSeconds).toBe(90);
    expect(aState.state.settings.roundSeconds).toBe(90);
    expect(bState.state.settings.roundSeconds).toBe(90);

    await Promise.all([host.client.close(), a.client.close(), b.client.close()]);
  });

  it("returnToLobby broadcasts reach every peer", async () => {
    // Direct test of the play-again broadcast path using a fake timer
    // to end the round instantly. Validates the broadcast plumbing
    // the user reported as "page didn't auto-refresh after play-again."
    //
    // Fake-timer + real-WebSocket gotcha: every real send() below
    // needs real wall-time to reach the server before we can advance
    // fake timers, otherwise the server hasn't scheduled the timeout
    // we're trying to advance past. `settleIO` yields real time so
    // the `start` frame lands and the countdown timer gets registered
    // before advanceTimersByTimeAsync runs.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const settleIO = () =>
      new Promise<void>((resolve) => realSetTimeout(resolve, 30));
    try {
      const rooms = await import("../../server/rooms.ts");

      const host = await joinRoom(srv.url, "RTL2", "HOST", "c-h");
      const a = await joinRoom(srv.url, "RTL2", "PONE", "c-a");
      const b = await joinRoom(srv.url, "RTL2", "PTWO", "c-b");

      a.client.send({ t: "ready", ready: true });
      b.client.send({ t: "ready", ready: true });
      await settleIO();
      host.client.drain();
      a.client.drain();
      b.client.drain();

      host.client.send({ t: "start" });
      await settleIO();
      // Skip past the pre-round countdown so `playing` can land.
      await vi.advanceTimersByTimeAsync(5_100);
      await host.client.nextMatching(
        "state",
        (m) => m.state.phase === "playing",
        2000,
      );
      await a.client.nextMatching(
        "state",
        (m) => m.state.phase === "playing",
        2000,
      );
      await b.client.nextMatching(
        "state",
        (m) => m.state.phase === "playing",
        2000,
      );

      // Advance past the round timer to force endRound → results.
      await vi.advanceTimersByTimeAsync(200_000);
      await host.client.nextMatching(
        "state",
        (m) => m.state.phase === "results",
        2000,
      );
      await a.client.nextMatching(
        "state",
        (m) => m.state.phase === "results",
        2000,
      );
      await b.client.nextMatching(
        "state",
        (m) => m.state.phase === "results",
        2000,
      );

      host.client.drain();
      a.client.drain();
      b.client.drain();

      // Host clicks "play again."
      host.client.send({ t: "lobby" });
      await settleIO();
      const hostLobby = await host.client.nextMatching(
        "state",
        (m) => m.state.phase === "lobby",
        2000,
      );
      const aLobby = await a.client.nextMatching(
        "state",
        (m) => m.state.phase === "lobby",
        2000,
      );
      const bLobby = await b.client.nextMatching(
        "state",
        (m) => m.state.phase === "lobby",
        2000,
      );
      expect(hostLobby.state.phase).toBe("lobby");
      expect(aLobby.state.phase).toBe("lobby");
      expect(bLobby.state.phase).toBe("lobby");

      // Suppress unused import warning.
      expect(rooms).toBeDefined();

      await Promise.all([
        host.client.close(),
        a.client.close(),
        b.client.close(),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a wedged peer's send failure does not block broadcasts to healthy peers", async () => {
    // We can't directly "wedge" a WebSocket, but we can close one and
    // verify the other still gets the broadcast. This is the shape of
    // the zombie-socket bug: one bad socket silently eating broadcasts.
    const host = await joinRoom(srv.url, "WDGE", "HOST", "c-h");
    const good = await joinRoom(srv.url, "WDGE", "GOOD", "c-g");
    const zombie = await joinRoom(srv.url, "WDGE", "ZMBE", "c-z");

    // Simulate zombie by terminating (server sees close eventually).
    // Immediately fire a state-changing action on the host side — the
    // broadcast should still land on `good` regardless.
    await zombie.client.terminate();

    host.client.drain();
    good.client.drain();
    host.client.send({ t: "lobby" }); // cheap state mutation

    const goodState = await good.client.nextMatching("state", () => true, 2000);
    expect(goodState.state.players).toBeDefined();

    await host.client.close();
    await good.client.close();
  });
});

describe("multiplayer — reconnect restores existing player slot", () => {
  let srv: Awaited<ReturnType<typeof freshServer>>;

  beforeEach(async () => {
    srv = await freshServer();
  });
  afterEach(async () => {
    await srv.close();
  });

  it("same clientId reconnects into the same playerId with scores intact", async () => {
    const host = await joinRoom(srv.url, "RCNX", "HOST", "c-h");
    const player = await joinRoom(srv.url, "RCNX", "PLYR", "c-p");
    const originalPlayerId = player.playerId;

    // Drop the player's connection, then wait for the server-side
    // close handler to mark the player disconnected. Using a fixed
    // sleep here was flaky on loaded boxes — if the reconnect
    // arrived before the close fired, the server treated the
    // previous socket as still-alive and minted a synthetic clientId
    // for the "second tab," breaking the playerId equality check.
    host.client.drain();
    await player.client.terminate();
    await host.client.nextMatching(
      "state",
      (m) => {
        const p = m.state.players.find((pl) => pl.id === originalPlayerId);
        return !!p && p.connected === false;
      },
      2000,
    );

    // Reconnect with same clientId. Server should re-use the
    // original slot now that the previous socket is known-closed.
    const rejoin = new TestClient(srv.url);
    await rejoin.open();
    rejoin.send({ t: "join", code: "RCNX", name: "PLYR", clientId: "c-p" });
    const joined = await rejoin.nextMatching("joined");

    expect(joined.you).toBe(originalPlayerId);
    const me = joined.state.players.find((p) => p.id === originalPlayerId);
    expect(me).toBeDefined();
    expect(me!.connected).toBe(true);

    await host.client.close();
    await rejoin.close();
  });

  it("two live tabs with the same clientId get distinct player slots", async () => {
    // Existing behavior: we don't want the second tab to hijack the
    // first tab's slot if the first is still open.
    const tab1 = await joinRoom(srv.url, "TWTB", "AAAA", "c-dup");
    const tab2 = await joinRoom(srv.url, "TWTB", "BBBB", "c-dup");
    expect(tab2.playerId).not.toBe(tab1.playerId);

    await tab1.client.close();
    await tab2.client.close();
  });
});
