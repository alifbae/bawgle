# bawgle
Multiplayer Boggle you can self-host.

[![CI](https://github.com/alifbae/bawgle/actions/workflows/publish.yml/badge.svg)](https://github.com/alifbae/bawgle/actions/workflows/publish.yml)
[![Image](https://img.shields.io/badge/ghcr.io-alifbae%2Fbawgle-blue?logo=docker)](https://github.com/alifbae/bawgle/pkgs/container/bawgle)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](#license)



## Run

```bash
mkdir bawgle && cd bawgle
curl -fsSL https://raw.githubusercontent.com/alifbae/bawgle/main/docker-compose.yml -o docker-compose.yml

cat > .env <<'EOF'
BAWGLE_ADMIN_USER=admin
BAWGLE_ADMIN_PASS=change-me-to-something-long
EOF

docker compose pull && docker compose up -d
```

Container listens on `3001`. Point a reverse proxy at it, or uncomment
the `ports:` block in `docker-compose.yml` to publish on a host port.

## Documentation

**<https://docs.bawgle.alifbae.dev>**

- [Getting started](https://docs.bawgle.alifbae.dev/getting-started/)
- [Deployment](https://docs.bawgle.alifbae.dev/deployment/)
- [Development](https://docs.bawgle.alifbae.dev/development/)
- [Monitoring](https://docs.bawgle.alifbae.dev/monitoring/)

## License

MIT
