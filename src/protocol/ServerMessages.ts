import type { GameStateSnapshot } from '../game/GameState';
import type { PowerAllocation } from '../game/PowerAllocation';
import type { Role } from '../rooms/GameRoom';
/**
 * Server -> client messages. Always built with the shared envelope via
 * `createServerMessage` so the wire format stays consistent.
 */

export interface ServerMessage<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  type: string;
  requestId?: string;
  timestamp: number;
  data: TData;
}

export function createServerMessage<TData extends Record<string, unknown>>(
  type: string,
  data: TData,
  requestId?: string,
): ServerMessage<TData> {
  return { type, data, requestId, timestamp: Date.now() };
}

// --- Payload shapes ---

export interface WelcomeData {
  connectionId: string;
  protocolVersion: number;
}

export interface IdentifiedData {
  playerId: string;
}

export interface PongData {
  serverTime: number;
  echo: Record<string, unknown>;
}

export interface MatchSearchingData {
  position: number;
}

export interface MatchFoundData {
  roomId: string;
  role: Role;
}

export interface RoomJoinedData {
  roomId: string;
  role: Role;
  opponentPlayerId: string;
  gameStarted: boolean;
}

export interface RoomLeftData {
  roomId: string;
  reason: 'player_left' | 'opponent_left' | 'opponent_disconnected' | 'time_limit' | 'battle_ended';
}

export interface GameStateData {
  snapshot: GameStateSnapshot;
}

export interface PlayerStateData {
  playerId: string;
  // Future: position, rotation, velocity, health, shield, energy, ammo, missiles
}

export interface TurretStateData {
  rotation: number;
  barrel: number;
  heat: number;
}

export interface ShotVector {
  x: number;
  y: number;
  z: number;
}

export interface WeaponFiredData {
  roomId: string;
  playerId: string;
  shooterRole: string;
  weapon: string;
  projectileId: string;
  muzzle: ShotVector;
  dir: ShotVector;
  hit: boolean;
  travelDistance: number;
  travelMs: number;
  targetPlayerId?: string;
}

export interface DamageData {
  targetRole: string;
  targetId: string;
  amount: number;
  remainingHealth: number;
  remainingShield: number;
}

export interface BattleFinishedData {
  roomId: string;
  winner: Role;
  gameTime: number;
  attackerHealth: number;
  defenderHealth: number;
}

export interface ResourceUpdateData {
  ammo: number;
  missiles: number;
  materials: number;
}

export interface PowerUpdateData {
  allocation: PowerAllocation;
  total: number;
  available: number;
}

export interface ServerErrorData {
  code: string;
  message: string;
}

export interface ServerMessageData {
  code: string;
  message: string;
}
