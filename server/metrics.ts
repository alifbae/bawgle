// In-process metrics + event log with optional JSONL persistence.
//
// Two shapes of data live here:
//   1. Counters: monotonically increasing integers for "how many times
//      has X happened since boot". Cheap to update and read.
//   2. Event log: ring buffer of the most recent N structured events,
//      for "what just happened on the server" visibility. Also mirrored
//      to a daily JSONL file on disk when a log dir is configured, so
//      history survives restarts and can be tailed / grepped directly.
//
// Why JSONL files instead of SQLite:
//   - Append-only writes, no table locks to worry about
//   - `tail -f`, `grep`, `jq` all work out of the box
//   - Daily rotation makes retention a trivial `unlink` on old files
//   - Ship to Loki/Vector later by pointing it at the same files, no
//     code change
//
// Counters are intentionally not persisted — they're an at-a-glance
// rollup that resets on boot. Persisted events let you reconstruct any
// counter over any time range after the fact.

import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const EVENT_BUFFER_SIZE = 500;

export type EventType =
  // Room lifecycle
  | "join"
  | "leave"
  | "round_start"
  | "round_end"
  | "room_purged"
  // Abuse / safety
  | "rate_limit_hit"
  | "conn_cap_hit"
  | "server_full"
  | "room_full"
  | "bad_json"
  | "ws_error"
  // Word play — only aggregate counters, not individual events, to
  // keep the ring buffer useful (otherwise a single game drowns it).
  // kept here so counter bumps below are typed.
  | "word_accepted"
  | "word_rejected";

export interface LoggedEvent {
  ts: number; // epoch ms
  type: EventType;
  data: Record<string, unknown>;
}

const counters = new Map<string, number>();
// Ring buffer: we write to `head` and wrap. `size` is how many slots are
// populated (up to EVENT_BUFFER_SIZE). This avoids Array.shift() which
// is O(n) and would get expensive under steady event load.
const events: (LoggedEvent | undefined)[] = new Array(EVENT_BUFFER_SIZE);
let head = 0;
let size = 0;

const bootAt = Date.now();

let logDir: string | null = null;
let retentionDays = 30;
// Warn once per failure mode rather than spamming stderr on every event
// when, say, the log volume is full.
let warnedOnWrite = false;

/**
 * Configure on-disk event persistence. Call once at startup. Subsequent
 * calls overwrite the config (useful in tests). Setting `dir` to null
 * disables persistence — events only go to the ring buffer and stdout.
 */
export function configureLogging(opts: { dir: string | null; retentionDays?: number }): void {
  logDir = opts.dir;
  retentionDays = opts.retentionDays ?? retentionDays;
  warnedOnWrite = false;
  if (logDir) {
    try {
      mkdirSync(logDir, { recursive: true });
      console.log(`[bawgle] event log directory: ${logDir} (retain ${retentionDays}d)`);
    } catch (err) {
      console.warn(`[bawgle] cannot create log dir ${logDir}:`, (err as Error).message);
      logDir = null;
    }
  }
}

function fileForTs(ts: number): string {
  // YYYY-MM-DD in UTC so a server that crosses midnight doesn't open
  // a second file mid-day because of local-time tz weirdness.
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `events-${y}-${m}-${day}.jsonl`;
}

