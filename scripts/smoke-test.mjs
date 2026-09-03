#!/usr/bin/env node
/**
 * Manual smoke test for DefenderServer.
 *
 * Spawns the production build (`node dist/main.js`) on a free local port,
 * then verifies over real HTTP + WebSocket:
 *   - GET / and GET /health
 *   - welcome message on connect
 *   - identify / identified
 *   - ping / pong
 *   - two-player matchmaking + room creation
 *   - power allocation (valid + invalid)
 *   - disconnect cleanup
 *
 * Run with:  npm run build && npm run smoke
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

let failures = 0;

function check(name, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`  [${status}] ${name}${detail ? ` (${detail})` : ''}`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  return false;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const queued = [];
    const waiters = [];

    socket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      const i = waiters.findIndex((w) => w.pred(msg));
      if (i !== -1) {
        clearTimeout(waiters[i].timer);
        waiters.splice(i, 1)[0].resolve(msg);
      } else {
        queued.push(msg);
      }
    });
    socket.on('error', reject);
    socket.on('open', () =>
      resolve({
        socket,
        send: (obj) => socket.send(typeof obj === 'string' ? obj : JSON.stringify(obj)),
        waitFor: (pred, timeoutMs = 4000) => {
          const hit = queued.findIndex(pred);
          if (hit !== -1) return Promise.resolve(queued.splice(hit, 1)[0]);
          return new Promise((resolveMsg, rejectMsg) => {
            const waiter = {
              pred,
              resolve: resolveMsg,
              timer: setTimeout(() => rejectMsg(new Error('timeout')), timeoutMs),
            };
            waiters.push(waiter);
          });
        },
        close: () =>
          new Promise((res) => {
            if (socket.readyState === WebSocket.CLOSED) return res();
            socket.once('close', () => res());
            socket.close();
          }),
      }),
    );
  });
}


async function run() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}`;

  console.log(`[SMOKE] Starting DefenderServer on port ${port} ...`);
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  try {
    const healthy = await waitForHealth(baseUrl);
    check('server becomes healthy on /health', healthy);
    if (!healthy) throw new Error('server did not start');

    const root = await fetch(baseUrl + '/');
    const rootBody = await root.json();
    check('GET / returns online status', root.status === 200 && rootBody.status === 'online' && rootBody.service === 'DefenderServer');

    const healthRes = await fetch(baseUrl + '/health');
    const healthBody = await healthRes.json();
    check('GET /health returns healthy', healthRes.status === 200 && healthBody.status === 'healthy');

    // --- client A ---
    const a = await connect(wsUrl);
    const welcomeA = await a.waitFor((m) => m.type === 'welcome');
    check('client A receives welcome', welcomeA.data.protocolVersion === 1 && typeof welcomeA.data.connectionId === 'string');

    a.send({ type: 'identify', data: { clientVersion: '0.1.0' } });
    const idA = await a.waitFor((m) => m.type === 'identified');
    check('client A is identified', typeof idA.data.playerId === 'string', `player=${idA.data.playerId}`);

    a.send({ type: 'ping', data: { nonce: 'smoke' } });
    const pong = await a.waitFor((m) => m.type === 'pong');
    check('ping is answered with pong', pong.data.echo?.nonce === 'smoke' && typeof pong.data.serverTime === 'number');

    // --- client B ---
    const b = await connect(wsUrl);
    await b.waitFor((m) => m.type === 'welcome');
    b.send({ type: 'identify', data: { clientVersion: '0.1.0' } });
    await b.waitFor((m) => m.type === 'identified');

    // --- matchmaking (attacker search -> available defender) ---
    // B is already AVAILABLE (identified, ONLINE) and NEVER presses FIND ENEMY.
    a.send({ type: 'find_match', data: {} });
    const matchA = await a.waitFor((m) => m.type === 'match_found');
    const matchB = await b.waitFor((m) => m.type === 'match_found');
    check(
      'attacker matched to an already-available defender',
      matchA.data.roomId === matchB.data.roomId && matchA.data.role === 'attacker' && matchB.data.role === 'defender',
      `room=${matchA.data.roomId}`,
    );

    const stateA = await a.waitFor((m) => m.type === 'game_state');
    check('initial game_state broadcast', stateA.data.snapshot.gameStarted === true);

    // --- power allocation ---
    b.send({ type: 'power_allocation', data: { turret: 60, shield: 60, bullets: 0, missiles: 0, materials: 0 } });
    const err = await b.waitFor((m) => m.type === 'error');
    check('invalid power allocation rejected', err.data.code === 'INVALID_POWER_ALLOCATION', err.data.message);

    b.send({ type: 'power_allocation', data: { turret: 30, shield: 25, bullets: 20, missiles: 15, materials: 10 } });
    const upd = await a.waitFor((m) => m.type === 'power_update');
    check('valid power allocation accepted and broadcast', upd.data.total === 100);

    // --- turret + firing ---
    b.send({ type: 'turret_input', data: { rotation: 90, barrel: 10 } });
    await b.waitFor((m) => m.type === 'turret_state');
    a.send({ type: 'player_input', data: { throttle: 0.5, pitch: 0, yaw: 0 } });
    a.send({ type: 'fire_weapon', data: { weapon: 'bullet' } });
    await a.waitFor((m) => m.type === 'weapon_fired');
    check('turret_input, player_input and fire_weapon accepted', true);

    // --- disconnect cleanup ---
    const roomId = matchA.data.roomId;
    await a.close();
    const left = await b.waitFor((m) => m.type === 'room_left');
    check('opponent notified on disconnect cleanup', left.data.roomId === roomId && left.data.reason === 'opponent_disconnected');

    await b.close();
    await sleep(200);

    console.log('');
    if (failures === 0) {
      console.log('[SMOKE] All smoke checks passed.');
    } else {
      console.log(`[SMOKE] ${failures} check(s) failed.`);
      process.exitCode = 1;
    }
  } finally {
    child.kill('SIGTERM');
    await sleep(300);
  }
}

run().catch((err) => {
  console.error('[SMOKE] Unexpected error:', err);
  process.exitCode = 1;
});
