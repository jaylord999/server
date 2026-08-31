import http from 'http';
import { randomUUID } from 'crypto';
import { WebSocketServer } from 'ws';
import 'dotenv/config';

import { loadConfig, ServerConfig } from './game/GameConfig';
import { ConnectionManager } from './network/ConnectionManager';
import { HeartbeatManager } from './network/HeartbeatManager';
import { MessageRouter } from './network/MessageRouter';
import { PlayerManager } from './players/PlayerManager';
import { GameRoom } from './rooms/GameRoom';
import { RoomManager } from './rooms/RoomManager';
import { MatchmakingQueue } from './matchmaking/MatchmakingQueue';
import { ClientMessageType, ErrorCode, ServerMessageType } from './protocol/MessageTypes';
import {
  validateIdentifyData,
  validatePingData,
  validateFindMatchData,
  validatePlayerInputData,
  validateTurretInputData,
  validateFireWeaponData,
  validatePowerAllocationData,
} from './protocol/ClientMessages';
import { createServerMessage } from './protocol/ServerMessages';
import { log } from './utils/logger';

export interface ServerHandle {
  port: number;
  httpServer: http.Server;
  wsServer: WebSocketServer;
  connectionManager: ConnectionManager;
  playerManager: PlayerManager;
  roomManager: RoomManager;
  matchmaking: MatchmakingQueue;
  heartbeatManager: HeartbeatManager;
  router: MessageRouter;
  config: ServerConfig;
  stop(): Promise<void>;
}

/**
 * Boots the DefenderServer: shared HTTP service (health endpoints + WebSocket),
 * connection lifecycle, heartbeat, authoritative game loop and message routing.
 */
