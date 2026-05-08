// WebSocket abuse controls + message dispatch.
//
// Broken out from server/index.ts so the same wiring can be driven from
// tests with different knobs (smaller rate caps, shorter heartbeats).
// The production server uses the default options; tests pass overrides.
//
//  MAX_FRAME_BYTES   — any single WS message larger than this is
//                      rejected at the protocol layer.
//  MAX_CONNS_PER_IP  — cap concurrent sockets per client IP.
//  MSG_BUCKET_SIZE   — per-connection token bucket burst.
//  MSG_BUCKET_RATE   — sustained messages/sec/conn after the burst.
//  HEARTBEAT_MS      — ping interval; sockets that miss a pong for the
//                      full interval are terminated. Reclaims zombies
//                      that would otherwise pin a slot in the per-IP
//                      cap.

import type { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMsg, ServerMsg } from "../shared/types.ts";
import {
  joinRoom,
  leaveRoom,
  returnToLobby,
  setReady,
  startRound,
  submitWord,
  updateSettings,
} from "./rooms.ts";
import { bumpCounter, recordEvent } from "./metrics.ts";

export interface NetcodeOptions {
  path?: string;
  maxFrameBytes?: number;
  maxConnsPerIp?: number;
  msgBucketSize?: number;
  msgBucketRate?: number;
  heartbeatMs?: number;
  /**
   * If set, incoming WebSocket upgrades whose `Origin` header doesn't match
   * this exact value are rejected with 403. Leave unset for local dev
   * (tests, curl, file:// origins) where any origin is acceptable.
   * Multiple origins can be supplied comma-separated.
   */
  allowedOrigins?: string[];
  /**
   * When true, `X-Forwarded-For` / `X-Real-IP` headers are trusted to
   * resolve the client IP. When false (default), the socket's remote
   * address is used — the safe choice whenever the container is exposed
   * directly to the internet rather than sitting behind a proxy.
   */
  trustProxy?: boolean;
}

export const DEFAULT_NETCODE_OPTIONS: Required<NetcodeOptions> = {
  path: "/ws",
  maxFrameBytes: 2048,
  maxConnsPerIp: 10,
  msgBucketSize: 20,
  msgBucketRate: 5,
  // 15s is aggressive enough that a hung tab / NAT drop surfaces fast
  // (one missed pong → terminate on the next tick) without flooding
  // the network. Browsers handle ping frames invisibly.
  heartbeatMs: 15_000,
  allowedOrigins: [],
  trustProxy: false,
};

export interface NetcodeHandle {
  wss: WebSocketServer;
  connsByIp: Map<string, number>;
  /** Stop the heartbeat + WSS. Existing clients get terminated. */
  close(): void;
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
      const first = xff.split(",")[0]?.trim();
      if (first) return first;
    }
    const realIp = req.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp.length > 0) return realIp;
  }
  // Default: trust the socket. Safer when the container is ever exposed
  // directly to the internet — an attacker can spoof headers, not a TCP
  // source address.
  return req.socket.remoteAddress ?? "unknown";
}

