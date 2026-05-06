// HTTP Basic auth for the admin surface. Split out so it's easy to
// unit-test and can't accidentally leak state with other modules.
//
// Credentials come from BAWGLE_ADMIN_USER / BAWGLE_ADMIN_PASS. If the
// password is empty the admin surface is disabled entirely (every
// request 401s) — safer than a default credential someone forgets to
// change.

import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

const ADMIN_USER = process.env.BAWGLE_ADMIN_USER || "admin";
const ADMIN_PASS = process.env.BAWGLE_ADMIN_PASS || "";

export const adminEnabled = ADMIN_PASS.length > 0;

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
 * Route-helper: returns a 401 Response if the request isn't authed,
 * or null to signal "keep going". Pattern used by every admin route.
 */
export function requireAdmin(c: Context): Response | null {
  if (!isAuthed(c)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="bawgle admin"' },
    });
  }
  return null;
}
