# Monitoring

Bawgle exposes a built-in admin dashboard plus a structured event log
you can grep or ship to an aggregator. No Prometheus exporter, no
Grafana required — just `/admin` and `tail -F`.

## Admin dashboard

Visit `/admin/` (trailing slash) with the Basic-auth credentials from
`.env`. When `BAWGLE_ADMIN_PASS` is unset the admin surface is
disabled entirely and every request returns 401.

The dashboard surfaces:

- Process stats: uptime, RSS / heap, Node version
- Room rollups: total, playing / lobby / results, connected vs total
  players, live socket count
- Per-room snapshot: code, phase, size, round length, player counts,
  host name, round end time, possible-word count
- Counters: every counter that's been bumped since boot
  (`join`, `word_accepted`, `rate_limit_hit`, `conn_cap_hit`, etc.)
- Recent events: the in-memory 500-entry ring buffer, newest first
- Persisted daily logs: browse and tail `events-YYYY-MM-DD.jsonl`
  files stored on disk

A **Purge** button on each room row hard-deletes it from memory and
SQLite. Use it sparingly.

## JSON API

Same data as the dashboard, for scripting. All endpoints require
Basic auth.

| Endpoint | Returns |
| --- | --- |
| `GET /api/admin/metrics` | `{ process, rooms, counters }` |
| `GET /api/admin/rooms` | `{ rooms: RoomSnapshot[] }` |
| `GET /api/admin/events?limit=200` | `{ events: LoggedEvent[] }` (in-memory, newest first) |
| `GET /api/admin/logs` | `{ files: { name, date, bytes }[] }` |
| `GET /api/admin/logs/:name?limit=500` | `{ file, events }` from a specific daily log |
| `POST /api/admin/rooms/:code/purge` | Hard-delete a room |
| `GET /api/health` | `{ ok: true }` (unauthenticated; used by `HEALTHCHECK`) |

## Event stream

Events are both:

- Written to a 500-entry in-memory ring buffer (newest wins)
- Appended as JSONL to `data/logs/events-YYYY-MM-DD.jsonl` (UTC date
  in the filename so day boundaries don't split across files)
- Mirrored to stdout so `docker logs bawgle` shows the same story

A single event line looks like:

```json
{"ts":1746633012837,"type":"round_start","data":{"code":"WXYZ","size":4,"roundSeconds":180,"players":3,"possibleWords":142}}
```

### Event types

| Type | Emitted when | Useful fields |
| --- | --- | --- |
| `join` | Player joins or reconnects | `code`, `name`, `playerId`, `reconnect`, `playerCount` |
| `leave` | Socket closes or `leave` message received | `code`, `playerId`, `name`, `remaining` |
| `round_countdown` | Host starts a round (5s pre-roll) | `code`, `durationMs` |
| `round_start` | Countdown elapses, board rolled | `code`, `size`, `roundSeconds`, `players`, `possibleWords` |
| `round_end` | Timer expires | `code`, `roundId`, `topScore`, `foundCount`, `possibleCount` |
| `room_purged` | Idle-TTL sweeper or manual purge | `code`, `reason: "ttl" \| "manual"` |
| `server_full` | `MAX_ROOMS` hit on create | `code`, `name` |
| `room_full` | `MAX_PLAYERS_PER_ROOM` hit on join | `code`, `name` |
| `conn_cap_hit` | Per-IP socket cap hit on upgrade | `ip`, `current` |
| `rate_limit_hit` | Token bucket emptied | `ip` |
| `bad_json` | WS frame didn't parse | `ip` |
| `ws_origin_rejected` | Upgrade blocked by `BAWGLE_ALLOWED_ORIGINS` | `origin` |
| `ws_error` | Protocol error from `ws` | `ip`, `code` |
| `admin_action` | Reserved for future admin writes | varies |

High-volume events (`word_accepted`, `word_rejected`) only bump their
counters — they don't land in the ring buffer, JSONL file, or stdout.
The counter under `/api/admin/metrics` is the source of truth.

### Grepping logs

```bash
# Live tail
docker exec -it bawgle tail -F /data/logs/events-$(date -u +%F).jsonl

# All rate-limit hits today
jq -c 'select(.type=="rate_limit_hit")' /data/logs/events-*.jsonl

# Per-IP connection cap breaches
jq -r 'select(.type=="conn_cap_hit") | .data.ip' /data/logs/events-*.jsonl | sort | uniq -c

# Top rooms by join count this week
jq -r 'select(.type=="join") | .data.code' /data/logs/events-*.jsonl | sort | uniq -c | sort -rn | head
```

Ship to Loki, Vector, or Filebeat by pointing it at
`/data/logs/events-*.jsonl`. The format is stable.

## Counters

Counters are monotonically increasing since boot. They reset on
restart — persisted events (above) let you reconstruct any counter
over any time range after the fact.

Common counters:

- `ws_connect`, `ws_close` — socket lifecycle
- `join`, `leave`, `round_start`, `round_end`, `round_countdown`
- `word_accepted`, `word_rejected` — high-volume word submissions
- `define_request` — `/api/define/:word` hits
- `rate_limit_hit`, `conn_cap_hit`, `server_full`, `room_full`
- `bad_json`, `ws_error`, `ws_origin_rejected`

## Troubleshooting

### Admin returns 401 for correct credentials

- Verify `BAWGLE_ADMIN_PASS` is non-empty in the container's env:
  `docker exec bawgle printenv BAWGLE_ADMIN_PASS`. Empty disables
  the surface by design.
- Your IP may be locked out: 10 distinct bad guesses in 3 minutes →
  429 for 5 minutes. Wait it out. Replayed identical bad creds count
  as one attempt, so a stuck client with cached creds only registers
  one lockout hit per password.

### WebSocket upgrades return 403

- `BAWGLE_ALLOWED_ORIGINS` doesn't include the browser's origin.
  Check `ws_origin_rejected` events for the offender.
- The check compares strings exactly — include the scheme (https://)
  and no trailing slash.

### Players see "Connection lost — reconnecting"

- Reverse proxy read timeout too short. nginx default is 60s; set
  `proxy_read_timeout 3600s;` on the location block.
- Container was restarted. The client reconnects with exponential
  backoff up to 15s. Rooms restore from SQLite and the in-flight
  round timer resumes.

### A room went missing

- Idle longer than 72h? The sweeper purged it. `room_purged` events
  with `reason: "ttl"` in the log confirm.
- Someone with admin access may have manually purged it (`reason:
  "manual"`).
- Shareable `/result?round=N` links still work even after the room is
  gone — round history has its own retention (default 30 days) and
  is pruned independently.

### Server won't start: "database is locked"

SQLite WAL mode normally prevents this, but if the previous process
died hard the WAL may be truncated. Stop the container, back up
`/data/boggle.db`, then start again — on boot the WAL replay should
converge. If it doesn't, restore from the most recent backup.

## Health check

`docker-compose.yml` wires up a `HEALTHCHECK` hitting `/api/health`
every 30s with a 3s timeout. `docker ps` shows healthy/unhealthy
state so external orchestrators (Kubernetes, swarm, Traefik) can
route around a broken container.
