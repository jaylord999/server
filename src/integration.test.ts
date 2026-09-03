import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

import { loadConfig } from './game/GameConfig';
import { startServer } from './main';

/**
 * End-to-end test: boots a real DefenderServer on an ephemeral port and drives
 * it with real WebSocket clients - the equivalent of the manual WS test.
 */

interface TestClient {
  socket: WebSocket;
  send(obj: unknown): void;
  waitFor(pred: (msg: any) => boolean, timeoutMs?: number): Promise<any>;
  close(): Promise<void>;
}

function createClient(url: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const queued: any[] = [];
    const waiters: Array<{
      pred: (msg: any) => boolean;
      resolve: (msg: any) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }> = [];

    const settleWaiters = (err: Error) => {
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(err);
      }
    };

    socket.on('message', (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      const index = waiters.findIndex((w) => w.pred(msg));
      if (index !== -1) {
        const waiter = waiters.splice(index, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
        return;
      }
      queued.push(msg);
    });

    socket.on('error', (err) => {
      reject(err);
      settleWaiters(err);
    });

    socket.on('close', () => {
      settleWaiters(new Error('Socket closed before the expected message arrived.'));
    });

    socket.on('open', () => {
      resolve({
        socket,
        send: (obj) => socket.send(typeof obj === 'string' ? obj : JSON.stringify(obj)),
        waitFor: (pred, timeoutMs = 4000) => {
          const hit = queued.findIndex(pred);
          if (hit !== -1) {
            return Promise.resolve(queued.splice(hit, 1)[0]);
          }
          return new Promise((resolveMsg, rejectMsg) => {
            const waiter = {
              pred,
              resolve: resolveMsg,
              reject: rejectMsg,
              timer: setTimeout(() => {
                const i = waiters.indexOf(waiter);
                if (i !== -1) {
                  waiters.splice(i, 1);
                }
                rejectMsg(new Error('Timed out waiting for a message.'));
              }, timeoutMs),
            };
            waiters.push(waiter);
          });
        },
        close: () =>
          new Promise<void>((resolveClose) => {
            if (socket.readyState === WebSocket.CLOSED) {
              resolveClose();
              return;
            }
            socket.once('close', () => resolveClose());
            socket.close();
          }),
      });
    });
  });
}

