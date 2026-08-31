import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseClientMessage,
  validateFireWeaponData,
  validateIdentifyData,
  validatePlayerInputData,
  validatePowerAllocationData,
  validateTurretInputData,
} from './ClientMessages';

test('parses a valid envelope with requestId and data', () => {
  const result = parseClientMessage(
    JSON.stringify({ type: 'ping', requestId: 'r1', timestamp: 123, data: { nonce: 'a' } }),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.message.type, 'ping');
    assert.equal(result.message.requestId, 'r1');
    assert.equal(result.message.timestamp, 123);
    assert.deepEqual(result.message.data, { nonce: 'a' });
  }
});

test('parses a minimal message and defaults data to an empty object', () => {
  const result = parseClientMessage(JSON.stringify({ type: 'ping' }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.message.data, {});
  }
});

test('rejects malformed JSON', () => {
  const result = parseClientMessage('{not json');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /JSON/i);
  }
});

test('rejects empty payloads', () => {
  for (const raw of ['', '   ']) {
    const result = parseClientMessage(raw);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /Empty/i);
    }
  }
});

test('rejects non-object messages', () => {
  for (const raw of ['null', '42', '"hello"', '[]']) {
    const result = parseClientMessage(raw);
    assert.equal(result.ok, false);
  }
});

test('rejects a missing type', () => {
  const result = parseClientMessage(JSON.stringify({ data: {} }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /type/);
  }
});

test('rejects a non-object data field', () => {
  const result = parseClientMessage(JSON.stringify({ type: 'ping', data: [1, 2] }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /data/);
  }
});

test('rejects a non-numeric timestamp', () => {
  const result = parseClientMessage(JSON.stringify({ type: 'ping', timestamp: 'now' }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /timestamp/);
  }
});

test('validateIdentifyData requires clientVersion', () => {
  assert.equal(validateIdentifyData({}).ok, false);
  assert.equal(validateIdentifyData({ clientVersion: '' }).ok, false);
  const ok = validateIdentifyData({ clientVersion: '0.1.0' });
  assert.equal(ok.ok, true);
});

test('validatePlayerInputData enforces numeric ranges', () => {
  const ok = validatePlayerInputData({ throttle: 0.8, pitch: 0.2, yaw: -0.4 });
  assert.equal(ok.ok, true);

  assert.equal(validatePlayerInputData({ throttle: 1.5, pitch: 0, yaw: 0 }).ok, false);
  assert.equal(validatePlayerInputData({ throttle: 0.8, yaw: 0 }).ok, false);
  assert.equal(validatePlayerInputData({ throttle: 'fast', pitch: 0, yaw: 0 }).ok, false);
});

test('validateTurretInputData accepts finite numbers and rejects NaN', () => {
  assert.equal(validateTurretInputData({ rotation: 143.2, barrel: 7.4 }).ok, true);
  assert.equal(validateTurretInputData({ rotation: NaN, barrel: 7.4 }).ok, false);
  assert.equal(validateTurretInputData({ rotation: 143.2 }).ok, false);
});

test('validateFireWeaponData only accepts supported weapons', () => {
  assert.equal(validateFireWeaponData({ weapon: 'bullet' }).ok, true);
  assert.equal(validateFireWeaponData({ weapon: 'missile' }).ok, true);
  assert.equal(validateFireWeaponData({ weapon: 'laser' }).ok, false);
});

test('validatePowerAllocationData rejects an over-budget proposal', () => {
  const bad = validatePowerAllocationData(
    { turret: 100, shield: 100, bullets: 0, missiles: 0, materials: 0 },
    100,
    100,
  );
  assert.equal(bad.ok, false);

  const good = validatePowerAllocationData(
    { turret: 30, shield: 25, bullets: 20, missiles: 15, materials: 10 },
    100,
    100,
  );
  assert.equal(good.ok, true);
});