export function bumpCounter(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

/**
 * Record a structured event. Counter-bumps the matching name and, for
 * anything other than high-volume word events, appends to the ring
 * buffer + today's JSONL log file. Also mirrors to stdout so
 * `docker logs` shows the same story.
 */
export function recordEvent(type: EventType, data: Record<string, unknown> = {}): void {
  bumpCounter(type);

  // Word submissions can fire hundreds per round per player. Counter is
  // enough — don't flood the ring buffer, stdout, or disk with them.
  const highVolume = type === "word_accepted" || type === "word_rejected";
  if (highVolume) return;

  const evt: LoggedEvent = { ts: Date.now(), type, data };
  events[head] = evt;
  head = (head + 1) % EVENT_BUFFER_SIZE;
  if (size < EVENT_BUFFER_SIZE) size += 1;

  // Structured stdout line — easy to grep, easy to pipe into any
  // log aggregator later without changing call sites.
  const line = JSON.stringify(evt);
  console.log(`[bawgle] event`, line);

  if (logDir) {
    // Synchronous append so the write happens before we return. For the
    // event rates this app sees (< 100/s peak) this is fine; the cost
    // is a kernel call per event. If we ever need more throughput we
    // can batch into a WriteStream.
    try {
      appendFileSync(join(logDir, fileForTs(evt.ts)), line + "\n");
    } catch (err) {
      if (!warnedOnWrite) {
        console.warn(`[bawgle] event log write failed:`, (err as Error).message);
        warnedOnWrite = true;
      }
    }
  }
}

/** Get the most recent events, newest first, up to `limit`. */
export function recentEvents(limit = EVENT_BUFFER_SIZE): LoggedEvent[] {
  const n = Math.min(limit, size);
  const out: LoggedEvent[] = [];
  // Walk backwards from head to read newest-first.
  for (let i = 1; i <= n; i++) {
    const idx = (head - i + EVENT_BUFFER_SIZE) % EVENT_BUFFER_SIZE;
    const evt = events[idx];
    if (evt) out.push(evt);
  }
  return out;
}

export function snapshotCounters(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of counters) out[k] = v;
  return out;
}

export function processStats() {
  const mem = process.memoryUsage();
  return {
    bootAt,
    uptimeMs: Date.now() - bootAt,
    nodeVersion: process.version,
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
  };
}

// ─── Persisted log access (used by admin endpoints) ──────────────────

const LOG_FILE_PATTERN = /^events-(\d{4})-(\d{2})-(\d{2})\.jsonl$/;

export interface LogFileInfo {
  name: string;
  date: string; // YYYY-MM-DD
  bytes: number;
}

/** List log files on disk, newest first. */
export function listLogFiles(): LogFileInfo[] {
  if (!logDir) return [];
  let entries: string[];
  try {
    entries = readdirSync(logDir);
  } catch {
    return [];
  }
  const out: LogFileInfo[] = [];
  for (const name of entries) {
    const m = LOG_FILE_PATTERN.exec(name);
    if (!m) continue;
    try {
      const st = statSync(join(logDir, name));
      out.push({ name, date: `${m[1]}-${m[2]}-${m[3]}`, bytes: st.size });
    } catch {
      /* vanished between readdir and stat, skip */
    }
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

/**
 * Read the last `limit` events from a named log file. Parses JSONL and
 * silently skips any malformed lines (truncated writes, manual edits).
 * Returns newest-first to match the dashboard's live event view.
 *
 * The whole file is read into memory — for the expected volume (a busy
 * day is maybe a few MB) this is simpler than a reverse streaming read.
 */
export function readLogFile(name: string, limit = 500): LoggedEvent[] {
  if (!logDir) return [];
  if (!LOG_FILE_PATTERN.test(name)) return []; // reject traversal attempts
  let raw: string;
  try {
    raw = readFileSync(join(logDir, name), "utf8");
  } catch {
    return [];
  }
  const lines = raw.split("\n");
  const start = Math.max(0, lines.length - limit - 1);
  const out: LoggedEvent[] = [];
  for (let i = lines.length - 1; i >= start; i--) {
    const line = lines[i];
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as LoggedEvent);
    } catch {
      /* skip malformed */
    }
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Delete log files older than `retentionDays`. Safe to call repeatedly;
 * no-ops if logging is disabled. Returns number of files removed for
 * logging/testing.
 */
export function sweepLogs(now: number = Date.now()): number {
  if (!logDir) return 0;
  const cutoffMs = now - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const info of listLogFiles()) {
    // Parse the date back to a timestamp at end-of-day UTC so we don't
    // delete today's file at 00:01 UTC just because its date-only
    // timestamp is "older" than the cutoff.
    const [y, m, d] = info.date.split("-").map(Number);
    const endOfDay = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
    if (endOfDay < cutoffMs) {
      try {
        unlinkSync(join(logDir, info.name));
        removed += 1;
      } catch (err) {
        console.warn(`[bawgle] log sweep: unlink ${info.name} failed:`, (err as Error).message);
      }
    }
  }
  if (removed > 0) {
    console.log(`[bawgle] log sweep: removed ${removed} file(s) older than ${retentionDays}d`);
  }
  return removed;
}
