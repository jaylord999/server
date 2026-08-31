import { randomUUID } from 'crypto';
import { WebSocket } from 'ws';

/**
 * Server-side view of a single WebSocket connection.
 *
 * Tracks identity binding (connection <-> player), liveness for the heartbeat
 * system, and provides JSON-serialized sends.
 */
export interface ServerConnection {
  /** Temporary connection id, created by the server on connect. */
  id: string;
  socket: WebSocket;
  /** Bound player id (set after a successful `identify`). */
  playerId: string | null;
  identified: boolean;
  connectedAt: number;
  /** Last time a pong frame or any client message was observed. */
  lastPongAt: number;
  lastMessageAt: number;
}

export class ConnectionManager {
  private readonly connections = new Map<string, ServerConnection>();
  private readonly playerToConnection = new Map<string, string>();

  add(socket: WebSocket): ServerConnection {
    const id = randomUUID();
    const connection: ServerConnection = {
      id,
      socket,
      playerId: null,
      identified: false,
      connectedAt: Date.now(),
      lastPongAt: Date.now(),
      lastMessageAt: Date.now(),
    };
    this.connections.set(id, connection);
    return connection;
  }

  get(connectionId: string): ServerConnection | undefined {
    return this.connections.get(connectionId);
  }

  getByPlayerId(playerId: string): ServerConnection | undefined {
    const connectionId = this.playerToConnection.get(playerId);
    return connectionId === undefined ? undefined : this.connections.get(connectionId);
  }

  size(): number {
    return this.connections.size;
  }

  list(): ServerConnection[] {
    return [...this.connections.values()];
  }

  bindPlayer(connectionId: string, playerId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }
    if (connection.playerId) {
      this.playerToConnection.delete(connection.playerId);
    }
    connection.playerId = playerId;
    connection.identified = true;
    this.playerToConnection.set(playerId, connectionId);
  }

  /** Any incoming message counts as liveness for the heartbeat system. */
  touch(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.lastMessageAt = Date.now();
      connection.lastPongAt = Date.now();
    }
  }

  markPong(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.lastPongAt = Date.now();
    }
  }

  send(connectionId: string, payload: unknown): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return false;
    }
    if (connection.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    connection.socket.send(JSON.stringify(payload));
    return true;
  }

  sendToPlayer(playerId: string, payload: unknown): boolean {
    const connection = this.getByPlayerId(playerId);
    return connection !== undefined && this.send(connection.id, payload);
  }

  remove(connectionId: string): ServerConnection | undefined {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return undefined;
    }
    if (connection.playerId) {
      this.playerToConnection.delete(connection.playerId);
    }
    this.connections.delete(connectionId);
    return connection;
  }
}
