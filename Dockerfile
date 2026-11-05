# syntax=docker/dockerfile:1.7
#
# Chips Poker as one self-contained container: PostgreSQL, Redis and the
# Node.js app (REST API + Socket.IO + the built web client) on a single port.
#
#   docker build -t chips-poker .
#   docker run -d -p 8080:8080 -v chips-data:/data --name chips-poker chips-poker
#
# All state lives in the /data volume. See docker/entrypoint.sh.

# --- Build: compile the server and the web client ---------------------------
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --no-audit --no-fund
COPY apps/server ./apps/server
COPY apps/web ./apps/web
RUN npm run prisma:generate -w @poker/server \
 && npm run build -w @poker/server \
 && npm run build -w @poker/web

# --- Runtime dependencies: server packages + Prisma CLI for migrations ------
FROM node:22-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace=@poker/server --include-workspace-root --no-audit --no-fund \
 && npm cache clean --force
COPY apps/server/prisma ./apps/server/prisma
RUN npx prisma generate --schema apps/server/prisma/schema.prisma

# --- Runtime -----------------------------------------------------------------
FROM node:22-alpine AS runtime
ARG VERSION=1.2.0
LABEL org.opencontainers.image.title="Chips Poker" \
      org.opencontainers.image.description="Social No-Limit Hold'em on free play chips: PostgreSQL, Redis, API and web client in one container" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/Amorsev/chips-poker"
RUN apk add --no-cache openssl tini su-exec postgresql17 postgresql17-client redis

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    UPLOAD_DIR=/data/uploads \
    WEB_DIST_DIR=/app/apps/web/dist

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY apps/server/package.json ./apps/server/package.json
COPY apps/server/prisma ./apps/server/prisma
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY docker/entrypoint.sh /usr/local/bin/chips-entrypoint
# Tolerate a CRLF checkout on Windows: /bin/sh would choke on "\r".
RUN sed -i 's/\r$//' /usr/local/bin/chips-entrypoint \
 && chmod +x /usr/local/bin/chips-entrypoint \
 && mkdir -p /data

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1

STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--", "chips-entrypoint"]
