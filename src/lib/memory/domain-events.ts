import crypto from 'node:crypto';

import {
  MASTERMIND_DOMAIN_EVENT_MAX_BYTES,
  MastermindDomainEventError,
  canonicalMastermindDomainEvent,
  validateMastermindDomainEvent,
} from '../../../protocol/mastermind-domain-event/contract.mjs';
import {
  LocalServiceRequestBodyError,
  LocalServiceRequestAuthError,
  authorizeLocalServiceRequest,
  readBoundedJsonRequestBody,
  type LocalServiceAuthEnvironment,
} from './local-service-auth.ts';

const EVENT_PATH = '/api/memory/events';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_CODE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SAFE_ACTION_KIND = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/;

type JsonObject = Record<string, unknown>;

export type MastermindDomainEvent = {
  eventId: string;
  schemaVersion: 1;
  occurredAt: string;
  producer: string;
  domain: string;
  kind: string;
  namespace: string;
  householdId: string;
  playerId?: string;
  worldRef?: string;
  sessionId?: string;
  correlationId?: string;
  visibility: 'private' | 'family' | 'system';
  payload: JsonObject;
};

export type PreparedMastermindDomainEvent = Readonly<{
  event: MastermindDomainEvent;
  canonicalJson: string;
  digest: string;
  sanitizedPayload: Readonly<JsonObject> | null;
}>;

export type MastermindDomainEventCommitResult = Readonly<{
  status: 'applied' | 'duplicate' | 'conflict';
  eventId: string;
}>;

export type MastermindDomainEventSql = (
  strings: TemplateStringsArray,
  ...parameters: unknown[]
) => PromiseLike<unknown>;

export type MemoryEventRouteEnvironment = LocalServiceAuthEnvironment;

export type MemoryEventRouteDependencies = Readonly<{
  env: MemoryEventRouteEnvironment;
  getSql: () => MastermindDomainEventSql;
}>;

export class MemoryEventRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MemoryEventRequestError';
    this.status = status;
    this.code = code;
  }
}

function requestError(status: number, code: string, message: string): never {
  throw new MemoryEventRequestError(status, code, message);
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactPayload(payload: JsonObject, required: readonly string[], optional: readonly string[] = []): void {
  const permitted = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(payload, key))
    || Object.keys(payload).some((key) => !permitted.has(key))
  ) {
    requestError(400, 'EVENT_KIND_PAYLOAD_INVALID', 'The event payload does not match its event kind.');
  }
}

function requireString(value: unknown, pattern: RegExp, maximum: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || !pattern.test(value)) {
    requestError(400, 'EVENT_KIND_PAYLOAD_INVALID', 'The event payload does not match its event kind.');
  }
  return value;
}

function requireCanonicalTimestamp(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length !== 24
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    requestError(400, 'EVENT_KIND_PAYLOAD_INVALID', 'The event payload does not match its event kind.');
  }
  return value;
}

function requireActionIdentity(event: MastermindDomainEvent, payload: JsonObject): { actionId: string; actionKind: string } {
  const actionId = requireString(payload.actionId, UUID, 36);
  const actionKind = requireString(payload.actionKind, SAFE_ACTION_KIND, 64);
  if (event.correlationId !== actionId) {
    requestError(400, 'EVENT_KIND_PAYLOAD_INVALID', 'The event payload does not match its event correlation.');
  }
  return { actionId, actionKind };
}

