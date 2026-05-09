## TL;DR

Bawgle is a self-hosted, single-container multiplayer Boggle game.
Real-time gameplay over a single WebSocket. SQLite for persistence
(rooms, players, completed rounds). HTTP Basic-auth admin dashboard
with live metrics and JSONL event logs. Vite-built SPA served by the
same Node process. Multi-arch container image published to GHCR via a
CI pipeline.

Stack: **TypeScript** everywhere. **Hono** HTTP, **ws** WebSocket,
**better-sqlite3** DB, **Vite** for the SPA, **esbuild** for the
admin bundle, **Vitest** for tests.

## High-level architecture

```
        ┌───────────── reverse proxy ─────────────┐
        │  (nginx / Caddy / Cloudflare / Traefik) │
        └─────────────────┬───────────────────────┘
                          │  HTTPS + WebSocket upgrade
                ┌─────────▼─────────┐
                │  Node process     │   Hono + ws
                │(src/server/index) │   port 3001
                └─────────┬─────────┘
        ┌─────────────────┼─────────────────┐
        │                 │                 │
  ┌─────▼─────┐    ┌──────▼──────┐   ┌──────▼───────┐
  │  SPA      │    │  SQLite     │   │  JSONL logs  │
  │  (dist/)  │    │  /data/*.db │   │  /data/logs  │
  └───────────┘    └─────────────┘   └──────────────┘
```

One Node process owns everything: static file serving, REST API
(`/api/*`), WebSocket gameplay (`/ws`), admin dashboard (`/admin`),
and all persistence. Nothing external. That's deliberate — the
product target is "homelab, one container".

## Directory map

Everything lives under `src/`, split by deployment target:

- `src/server/` — Node server. Start here.
  - `index.ts` — boot, Hono app, SPA fallback, shutdown hooks
  - `rooms.ts` — **the heart.** Room lifecycle, round state machine,
    host transfer, ready-up, sweep of idle rooms, persistence hooks,
    snapshots for the admin dashboard
  - `netcode.ts` — WebSocket upgrade handler, origin allowlist, per-IP
    connection cap, token-bucket rate limit, heartbeat, message
    dispatch. Split out for isolated testing
  - `storage.ts` — SQLite schema (`rooms`, `players`, `rounds`, `meta`),
    all reads/writes, restoration on boot
  - `dictionary.ts` — trie + word set, Boggle solver, Wiktionary
    definitions + inflection resolution
  - `metrics.ts` — counters, 500-entry ring buffer, JSONL persistence
    with daily rotation, retention sweep
- `src/admin-panel/` — admin dashboard host + plain-DOM client
  - `index.ts` — Hono routes mounted by the server (`/admin/*`,
    `/api/admin/*`)
  - `auth.ts` — HTTP Basic auth with per-IP fail throttle
  - `build.ts` — esbuild wrapper that compiles `assets/app.ts` →
    `assets/app.js`
  - `assets/` — static HTML, CSS, and the compiled dashboard client
- `src/shared/` — code used by both server and client
  - `types.ts` — `RoomState`, `ClientMsg`, `ServerMsg`, scoring,
    settings limits
  - `board.ts` — dice sets (4×4, 5×5, 6×6), `rollBoard`,
    `wordPathExists`
- `src/client/` — Svelte 5 SPA built with Vite
  - `main.ts` — mounts `App.svelte` into `<body>`
  - `App.svelte` — path-based router (`/`, `/result`, 404)
  - `lib/components/` — leaf components (Board, PlayerList, Timer,
    WordBar, Settings, Results, etc.)
  - `lib/views/` — top-level views: `Room`, `ResultPage`, `NotFound`
  - `lib/stores/` — Svelte stores (`room`, `path`, `theme`, `audio`,
    `feedback`, `adjacency`)
  - `lib/util/` — pure helpers: `net` (WebSocket), `input` (pointer +
    keyboard), `resolver` (board path-finder), `themes`, `share`,
    `audio`, `share-text`, `client-id`, `escape`
  - `lib/styles/` — split CSS partials, imported from `style.css`
- `data/` — runtime state (SQLite DB, WAL, daily logs) + shipped
  dictionary
- `scripts/` — maintenance tools (dictionary rebuild, solver verify,
  WS probes)
- `tests/` — Vitest specs mirroring the tree under test

## Client ↔ server protocol

All gameplay flows through **one** WebSocket at `/ws`. Messages are
newline-delimited JSON, typed by `t`.

### Client → server (`ClientMsg`)

