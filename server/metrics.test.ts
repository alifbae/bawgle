import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Metrics is a module-global singleton so every test resets it by
// re-importing after vi.resetModules() and reconfiguring.

async function freshMetrics() {
  vi.resetModules();
  return import("./metrics.ts");
}

describe("metrics — counters and ring buffer", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "bawgle-metrics-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("records events and increments counters", async () => {
    const m = await freshMetrics();
    m.configureLogging({ dir: null });
    m.recordEvent("join", { code: "AAAA" });
    m.recordEvent("join", { code: "BBBB" });
    m.recordEvent("round_start", { code: "AAAA" });

    const counters = m.snapshotCounters();
    expect(counters.join).toBe(2);
    expect(counters.round_start).toBe(1);

    const events = m.recentEvents();
    expect(events.map((e) => e.type)).toEqual(["round_start", "join", "join"]);
  });

  it("word events bump counters but stay out of the ring buffer", async () => {
    const m = await freshMetrics();
    m.configureLogging({ dir: null });
    m.recordEvent("word_accepted");
    m.recordEvent("word_rejected");
    m.recordEvent("join", { code: "AAAA" });

    expect(m.snapshotCounters()).toMatchObject({
      word_accepted: 1,
      word_rejected: 1,
      join: 1,
    });
    // Only the join made it to the event log.
    expect(m.recentEvents().map((e) => e.type)).toEqual(["join"]);
  });

  it("ring buffer keeps at most EVENT_BUFFER_SIZE entries", async () => {
    const m = await freshMetrics();
    m.configureLogging({ dir: null });
    for (let i = 0; i < 600; i++) m.recordEvent("join", { i });

    const events = m.recentEvents(1000);
    expect(events.length).toBe(500);
    // Newest first: the most recent `i` is 599.
    expect((events[0].data as { i: number }).i).toBe(599);
    expect((events[events.length - 1].data as { i: number }).i).toBe(100);
  });

  it("processStats returns process-level numbers", async () => {
    const m = await freshMetrics();
    const stats = m.processStats();
    expect(stats.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(stats.rss).toBeGreaterThan(0);
    expect(stats.nodeVersion.startsWith("v")).toBe(true);
  });
});

describe("metrics — JSONL persistence", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "bawgle-metrics-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("appends one JSONL line per event to the daily file", async () => {
    const m = await freshMetrics();
    m.configureLogging({ dir: tmp });
    m.recordEvent("join", { code: "AAAA" });
    m.recordEvent("leave", { code: "AAAA" });

    const files = readdirSync(tmp).filter((f) => f.endsWith(".jsonl"));
    expect(files).toHaveLength(1);
    const lines = readFileSync(join(tmp, files[0]), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ type: "join" });
    expect(JSON.parse(lines[1])).toMatchObject({ type: "leave" });
  });

  it("listLogFiles returns recognised files newest-first", async () => {
    const m = await freshMetrics();
    // Drop three pretend log files directly; use varying sizes.
    writeFileSync(join(tmp, "events-2026-01-01.jsonl"), "");
    writeFileSync(join(tmp, "events-2026-05-05.jsonl"), "abc");
    writeFileSync(join(tmp, "events-2026-03-03.jsonl"), "hi");
    writeFileSync(join(tmp, "not-a-log.txt"), "ignore");
    m.configureLogging({ dir: tmp });

    const files = m.listLogFiles();
    expect(files.map((f) => f.date)).toEqual([
      "2026-05-05",
      "2026-03-03",
      "2026-01-01",
    ]);
    expect(files.find((f) => f.date === "2026-05-05")!.bytes).toBe(3);
  });

  it("readLogFile returns events newest-first and skips malformed lines", async () => {
    const m = await freshMetrics();
    const path = join(tmp, "events-2026-05-05.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify({ ts: 1, type: "join", data: { n: 1 } }),
        "{not valid json",
        JSON.stringify({ ts: 2, type: "leave", data: { n: 2 } }),
        "",
      ].join("\n") + "\n"
    );
    m.configureLogging({ dir: tmp });

    const events = m.readLogFile("events-2026-05-05.jsonl");
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("leave");
    expect(events[1].type).toBe("join");
  });

  it("readLogFile refuses filenames that don't match the daily pattern", async () => {
    const m = await freshMetrics();
    writeFileSync(join(tmp, "events-2026-05-05.jsonl"), "");
    writeFileSync(join(tmp, "secret"), "nope");
    m.configureLogging({ dir: tmp });

    expect(m.readLogFile("../secret")).toEqual([]);
    expect(m.readLogFile("..%2fsecret")).toEqual([]);
    expect(m.readLogFile("secret")).toEqual([]);
  });

  it("sweepLogs deletes files older than retentionDays", async () => {
    const m = await freshMetrics();
    // Build two "log files" one dated 10 days ago, one today.
    const now = Date.now();
    const tenDaysAgo = new Date(now - 10 * 24 * 3600 * 1000);
    const today = new Date(now);
    const fmt = (d: Date) =>
      `events-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
        d.getUTCDate()
      ).padStart(2, "0")}.jsonl`;

    const oldFile = fmt(tenDaysAgo);
    const newFile = fmt(today);
    writeFileSync(join(tmp, oldFile), "");
    writeFileSync(join(tmp, newFile), "");

    m.configureLogging({ dir: tmp, retentionDays: 7 });
    const removed = m.sweepLogs(now);
    expect(removed).toBe(1);

    const left = readdirSync(tmp);
    expect(left).toContain(newFile);
    expect(left).not.toContain(oldFile);
  });
});
