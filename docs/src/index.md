---
hide:
  - navigation
  - toc
---

# bawgle

Multiplayer Boggle you can self-host. One container, one port, no extra
pieces.

<div class="grid cards" markdown>

-   :material-rocket-launch: __[Getting started](getting-started.md)__

    ---

    Pull the image, set a password, open a browser. A room takes about
    60 seconds to spin up.

-   :material-server: __[Deployment](deployment.md)__

    ---

    Production compose, reverse-proxy templates (nginx, Caddy,
    Cloudflare Tunnel, Traefik), backups, retention, security.

-   :material-code-tags: __[Development](development.md)__

    ---

    Local setup, the three-watcher `pnpm dev` flow, scripts, repo
    layout, testing patterns.

-   :material-chart-line: __[Monitoring](monitoring.md)__

    ---

    Admin dashboard, JSON API, structured event logs, counters,
    troubleshooting recipes.

-   :material-robot: __[For AI agents](context.md)__

    ---

    Dense architectural brief for GPT / Claude / Cursor-style coding
    assistants. Protocol tables, state machine, intentional oddities.

-   :material-github: __[Source on GitHub](https://github.com/alifbae/bawgle)__

    ---

    Code, issues, releases. Image published to
    `ghcr.io/alifbae/bawgle`.

</div>

## What it is

- **Real-time** multiplayer over a single WebSocket.
- **4×4, 5×5, 6×6** boards. 60–300 second rounds. Standard Boggle dice.
- **SQLite** persistence for rooms, players, and completed rounds.
- **Built-in admin dashboard** at `/admin` with live metrics, room
  browser, and daily JSONL event logs.
- **Multi-arch container image** (`amd64` + `arm64`) published on
  every push to `main`.
- **Zero external dependencies** at runtime. Dictionary, admin UI, and
  SPA all ship in the image.

## One-liner

```bash
docker run -d \
  -p 3001:3001 \
  -v bawgle-data:/data \
  -e BAWGLE_ADMIN_USER=admin \
  -e BAWGLE_ADMIN_PASS=$(openssl rand -base64 24) \
  --name bawgle \
  ghcr.io/alifbae/bawgle:latest
```

Open <http://localhost:3001>, pick a name, share the `?room=` URL.
