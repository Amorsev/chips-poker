#!/bin/sh
set -eu

cd /app

echo "[entrypoint] applying database migrations"
./node_modules/.bin/prisma migrate deploy --schema apps/server/prisma/schema.prisma

echo "[entrypoint] starting Chips Poker API"
exec node apps/server/dist/index.js
