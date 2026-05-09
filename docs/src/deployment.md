# Deployment

The production image is `ghcr.io/alifbae/bawgle:latest`. It's
multi-arch (amd64 + arm64), unprivileged, and carries everything the
server needs — dictionary, admin UI, Vite-built SPA. No separate
front-end or database process to run.

## One-container deploy

The repo ships a ready-to-pull `docker-compose.yml`:

```bash
mkdir bawgle && cd bawgle
curl -fsSL https://raw.githubusercontent.com/alifbae/bawgle/main/docker-compose.yml -o docker-compose.yml

cat > .env <<'EOF'
BAWGLE_ADMIN_USER=admin
BAWGLE_ADMIN_PASS=$(node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))")
BAWGLE_ALLOWED_ORIGINS=https://bawgle.example.com
BAWGLE_TRUST_PROXY=1
EOF

docker compose pull && docker compose up -d
```

The compose file joins the external `internal` Docker network so your
reverse proxy can reach `bawgle:3001` directly. No host ports are
published by default. Uncomment the `ports:` block if you want to
skip the proxy and expose `3001` directly.

Data lives in the `./data` bind mount: SQLite DB, WAL/SHM files, and
the daily JSONL event logs.

## Environment reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port inside the container |
| `BAWGLE_DATA_DIR` | `/data` | SQLite + logs directory |
| `BAWGLE_DB` | `$DATA_DIR/boggle.db` | SQLite file path |
| `BAWGLE_LOG_DIR` | `$DATA_DIR/logs` | JSONL event log dir; set `""` to disable |
| `BAWGLE_LOG_RETENTION_DAYS` | `30` | Prune daily logs older than this |
| `BAWGLE_ROUND_RETENTION_DAYS` | `30` | Prune `rounds` table older than this |
| `BAWGLE_ADMIN_USER` | `admin` | Basic-auth user for `/admin` |
| `BAWGLE_ADMIN_PASS` | _unset_ | Empty disables the admin surface entirely |
| `BAWGLE_ALLOWED_ORIGINS` | _unset_ | Comma-separated origin allowlist for WS upgrades |
| `BAWGLE_TRUST_PROXY` | _unset_ | `1` enables trust of `X-Forwarded-For` / `X-Real-IP` |
| `BAWGLE_ENVIRONMENT` | `production` | `development` relaxes the round-length minimum (60s → 5s) for fast local iteration |
| `TZ` | _unset_ | Compose sets `America/Toronto` by default for log timestamps |

`BAWGLE_TRUST_PROXY=1` is **only** safe when a trusted reverse proxy
sits in front. When the container is exposed to the internet
directly, leave it unset — the socket's remote address is used and an
attacker can't spoof a client IP via headers.

Legacy `BOGGLE_*` vars (`BOGGLE_DATA_DIR`, `BOGGLE_DB`) are still
read for backward compatibility with pre-rename deployments.

## Reverse proxy

WebSocket upgrades need the standard `Upgrade` / `Connection` headers
and a long read timeout so round-length connections don't get
terminated mid-play.

### nginx

```nginx
server {
  server_name bawgle.example.com;
  listen 80;

  location / {
    proxy_pass http://bawgle:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
  }
}
```

### Cloudflare Tunnel

```yaml
ingress:
  - hostname: bawgle.example.com
    service: http://bawgle:3001
  - service: http_status:404
```

### Caddy

```caddy
bawgle.example.com {
  reverse_proxy bawgle:3001
}
```

### Traefik

Label the service with the usual router + service labels; Traefik
handles the WS upgrade automatically. Set `loadBalancer.passHostHeader`
= `true`.

After configuring the proxy, set `BAWGLE_ALLOWED_ORIGINS` to your
public URL(s) and `BAWGLE_TRUST_PROXY=1` so client IPs in logs and
rate limits reflect real clients.

## Updates

```bash
docker compose pull && docker compose up -d
```

The image build runs on every push to `main` and on version tags. The
`latest` tag tracks `main`; pin to a semver tag (e.g.
`ghcr.io/alifbae/bawgle:v0.2.0`) for a stable deployment.

## Backups

SQLite is the source of truth for rooms and round history. The
`.db-wal` and `.db-shm` files are transient WAL artifacts; a safe
hot-copy is enough because `PRAGMA journal_mode = WAL` keeps writers
from blocking the copy.

```bash
docker run --rm \
  -v bawgle_boggle-data:/data \
  -v "$PWD:/backup" \
  alpine sh -c "cp /data/boggle.db /backup/bawgle-backup-$(date +%Y%m%d).db"
```

Restore by stopping the container, dropping the backup into the
volume, and starting it again.

## Data retention

- Rooms idle >72h are purged by the in-process sweeper (hourly tick,
  plus one on boot).
- Completed `rounds` rows are pruned daily by
  `BAWGLE_ROUND_RETENTION_DAYS` (default 30).
- JSONL event logs are pruned daily by `BAWGLE_LOG_RETENTION_DAYS`.
- Dictionary, admin assets, and the SPA are shipped in the image —
  they don't live in `/data`.

## Security notes

- Security headers (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, a scoped CSP) are applied
  to every response.
- The admin surface uses HTTP Basic auth with constant-time compare,
  plus a per-IP throttle that locks an IP for 5 minutes after 10
  _distinct_ bad credentials in a 3-minute window. Repeated replays
  of the same bad password (a stuck client with cached creds) count
  as one attempt so they don't self-lock.
- WebSocket upgrades enforce: origin allowlist (if configured),
  concurrent connections per IP (10), message rate limit (20-message
  burst, 5/s sustained), and a 15-second heartbeat. Each frame is
  capped at 2 KB.
- Unprivileged user (`node`, UID 1000) inside the container.
- `HEALTHCHECK` on `/api/health` every 30s.

## Dev compose

`docker-compose.dev.yml` builds the image locally instead of pulling
from GHCR (handy on arm64 Macs when CI hasn't finished) and publishes
`3001` on the host:

```bash
pnpm compose:dev         # build + up
pnpm compose:dev:logs    # tail
pnpm compose:dev:down    # stop + remove
```

Dev data goes into `./data/` at the repo root instead of the named
volume, so it doesn't collide with a production deployment on the
same host.