export async function startServer(config: ServerConfig = loadConfig()): Promise<ServerHandle> {
  const connectionManager = new ConnectionManager();
  const playerManager = new PlayerManager();
  const roomManager = new RoomManager();
  const matchmaking = new MatchmakingQueue();
  const router = new MessageRouter(connectionManager);

  const httpServer = http.createServer();
  httpServer.on('request', (req, res) => handleHttpRequest(req, res));

  const wsServer = new WebSocketServer({ server: httpServer, path: '/' });

  // --- shared helpers ---------------------------------------------------

  function sendError(connectionId: string, code: string, message: string, requestId?: string): void {
    connectionManager.send(
      connectionId,
      createServerMessage(ServerMessageType.ERROR, { code, message }, requestId),
    );
  }

  function broadcastGameState(room: GameRoom): void {
    const snapshot = room.state.toSnapshot();
    const message = createServerMessage(ServerMessageType.GAME_STATE, { snapshot });
    connectionManager.sendToPlayer(room.attackerPlayerId, message);
    connectionManager.sendToPlayer(room.defenderPlayerId, message);
  }

  /** Idempotent teardown for a connection (close, error or heartbeat timeout). */
  function cleanupConnection(connectionId: string): void {
    const connection = connectionManager.get(connectionId);
    if (!connection) {
      return;
    }

    const playerId = connection.playerId;
    if (playerId) {
      matchmaking.remove(playerId);

      const player = playerManager.getById(playerId);
      if (player?.roomId) {
        const room = roomManager.getRoom(player.roomId);
        if (room) {
          roomManager.removeRoom(room.roomId);
          log('ROOM', `Room ${room.roomId} destroyed (player ${playerId} left)`);

          const opponentId = room.getOtherPlayer(playerId);
          if (opponentId) {
            const opponent = playerManager.getById(opponentId);
            if (opponent) {
              playerManager.setRoom(opponentId, null);
              playerManager.setState(opponentId, 'identified');
              connectionManager.sendToPlayer(
                opponentId,
                createServerMessage(ServerMessageType.ROOM_LEFT, {
                  roomId: room.roomId,
                  reason: 'opponent_disconnected',
                }),
              );
            }
          }
        }
      }

      playerManager.remove(playerId);
    }

    connectionManager.remove(connectionId);
  }

  // --- connection lifecycle --------------------------------------------

  wsServer.on('connection', (socket) => {
    const connection = connectionManager.add(socket);
    heartbeatManager.track(connection);
    log('NETWORK', `Client connected (connection=${connection.id})`);

    socket.on('message', (data) => {
      router.handleRawMessage(connection.id, data.toString());
    });

    socket.on('error', (error) => {
      log('ERROR', `Connection ${connection.id} error: ${error.message}`);
    });

    socket.on('close', () => {
      const playerId = connectionManager.get(connection.id)?.playerId;
      cleanupConnection(connection.id);
      if (playerId) {
        log('NETWORK', `Player disconnected (player=${playerId})`);
      } else {
        log('NETWORK', `Client disconnected (connection=${connection.id})`);
      }
    });

    connectionManager.send(
      connection.id,
      createServerMessage(ServerMessageType.WELCOME, {
        connectionId: connection.id,
        protocolVersion: config.protocolVersion,
      }),
    );
  });

  // --- heartbeat --------------------------------------------------------

  const heartbeatManager = new HeartbeatManager(
    connectionManager,
    config.heartbeatIntervalMs,
    config.heartbeatTimeoutMs,
    (connectionId) => {
      const connection = connectionManager.get(connectionId);
      if (!connection) {
        return;
      }
      log('NETWORK', `Heartbeat timeout, closing connection ${connectionId}`);
      connection.socket.terminate();
      cleanupConnection(connectionId);
    },
  );
  heartbeatManager.start();

  // --- message handlers ---------------------------------------------------

  router.register(ClientMessageType.IDENTIFY, (connectionId, message) => {
    const connection = connectionManager.get(connectionId);
    if (!connection) {
      return;
    }
    if (connection.playerId) {
      sendError(connectionId, ErrorCode.ALREADY_IDENTIFIED, 'This connection has already been identified.', message.requestId);
      return;
    }
    const parsed = validateIdentifyData(message.data);
    if (!parsed.ok) {
      sendError(connectionId, ErrorCode.INVALID_MESSAGE, parsed.reason, message.requestId);
      return;
    }
    const player = playerManager.createPlayer(connectionId);
    playerManager.setClientVersion(player.playerId, parsed.value.clientVersion);
    connectionManager.bindPlayer(connectionId, player.playerId);
    log('NETWORK', `Player identified (player=${player.playerId}, clientVersion=${parsed.value.clientVersion})`);
    connectionManager.send(
      connectionId,
      createServerMessage(ServerMessageType.IDENTIFIED, { playerId: player.playerId }, message.requestId),
    );
  });

  router.register(ClientMessageType.PING, (connectionId, message) => {
    const parsed = validatePingData(message.data);
    if (!parsed.ok) {
      sendError(connectionId, ErrorCode.INVALID_MESSAGE, parsed.reason, message.requestId);
      return;
    }
    connectionManager.send(
      connectionId,
      createServerMessage(ServerMessageType.PONG, { serverTime: Date.now(), echo: parsed.value }, message.requestId),
    );
  });

  router.register(ClientMessageType.FIND_MATCH, (connectionId, message) => {
    const parsed = validateFindMatchData(message.data);
    if (!parsed.ok) {
      sendError(connectionId, ErrorCode.INVALID_MESSAGE, parsed.reason, message.requestId);
      return;
    }
    const player = playerManager.getByConnectionId(connectionId);
    if (!player) {
      sendError(connectionId, ErrorCode.NOT_IDENTIFIED, 'Identify before finding a match.', message.requestId);
      return;
    }
    if (player.roomId) {
      sendError(connectionId, ErrorCode.ALREADY_IN_ROOM, 'You are already in a room.', message.requestId);
      return;
    }
    if (matchmaking.isWaiting(player.playerId)) {
      sendError(connectionId, ErrorCode.ALREADY_IN_QUEUE, 'You are already in the matchmaking queue.', message.requestId);
      return;
    }
    if (!matchmaking.enqueue(player.playerId)) {
      sendError(connectionId, ErrorCode.ALREADY_IN_QUEUE, 'Could not join the matchmaking queue.', message.requestId);
      return;
    }
    playerManager.setState(player.playerId, 'in_queue');
    log('MATCHMAKING', `Player entered queue (player=${player.playerId})`);
    connectionManager.send(
      connectionId,
      createServerMessage(ServerMessageType.MATCH_SEARCHING, { position: matchmaking.size() }, message.requestId),
    );
    tryCreateMatch();
  });

  router.register(ClientMessageType.CANCEL_MATCH, (connectionId, message) => {
    const player = playerManager.getByConnectionId(connectionId);
    if (!player) {
      sendError(connectionId, ErrorCode.NOT_IDENTIFIED, 'Identify before cancelling matchmaking.', message.requestId);
      return;
    }
    if (!matchmaking.remove(player.playerId)) {
      sendError(connectionId, ErrorCode.NOT_IN_QUEUE, 'You are not in the matchmaking queue.', message.requestId);
      return;
    }
    playerManager.setState(player.playerId, 'identified');
    log('MATCHMAKING', `Player left queue (player=${player.playerId})`);
    connectionManager.send(
      connectionId,
      createServerMessage(
        ServerMessageType.SERVER_MESSAGE,
        { code: 'MATCHMAKING_CANCELLED', message: 'Left the matchmaking queue.' },
        message.requestId,
      ),
    );
  });

  router.register(ClientMessageType.LEAVE_ROOM, (connectionId, message) => {
    const player = playerManager.getByConnectionId(connectionId);
    if (!player) {
      sendError(connectionId, ErrorCode.NOT_IDENTIFIED, 'Identify before leaving a room.', message.requestId);
      return;
    }
    if (!player.roomId) {
      sendError(connectionId, ErrorCode.NOT_IN_ROOM, 'You are not in a room.', message.requestId);
      return;
    }
    const roomId = player.roomId;
    const room = roomManager.getRoom(roomId);
    const opponentId = room ? room.getOtherPlayer(player.playerId) : null;
    if (room) {
      roomManager.removeRoom(roomId);
    }
    playerManager.setRoom(player.playerId, null);
    playerManager.setState(player.playerId, 'identified');
    log('ROOM', `Room ${roomId} destroyed (player ${player.playerId} left)`);
    connectionManager.send(
      connectionId,
      createServerMessage(ServerMessageType.ROOM_LEFT, { roomId, reason: 'player_left' }, message.requestId),
    );
    if (opponentId) {
      const opponent = playerManager.getById(opponentId);
      if (opponent) {
        playerManager.setRoom(opponentId, null);
        playerManager.setState(opponentId, 'identified');
        connectionManager.sendToPlayer(
          opponentId,
          createServerMessage(ServerMessageType.ROOM_LEFT, { roomId, reason: 'opponent_left' }),
        );
      }
    }
  });



  router.register(ClientMessageType.PLAYER_INPUT, (connectionId, message) => {
    const player = playerManager.getByConnectionId(connectionId);
    const room = player?.roomId ? roomManager.getRoom(player.roomId) : undefined;
    if (!player || !room) {
      sendError(connectionId, ErrorCode.NOT_IN_ROOM, 'You must be in a room to send player_input.', message.requestId);
      return;
    }
    if (room.getRole(player.playerId) !== 'attacker') {
      sendError(connectionId, ErrorCode.INVALID_INPUT, 'Only the attacker can send player_input.', message.requestId);
      return;
    }
    const parsed = validatePlayerInputData(message.data);
    if (!parsed.ok) {
      sendError(connectionId, ErrorCode.INVALID_INPUT, parsed.reason, message.requestId);
      return;
    }
    room.state.attackerInput = { ...parsed.value, receivedAt: Date.now() };
  });

  router.register(ClientMessageType.TURRET_INPUT, (connectionId, message) => {
    const player = playerManager.getByConnectionId(connectionId);
    const room = player?.roomId ? roomManager.getRoom(player.roomId) : undefined;
    if (!player || !room) {
      sendError(connectionId, ErrorCode.NOT_IN_ROOM, 'You must be in a room to send turret_input.', message.requestId);
      return;
    }
    if (room.getRole(player.playerId) !== 'defender') {
      sendError(connectionId, ErrorCode.INVALID_INPUT, 'Only the defender can send turret_input.', message.requestId);
      return;
    }
    const parsed = validateTurretInputData(message.data);
    if (!parsed.ok) {
      sendError(connectionId, ErrorCode.INVALID_INPUT, parsed.reason, message.requestId);
      return;
    }
    const turret = room.state.defender;
    turret.turretRotation = parsed.value.rotation;
    turret.barrelAngle = parsed.value.barrel;

    const turretState = createServerMessage(ServerMessageType.TURRET_STATE, {
      rotation: turret.turretRotation,
      barrel: turret.barrelAngle,
      heat: turret.turretHeat,
    });
    connectionManager.sendToPlayer(room.attackerPlayerId, turretState);
    connectionManager.sendToPlayer(room.defenderPlayerId, turretState);
  });


  router.register(ClientMessageType.FIRE_WEAPON, (connectionId, message) => {
    const player = playerManager.getByConnectionId(connectionId);
    const room = player?.roomId ? roomManager.getRoom(player.roomId) : undefined;
    if (!player || !room) {
      sendError(connectionId, ErrorCode.NOT_IN_ROOM, 'You must be in a room to fire weapons.', message.requestId);
      return;
    }
    const parsed = validateFireWeaponData(message.data);
    if (!parsed.ok) {
      sendError(connectionId, ErrorCode.INVALID_INPUT, parsed.reason, message.requestId);
      return;
    }
    const weapon = parsed.value.weapon;
    const state = room.state;
    const attacker = state.attacker;
    const now = Date.now();
    const role = room.getRole(player.playerId);

    // Server-authoritative checks: role, ammo, cooldown.
    if (role !== 'attacker') {
      sendError(connectionId, ErrorCode.INVALID_INPUT, 'Only the attacker can fire weapons in this milestone.', message.requestId);
      return;
    }
    if (weapon === 'bullet') {
      if (attacker.ammo <= 0) {
        sendError(connectionId, ErrorCode.WEAPON_UNAVAILABLE, 'No ammo available.', message.requestId);
        return;
      }
      if (now - state.lastBulletFiredAt < config.weaponCooldownMs) {
        sendError(connectionId, ErrorCode.WEAPON_UNAVAILABLE, 'Weapon is on cooldown.', message.requestId);
        return;
      }
      state.lastBulletFiredAt = now;
      attacker.ammo -= 1;
    } else if (weapon === 'missile') {
      if (attacker.missiles <= 0) {
        sendError(connectionId, ErrorCode.WEAPON_UNAVAILABLE, 'No missiles available.', message.requestId);
        return;
      }
      if (now - state.lastMissileFiredAt < config.weaponCooldownMs * 3) {
        sendError(connectionId, ErrorCode.WEAPON_UNAVAILABLE, 'Missile launcher is on cooldown.', message.requestId);
        return;
      }
      state.lastMissileFiredAt = now;
      attacker.missiles -= 1;
    }

    const fired = createServerMessage(ServerMessageType.WEAPON_FIRED, {
      roomId: room.roomId,
      playerId: player.playerId,
      weapon,
      projectileId: randomUUID(),
    });
    connectionManager.sendToPlayer(room.attackerPlayerId, fired);
    connectionManager.sendToPlayer(room.defenderPlayerId, fired);

    const resources = createServerMessage(ServerMessageType.RESOURCE_UPDATE, {
      ammo: attacker.ammo,
      missiles: attacker.missiles,
      materials: state.materials,
    });
    connectionManager.sendToPlayer(room.attackerPlayerId, resources);
    connectionManager.sendToPlayer(room.defenderPlayerId, resources);
  });

  router.register(ClientMessageType.POWER_ALLOCATION, (connectionId, message) => {
    const player = playerManager.getByConnectionId(connectionId);
    const room = player?.roomId ? roomManager.getRoom(player.roomId) : undefined;
    if (!player || !room) {
      sendError(connectionId, ErrorCode.NOT_IN_ROOM, 'You must be in a room to allocate power.', message.requestId);
      return;
    }
    if (room.getRole(player.playerId) !== 'defender') {
      sendError(connectionId, ErrorCode.INVALID_INPUT, 'Only the defender can allocate power.', message.requestId);
      return;
    }
    const parsed = validatePowerAllocationData(message.data, config.maxPower, config.maxPowerPerSystem);
    if (!parsed.ok) {
      sendError(connectionId, ErrorCode.INVALID_POWER_ALLOCATION, parsed.reason, message.requestId);
      return;
    }
    room.state.powerAllocation = parsed.value;
    log('GAME', `Power allocation updated (room=${room.roomId}, total=${room.state.powerTotal})`);
    const powerUpdate = createServerMessage(ServerMessageType.POWER_UPDATE, {
      allocation: { ...room.state.powerAllocation },
      total: room.state.powerTotal,
      available: config.maxPower,
    });
    connectionManager.sendToPlayer(room.attackerPlayerId, powerUpdate);
    connectionManager.sendToPlayer(room.defenderPlayerId, powerUpdate);
  });

  // --- matchmaking ---------------------------------------------------------

  function tryCreateMatch(): void {
    const pair = matchmaking.pollMatch();
    if (!pair) {
      return;
    }

    const room = roomManager.createRoom(pair.attackerPlayerId, pair.defenderPlayerId, {
      maxPower: config.maxPower,
      gameTimeLimitSeconds: config.gameTimeLimitSeconds,
      maxPlayerSpeed: config.maxPlayerSpeed,
    });

    playerManager.setRoom(pair.attackerPlayerId, room.roomId);
    playerManager.setState(pair.attackerPlayerId, 'in_room');
    playerManager.setRoom(pair.defenderPlayerId, room.roomId);
    playerManager.setState(pair.defenderPlayerId, 'in_room');
    room.start();

    log('MATCHMAKING', `Match created (room=${room.roomId})`);
    log('ROOM', `Room ${room.roomId} created`);
    log('ROOM', `Attacker joined (player=${pair.attackerPlayerId})`);
    log('ROOM', `Defender joined (player=${pair.defenderPlayerId})`);

    const attackerConnectionId = playerManager.getById(pair.attackerPlayerId)?.connectionId;
    const defenderConnectionId = playerManager.getById(pair.defenderPlayerId)?.connectionId;

    if (attackerConnectionId) {
      connectionManager.send(attackerConnectionId, createServerMessage(ServerMessageType.MATCH_FOUND, { roomId: room.roomId, role: 'attacker' }));
    }
    if (defenderConnectionId) {
      connectionManager.send(defenderConnectionId, createServerMessage(ServerMessageType.MATCH_FOUND, { roomId: room.roomId, role: 'defender' }));
    }

    if (attackerConnectionId) {
      connectionManager.send(attackerConnectionId, createServerMessage(ServerMessageType.ROOM_JOINED, {
        roomId: room.roomId,
        role: 'attacker',
        opponentPlayerId: pair.defenderPlayerId,
        gameStarted: true,
      }));
    }
    if (defenderConnectionId) {
      connectionManager.send(defenderConnectionId, createServerMessage(ServerMessageType.ROOM_JOINED, {
        roomId: room.roomId,
        role: 'defender',
        opponentPlayerId: pair.attackerPlayerId,
        gameStarted: true,
      }));
    }

    broadcastGameState(room);
  }

  // --- authoritative game loop --------------------------------------------

  function endRoom(room: GameRoom, reason: 'time_limit'): void {
    roomManager.removeRoom(room.roomId);
    for (const playerId of [room.attackerPlayerId, room.defenderPlayerId]) {
      const player = playerManager.getById(playerId);
      if (player) {
        playerManager.setRoom(playerId, null);
        playerManager.setState(playerId, 'identified');
        connectionManager.sendToPlayer(
          playerId,
          createServerMessage(ServerMessageType.ROOM_LEFT, { roomId: room.roomId, reason }),
        );
      }
    }
    log('ROOM', `Room ${room.roomId} ended (${reason})`);
  }

  const tickTimer = setInterval(() => {
    const now = Date.now();
    for (const room of roomManager.listRooms()) {
      const dt = Math.min((now - room.lastTickAt) / 1000, 0.1);
      room.lastTickAt = now;
      room.state.update(dt);
      if (room.state.finished) {
        endRoom(room, 'time_limit');
        continue;
      }
      if (room.state.gameStarted) {
        broadcastGameState(room);
      }
    }
  }, config.tickIntervalMs);



  // --- listen / stop --------------------------------------------------------

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, () => resolve());
  });

  const address = httpServer.address();
  const port = typeof address === 'object' && address !== null ? address.port : config.port;

  const stop = async (): Promise<void> => {
    heartbeatManager.stop();
    clearInterval(tickTimer);
    for (const connection of connectionManager.list()) {
      connection.socket.terminate();
    }
    await new Promise<void>((resolve) => wsServer.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  return {
    port,
    httpServer,
    wsServer,
    connectionManager,
    playerManager,
    roomManager,
    matchmaking,
    heartbeatManager,
    router,
    config,
    stop,
  };
}

// --- HTTP health endpoints -------------------------------------------------

function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url ?? '/';
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', code: 'METHOD_NOT_ALLOWED' }));
    return;
  }
  if (url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'online', service: 'DefenderServer' }));
    return;
  }
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy' }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'error', code: 'NOT_FOUND' }));
}

// --- entrypoint -------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadConfig();
  const handle = await startServer(config);
  log('SERVER', `DefenderServer started on ${config.host}:${handle.port} (${config.nodeEnv})`);

  const shutdown = (): void => {
    log('SERVER', 'Shutting down...');
    handle.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    log('ERROR', `Failed to start server: ${message}`);
    process.exit(1);
  });
}