test('end-to-end: health, welcome, identify, matchmaking, room, inputs, cleanup', async () => {
  const handle = await startServer(
    loadConfig({
      PORT: '0',
      HEARTBEAT_INTERVAL_MS: '10000',
      HEARTBEAT_TIMEOUT_MS: '30000',
      TICK_RATE: '20',
    }),
  );

  const base = `http://127.0.0.1:${handle.port}`;
  const wsUrl = `ws://127.0.0.1:${handle.port}`;

  try {
    // --- HTTP endpoints -------------------------------------------------
    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    assert.deepEqual(await root.json(), { status: 'online', service: 'DefenderServer' });

    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'healthy' });

    const notFound = await fetch(`${base}/nope`);
    assert.equal(notFound.status, 404);

    // --- connection lifecycle: A connects + identifies (only A online) ------
    const a = await createClient(wsUrl);
    const welcomeA = await a.waitFor((m) => m.type === 'welcome');
    assert.equal(welcomeA.data.protocolVersion, 1);
    assert.ok(welcomeA.data.connectionId);

    a.send({ type: 'identify', requestId: 'id-a', data: { clientVersion: '0.1.0' } });
    const identifiedA = await a.waitFor((m) => m.type === 'identified');
    assert.equal(identifiedA.requestId, 'id-a');
    const playerA = identifiedA.data.playerId;

    // --- security: unidentified client is rejected ------------------------
    const c = await createClient(wsUrl);
    await c.waitFor((m) => m.type === 'welcome');
    c.send({ type: 'find_match', data: {} });
    const notIdentified = await c.waitFor((m) => m.type === 'error');
    assert.equal(notIdentified.data.code, 'NOT_IDENTIFIED');
    await c.close();

    // --- matchmaking TEST 2: no available defender yet ----------------------
    // A is the only player, so find_match must NOT fabricate an opponent.
    a.send({ type: 'find_match', data: {} });
    const searchingA = await a.waitFor((m) => m.type === 'match_searching');
    assert.equal(searchingA.data.position, 1);

    // Invalid JSON -> structured INVALID_MESSAGE error
    a.send('{bad json');
    const invalidErr = await a.waitFor((m) => m.type === 'error');
    assert.equal(invalidErr.data.code, 'INVALID_MESSAGE');

    // Unknown type -> structured UNKNOWN_MESSAGE error
    a.send({ type: 'teleport', data: {} });
    const unknownErr = await a.waitFor((m) => m.type === 'error' && m.data.code === 'UNKNOWN_MESSAGE');
    assert.equal(unknownErr.data.code, 'UNKNOWN_MESSAGE');

    // --- matchmaking TEST 1: B arrives AVAILABLE (no FIND ENEMY) -------------
    // A defender appears: B connects and identifies. The server should match the
    // waiting attacker A against the newly AVAILABLE player B WITHOUT B pressing
    // find_match. A = ATTACKER, B = DEFENDER.
    const b = await createClient(wsUrl);
    await b.waitFor((m) => m.type === 'welcome');
    b.send({ type: 'identify', data: { clientVersion: '0.1.0' } });
    const identifiedB = await b.waitFor((m) => m.type === 'identified');
    const playerB = identifiedB.data.playerId;

    const matchA = await a.waitFor((m) => m.type === 'match_found');
    const matchB = await b.waitFor((m) => m.type === 'match_found');
    assert.equal(matchA.data.role, 'attacker');
    assert.equal(matchB.data.role, 'defender');
    assert.equal(matchA.data.roomId, matchB.data.roomId);
    const roomId = matchA.data.roomId;

    const joinedA = await a.waitFor((m) => m.type === 'room_joined');
    const joinedB = await b.waitFor((m) => m.type === 'room_joined');
    assert.equal(joinedA.data.roomId, roomId);
    assert.equal(joinedA.data.opponentPlayerId, playerB);
    assert.equal(joinedB.data.opponentPlayerId, playerA);

    const initialA = await a.waitFor((m) => m.type === 'game_state');
    assert.equal(initialA.data.snapshot.roomId, roomId);
    assert.equal(initialA.data.snapshot.gameStarted, true);

    // --- ping / pong --------------------------------------------------------
    a.send({ type: 'ping', requestId: 'ping-1', data: { nonce: 'n1' } });
    const pong = await a.waitFor((m) => m.type === 'pong');
    assert.equal(pong.requestId, 'ping-1');
    assert.equal(pong.data.echo.nonce, 'n1');
    assert.ok(typeof pong.data.serverTime === 'number');
  } finally {
    await handle.stop();
  }
});

