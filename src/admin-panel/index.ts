// Admin HTTP surface. All routes are behind HTTP Basic auth; see
// ./auth.ts. The static assets (HTML, CSS, JS) live in ./assets/ and
// are served from disk so they can be edited without touching server
// code. The Dockerfile copies src/admin-panel so nested assets ship
// automatically.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";
import type { Hono } from "hono";

import { purgeRoom, roomsSnapshot, roomsSummary } from "../server/rooms.ts";
import {
  listLogFiles,
  processStats,
  readLogFile,
  recentEvents,
  snapshotCounters,
} from "../server/metrics.ts";

import { adminEnabled, requireAdmin } from "./auth.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, "assets");

const ASSET_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveAsset(name: string): Response {
  // Resolve relative to ASSETS_DIR and refuse anything that escapes it
  // (defence-in-depth; Hono params shouldn't contain `..` but asset
  // names come from URLs so better safe than sorry).
  const safe = normalize(name).replace(/^([/\\])+/, "");
  const full = join(ASSETS_DIR, safe);
  if (!full.startsWith(ASSETS_DIR) || !existsSync(full)) {
    return new Response("Not found", { status: 404 });
  }
  const body = readFileSync(full);
  const mime = ASSET_MIME[extname(full)] || "application/octet-stream";
  return new Response(body, { headers: { "content-type": mime } });
}

/**
 * Register every admin route on the provided Hono app. Call once at
 * boot, after the health route but before the static-site catch-all.
 */
export function registerAdminRoutes(app: Hono): void {
  // ── JSON API ────────────────────────────────────────────────────
  app.get("/api/admin/metrics", (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    return c.json({
      process: processStats(),
      rooms: roomsSummary(),
      counters: snapshotCounters(),
    });
  });

  app.get("/api/admin/rooms", (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    return c.json({ rooms: roomsSnapshot() });
  });

  app.get("/api/admin/events", (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const limitRaw = Number(c.req.query("limit") ?? "200");
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(500, Math.floor(limitRaw))
        : 200;
    return c.json({ events: recentEvents(limit) });
  });

  // List available on-disk log files (daily JSONL, newest first).
  app.get("/api/admin/logs", (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    return c.json({ files: listLogFiles() });
  });

  // Read the last N events from a specific log file. The filename
  // format is validated inside readLogFile() so path traversal is
  // impossible even if the param is adversarial.
  app.get("/api/admin/logs/:name", (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const name = c.req.param("name");
    const limitRaw = Number(c.req.query("limit") ?? "500");
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(5000, Math.floor(limitRaw))
        : 500;
    return c.json({ file: name, events: readLogFile(name, limit) });
  });

  app.post("/api/admin/rooms/:code/purge", (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const code = c.req.param("code").toUpperCase();
    purgeRoom(code);
    return c.json({ ok: true, code });
  });

  // ── Dashboard HTML + assets ─────────────────────────────────────
  // Canonical URL is /admin/ (trailing slash) so that the `./assets/`
  // references in index.html resolve against /admin/ instead of /.
  // /admin without the slash redirects so both forms work.
  app.get("/admin", (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    // Relative redirect so the browser preserves whatever prefix a
    // reverse proxy mounted us at (e.g. /bawgle/admin → /bawgle/admin/).
    return c.redirect("admin/");
  });

  app.get("/admin/", (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    return serveAsset("index.html");
  });

  app.get("/admin/assets/:file", (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    return serveAsset(c.req.param("file"));
  });
}

/** Re-export for the boot log line. */
export { adminEnabled };
