import {
  createDefaultPowerAllocation,
  PowerAllocation,
  sumPower,
} from './PowerAllocation';

/**
 * Server-authoritative game state for one battle.
 *
 * Clients never mutate this state directly: they send inputs, the server
 * validates them and applies the result, then broadcasts authoritative state.
 *
 * Combat (firing, hit resolution, damage, victory) is fully resolved HERE on the
 * server. Shots are authoritative events: a client only requests to fire; the
 * server decides facing/range/hit/damage and returns an event both clients
 * render identically. There is no per-client projectile or damage logic.
 *
 * Coordinate convention (matches the Godot scene, right-handed, Y up):
 *   - the arena centre is the origin; the defender base / turret sits there.
 *   - a "yaw" h (radians) faces forward  f = (-sin h, 0, -cos h); h = 0 faces -Z.
 *     This is exactly how the Godot turret's yaw maps.
 *   - the attacker's yaw is stored in aircraftRotation.y (radians).
 *   - the turret's heading is stored in defender.turretRotation (degrees).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type BattleRole = 'attacker' | 'defender';

export interface AttackerState {
  aircraftPosition: Vec3;
  aircraftRotation: Vec3;
  aircraftVelocity: Vec3;
  health: number;
  shield: number;
  energy: number;
  ammo: number;
  missiles: number;
}

export interface DefenderState {
  /** Turret heading in degrees (matches the Godot turret's azimuth). */
  turretRotation: number;
  /** Barrel elevation in degrees. */
  barrelAngle: number;
  turretHeat: number;
  turretLevel: number;
  generatorLevel: number;
  shieldLevel: number;
  /** Base integrity. Reaching 0 ends the battle (attacker wins). */
  health: number;
  /** Base shield that absorbs damage before health. */
  shield: number;
}

export interface AttackerInput {
  throttle: number;
  pitch: number;
  yaw: number;
  receivedAt: number;
}

export interface ShotEvent {
  shooterPlayerId: string;
  shooterRole: BattleRole;
  weapon: string;
  projectileId: string;
  muzzle: Vec3;
  /** Unit direction the tracer travels (3D). */
  dir: Vec3;
  /** True when the server decided the shot will hit its target. */
  hit: boolean;
  /** Distance (world units) the tracer travels before it resolves/fades. */
  travelDistance: number;
  /** Time (ms) for the tracer to reach its end (client FX timing). */
  travelMs: number;
  targetPlayerId?: string;
}

export interface DamageEvent {
  targetRole: BattleRole;
  amount: number;
  remainingHealth: number;
  remainingShield: number;
}

export interface GameStateSnapshot {
  roomId: string;
  gameStarted: boolean;
  gameTime: number;
  attackerPlayerId: string;
  defenderPlayerId: string;
  attacker: AttackerState;
  defender: DefenderState;
  powerAllocation: PowerAllocation;
  availablePower: number;
  materials: number;
  /** World radius of the arena boundary. */
  arenaRadius: number;
  /** Winner once decided, otherwise null. */
  winner: BattleRole | null;
}

// ----------------------------------------------------------------------------
// Tunables (the authoritative combat simulation owns these values).
// ----------------------------------------------------------------------------
const ARENA_RADIUS = 260;
const ATTACKER_MIN_Y = 5;
const ATTACKER_MAX_Y = 90;
const TURN_RATE = 1.6; // rad/s yaw steering
const CLIMB_FACTOR = 0.6; // fraction of max speed available as vertical climb
const ACCEL_LERP = 3.2; // velocity smoothing toward targets

const DEFENDER_GUN_RANGE = 680;
const DEFENDER_GUN_COOLDOWN_MS = 420;
const DEFENDER_MUZZLE_Y = 2.6;
const DEFENDER_MUZZLE_FWD = 4.0;

const ATTACKER_GUN_RANGE = 680;
const ATTACKER_GUN_COOLDOWN_MS = 240;

const BULLET_SPEED = 560;
const BULLET_DAMAGE = 10;

/** Maximum horizontal angle (degrees) off the shooter's facing that still hits. */
const FACE_CONE_DEG = 16;

