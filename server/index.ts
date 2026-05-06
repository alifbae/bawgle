import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import {
  restoreRooms,
  startRoomSweeper,
} from "./rooms.ts";
import { loadDictionary, lookupDefinition } from "./dictionary.ts";
import {
  bumpCounter,
  configureLogging,
  sweepLogs,
} from "./metrics.ts";
import { closeStorage, initStorage } from "./storage.ts";
import { adminEnabled, registerAdminRoutes } from "./admin/index.ts";
import { attachNetcode } from "./netcode.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, "../dist");
const PORT = Number(process.env.PORT || 3001);
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

loadDictionary();
initStorage(DB_PATH);
configureLogging({ dir: LOG_DIR, retentionDays: LOG_RETENTION_DAYS });
restoreRooms();
startRoomSweeper();
// Prune old log files on boot and then daily thereafter. The interval
// is unref()ed so it doesn't keep the process alive during shutdown.
sweepLogs();
setInterval(sweepLogs, 24 * 60 * 60 * 1000).unref();

const app = new Hono();

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
attachNetcode(httpServer);

httpServer.listen(PORT, () => {
  console.log(`[bawgle] listening on :${PORT}`);
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

