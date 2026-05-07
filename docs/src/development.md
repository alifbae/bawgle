# Development

Bawgle is a small TypeScript monorepo with three moving parts:

| Slice | Runs as | Entry point | What it does |
| --- | --- | --- | --- |
| Client SPA | Vite (port 5175 in dev) | `src/main.ts` | Boggle UI, lobby, board input, results |
| Server | `tsx watch` (port 3001) | `server/index.ts` | HTTP API, WebSocket gameplay, SQLite persistence |
| Admin bundle | esbuild watcher | `server/admin/assets/app.ts` → `.js` | Admin dashboard front-end |

`pnpm dev` runs all three concurrently with `concurrently`.

## Prerequisites

- Node 20
- pnpm 9 (`corepack enable` if you don't have it yet)
- Optional: Docker, for `pnpm compose:dev`

## First-time setup

```bash
pnpm install
cp .env.example .env      # optional, only if you want admin enabled locally
pnpm dev
```

- App: <http://localhost:5175>
- API / WebSocket: proxied through Vite to <http://localhost:3001>
- Admin dashboard: <http://localhost:5175/admin/> (also proxied)

Vite proxies `/ws`, `/api`, and `/admin` to the Node server so a single
origin works for everything. The port is fixed at `5175` — change it
in `vite.config.js` if needed.

## Environment

All `BAWGLE_*` variables from `.env.example` apply in dev too. The
noteworthy ones:

- `BAWGLE_ENVIRONMENT=development` — set by `pnpm dev`. Unlocks:
  - `window.bawgleDev` helpers in the browser console
  - relaxed 5-second minimum round length (prod floor is 60)
- `BAWGLE_ADMIN_PASS` — if empty the admin surface returns 401 for
  every request, so set something locally if you want to poke at it.
- `BAWGLE_ALLOWED_ORIGINS` — leave unset in dev. The WebSocket origin
  check is disabled when the list is empty.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | All three watchers in parallel |
| `pnpm build` | Admin bundle + Vite production build to `dist/` |
| `pnpm start` | Run the server against a prebuilt `dist/` |
| `pnpm test` | Vitest, single run |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:coverage` | V8 coverage report |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` across the whole tree |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm denylist:apply` | Rebuild `data/dictionary/words.txt` after editing `denylist.txt` |
| `pnpm compose:dev` | Local `docker-compose.dev.yml` build + up |
| `pnpm compose:dev:logs` | Tail the dev compose container |

## Repo layout

```
server/          Node server (Hono + ws + better-sqlite3)
  admin/         Admin dashboard: auth, routes, static assets
  dictionary.ts  Trie-backed word lookup + Boggle solver
  metrics.ts     Counters + event ring buffer + JSONL persistence
  netcode.ts     WebSocket upgrade, origin check, per-IP caps, rate limiter
  rooms.ts       Room lifecycle, rounds, host transfer, ready-up
  storage.ts     SQLite schema, room / round persistence
  index.ts       Boot, route mount, static SPA fallback

shared/          Code used by both server and client
  board.ts       Dice sets, rollBoard, wordPathExists
  types.ts       RoomState, ClientMsg/ServerMsg, scoring

src/             Vite SPA
  main.ts        Route dispatch (/, /result, 404) + app wiring
  net.ts         WebSocket with exponential-backoff reconnect
  game/          Path store, input (pointer/keyboard), resolver
  ui/            Lobby, board, timer, words, results, settings, ...
  styles/        Split CSS by concern
  util/          client-id, escape helpers

data/
  dictionary/    words.txt, denylist.txt, definitions.json, inflections.json
  logs/          Daily JSONL event logs (runtime-generated)
  boggle.db      SQLite DB (runtime-generated)

scripts/         One-off tools (dictionary build, solver verify, probes)
tests/           Vitest specs mirroring src/, server/, shared/
```

## Testing

`pnpm test` runs the whole Vitest suite. The tests cover:

- **Server** — rooms, rounds, storage, netcode, dictionary, admin
  auth, metrics, countdown, multi-player flows.
- **Shared** — board rolling, path validation, type invariants.
- **Client** — game path store, input resolver, share-text, client-id
  utilities, DOM escapes.

A few patterns worth knowing:

- `server/rooms.ts` exports `__beginRoundForTests` to skip the
  pre-round countdown from tests that predate it.
- `server/admin/auth.ts` exports `__resetAdminThrottleForTests` so
  the per-IP fail counter can be reset between cases.
- Storage tests open SQLite in a tmp dir and call `initStorage` /
  `closeStorage` around each test.
- `tests/server/netcode.test.ts` spins up the server on ephemeral
  ports so rate-limit + heartbeat behaviour can be exercised over
  real WebSockets.

## Client dev helpers (`window.bawgleDev`)

When `BAWGLE_ENVIRONMENT=development`, `src/dev-helpers.ts` is
imported at runtime and installs helpers on `window.bawgleDev` for
prodding the UI from the browser console — useful for iterating on
layouts without waiting for a real round to end. The import is
guarded by a compile-time constant (`__BAWGLE_ENVIRONMENT__`) so the
whole module is tree-shaken from production bundles.

## Editing the dictionary

1. Add strings you want to strip to `data/dictionary/denylist.txt`.
2. Run `pnpm denylist:apply`. The script rewrites `words.txt` and
   preserves definitions/inflections that still have a valid base.
3. Restart the server (it loads the dictionary once at boot).

## Admin bundle

`server/admin/build.ts` is a small esbuild wrapper that compiles
`server/admin/assets/app.ts` → `app.js`. In dev it runs with
`--watch`; in CI it's invoked by `pnpm build:admin` before the Vite
build so the published image ships a fresh bundle.
