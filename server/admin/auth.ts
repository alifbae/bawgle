// HTTP Basic auth for the admin surface. Split out so it's easy to
// unit-test and can't accidentally leak state with other modules.
//
// Credentials come from BAWGLE_ADMIN_USER / BAWGLE_ADMIN_PASS. If the
// password is empty the admin surface is disabled entirely (every
// request 401s) — safer than a default credential someone forgets to
// change.
//
// Per-IP failed-login throttle: after too many bad attempts from one
// IP we 429 instead of 401 for a cooldown window. Stops online
// password guessing without needing a reverse-proxy rate-limit rule.

import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

const ADMIN_USER = process.env.BAWGLE_ADMIN_USER || "admin";
const ADMIN_PASS = process.env.BAWGLE_ADMIN_PASS || "";

export const adminEnabled = ADMIN_PASS.length > 0;

// Throttle: after MAX_FAILS failures in the window, that IP is locked
// out for COOLDOWN_MS. Sliding-window is overkill for this; we just
// reset the counter when the oldest hit ages out.
const MAX_FAILS = 5;
const WINDOW_MS = 60_000;
const COOLDOWN_MS = 5 * 60_000;

interface FailState {
  hits: number[]; // timestamps of recent failures
  lockedUntil: number;
}
const failsByIp = new Map<string, FailState>();

function pruneOldHits(state: FailState, now: number): void {
  const cutoff = now - WINDOW_MS;
  while (state.hits.length && state.hits[0]! < cutoff) state.hits.shift();
}

/**
 * Best-effort client IP from the request. Admin traffic is expected to
 * ride in behind a reverse proxy so XFF is preferred. If the deployment
 * is direct, the socket remote address falls through via Hono's
 * internals.
 */
function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = c.req.header("x-real-ip");
  if (real) return real;
  // Hono's Node adapter exposes the socket via c.env, but normalizing
  // across runtimes isn't worth the code — fall back to a constant
  // bucket so the throttle still applies to direct-to-node traffic.
  return "unknown";
}

function isLocked(ip: string): number {
  const s = failsByIp.get(ip);
  if (!s) return 0;
  const now = Date.now();
  if (s.lockedUntil > now) return s.lockedUntil - now;
  return 0;
}

function recordFail(ip: string): void {
  const now = Date.now();
  let s = failsByIp.get(ip);
  if (!s) {
    s = { hits: [], lockedUntil: 0 };
    failsByIp.set(ip, s);
  }
  pruneOldHits(s, now);
  s.hits.push(now);
  if (s.hits.length >= MAX_FAILS) {
    s.lockedUntil = now + COOLDOWN_MS;
    s.hits.length = 0; // reset; cooldown is the gate now
  }
}

function recordSuccess(ip: string): void {
  failsByIp.delete(ip);
}

/**
 * Constant-time string compare. Node's timingSafeEqual demands equal
 * lengths, so we bail fast if they differ (which already leaks the
 * length but is unavoidable and benign for admin creds).
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Parse + validate a request's Basic auth header against the admin creds. */
export function isAuthed(c: Context): boolean {
  if (!adminEnabled) return false;
  const header = c.req.header("authorization") || "";
  if (!header.toLowerCase().startsWith("basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return constantTimeEqual(user, ADMIN_USER) && constantTimeEqual(pass, ADMIN_PASS);
}

/**
 * Route-helper: returns a 401 Response if the request isn't authed, a
 * 429 if the IP is locked out, or null to signal "keep going". Pattern
 * used by every admin route.
 */
export function requireAdmin(c: Context): Response | null {
  const ip = clientIp(c);
  const lockMs = isLocked(ip);
  if (lockMs > 0) {
    return new Response("Too Many Requests", {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil(lockMs / 1000)),
        "WWW-Authenticate": 'Basic realm="bawgle admin"',
      },
    });
  }
  if (!isAuthed(c)) {
    recordFail(ip);
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="bawgle admin"' },
    });
  }
  recordSuccess(ip);
  return null;
}

/** Test hook: drop the in-memory throttle state. */
export function __resetAdminThrottleForTests(): void {
  failsByIp.clear();
}
