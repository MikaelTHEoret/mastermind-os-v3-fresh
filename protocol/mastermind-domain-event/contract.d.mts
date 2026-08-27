export type MastermindDomainEventDomain =
  | 'world'
  | 'backup'
  | 'mod'
  | 'companion'
  | 'player'
  | 'workshop'
  | 'system';

export type MastermindDomainEventVisibility = 'private' | 'family' | 'system';

export type MastermindDomainEventJsonValue =
  | null
  | boolean
  | number
  | string
  | MastermindDomainEventJsonValue[]
  | { [key: string]: MastermindDomainEventJsonValue };

export interface MastermindDomainEvent {
  eventId: string;
  schemaVersion: 1;
  occurredAt: string;
  producer: string;
  domain: MastermindDomainEventDomain;
  kind: string;
  namespace: string;
  householdId: string;
  visibility: MastermindDomainEventVisibility;
  payload: Record<string, MastermindDomainEventJsonValue>;
  playerId?: string;
  worldRef?: string;
  sessionId?: string;
  correlationId?: string;
}

export type MastermindDomainEventInput =
  Omit<MastermindDomainEvent, 'eventId' | 'schemaVersion' | 'occurredAt'>
  & Partial<Pick<MastermindDomainEvent, 'eventId' | 'occurredAt'>>
  & { schemaVersion?: 1 };

export interface CreateMastermindDomainEventOptions {
  now?: () => number;
  randomUUID?: () => string;
}

export const MASTERMIND_DOMAIN_EVENT_SCHEMA_VERSION: 1;
export const MASTERMIND_DOMAIN_EVENT_MAX_BYTES: number;

export class MastermindDomainEventError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

export function validateMastermindDomainEvent(value: unknown): MastermindDomainEvent;
export function canonicalMastermindDomainEvent(value: unknown): string;
export function createMastermindDomainEvent(
  input: MastermindDomainEventInput,
  options?: CreateMastermindDomainEventOptions,
): MastermindDomainEvent;
export function deterministicMastermindEventId(parts: readonly string[]): string;