export function attachNetcode(
  httpServer: {
    on(
      event: "upgrade",
      listener: (
        req: IncomingMessage,
        socket: import("node:net").Socket,
        head: Buffer
      ) => void
    ): unknown;
  },
  opts: NetcodeOptions = {}
): NetcodeHandle {
  const o = { ...DEFAULT_NETCODE_OPTIONS, ...opts };
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: o.maxFrameBytes,
  });
  const connsByIp = new Map<string, number>();

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname !== o.path) {
      socket.destroy();
      return;
    }

    // Origin check. Browsers always send Origin for WebSocket upgrades;
    // non-browser clients (curl, native) may omit it. If allowedOrigins
    // is configured we require a match — an empty/missing Origin is
    // treated as "not allowed" in production mode.
    if (o.allowedOrigins.length > 0) {
      const origin = (req.headers.origin ?? "").toString();
      if (!o.allowedOrigins.includes(origin)) {
        socket.write(
          "HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n",
        );
        socket.destroy();
        recordEvent("ws_origin_rejected", { origin });
        return;
      }
    }

    const ip = clientIp(req, o.trustProxy);
    const current = connsByIp.get(ip) ?? 0;
    if (current >= o.maxConnsPerIp) {
      // Respond with a real HTTP status so well-behaved clients stop
      // retrying and so nginx logs show the rejection.
      socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
      socket.destroy();
      recordEvent("conn_cap_hit", { ip, current });
      return;
    }
    connsByIp.set(ip, current + 1);
    bumpCounter("ws_connect");

    wss.handleUpgrade(req, socket, head, (ws) => {
      // Stash the resolved IP on the socket so the connection handler
      // can decrement the counter without re-parsing headers.
      (ws as WebSocket & { _ip?: string })._ip = ip;
      wss.emit("connection", ws, req);
    });
  });

  interface WsCtx {
    room?: ReturnType<typeof joinRoom>["room"];
    playerId?: string;
  }

  wss.on("connection", (ws: WebSocket) => {
    const ctx: WsCtx = {};
    const ip = (ws as WebSocket & { _ip?: string })._ip ?? "unknown";

    // Without an `error` listener the `ws` library re-throws protocol
    // errors (oversized frame, bad UTF-8, etc.) as uncaught exceptions.
    // Log once so ops can see it, but don't crash the process — the
    // library closes the socket for us on any fatal protocol error.
    ws.on("error", (err: Error) => {
      recordEvent("ws_error", { ip, code: (err as { code?: string }).code });
    });

    // Token bucket per connection. Tokens refill continuously so a
    // client can burst up to msgBucketSize messages, then settle to
    // msgBucketRate per second. A flooding client runs out of tokens
    // and gets disconnected.
    let tokens = o.msgBucketSize;
    let lastRefill = Date.now();
    const allowMessage = (): boolean => {
      const now = Date.now();
      tokens = Math.min(
        o.msgBucketSize,
        tokens + ((now - lastRefill) / 1000) * o.msgBucketRate
      );
      lastRefill = now;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    };

    // Heartbeat: we set `alive = false` before each ping; the pong
    // handler flips it back to true. If the next tick finds it still
    // false, the peer is gone and we reclaim the connection slot.
    let alive = true;
    ws.on("pong", () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* socket closing, let close handler clean up */
      }
    }, o.heartbeatMs);

    const send = (msg: ServerMsg) => ws.send(JSON.stringify(msg));

    ws.on("message", (data) => {
      if (!allowMessage()) {
        send({ t: "error", message: "Rate limit exceeded" });
        ws.close(1008, "rate limit");
        recordEvent("rate_limit_hit", { ip });
        return;
      }

      let msg: ClientMsg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        send({ t: "error", message: "Bad JSON" });
        recordEvent("bad_json", { ip });
        return;
      }

      switch (msg.t) {
        case "join": {
          if (ctx.playerId) return;
          const result = joinRoom(ws, msg.code, msg.name, msg.clientId);
          if (result.playerId === null) {
            // joinRoom already sent an error frame; close politely.
            ws.close(1008, result.reason);
            return;
          }
          ctx.room = result.room;
          ctx.playerId = result.playerId;
          break;
        }
        case "start": {
          if (ctx.room && ctx.playerId) {
            startRound(ctx.room, ctx.playerId, msg.force === true);
          }
          break;
        }
        case "lobby": {
          if (ctx.room && ctx.playerId) returnToLobby(ctx.room, ctx.playerId);
          break;
        }
        case "ready": {
          if (ctx.room && ctx.playerId) {
            setReady(ctx.room, ctx.playerId, !!msg.ready);
          }
          break;
        }
        case "settings": {
          if (ctx.room && ctx.playerId) {
            updateSettings(ctx.room, ctx.playerId, msg.settings);
          }
          break;
        }
        case "word": {
          if (ctx.room && ctx.playerId) {
            const r = submitWord(ctx.room, ctx.playerId, msg.word);
            send({ t: "word_result", word: msg.word, ...r });
          }
          break;
        }
        case "leave": {
          if (ctx.room && ctx.playerId) {
            leaveRoom(ctx.room, ctx.playerId);
            ctx.room = undefined;
            ctx.playerId = undefined;
          }
          break;
        }
      }
    });

    ws.on("close", () => {
      clearInterval(heartbeat);
      bumpCounter("ws_close");
      const n = (connsByIp.get(ip) ?? 1) - 1;
      if (n <= 0) connsByIp.delete(ip);
      else connsByIp.set(ip, n);
      if (ctx.room && ctx.playerId) {
        leaveRoom(ctx.room, ctx.playerId);
      }
    });
  });

  return {
    wss,
    connsByIp,
    close() {
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
