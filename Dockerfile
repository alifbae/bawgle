# syntax=docker/dockerfile:1.6

# ---------- Build stage ----------
# Alpine + native deps for better-sqlite3 (prebuilds cover most arches but
# having the toolchain ensures the image builds anywhere).
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Production-only deps for the runtime image.
RUN pnpm prune --prod

# ---------- Runtime ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV BAWGLE_DATA_DIR=/data

# Tiny init wrapper: rewrites the `node` user's UID/GID to match
# PUID/PGID (homelab convention) so files written to the mounted
# /data volume end up owned by the host user, then drops privileges
# with su-exec. Falls back to the default node:node if either env
# var is unset. tzdata gives the container real timezone support so
# `TZ=America/Toronto` in compose actually takes effect.
RUN apk add --no-cache su-exec tzdata

# Native build tools aren't needed at runtime; the compiled .node binary
# is already in node_modules from the build stage.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/dist ./dist
COPY --from=build /app/data/dictionary ./data/dictionary

RUN mkdir -p /data

VOLUME ["/data"]

# Entrypoint adjusts the `node` user's UID/GID to match PUID/PGID if
# provided, chowns the data volume, then drops to that user. Uses a
# tiny inline script so we don't need to copy a separate file.
COPY <<'EOF' /entrypoint.sh
#!/bin/sh
set -eu

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$PUID" != "$(id -u node)" ] || [ "$PGID" != "$(id -g node)" ]; then
  # BusyBox `id` doesn't support --group-name; modify directly with sed.
  # /etc/passwd and /etc/group are tiny so this is fine.
  sed -i "s/^node:x:[0-9]*:[0-9]*:/node:x:${PUID}:${PGID}:/" /etc/passwd
  sed -i "s/^node:x:[0-9]*:/node:x:${PGID}:/" /etc/group
  chown -R "${PUID}:${PGID}" /app /data
fi

exec su-exec node:node "$@"
EOF
RUN chmod +x /entrypoint.sh

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node_modules/.bin/tsx", "server/index.ts"]
