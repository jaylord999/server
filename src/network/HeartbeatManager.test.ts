import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { ConnectionManager } from './ConnectionManager';
import { HeartbeatManager } from './HeartbeatManager';

/** Minimal fake WebSocket that records ping/terminate calls. */
class FakeSocket extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  pingCalls = 0;
  terminated = false;

  ping(): void {
    this.pingCalls += 1;
  }

  terminate(): void {
    this.terminated = true;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('terminates a connection that never responds within the timeout', async () => {
  const connections = new ConnectionManager();
  const socket = new FakeSocket();
  const connection = connections.add(socket);

  let timedOut = false;
  const heartbeat = new HeartbeatManager(connections, 50, 150, (connectionId) => {
    timedOut = true;
    // Mirrors main.ts: the timeout handler terminates the socket itself.
    connections.get(connectionId)?.socket.terminate();
  });
  heartbeat.track(connection);
  heartbeat.start();

  await wait(400);
  heartbeat.stop();

  assert.equal(timedOut, true);
  assert.equal(socket.terminated, true);
});

test('keeps a connection alive that answers pongs', async () => {
  const connections = new ConnectionManager();
  const socket = new FakeSocket();
  const connection = connections.add(socket);

  let timedOut = false;
  const heartbeat = new HeartbeatManager(connections, 50, 150, () => {
    timedOut = true;
  });
  heartbeat.track(connection);
  heartbeat.start();

  // Simulate the client answering every ping with a pong.
  const responder = setInterval(() => {
    connection.lastPongAt = Date.now();
  }, 40);

  await wait(400);
  clearInterval(responder);
  heartbeat.stop();

  assert.equal(timedOut, false);
  assert.equal(socket.pingCalls > 0, true);
  assert.equal(socket.terminated, false);
});

test('stop clears the timer and no further checks run', async () => {
  const connections = new ConnectionManager();
  const socket = new FakeSocket();
  const connection = connections.add(socket);

  let timeouts = 0;
  const heartbeat = new HeartbeatManager(connections, 30, 60, () => {
    timeouts += 1;
  });
  heartbeat.track(connection);
  heartbeat.start();
  heartbeat.stop();

  await wait(200);
  assert.equal(timeouts, 0);
});
