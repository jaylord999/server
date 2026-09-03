/**
 * Matchmaking queue.
 *
 * This queue holds the players who pressed FIND ENEMY and are waiting for an
 * available defender to be matched against. Unlike the earlier FIFO-of-two
 * model (which required BOTH players to search), only the searching player is
 * queued here. The server then matches the head of the queue against an
 * already-online, available player (see the `findAvailableDefender` logic in
 * main.ts).
 *
 * The queue remains a FIFO so that when a defender becomes available, the
 * searching player who has waited the longest is satisfied first. This can be
 * extended later (rating, region, mode buckets) without touching the room /
 * connection architecture.
 *
 * This class is intentionally thin (a list of waiting attacker ids). The actual
 * "which defender to pick" and "create the room" decisions live in main.ts
 * because they need PlayerManager / RoomManager / ConnectionManager.
 */

export class MatchmakingQueue {
  private readonly waitingAttackers: string[] = [];

  /** Adds a searching (attacker) player. Returns false if already present. */
  search(playerId: string): boolean {
    if (this.waitingAttackers.includes(playerId)) {
      return false;
    }
    this.waitingAttackers.push(playerId);
    return true;
  }

  /** Alias of search() kept for compatibility. */
  enqueue(playerId: string): boolean {
    return this.search(playerId);
  }

  /** Removes a waiting player (cancel). Returns false if they were not waiting. */
  cancel(playerId: string): boolean {
    const index = this.waitingAttackers.indexOf(playerId);
    if (index === -1) {
      return false;
    }
    this.waitingAttackers.splice(index, 1);
    return true;
  }

  /** Alias of cancel() kept for compatibility. */
  remove(playerId: string): boolean {
    return this.cancel(playerId);
  }

  isSearching(playerId: string): boolean {
    return this.waitingAttackers.includes(playerId);
  }

  /** Alias of isSearching() kept for compatibility. */
  isWaiting(playerId: string): boolean {
    return this.isSearching(playerId);
  }

  /** Snapshot of the currently searching (attacker) players, FIFO order. */
  waiting(): string[] {
    return [...this.waitingAttackers];
  }

  /** Number of players currently searching for a target. */
  size(): number {
    return this.waitingAttackers.length;
  }
}
