import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

import { loadConfig } from '../game/GameConfig';
import { startServer } from '../main';

/**
 * Server-side matchmaking scenario tests (real WebSocket clients against a real
 * in-process server). They prove the ATTACKER-SEARCH -> AVAILABLE-DEFENDER model:
 *
 *   • Only the attacker presses find_match; the defender is auto-selected.
 *   • Busy / disconnected / cancelled players are never selected.
 *   • Two attackers racing for one defender cannot both acquire it.
 *
 * TEST 1 (basic match, no defender then defender arrives) and TEST 2 (no
 * available defender) are covered by the main integration.test.ts.
 */

interface TestClient {
  socket: WebSocket;
  playerId: string;
  send(obj: unknown): void;
  waitFor(pred: (m: any) => boolean, timeoutMs?: number): Promise<any>;
  close(): Promise<void>;
}

function createClient(url: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const queued: any[] = [];
    const waiters: Array<{
      pred: (m: any) => boolean;
      resolve: (m: any) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }> = [];

    const settle = (err: Error) => {
      for (const w of waiters.splice(0)) {
        clearTimeout(w.timer);
        w.reject(err);
      }
    };

    socket.on('message', (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      const i = waiters.findIndex((w) => w.pred(msg));
      if (i !== -1) {
        const w = waiters.splice(i, 1)[0];
        clearTimeout(w.timer);
        w.resolve(msg);
        return;
      }
      queued.push(msg);
    });
    socket.on('error', (err) => {
      reject(err);
      settle(err);
    });
    socket.on('close', () => settle(new Error('Socket closed before the expected message arrived.')));

    socket.on('open', () => {
      resolve({
        socket,
        playerId: '',
        send: (o) => socket.send(typeof o === 'string' ? o : JSON.stringify(o)),
        waitFor: (pred, timeoutMs = 4000) => {
          const hit = queued.findIndex(pred);
          if (hit !== -1) {
            return Promise.resolve(queued.splice(hit, 1)[0]);
          }
          return new Promise((res, rej) => {
            const w = {
              pred,
              resolve: res,
              reject: rej,
              timer: setTimeout(() => {
                const idx = waiters.indexOf(w);
                if (idx !== -1) waiters.splice(idx, 1);
                rej(new Error('Timed out waiting for a message.'));
              }, timeoutMs),
            };
            waiters.push(w);
          });
        },
        close: () =>
          new Promise<void>((res) => {
            if (socket.readyState === WebSocket.CLOSED) {
              res();
              return;
            }
            socket.once('close', () => res());
            socket.close();
          }),
      });
    });
  });
}

async function connectAndIdentify(url: string): Promise<TestClient> {
  const c = await createClient(url);
  await c.waitFor((m) => m.type === 'welcome');
  c.send({ type: 'identify', data: { clientVersion: '0.1.0' } });
  const id = await c.waitFor((m) => m.type === 'identified');
  c.playerId = id.data.playerId;
  return c;
}

