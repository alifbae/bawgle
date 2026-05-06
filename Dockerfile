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

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1

CMD ["node_modules/.bin/tsx", "server/index.ts"]
