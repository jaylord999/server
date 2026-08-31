# DefenderServer

Authoritative multiplayer backend for the **Defender** game.

A lightweight Node.js + TypeScript WebSocket server that handles multiplayer
communication, game state, validation, matchmaking and simulation. It renders
nothing - the Godot client renders the battlefield.

- **Node.js** ≥ 20
- **TypeScript** (compiled to JavaScript for production)
- **WebSocket** (`ws`) with JSON messages
- **No game engine, no graphics, no database** (in-memory state for now)

---

## Quick start

```bash
npm install
npm run dev
```

The server starts on `http://localhost:3000` (or `PORT` if set).

```bash
curl http://localhost:3000/health
# {"status":"healthy"}
```

Production build:

```bash
npm run build   # compiles TypeScript into dist/
npm start       # node dist/main.js
```

## Project structure

```
DefenderServer/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
├── scripts/
│   └── smoke-test.mjs          # manual end-to-end WebSocket smoke test
└── src/
    ├── main.ts                 # composition root + entrypoint
    ├── integration.test.ts     # end-to-end WebSocket tests
    ├── game/
    │   ├── GameConfig.ts       # centralized environment config
    │   ├── GameState.ts        # server-authoritative battle state
    │   └── PowerAllocation.ts  # defender power validation
    ├── matchmaking/
    │   └── MatchmakingQueue.ts # simple FIFO queue + pairing
    ├── network/
    │   ├── WebSocketServer.ts  # (ws wiring lives in main.ts)
    │   ├── ConnectionManager.ts
    │   ├── HeartbeatManager.ts
    │   └── MessageRouter.ts
    ├── players/
    │   ├── Player.ts
    │   └── PlayerManager.ts
    ├── protocol/
    │   ├── ClientMessages.ts
    │   ├── ServerMessages.ts
    │   └── MessageTypes.ts
    ├── rooms/
    │   ├── GameRoom.ts
    │   └── RoomManager.ts
    └── utils/
        └── logger.ts
```

> Note: the WebSocket server is instantiated on the shared HTTP service in
> `src/main.ts` (`new WebSocketServer({ server: httpServer, path: '/' })`), which
> is why the spec's `network/WebSocketServer.ts` is represented there rather
> than as a separate file.

## Environment variables


## Wire protocol

Every message uses a consistent envelope. `type` is mandatory, `requestId` is
optional (echoed by the server), `timestamp` is always set by the server.

```json
{
  "type": "message_type",
  "requestId": "optional-id",
  "timestamp": 123456789,
  "data": {}
}
```

### Client -> server messages

| Type | Purpose |
| --- | --- |
| `identify` | Report `clientVersion`; server assigns a temporary `playerId` |
| `ping` | Application-level ping (for latency); server replies `pong` |
| `find_match` | Enter the matchmaking queue |
| `cancel_match` | Leave the matchmaking queue |
| `leave_room` | Leave the current battle room |
| `player_input` | Attacker inputs: `{ throttle, pitch, yaw }` in [-1, 1] |
| `turret_input` | Defender inputs: `{ rotation, barrel }` |
| `fire_weapon` | Request to fire: `{ weapon: "bullet" \| "missile" }` |
| `power_allocation` | Defender energy split across 5 systems |

### Server -> client messages

| Type | Purpose |
| --- | --- |
| `welcome` | Sent immediately after connect (`connectionId`, `protocolVersion`) |
| `identified` | Confirms `identify` and returns the `playerId` |
| `pong` | Reply to `ping` (`serverTime`, echo of client data) |
| `match_searching` | Player is in the matchmaking queue |
| `match_found` | Room created; includes `roomId` and `role` |
| `room_joined` | Confirms room entry (`opponentPlayerId`, `gameStarted`) |
| `room_left` | Player left / opponent left / opponent disconnected / time limit |
| `game_state` | Authoritative snapshot broadcast at TICK_RATE |
| `player_state` | Reserved for per-player state updates |
| `turret_state` | Latest accepted turret rotation/barrel/heat |
| `weapon_fired` | Server accepted a shot (with `projectileId`) |
| `damage` | Reserved for combat results |
| `resource_update` | Ammo / missiles / materials after an accepted action |
| `power_update` | Accepted defender power allocation |
| `error` | Structured error: `{ code, message }` |
| `server_message` | Informational message (e.g. matchmaking cancelled) |

### Error codes

`INVALID_MESSAGE`, `UNKNOWN_MESSAGE`, `ALREADY_IDENTIFIED`, `NOT_IDENTIFIED`,
`INVALID_INPUT`, `ALREADY_IN_QUEUE`, `NOT_IN_QUEUE`, `ALREADY_IN_ROOM`,
`NOT_IN_ROOM`, `INVALID_POWER_ALLOCATION`, `WEAPON_UNAVAILABLE`.

Example rejection:

```json
{
  "type": "error",
  "timestamp": 1750000000000,
  "data": {
    "code": "INVALID_POWER_ALLOCATION",
    "message": "Total power (120) exceeds available power (100)."
  }
}
```

### Example: two-player match

