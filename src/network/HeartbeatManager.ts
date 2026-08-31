import { WebSocket } from 'ws';
import { ConnectionManager, ServerConnection } from './ConnectionManager';

/**
 * Lightweight WebSocket heartbeat.
 *
 * Every HEARTBEAT_INTERVAL_MS the server sends a protocol-level ping frame.
 * Standard WebSocket clients reply with a pong frame automatically. Any client
 * that has not produced activity (pong or any message) within
 * HEARTBEAT_TIMEOUT_MS is considered dead and is closed/cleaned up.
 *
 * During an active battle the connection continuously exchanges gameplay
 * messages, so the heartbeat stays quiet and traffic is not wasted.
 */
export class HeartbeatManager {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly intervalMs: number,
    private readonly timeoutMs: number,
    private readonly onTimeout: (connectionId: string) => void,
  ) {}

  /** Attach pong tracking to a connection (call once per accepted connection). */
  track(connection: ServerConnection): void {
    connection.socket.on('pong', () => {
      connection.lastPongAt = Date.now();
    });
    connection.lastPongAt = Date.now();
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => this.check(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private check(): void {
    const now = Date.now();
    for (const connection of this.connectionManager.list()) {
      if (now - connection.lastPongAt > this.timeoutMs) {
        this.onTimeout(connection.id);
        continue;
      }
      if (connection.socket.readyState === WebSocket.OPEN) {
        connection.socket.ping();
      }
    }
  }
}
