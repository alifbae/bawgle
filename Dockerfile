# syntax=docker/dockerfile:1.6

# ---------- Build stage ----------
# Alpine + native deps for better-sqlite3 (prebuilds cover most arches but
# having the toolchain ensures the image builds anywhere).
FROM node:26-alpine AS build
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
FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV BAWGLE_DATA_DIR=/data

# tzdata gives the container real timezone support so `TZ=America/Toronto`
# in compose actually takes effect.
RUN apk add --no-cache tzdata

# Native build tools aren't needed at runtime; the compiled .node binary
# is already in node_modules from the build stage.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/src/admin-panel ./src/admin-panel
COPY --from=build /app/src/shared ./src/shared
COPY --from=build /app/dist ./dist
COPY --from=build /app/data/dictionary ./data/dictionary

# Run unprivileged. The `node` user is baked into the upstream image at
# UID/GID 1000:1000, which matches most single-user Linux hosts. If a
# homelab runs as a different UID, the operator chowns their data dir
# on the host (or re-adds the PUID/PGID remap entrypoint later).
RUN mkdir -p /data && chown -R node:node /app /data
USER node
VOLUME ["/data"]

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1

CMD ["node_modules/.bin/tsx", "src/server/index.ts"]
