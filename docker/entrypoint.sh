#!/bin/sh
# Chips Poker all-in-one container entrypoint.
#
# Runs PostgreSQL, Redis and the Node.js app (API + web client) in one
# container. Everything persistent lives under $DATA_DIR (a single volume):
#   postgres/   database cluster
#   redis/      append-only file
#   uploads/    avatars
#   secrets/    generated JWT and cookie secrets (kept across restarts)
#
# Set DATABASE_URL or REDIS_URL to use an external server instead of the
# bundled one. Stop order on SIGTERM: app -> Redis -> PostgreSQL.
set -eu

DATA_DIR="${DATA_DIR:-/data}"
PGDATA="$DATA_DIR/postgres"
PG_SOCKET_DIR=/run/postgresql
PG_DB="${POSTGRES_DB:-poker}"

APP_PID=""
PG_PID=""
REDIS_PID=""

# Logs go to stderr: secret() runs inside $(...) and must print only the secret.
log() { echo "[chips] $*" >&2; }

mkdir -p "$DATA_DIR/uploads" "$DATA_DIR/redis" "$DATA_DIR/secrets" "$PG_SOCKET_DIR"
chown node:node "$DATA_DIR/uploads"
chmod 700 "$DATA_DIR/secrets"

# --- Secrets -----------------------------------------------------------------
# Generated once and stored in the volume, so logins survive container restarts.
secret() {
  file="$DATA_DIR/secrets/$1"
  if [ ! -s "$file" ]; then
    (umask 077 && node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))" > "$file")
    log "generated $1"
  fi
  cat "$file"
}
if [ -z "${JWT_SECRET:-}" ]; then JWT_SECRET="$(secret jwt_secret)"; fi
if [ -z "${DEVICE_COOKIE_SECRET:-}" ]; then DEVICE_COOKIE_SECRET="$(secret device_cookie_secret)"; fi
export JWT_SECRET DEVICE_COOKIE_SECRET

# --- PostgreSQL --------------------------------------------------------------
if [ -z "${DATABASE_URL:-}" ]; then
  chown postgres:postgres "$PG_SOCKET_DIR"
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    log "initialising PostgreSQL cluster in $PGDATA"
    mkdir -p "$PGDATA"
    chown postgres:postgres "$PGDATA"
    chmod 700 "$PGDATA"
    # Unix socket only (no TCP listener), so trust auth never leaves the container.
    su-exec postgres initdb -D "$PGDATA" -U postgres -E UTF8 --locale=C --auth-local=trust >/dev/null
  fi
  chown -R postgres:postgres "$PGDATA"

  log "starting PostgreSQL"
  su-exec postgres postgres -D "$PGDATA" -c listen_addresses='' -c unix_socket_directories="$PG_SOCKET_DIR" &
  PG_PID=$!

  i=0
  until su-exec postgres pg_isready -q -h "$PG_SOCKET_DIR"; do
    i=$((i + 1))
    if [ "$i" -gt 60 ] || ! kill -0 "$PG_PID" 2>/dev/null; then
      log "PostgreSQL did not start"
      exit 1
    fi
    sleep 1
  done

  if [ "$(su-exec postgres psql -h "$PG_SOCKET_DIR" -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$PG_DB'")" != "1" ]; then
    log "creating database $PG_DB"
    su-exec postgres createdb -h "$PG_SOCKET_DIR" -U postgres "$PG_DB"
  fi
  DATABASE_URL="postgresql://postgres@localhost/$PG_DB?host=$PG_SOCKET_DIR&schema=public"
  export DATABASE_URL
else
  log "using external PostgreSQL from DATABASE_URL"
fi

# --- Redis -------------------------------------------------------------------
if [ -z "${REDIS_URL:-}" ]; then
  chown redis:redis "$DATA_DIR/redis"
  REDIS_PASSWORD="$(secret redis_password)"
  log "starting Redis"
  # Loopback only and password-protected, although nothing outside the
  # container can reach it.
  su-exec redis redis-server \
    --bind 127.0.0.1 --port 6379 --protected-mode yes \
    --requirepass "$REDIS_PASSWORD" \
    --dir "$DATA_DIR/redis" --appendonly yes \
    --save "" --loglevel warning &
  REDIS_PID=$!

  i=0
  until REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli -h 127.0.0.1 -p 6379 ping 2>/dev/null | grep -q PONG; do
    i=$((i + 1))
    if [ "$i" -gt 30 ] || ! kill -0 "$REDIS_PID" 2>/dev/null; then
      log "Redis did not start"
      exit 1
    fi
    sleep 1
  done
  REDIS_URL="redis://:$REDIS_PASSWORD@127.0.0.1:6379"
  export REDIS_URL
elif [ "$REDIS_URL" = "off" ]; then
  log "Redis disabled (REDIS_URL=off)"
  unset REDIS_URL
else
  log "using external Redis from REDIS_URL"
fi

# --- Shutdown ----------------------------------------------------------------
stop_services() {
  if [ -n "$REDIS_PID" ] && kill -0 "$REDIS_PID" 2>/dev/null; then
    log "stopping Redis"
    kill -TERM "$REDIS_PID" 2>/dev/null || true
    wait "$REDIS_PID" 2>/dev/null || true
  fi
  if [ -n "$PG_PID" ] && kill -0 "$PG_PID" 2>/dev/null; then
    log "stopping PostgreSQL"
    # SIGINT = fast shutdown: roll back open transactions, checkpoint, exit.
    kill -INT "$PG_PID" 2>/dev/null || true
    wait "$PG_PID" 2>/dev/null || true
  fi
}

shutdown() {
  log "shutdown requested"
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill -TERM "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  stop_services
  log "stopped"
  exit 0
}
trap shutdown TERM INT

# --- Migrations and app ------------------------------------------------------
log "applying database migrations"
su-exec node node_modules/.bin/prisma migrate deploy --schema apps/server/prisma/schema.prisma

log "starting Chips Poker on port ${PORT:-8080}"
su-exec node node apps/server/dist/index.js &
APP_PID=$!

# Stay alive while every process is running; if one dies, stop the rest so
# the container exits and the restart policy brings everything back cleanly.
while kill -0 "$APP_PID" 2>/dev/null \
  && { [ -z "$PG_PID" ] || kill -0 "$PG_PID" 2>/dev/null; } \
  && { [ -z "$REDIS_PID" ] || kill -0 "$REDIS_PID" 2>/dev/null; }; do
  sleep 2 &
  wait $! 2>/dev/null || true
done

log "a process exited unexpectedly; stopping the container"
if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
  kill -TERM "$APP_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
fi
stop_services
exit 1
