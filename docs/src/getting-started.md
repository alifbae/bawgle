# Getting started

Bawgle is a self-hosted multiplayer Boggle. One container, one port, no
extra pieces. This page gets you from zero to a running room.

## What you need

- Docker (and `docker compose`) on the host, or
- Node 20 + pnpm 9 if you want to run from source.

## 60-second start (Docker)

```bash
mkdir bawgle && cd bawgle
curl -fsSL https://raw.githubusercontent.com/alifbae/bawgle/main/docker-compose.yml -o docker-compose.yml

cat > .env <<'EOF'
BAWGLE_ADMIN_USER=admin
BAWGLE_ADMIN_PASS=change-me-to-something-long
EOF

docker compose pull && docker compose up -d
```

The container listens on `3001`. Point your reverse proxy at
`bawgle:3001` on the shared Docker network, or uncomment the `ports:`
block in `docker-compose.yml` to publish it on a host port.

Generate a strong admin password:

```bash
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
```

## Playing a round

1. Open the app in a browser (`http://localhost:3001` if you exposed
   the port, otherwise whatever hostname your reverse proxy serves).
2. Pick a 4-letter name and either type a room code or leave it blank
   for a random one. Share the resulting URL (`?room=ABCD`) with
   friends — clicking it drops them straight into the lobby.
3. Non-host players hit **i'm ready**. When everyone is ready, the
   host hits **start round**.
4. Drag or click-to-chain letters to form words. Submit with Enter,
   double-click, or the ✓ button. Undo trims the tail of the current
   path.
5. After the round, the results screen shows scoreboards, unique
   finds, and every possible word on the board. The host can **play
   again** (there is a brief lockout so nobody drags everyone back to
   the lobby before the scores are read). Anyone can copy a permanent
   `/result?round=N` link to share the scoreboard later.

## Room codes and URLs

- Room codes are 4 characters, letters and digits only, upper-cased.
- The client writes the code back into the URL (`?room=XXXX`) so a
  refresh auto-reconnects. A stable `clientId` in `localStorage`
  means you come back as the same player (score, words, host status
  preserved) for up to 72 hours of idle time.
- Shareable round URLs look like `/result?round=123` and survive both
  the room TTL and server restarts.

## Gameplay rules at a glance

- Three board sizes: 4×4, 5×5 (Big Boggle), 6×6 (Super Big Boggle).
  Host picks in the lobby.
- Round length: 60 – 300 seconds (default 180). Dev builds relax the
  floor to 5 seconds for fast iteration.
- Scoring: `length − 2` points per word (so 3 letters = 1, 4 = 2, 5 =
  3, etc.). Minimum 3 letters. Words must trace a connected path on
  the board with no cell reused. The `Qu` die counts as two letters.
- Dictionary: a curated English word list with Wiktionary-derived
  definitions and inflection mappings. Unknown words are rejected at
  submit time with a reason (too short, not on board, not a word,
  already found, letters only).

## Where to go next

- **[Development](./development.md)** — run the SPA, server, and
  admin bundle locally with hot reload.
- **[Deployment](./deployment.md)** — production compose, reverse
  proxy templates, backups, upgrades.
- **[Monitoring](./monitoring.md)** — admin dashboard, event logs,
  metrics, troubleshooting.
- **[Context for GPT agents](./context.md)** — architecture deep
  dive aimed at LLM-based coding assistants.