async function boot() {
  const handle = await startServer(
    loadConfig({
      PORT: '0',
      HEARTBEAT_INTERVAL_MS: '10000',
      HEARTBEAT_TIMEOUT_MS: '30000',
      TICK_RATE: '20',
    }),
  );
  return handle;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- TEST 3 ----------------------------------------------------------------

test('scenario: three AVAILABLE players - A is matched to one defender, the third stays available', async () => {
  const handle = await boot();
  const url = `ws://127.0.0.1:${handle.port}`;
  try {
    const a = await connectAndIdentify(url);
    const b = await connectAndIdentify(url);
    const c = await connectAndIdentify(url);

    a.send({ type: 'find_match', data: {} });
    const ma = await a.waitFor((m) => m.type === 'match_found');
    const mb = await b.waitFor((m) => m.type === 'match_found');

    assert.equal(ma.data.role, 'attacker');
    assert.equal(mb.data.role, 'defender');
    assert.equal(ma.data.roomId, mb.data.roomId);

    await sleep(100);
    // Exactly one room exists and it contains A and B (never C).
    assert.equal(handle.roomManager.size(), 1);
    const room = handle.roomManager.listRooms()[0];
    assert.ok(room.containsPlayer(a.playerId));
    assert.ok(room.containsPlayer(b.playerId));
    assert.ok(!room.containsPlayer(c.playerId));
  } finally {
    await handle.stop();
  }
});

// --- TEST 6 ----------------------------------------------------------------

test('scenario: cancel removes a searching attacker from the pool', async () => {
  const handle = await boot();
  const url = `ws://127.0.0.1:${handle.port}`;
  try {
    const a = await connectAndIdentify(url);
    a.send({ type: 'find_match', data: {} });
    await a.waitFor((m) => m.type === 'match_searching');
    assert.equal(handle.matchmaking.size(), 1);

    a.send({ type: 'cancel_match', data: {} });
    await a.waitFor((m) => m.type === 'server_message' && m.data.code === 'MATCHMAKING_CANCELLED');
    assert.equal(handle.matchmaking.size(), 0);

    // A later-arriving defender must NOT be matched to the cancelled player.
    const b = await connectAndIdentify(url);
    await sleep(150);
    assert.equal(handle.matchmaking.size(), 0);
    assert.equal(handle.roomManager.size(), 0);
    assert.ok(b);
  } finally {
    await handle.stop();
  }
});

// --- TEST 7 ----------------------------------------------------------------

test('scenario: a disconnected player is never selected as a defender', async () => {
  const handle = await boot();
  const url = `ws://127.0.0.1:${handle.port}`;
  try {
    const a = await connectAndIdentify(url);
    const b = await connectAndIdentify(url);

    // B disconnects (removed server-side) before A ever searches.
    await b.close();
    await sleep(200);

    a.send({ type: 'find_match', data: {} });
    const searching = await a.waitFor((m) => m.type === 'match_searching');

    assert.ok(searching);
    assert.equal(handle.roomManager.size(), 0, 'No match should be created against a dead defender.');
    assert.equal(handle.matchmaking.size(), 1, 'A should remain SEARCHING.');
  } finally {
    await handle.stop();
  }
});

// --- TEST 8 ----------------------------------------------------------------

test('scenario: two attackers racing for one defender - only one acquires it', async () => {
  const handle = await boot();
  const url = `ws://127.0.0.1:${handle.port}`;
  try {
    const a = await connectAndIdentify(url);
    const b = await connectAndIdentify(url);
    const c = await connectAndIdentify(url);

    // Attacker A searches and acquires the single AVAILABLE player B as defender.
    a.send({ type: 'find_match', data: {} });
    const ma = await a.waitFor((m) => m.type === 'match_found');
    assert.equal(ma.data.role, 'attacker');

    // Attacker C searches next; B is already taken, so C must keep waiting.
    c.send({ type: 'find_match', data: {} });
    await c.waitFor((m) => m.type === 'match_searching');

    assert.equal(handle.roomManager.size(), 1, 'Exactly one room: B must not be double-matched.');
    const room = handle.roomManager.listRooms()[0];
    assert.equal(room.attackerPlayerId, a.playerId);
    assert.equal(room.defenderPlayerId, b.playerId);
    assert.equal(handle.matchmaking.size(), 1, 'C remains SEARCHING.');
  } finally {
    await handle.stop();
  }
});

// --- TEST 4 / TEST 5 -------------------------------------------------------

test('scenario: busy (in-room / under-attack) players are skipped for an available defender', async () => {
  const handle = await boot();
  const url = `ws://127.0.0.1:${handle.port}`;
  try {
    // Connection order determines server-side candidate order.
    // Match c <-> h first so both become busy (in a room).
    const c = await connectAndIdentify(url);
    const h = await connectAndIdentify(url);
    const a = await connectAndIdentify(url);
    const b = await connectAndIdentify(url);

    c.send({ type: 'find_match', data: {} });
    await c.waitFor((m) => m.type === 'match_found');
    const mh = await h.waitFor((m) => m.type === 'match_found');
    assert.equal(mh.data.role, 'defender');
    assert.equal(handle.roomManager.size(), 1);

    // Now c and h are busy. A searches -> the only available defender is b.
    a.send({ type: 'find_match', data: {} });
    const ma = await a.waitFor((m) => m.type === 'match_found');
    const mb = await b.waitFor((m) => m.type === 'match_found');
    assert.equal(ma.data.role, 'attacker');
    assert.equal(mb.data.role, 'defender');

    assert.equal(handle.roomManager.size(), 2, 'Two independent rooms (c-h and a-b).');
    const rooms = handle.roomManager.listRooms();
    const roomAB = rooms.find((r) => r.containsPlayer(a.playerId) && r.containsPlayer(b.playerId));
    assert.ok(roomAB, 'A and B must be paired together.');
  } finally {
    await handle.stop();
  }
});