function sanitizeKnownPayload(event: MastermindDomainEvent): Readonly<JsonObject> | null {
  if (event.domain !== 'companion') return null;
  const payload = event.payload;

  if (event.kind === 'session.started') {
    exactPayload(payload, ['state']);
    if (payload.state !== 'ready') {
      requestError(400, 'EVENT_KIND_PAYLOAD_INVALID', 'The event payload does not match its event kind.');
    }
    return Object.freeze({ state: 'ready' });
  }

  if (event.kind === 'session.ended') {
    exactPayload(payload, ['code', 'reason']);
    if (!Number.isSafeInteger(payload.code) || Number(payload.code) < 1_000 || Number(payload.code) > 4_999) {
      requestError(400, 'EVENT_KIND_PAYLOAD_INVALID', 'The event payload does not match its event kind.');
    }
    const reason = requireString(payload.reason, SAFE_CODE, 64);
    return Object.freeze({ code: Number(payload.code), reason });
  }

  if (event.kind === 'action.requested') {
    exactPayload(payload, ['actionId', 'actionKind', 'status'], ['deadlineAt']);
    const { actionId, actionKind } = requireActionIdentity(event, payload);
    if (payload.status !== 'dispatched') {
      requestError(400, 'EVENT_KIND_PAYLOAD_INVALID', 'The event payload does not match its event kind.');
    }
    const sanitized: JsonObject = { actionId, actionKind, status: 'dispatched' };
    if (Object.prototype.hasOwnProperty.call(payload, 'deadlineAt')) {
      sanitized.deadlineAt = requireCanonicalTimestamp(payload.deadlineAt);
    }
    return Object.freeze(sanitized);
  }

  if (event.kind === 'action.completed') {
    exactPayload(payload, ['actionId', 'actionKind', 'status'], ['resultCode']);
    const { actionId, actionKind } = requireActionIdentity(event, payload);
    if (payload.status !== 'succeeded') {
      requestError(400, 'EVENT_KIND_PAYLOAD_INVALID', 'The event payload does not match its event kind.');
    }
    const sanitized: JsonObject = { actionId, actionKind, status: 'succeeded' };
    if (Object.prototype.hasOwnProperty.call(payload, 'resultCode')) {
      sanitized.resultCode = requireString(payload.resultCode, SAFE_CODE, 64);
    }
    return Object.freeze(sanitized);
  }

  if (event.kind === 'action.blocked') {
    exactPayload(payload, ['actionId', 'actionKind', 'status'], ['errorCode', 'cancellationReason']);
    const { actionId, actionKind } = requireActionIdentity(event, payload);
    if (payload.status !== 'failed' && payload.status !== 'cancelled') {
      requestError(400, 'EVENT_KIND_PAYLOAD_INVALID', 'The event payload does not match its event kind.');
    }
    if (
      (payload.status === 'failed' && Object.prototype.hasOwnProperty.call(payload, 'cancellationReason'))
      || (payload.status === 'cancelled' && Object.prototype.hasOwnProperty.call(payload, 'errorCode'))
    ) {
      requestError(400, 'EVENT_KIND_PAYLOAD_INVALID', 'The event payload does not match its event status.');
    }
    const sanitized: JsonObject = { actionId, actionKind, status: payload.status };
    for (const key of ['errorCode', 'cancellationReason'] as const) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        sanitized[key] = requireString(payload[key], SAFE_CODE, 64);
      }
    }
    return Object.freeze(sanitized);
  }

  return null;
}

export function prepareCanonicalMastermindDomainEvent(rawJson: string): PreparedMastermindDomainEvent {
  if (typeof rawJson !== 'string' || Buffer.byteLength(rawJson, 'utf8') > MASTERMIND_DOMAIN_EVENT_MAX_BYTES) {
    requestError(413, 'EVENT_TOO_LARGE', 'The domain event exceeds the 64 KiB limit.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    requestError(400, 'EVENT_INVALID_JSON', 'The request body is not valid JSON.');
  }

  let event: MastermindDomainEvent;
  let canonicalJson: string;
  try {
    event = validateMastermindDomainEvent(parsed) as MastermindDomainEvent;
    canonicalJson = canonicalMastermindDomainEvent(event);
  } catch (error) {
    if (error instanceof MastermindDomainEventError) {
      requestError(400, error.code, 'The domain event does not satisfy the shared event contract.');
    }
    requestError(400, 'EVENT_INVALID', 'The domain event does not satisfy the shared event contract.');
  }

  if (rawJson !== canonicalJson) {
    requestError(400, 'EVENT_NON_CANONICAL', 'The request body must use the canonical domain-event JSON encoding.');
  }

  const sanitizedPayload = sanitizeKnownPayload(event);
  const digest = crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
  Object.freeze(event.payload);
  Object.freeze(event);
  return Object.freeze({ event, canonicalJson, digest, sanitizedPayload });
}

function exactIngestRow(value: unknown, expectedEventId: string): MastermindDomainEventCommitResult {
  if (!isObject(value) || Object.keys(value).length !== 2 || !Object.prototype.hasOwnProperty.call(value, 'status')
    || !Object.prototype.hasOwnProperty.call(value, 'eventId')) {
    throw new Error('The memory event store returned an invalid receipt result.');
  }
  if (!['applied', 'duplicate', 'conflict'].includes(String(value.status)) || value.eventId !== expectedEventId) {
    throw new Error('The memory event store returned an invalid receipt result.');
  }
  return Object.freeze({
    status: value.status as MastermindDomainEventCommitResult['status'],
    eventId: expectedEventId,
  });
}

export async function commitMastermindDomainEvent(
  sql: MastermindDomainEventSql,
  prepared: PreparedMastermindDomainEvent,
): Promise<MastermindDomainEventCommitResult> {
  if (typeof sql !== 'function') throw new TypeError('A memory database query function is required.');
  const { event, digest, sanitizedPayload } = prepared;
  const payloadJson = sanitizedPayload === null ? null : JSON.stringify(sanitizedPayload);
  const result = await sql`
    SELECT status, event_id::text AS "eventId"
    FROM public.ingest_mastermind_domain_event_v1(
      ${event.eventId}::uuid,
      ${event.schemaVersion}::smallint,
      ${digest}::text,
      ${event.occurredAt}::timestamptz,
      ${event.producer}::text,
      ${event.domain}::text,
      ${event.kind}::text,
      ${event.namespace}::text,
      ${event.householdId}::text,
      ${event.playerId ?? null}::text,
      ${event.worldRef ?? null}::text,
      ${event.sessionId ?? null}::uuid,
      ${event.correlationId ?? null}::uuid,
      ${event.visibility}::text,
      ${payloadJson}::jsonb
    )
  `;
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('The memory event store returned an invalid receipt result.');
  }
  return exactIngestRow(result[0], event.eventId);
}

