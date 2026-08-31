/**
 * Centralized server configuration.
 *
 * Every tunable value is read from environment variables with sane defaults,
 * so the same codebase runs locally, in CI and on Render.com without changes.
 */

export interface ServerConfig {
  /** HTTP + WebSocket port. Use 0 to pick a random free port (tests). */
  port: number;
  /** Bind address. Must be 0.0.0.0 for cloud deployment. */
  host: string;
  nodeEnv: string;
  /** Version of the wire protocol, sent in `welcome`. */
  protocolVersion: number;
  /** How often the server pings idle clients (ms). */
  heartbeatIntervalMs: number;
  /** Max time without any activity before a connection is closed (ms). */
  heartbeatTimeoutMs: number;
  /** Authoritative simulation / state broadcast rate (ticks per second). */
  tickRate: number;
  tickIntervalMs: number;
  /** Total energy available for the defender power allocation. */
  maxPower: number;
  /** Maximum power a single system may receive. */
  maxPowerPerSystem: number;
  gameTimeLimitSeconds: number;
  /** Minimum time between shots for server-side cooldown checks. */
  weaponCooldownMs: number;
  /** Max aircraft speed used by the minimal movement integration. */
  maxPlayerSpeed: number;
}

const DEFAULTS = {
  port: 3000,
  host: '0.0.0.0',
  protocolVersion: 1,
  heartbeatIntervalMs: 15_000,
  heartbeatTimeoutMs: 45_000,
  tickRate: 20,
  maxPower: 100,
  maxPowerPerSystem: 100,
  gameTimeLimitSeconds: 300,
  weaponCooldownMs: 200,
  maxPlayerSpeed: 10,
};

function readNumber(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  const tickRate = Math.max(1, Math.floor(readNumber(env, 'TICK_RATE', DEFAULTS.tickRate)));
  return {
    port: Math.floor(readNumber(env, 'PORT', DEFAULTS.port)),
    host: (env.HOST ?? DEFAULTS.host).trim() || DEFAULTS.host,
    nodeEnv: (env.NODE_ENV ?? 'development').trim() || 'development',
    protocolVersion: DEFAULTS.protocolVersion,
    heartbeatIntervalMs: readNumber(env, 'HEARTBEAT_INTERVAL_MS', DEFAULTS.heartbeatIntervalMs),
    heartbeatTimeoutMs: readNumber(env, 'HEARTBEAT_TIMEOUT_MS', DEFAULTS.heartbeatTimeoutMs),
    tickRate,
    tickIntervalMs: 1000 / tickRate,
    maxPower: readNumber(env, 'MAX_POWER', DEFAULTS.maxPower),
    maxPowerPerSystem: readNumber(env, 'MAX_POWER_PER_SYSTEM', DEFAULTS.maxPowerPerSystem),
    gameTimeLimitSeconds: readNumber(env, 'GAME_TIME_LIMIT_SECONDS', DEFAULTS.gameTimeLimitSeconds),
    weaponCooldownMs: readNumber(env, 'WEAPON_COOLDOWN_MS', DEFAULTS.weaponCooldownMs),
    maxPlayerSpeed: readNumber(env, 'MAX_PLAYER_SPEED', DEFAULTS.maxPlayerSpeed),
  };
}