| `t` | Payload | Notes |
| --- | --- | --- |
| `join` | `code`, `name`, `clientId` | First message after connecting. `clientId` is persisted in `localStorage` per-room for reconnect-by-identity |
| `start` | — | Host-only. Triggers the 5-second pre-round countdown |
| `lobby` | — | Host-only. Returns the room to lobby from results |
| `ready` | `ready: boolean` | Non-host. All non-hosts must be ready for `start` to succeed |
| `word` | `word: string` | Submit a candidate word |
| `settings` | `settings: { roundSeconds?, size? }` | Host-only, lobby-only |
| `leave` | — | Explicit leave |

### Server → client (`ServerMsg`)

| `t` | Payload |
| --- | --- |
| `joined` | `you` (player id), `clientId`, full `state` |
| `state` | full `state` — broadcast on every mutation |
| `word_result` | per-submission ack: `ok`, `reason?`, `points?` |
| `error` | displayable string |

### `RoomState` fields

```ts
{
  code: "ABCD",
  phase: "lobby" | "playing" | "results",
  board: string[] | null,         // length = size*size, "Qu" for Q die
  endsAt: number | null,          // epoch ms, round end
  startsAt: number | null,        // epoch ms, pre-round countdown
  players: Player[],
  hostId: string | null,
  settings: { roundSeconds, size: 4 | 5 | 6 },
  possibleCount: number,
  possibleWords: string[],        // populated only in results phase
  lastRoundId: number | null,     // stable /result?round=N id
}
```

## State machine: a round

```
lobby  ──host clicks start──►  lobby+countdown (startsAt != null)
                                      │  5s timeout
                                      ▼
                               playing (endsAt set)
                                      │  roundSeconds timeout
                                      ▼
                               results (possibleWords revealed,
                                        rounds row inserted,
                                        lastRoundId set)
                                      │  host clicks play again
                                      ▼
                               lobby (scores reset, ready flags cleared)
```

Round end persists an immutable row to the `rounds` table. That row
has its own retention (`BAWGLE_ROUND_RETENTION_DAYS`, default 30) and
survives room purge, so `/result?round=N` share links work for weeks
after the room itself is gone.

## Persistence (SQLite)

Four tables:

- `meta` — schema version
- `rooms` — one row per live room, full state mirror (board, phase,
  `ends_at`, host, settings, possibleWords, solved list)
- `players` — one row per player in a room, cascade-deleted with the
  room
- `rounds` — immutable completed-round archive. Deep-copies the
  player list so later play-again transitions don't mutate history

`rooms.persist(room)` is called after every meaningful state mutation
(join, leave, settings change, word submit, phase transition). On
boot, `restoreRooms()` hydrates everything back into memory. Players
come back as `connected: false` until a reconnect by `clientId` flips
them live.

The room sweeper deletes rooms whose `updated_at` is older than 72h
as long as they have no live socket.

## Security surface

- **CSP + security headers** on every response (`src/server/index.ts`).
- **Admin auth** — Basic auth with constant-time compare. Per-IP
  throttle locks out 5 minutes after 10 distinct bad credentials in 3
  minutes. Repeated identical bad creds (stuck client) count as one.
- **WebSocket hardening** — origin allowlist, per-IP connection cap
  (10), message token bucket (20 burst, 5/s sustained), 2 KB max
  frame, 15s heartbeat.
- **`BAWGLE_TRUST_PROXY`** — when set, `X-Forwarded-For` / `X-Real-IP`
  are trusted for client IP resolution. Off by default because header
  spoofing is trivial when the container is exposed directly.

## Dictionary

`data/dictionary/`:

- `words.txt` — one word per line, lowercase, ≥3 chars, `[a-z]+` only
- `denylist.txt` — words to strip; `scripts/apply-denylist.mjs`
  rewrites `words.txt`
- `definitions.json` — `{ word: [{ pos, def }, ...] }`
- `inflections.json` — `{ inflected: lemma }`

Loaded once on boot into a `Set<string>` for membership and a `Trie`
for the solver. `solveBoard(board, size)` returns every valid word
reachable on the board; `wordPathExists` is a shared helper that
lives in `src/shared/board.ts` so both server and client can validate.

The `Qu` die is stored as the two-character cell `"Qu"`. The solver
consumes both characters at once during trie walk; `wordPathExists`
on the client normalizes `Q+U` back to that single cell.

## Client routing

`src/client/main.ts` mounts the Svelte app into `<body>`.
`App.svelte` switches on `location.pathname`:

- `/`, `/index.html`, trailing slash tolerated → the full app
  (lobby → room → results)
- `/result` → shareable round view. Accepts `?round=N` for a
  specific round or `?room=XXXX` for the most recent round in a
  room. Rendered by `src/client/lib/views/ResultPage.svelte`
- anything else → 404 page via `src/client/lib/views/NotFound.svelte`

Each branch dynamically imports its page module so the lobby flow
doesn't pull in the results-page CSS/JS and vice versa.

