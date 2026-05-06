import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import {
  restoreRooms,
  startRoomSweeper,
  fetchLatestRoundForRoom,
  fetchRoundById,
  getRoomPhase,
} from "./rooms.ts";
import { loadDictionary, lookupDefinition } from "./dictionary.ts";
import { bumpCounter, configureLogging, sweepLogs } from "./metrics.ts";
import { closeStorage, initStorage, pruneOldRounds } from "./storage.ts";
import { adminEnabled, registerAdminRoutes } from "./admin/index.ts";
import { attachNetcode } from "./netcode.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, "../dist");
const PORT = Number(process.env.PORT || 3001);
const ENVIRONMENT = process.env.BAWGLE_ENVIRONMENT || "production";
const IS_DEV = ENVIRONMENT === "development";
const DATA_DIR =
  process.env.BAWGLE_DATA_DIR ||
  process.env.BOGGLE_DATA_DIR /* legacy env var */ ||
  join(__dirname, "..", "data");
// Default DB filename kept as boggle.db so an existing homelab's volume
// (which already has rooms persisted) keeps working after the rename.
const DB_PATH =
  process.env.BAWGLE_DB ||
  process.env.BOGGLE_DB /* legacy env var */ ||
  join(DATA_DIR, "boggle.db");

// Directory for JSONL event logs. One file per UTC day, rotated
// automatically. Set BAWGLE_LOG_DIR="" to disable disk persistence and
// keep events in-memory only.
const LOG_DIR =
  process.env.BAWGLE_LOG_DIR === ""
    ? null
    : process.env.BAWGLE_LOG_DIR || join(DATA_DIR, "logs");
const LOG_RETENTION_DAYS = Number(process.env.BAWGLE_LOG_RETENTION_DAYS || 30);
const ROUND_RETENTION_DAYS = Number(process.env.BAWGLE_ROUND_RETENTION_DAYS || 30);

loadDictionary();
initStorage(DB_PATH);
configureLogging({ dir: LOG_DIR, retentionDays: LOG_RETENTION_DAYS });
restoreRooms();
startRoomSweeper();
// Prune old log files on boot and then daily thereafter. The interval
// is unref()ed so it doesn't keep the process alive during shutdown.
sweepLogs();
setInterval(sweepLogs, 24 * 60 * 60 * 1000).unref();
// Same cadence for round history. Retention is independent from logs
// so operators can tune them separately.
function sweepRounds(): void {
  try {
    const removed = pruneOldRounds(ROUND_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    if (removed > 0) {
      console.log(
        `[bawgle] round sweep: removed ${removed} round(s) older than ${ROUND_RETENTION_DAYS}d`,
      );
    }
  } catch (err) {
    console.error("[bawgle] round sweep failed:", (err as Error).message);
  }
}
sweepRounds();
setInterval(sweepRounds, 24 * 60 * 60 * 1000).unref();

const app = new Hono();

// Security headers on every response. Applied first so even 404s ship
// with them. CSP is scoped to the origins the SPA actually uses
// (self, Google Fonts, Cloudflare Insights). `frame-ancestors 'none'`
// belts-and-suspenders with X-Frame-Options for older browsers.
const SECURITY_HEADERS_CSP =
  "default-src 'self'; " +
  "script-src 'self' https://static.cloudflareinsights.com; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' data:; " +
  "connect-src 'self' https://cloudflareinsights.com wss: ws:; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'";

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header("Content-Security-Policy", SECURITY_HEADERS_CSP);
});

app.get("/api/health", (c) => c.json({ ok: true }));

// Admin metrics + dashboard. Everything lives in ./admin; this is just
// the mount point. Must come before the static-site catch-all so the
// /admin/ HTML route wins over the SPA fallback.
registerAdminRoutes(app);