const BASE_CENTER: Vec3 = { x: 0, y: 3, z: 0 };

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Shortest signed angle difference (radians) between two yaw angles. */
function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Yaw (radians) whose forward points toward a horizontal direction (dx, dz). */
function yawToFace(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

function forwardForYaw(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function clampNum(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createDefaultAttackerState(): AttackerState {
  return {
    // Spawn "in front of" the base (which faces -Z): on the -Z side facing back
    // toward the base (heading PI faces +Z).
    aircraftPosition: { x: 0, y: 45, z: -190 },
    aircraftRotation: { x: 0, y: Math.PI, z: 0 },
    aircraftVelocity: { x: 0, y: 0, z: 0 },
    health: 100,
    shield: 50,
    energy: 100,
    ammo: 120,
    missiles: 6,
  };
}

export function createDefaultDefenderState(): DefenderState {
  return {
    turretRotation: 0,
    barrelAngle: 0,
    turretHeat: 0,
    turretLevel: 1,
    generatorLevel: 1,
    shieldLevel: 1,
    health: 100,
    shield: 40,
  };
}

export class GameState {
  gameStarted = false;
  gameTime = 0;
  startedAt: number | null = null;
  finishedAt: number | null = null;
  materials = 0;
  /** Latest validated attacker input (from the attacker role only). */
  attackerInput: AttackerInput | null = null;
  /** Cooldown bookkeeping per role (ms timestamps). */
  lastBulletAt: Partial<Record<BattleRole, number>> = {};
  lastMissileFiredAt = 0;
  /** Winner once the battle has a decisive result. */
  winner: BattleRole | null = null;

  readonly attacker: AttackerState;
  readonly defender: DefenderState;
  powerAllocation: PowerAllocation;

  constructor(
    readonly roomId: string,
    readonly attackerPlayerId: string,
    readonly defenderPlayerId: string,
    readonly availablePower: number,
    readonly maxGameTimeSeconds: number,
    readonly maxPlayerSpeed: number,
  ) {
    this.attacker = createDefaultAttackerState();
    this.defender = createDefaultDefenderState();
    this.powerAllocation = createDefaultPowerAllocation();
  }

  start(): void {
    if (!this.gameStarted) {
      this.gameStarted = true;
      this.startedAt = Date.now();
    }
  }

  /** Advance the simulation by `dt` seconds. Called at TICK_RATE by the server. */
  update(dt: number): void {
    if (!this.gameStarted || this.finished) {
      return;
    }
    this.gameTime += dt;
    this.applyAttackerInput(dt);
  }

  get finished(): boolean {
    if (this.winner !== null) {
      return true;
    }
    return this.maxGameTimeSeconds > 0 && this.gameTime >= this.maxGameTimeSeconds;
  }

  get powerTotal(): number {
    return sumPower(this.powerAllocation);
  }

  /**
   * Arcade aircraft integration. Yaw steers the heading, throttle drives forward
   * speed along the heading, pitch climbs/descends. Deterministic on the server;
   * the client only relays input. Kept deliberately simple for the prototype.
   */
  private applyAttackerInput(dt: number): void {
    const input = this.attackerInput;
    if (!input) {
      return;
    }
    const yaw = clampNum(input.yaw, -1, 1);
    const throttle = clampNum(input.throttle, -1, 1);
    const pitch = clampNum(input.pitch, -1, 1);

    const aircraft = this.attacker;
    const heading = aircraft.aircraftRotation.y + yaw * TURN_RATE * dt;
    aircraft.aircraftRotation.y = heading;

    const fwd = forwardForYaw(heading);
    const vxTarget = fwd.x * throttle * this.maxPlayerSpeed;
    const vzTarget = fwd.z * throttle * this.maxPlayerSpeed;
    const vyTarget = pitch * this.maxPlayerSpeed * CLIMB_FACTOR;

    const vel = aircraft.aircraftVelocity;
    const lerp = Math.min(1, dt * ACCEL_LERP);
    vel.x += (vxTarget - vel.x) * lerp;
    vel.y += (vyTarget - vel.y) * lerp;
    vel.z += (vzTarget - vel.z) * lerp;

    const pos = aircraft.aircraftPosition;
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;

    // Altitude clamp.
    pos.y = clampNum(pos.y, ATTACKER_MIN_Y, ATTACKER_MAX_Y);

    // Arena boundary (horizontal): stop at the ring and cancel outward velocity.
    const radial = Math.hypot(pos.x, pos.z);
    if (radial > ARENA_RADIUS) {
      const scale = ARENA_RADIUS / radial;
      pos.x *= scale;
      pos.z *= scale;
      const rx = pos.x / ARENA_RADIUS;
      const rz = pos.z / ARENA_RADIUS;
      const outward = vel.x * rx + vel.z * rz;
      if (outward > 0) {
        vel.x -= rx * outward * 2;
        vel.z -= rz * outward * 2;
      }
    }
  }

  /**
   * A player requests to fire their primary gun. The server validates the shot
   * (facing + range) and, on a hit, applies authoritative damage immediately.
   * Returns the replicated shot event and, when damage was dealt, the damage
   * event. No client decides whether a shot lands.
   */
  attemptBullet(role: BattleRole, nowMs: number): { shot: ShotEvent; damage?: DamageEvent } | null {
    if (role !== 'attacker' && role !== 'defender') {
      return null;
    }

    // Server cooldown check.
    const last = this.lastBulletAt[role];
    const cooldownMs = role === 'attacker' ? ATTACKER_GUN_COOLDOWN_MS : DEFENDER_GUN_COOLDOWN_MS;
    if (last !== undefined && nowMs - last < cooldownMs) {
      return null;
    }
    this.lastBulletAt[role] = nowMs;

    const shooterRole = role;
    const shooterPlayerId = role === 'attacker' ? this.attackerPlayerId : this.defenderPlayerId;

    let muzzle: Vec3;
    let facingYawRad: number;
    let range: number;
    let targetPlayerId: string;
    let targetCenter: Vec3;

    if (role === 'defender') {
      // Turret sits at the arena origin; heading from turretRotation (degrees).
      muzzle = this.turretMuzzle();
      facingYawRad = degToRad(this.defender.turretRotation);
      range = DEFENDER_GUN_RANGE;
      targetPlayerId = this.attackerPlayerId;
      targetCenter = { ...this.attacker.aircraftPosition };
    } else {
      const pos = this.attacker.aircraftPosition;
      muzzle = { ...pos };
      facingYawRad = this.attacker.aircraftRotation.y;
      range = ATTACKER_GUN_RANGE;
      targetPlayerId = this.defenderPlayerId;
      targetCenter = { ...BASE_CENTER };
    }

    // Facing uses the horizontal angle between the shooter's facing and the line
    // to the target; range gates how far a shot can reach.
    const toTarget: Vec3 = {
      x: targetCenter.x - muzzle.x,
      y: targetCenter.y - muzzle.y,
      z: targetCenter.z - muzzle.z,
    };
    const distance = Math.hypot(toTarget.x, toTarget.y, toTarget.z);
    const facingTarget =
      Math.abs(angleDelta(facingYawRad, yawToFace(toTarget.x, toTarget.z))) <=
      degToRad(FACE_CONE_DEG);
    const hit = distance <= range && facingTarget;

    const dir = hit
      ? normalize(toTarget)
      : (() => {
          const fwd = forwardForYaw(facingYawRad);
          return { x: fwd.x, y: 0, z: fwd.z };
        })();

    const travelDistance = hit ? distance : range;
    const travelMs = (travelDistance / BULLET_SPEED) * 1000;

    const shot: ShotEvent = {
      shooterPlayerId,
      shooterRole,
      weapon: 'bullet',
      projectileId: `${role}-${nowMs}-${Math.floor(Math.random() * 1e6)}`,
      muzzle,
      dir,
      hit,
      travelDistance,
      travelMs,
      targetPlayerId: hit ? targetPlayerId : undefined,
    };

    if (!hit) {
      return { shot };
    }

    const targetRole: BattleRole = role === 'attacker' ? 'defender' : 'attacker';
    const damage = this.applyDamage(targetRole, BULLET_DAMAGE);
    return { shot, damage };
  }

  /** Applies authoritative damage to a target (shield first, then health). */
  applyDamage(targetRole: BattleRole, amount: number): DamageEvent {
    let hp: number;
    let shield: number;
    if (targetRole === 'attacker') {
      shield = this.attacker.shield;
      hp = this.attacker.health;
    } else {
      shield = this.defender.shield;
      hp = this.defender.health;
    }

    let remaining = Math.max(0, amount);
    const fromShield = Math.min(shield, remaining);
    shield -= fromShield;
    remaining -= fromShield;
    const fromHealth = Math.min(hp, remaining);
    hp -= fromHealth;

    if (targetRole === 'attacker') {
      this.attacker.shield = shield;
      this.attacker.health = hp;
    } else {
      this.defender.shield = shield;
      this.defender.health = hp;
    }

    if (hp <= 0 && this.winner === null) {
      this.winner = targetRole === 'attacker' ? 'defender' : 'attacker';
      this.finishedAt = Date.now();
    }

    return { targetRole, amount, remainingHealth: Math.max(0, hp), remainingShield: shield };
  }

  private turretMuzzle(): Vec3 {
    const a = degToRad(this.defender.turretRotation);
    const fwd = forwardForYaw(a);
    return { x: fwd.x * DEFENDER_MUZZLE_FWD, y: DEFENDER_MUZZLE_Y, z: fwd.z * DEFENDER_MUZZLE_FWD };
  }

  /** Plain, JSON-serializable snapshot for broadcasting to clients. */
  toSnapshot(): GameStateSnapshot {
    const attacker = this.attacker;
    const defender = this.defender;
    return {
      roomId: this.roomId,
      gameStarted: this.gameStarted,
      gameTime: this.gameTime,
      attackerPlayerId: this.attackerPlayerId,
      defenderPlayerId: this.defenderPlayerId,
      attacker: {
        ...attacker,
        aircraftPosition: { ...attacker.aircraftPosition },
        aircraftRotation: { ...attacker.aircraftRotation },
        aircraftVelocity: { ...attacker.aircraftVelocity },
      },
      defender: { ...defender },
      powerAllocation: { ...this.powerAllocation },
      availablePower: this.availablePower,
      materials: this.materials,
      arenaRadius: ARENA_RADIUS,
      winner: this.winner,
    };
  }
}


