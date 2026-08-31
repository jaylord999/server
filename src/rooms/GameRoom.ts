import { randomUUID } from 'crypto';
import { GameState } from '../game/GameState';

export type Role = 'attacker' | 'defender';

export interface RoomOptions {
  maxPower: number;
  gameTimeLimitSeconds: number;
  maxPlayerSpeed: number;
}

/**
 * One active battle. For this milestone a room contains exactly:
 *   1 Defender + 1 Attacker
 *
 * Rooms live entirely in memory and are destroyed when the battle ends or a
 * player leaves.
 */
export class GameRoom {
  readonly roomId: string;
  readonly attackerPlayerId: string;
  readonly defenderPlayerId: string;
  readonly state: GameState;
  readonly createdAt: number;
  startedAt: number | null = null;
  /** Timestamp of the last simulation tick (used to compute dt). */
  lastTickAt: number;

  constructor(attackerPlayerId: string, defenderPlayerId: string, options: RoomOptions) {
    this.roomId = randomUUID();
    this.attackerPlayerId = attackerPlayerId;
    this.defenderPlayerId = defenderPlayerId;
    this.state = new GameState(
      this.roomId,
      attackerPlayerId,
      defenderPlayerId,
      options.maxPower,
      options.gameTimeLimitSeconds,
      options.maxPlayerSpeed,
    );
    this.createdAt = Date.now();
    this.lastTickAt = Date.now();
  }

  start(): void {
    if (this.startedAt === null) {
      this.startedAt = Date.now();
      this.state.start();
    }
  }

  containsPlayer(playerId: string): boolean {
    return playerId === this.attackerPlayerId || playerId === this.defenderPlayerId;
  }

  getRole(playerId: string): Role | null {
    if (playerId === this.attackerPlayerId) {
      return 'attacker';
    }
    if (playerId === this.defenderPlayerId) {
      return 'defender';
    }
    return null;
  }

  getOtherPlayer(playerId: string): string | null {
    if (playerId === this.attackerPlayerId) {
      return this.defenderPlayerId;
    }
    if (playerId === this.defenderPlayerId) {
      return this.attackerPlayerId;
    }
    return null;
  }
}
