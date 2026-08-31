import { GameRoom, RoomOptions } from './GameRoom';

/**
 * In-memory registry of active battle rooms. No database for live battles.
 */
export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();

  createRoom(attackerPlayerId: string, defenderPlayerId: string, options: RoomOptions): GameRoom {
    const room = new GameRoom(attackerPlayerId, defenderPlayerId, options);
    this.rooms.set(room.roomId, room);
    return room;
  }

  getRoom(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId);
  }

  /** Find the room a player currently belongs to. */
  getRoomByPlayer(playerId: string): GameRoom | undefined {
    for (const room of this.rooms.values()) {
      if (room.containsPlayer(playerId)) {
        return room;
      }
    }
    return undefined;
  }

  removeRoom(roomId: string): GameRoom | undefined {
    const room = this.rooms.get(roomId);
    if (room) {
      this.rooms.delete(roomId);
    }
    return room;
  }

  listRooms(): GameRoom[] {
    return [...this.rooms.values()];
  }

  size(): number {
    return this.rooms.size;
  }
}
