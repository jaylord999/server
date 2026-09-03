import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GameState } from './GameState';

const START_Z = -190;

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

test('attacker flies forward along its heading (default heading faces the base)', () => {
  const state = new GameState('room-1', 'a', 'd', 100, 300, 10);
  state.start();
  state.attackerInput = { throttle: 1, pitch: 0, yaw: 0, receivedAt: Date.now() };
  const z0 = state.attacker.aircraftPosition.z;
  assert.equal(z0, START_Z);
  state.update(0.5);
  state.update(0.5);
  // Throttle forward should move it toward the base (increasing z), no lateral drift.
  assert.ok(state.attacker.aircraftPosition.z > z0);
  assert.ok(Math.abs(state.attacker.aircraftPosition.x) < 0.5);
});

test('yaw input turns the aircraft and the heading is authoritative', () => {
  const state = new GameState('room-1', 'a', 'd', 100, 300, 10);
  state.start();
  const before = state.attacker.aircraftRotation.y;
  state.attackerInput = { throttle: 0, pitch: 0, yaw: 1, receivedAt: Date.now() };
  state.update(1);
  assert.notEqual(state.attacker.aircraftRotation.y, before);
});

test('aircraft is clamped inside the arena radius', () => {
  const state = new GameState('room-1', 'a', 'd', 100, 300, 10);
  state.start();
  state.attacker.aircraftPosition.x = 999;
  state.attacker.aircraftPosition.z = 999;
  state.attackerInput = { throttle: 1, pitch: 0, yaw: 0, receivedAt: Date.now() };
  state.update(0.1);
  const r = Math.hypot(state.attacker.aircraftPosition.x, state.attacker.aircraftPosition.z);
  assert.ok(r <= 260 + 1e-6);
});

test('defender turret firing: hits when facing the attacker', () => {
  const state = new GameState('room-1', 'a', 'd', 100, 300, 10);
  state.start();
  state.defender.turretRotation = 0; // faces -Z, toward the starting attacker
  const result = state.attemptBullet('defender', Date.now());
  assert.ok(result);
  assert.equal(result!.shot.hit, true);
  assert.ok(result!.damage);
  // Attacker shield absorbs the first 10.
  assert.equal(state.attacker.shield, 40);
  assert.equal(state.attacker.health, 100);
});

test('defender turret firing: misses when facing away from the attacker', () => {
  const state = new GameState('room-1', 'a', 'd', 100, 300, 10);
  state.start();
  state.defender.turretRotation = 180; // faces away from the attacker
  const result = state.attemptBullet('defender', Date.now());
  assert.ok(result);
  assert.equal(result!.shot.hit, false);
  assert.equal(result!.damage, undefined);
  assert.equal(state.attacker.health, 100);
});

test('attacker firing: hits the base when facing it and drains base shield then health', () => {
  const state = new GameState('room-1', 'a', 'd', 100, 300, 10);
  state.start();
  // Default attacker heading (PI) faces +Z, toward the base at the origin.
  const result = state.attemptBullet('attacker', Date.now());
  assert.ok(result);
  assert.equal(result!.shot.hit, true);
  assert.equal(state.defender.shield, 30);
  assert.equal(state.defender.health, 100);
});

test('reaching zero health decides the winner and finishes the battle', () => {
  const state = new GameState('room-1', 'a', 'd', 100, 300, 10);
  state.start();
  // Attacker shield (50) + health (100) = 150; apply 200 -> kills attacker.
  const dmg = state.applyDamage('attacker', 200);
  assert.equal(dmg.remainingHealth, 0);
  assert.equal(state.winner, 'defender');
  assert.equal(state.finished, true);
});

test('attacker and defender can both be damaged authoritatively', () => {
  const state = new GameState('room-1', 'a', 'd', 100, 300, 10);
  state.start();
  const d = state.applyDamage('defender', 500);
  assert.equal(d.remainingHealth, 0);
  assert.equal(state.winner, 'attacker');
});

test('cooldown prevents an immediate second shot for the same role', () => {
  const state = new GameState('room-1', 'a', 'd', 100, 300, 10);
  state.start();
  const now = Date.now();
  state.attemptBullet('defender', now);
  const second = state.attemptBullet('defender', now + 1);
  assert.equal(second, null);
});

test('toSnapshot returns a plain serializable snapshot with combat fields', () => {
  const state = new GameState('room-1', 'a', 'd', 100, 300, 10);
  state.start();
  const snapshot = state.toSnapshot();
  assert.equal(snapshot.roomId, 'room-1');
  assert.equal(snapshot.availablePower, 100);
  assert.equal(snapshot.arenaRadius, 260);
  assert.equal(snapshot.winner, null);
  assert.equal(snapshot.defender.health, 100);
  assert.equal(snapshot.attacker.health, 100);

  // Snapshot is independent of the live state object.
  snapshot.attacker.health = 1;
  assert.equal(state.attacker.health, 100);
});

