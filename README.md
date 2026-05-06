# bawgle

Multiplayer Boggle you can self-host. One container, one port, no extra pieces.

- Hono HTTP server + native WebSocket
- SQLite room / scoreboard persistence
- Real-time 4×4 / 5×5 / 6×6 boards
- Built-in admin dashboard at `/admin`

## Run

Pulls a prebuilt image from GHCR.

```bash
mkdir bawgle && cd bawgle
curl -fsSL https://raw.githubusercontent.com/alifbae/bawgle/main/docker-compose.yml -o docker-compose.yml

cat > .env <<'EOF'
BAWGLE_ADMIN_USER=admin
BAWGLE_ADMIN_PASS=change-me-to-something-long
EOF

docker compose pull && docker compose up -d
```

The container listens on `3001`. Point your reverse proxy (Cloudflare
Tunnel, Traefik, nginx, Caddy) at `bawgle:3001` on the shared Docker
network, or uncomment the `ports:` block in `docker-compose.yml` to
publish it on a host port.

### Update

```bash
docker compose pull && docker compose up -d
```

## Environment

| Variable                     | Default | Purpose                                |
| ---------------------------- | ------- | -------------------------------------- |
| `PORT`                       | `3001`  | HTTP port inside the container         |
| `BAWGLE_DATA_DIR`            | `/data` | SQLite DB + daily log files live here  |
| `BAWGLE_ADMIN_USER`          | `admin` | Basic-auth user for `/admin`           |
| `BAWGLE_ADMIN_PASS`          | _unset_ | If empty, `/admin` returns 401 for all |
| `BAWGLE_LOG_DIR`             | `$DATA_DIR/logs` | Set to `""` to disable JSONL logs |
| `BAWGLE_LOG_RETENTION_DAYS`  | `30`    | Daily log files older than this pruned |

## Behind a reverse proxy

WebSocket upgrades need the standard `Upgrade`/`Connection` headers.

### Cloudflare tunnel

```yaml
ingress:
  - hostname: bawgle.yourdomain.com
    service: http://bawgle:3001
  - service: http_status:404
```

### nginx

```nginx
server {
  server_name bawgle.yourdomain.com;
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

## Admin

Visit `/admin` (trailing slash) with the Basic-auth user + pass from
`.env`. Shows live rooms, player counts, rate-limit hits, the recent
in-memory event stream, and lets you browse persisted daily JSONL logs.

Generate a password:

```bash
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
```

## Data

Rooms, players, scores, and current-round state persist to SQLite in
the `boggle-data` Docker volume (mounted at `/data`). Back up with:

```bash
docker run --rm \
  -v bawgle_boggle-data:/data \
  -v "$PWD:/backup" \
  alpine sh -c "cp /data/boggle.db /backup/bawgle-backup-$(date +%Y%m%d).db"
```

Rooms that see no activity for 72 hours are purged automatically.

## Development

```bash
pnpm install
pnpm dev          # http://localhost:5175
pnpm test
pnpm lint
pnpm typecheck
```

`pnpm dev` runs three watchers in parallel: Vite for the SPA, `tsx
watch` for the server, and esbuild for the admin client bundle.

## License

MIT (or whatever you want).
