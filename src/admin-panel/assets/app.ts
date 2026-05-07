// Admin dashboard client. Compiled to app.js by `pnpm build:admin`.
// No framework — plain DOM, polls the admin JSON API every 3s.
//
// Fetch paths are parent-relative (`../api/admin/...`) so the same page
// works whether we're at http://localhost:3001/admin/ in dev or
// https://site.example/bawgle/admin/ behind nginx. From `/admin/` the
// `..` climbs out to the service root (`/` or `/bawgle/`) before
// appending the API path. Asset URLs stay child-relative (`./assets/`)
// because they really do live under /admin/.

import type { RoomSnapshot } from "../../server/rooms.ts";
import type { LogFileInfo, LoggedEvent } from "../../server/metrics.ts";

// ─── Server response shapes ─────────────────────────────────────────
// Mirror the JSON Hono returns. Kept local so the admin bundle doesn't
// drag in server-only modules at runtime (type-only imports above are
// erased by the compiler).

interface MetricsResponse {
  process: {
    bootAt: number;
    uptimeMs: number;
    nodeVersion: string;
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
  rooms: {
    total: number;
    playing: number;
    lobby: number;
    results: number;
    connectedPlayers: number;
    totalPlayers: number;
    liveConns: number;
  };
  counters: Record<string, number>;
}

interface RoomsResponse {
  rooms: RoomSnapshot[];
}

interface EventsResponse {
  events: LoggedEvent[];
}

interface LogFilesResponse {
  files: LogFileInfo[];
}

interface LogFileResponse {
  file: string;
  events: LoggedEvent[];
}

// ─── Formatters ─────────────────────────────────────────────────────

const fmtInt = (n: number | undefined | null): string =>
  Number(n ?? 0).toLocaleString();

const fmtBytes = (b: number): string => (b / 1024 / 1024).toFixed(1) + " MB";

const fmtDuration = (ms: number | null | undefined): string => {
  if (ms == null) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return m + "m " + rs + "s";
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return h + "h " + rm + "m";
};

const fmtTs = (ts: number): string => new Date(ts).toTimeString().slice(0, 8);

const escapeHtml = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (ch) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[ch] ?? ch;
  });

// ─── HTTP helper ────────────────────────────────────────────────────

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "same-origin" });
  if (!r.ok) throw new Error(url + " -> " + r.status);
  return (await r.json()) as T;
}

// ─── DOM helpers ────────────────────────────────────────────────────

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
}

// ─── Live dashboard refresh ─────────────────────────────────────────

async function refresh(): Promise<void> {
  try {
    const [metrics, rooms, events] = await Promise.all([
      getJSON<MetricsResponse>("../api/admin/metrics"),
      getJSON<RoomsResponse>("../api/admin/rooms"),
      getJSON<EventsResponse>("../api/admin/events?limit=200"),
    ]);

    const cards: Array<[string, number | string]> = [
      ["Rooms (playing)", metrics.rooms.playing],
      ["Rooms total", metrics.rooms.total],
      ["Live WS", metrics.rooms.liveConns],
      ["Connected players", metrics.rooms.connectedPlayers],
      ["Joins", metrics.counters.join ?? 0],
      ["Rounds", metrics.counters.round_start ?? 0],
      ["Rate-limit hits", metrics.counters.rate_limit_hit ?? 0],
      ["Conn-cap hits", metrics.counters.conn_cap_hit ?? 0],
      ["Uptime", fmtDuration(metrics.process.uptimeMs)],
      ["RSS", fmtBytes(metrics.process.rss)],
    ];
    byId("cards").innerHTML = cards
      .map(
        ([label, value]) =>
          '<div class="card"><div class="n">' +
          (typeof value === "number" ? fmtInt(value) : value) +
          '</div><div class="l">' +
          label +
          "</div></div>"
      )
      .join("");

    const rs = rooms.rooms;
    byId("room-count").textContent = rs.length ? "(" + rs.length + ")" : "";
    byId("rooms").innerHTML = rs.length
      ? rs
          .map((r) => {
            const remain = r.endsAt ? r.endsAt - Date.now() : null;
            return (
              "<tr>" +
              "<td><code>" +
              r.code +
              "</code></td>" +
              '<td class="phase-' +
              r.phase +
              '">' +
              r.phase +
              "</td>" +
              "<td>" +
              (r.hostName || '<span class="muted">—</span>') +
              "</td>" +
              "<td>" +
              r.connectedCount +
              " / " +
              r.playerCount +
              "</td>" +
              "<td>" +
              r.liveConnections +
              "</td>" +
              "<td>" +
              r.size +
              "x" +
              r.size +
              "</td>" +
              "<td>" +
              (remain != null ? fmtDuration(remain) : '<span class="muted">—</span>') +
              "</td>" +
              '<td><button data-purge="' +
              r.code +
              '">purge</button></td>' +
              "</tr>"
            );
          })
          .join("")
      : '<tr><td colspan="8" class="muted">no rooms</td></tr>';

    byId("events").innerHTML = events.events
      .map(
        (e) =>
          '<div class="ev"><span class="ts">' +
          fmtTs(e.ts) +
          '</span><span class="ty">' +
          e.type +
          "</span><span>" +
          escapeHtml(JSON.stringify(e.data)) +
          "</span></div>"
      )
      .join("");

    byId("heartbeat").textContent = "updated " + new Date().toLocaleTimeString();
  } catch (err) {
    byId("heartbeat").textContent =
      "error: " + (err instanceof Error ? err.message : String(err));
  }
}