```
Client A                          Server                              Client B
   |  connect (ws://host:PORT)  --> |
   |  <-- welcome { connectionId }  |
   |  identify { clientVersion } -->|
   |  <-- identified { playerId }   |

## Render.com deployment

1. **Create a new Web Service** on [Render](https://render.com) and connect the
   GitHub repository containing this project.
2. **Connect the repository** and point Render at the `DefenderServer` root
   directory (set **Root Directory** to `DefenderServer` if the repo contains
   multiple projects).
3. **Runtime / install**: Render runs `npm install` automatically. No Docker
   required.
4. **Build command**: `npm run build`
5. **Start command**: `npm start`
6. **Environment variables**:
   - `PORT` — Render sets this automatically (usually `10000`). Do **not**
     hardcode it. Add only the variables you want to override
     (see `.env.example`).
7. **Health check path**: `/health` — set this in the Web Service health check
   settings. The service also returns a friendly root payload at `/`.
8. **WebSocket URL format**: clients connect to
   `wss://<your-service-name>.onrender.com` (the WebSocket endpoint is on the
   root path of the same service). The Godot client reads this URL from an
   environment variable / export setting - it must **never** be hardcoded in the
   game code.

> Render expects the app to bind to `0.0.0.0` and use the injected `PORT`.
> Both are already handled by this project.
>
> **Why the build is self-contained:** Render sets `NODE_ENV=production`, which
> makes a plain `npm install` skip `devDependencies`. The `build` script
> therefore runs `npm install --include=dev && tsc -p tsconfig.json`, so the
> TypeScript toolchain (`typescript`, `@types/node`, `@types/ws`) is always
> present during the build - even if Render's separate install step is skipped.
> The tsconfig uses the modern `module: "node16"` / `moduleResolution: "node16"`
> settings rather than the removed `node10` resolution.
>
> **Exact Render settings (also declared in `render.yaml`):**
>
> | Field | Value |
> | --- | --- |
> | Install Command | `npm install --include=dev` |
> | Build Command | `npm run build` |
> | Start Command | `npm start` |
> | Health Check Path | `/health` |
>
> To deploy via blueprint: **New + → Blueprint → select this repository**.

### Local WebSocket URL

```
ws://localhost:3000        (or the PORT you configured)
```

## Local development flow

```bash
npm install
npm run dev
```

Then:

- Health: `http://localhost:3000/health`
- WebSocket: `ws://localhost:3000`

Recommended verification sequence (also covered by `npm test` and
`npm run smoke`):

1. WebSocket connection -> `welcome`
2. `identify` -> `identified`
3. `ping` -> `pong`
4. `find_match` x2 -> `match_found` + `room_joined` + `game_state`
5. `player_input` / `turret_input` / `power_allocation` / `fire_weapon`
6. Disconnect -> room destroyed, opponent notified, player cleaned up
7. Heartbeat -> idle/dead connections are closed and removed

## Known limitations (this milestone)

- Player IDs and connection IDs are temporary UUIDs; no authentication yet.
- Matchmaking is a FIFO queue; no level/region/rating rules yet.
- Roles are assigned deterministically (first queued = attacker).
- Movement is a minimal, non-physical integration (no aircraft physics).
- `fire_weapon` is attacker-only in this milestone.
- Combat (`damage`, rewards, match results) is not implemented yet - the
  server-authoritative pipeline is in place and ready for it.
- Rooms, players and the matchmaking queue are in-memory only; they do not
  survive a restart.

## Future compatibility

The architecture is designed so the following can be added without rewiring the
networking layer: authentication, PostgreSQL persistence, player accounts,
persistent bases, base levels, upgrades, materials, match history, leaderboards,
anti-cheat, reconnection (`reconnecting` state already exists), spectators and
additional game modes.

   |  find_match {}  -------------->|
   |  <-- match_searching           |
   |                                |   find_match {}  --------------->|
   |                                |   <-- match_searching            |
   |  <-- match_found { role: "attacker" } |
   |  <-- room_joined { opponent }  |   <-- match_found { role: "defender" } |
   |  <-- game_state (20 Hz)        |   <-- room_joined { opponent }   |
   |  <-- game_state (20 Hz)        |   <-- game_state (20 Hz)         |
```

## Server authority

Clients only send *actions*. The server validates them and computes the result:

- Damage, enemy health, ammo consumption, missile damage, resource rewards and
  match results are never decided by the client.
- `power_allocation` is rejected if the total exceeds available power.
- Weapon fire is validated against role, ammo and cooldown before a
  `weapon_fired` is broadcast and ammo is decremented server-side.
- Role spoofing is blocked: only the attacker can send `player_input` /
  `fire_weapon`; only the defender can send `turret_input` / `power_allocation`.
- Malformed JSON, unknown types and out-of-range numbers are rejected with
  structured `error` messages.

## Testing

Automated tests use Node's built-in test runner (no extra framework):

```bash
npm test
```

Covered: message parsing, power allocation validation, player creation, room
creation, matchmaking, invalid messages, heartbeat timeout/cleanup, and a full
end-to-end WebSocket flow (health, welcome, identify, ping/pong, matchmaking,
room, inputs, firing, disconnect cleanup).

Manual smoke test against the production build:

```bash
npm run build && npm run smoke
```

See [`.env.example`](.env.example). All variables are optional; defaults are
sane for local development.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP + WebSocket port |
| `HOST` | `0.0.0.0` | Bind address (must stay `0.0.0.0` for Render) |
| `NODE_ENV` | `development` | Runtime environment |
| `HEARTBEAT_INTERVAL_MS` | `15000` | Interval between server pings |
| `HEARTBEAT_TIMEOUT_MS` | `45000` | Inactivity limit before disconnecting |
| `TICK_RATE` | `20` | Authoritative simulation / broadcast rate (Hz) |
| `GAME_TIME_LIMIT_SECONDS` | `300` | Battle length before the room ends |
| `MAX_POWER` | `100` | Total defender energy for power allocation |
| `MAX_POWER_PER_SYSTEM` | `100` | Max power for a single system |
| `WEAPON_COOLDOWN_MS` | `200` | Minimum time between shots |
| `MAX_PLAYER_SPEED` | `10` | Aircraft speed used by the minimal movement sim |
