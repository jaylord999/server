export type LogTag =
  | 'SERVER'
  | 'NETWORK'
  | 'MATCHMAKING'
  | 'ROOM'
  | 'GAME'
  | 'ERROR';

/**
 * Structured console logging with a tag prefix, e.g. `[NETWORK] Client connected`.
 * Kept intentionally tiny so it never floods the console.
 */
export function log(tag: LogTag, message: string): void {
  console.log(`[${tag}] ${message}`);
}
