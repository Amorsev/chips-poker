# Chips Poker — social Texas Hold'em

A full-stack, real-time **No-Limit Texas Hold'em** platform built around free,
non-redeemable play chips. There is no money, no purchases, no cash-out and no
chip transfers. Register, receive 10,000 free chips, sit at a cash table and
climb the leagues.

- **Backend:** Node.js 22, TypeScript, Express, Socket.IO, Prisma + PostgreSQL, Redis.
- **Frontend:** React 18, Vite, TypeScript, Socket.IO client.
- **Game engine:** authoritative in-memory No-Limit Hold'em with side pots,
  under-raise rules, time banks and automatic mucking.
- **Deployment:** one-command Docker Compose stack (PostgreSQL, Redis, API, nginx).

---

## Table of contents

1. [Free-chip policy](#free-chip-policy)
2. [Features](#features)
3. [Leagues and tables](#leagues-and-tables)
4. [Project structure](#project-structure)
5. [Local development](#local-development)
6. [Docker deployment](#docker-deployment)
7. [Tests and checks](#tests-and-checks)
8. [Documentation](#documentation)
9. [Security notes](#security-notes)
10. [Scaling notes](#scaling-notes)

---

## Free-chip policy

Chips are **virtual points for entertainment only**. The product intentionally
contains no path to convert chips into money or goods:

- No payment provider, no checkout, no purchase endpoint.
- No peer-to-peer transfers, gifts, trades or chip sales.
- No cash-out or withdrawal. Leaving a table returns the stack to the in-app
  bankroll; the bankroll itself is not redeemable.
- Every account receives a one-time **10,000-chip welcome bonus** at registration.
- A player who cannot afford a table's minimum buy-in receives a **free top-up
  to exactly the minimum**, then pays the buy-in. The same rule applies to a
  rebuy when a stack reaches zero.
- All grants are written to an append-only `ChipTransaction` ledger
  (`WELCOME_BONUS`, `FREE_TOP_UP`, `TABLE_BUY_IN`, `TABLE_CASH_OUT`).

These rules are enforced server-side. The browser never sends a chip balance;
it only sends intents such as "call" or "raise to 400".

## Features

- Email/password registration and login, bcrypt hashing, JWT access tokens,
  password reset by single-use hashed token.
- Unique case-insensitive nickname, emoji avatar presets and image upload.
- Profile: balance, total won, total lost, hands played, win rate, recent hands,
  chip ledger.
- Real-time 6-max and 9-max No-Limit Hold'em cash tables.
- Fold / check / call / bet / raise / all-in with server-side validation.
- 15–30 second configurable action timer (20 s by default), blinds, button
  movement, heads-up blind rules, side pots, split pots.
- Automatic muck of losing hands; only shown-down winning hands are revealed.
- Free rebuy at the table when a stack hits zero; sit-out and safe leave after
  the current hand.
- Lobby with live seat counts, average stack, buy-in limits and league locks.
- Leagues with automatic progression based on lifetime chips won.
- Top-100 leaderboards overall and per league, filtered **all time / week / today**.
- Responsive dark casino UI with rotating seats (local player always at the bottom).
- Phone-first table view: one-screen layout in portrait and landscape, touch-sized
  controls, two-tap raise/all-in confirmation, installable PWA with an offline page.
- Rate limiting, Helmet, CORS allow-list, Zod validation on every endpoint and
  socket event, device fingerprinting for multi-account abuse.
- Docker Compose deployment with automatic Prisma migrations and nginx reverse proxy.

## Leagues and tables

League access is based on **lifetime chips won** (`User.totalWon`), not balance.

| League | Blinds | Unlock threshold | Buy-in range |
| --- | --- | --- | --- |
| Новичок (Beginner) | 10 / 20 | 0 | 800 – 4,000 |
| Любитель (Amateur) | 50 / 100 | > 5,000 won | 4,000 – 20,000 |
| Профи (Pro) | 200 / 400 | > 50,000 won | 16,000 – 80,000 |
| Хайроллер (Highroller) | 1,000 / 2,000 | > 500,000 won | 80,000 – 400,000 |

Buy-in limits are **40–200 big blinds**. Each league has 6-max and 9-max tables,
with two Beginner 6-max tables for a busier lobby. A player may sit at only one
table at a time; joining the table they already occupy is idempotent and never
charges a second buy-in.

## Project structure

```
poker/
├── apps/
│   ├── server/                  # API + Socket.IO + game engine
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/      # 20260101000000_init
│   │   ├── src/
│   │   │   ├── auth/            # register, login, reset, JWT, devices
│   │   │   ├── profile/         # stats, history, avatar upload
│   │   │   ├── lobby/           # table list and league locks
│   │   │   ├── leaderboard/     # all/week/today rankings + cache
│   │   │   ├── game/            # deck, evaluator, engine, runtime, manager
│   │   │   ├── realtime/        # Socket.IO gateway
│   │   │   ├── utils/           # serialization, crypto helpers
│   │   │   ├── app.ts           # Express composition
│   │   │   ├── config.ts        # validated environment
│   │   │   └── index.ts         # HTTP + Socket.IO bootstrap
│   │   ├── Dockerfile
│   │   └── docker-entrypoint.sh
│   └── web/                     # React SPA
│       ├── src/
│       │   ├── pages/           # auth, lobby, table, profile, leaderboard
│       │   ├── components/      # layout, cards, avatars, modals
│       │   ├── context/         # auth + toast providers
│       │   ├── lib/             # API client, socket, formatting
│       │   └── styles.css       # responsive emerald/gold theme
│       ├── nginx.conf
│       └── Dockerfile
├── docs/
│   ├── ARCHITECTURE.md
│   └── API.md
├── docker-compose.yml
├── start.ps1                    # Windows one-command local launcher
├── .env.example
└── package.json                 # npm workspaces + root scripts
```

## Local development

### Windows quick start

If PostgreSQL is installed but its system configuration is not available to the
app, use the bundled launcher. It creates an isolated PostgreSQL cluster in
`.pgdata` on port **55432**, applies migrations and starts both dev servers
without changing the system PostgreSQL setup:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

Open <http://localhost:5173>. The site keeps running until you press `Ctrl+C`.

To expose the same dev server through a CloudPub tunnel, start the tunnel
against `http://localhost:5173`. Vite already allows `*.cloudpub.ru`, and
`start.ps1` includes `dimitrius.cloudpub.ru` in the API's allowed origins. If
the tunnel uses another domain, add it to `server.allowedHosts` in
`apps/web/vite.config.ts` and to `WEB_ORIGIN` in `start.ps1`.

### Prerequisites

- Node.js **20.11+** (22 recommended)
- PostgreSQL **14+**
- Redis **6+** (optional; the API runs without it, but the Socket.IO adapter and
  leaderboard cache are disabled)

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Generate real secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Set at least `DATABASE_URL`, `JWT_SECRET` (32+ chars) and optionally `REDIS_URL`.
The server reads `.env` from either the repository root or `apps/server`.

### 3. Create the database schema

```bash
npm run db:generate
npm run db:migrate        # prisma migrate dev
# or, for a throwaway database:
npm run db:push
```

### 4. Run

```bash
npm run dev
```

- Web: <http://localhost:5173>
- API: <http://localhost:4000>
- Health: <http://localhost:4000/api/health>

Vite proxies `/api`, `/uploads` and `/socket.io` to the API, so no CORS setup
is needed in development. The dev server listens on `127.0.0.1` (IPv6 loopback
is refused on some Windows machines). To open it from a phone on the same Wi-Fi,
start it with `VITE_DEV_HOST=0.0.0.0` and add the LAN origin to `WEB_ORIGIN`.
The service worker is registered only in production builds (`npm run build`,
then `npx vite preview` in `apps/web`).

### Root scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | API and web together (concurrently) |
| `npm run build` | Compile the server and build the SPA |
| `npm run typecheck` | TypeScript checks for both workspaces |
| `npm test` | Server unit tests (evaluator + engine) |
| `npm run db:generate` | `prisma generate` |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:push` | Push schema without a migration |
| `npm run db:studio` | Prisma Studio |
| `npm run docker:up` | Build and start the full stack |
| `npm run docker:down` | Stop the stack |

## Docker deployment

```bash
# 1. Provide production secrets (at minimum JWT_SECRET and device secret).
export JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
export DEVICE_COOKIE_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
export WEB_ORIGIN="http://localhost:8080"

# 2. Build and start PostgreSQL, Redis, the API and nginx.
docker compose up --build
```

Open <http://localhost:8080>. The API container waits for healthy PostgreSQL and
Redis, then runs `prisma migrate deploy` automatically before starting Node.

| Service | Port | Notes |
| --- | --- | --- |
| `web` | 8080 | nginx serves the SPA and proxies `/api`, `/uploads`, `/socket.io` |
| `server` | 4000 | Express + Socket.IO; stores avatars in the `poker_uploads` volume |
| `postgres` | 5432 | data in `postgres_data` |
| `redis` | 6379 | AOF persistence in `redis_data` |

`WEB_ORIGIN` must match the browser-facing origin (for example
`https://poker.example.com` behind a TLS terminator). The compose default is
`http://localhost:8080`.

To reset all data:

```bash
docker compose down -v
```

## Tests and checks

```bash
npm run typecheck
npm test
npm run build
```

The server suite covers hand evaluation (straight/flush/full house/tie-breaks)
and engine behavior: blinds, button rotation, legal actions, min-raises,
all-ins/side pots, fold wins, showdown payouts and timer-driven folds.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, data flow, database
  schema, scaling to 500 concurrent players, Redis usage, failure handling.
- [`docs/API.md`](docs/API.md) — REST endpoints, payloads, error format and
  Socket.IO events.

## Security notes

- Passwords are hashed with bcrypt (cost 12). Login equalises timing for unknown
  accounts. Reset tokens are random, stored as SHA-256 hashes, single-use and
  expire after one hour. A password reset bumps `tokenVersion`, invalidating
  existing JWTs.
- JWT is sent as `Authorization: Bearer …`; Socket.IO verifies it in the
  handshake and re-checks `tokenVersion`.
- Every request body, query parameter and socket payload is parsed with Zod.
- Helmet, strict CORS allow-list, 100 kB JSON limit, 2 MB avatar limit with
  image-type sniffing, per-IP rate limits (600 requests/15 min general,
  30/15 min auth).
- Device fingerprint cookie + IP hash are stored to block the same device from
  registering multiple accounts and to soft-limit accounts per IP in 24 hours.
  `ALLOW_MULTI_ACCOUNT=true` is intended for demos only.
- All chip mutations run in serializable PostgreSQL transactions with a ledger
  row; the client is never trusted with an amount or stack.

## Scaling notes

A single game node comfortably hosts the target 500 concurrent players because
table state is in memory and broadcasts are scoped to table rooms. For horizontal
scale, use sticky sessions plus the Redis Socket.IO adapter, and assign each
table to one owning node with a Redis lease (see `docs/ARCHITECTURE.md`). Table
state is intentionally ephemeral: on restart, players reconnect and buy back in
with their bankroll, which is always durable in PostgreSQL.