test('end-to-end: power, turret, movement, firing and disconnect cleanup', async () => {
  const handle = await startServer(
    loadConfig({
      PORT: '0',
      HEARTBEAT_INTERVAL_MS: '10000',
      HEARTBEAT_TIMEOUT_MS: '30000',
      TICK_RATE: '20',
    }),
  );

  const wsUrl = `ws://127.0.0.1:${handle.port}`;

  try {
    const a = await createClient(wsUrl);
    await a.waitFor((m) => m.type === 'welcome');
    a.send({ type: 'identify', data: { clientVersion: '0.1.0' } });
    await a.waitFor((m) => m.type === 'identified');

    const b = await createClient(wsUrl);
    await b.waitFor((m) => m.type === 'welcome');
    b.send({ type: 'identify', data: { clientVersion: '0.1.0' } });
    await b.waitFor((m) => m.type === 'identified');

    // Only the attacker (A) presses FIND ENEMY; the server matches the already
    // AVAILABLE player B as the defender automatically (B never presses FIND ENEMY).
    a.send({ type: 'find_match', data: {} });
    const matchA = await a.waitFor((m) => m.type === 'match_found');
    const matchB = await b.waitFor((m) => m.type === 'match_found');
    assert.equal(matchA.data.role, 'attacker');
    assert.equal(matchB.data.role, 'defender');
    assert.equal(matchA.data.roomId, matchB.data.roomId);
    const roomId = matchB.data.roomId;

    // --- power allocation (server-authoritative) ----------------------------
    // Attacker is not allowed to allocate power.
    a.send({ type: 'power_allocation', data: { turret: 30, shield: 25, bullets: 20, missiles: 15, materials: 10 } });
    const roleErr = await a.waitFor((m) => m.type === 'error');
    assert.equal(roleErr.data.code, 'INVALID_INPUT');

    // Defender over budget -> machine-readable INVALID_POWER_ALLOCATION.
    b.send({ type: 'power_allocation', data: { turret: 60, shield: 60, bullets: 0, missiles: 0, materials: 0 } });
    const overBudget = await b.waitFor((m) => m.type === 'error');
    assert.equal(overBudget.data.code, 'INVALID_POWER_ALLOCATION');

    // Valid allocation -> power_update broadcast.
    b.send({ type: 'power_allocation', data: { turret: 30, shield: 25, bullets: 20, missiles: 15, materials: 10 } });
    const powerUpdate = await a.waitFor((m) => m.type === 'power_update');
    assert.equal(powerUpdate.data.total, 100);
    assert.equal(powerUpdate.data.allocation.turret, 30);

    // --- turret input (defender only) ---------------------------------------
    a.send({ type: 'turret_input', data: { rotation: 10, barrel: 5 } });
    const turretRoleErr = await a.waitFor((m) => m.type === 'error');
    assert.equal(turretRoleErr.data.code, 'INVALID_INPUT');

    b.send({ type: 'turret_input', data: { rotation: 143.2, barrel: 7.4 } });
    const turretState = await b.waitFor((m) => m.type === 'turret_state');
    assert.equal(turretState.data.rotation, 143.2);
    assert.equal(turretState.data.barrel, 7.4);

    // --- player input (attacker only) + simulated movement --------------------
    b.send({ type: 'player_input', data: { throttle: 1, pitch: 0, yaw: 0 } });
    const playerRoleErr = await b.waitFor((m) => m.type === 'error');
    assert.equal(playerRoleErr.data.code, 'INVALID_INPUT');

    a.send({ type: 'player_input', data: { throttle: 1, pitch: 0, yaw: 0 } });
    await a.waitFor((m) => m.type === 'game_state' && m.data.snapshot.attacker.aircraftPosition.z > -180, 3000);

    // --- firing: ammo consumed server-side, cooldown enforced ------------------
    a.send({ type: 'fire_weapon', data: { weapon: 'bullet' } });
    const fired = await a.waitFor((m) => m.type === 'weapon_fired');
    assert.equal(fired.data.weapon, 'bullet');
    assert.ok(fired.data.projectileId);
    const resources = await a.waitFor((m) => m.type === 'resource_update');
    assert.equal(resources.data.ammo, 119);

    a.send({ type: 'fire_weapon', data: { weapon: 'bullet' } });
    const cooldownErr = await a.waitFor((m) => m.type === 'error');
    assert.equal(cooldownErr.data.code, 'WEAPON_UNAVAILABLE');

    b.send({ type: 'fire_weapon', data: { weapon: 'bullet' } });
    const defenderFired = await b.waitFor((m) => m.type === 'weapon_fired' && m.data.shooterRole === 'defender');
    assert.equal(defenderFired.data.shooterRole, 'defender');

    // --- room state on the server ---------------------------------------------
    assert.ok(handle.roomManager.getRoom(roomId));
    assert.equal(handle.roomManager.size(), 1);

    // --- disconnect cleanup -----------------------------------------------------
    await a.close();
    const roomLeft = await b.waitFor((m) => m.type === 'room_left', 3000);
    assert.equal(roomLeft.data.roomId, roomId);
    assert.equal(roomLeft.data.reason, 'opponent_disconnected');

    await new Promise((r) => setTimeout(r, 150));
    assert.equal(handle.roomManager.size(), 0);
    assert.equal(handle.playerManager.size(), 1);

    await b.close();
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(handle.playerManager.size(), 0);
    assert.equal(handle.connectionManager.size(), 0);
  } finally {
    await handle.stop();
  }
});

