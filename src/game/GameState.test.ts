import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GameState } from './GameState';

test('tracks game time and finishes at the time limit', () => {
  const state = new GameState('room-1', 'attacker', 'defender', 100, 300, 10);
  state.start();
  state.update(1.5);
  state.update(0.5);
  assert.equal(state.gameStarted, true);
  assert.equal(state.gameTime, 2);
  assert.equal(state.finished, false);

  const short = new GameState('room-2', 'a', 'd', 100, 1, 10);
  short.start();
  short.update(2);
  assert.equal(short.finished, true);
});

test('does not advance time before the game starts', () => {
  const state = new GameState('room-1', 'a', 'd', 100, 300, 10);
  state.update(5);
  assert.equal(state.gameTime, 0);
});

test('applies the latest attacker input via minimal movement integration', () => {
  const state = new GameState('room-1', 'a', 'd', 100, 300, 10);
  state.start();
  state.attackerInput = { throttle: 1, pitch: 0, yaw: 0, receivedAt: Date.now() };
  state.update(0.5);

  // Forward motion along +z; velocity ramps toward maxPlayerSpeed (10).
  assert.ok(state.attacker.aircraftPosition.z > 0);
  assert.ok(state.attacker.aircraftVelocity.z > 0);
  assert.equal(state.attacker.aircraftPosition.x, 0);
});

test('toSnapshot returns a plain serializable object', () => {
  const state = new GameState('room-1', 'a', 'd', 100, 300, 10);
  state.start();
  state.powerAllocation = { turret: 50, shield: 20, bullets: 10, missiles: 10, materials: 10 };
  state.materials = 5;

  const snapshot = state.toSnapshot();
  assert.equal(snapshot.roomId, 'room-1');
  assert.equal(snapshot.attackerPlayerId, 'a');
  assert.equal(snapshot.defenderPlayerId, 'd');
  assert.equal(snapshot.powerAllocation.turret, 50);
  assert.equal(snapshot.availablePower, 100);
  assert.equal(snapshot.materials, 5);
  assert.equal(state.powerTotal, 100);

  // Snapshot is independent of the live state object.
  snapshot.attacker.health = 1;
  assert.equal(state.attacker.health, 100);
});
