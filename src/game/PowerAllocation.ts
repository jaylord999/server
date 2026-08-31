/**
 * Defender power allocation model.
 *
 * The server is authoritative for power allocation: the client can propose a
 * distribution but it is only accepted when every field is a finite,
 * non-negative number and the total does not exceed the available power.
 */

export interface PowerAllocation {
  turret: number;
  shield: number;
  bullets: number;
  missiles: number;
  materials: number;
}

export const POWER_SYSTEMS: ReadonlyArray<keyof PowerAllocation> = [
  'turret',
  'shield',
  'bullets',
  'missiles',
  'materials',
];

export type PowerValidationResult =
  | { ok: true; allocation: PowerAllocation; total: number }
  | { ok: false; reason: string };

export function sumPower(allocation: PowerAllocation): number {
  let total = 0;
  for (const system of POWER_SYSTEMS) {
    total += allocation[system];
  }
  return total;
}

export function createDefaultPowerAllocation(): PowerAllocation {
  return { turret: 0, shield: 0, bullets: 0, missiles: 0, materials: 0 };
}

export function validatePowerAllocation(
  value: unknown,
  maxPower: number,
  maxPerSystem: number,
): PowerValidationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'Power allocation must be an object.' };
  }

  const candidate = value as Record<string, unknown>;
  const allocation = createDefaultPowerAllocation();

  for (const system of POWER_SYSTEMS) {
    const raw = candidate[system];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return { ok: false, reason: `Power field "${system}" must be a finite number.` };
    }
    if (raw < 0) {
      return { ok: false, reason: `Power field "${system}" cannot be negative.` };
    }
    if (raw > maxPerSystem) {
      return { ok: false, reason: `Power field "${system}" exceeds the per-system maximum of ${maxPerSystem}.` };
    }
    allocation[system] = raw;
  }

  const total = sumPower(allocation);
  if (total > maxPower) {
    return {
      ok: false,
      reason: `Total power (${total}) exceeds available power (${maxPower}).`,
    };
  }

  return { ok: true, allocation, total };
}
