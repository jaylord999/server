/**
 * Server-side representation of a connected/identified game client.
 *
 * Kept intentionally lightweight for this milestone. Later additions include:
 * accountId, base configuration, level, upgrades, statistics, ...
 */

export type PlayerConnectionState =
  | 'connecting'
  | 'identified'
  | 'in_queue'
  | 'in_room'
  | 'disconnected'
  | 'reconnecting';

export interface Player {
  /** Temporary UUID for now; replaced by account IDs once auth exists. */
  playerId: string;
  /** Connection that this player is currently attached to. */
  connectionId: string;
  state: PlayerConnectionState;
  /** Room the player is currently fighting in, or null. */
  roomId: string | null;
  /** Value sent in the `identify` message. */
  clientVersion: string | null;
  connectedAt: number;
  lastActiveAt: number;
}

export function createPlayer(connectionId: string, playerId: string): Player {
  return {
    playerId,
    connectionId,
    state: 'identified',
    roomId: null,
    clientVersion: null,
    connectedAt: Date.now(),
    lastActiveAt: Date.now(),
  };
}
