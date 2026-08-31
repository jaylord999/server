import { validatePowerAllocation } from '../game/PowerAllocation';

/**
 * Client -> server messages.
 *
 * `parseClientMessage` performs structural validation (JSON shape, envelope,
 * mandatory `type`). Per-type semantic validators (`validateXxxData`) check
 * field types and numeric ranges. The server never trusts raw client data.
 */

export interface ClientMessage<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Mandatory message type. */
  type: string;
  /** Optional, echoed by the server in the response. */
  requestId?: string;
  /** Optional client timestamp; server always sets one on replies. */
  timestamp?: number;
  data: TData;
}

// --- Per-type payload shapes ---

export interface IdentifyData {
  clientVersion: string;
  protocolVersion?: number;
}

export interface PingData {
  nonce?: string;
}

export interface FindMatchData {
  mode?: string;
}

export interface CancelMatchData {
  // reserved for future use
}

export interface LeaveRoomData {
  // reserved for future use
}

export interface PlayerInputData {
  throttle: number;
  pitch: number;
  yaw: number;
}

export interface TurretInputData {
  rotation: number;
  barrel: number;
}

export interface FireWeaponData {
  weapon: string;
}

export interface PowerAllocationData {
  turret: number;
  shield: number;
  bullets: number;
  missiles: number;
  materials: number;
}

// --- Generic envelope parsing ---

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; error: string };

export function parseClientMessage(raw: string): ParseResult {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: 'Empty message.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Message is not valid JSON.' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Message must be a JSON object.' };
  }

  const candidate = parsed as Record<string, unknown>;

  if (typeof candidate.type !== 'string' || candidate.type.trim() === '') {
    return { ok: false, error: 'Message is missing a valid "type" field.' };
  }

  if (
    candidate.data !== undefined &&
    (typeof candidate.data !== 'object' || candidate.data === null || Array.isArray(candidate.data))
  ) {
    return { ok: false, error: 'Message "data" field must be an object.' };
  }

  if (candidate.timestamp !== undefined && typeof candidate.timestamp !== 'number') {
    return { ok: false, error: 'Message "timestamp" field must be a number.' };
  }

  return {
    ok: true,
    message: {
      type: candidate.type,
      requestId: typeof candidate.requestId === 'string' ? candidate.requestId : undefined,
      timestamp: typeof candidate.timestamp === 'number' ? candidate.timestamp : Date.now(),
      data: (candidate.data as Record<string, unknown> | undefined) ?? {},
    },
  };
}

// --- Per-type semantic validation ---

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function requireObject(value: unknown, label: string): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function validateIdentifyData(value: unknown): ValidationResult<IdentifyData> {
  const data = requireObject(value, 'identify');
  if (!data) {
    return { ok: false, reason: 'identify data must be an object.' };
  }
  if (typeof data.clientVersion !== 'string' || data.clientVersion.trim() === '') {
    return { ok: false, reason: '"clientVersion" must be a non-empty string.' };
  }
  if (data.protocolVersion !== undefined && !isFiniteNumber(data.protocolVersion)) {
    return { ok: false, reason: '"protocolVersion" must be a number.' };
  }
  return {
    ok: true,
    value: {
      clientVersion: data.clientVersion,
      protocolVersion: data.protocolVersion,
    },
  };
}

export function validatePingData(value: unknown): ValidationResult<PingData> {
  const data = requireObject(value, 'ping');
  if (!data) {
    return { ok: false, reason: 'ping data must be an object.' };
  }
  if (data.nonce !== undefined && typeof data.nonce !== 'string') {
    return { ok: false, reason: '"nonce" must be a string.' };
  }
  return { ok: true, value: { nonce: data.nonce } };
}

export function validateFindMatchData(value: unknown): ValidationResult<FindMatchData> {
  const data = requireObject(value, 'find_match');
  if (!data) {
    return { ok: false, reason: 'find_match data must be an object.' };
  }
  if (data.mode !== undefined && typeof data.mode !== 'string') {
    return { ok: false, reason: '"mode" must be a string.' };
  }
  return { ok: true, value: { mode: data.mode } };
}

export function validatePlayerInputData(value: unknown): ValidationResult<PlayerInputData> {
  const data = requireObject(value, 'player_input');
  if (!data) {
    return { ok: false, reason: 'player_input data must be an object.' };
  }
  const result: PlayerInputData = { throttle: 0, pitch: 0, yaw: 0 };
  const fields: Array<[keyof PlayerInputData, unknown]> = [
    ['throttle', data.throttle],
    ['pitch', data.pitch],
    ['yaw', data.yaw],
  ];
  for (const [field, raw] of fields) {
    if (!isFiniteNumber(raw)) {
      return { ok: false, reason: `"${field}" must be a finite number.` };
    }
    if (raw < -1 || raw > 1) {
      return { ok: false, reason: `"${field}" must be between -1 and 1.` };
    }
    result[field] = raw;
  }
  return { ok: true, value: result };
}

export function validateTurretInputData(value: unknown): ValidationResult<TurretInputData> {
  const data = requireObject(value, 'turret_input');
  if (!data) {
    return { ok: false, reason: 'turret_input data must be an object.' };
  }
  if (!isFiniteNumber(data.rotation)) {
    return { ok: false, reason: '"rotation" must be a finite number.' };
  }
  if (!isFiniteNumber(data.barrel)) {
    return { ok: false, reason: '"barrel" must be a finite number.' };
  }
  return {
    ok: true,
    value: { rotation: data.rotation, barrel: data.barrel },
  };
}

const SUPPORTED_WEAPONS = new Set(['bullet', 'missile']);

export function validateFireWeaponData(value: unknown): ValidationResult<FireWeaponData> {
  const data = requireObject(value, 'fire_weapon');
  if (!data) {
    return { ok: false, reason: 'fire_weapon data must be an object.' };
  }
  if (typeof data.weapon !== 'string' || !SUPPORTED_WEAPONS.has(data.weapon)) {
    return {
      ok: false,
      reason: `"weapon" must be one of: ${[...SUPPORTED_WEAPONS].join(', ')}.`,
    };
  }
  return { ok: true, value: { weapon: data.weapon } };
}

export function validatePowerAllocationData(
  value: unknown,
  maxPower: number,
  maxPerSystem: number,
): ValidationResult<PowerAllocationData> {
  const result = validatePowerAllocation(value, maxPower, maxPerSystem);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  return { ok: true, value: result.allocation };
}

