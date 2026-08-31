import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validatePowerAllocation } from './PowerAllocation';

const MAX_POWER = 100;
const MAX_PER_SYSTEM = 100;

test('accepts a valid allocation whose total is within available power', () => {
  const result = validatePowerAllocation(
    { turret: 30, shield: 25, bullets: 20, missiles: 15, materials: 10 },
    MAX_POWER,
    MAX_PER_SYSTEM,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.total, 100);
    assert.equal(result.allocation.turret, 30);
    assert.equal(result.allocation.materials, 10);
  }
});

test('rejects an allocation that exceeds available power', () => {
  const result = validatePowerAllocation(
    { turret: 50, shield: 50, bullets: 50, missiles: 50, materials: 50 },
    MAX_POWER,
    MAX_PER_SYSTEM,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /exceeds available power/i);
  }
});

test('rejects negative values', () => {
  const result = validatePowerAllocation(
    { turret: -1, shield: 0, bullets: 0, missiles: 0, materials: 0 },
    MAX_POWER,
    MAX_PER_SYSTEM,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /cannot be negative/i);
  }
});

test('rejects missing fields', () => {
  const result = validatePowerAllocation(
    { turret: 30, shield: 25, bullets: 20, missiles: 15 },
    MAX_POWER,
    MAX_PER_SYSTEM,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /materials/);
  }
});

test('rejects non-numeric fields', () => {
  const result = validatePowerAllocation(
    { turret: '30', shield: 25, bullets: 20, missiles: 15, materials: 10 },
    MAX_POWER,
    MAX_PER_SYSTEM,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /finite number/i);
  }
});

test('rejects NaN and Infinity', () => {
  const nanResult = validatePowerAllocation(
    { turret: NaN, shield: 0, bullets: 0, missiles: 0, materials: 0 },
    MAX_POWER,
    MAX_PER_SYSTEM,
  );
  assert.equal(nanResult.ok, false);

  const infResult = validatePowerAllocation(
    { turret: Infinity, shield: 0, bullets: 0, missiles: 0, materials: 0 },
    MAX_POWER,
    MAX_PER_SYSTEM,
  );
  assert.equal(infResult.ok, false);
});

test('rejects values above the per-system maximum', () => {
  const result = validatePowerAllocation(
    { turret: 150, shield: 0, bullets: 0, missiles: 0, materials: 0 },
    MAX_POWER,
    MAX_PER_SYSTEM,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /per-system maximum/i);
  }
});

test('rejects non-object payloads', () => {
  for (const bad of [null, undefined, 'power', 42, [30, 25, 20, 15, 10]]) {
    const result = validatePowerAllocation(bad, MAX_POWER, MAX_PER_SYSTEM);
    assert.equal(result.ok, false);
  }
});