export function authorizeMastermindMemoryEventRequest(
  request: Request,
  env: MemoryEventRouteEnvironment,
): void {
  try {
    authorizeLocalServiceRequest(request, env, {
      method: 'POST',
      path: EVENT_PATH,
      messages: {
        disabled: 'The local memory-event receiver is disabled.',
        loopbackRequired: 'The memory-event receiver accepts only direct loopback requests.',
        unauthorized: 'A valid local control bearer token is required.',
      },
    });
  } catch (error) {
    if (error instanceof LocalServiceRequestAuthError) {
      requestError(error.status, error.code, error.message);
    }
    throw error;
  }
}

export async function readCanonicalMemoryEventBody(request: Request): Promise<string> {
  try {
    return await readBoundedJsonRequestBody(request, { maxBytes: MASTERMIND_DOMAIN_EVENT_MAX_BYTES });
  } catch (error) {
    if (!(error instanceof LocalServiceRequestBodyError)) throw error;
    if (error.code === 'BODY_TOO_LARGE') {
      requestError(413, 'EVENT_TOO_LARGE', 'The domain event exceeds the 64 KiB limit.');
    }
    if (error.code === 'INVALID_UTF8') {
      requestError(400, 'EVENT_INVALID_UTF8', 'The request body is not valid UTF-8.');
    }
    if (error.code === 'UNSUPPORTED_CONTENT_TYPE') {
      requestError(415, error.code, 'The memory-event receiver accepts canonical JSON only.');
    }
    if (error.code === 'UNSUPPORTED_CONTENT_ENCODING') {
      requestError(415, error.code, 'Encoded memory-event request bodies are not supported.');
    }
    requestError(error.status, error.code, error.message);
  }
}

const RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
});

function errorResponse(error: MemoryEventRequestError): Response {
  const headers = new Headers(RESPONSE_HEADERS);
  if (error.status === 401) headers.set('WWW-Authenticate', 'Bearer');
  return Response.json(
    { ok: false, code: error.code, message: error.message },
    { status: error.status, headers },
  );
}

export async function handleMastermindMemoryEventPost(
  request: Request,
  dependencies: MemoryEventRouteDependencies,
): Promise<Response> {
  try {
    authorizeMastermindMemoryEventRequest(request, dependencies.env);
    const rawJson = await readCanonicalMemoryEventBody(request);
    const prepared = prepareCanonicalMastermindDomainEvent(rawJson);
    const result = await commitMastermindDomainEvent(dependencies.getSql(), prepared);
    if (result.status === 'conflict') {
      return errorResponse(new MemoryEventRequestError(
        409,
        'EVENT_ID_CONFLICT',
        'The event ID is already committed with different content.',
      ));
    }
    return Response.json(
      { ok: true, status: result.status, eventId: result.eventId },
      { status: 200, headers: RESPONSE_HEADERS },
    );
  } catch (error) {
    if (error instanceof MemoryEventRequestError) return errorResponse(error);
    return errorResponse(new MemoryEventRequestError(
      503,
      'MEMORY_STORE_UNAVAILABLE',
      'The shared memory event store is unavailable.',
    ));
  }
}