test('real two-client battle: both sides damage each other and the winner is broadcast', async () => {
  process.env.BATTLE_RESULT_HOLD_MS = '600';
  const handle = await startServer(
    loadConfig({
      PORT: '0',
      HEARTBEAT_INTERVAL_MS: '10000',
      HEARTBEAT_TIMEOUT_MS: '30000',
      TICK_RATE: '20',
    }),
  );
  const wsUrl = `ws://127.0.0.1:${handle.port}`;

  try {
    const a = await createClient(wsUrl); // attacker (searching)
    const b = await createClient(wsUrl); // defender (available target)

    await a.waitFor((m) => m.type === 'welcome');
    await b.waitFor((m) => m.type === 'welcome');

    a.send({ type: 'identify', data: { clientVersion: 'test' } });
    b.send({ type: 'identify', data: { clientVersion: 'test' } });
    await a.waitFor((m) => m.type === 'identified');
    await b.waitFor((m) => m.type === 'identified');

    // b is now AVAILABLE; a searches and the server matches them.
    a.send({ type: 'find_match', data: {} });
    const aJoin = await a.waitFor((m) => m.type === 'room_joined');
    const bJoin = await b.waitFor((m) => m.type === 'room_joined');
    assert.equal(aJoin.data.role, 'attacker');
    assert.equal(bJoin.data.role, 'defender');
    const roomId = aJoin.data.roomId;
    assert.equal(bJoin.data.roomId, roomId);

    // Battle is authoritative once game_state flows.
    await a.waitFor((m) => m.type === 'game_state' && m.data.snapshot.gameStarted === true);

    // Defender aims its turret at the starting attacker (rotation 0 faces -Z).
    b.send({ type: 'turret_input', data: { rotation: 0, barrel: 0 } });

    // Defender fires -> server lands a hit and broadcasts damage to BOTH.
    b.send({ type: 'fire_weapon', data: { weapon: 'bullet' } });
    const dmgA = await a.waitFor((m) => m.type === 'damage' && m.data.targetRole === 'attacker');
    const dmgB = await b.waitFor((m) => m.type === 'damage' && m.data.targetRole === 'attacker');
    assert.ok(dmgA.data.amount >= 10);
    assert.ok(dmgB.data.amount >= 10);

    // Attacker fires at the base (default heading faces the base) -> base damaged.
    a.send({ type: 'fire_weapon', data: { weapon: 'bullet' } });
    const dmgDef = await a.waitFor((m) => m.type === 'damage' && m.data.targetRole === 'defender');
    assert.ok(dmgDef.data.amount >= 10);

    // Decide the outcome through the authoritative state, then confirm the
    // battle_finished result reaches BOTH clients over the wire.
    const room = handle.roomManager.getRoom(roomId)!;
    room.state.applyDamage('attacker', 9999);
    assert.equal(room.state.winner, 'defender');

    // Wait out the defender gun cooldown so the trigger shot is accepted.
    await new Promise((r) => setTimeout(r, 500));
    b.send({ type: 'fire_weapon', data: { weapon: 'bullet' } });
    const finishA = await a.waitFor((m) => m.type === 'battle_finished', 4000);
    const finishB = await b.waitFor((m) => m.type === 'battle_finished', 4000);
    assert.equal(finishA.data.winner, 'defender');
    assert.equal(finishB.data.winner, 'defender');

    // A player leaves -> both are returned to AVAILABLE and the room is removed.
    a.send({ type: 'leave_room', data: {} });
    await a.waitFor((m) => m.type === 'room_left');
    await b.waitFor((m) => m.type === 'room_left');
    assert.equal(handle.roomManager.size(), 0);

    await a.close();
    await b.close();
    await new Promise((r) => setTimeout(r, 150));
  } finally {
    await handle.stop();
    delete process.env.BATTLE_RESULT_HOLD_MS;
  }
});