## Reconnect / identity

- `src/util/client-id.ts` generates a stable `clientId` per room and
  persists it in `localStorage`.
- Server-side, the `join` handler looks up an existing player by
  `clientId`. If the previous socket is closed, it reclaims the
  slot (score, words, host flag preserved). If the previous socket
  is still OPEN (a second tab on the same browser), the new tab
  gets a distinct synthetic `clientId` so both show up as separate
  players.
- The client writes `?room=XXXX` into the URL so refresh auto-joins.
- If the original host disconnects, the crown transfers to the next
  connected player. When the original comes back, the crown returns
  — `originalHostId` is set once and never overwritten.

## Testing

Vitest. `pnpm test` runs everything. Patterns:

- Server tests spin up real Node HTTP + `attachNetcode` on ephemeral
  ports and drive it over real WebSockets. See
  `tests/server/netcode.test.ts`, `multiplayer.test.ts`,
  `countdown.test.ts`.
- Storage tests open SQLite in `os.tmpdir()` and call `initStorage`
  / `closeStorage` per test.
- Client tests run under jsdom for DOM-touching code, plain Node
  otherwise.
- `__beginRoundForTests` and `__resetAdminThrottleForTests` are test
  hooks exported from production modules — use them, don't replicate
  their logic.

## CI/CD

`.github/workflows/publish.yml`:

- `test` job — lint + typecheck + vitest on every push and PR
- `publish` job — multi-arch Docker build + push to
  `ghcr.io/alifbae/bawgle`. Runs only on `main` pushes and `v*`
  tags, gated on `test`. Uses `docker/metadata-action` to emit
  `latest`, semver, and short-SHA tags
- `build-pr` job — multi-arch build without push on PRs, catches
  Dockerfile regressions

## Things that look weird but are intentional

- `boggle.db` filename (not `bawgle.db`) — preserves existing
  deployments that predate the rename
- `BOGGLE_DATA_DIR` / `BOGGLE_DB` env vars still read — same reason
- `__beginRoundForTests` — some tests predate the pre-round
  countdown and assume `startRound` → `playing` is atomic
- Inline security headers in `src/server/index.ts` rather than a
  middleware package — keeps the dependency surface tiny
- `admin_action` event type is reserved but not emitted yet —
  placeholder for future admin writes
- `word_accepted` / `word_rejected` only bump counters, never land
  in the event log. Raw submissions would drown the buffer
- The UTC-date filename on daily logs (`events-YYYY-MM-DD.jsonl`)
  rather than local — so a server that crosses midnight doesn't
  open a second file mid-day
- The client redirect from `/admin` to relative `admin/` (not
  `/admin/`) — preserves a reverse-proxy prefix if any
- Restoration on boot sets every player's `connected: false` and
  `ready: false` — the WebSocket is gone, so those flags are stale

## When you're asked to…

- **Change the protocol:** update `src/shared/types.ts` first (both
  sides import it). Then server dispatch in `netcode.ts` / `rooms.ts`,
  then client `lib/util/net.ts`. Types will force you to update
  both.
- **Add a game rule:** scoring lives in `src/shared/types.ts`
  (`scoreWord`), word validation is a chain inside
  `rooms.submitWord`, path validation is
  `src/shared/board.wordPathExists`.
- **Add a metric:** `bumpCounter(name)` for simple counters,
  `recordEvent(type, data)` for structured events. If the event is
  high-volume, only counter it (see `word_accepted`).
- **Add a setting:** extend `RoomSettings` + `SETTINGS_LIMITS` in
  `src/shared/types.ts`, handle clamping in `rooms.updateSettings`,
  surface it in `src/client/lib/components/Settings.svelte`.
- **Touch persistence:** any schema change needs a forward-compatible
  migration. `storage.ts` demonstrates the pattern with the
  `players.ready` column — check `PRAGMA table_info`, add the column
  if missing, bump `SCHEMA_VERSION`.
- **Add an admin endpoint:** put the route in
  `src/admin-panel/index.ts`, wrap with `requireAdmin(c)` which
  returns `Response` on fail (you `return` it) or `null` to proceed.

## Scripts worth knowing

- `scripts/apply-denylist.mjs` — rebuild `words.txt` from denylist
- `scripts/build-dictionary.ts` — (re)generate the dictionary files
  from source lists; see the script for input format
- `scripts/verify-solver.ts` — sanity-check the Boggle solver
  against a known fixture
- `scripts/probe-hold.mjs` / `probe-persist.mjs` — throwaway WS
  probes used while debugging; kept for next time something breaks

## Documentation neighbours

- [Getting started](./getting-started.md)
- [Development](./development.md)
- [Deployment](./deployment.md)
- [Monitoring](./monitoring.md)