// Definition lookup for a single word. Returns the Wiktionary gloss(es)
// attached to the word (or to its lemma if it's an inflected form).
app.get("/api/define/:word", (c) => {
  bumpCounter("define_request");
  const raw = c.req.param("word") ?? "";
  const word = raw
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .slice(0, 32);
  if (!word) return c.json({ word: raw, defs: [] });
  const result = lookupDefinition(word);
  if (!result) return c.json({ word, defs: [] });
  return c.json(result);
});

// Shareable round history. Two flavors:
//   /api/round/:id             — a specific round by id. Stable URL;
//                                survives room purge and restarts.
//   /api/room/:code/round      — the most recent round for a room,
//                                useful when the caller only knows the
//                                room code.
//
// Both return the same payload shape so the client can render either
// via one code path.
app.get("/api/round/:id", (c) => {
  const raw = c.req.param("id") ?? "";
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0 || !Number.isInteger(id)) {
    return c.json({ status: "not_found" }, 404);
  }
  const round = fetchRoundById(id);
  if (!round) return c.json({ status: "not_found" }, 404);
  return c.json({ status: "ok", round });
});

app.get("/api/room/:code/round", (c) => {
  const raw = c.req.param("code") ?? "";
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  if (!code) return c.json({ status: "not_found" }, 404);

  const round = fetchLatestRoundForRoom(code);
  if (round) return c.json({ status: "ok", round });

  // No history yet — distinguish "room exists mid-play" from "unknown"
  // so the client can show the right empty state.
  const phase = getRoomPhase(code);
  if (phase === null) return c.json({ status: "not_found" }, 404);
  return c.json({ status: "in_progress", phase }, 200);
});

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

if (existsSync(DIST_DIR)) {
  app.get("*", async (c) => {
    let p = c.req.path.replace(/^\/+/, "");
    if (!p) p = "index.html";
    const filePath = join(DIST_DIR, p);
    if (!filePath.startsWith(DIST_DIR)) return c.notFound();
    try {
      if (existsSync(filePath)) {
        const body = readFileSync(filePath);
        const mime = MIME[extname(filePath)] || "application/octet-stream";
        return new Response(body, { headers: { "content-type": mime } });
      }
      const index = readFileSync(join(DIST_DIR, "index.html"));
      return new Response(index, { headers: { "content-type": "text/html" } });
    } catch {
      return c.notFound();
    }
  });
}

const httpServer = createAdaptorServer({ fetch: app.fetch });

// Wire up the WebSocket upgrade path + abuse controls. All behavior
// lives in ./netcode.ts so it can be exercised in isolation from tests.
const ALLOWED_ORIGINS = (process.env.BAWGLE_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const TRUST_PROXY = process.env.BAWGLE_TRUST_PROXY === "1";

attachNetcode(httpServer, {
  allowedOrigins: ALLOWED_ORIGINS,
  trustProxy: TRUST_PROXY,
});

httpServer.listen(PORT, () => {
  console.log(`[bawgle] listening on :${PORT}`);
  console.log(`[bawgle] environment=${ENVIRONMENT}`);
  if (IS_DEV) {
    console.log("[bawgle] dev mode: window.bawgleDev is available in the browser console");
  }
  if (ALLOWED_ORIGINS.length > 0) {
    console.log(`[bawgle] WebSocket origin allowlist: ${ALLOWED_ORIGINS.join(", ")}`);
  } else {
    console.log(
      "[bawgle] WebSocket origin check DISABLED (set BAWGLE_ALLOWED_ORIGINS to enable)",
    );
  }
  console.log(
    `[bawgle] proxy trust=${TRUST_PROXY ? "on" : "off"} (set BAWGLE_TRUST_PROXY=1 when behind a reverse proxy)`,
  );
  if (!adminEnabled) {
    console.log("[bawgle] admin dashboard DISABLED (set BAWGLE_ADMIN_PASS to enable)");
  } else {
    console.log("[bawgle] admin dashboard at /admin/");
  }
});

// Flush SQLite on shutdown so we don't truncate the WAL mid-write.
function shutdown(signal: string) {
  console.log(`[bawgle] ${signal} received, closing storage`);
  try {
    closeStorage();
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
