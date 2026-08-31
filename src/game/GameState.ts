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
 * Combat (damage, rewards, ammo consumption) is deliberately stubbed for this
 * milestone but every result is produced here so it can be extended safely.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

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
  turretRotation: number;
  barrelAngle: number;
  turretHeat: number;
  turretLevel: number;
  generatorLevel: number;
  shieldLevel: number;
}

export interface AttackerInput {
  throttle: number;
  pitch: number;
  yaw: number;
  receivedAt: number;
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
}

export function createDefaultAttackerState(): AttackerState {
  return {
    aircraftPosition: { x: 0, y: 0, z: 0 },
    aircraftRotation: { x: 0, y: 0, z: 0 },
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
  };
}

export class GameState {
  gameStarted = false;
  gameTime = 0;
  startedAt: number | null = null;
  materials = 0;
  /** Latest validated attacker input (from the attacker role only). */
  attackerInput: AttackerInput | null = null;
  lastBulletFiredAt = 0;
  lastMissileFiredAt = 0;

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
    if (!this.gameStarted) {
      return;
    }
    this.gameTime += dt;
    this.applyAttackerInput(dt);
  }

  get finished(): boolean {
    return this.maxGameTimeSeconds > 0 && this.gameTime >= this.maxGameTimeSeconds;
  }

  get powerTotal(): number {
    return sumPower(this.powerAllocation);
  }

  /**
   * Minimal, deterministic aircraft integration. Not real physics - the goal of
   * this milestone is the network architecture. It is replaced/upgraded later.
   */
  private applyAttackerInput(dt: number): void {
    const input = this.attackerInput;
    if (!input) {
      return;
    }
    const max = this.maxPlayerSpeed;
    const target: Vec3 = {
      x: input.yaw * max,
      y: input.pitch * max,
      z: input.throttle * max,
    };
    const lerp = Math.min(1, dt * 5);
    const velocity = this.attacker.aircraftVelocity;
    velocity.x += (target.x - velocity.x) * lerp;
    velocity.y += (target.y - velocity.y) * lerp;
    velocity.z += (target.z - velocity.z) * lerp;

    const position = this.attacker.aircraftPosition;
    position.x += velocity.x * dt;
    position.y += velocity.y * dt;
    position.z += velocity.z * dt;
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
    };
  }
}