// ─── Persisted log viewer ───────────────────────────────────────────
// Separate from the live refresh loop so reading history doesn't get
// replaced every 3s while you're looking at it. Events are held in a
// local cache so the filter input can re-render without another
// network round-trip.

let selectedFile: string | null = null;
let loadedEvents: LoggedEvent[] = [];

async function refreshFileList(): Promise<void> {
  try {
    const { files } = await getJSON<LogFilesResponse>("../api/admin/logs");
    const sel = byId<HTMLSelectElement>("log-file");
    const prev = selectedFile;
    sel.innerHTML = files.length
      ? files
          .map(
            (f) =>
              '<option value="' +
              f.name +
              '">' +
              f.date +
              "  (" +
              (f.bytes / 1024).toFixed(1) +
              " KB)</option>"
          )
          .join("")
      : '<option value="">no files</option>';
    byId("log-file-count").textContent = files.length
      ? "(" + files.length + " file" + (files.length === 1 ? "" : "s") + ")"
      : "";

    // Keep current selection if still present, else select newest.
    if (prev && files.some((f) => f.name === prev)) {
      sel.value = prev;
    } else if (files.length > 0) {
      sel.value = files[0]!.name;
      selectedFile = files[0]!.name;
      void loadLogFile();
    }
  } catch (err) {
    byId("log-status").textContent =
      "list failed: " + (err instanceof Error ? err.message : String(err));
  }
}

async function loadLogFile(): Promise<void> {
  const name = byId<HTMLSelectElement>("log-file").value;
  if (!name) {
    byId("log-events").innerHTML = "";
    return;
  }
  selectedFile = name;
  const status = byId("log-status");
  status.textContent = "loading…";
  try {
    const { events } = await getJSON<LogFileResponse>(
      "../api/admin/logs/" + encodeURIComponent(name) + "?limit=2000"
    );
    loadedEvents = events;
    renderLogEvents();
    status.textContent = events.length + " event" + (events.length === 1 ? "" : "s");
  } catch (err) {
    status.textContent =
      "load failed: " + (err instanceof Error ? err.message : String(err));
  }
}

function renderLogEvents(): void {
  const filter = byId<HTMLInputElement>("log-filter").value.trim().toLowerCase();
  const rows: string[] = [];
  for (const e of loadedEvents) {
    const dataStr = JSON.stringify(e.data);
    if (
      filter &&
      !(e.type.includes(filter) || dataStr.toLowerCase().includes(filter))
    ) {
      continue;
    }
    const stamp = new Date(e.ts).toISOString().replace("T", " ").slice(0, 19);
    rows.push(
      '<div class="ev"><span class="ts">' +
        stamp +
        '</span><span class="ty">' +
        e.type +
        "</span><span>" +
        escapeHtml(dataStr) +
        "</span></div>"
    );
  }
  byId("log-events").innerHTML = rows.length
    ? rows.join("")
    : '<div class="muted">no matching events</div>';
}

// ─── Wire-up ────────────────────────────────────────────────────────

byId("log-file").addEventListener("change", () => void loadLogFile());
byId("log-refresh").addEventListener("click", () => void loadLogFile());
byId("log-filter").addEventListener("input", renderLogEvents);

document.addEventListener("click", async (ev) => {
  const target = ev.target as HTMLElement | null;
  const btn = target?.closest<HTMLButtonElement>("[data-purge]");
  if (!btn) return;
  const code = btn.getAttribute("data-purge");
  if (!code) return;
  if (!confirm("Purge room " + code + "?")) return;
  btn.disabled = true;
  try {
    const r = await fetch("../api/admin/rooms/" + encodeURIComponent(code) + "/purge", {
      method: "POST",
      credentials: "same-origin",
    });
    if (!r.ok) throw new Error(String(r.status));
    void refresh();
  } catch (err) {
    alert("Purge failed: " + (err instanceof Error ? err.message : String(err)));
    btn.disabled = false;
  }
});

void refresh();
setInterval(() => void refresh(), 3000);
void refreshFileList();
// Re-scan the file list every 5 minutes so a new day's file appears
// without a page reload. The viewer itself doesn't auto-refresh.
setInterval(() => void refreshFileList(), 5 * 60 * 1000);
