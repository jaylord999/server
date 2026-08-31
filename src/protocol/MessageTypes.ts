/**
 * Wire protocol definitions.
 *
 * Every message uses a consistent envelope:
 *
 *   {
 *     "type": "message_type",      // mandatory
 *     "requestId": "optional-id",  // optional, echoed by the server
 *     "timestamp": 123456789,      // client-supplied, always present server-side
 *     "data": {}                   // payload, always an object
 *   }
 */

export const ClientMessageType = {
  IDENTIFY: 'identify',
  PING: 'ping',
  FIND_MATCH: 'find_match',
  CANCEL_MATCH: 'cancel_match',
  LEAVE_ROOM: 'leave_room',
  PLAYER_INPUT: 'player_input',
  TURRET_INPUT: 'turret_input',
  FIRE_WEAPON: 'fire_weapon',
  POWER_ALLOCATION: 'power_allocation',
} as const;

export type ClientMessageType = (typeof ClientMessageType)[keyof typeof ClientMessageType];

export const ServerMessageType = {
  WELCOME: 'welcome',
  IDENTIFIED: 'identified',
  PONG: 'pong',
  MATCH_SEARCHING: 'match_searching',
  MATCH_FOUND: 'match_found',
  ROOM_JOINED: 'room_joined',
  ROOM_LEFT: 'room_left',
  GAME_STATE: 'game_state',
  PLAYER_STATE: 'player_state',
  TURRET_STATE: 'turret_state',
  WEAPON_FIRED: 'weapon_fired',
  DAMAGE: 'damage',
  RESOURCE_UPDATE: 'resource_update',
  POWER_UPDATE: 'power_update',
  ERROR: 'error',
  SERVER_MESSAGE: 'server_message',
} as const;

export type ServerMessageType = (typeof ServerMessageType)[keyof typeof ServerMessageType];

/** Machine-readable error codes returned inside `error` messages. */
export const ErrorCode = {
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  UNKNOWN_MESSAGE: 'UNKNOWN_MESSAGE',
  ALREADY_IDENTIFIED: 'ALREADY_IDENTIFIED',
  NOT_IDENTIFIED: 'NOT_IDENTIFIED',
  INVALID_INPUT: 'INVALID_INPUT',
  ALREADY_IN_QUEUE: 'ALREADY_IN_QUEUE',
  NOT_IN_QUEUE: 'NOT_IN_QUEUE',
  ALREADY_IN_ROOM: 'ALREADY_IN_ROOM',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  INVALID_POWER_ALLOCATION: 'INVALID_POWER_ALLOCATION',
  WEAPON_UNAVAILABLE: 'WEAPON_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
