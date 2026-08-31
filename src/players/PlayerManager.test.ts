import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PlayerManager } from './PlayerManager';

test('creates a player for a connection and reuses it', () => {
  const manager = new PlayerManager();
  const first = manager.createPlayer('conn-1');
  const second = manager.createPlayer('conn-1');

  assert.equal(first.playerId, second.playerId);
  assert.equal(manager.size(), 1);
  assert.equal(manager.getByConnectionId('conn-1')?.playerId, first.playerId);
  assert.match(first.playerId, /[0-9a-f-]{36}/);
});

test('creates distinct players for distinct connections', () => {
  const manager = new PlayerManager();
  const a = manager.createPlayer('conn-a');
  const b = manager.createPlayer('conn-b');
  assert.notEqual(a.playerId, b.playerId);
  assert.equal(manager.size(), 2);
});

test('updates state, room and client version', () => {
  const manager = new PlayerManager();
  const player = manager.createPlayer('conn-1');

  manager.setState(player.playerId, 'in_queue');
  manager.setRoom(player.playerId, 'room-1');
  manager.setClientVersion(player.playerId, '0.1.0');

  const updated = manager.getById(player.playerId);
  assert.equal(updated?.state, 'in_queue');
  assert.equal(updated?.roomId, 'room-1');
  assert.equal(updated?.clientVersion, '0.1.0');
});

test('removes players by id and by connection', () => {
  const manager = new PlayerManager();
  const player = manager.createPlayer('conn-1');

  assert.equal(manager.remove('does-not-exist'), false);
  assert.equal(manager.remove(player.playerId), true);
  assert.equal(manager.size(), 0);

  const second = manager.createPlayer('conn-2');
  const removedId = manager.removeByConnection('conn-2');
  assert.equal(removedId, second.playerId);
  assert.equal(manager.size(), 0);
});

test('list returns all players', () => {
  const manager = new PlayerManager();
  manager.createPlayer('conn-a');
  manager.createPlayer('conn-b');
  assert.equal(manager.list().length, 2);
});
