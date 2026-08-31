import { randomUUID } from 'crypto';
import { createPlayer, Player, PlayerConnectionState } from './Player';

/**
 * In-memory registry of players. One player per connection for now.
 *
 * Future: persistence, accounts, statistics, etc. are layered on top of this
 * without changing the connection/message architecture.
 */
export class PlayerManager {
  private readonly players = new Map<string, Player>();
  private readonly byConnection = new Map<string, string>();

  /** Returns the existing player for the connection, or creates a new one. */
  createPlayer(connectionId: string): Player {
    const existing = this.getByConnectionId(connectionId);
    if (existing) {
      return existing;
    }
    const playerId = randomUUID();
    const player = createPlayer(connectionId, playerId);
    this.players.set(playerId, player);
    this.byConnection.set(connectionId, playerId);
    return player;
  }

  getById(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  getByConnectionId(connectionId: string): Player | undefined {
    const playerId = this.byConnection.get(connectionId);
    return playerId === undefined ? undefined : this.players.get(playerId);
  }

  has(playerId: string): boolean {
    return this.players.has(playerId);
  }

  size(): number {
    return this.players.size;
  }

  list(): Player[] {
    return [...this.players.values()];
  }

  setState(playerId: string, state: PlayerConnectionState): void {
    const player = this.players.get(playerId);
    if (player) {
      player.state = state;
      player.lastActiveAt = Date.now();
    }
  }

  setRoom(playerId: string, roomId: string | null): void {
    const player = this.players.get(playerId);
    if (player) {
      player.roomId = roomId;
    }
  }

  setClientVersion(playerId: string, clientVersion: string): void {
    const player = this.players.get(playerId);
    if (player) {
      player.clientVersion = clientVersion;
    }
  }

  remove(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) {
      return false;
    }
    this.byConnection.delete(player.connectionId);
    this.players.delete(playerId);
    return true;
  }

  /** Removes the player attached to a connection; returns the playerId or null. */
  removeByConnection(connectionId: string): string | null {
    const playerId = this.byConnection.get(connectionId) ?? null;
    if (playerId) {
      this.remove(playerId);
    }
    return playerId;
  }
}
