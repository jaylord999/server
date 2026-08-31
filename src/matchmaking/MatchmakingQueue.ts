/**
 * Matchmaking foundation.
 *
 * For now: a simple FIFO queue. Role assignment is deterministic - the first
 * queued player becomes the attacker, the second becomes the defender.
 *
 * Future rules (level, base level, availability, region, rating) slot into the
 * `pollMatch` step without changing the connection or room architecture.
 */

export interface MatchPair {
  attackerPlayerId: string;
  defenderPlayerId: string;
}

export class MatchmakingQueue {
  private readonly queue: string[] = [];

  /** Adds a player; returns false if the player is already queued. */
  enqueue(playerId: string): boolean {
    if (this.queue.includes(playerId)) {
      return false;
    }
    this.queue.push(playerId);
    return true;
  }

  remove(playerId: string): boolean {
    const index = this.queue.indexOf(playerId);
    if (index === -1) {
      return false;
    }
    this.queue.splice(index, 1);
    return true;
  }

  isWaiting(playerId: string): boolean {
    return this.queue.includes(playerId);
  }

  size(): number {
    return this.queue.length;
  }

  peek(): string | undefined {
    return this.queue[0];
  }

  /** Pops two players when available; null while fewer than two are waiting. */
  pollMatch(): MatchPair | null {
    if (this.queue.length < 2) {
      return null;
    }
    const attackerPlayerId = this.queue.shift() as string;
    const defenderPlayerId = this.queue.shift() as string;
    return { attackerPlayerId, defenderPlayerId };
  }
}
