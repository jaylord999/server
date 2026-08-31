import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RoomManager } from './RoomManager';
import { GameRoom } from './GameRoom';

const OPTIONS = { maxPower: 100, gameTimeLimitSeconds: 300, maxPlayerSpeed: 10 };

test('creates and retrieves a room with deterministic roles', () => {
  const manager = new RoomManager();
  const room = manager.createRoom('attacker-id', 'defender-id', OPTIONS);

  assert.equal(room.getRole('attacker-id'), 'attacker');
  assert.equal(room.getRole('defender-id'), 'defender');
  assert.equal(room.getRole('stranger-id'), null);
  assert.equal(room.containsPlayer('attacker-id'), true);
  assert.equal(room.getOtherPlayer('attacker-id'), 'defender-id');
  assert.equal(manager.getRoom(room.roomId), room);
  assert.equal(manager.getRoomByPlayer('attacker-id'), room);
  assert.equal(manager.size(), 1);
});

test('removes rooms and keeps state in memory', () => {
  const manager = new RoomManager();
  const room = manager.createRoom('a', 'd', OPTIONS);

  assert.equal(manager.removeRoom(room.roomId), room);
  assert.equal(manager.getRoom(room.roomId), undefined);
  assert.equal(manager.size(), 0);
});

test('lists all active rooms', () => {
  const manager = new RoomManager();
  manager.createRoom('a1', 'd1', OPTIONS);
  manager.createRoom('a2', 'd2', OPTIONS);
  assert.equal(manager.listRooms().length, 2);
});

test('room start flips game state to started', () => {
  const room: GameRoom = new GameRoom('a', 'd', OPTIONS);
  assert.equal(room.state.gameStarted, false);
  assert.equal(room.startedAt, null);
  room.start();
  assert.equal(room.state.gameStarted, true);
  assert.ok(room.startedAt !== null);
});
