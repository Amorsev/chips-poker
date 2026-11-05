# API reference

Everything is served from the same origin as the SPA in production. The REST base
path is `/api`; real-time gameplay uses Socket.IO at `/socket.io`.

- Requests and responses are JSON unless noted (avatar upload is `multipart/form-data`).
- Authenticated endpoints require `Authorization: Bearer <jwt>`.
- The browser should send `credentials: 'include'` so the signed device cookie
  is stored and returned. The cookie is not an authentication mechanism.
- All chip values in JSON are numbers. Internally they are PostgreSQL `BigInt`.

## Errors

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Неверный email или пароль"
  }
}
```

| Status | Meaning |
| --- | --- |
| `400` | Game rule violation / invalid reset token (`GAME_RULE_ERROR`, `INVALID_RESET_TOKEN`) |
| `401` | Missing/expired token or bad credentials (`UNAUTHORIZED`, `INVALID_CREDENTIALS`) |
| `403` | Device already used for another account (`DEVICE_ALREADY_USED`) |
| `404` | Unknown route or table (`NOT_FOUND`) |
| `409` | Unique constraint conflict (`ALREADY_EXISTS`) |
| `422` | Zod validation failure (`VALIDATION_ERROR`, includes `details`) |
| `429` | Rate limit or too many accounts per IP (`RATE_LIMITED`, `TOO_MANY_ACCOUNTS`) |
| `500` | `INTERNAL_ERROR` |
| `503` | Health check database failure |

Rate limits: 600 requests / 15 min per IP on `/api`; 30 / 15 min on `/api/auth`.

---

## Public endpoints

### `GET /api/health`

No authentication. Returns `200` when PostgreSQL answers, `503` otherwise.

```json
{ "status": "ok", "uptime": 123, "timestamp": "2026-11-03T10:00:00.000Z" }
```

---

## Authentication

### `POST /api/auth/register`

```json
{
  "email": "player@example.com",
  "password": "at-least-8-chars",
  "nickname": "Shark_99"
}
```

- Email is trimmed/lowercased and unique.
- Nickname: 3–20 characters, letters (Latin/Cyrillic), digits and `_`, unique
  case-insensitively.
- Password: 8–128 characters, at most 72 UTF-8 bytes (bcrypt limit).

`201` response:

```json
{
  "token": "eyJhbGciOi...",
  "user": {
    "id": "uuid",
    "email": "player@example.com",
    "nickname": "Shark_99",
    "avatarUrl": null,
    "avatarPreset": "🦊",
    "chips": 10000,
    "totalWon": 0,
    "totalLost": 0,
    "handsPlayed": 0,
    "handsWon": 0,
    "winRate": 0,
    "league": "BEGINNER",
    "welcomeBonusClaimed": true,
    "createdAt": "2026-11-03T10:00:00.000Z"
  }
}
```

The account starts with the 10,000-chip welcome bonus and a `WELCOME_BONUS`
ledger entry. A device that already registered an account receives `403`
unless `ALLOW_MULTI_ACCOUNT=true`.

### `POST /api/auth/login`

```json
{ "email": "player@example.com", "password": "at-least-8-chars" }
```

Returns the same `{ token, user }` shape. Unknown emails still perform a bcrypt
comparison to avoid timing leaks.

### `POST /api/auth/forgot-password`

```json
{ "email": "player@example.com" }
```

Always responds `200`:

```json
{ "message": "Если такой email существует, письмо со ссылкой отправлено" }
```

Creates a single-use token valid for 60 minutes. With SMTP configured, an email
is sent; otherwise the link is written to the server log (development only).

### `POST /api/auth/reset-password`

```json
{ "token": "raw-token-from-email", "password": "new-password" }
```

Consumes the token, bumps `tokenVersion` (invalidating all existing JWTs) and
returns `{ "message": "Пароль обновлён. Войдите с новым паролем." }`.

---

## Profile (authenticated)

### `GET /api/profile/me`

```json
{
  "user": { "...": "public user, see above" },
  "avatarPresets": ["🦊", "🐼", "..."],
  "recentHands": [
    {
      "id": "hand-uuid",
      "tableName": "Новичок #1 · 6-max",
      "league": "BEGINNER",
      "board": ["As", "Kd", "7c", "2h", "9s"],
      "holeCards": ["Ah", "Kh"],
      "pot": 1200,
      "wonAmount": 1200,
      "netAmount": 900,
      "result": "WON",
      "folded": false,
      "bestHand": "Две пары: A и K",
      "playedAt": "2026-11-03T09:58:00.000Z"
    }
  ],
  "transactions": [
    {
      "id": "tx-uuid",
      "type": "TABLE_BUY_IN",
      "amount": -400,
      "balanceAfter": 9600,
      "createdAt": "2026-11-03T09:55:00.000Z"
    }
  ]
}
```

`recentHands` is limited to 10; `transactions` to 8.

### `PATCH /api/profile/me`

```json
{ "nickname": "NewName", "avatarPreset": "🐼" }
```

Both fields are optional, but at least one is required. Returns `{ "user": ... }`.
Changing the nickname re-checks case-insensitive uniqueness (409 on conflict).

### `POST /api/profile/avatar`

`multipart/form-data` with a single field named `avatar`.

- JPEG, PNG, WebP or GIF, maximum 2 MB.
- The server validates magic bytes, re-encodes safe filenames and stores the file
  under `/uploads/avatars/`.
- Returns `{ "user": ... }` with the new `avatarUrl`.

### `GET /api/profile/hands?limit=20`

`limit` is 1–50 (default 20). Returns `{ "hands": [ ...same shape as above ] }`.

---

## Lobby (authenticated)

### `GET /api/lobby/tables`

```json
{
  "leagues": [
    {
      "key": "BEGINNER",
      "name": "Новичок",
      "minTotalWon": 0,
      "smallBlind": 10,
      "bigBlind": 20,
      "color": "#43d6a2",
      "unlocked": true
    }
  ],
  "tables": [
    {
      "id": "beginner-6max-1",
      "name": "Новичок #1 · 6-max",
      "league": "BEGINNER",
      "maxSeats": 6,
      "smallBlind": 10,
      "bigBlind": 20,
      "minBuyIn": 800,
      "maxBuyIn": 4000,
      "minTotalWon": 0,
      "activePlayers": 3,
      "averageStack": 2150,
      "phase": "playing",
      "nextHandAt": "2026-11-03T10:00:05.000Z",
      "unlocked": true
    }
  ],
  "currentTableId": null,
  "yourLeague": "BEGINNER",
  "yourTotalWon": 0,
  "generatedAt": "2026-11-03T10:00:00.000Z"
}
```

`phase` is `waiting`, `playing` or `complete`. `unlocked` is false until lifetime
wins exceed the league threshold.

### `GET /api/lobby/tables/:id`

Returns `{ "table": { ...same table shape... } }` or `404`.

---

## Leaderboard (authenticated)

### `GET /api/leaderboard?period=all&league=all`

| Query | Values | Default |
| --- | --- | --- |
| `period` | `all`, `week`, `today` | `all` |
| `league` | `all`, `beginner`, `amateur`, `pro`, `highroller` | `all` |

```json
{
  "period": "week",
  "league": "all",
  "entries": [
    {
      "rank": 1,
      "userId": "uuid",
      "nickname": "Shark_99",
      "avatarUrl": null,
      "avatarPreset": "🦊",
      "score": 18400,
      "hands": 42,
      "league": "AMATEUR",
      "isCurrentUser": false
    }
  ],
  "generatedAt": "2026-11-03T10:00:00.000Z"
}
```

Top 100. All-time score is `User.totalWon`; week/today score is the sum of
`HandParticipant.wonAmount` in the period. Results are cached for 45 seconds.

---

## Socket.IO

### Connection

```ts
io(undefined, { auth: { token: jwt } });
```

The token is also accepted as `Authorization: Bearer <jwt>` in the handshake
headers. Invalid/expired tokens or a stale `tokenVersion` are rejected with
`UNAUTHORIZED`. On reconnect the socket automatically rejoins the user's current
table and receives fresh state.

Client events use an optional acknowledgement callback:

```ts
socket.emit('table:join', payload, (ack) => {
  // { ok: true, ... } | { ok: false, error: string }
});
```

### Client → server

| Event | Payload | Ack (success) |
| --- | --- | --- |
| `table:join` | `{ tableId: string, buyIn?: number, seat?: number }` | `{ ok: true, buyIn, chipsAfter, freeTopUp }` |
| `table:leave` | none | `{ ok: true, removed: boolean }` |
| `table:action` | `{ type: 'fold'\|'check'\|'call'\|'bet'\|'raise'\|'allin', amount?: number }` | `{ ok: true }` |
| `table:chat` | `{ text: string }` (max 200 chars) | `{ ok: true }` |
| `table:rebuy` | `{ amount?: number }` | `{ ok: true, buyIn, chipsAfter, freeTopUp }` |
| `table:sitout` | `{ sittingOut: boolean }` | `{ ok: true }` |

- `buyIn` is clamped to the table range and the player's balance.
- If the balance is below the table minimum, the server tops up exactly to the
  minimum first (`freeTopUp` in the ack) and then debits the buy-in.
- `amount` is required for `bet`/`raise`, and is the **total** bet/raise-to
  amount for the current street, not the increment.
- `table:join` for the table you already occupy is idempotent (`buyIn: 0`).
- `table:leave` during a hand sets `pendingLeave`; the player is cashed out when
  the hand finishes.
- `table:rebuy` is only allowed when the player's stack is exactly 0.

Failed commands return `{ ok: false, error }` and usually also emit
`table:error` with `{ message }`.

### Server → client

| Event | Payload |
| --- | --- |
| `table:state` | Personalised `PublicTableState` (see below) |
| `table:chat` | `{ id, userId, nickname, text, at }` |
| `table:chat:history` | `ChatMessage[]` (sent after joining) |
| `table:error` | `{ message: string }` |
| `table:left` | `{ tableId: string }` |
| `table:info` | `{ message: string }` (e.g. leave deferred) |
| `wallet:update` | `{ chips: number }` |

`table:state` is emitted to every socket in the table room, but built per user:
you only receive your own hole cards, and opponents' cards appear only when a
showdown reveals them.

```ts
interface PublicTableState {
  revision: number;
  table: {
    id: string; name: string; league: string;
    maxSeats: number; smallBlind: number; bigBlind: number;
    minBuyIn: number; maxBuyIn: number; minTotalWon: number;
  };
  phase: 'waiting' | 'playing' | 'complete';
  handId: string | null;
  handNumber: number;
  street: string | null;          // preflop | flop | turn | river | showdown
  board: string[];
  pot: number;
  currentBet: number;
  minRaise: number;
  buttonSeat: number | null;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  actingSeat: number | null;
  actionDeadline: string | null;  // ISO timestamp
  turnTimeoutMs: number;
  nextHandAt: string | null;
  players: Array<{
    seat: number;
    userId: string;
    nickname: string;
    avatarUrl: string | null;
    avatarPreset: string;
    stack: number;
    bet: number;                  // committed on the current street
    committed: number;            // committed in the whole hand
    folded: boolean;
    allIn: boolean;
    hasActed: boolean;
    isButton: boolean;
    isSmallBlind: boolean;
    isBigBlind: boolean;
    status: 'active' | 'folded' | 'all-in' | 'waiting' | 'sitting-out' | 'disconnected';
    connected: boolean;
    pendingLeave: boolean;
    cards?: string[];             // only when legitimately visible
    lastAction?: { type: string; amount: number };
  }>;
  you: {
    seated: boolean;
    seat: number | null;
    holeCards: string[];
    handName: string | null;        // concrete live combination, e.g. "Стрит 2–6"
    legalActions: {
      canFold: boolean;
      canCheck: boolean;
      canCall: boolean;
      callAmount: number;
      canBet: boolean;
      betMin: number;
      betMax: number;
      canRaise: boolean;
      raiseMin: number;
      raiseMax: number;
      canAllIn: boolean;
      allInAmount: number;
    } | null;
  } | null;
  lastResult: {
    handId: string;
    handNumber: number;
    board: string[];
    pot: number;
    showdown: boolean;
    winners: Array<{
      userId: string;
      nickname: string;
      amount: number;
      potIndex: number;
      handLabel?: string;
    }>;
  } | null;
}
```

Use `revision` to discard out-of-order snapshots. `actionDeadline` and
`turnTimeoutMs` drive the countdown; the server enforces the timeout regardless
of the client.

### Chat limits

Maximum 5 messages per 5 seconds per socket. Violations return
`{ ok: false, error }` and do not broadcast.
