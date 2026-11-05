# syntax=docker/dockerfile:1.7
# --- Dependencies -----------------------------------------------------------
FROM node:22-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --no-audit --no-fund

# --- Build ------------------------------------------------------------------
FROM deps AS build
COPY apps/server ./apps/server
RUN npm run prisma:generate -w @poker/server \
 && npm run build -w @poker/server

# --- Runtime ----------------------------------------------------------------
FROM node:22-alpine AS runner
RUN apk add --no-cache openssl
ENV NODE_ENV=production \
    PORT=4000 \
    UPLOAD_DIR=/app/uploads
WORKDIR /app
# The Prisma CLI stays available so the entrypoint can apply migrations before
# the API starts. This keeps `docker compose up` a one-command deployment.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/prisma ./apps/server/prisma
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY apps/server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /app/uploads
EXPOSE 4000
ENTRYPOINT ["docker-entrypoint.sh"]
