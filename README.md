# Chips Poker — social Texas Hold'em

A full-stack, real-time **No-Limit Texas Hold'em** platform built around free,
non-redeemable play chips. There is no money, no purchases, no cash-out and no
chip transfers. Register, receive 10,000 free chips, sit at a cash table and
climb the leagues.

- **Backend:** Node.js 22, TypeScript, Express, Socket.IO, Prisma + PostgreSQL, Redis.
- **Frontend:** React 18, Vite, TypeScript, Socket.IO client.
- **Game engine:** authoritative in-memory No-Limit Hold'em with side pots,
  under-raise rules, time banks and automatic mucking.
- **Deployment:** one self-contained container: PostgreSQL, Redis, the API and the
  web client run inside it, on a single port, at any host name or IP address.

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
- Single-container deployment (PostgreSQL, Redis, API and web client inside one
  image) with automatic Prisma migrations and generated secrets.

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
│   │   │   ├── web-client.ts    # serves the built SPA from the API
│   │   │   ├── config.ts        # validated environment
│   │   │   └── index.ts         # HTTP + Socket.IO bootstrap
│   └── web/                     # React SPA
│       ├── src/
│       │   ├── pages/           # auth, lobby, table, profile, leaderboard
│       │   ├── components/      # layout, cards, avatars, modals
│       │   ├── context/         # auth + toast providers
│       │   ├── lib/             # API client, socket, formatting
│       │   └── styles.css       # responsive emerald/gold theme
│       └── public/              # PWA manifest, icons, service worker
├── docs/
│   ├── ARCHITECTURE.md
│   └── API.md
├── docker/
│   └── entrypoint.sh            # starts PostgreSQL, Redis and the app
├── Dockerfile                   # all-in-one image
├── docker-compose.yml           # one service + one data volume
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

To expose the dev server through a tunnel (CloudPub, ngrok and so on), point
the tunnel at `http://localhost:5173`. No origin list has to be maintained: the
Vite dev server accepts any host name and the API has no CORS allow-list,
because the browser always reaches it through the same origin.

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
start it with `VITE_DEV_HOST=0.0.0.0`.
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
| `npm run docker:up` | Build and start the all-in-one container |
| `npm run docker:down` | Stop it |

## Docker deployment

The whole application is **one container**. PostgreSQL 17, Redis and the Node.js
app (REST API, Socket.IO and the built web client) run inside it; nothing else
has to be installed or configured. All state lives in one volume mounted at
`/data`.

### From a release image

Each GitHub release has a ready image (`chips-poker-<version>-image-amd64.tar.gz`):

```bash
docker load -i chips-poker-1.2.0-image-amd64.tar.gz
docker run -d --name chips-poker --restart unless-stopped   -p 8080:8080 -v chips-data:/data chips-poker:1.2.0
```

### From source

```bash
docker compose up -d --build
```

Open `http://<server-address>:8080`: `localhost`, a LAN IP, a public IP or a
domain all work, with no origin list to configure. The first start creates the
database, generates the JWT and cookie secrets (stored in `/data/secrets`, so
sessions survive restarts) and applies migrations.

| Path in `/data` | Contents |
| --- | --- |
| `postgres/` | PostgreSQL cluster (Unix socket only, no TCP port) |
| `redis/` | Redis append-only file (listens on 127.0.0.1 inside the container) |
| `uploads/` | Avatars |
| `secrets/` | Generated `JWT_SECRET` and `DEVICE_COOKIE_SECRET` |

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Port inside the container |
| `TRUST_PROXY` | `0` | Set to `1` behind a TLS reverse proxy (real client IPs, secure cookies) |
| `PUBLIC_WEB_URL` | from request | Pins password-reset links to one URL; set it when SMTP is configured on a public server |
| `JWT_SECRET`, `DEVICE_COOKIE_SECRET` | generated | Override the generated secrets |
| `DATABASE_URL` | bundled PostgreSQL | Use an external PostgreSQL instead |
| `REDIS_URL` | bundled Redis | Use an external Redis, or `off` to run without it |
| `SMTP_*` | unset | Send password-reset e-mails (otherwise links are logged) |

Back up by copying the volume while the container is stopped, or with
`docker exec chips-poker pg_dump -h /run/postgresql -U postgres poker`.

To reset all data:

```bash
docker compose down -v
```

HTTPS: put any TLS reverse proxy (Caddy, nginx, Traefik) in front of port 8080
and set `TRUST_PROXY=1`. Browsers only install the PWA and register its service
worker over HTTPS (or on `localhost`).

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
