import {
  ClientMessage,
  parseClientMessage,
} from '../protocol/ClientMessages';
import { ClientMessageType, ErrorCode, ServerMessageType } from '../protocol/MessageTypes';
import { createServerMessage } from '../protocol/ServerMessages';
import { ConnectionManager } from './ConnectionManager';

/**
 * Routes incoming raw WebSocket payloads to the registered handler for the
 * message `type`. Enforces the envelope: malformed JSON and unknown types are
 * rejected with a structured `error` message instead of crashing.
 */

export type MessageHandler = (connectionId: string, message: ClientMessage) => void;

const KNOWN_CLIENT_TYPES: ReadonlySet<string> = new Set(Object.values(ClientMessageType));

export class MessageRouter {
  private readonly handlers = new Map<string, MessageHandler>();

  constructor(private readonly connectionManager: ConnectionManager) {}

  register(type: string, handler: MessageHandler): void {
    this.handlers.set(type, handler);
  }

  handleRawMessage(connectionId: string, raw: string): void {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.sendError(connectionId, ErrorCode.INVALID_MESSAGE, parsed.error);
      return;
    }

    const message = parsed.message;

    if (!KNOWN_CLIENT_TYPES.has(message.type)) {
      this.sendError(
        connectionId,
        ErrorCode.UNKNOWN_MESSAGE,
        `Unknown message type "${message.type}".`,
        message.requestId,
      );
      return;
    }

    const handler = this.handlers.get(message.type);
    if (!handler) {
      this.sendError(
        connectionId,
        ErrorCode.UNKNOWN_MESSAGE,
        `No handler registered for message type "${message.type}".`,
        message.requestId,
      );
      return;
    }

    // Any accepted message proves the client is alive.
    this.connectionManager.touch(connectionId);
    handler(connectionId, message);
  }

  private sendError(connectionId: string, code: string, message: string, requestId?: string): void {
    this.connectionManager.send(
      connectionId,
      createServerMessage(ServerMessageType.ERROR, { code, message }, requestId),
    );
  }
}
