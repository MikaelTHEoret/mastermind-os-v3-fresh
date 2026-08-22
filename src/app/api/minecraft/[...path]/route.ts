import { NextRequest, NextResponse } from 'next/server';
import { request as httpRequest } from 'node:http';
import { MinecraftAccessError, getControlPlaneConfiguration, requireMinecraftAccess } from '@/lib/minecraft/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INSTANCE_ID = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const ACTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REGISTRY_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const BACKUP_ID = /^bkp-[a-f0-9]{32}$/;
const RESTORE_PLAN_ID = /^rst-[a-f0-9]{64}$/;
const BACKUP_INTERVAL_HOURS = new Set([6, 12, 24, 72, 168]);
const BACKUP_VERIFY_RESTORE_PROXY_ENABLED = true;
const BACKUP_OPERATION_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_ADMIN_BODY_BYTES = 2 * 1024;
const MAX_MOD_BODY_BYTES = 2 * 1024;
const MAX_FIRST_PARTY_CORE_BODY_BYTES = 2 * 1024;
const MAX_WORLD_BODY_BYTES = 2 * 1024;
const MAX_UPSTREAM_RESPONSE_BYTES = 512 * 1024;
const MAX_LOG_RESPONSE_BYTES = 2 * 1024 * 1024;
const MOD_PLAN_TIMEOUT_MS = 30 * 60 * 1000;
const BUFFERED_LOCAL_CONTROL_THRESHOLD_MS = 5 * 60 * 1000;
const FAMILY_SERVER_ID = 'family-server';
const JAVA_PROFILE_NAME = /^[A-Za-z0-9_]{3,16}$/;
const ADMIN_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMIN_PLAN_ID = /^admplan-[a-f0-9]{64}$/;
const ADMIN_CONFIRMATIONS = new Set([
  'CONFIRM WHITELIST CHANGE',
  'CONFIRM PLAYER DISCIPLINE',
  'CONFIRM OPERATOR CHANGE',
]);
const UNSAFE_ADMIN_TEXT = /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/;
const MOD_CATALOG_REF = /^modref-[a-f0-9]{64}$/;
const MOD_INSTALLED_REF = /^modinst-[a-f0-9]{64}$/;
const MOD_PLAN_ID = /^modplan-[a-f0-9]{64}$/;
const MOD_TRANSACTION_ID = /^modtx-[a-f0-9]{64}$/;
const MOD_CONFIRMATIONS = new Set(['INSTALL THIRD-PARTY MOD CODE', 'UPDATE THIRD-PARTY MOD CODE', 'REMOVE MANAGED MODS', 'RESTORE MOD SNAPSHOT']);
const WORLD_REF = /^world-[a-f0-9]{64}$/;
const WORLD_PLAN_ID = /^worldplan-[a-f0-9]{64}$/;
const WORLD_TRANSACTION_REF = /^worldtx-[a-f0-9]{64}$/;
const WORLD_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FAMILY_CORE_PUBLIC_ERROR_CODES = new Set([
  'FAMILY_CORE_ARTIFACT_INVALID', 'FAMILY_CORE_BACKUP_REQUIRED', 'FAMILY_CORE_CONFIRMATION_REQUIRED',
  'FAMILY_CORE_INSTANCE_INVALID', 'FAMILY_CORE_INTEGRITY_FAILED', 'FAMILY_CORE_OPERATION_FAILED',
  'FAMILY_CORE_RECOVERY_REQUIRED', 'FAMILY_CORE_STATE_CHANGED', 'FAMILY_CORE_STATE_INVALID',
  'FAMILY_CORE_STATE_UNAVAILABLE', 'FAMILY_CORE_UNMANAGED', 'BACKUP_SERVER_NOT_QUIESCENT',
]);
const WORLD_CONFIRMATIONS = new Set(['CREATE NEW WORLD', 'CLONE WORLD', 'RENAME WORLD', 'ARCHIVE WORLD', 'SWITCH ACTIVE WORLD']);
const WORLD_OPERATIONS = new Set(['create', 'clone', 'rename', 'archive', 'switch']);
const WORLD_OPERATION_BY_CONFIRMATION: Record<string, string> = {
  'CREATE NEW WORLD': 'create',
  'CLONE WORLD': 'clone',
  'RENAME WORLD': 'rename',
  'ARCHIVE WORLD': 'archive',
  'SWITCH ACTIVE WORLD': 'switch',
};
const WORLD_FAILURE_CODES = new Set([
  'WORLD_RECOVERY_REQUIRED', 'WORLD_PLAN_STALE', 'WORLD_SOURCE_CHANGED', 'WORLD_SNAPSHOT_FAILED',
  'WORLD_SWITCH_VERIFY_FAILED', 'WORLD_STORAGE_FULL', 'WORLD_OPERATION_FAILED',
]);
const WORLD_PUBLIC_ERROR_CODES = new Set([
  'WORLD_INVALID_REQUEST', 'WORLD_INVALID_REF', 'WORLD_INVALID_LABEL', 'WORLD_INSTANCE_NOT_FOUND',
  'WORLD_SERVER_NOT_QUIESCENT', 'WORLD_COMPANION_NOT_QUIESCENT', 'WORLD_RECOVERY_REQUIRED',
  'WORLD_PLAN_NOT_FOUND', 'WORLD_PLAN_EXPIRED', 'WORLD_PLAN_STALE', 'WORLD_SOURCE_CHANGED',
  'WORLD_SNAPSHOT_FAILED', 'WORLD_SWITCH_VERIFY_FAILED', 'WORLD_STORAGE_FULL', 'WORLD_QUOTA_EXCEEDED',
  'WORLD_APPROVAL_INVALID', 'WORLD_REQUEST_ID_CONFLICT', 'WORLD_OPERATION_NOT_FOUND',
  'WORLD_OPERATION_COMPLETION_UNKNOWN', 'WORLD_OPERATION_FAILED', 'WORLD_VERSION_METADATA_REQUIRED',
  'BACKUP_MANUAL_RECOVERY_REQUIRED', 'CONTROL_RECOVERY_REQUIRED', 'MOD_MANUAL_RECOVERY_REQUIRED',
  'UPDATE_RECOVERY_REQUIRED', 'UPDATE_BACKUP_RETENTION_REQUIRED',
]);
const UPDATE_PLAN_STATE_BY_KIND: Record<string, string> = {
  current: 'current',
  component: 'component-update-available',
  upgrade: 'minecraft-update-approval-required',
  'legacy-migration': 'minecraft-update-approval-required',
  downgrade: 'blocked-downgrade',
  unknown: 'blocked-unknown-order',
};
const UPDATE_TRANSACTION_PHASES = new Set([
  'preparing', 'candidate-ready', 'original-backed-up', 'candidate-published', 'store-committed',
  'pending-readiness', 'readiness-observed', 'ready', 'rolling-back', 'rolled-back', 'rollback-failed',
]);
const UPDATE_PUBLIC_ERROR_MESSAGES: Record<string, string> = {
  BACKUP_MANUAL_RECOVERY_REQUIRED: 'Backup recovery requires verified repair before the server update can continue.',
  CONTROL_RECOVERY_REQUIRED: 'Managed recovery evidence requires verified repair before the server update can continue.',
  MOD_MANUAL_RECOVERY_REQUIRED: 'Managed mod recovery requires verified repair before the server update can continue.',
  WORLD_RECOVERY_REQUIRED: 'Managed world recovery requires verified repair before the server update can continue.',
  UPDATE_RECOVERY_REQUIRED: 'An interrupted server update requires verified recovery before this action can continue.',
  UPDATE_BACKUP_RETENTION_REQUIRED: 'A retained update payload must be resolved before another server update can continue.',
  UPDATE_INVALID_STATE: 'The server update is unavailable in the current verified state.',
  UPDATE_APPROVAL_REQUIRED: 'A fresh approved Minecraft update plan is required.',
  INSTANCE_NOT_FOUND: 'The managed Family Server instance was not found.',
  INVALID_INSTANCE_ID: 'The managed Family Server identity is invalid.',
  INVALID_STATE: 'The managed instance is not eligible for Family Server updates.',
};
const UNSAFE_SEARCH_TEXT = /[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const FAMILY_BRAIN_FEATURES = Object.freeze([
  'computerChat', 'companionConversation', 'modelReasoning', 'profileCapture',
  'physicalTaskPlanning', 'survivalAutomation', 'modRequestExecution',
  'inGameApprovals', 'visionRecovery', 'zenithBody', 'enhancedHeadlessController',
  'hybridTelemetry',
]);
const FAMILY_BRAIN_STATES = new Set(['planned', 'stubbed', 'implemented', 'live-verified']);

type RouteContext = { params: Promise<{ path: string[] }> };

function bufferedLocalControlRequest(
  url: URL,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
): Promise<Response> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = httpRequest(url, {
      method: init.method,
      headers: init.headers,
      agent: false,
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer | string) => {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += value.byteLength;
        if (bytes > MAX_UPSTREAM_RESPONSE_BYTES) {
          response.destroy();
          finishReject(new MinecraftAccessError(
            502,
            'CONTROL_RESPONSE_TOO_LARGE',
            'The local Minecraft agent response exceeded the proxy limit.',
          ));
          return;
        }
        chunks.push(value);
      });
      response.once('error', finishReject);
      response.once('end', () => {
        if (settled) return;
        settled = true;
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
          else if (value !== undefined) headers.set(name, value);
        }
        resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode ?? 502,
          headers,
        }));
      });
    });
    const abort = () => {
      const reason = init.signal.reason instanceof Error
        ? init.signal.reason
        : new DOMException('The local control request was aborted.', 'AbortError');
      request.destroy(reason);
      finishReject(reason);
    };
    if (init.signal.aborted) {
      abort();
      return;
    }
    init.signal.addEventListener('abort', abort, { once: true });
    request.once('error', finishReject);
    request.once('close', () => init.signal.removeEventListener('abort', abort));
    request.end(init.body);
  });
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { ok: false, code, message },
    { status, headers: { 'Cache-Control': 'no-store, max-age=0', 'Content-Security-Policy': "default-src 'none'" } },
  );
}

function publicBrainEnvelope(envelope: Record<string, unknown>): Record<string, unknown> {
  if (envelope.ok !== true || !envelope.brain || typeof envelope.brain !== 'object' || Array.isArray(envelope.brain)) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid companion foundation status.');
  }
  const brain = envelope.brain as Record<string, unknown>;
  if (Object.keys(brain).length !== 3 || brain.schemaVersion !== 1
    || !brain.flags || typeof brain.flags !== 'object' || Array.isArray(brain.flags)
    || !brain.states || typeof brain.states !== 'object' || Array.isArray(brain.states)) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid companion foundation status.');
  }
  const flags = brain.flags as Record<string, unknown>;
  const states = brain.states as Record<string, unknown>;
  if (Object.keys(flags).length !== FAMILY_BRAIN_FEATURES.length
    || Object.keys(states).length !== FAMILY_BRAIN_FEATURES.length
    || FAMILY_BRAIN_FEATURES.some((feature) => typeof flags[feature] !== 'boolean' || !FAMILY_BRAIN_STATES.has(String(states[feature])))) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid companion feature status.');
  }
  return {
    ok: true,
    brain: {
      schemaVersion: 1,
      flags: Object.fromEntries(FAMILY_BRAIN_FEATURES.map((feature) => [feature, flags[feature]])),
      states: Object.fromEntries(FAMILY_BRAIN_FEATURES.map((feature) => [feature, states[feature]])),
    },
  };
}

const CONVERSATION_REASONS = new Set([
  'explicit-computer-command',
  'explicit-companion-target',
  'companion-name',
  'reply-to-companion',
  'active-conversation',
  'not-addressed',
]);

function publicConversationStatusEnvelope(envelope: Record<string, unknown>): Record<string, unknown> {
  if (envelope.ok !== true || !envelope.conversation || typeof envelope.conversation !== 'object'
    || Array.isArray(envelope.conversation)) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid conversation intake status.');
  }
  const status = envelope.conversation as Record<string, unknown>;
  const baseKeys = [
    'schemaVersion', 'received', 'addressed', 'ignored', 'lastReceivedAt', 'lastActor',
    'lastReason', 'lastExecutionCode', 'activeCompanionSessions', 'storesChatContent',
  ];
  const metricKeys = ['modelCalls', 'replies', 'failures', 'activeModelCalls', 'model'];
  const hasMetrics = metricKeys.some((key) => Object.prototype.hasOwnProperty.call(status, key));
  const keys = hasMetrics ? [...baseKeys, ...metricKeys] : baseKeys;
  const canonicalLastReceivedAt = typeof status.lastReceivedAt === 'string'
    && Number.isFinite(Date.parse(status.lastReceivedAt))
    && new Date(status.lastReceivedAt).toISOString() === status.lastReceivedAt;
  if (Object.keys(status).length !== keys.length || Object.keys(status).some((key) => !keys.includes(key))
    || status.schemaVersion !== 1
    || !Number.isInteger(status.received) || Number(status.received) < 0
    || !Number.isInteger(status.addressed) || Number(status.addressed) < 0
    || !Number.isInteger(status.ignored) || Number(status.ignored) < 0
    || Number(status.addressed) + Number(status.ignored) !== Number(status.received)
    || !Number.isInteger(status.activeCompanionSessions) || Number(status.activeCompanionSessions) < 0
    || status.storesChatContent !== false
    || (hasMetrics && (
      !metricKeys.every((key) => Object.prototype.hasOwnProperty.call(status, key))
      || !Number.isInteger(status.modelCalls) || Number(status.modelCalls) < 0
      || !Number.isInteger(status.replies) || Number(status.replies) < 0
      || !Number.isInteger(status.failures) || Number(status.failures) < 0
      || Number(status.replies) + Number(status.failures) > Number(status.addressed)
      || !Number.isInteger(status.activeModelCalls) || Number(status.activeModelCalls) < 0 || Number(status.activeModelCalls) > 2
      || (status.model !== null && (typeof status.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(status.model)))
    ))
    || (status.lastReceivedAt !== null && !canonicalLastReceivedAt)
    || (status.lastActor !== null && !['COMPUTER', 'COMPANION'].includes(String(status.lastActor)))
    || (status.lastReason !== null && !CONVERSATION_REASONS.has(String(status.lastReason)))
    || (status.lastExecutionCode !== null
      && (typeof status.lastExecutionCode !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/u.test(status.lastExecutionCode)))
    || (Number(status.received) === 0
      && [status.lastReceivedAt, status.lastActor, status.lastReason, status.lastExecutionCode].some((value) => value !== null))
    || (Number(status.received) > 0 && (status.lastReceivedAt === null || status.lastReason === null))
    || (Number(status.received) > 0 && ((status.lastActor === null) !== (status.lastReason === 'not-addressed')))
    || ((status.lastExecutionCode === null) !== (status.lastActor === null))) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid conversation intake status.');
  }
  return {
    ok: true,
    conversation: Object.fromEntries(keys.map((key) => [key, status[key]])),
  };
}

function publicFirstPartyCoreEnvelope(envelope: Record<string, unknown>): Record<string, unknown> {
  if (envelope.ok !== true || envelope.instanceId !== FAMILY_SERVER_ID
    || !envelope.firstPartyCore || typeof envelope.firstPartyCore !== 'object' || Array.isArray(envelope.firstPartyCore)) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid first-party core status.');
  }
  const status = envelope.firstPartyCore as Record<string, unknown>;
  const keys = ['state', 'generation', 'artifact', 'rollbackAvailable'];
  if (Object.keys(status).length !== keys.length || Object.keys(status).some((key) => !keys.includes(key))
    || !['disabled', 'installed'].includes(String(status.state))
    || typeof status.generation !== 'string' || !SHA256.test(status.generation)
    || typeof status.rollbackAvailable !== 'boolean') {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid first-party core status.');
  }
  let artifact: Record<string, unknown> | null = null;
  if (status.state === 'installed') {
    if (!status.artifact || typeof status.artifact !== 'object' || Array.isArray(status.artifact)) {
      throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid first-party core artifact status.');
    }
    const source = status.artifact as Record<string, unknown>;
    if (source.fileName !== 'mastermind-family-core.jar' || source.modId !== 'mastermind-family-core'
      || typeof source.sha256 !== 'string' || !SHA256.test(source.sha256)
      || !Number.isInteger(source.size) || Number(source.size) < 22 || Number(source.size) > 16 * 1024 * 1024
      || typeof source.version !== 'string' || source.version.length < 1 || source.version.length > 96
      || typeof source.minecraftVersion !== 'string' || source.minecraftVersion.length < 1 || source.minecraftVersion.length > 96
      || typeof source.loaderVersion !== 'string' || source.loaderVersion.length < 1 || source.loaderVersion.length > 96
      || typeof source.promotedAt !== 'string' || !Number.isFinite(Date.parse(source.promotedAt))
      || typeof source.backupId !== 'string' || !BACKUP_ID.test(source.backupId)) {
      throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid first-party core artifact status.');
    }
    artifact = {
      fileName: source.fileName,
      sha256: source.sha256.toLowerCase(),
      size: source.size,
      modId: source.modId,
      version: source.version,
      minecraftVersion: source.minecraftVersion,
      loaderVersion: source.loaderVersion,
      promotedAt: new Date(source.promotedAt).toISOString(),
      backupId: source.backupId,
    };
  } else if (status.artifact !== null) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid disabled first-party core status.');
  }
  return {
    ok: true,
    instanceId: FAMILY_SERVER_ID,
    firstPartyCore: {
      state: status.state,
      generation: status.generation.toLowerCase(),
      artifact,
      rollbackAvailable: status.rollbackAvailable,
    },
  };
}

function publicFirstPartyCoreOperationEnvelope(envelope: Record<string, unknown>): Record<string, unknown> {
  if (envelope.ok === false) {
    const code = typeof envelope.code === 'string' && FAMILY_CORE_PUBLIC_ERROR_CODES.has(envelope.code)
      ? envelope.code
      : 'FAMILY_CORE_OPERATION_FAILED';
    return { ok: false, code, message: 'The Family Core operation could not be completed safely.' };
  }
  if (envelope.ok !== true || envelope.instanceId !== FAMILY_SERVER_ID
    || !envelope.operation || typeof envelope.operation !== 'object' || Array.isArray(envelope.operation)) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned an invalid first-party core operation.');
  }
  const operation = envelope.operation as Record<string, unknown>;
  if (Object.keys(operation).length !== 2
    || !['promoted', 'already-installed', 'rolled-back', 'disabled'].includes(String(operation.action))
    || !operation.manifest || typeof operation.manifest !== 'object' || Array.isArray(operation.manifest)) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned an invalid first-party core operation.');
  }
  const manifest = operation.manifest as Record<string, unknown>;
  const keys = ['schemaVersion', 'instanceId', 'generation', 'active', 'previous', 'updatedAt'];
  if (Object.keys(manifest).length !== keys.length || Object.keys(manifest).some((key) => !keys.includes(key))
    || manifest.schemaVersion !== 2 || manifest.instanceId !== FAMILY_SERVER_ID
    || typeof manifest.generation !== 'string' || !SHA256.test(manifest.generation)
    || typeof manifest.updatedAt !== 'string' || !Number.isFinite(Date.parse(manifest.updatedAt))) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned an invalid first-party core manifest.');
  }
  const active = manifest.active;
  if (active !== null && (typeof active !== 'object' || Array.isArray(active))) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned an invalid first-party core manifest.');
  }
  const publicStatus = publicFirstPartyCoreEnvelope({
    ok: true,
    instanceId: FAMILY_SERVER_ID,
    firstPartyCore: {
      state: active === null ? 'disabled' : 'installed',
      generation: manifest.generation,
      artifact: active === null ? null : Object.fromEntries(
        Object.entries(active as Record<string, unknown>).filter(([key]) => key !== 'registryRelativePath'),
      ),
      rollbackAvailable: manifest.previous !== null,
    },
  });
  return {
    ok: true,
    instanceId: FAMILY_SERVER_ID,
    operation: {
      action: operation.action,
      firstPartyCore: publicStatus.firstPartyCore,
    },
  };
}

async function rejectUnconsumedBody(
  request: NextRequest,
  status: number,
  code: string,
  message: string,
): Promise<never> {
  await request.body?.cancel('request body rejected before reading').catch(() => undefined);
  throw new MinecraftAccessError(status, code, message);
}

async function readBoundedJsonBody(request: NextRequest, label: string, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const contentEncoding = request.headers.get('content-encoding');
  if (contentEncoding && contentEncoding.trim().toLowerCase() !== 'identity') {
    return rejectUnconsumedBody(request, 415, 'UNSUPPORTED_CONTENT_ENCODING', `${label} does not accept encoded request bodies.`);
  }

  const contentLength = request.headers.get('content-length');
  let declaredBytes: number | null = null;
  if (contentLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(contentLength)) {
      return rejectUnconsumedBody(request, 400, 'INVALID_CONTENT_LENGTH', `${label} has an invalid Content-Length.`);
    }
    declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes)) {
      return rejectUnconsumedBody(request, 413, 'BODY_TOO_LARGE', `${label} is too large.`);
    }
    if (declaredBytes > maxBytes) {
      return rejectUnconsumedBody(request, 413, 'BODY_TOO_LARGE', `${label} is too large.`);
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    if (declaredBytes !== null && declaredBytes !== 0) {
      throw new MinecraftAccessError(400, 'CONTENT_LENGTH_MISMATCH', `${label} did not match its Content-Length.`);
    }
    return null;
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let receivedBytes = 0;
  let finished = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes || (declaredBytes !== null && receivedBytes > declaredBytes)) {
        await reader.cancel('request body exceeded its declared or allowed size').catch(() => undefined);
        throw new MinecraftAccessError(
          receivedBytes > maxBytes ? 413 : 400,
          receivedBytes > maxBytes ? 'BODY_TOO_LARGE' : 'CONTENT_LENGTH_MISMATCH',
          receivedBytes > maxBytes ? `${label} is too large.` : `${label} did not match its Content-Length.`,
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (!finished) await reader.cancel('request body rejected').catch(() => undefined);
    if (error instanceof MinecraftAccessError) throw error;
    throw new MinecraftAccessError(400, 'INVALID_JSON', `${label} is not valid UTF-8 JSON.`);
  } finally {
    reader.releaseLock();
  }

  if (declaredBytes !== null && receivedBytes !== declaredBytes) {
    throw new MinecraftAccessError(400, 'CONTENT_LENGTH_MISMATCH', `${label} did not match its Content-Length.`);
  }
  try {
    assertNoDuplicateJsonKeys(text, label);
    return JSON.parse(text);
  }
  catch (error) {
    if (error instanceof MinecraftAccessError) throw error;
    throw new MinecraftAccessError(400, 'INVALID_JSON', `${label} is not valid JSON.`);
  }
}

function assertNoDuplicateJsonKeys(text: string, label: string): void {
  let index = 0;
  let nodes = 0;
  const MAX_JSON_DEPTH = 64;
  const MAX_JSON_NODES = 4_096;
  const whitespace = /\s/u;
  const skipWhitespace = () => { while (index < text.length && whitespace.test(text[index])) index += 1; };
  const parseString = (): string => {
    if (text[index] !== '"') throw new Error('expected JSON string');
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === '\\') { index += 2; continue; }
      if (text[index] === '"') {
        index += 1;
        const parsed = JSON.parse(text.slice(start, index));
        if (typeof parsed !== 'string') throw new Error('invalid JSON string');
        return parsed;
      }
      index += 1;
    }
    throw new Error('unterminated JSON string');
  };
  const parseValue = (depth = 0): void => {
    nodes += 1;
    if (depth > MAX_JSON_DEPTH || nodes > MAX_JSON_NODES) throw new Error('JSON structure limit exceeded');
    skipWhitespace();
    if (text[index] === '{') {
      index += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (text[index] === '}') { index += 1; return; }
      while (index < text.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) throw new MinecraftAccessError(400, 'DUPLICATE_JSON_KEY', `${label} contains a duplicate JSON object key.`);
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ':') throw new Error('expected JSON colon');
        index += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === '}') { index += 1; return; }
        if (text[index] !== ',') throw new Error('expected JSON object separator');
        index += 1;
      }
      throw new Error('unterminated JSON object');
    }
    if (text[index] === '[') {
      index += 1;
      skipWhitespace();
      if (text[index] === ']') { index += 1; return; }
      while (index < text.length) {
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === ']') { index += 1; return; }
        if (text[index] !== ',') throw new Error('expected JSON array separator');
        index += 1;
      }
      throw new Error('unterminated JSON array');
    }
    if (text[index] === '"') { parseString(); return; }
    const start = index;
    while (index < text.length && !/[\s,}\]]/u.test(text[index])) index += 1;
    if (start === index) throw new Error('expected JSON value');
  };
  parseValue();
  skipWhitespace();
  if (index !== text.length) throw new Error('unexpected trailing JSON content');
}

async function readBoundedUpstreamJson(
  response: Response,
  maxBytes = MAX_UPSTREAM_RESPONSE_BYTES,
  sanitizer?: (envelope: Record<string, unknown>) => Record<string, unknown>,
): Promise<string> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    await response.body?.cancel('non-JSON upstream response rejected').catch(() => undefined);
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned an unsupported response type.');
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength && (!/^(?:0|[1-9]\d*)$/.test(contentLength) || Number(contentLength) > maxBytes)) {
    await response.body?.cancel('oversized upstream response rejected').catch(() => undefined);
    throw new MinecraftAccessError(502, 'CONTROL_RESPONSE_TOO_LARGE', 'The local Minecraft agent response exceeded the proxy limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned an empty response.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let result = '';
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel('oversized upstream response rejected').catch(() => undefined);
        throw new MinecraftAccessError(502, 'CONTROL_RESPONSE_TOO_LARGE', 'The local Minecraft agent response exceeded the proxy limit.');
      }
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
    let parsed: unknown;
    try {
      assertNoDuplicateJsonKeys(result, 'local Minecraft agent response');
      parsed = JSON.parse(result);
    } catch {
      throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned malformed JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof (parsed as Record<string, unknown>).ok !== 'boolean') {
      throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned an invalid response envelope.');
    }
    const envelope = parsed as Record<string, unknown>;
    if (sanitizer) return JSON.stringify(sanitizer(envelope));
    if (envelope.ok === false) {
      if (
        typeof envelope.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(envelope.code)
        || typeof envelope.message !== 'string' || envelope.message.length < 1 || envelope.message.length > 512
        || UNSAFE_SEARCH_TEXT.test(envelope.message)
      ) throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned an invalid public error envelope.');
      return JSON.stringify({ ok: false, code: envelope.code, message: envelope.message });
    }
    return JSON.stringify(envelope);
  } catch (error) {
    if (error instanceof MinecraftAccessError) throw error;
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid UTF-8 response data.');
  } finally {
    reader.releaseLock();
  }
}

const INSTANCE_STATES = new Set(['stopped', 'starting', 'running', 'stopping', 'failed']);
const INSTANCE_OPTIONAL_KEYS = [
  'projectId', 'kind', 'pid', 'latestMinecraftVersion', 'updateChannel', 'javaPort', 'serverPort',
  'bedrockPort', 'loader', 'loaderVersion', 'components', 'provisioningStatus', 'lastError',
  'updateStatus', 'lastRestore',
];

function publicInstanceObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', `The local Minecraft agent returned invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function exactInstanceKeys(source: Record<string, unknown>, required: string[], optional: string[], label: string): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(source, key)) || Object.keys(source).some((key) => !allowed.has(key))) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', `The local Minecraft agent returned invalid ${label}.`);
  }
}

function publicInstanceText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
    || new TextEncoder().encode(value).byteLength > maximum * 4 || UNSAFE_SEARCH_TEXT.test(value)) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', `The local Minecraft agent returned invalid ${label}.`);
  }
  return value;
}

function publicInstanceTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', `The local Minecraft agent returned invalid ${label}.`);
  }
  return value;
}

function publicInstanceRecord(value: unknown): Record<string, unknown> {
  const source = publicInstanceObject(value, 'instance inventory record');
  exactInstanceKeys(source, ['id', 'displayName', 'status', 'minecraftVersion'], INSTANCE_OPTIONAL_KEYS, 'instance inventory record');
  if (typeof source.id !== 'string' || !INSTANCE_ID.test(source.id) || !INSTANCE_STATES.has(String(source.status))) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid instance identity or state.');
  }
  const result: Record<string, unknown> = {
    id: source.id,
    displayName: publicInstanceText(source.displayName, 64, 'instance display label'),
    status: source.status,
    minecraftVersion: publicInstanceText(source.minecraftVersion, 96, 'instance Minecraft version'),
  };
  if (source.projectId !== undefined) {
    if (source.projectId !== FAMILY_SERVER_ID) throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid project identity.');
    result.projectId = FAMILY_SERVER_ID;
  }
  if (source.kind !== undefined) {
    if (source.kind !== 'server') throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid instance kind.');
    result.kind = 'server';
  }
  if (source.pid !== undefined) {
    if (source.pid !== null && (!Number.isSafeInteger(source.pid) || Number(source.pid) < 1 || Number(source.pid) > 0xffffffff)) {
      throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid process identity.');
    }
    result.pid = source.pid;
  }
  for (const [key, maximum] of [['latestMinecraftVersion', 96], ['loader', 32], ['loaderVersion', 128]] as const) {
    if (source[key] !== undefined) result[key] = publicInstanceText(source[key], maximum, `instance ${key}`);
  }
  if (source.updateChannel !== undefined) {
    if (source.updateChannel !== 'latest-compatible') throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid update channel.');
    result.updateChannel = 'latest-compatible';
  }
  for (const key of ['javaPort', 'serverPort', 'bedrockPort']) {
    if (source[key] === undefined) continue;
    if (!Number.isSafeInteger(source[key]) || Number(source[key]) < 1 || Number(source[key]) > 65535) {
      throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid network port state.');
    }
    result[key] = source[key];
  }
  if (source.components !== undefined) {
    const components = publicInstanceObject(source.components, 'instance component inventory');
    exactInstanceKeys(components, [], ['fabricApi', 'geyser', 'floodgate'], 'instance component inventory');
    const publicComponents: Record<string, unknown> = {};
    for (const key of ['fabricApi', 'geyser', 'floodgate']) {
      if (components[key] === undefined) continue;
      const component = publicInstanceObject(components[key], 'instance component');
      exactInstanceKeys(component, ['versionNumber'], [], 'instance component');
      publicComponents[key] = { versionNumber: publicInstanceText(component.versionNumber, 128, 'component version') };
    }
    result.components = publicComponents;
  }
  if (source.provisioningStatus !== undefined) {
    if (typeof source.provisioningStatus !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(source.provisioningStatus)) {
      throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid provisioning state.');
    }
    result.provisioningStatus = source.provisioningStatus;
  }
  if (source.lastError !== undefined) {
    result.lastError = source.lastError === null ? null : publicInstanceText(source.lastError, 256, 'instance error summary');
  }
  if (source.updateStatus !== undefined) {
    const status = publicInstanceObject(source.updateStatus, 'instance update status');
    exactInstanceKeys(status, ['state'], ['previousMinecraftVersion', 'targetMinecraftVersion', 'backupAvailable', 'verifiedAt'], 'instance update status');
    if (!['pending-unverified', 'verified'].includes(String(status.state))) {
      throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid instance update state.');
    }
    const publicStatus: Record<string, unknown> = { state: status.state };
    for (const key of ['previousMinecraftVersion', 'targetMinecraftVersion']) {
      if (status[key] !== undefined) publicStatus[key] = publicInstanceText(status[key], 96, 'update Minecraft version');
    }
    if (status.backupAvailable !== undefined) {
      if (typeof status.backupAvailable !== 'boolean') throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid update backup state.');
      publicStatus.backupAvailable = status.backupAvailable;
    }
    if (status.verifiedAt !== undefined) publicStatus.verifiedAt = publicInstanceTimestamp(status.verifiedAt, 'update verification timestamp');
    result.updateStatus = publicStatus;
  }
  if (source.lastRestore !== undefined) {
    if (source.lastRestore === null) result.lastRestore = null;
    else {
      const receipt = publicInstanceObject(source.lastRestore, 'instance restore receipt');
      exactInstanceKeys(receipt, ['backupId', 'rescueBackupId', 'restoredAt', 'state'], [], 'instance restore receipt');
      if (typeof receipt.backupId !== 'string' || !BACKUP_ID.test(receipt.backupId)
        || typeof receipt.rescueBackupId !== 'string' || !BACKUP_ID.test(receipt.rescueBackupId)
        || receipt.state !== 'verified') {
        throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid restore receipt identity.');
      }
      result.lastRestore = {
        backupId: receipt.backupId,
        rescueBackupId: receipt.rescueBackupId,
        restoredAt: publicInstanceTimestamp(receipt.restoredAt, 'restore timestamp'),
        state: 'verified',
      };
    }
  }
  return result;
}

function publicInstancesEnvelope(envelope: Record<string, unknown>): Record<string, unknown> {
  if (envelope.ok === false) {
    exactInstanceKeys(envelope, ['ok', 'code', 'message'], [], 'instance error envelope');
    return {
      ok: false,
      code: 'INSTANCE_INVENTORY_UNAVAILABLE',
      message: 'The managed Minecraft instance inventory is unavailable.',
    };
  }
  exactInstanceKeys(envelope, ['ok', 'instances'], [], 'instance inventory envelope');
  if (envelope.ok !== true || !Array.isArray(envelope.instances) || envelope.instances.length > 128) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid instance inventory.');
  }
  return { ok: true, instances: envelope.instances.map(publicInstanceRecord) };
}

function publicUpdatePlan(value: unknown): Record<string, unknown> {
  const source = publicInstanceObject(value, 'server update plan');
  exactInstanceKeys(source, [
    'state', 'updateKind', 'planId', 'currentMinecraft', 'targetMinecraft', 'requiresApproval', 'checkedAt',
  ], [], 'server update plan');
  const expectedState = typeof source.updateKind === 'string' ? UPDATE_PLAN_STATE_BY_KIND[source.updateKind] : undefined;
  const requiresApproval = source.updateKind === 'upgrade' || source.updateKind === 'legacy-migration';
  if (!expectedState || source.state !== expectedState || source.requiresApproval !== requiresApproval
    || typeof source.planId !== 'string' || !SHA256.test(source.planId)) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned an invalid server update plan.');
  }
  return {
    state: expectedState,
    updateKind: source.updateKind,
    planId: source.planId,
    currentMinecraft: publicInstanceText(source.currentMinecraft, 96, 'current Minecraft version'),
    targetMinecraft: publicInstanceText(source.targetMinecraft, 96, 'target Minecraft version'),
    requiresApproval,
    checkedAt: publicInstanceTimestamp(source.checkedAt, 'server update check timestamp'),
  };
}

function publicUpdateError(envelope: Record<string, unknown>, fallbackCode: string, fallbackMessage: string): Record<string, unknown> {
  exactInstanceKeys(envelope, ['ok', 'code', 'message'], [], 'server update error envelope');
  const code = typeof envelope.code === 'string' && Object.prototype.hasOwnProperty.call(UPDATE_PUBLIC_ERROR_MESSAGES, envelope.code)
    ? envelope.code
    : fallbackCode;
  return { ok: false, code, message: UPDATE_PUBLIC_ERROR_MESSAGES[code] ?? fallbackMessage };
}

function publicUpdateStatusEnvelope(envelope: Record<string, unknown>, expectedInstanceId: string): Record<string, unknown> {
  if (envelope.ok === false) {
    return publicUpdateError(envelope, 'UPDATE_STATUS_UNAVAILABLE', 'The Family Server update status is unavailable.');
  }
  exactInstanceKeys(envelope, ['ok', 'instanceId', 'update'], [], 'server update status envelope');
  if (envelope.ok !== true || envelope.instanceId !== expectedInstanceId) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned invalid server update status identity.');
  }
  return { ok: true, instanceId: expectedInstanceId, update: publicUpdatePlan(envelope.update) };
}

function publicUpdateTransaction(value: unknown, expectedInstanceId: string, expectedPlan: Record<string, unknown>): Record<string, unknown> {
  const source = publicInstanceObject(value, 'server update transaction');
  exactInstanceKeys(source, [
    'transactionId', 'instanceId', 'phase', 'updateKind', 'planId', 'backupAvailable', 'createdAt', 'updatedAt',
  ], [], 'server update transaction');
  const createdAt = publicInstanceTimestamp(source.createdAt, 'server update transaction creation timestamp');
  const updatedAt = publicInstanceTimestamp(source.updatedAt, 'server update transaction update timestamp');
  if (typeof source.transactionId !== 'string' || !WORLD_REQUEST_ID.test(source.transactionId)
    || source.instanceId !== expectedInstanceId || source.phase !== 'pending-readiness'
    || !UPDATE_TRANSACTION_PHASES.has(String(source.phase)) || source.updateKind !== expectedPlan.updateKind
    || source.planId !== expectedPlan.planId || source.backupAvailable !== true
    || Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned an invalid server update transaction.');
  }
  return {
    transactionId: source.transactionId,
    instanceId: expectedInstanceId,
    phase: 'pending-readiness',
    updateKind: source.updateKind,
    planId: source.planId,
    backupAvailable: true,
    createdAt,
    updatedAt,
  };
}

function publicUpdateActionEnvelope(envelope: Record<string, unknown>, expectedInstanceId: string): Record<string, unknown> {
  if (envelope.ok === false && !Object.prototype.hasOwnProperty.call(envelope, 'updateResult')) {
    return publicUpdateError(envelope, 'UPDATE_OPERATION_FAILED', 'The Family Server update could not be completed safely.');
  }
  exactInstanceKeys(envelope, ['ok', 'updateResult'], [], 'server update action envelope');
  const result = publicInstanceObject(envelope.updateResult, 'server update action result');
  if (result.action === 'current' || result.action === 'approval-required') {
    exactInstanceKeys(result, ['action', 'instance', 'plan'], [], 'server update action result');
    const instance = publicInstanceRecord(result.instance);
    const plan = publicUpdatePlan(result.plan);
    if (instance.id !== expectedInstanceId
      || (result.action === 'current' && (envelope.ok !== true || plan.state !== 'current'))
      || (result.action === 'approval-required' && (envelope.ok !== false || plan.state !== 'minecraft-update-approval-required'))) {
      throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned a mismatched server update result.');
    }
    return { ok: envelope.ok, updateResult: { action: result.action, instance, plan } };
  }
  if (result.action === 'updated') {
    exactInstanceKeys(result, ['action', 'instance', 'plan', 'transaction', 'readiness'], [], 'server update action result');
    const instance = publicInstanceRecord(result.instance);
    const plan = publicUpdatePlan(result.plan);
    if (envelope.ok !== true || instance.id !== expectedInstanceId || result.readiness !== 'pending-unverified'
      || !['component-update-available', 'minecraft-update-approval-required'].includes(String(plan.state))) {
      throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned a mismatched completed update result.');
    }
    const transaction = publicUpdateTransaction(result.transaction, expectedInstanceId, plan);
    return {
      ok: true,
      updateResult: { action: 'updated', instance, plan, transaction, readiness: 'pending-unverified' },
    };
  }
  throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned an unsupported server update result.');
}

function publicRetiredVersionPurgeEnvelope(
  envelope: Record<string, unknown>,
  expectedInstanceId: string,
): Record<string, unknown> {
  if (envelope.ok === false) {
    exactInstanceKeys(envelope, ['ok', 'code', 'message'], [], 'retired-version cleanup error envelope');
    const messages: Record<string, string> = {
      BACKUP_MANUAL_RECOVERY_REQUIRED: 'Backup recovery requires verified manual repair before retired-version cleanup can continue.',
      CONTROL_RECOVERY_REQUIRED: 'Managed recovery evidence requires verified repair before retired-version cleanup can continue.',
      UPDATE_RECOVERY_REQUIRED: 'An interrupted server update requires verified recovery before retired-version cleanup can continue.',
      UPDATE_BACKUP_RETENTION_REQUIRED: 'A retained update payload must be resolved before retired-version cleanup can continue.',
      UPDATE_INVALID_STATE: 'Retired-version cleanup is unavailable in the current verified server state.',
      CLEANUP_UNAVAILABLE: 'The retired-version cleanup boundary is unavailable.',
      INSTANCE_NOT_FOUND: 'The managed Family Server instance was not found.',
      INVALID_INSTANCE_ID: 'The managed Family Server identity is invalid.',
      UNEXPECTED_BODY: 'Retired-version cleanup does not accept a request body.',
    };
    const code = typeof envelope.code === 'string' && Object.prototype.hasOwnProperty.call(messages, envelope.code)
      ? envelope.code
      : 'RETIRED_VERSION_PURGE_FAILED';
    return {
      ok: false,
      code,
      message: messages[code] ?? 'The retired-version cleanup could not be completed safely.',
    };
  }
  exactInstanceKeys(envelope, ['ok', 'cleanup'], [], 'retired-version cleanup envelope');
  if (envelope.ok !== true) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned an invalid retired-version cleanup response.');
  }
  const cleanup = publicInstanceObject(envelope.cleanup, 'retired-version cleanup');
  exactInstanceKeys(cleanup, [
    'action', 'instanceId', 'transactionId', 'retiredMinecraftVersion', 'currentMinecraftVersion',
    'backupAvailable', 'cacheEntriesPurged', 'purgedAt',
  ], [], 'retired-version cleanup');
  if (cleanup.action !== 'retired-version-purged' || cleanup.instanceId !== expectedInstanceId
    || typeof cleanup.transactionId !== 'string' || !WORLD_REQUEST_ID.test(cleanup.transactionId)
    || cleanup.backupAvailable !== false
    || !Number.isSafeInteger(cleanup.cacheEntriesPurged) || Number(cleanup.cacheEntriesPurged) < 0
    || Number(cleanup.cacheEntriesPurged) > 1_000_000) {
    throw new MinecraftAccessError(502, 'INVALID_CONTROL_RESPONSE', 'The local Minecraft agent returned an invalid retired-version cleanup result.');
  }
  return {
    ok: true,
    cleanup: {
      action: 'retired-version-purged',
      instanceId: expectedInstanceId,
      transactionId: cleanup.transactionId,
      retiredMinecraftVersion: publicInstanceText(cleanup.retiredMinecraftVersion, 96, 'retired Minecraft version'),
      currentMinecraftVersion: publicInstanceText(cleanup.currentMinecraftVersion, 96, 'current Minecraft version'),
      backupAvailable: false,
      cacheEntriesPurged: cleanup.cacheEntriesPurged,
      purgedAt: publicInstanceTimestamp(cleanup.purgedAt, 'retired-version cleanup timestamp'),
    },
  };
}

function exactWorldKeys(record: Record<string, unknown>, expected: string[], label: string): void {
  const keys = Object.keys(record);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', `The local Minecraft agent returned an invalid ${label}.`);
  }
}

function worldObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', `The local Minecraft agent returned an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function publicWorldText(value: unknown, max: number, label: string, allowEmpty = false): string {
  if (
    typeof value !== 'string' || value.length > max || (!allowEmpty && value.length < 1)
    || new TextEncoder().encode(value).byteLength > max * 4 || UNSAFE_SEARCH_TEXT.test(value)
  ) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', `The local Minecraft agent returned invalid ${label}.`);
  return value;
}

function publicWorldLabel(value: unknown): string {
  const label = publicWorldText(value, 64, 'world label');
  if (label.trim() !== label) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned an invalid world label.');
  return label;
}

function publicWorldTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', `The local Minecraft agent returned invalid ${label}.`);
  }
  return new Date(value).toISOString();
}

function publicWorldInteger(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', `The local Minecraft agent returned invalid ${label}.`);
  }
  return Number(value);
}

function publicWorldState(value: unknown): 'active' | 'inactive' | 'archived' {
  if (!['active', 'inactive', 'archived'].includes(String(value))) {
    throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned an invalid world state.');
  }
  return value as 'active' | 'inactive' | 'archived';
}

function publicWorldSummary(value: unknown): Record<string, unknown> {
  const source = worldObject(value, 'world record');
  exactWorldKeys(source, [
    'worldRef', 'displayLabel', 'state', 'pendingGeneration', 'minecraftVersion', 'dataVersion',
    'createdAt', 'updatedAt', 'files', 'bytes', 'integrity',
  ], 'world record');
  if (
    typeof source.worldRef !== 'string' || !WORLD_REF.test(source.worldRef)
    || typeof source.pendingGeneration !== 'boolean'
    || (source.dataVersion === null
      ? source.pendingGeneration !== true
      : (!Number.isSafeInteger(source.dataVersion) || Number(source.dataVersion) < 1
        || Number(source.dataVersion) > 0x7fffffff || source.pendingGeneration !== false))
    || !['verified', 'pending-generation', 'unverified-active', 'locked-version'].includes(String(source.integrity))
  ) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned an invalid world record.');
  if (
    (source.integrity === 'pending-generation' && source.pendingGeneration !== true)
    || (source.integrity === 'verified' && source.pendingGeneration !== false)
    || (source.integrity === 'unverified-active' && source.state !== 'active')
    || (source.integrity === 'locked-version' && source.state !== 'archived')
  ) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned inconsistent world integrity state.');
  const createdAt = publicWorldTimestamp(source.createdAt, 'world creation timestamp');
  const updatedAt = publicWorldTimestamp(source.updatedAt, 'world update timestamp');
  if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned inconsistent world timestamps.');
  return {
    worldRef: source.worldRef,
    displayLabel: publicWorldLabel(source.displayLabel),
    state: publicWorldState(source.state),
    pendingGeneration: source.pendingGeneration,
    minecraftVersion: publicWorldText(source.minecraftVersion, 96, 'world Minecraft version'),
    dataVersion: source.dataVersion === null ? null : Number(source.dataVersion),
    createdAt,
    updatedAt,
    files: publicWorldInteger(source.files, 0, 500_000, 'world file count'),
    bytes: publicWorldInteger(source.bytes, 0, 17_179_869_184, 'world byte count'),
    integrity: source.integrity,
  };
}

function publicWorldRecovery(value: unknown): Record<string, unknown> {
  const source = worldObject(value, 'world recovery state');
  exactWorldKeys(source, ['required', 'state', 'transactionRef'], 'world recovery state');
  if (source.required === false && source.state === null && source.transactionRef === null) {
    return { required: false, state: null, transactionRef: null };
  }
  if (
    source.required === true && ['completion-unknown', 'manual-recovery-required'].includes(String(source.state))
    && typeof source.transactionRef === 'string' && WORLD_TRANSACTION_REF.test(source.transactionRef)
  ) return { required: true, state: source.state, transactionRef: source.transactionRef };
  throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned an invalid world recovery state.');
}

function publicWorldInventory(envelope: Record<string, unknown>): Record<string, unknown> {
  exactWorldKeys(envelope, ['ok', 'instanceId', 'generation', 'inventoryDigest', 'recovery', 'activeWorldRef', 'worlds', 'limits'], 'world inventory envelope');
  const limits = worldObject(envelope.limits, 'world inventory limits');
  if (
    envelope.ok !== true || envelope.instanceId !== FAMILY_SERVER_ID
    || typeof envelope.generation !== 'string' || !SHA256.test(envelope.generation)
    || typeof envelope.inventoryDigest !== 'string' || !SHA256.test(envelope.inventoryDigest)
    || typeof envelope.activeWorldRef !== 'string' || !WORLD_REF.test(envelope.activeWorldRef)
    || !Array.isArray(envelope.worlds) || envelope.worlds.length < 1 || envelope.worlds.length > 12
  ) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned an invalid world inventory.');
  exactWorldKeys(limits, ['maxWorlds', 'maxWorldBytes', 'maxTotalBytes'], 'world inventory limits');
  if (limits.maxWorlds !== 12 || limits.maxWorldBytes !== 17_179_869_184 || limits.maxTotalBytes !== 68_719_476_736) {
    throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned invalid world limits.');
  }
  const worlds = envelope.worlds.map(publicWorldSummary);
  const refs = worlds.map((world) => world.worldRef as string);
  const normalizedLabels = worlds.map((world) => (world.displayLabel as string).normalize('NFKC').toLocaleLowerCase('en-US'));
  if (
    new Set(refs).size !== refs.length
    || new Set(normalizedLabels).size !== normalizedLabels.length
    || worlds.filter((world) => world.state === 'active').length !== 1
    || worlds.find((world) => world.state === 'active')?.worldRef !== envelope.activeWorldRef
    || worlds.reduce((total, world) => total + Number(world.bytes), 0) > 68_719_476_736
  ) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned inconsistent world inventory state.');
  return {
    ok: true,
    instanceId: FAMILY_SERVER_ID,
    generation: envelope.generation,
    inventoryDigest: envelope.inventoryDigest,
    recovery: publicWorldRecovery(envelope.recovery),
    activeWorldRef: envelope.activeWorldRef,
    worlds,
    limits: { maxWorlds: 12, maxWorldBytes: 17_179_869_184, maxTotalBytes: 68_719_476_736 },
  };
}

function publicWorldPlanEndpoint(value: unknown, nullable: boolean): Record<string, unknown> | null {
  if (nullable && value === null) return null;
  const source = worldObject(value, 'world plan endpoint');
  exactWorldKeys(source, ['worldRef', 'displayLabel', 'state'], 'world plan endpoint');
  if (typeof source.worldRef !== 'string' || !WORLD_REF.test(source.worldRef)) {
    throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned an invalid world plan endpoint.');
  }
  return { worldRef: source.worldRef, displayLabel: publicWorldLabel(source.displayLabel), state: publicWorldState(source.state) };
}

function publicWorldPlan(
  envelope: Record<string, unknown>,
  expectedRequest: Record<string, unknown>,
): Record<string, unknown> {
  exactWorldKeys(envelope, ['ok', 'instanceId', 'plan'], 'world plan envelope');
  const source = worldObject(envelope.plan, 'world plan');
  exactWorldKeys(source, [
    'planId', 'planDigest', 'requestId', 'operation', 'requiredConfirmation', 'expiresAt', 'source', 'target',
    'changes', 'safety', 'inventoryBinding',
  ], 'world plan');
  const expectedConfirmation: Record<string, string> = {
    create: 'CREATE NEW WORLD', clone: 'CLONE WORLD', rename: 'RENAME WORLD', archive: 'ARCHIVE WORLD', switch: 'SWITCH ACTIVE WORLD',
  };
  const expectedRequestId = expectedRequest.requestId;
  const expectedOperation = expectedRequest.operation;
  if (
    envelope.ok !== true || envelope.instanceId !== FAMILY_SERVER_ID
    || typeof expectedRequestId !== 'string' || !WORLD_REQUEST_ID.test(expectedRequestId)
    || typeof expectedOperation !== 'string' || !WORLD_OPERATIONS.has(expectedOperation)
    || typeof source.planId !== 'string' || !WORLD_PLAN_ID.test(source.planId)
    || typeof source.planDigest !== 'string' || !SHA256.test(source.planDigest)
    || source.requestId !== expectedRequestId || source.operation !== expectedOperation
    || source.requiredConfirmation !== expectedConfirmation[expectedOperation]
    || typeof source.expiresAt !== 'string' || !Number.isFinite(Date.parse(source.expiresAt))
    || new Date(source.expiresAt).toISOString() !== source.expiresAt
    || Date.parse(source.expiresAt) <= Date.now() || Date.parse(source.expiresAt) > Date.now() + 330_000
    || !Array.isArray(source.changes) || source.changes.length < 1 || source.changes.length > 2
  ) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned an inconsistent world plan.');
  const planSource = publicWorldPlanEndpoint(source.source, true);
  const target = publicWorldPlanEndpoint(source.target, false);
  if (!target) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned a missing world plan target.');
  const changes = source.changes.map((value) => {
    const change = worldObject(value, 'world plan change');
    exactWorldKeys(change, ['worldRef', 'displayLabel', 'fromState', 'toState'], 'world plan change');
    if (
      typeof change.worldRef !== 'string' || !WORLD_REF.test(change.worldRef)
      || (change.fromState !== null && !['active', 'inactive', 'archived'].includes(String(change.fromState)))
    ) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned an invalid world plan change.');
    return {
      worldRef: change.worldRef,
      displayLabel: publicWorldLabel(change.displayLabel),
      fromState: change.fromState,
      toState: publicWorldState(change.toState),
    };
  });
  const safety = worldObject(source.safety, 'world plan safety state');
  exactWorldKeys(safety, ['requiresStopped', 'rescueBackupRequired', 'destructive'], 'world plan safety state');
  if (
    safety.requiresStopped !== true || safety.destructive !== false
    || safety.rescueBackupRequired !== (expectedOperation === 'switch')
  ) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned invalid world plan safety state.');
  const binding = worldObject(source.inventoryBinding, 'world inventory binding');
  exactWorldKeys(binding, ['generation', 'digest'], 'world inventory binding');
  if (
    typeof binding.generation !== 'string' || !SHA256.test(binding.generation)
    || typeof binding.digest !== 'string' || !SHA256.test(binding.digest)
  ) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned an invalid world inventory binding.');
  if (
    ((expectedOperation === 'create' || expectedOperation === 'clone')
      && (target.state !== 'inactive' || changes.length !== 1 || changes[0].fromState !== null || changes[0].toState !== 'inactive'))
    || (expectedOperation === 'rename' && (changes.length !== 1 || changes[0].fromState !== changes[0].toState))
    || (expectedOperation === 'archive' && (target.state !== 'archived' || changes.length !== 1 || changes[0].fromState !== 'inactive' || changes[0].toState !== 'archived'))
    || (expectedOperation === 'switch' && (
      target.state !== 'active' || changes.length !== 2
      || !changes.some((change) => ['inactive', 'archived'].includes(String(change.fromState)) && change.toState === 'active')
      || !changes.some((change) => change.fromState === 'active' && change.toState === 'inactive')
    ))
  ) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned impossible world plan changes.');
  const requestedRef = typeof expectedRequest.targetWorldRef === 'string' ? expectedRequest.targetWorldRef : null;
  const requestedLabel = typeof expectedRequest.displayLabel === 'string' ? expectedRequest.displayLabel : null;
  const changeForTarget = changes.find((change) => change.worldRef === target.worldRef);
  const changeForSource = planSource ? changes.find((change) => change.worldRef === planSource.worldRef) : undefined;
  if (
    (expectedOperation === 'create' && (
      planSource !== null || requestedLabel === null || target.displayLabel !== requestedLabel
      || !changeForTarget || changeForTarget.displayLabel !== requestedLabel
    ))
    || (expectedOperation === 'clone' && (
      !planSource || planSource.worldRef !== requestedRef || target.worldRef === requestedRef
      || requestedLabel === null || target.displayLabel !== requestedLabel
      || !changeForTarget || changeForTarget.displayLabel !== requestedLabel
    ))
    || (expectedOperation === 'rename' && (
      !planSource || planSource.worldRef !== requestedRef || target.worldRef !== requestedRef
      || target.state !== planSource.state || requestedLabel === null || target.displayLabel !== requestedLabel
      || changes.length !== 1 || !changeForTarget || changeForTarget.worldRef !== requestedRef
      || changeForTarget.displayLabel !== requestedLabel
      || changeForTarget.fromState !== planSource.state || changeForTarget.toState !== planSource.state
    ))
    || (expectedOperation === 'archive' && (
      !planSource || planSource.worldRef !== requestedRef || planSource.state !== 'inactive'
      || target.worldRef !== requestedRef || target.displayLabel !== planSource.displayLabel
      || !changeForTarget || changeForTarget.displayLabel !== target.displayLabel
    ))
    || (expectedOperation === 'switch' && (
      !planSource || planSource.state !== 'active' || planSource.worldRef === requestedRef
      || target.worldRef !== requestedRef
      || !changeForTarget || changeForTarget.worldRef !== requestedRef
      || changeForTarget.displayLabel !== target.displayLabel
      || !['inactive', 'archived'].includes(String(changeForTarget.fromState)) || changeForTarget.toState !== 'active'
      || !changeForSource || changeForSource.worldRef !== planSource.worldRef
      || changeForSource.displayLabel !== planSource.displayLabel
      || changeForSource.fromState !== 'active' || changeForSource.toState !== 'inactive'
    ))
  ) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned a world plan that did not match the submitted request.');
  return {
    ok: true,
    instanceId: FAMILY_SERVER_ID,
    plan: {
      planId: source.planId,
      planDigest: source.planDigest,
      requestId: expectedRequestId,
      operation: expectedOperation,
      requiredConfirmation: source.requiredConfirmation,
      expiresAt: new Date(source.expiresAt).toISOString(),
      source: planSource,
      target,
      changes,
      safety: { requiresStopped: true, rescueBackupRequired: expectedOperation === 'switch', destructive: false },
      inventoryBinding: { generation: binding.generation, digest: binding.digest },
    },
  };
}

function publicWorldOperation(
  envelope: Record<string, unknown>,
  expected: { requestId: string; planId?: string; planDigest?: string; operation?: string },
): Record<string, unknown> {
  exactWorldKeys(envelope, ['ok', 'instanceId', 'operation'], 'world operation envelope');
  const source = worldObject(envelope.operation, 'world operation');
  exactWorldKeys(source, [
    'requestId', 'planId', 'planDigest', 'operation', 'state', 'application', 'transactionRef',
    'failureCode', 'result', 'startedAt', 'updatedAt',
  ], 'world operation');
  const statePairs: Record<string, string> = {
    committed: 'verified',
    'rolled-back': 'rolled-back-verified',
    'rejected-before-mutation': 'not-applied',
    'completion-unknown': 'unknown',
    'manual-recovery-required': 'unknown',
  };
  if (
    envelope.ok !== true || envelope.instanceId !== FAMILY_SERVER_ID
    || source.requestId !== expected.requestId
    || (expected.planId !== undefined && source.planId !== expected.planId)
    || (expected.planDigest !== undefined && source.planDigest !== expected.planDigest)
    || (expected.operation !== undefined && source.operation !== expected.operation)
    || typeof source.planId !== 'string' || !WORLD_PLAN_ID.test(source.planId)
    || typeof source.planDigest !== 'string' || !SHA256.test(source.planDigest)
    || typeof source.operation !== 'string' || !WORLD_OPERATIONS.has(source.operation)
    || typeof source.state !== 'string' || statePairs[source.state] !== source.application
    || typeof source.transactionRef !== 'string' || !WORLD_TRANSACTION_REF.test(source.transactionRef)
  ) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned an inconsistent world operation.');
  const startedAt = publicWorldTimestamp(source.startedAt, 'world operation start timestamp');
  const updatedAt = publicWorldTimestamp(source.updatedAt, 'world operation update timestamp');
  if (Date.parse(updatedAt) < Date.parse(startedAt)) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned inconsistent world operation timestamps.');
  const terminalSuccess = source.state === 'committed' || source.state === 'rolled-back';
  let failureCode: string | null = null;
  if (source.failureCode !== null) {
    failureCode = typeof source.failureCode === 'string' && WORLD_FAILURE_CODES.has(source.failureCode)
      ? source.failureCode
      : 'WORLD_OPERATION_FAILED';
  }
  if ((terminalSuccess && failureCode !== null) || (!terminalSuccess && failureCode === null)) {
    throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned an invalid world operation failure state.');
  }
  let result: Record<string, unknown> | null = null;
  if (source.state === 'committed') {
    const value = worldObject(source.result, 'world operation result');
    if (source.operation === 'switch') {
      exactWorldKeys(value, ['activeWorldRef', 'previousWorldRef', 'rescueVerified', 'pendingGeneration', 'generation', 'inventoryDigest'], 'world switch result');
      if (
        typeof value.activeWorldRef !== 'string' || !WORLD_REF.test(value.activeWorldRef)
        || typeof value.previousWorldRef !== 'string' || !WORLD_REF.test(value.previousWorldRef)
        || value.activeWorldRef === value.previousWorldRef || value.rescueVerified !== true
        || typeof value.pendingGeneration !== 'boolean'
        || typeof value.generation !== 'string' || !SHA256.test(value.generation)
        || typeof value.inventoryDigest !== 'string' || !SHA256.test(value.inventoryDigest)
      ) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned an invalid world switch result.');
      result = { ...value };
    } else {
      exactWorldKeys(value, ['worldRef', 'displayLabel', 'state', 'pendingGeneration', 'generation', 'inventoryDigest'], 'world mutation result');
      if (
        typeof value.worldRef !== 'string' || !WORLD_REF.test(value.worldRef)
        || typeof value.pendingGeneration !== 'boolean'
        || typeof value.generation !== 'string' || !SHA256.test(value.generation)
        || typeof value.inventoryDigest !== 'string' || !SHA256.test(value.inventoryDigest)
      ) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned an invalid world mutation result.');
      if (
        ((source.operation === 'create' || source.operation === 'clone') && value.state !== 'inactive')
        || (source.operation === 'archive' && value.state !== 'archived')
      ) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned an impossible world mutation result.');
      result = {
        worldRef: value.worldRef,
        displayLabel: publicWorldLabel(value.displayLabel),
        state: publicWorldState(value.state),
        pendingGeneration: value.pendingGeneration,
        generation: value.generation,
        inventoryDigest: value.inventoryDigest,
      };
    }
  } else if (source.result !== null) {
    throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned an impossible world operation result.');
  }
  return {
    ok: true,
    instanceId: FAMILY_SERVER_ID,
    operation: {
      requestId: expected.requestId,
      planId: source.planId,
      planDigest: source.planDigest,
      operation: source.operation,
      state: source.state,
      application: source.application,
      transactionRef: source.transactionRef,
      failureCode,
      result,
      startedAt,
      updatedAt,
    },
  };
}

function publicWorldError(envelope: Record<string, unknown>): Record<string, unknown> {
  if (envelope.ok !== false) throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The local Minecraft agent returned an invalid world response.');
  const publicCode = typeof envelope.code === 'string' && WORLD_PUBLIC_ERROR_CODES.has(envelope.code)
    ? envelope.code
    : 'WORLD_OPERATION_FAILED';
  const message = publicCode === 'BACKUP_MANUAL_RECOVERY_REQUIRED'
    ? 'Backup recovery requires verified manual repair before world management can continue.'
    : publicCode === 'CONTROL_RECOVERY_REQUIRED'
      ? 'Managed recovery evidence requires verified repair before world management can continue.'
    : publicCode === 'MOD_MANUAL_RECOVERY_REQUIRED'
      ? 'Managed mod recovery requires verified repair before world management can continue.'
    : publicCode === 'UPDATE_RECOVERY_REQUIRED'
      ? 'An interrupted server update requires verified recovery before world management can continue.'
      : publicCode === 'UPDATE_BACKUP_RETENTION_REQUIRED'
        ? 'A retained update rollback or cleanup payload must be resolved before world management can continue.'
        : 'The Family Server world request could not be completed safely.';
  return { ok: false, code: publicCode, message };
}

function publicFamilyCoreIdentityEnvelope(envelope: Record<string, unknown>): Record<string, unknown> {
  if (envelope.ok !== true) {
    return {
      ok: false,
      code: 'FAMILY_CORE_IDENTITY_BINDING_FAILED',
      message: 'The local parent identity binding was not accepted.',
    };
  }
  if (Object.keys(envelope).sort().join('\0') !== ['created', 'identities', 'ok'].sort().join('\0')
    || typeof envelope.created !== 'boolean' || !envelope.identities
    || typeof envelope.identities !== 'object' || Array.isArray(envelope.identities)) {
    throw new MinecraftAccessError(502, 'INVALID_FAMILY_CORE_IDENTITY_RESPONSE', 'The local identity response was invalid.');
  }
  const identities = envelope.identities as Record<string, unknown>;
  const roles = identities.roles;
  if (Object.keys(identities).sort().join('\0') !== ['state', 'bindingCount', 'roles'].sort().join('\0')
    || identities.state !== 'ready' || identities.bindingCount !== 1
    || !roles || typeof roles !== 'object' || Array.isArray(roles)
    || Object.keys(roles).sort().join('\0') !== ['parent', 'child', 'service'].sort().join('\0')
    || (roles as Record<string, unknown>).parent !== 1
    || (roles as Record<string, unknown>).child !== 0
    || (roles as Record<string, unknown>).service !== 0) {
    throw new MinecraftAccessError(502, 'INVALID_FAMILY_CORE_IDENTITY_RESPONSE', 'The local identity response was invalid.');
  }
  return { ok: true, created: envelope.created, identities: { state: 'ready', bindingCount: 1, roles: { parent: 1, child: 0, service: 0 } } };
}

function sanitizeWorldEnvelope(
  envelope: Record<string, unknown>,
  kind: 'inventory' | 'plan' | 'operation',
  expected: Record<string, unknown> | null,
): Record<string, unknown> {
  if (envelope.ok === false) return publicWorldError(envelope);
  if (kind === 'inventory') return publicWorldInventory(envelope);
  if (!expected || typeof expected.requestId !== 'string') throw new MinecraftAccessError(502, 'INVALID_WORLD_RESPONSE', 'The world response could not be correlated safely.');
  if (kind === 'plan') {
    return publicWorldPlan(envelope, expected);
  }
  return publicWorldOperation(envelope, {
    requestId: expected.requestId,
    ...(typeof expected.planId === 'string' ? { planId: expected.planId } : {}),
    ...(typeof expected.planDigest === 'string' ? { planDigest: expected.planDigest } : {}),
    ...(typeof expected.operation === 'string' ? { operation: expected.operation } : {}),
  });
}

function mapTarget(method: string, segments: string[], searchParams: URLSearchParams): string | null {
  if (method === 'GET' && segments.length === 1 && ['overview', 'instances', 'account', 'catalog', 'lan'].includes(segments[0])) {
    if ([...searchParams].length) return null;
    return `/v1/${segments[0]}`;
  }
  if (segments[0] === 'client' && ![...searchParams].length) {
    if (method === 'GET' && segments.length === 2 && segments[1] === 'status') {
      return '/v1/client/status';
    }
    if (method === 'POST' && segments.length === 2 && segments[1] === 'provision') {
      return '/v1/client/provision';
    }
  }
  if (segments[0] === 'account' && ![...searchParams].length) {
    if (method === 'POST' && segments.length === 2 && segments[1] === 'registration') {
      return '/v1/account/registration';
    }
    if (method === 'POST' && segments.length === 3 && segments[1] === 'device' && segments[2] === 'start') {
      return '/v1/account/device/start';
    }
    if (
      method === 'POST' && segments.length === 4 && segments[1] === 'device'
      && APP_CLIENT_ID.test(segments[2]) && segments[3] === 'poll'
    ) {
      return `/v1/account/device/${segments[2].toLowerCase()}/poll`;
    }
    if (method === 'POST' && segments.length === 2 && ['refresh', 'signout'].includes(segments[1])) {
      return `/v1/account/${segments[1]}`;
    }
  }
  if (segments[0] === 'companion' && ![...searchParams].length) {
    if (method === 'GET' && segments.length === 2 && segments[1] === 'status') {
      return '/v1/companion/status';
    }
    if (method === 'POST' && segments.length === 2 && ['start', 'stop'].includes(segments[1])) {
      return `/v1/companion/${segments[1]}`;
    }
    if (method === 'POST' && segments.length === 2 && segments[1] === 'actions') {
      return '/v1/companion/actions';
    }
    if (
      method === 'POST' && segments.length === 4 && segments[1] === 'actions'
      && ACTION_ID.test(segments[2]) && segments[3] === 'cancel'
    ) {
      return `/v1/companion/actions/${segments[2].toLowerCase()}/cancel`;
    }
  }
  if (method === 'GET' && segments.length === 2 && segments[0] === 'brain' && segments[1] === 'status' && ![...searchParams].length) {
    return '/v1/brain/status';
  }
  if (method === 'GET' && segments.length === 2 && segments[0] === 'brain'
    && segments[1] === 'conversation-status' && ![...searchParams].length) {
    return '/v1/brain/conversation-status';
  }
  if (method === 'POST' && segments.length === 3 && segments[0] === 'family-core'
    && segments[1] === 'identities' && segments[2] === 'parent' && ![...searchParams].length) {
    return '/v1/family-core/identities/parent';
  }
  if (
    method === 'GET' && segments.length === 5 && segments[0] === 'instances'
    && segments[1] === FAMILY_SERVER_ID && segments[2] === 'mods' && segments[3] === 'catalog' && segments[4] === 'search'
  ) {
    const keys = [...new Set(searchParams.keys())];
    if (keys.length !== 3 || keys.some((key) => !['q', 'offset', 'limit'].includes(key))) return null;
    if (['q', 'offset', 'limit'].some((key) => searchParams.getAll(key).length !== 1)) return null;
    const query = searchParams.get('q') ?? '';
    const offset = searchParams.get('offset') ?? '';
    const limit = searchParams.get('limit') ?? '';
    if (
      query.length < 1 || query.length > 80 || new TextEncoder().encode(query).byteLength > 80
      || query.trim() !== query || UNSAFE_SEARCH_TEXT.test(query)
      || !/^(?:0|[1-9]\d{0,3})$/.test(offset) || Number(offset) > 1_000
      || !/^(?:[1-9]|1\d|20)$/.test(limit)
    ) return null;
    const safe = new URLSearchParams({ q: query, offset, limit });
    return `/v1/instances/${FAMILY_SERVER_ID}/mods/catalog/search?${safe.toString()}`;
  }
  if (segments[0] === 'instances' && INSTANCE_ID.test(segments[1] ?? '') && ![...searchParams].length) {
    const instanceId = encodeURIComponent(segments[1]);
    if (segments[1] === FAMILY_SERVER_ID && segments[2] === 'admin') {
      if (method === 'GET' && segments.length === 3) return `/v1/instances/${FAMILY_SERVER_ID}/admin`;
      if (method === 'POST' && segments.length === 4 && ['plans', 'actions'].includes(segments[3])) {
        return `/v1/instances/${FAMILY_SERVER_ID}/admin/${segments[3]}`;
      }
      if (method === 'GET' && segments.length === 5 && segments[3] === 'operations' && ADMIN_REQUEST_ID.test(segments[4])) {
        return `/v1/instances/${FAMILY_SERVER_ID}/admin/operations/${segments[4].toLowerCase()}`;
      }
    }
    if (segments[1] === FAMILY_SERVER_ID && segments[2] === 'mods') {
      if (method === 'GET' && segments.length === 5 && segments[3] === 'catalog' && MOD_CATALOG_REF.test(segments[4])) {
        return `/v1/instances/${FAMILY_SERVER_ID}/mods/catalog/${segments[4]}`;
      }
      if (method === 'GET' && segments.length === 4 && segments[3] === 'installed') {
        return `/v1/instances/${FAMILY_SERVER_ID}/mods/installed`;
      }
      if (method === 'POST' && segments.length === 4 && ['plans', 'actions'].includes(segments[3])) {
        return `/v1/instances/${FAMILY_SERVER_ID}/mods/${segments[3]}`;
      }
      if (method === 'GET' && segments.length === 5 && segments[3] === 'operations' && ADMIN_REQUEST_ID.test(segments[4])) {
        return `/v1/instances/${FAMILY_SERVER_ID}/mods/operations/${segments[4].toLowerCase()}`;
      }
    }
    if (segments[1] === FAMILY_SERVER_ID && segments[2] === 'first-party-core') {
      if (method === 'GET' && segments.length === 3) {
        return `/v1/instances/${FAMILY_SERVER_ID}/first-party-core`;
      }
      if (method === 'POST' && segments.length === 4 && ['promote', 'rollback'].includes(segments[3])) {
        return `/v1/instances/${FAMILY_SERVER_ID}/first-party-core/${segments[3]}`;
      }
    }
    if (segments[1] === FAMILY_SERVER_ID && segments[2] === 'worlds') {
      if (method === 'GET' && segments.length === 3) {
        return `/v1/instances/${FAMILY_SERVER_ID}/worlds`;
      }
      if (method === 'POST' && segments.length === 4 && ['plans', 'actions'].includes(segments[3])) {
        return `/v1/instances/${FAMILY_SERVER_ID}/worlds/${segments[3]}`;
      }
      if (method === 'GET' && segments.length === 5 && segments[3] === 'operations' && WORLD_REQUEST_ID.test(segments[4])) {
        return `/v1/instances/${FAMILY_SERVER_ID}/worlds/operations/${segments[4]}`;
      }
    }
    if (segments.length === 3 && segments[2] === 'backups' && ['GET', 'POST'].includes(method)) {
      return `/v1/instances/${instanceId}/backups`;
    }
    if (segments.length === 4 && segments[2] === 'backups' && segments[3] === 'policy' && method === 'POST') {
      return `/v1/instances/${instanceId}/backups/policy`;
    }
    if (
      segments.length === 5 && segments[2] === 'backups' && BACKUP_ID.test(segments[3])
      && ['restore-plan', 'restore', 'purge', 'verify'].includes(segments[4]) && method === 'POST'
    ) {
      if (segments[4] !== 'purge' && !BACKUP_VERIFY_RESTORE_PROXY_ENABLED) return null;
      return `/v1/instances/${instanceId}/backups/${encodeURIComponent(segments[3])}/${segments[4]}`;
    }
  }
  if (segments.length === 3 && segments[0] === 'instances' && INSTANCE_ID.test(segments[1])) {
    if (method === 'POST' && ['start', 'stop'].includes(segments[2]) && ![...searchParams].length) {
      return `/v1/instances/${encodeURIComponent(segments[1])}/${segments[2]}`;
    }
    if (method === 'GET' && segments[2] === 'logs') {
      const keys = [...searchParams.keys()];
      if (keys.some((key) => key !== 'limit')) return null;
      const limit = searchParams.get('limit') ?? '200';
      if (!/^\d{1,4}$/.test(limit) || Number(limit) < 1 || Number(limit) > 1000) return null;
      return `/v1/instances/${encodeURIComponent(segments[1])}/logs?limit=${limit}`;
    }
    if (method === 'GET' && segments[2] === 'update-status' && ![...searchParams].length) {
      return `/v1/instances/${encodeURIComponent(segments[1])}/update-status`;
    }
    if (method === 'POST' && segments[2] === 'update' && ![...searchParams].length) {
      return `/v1/instances/${encodeURIComponent(segments[1])}/update`;
    }
  }
  if (
    method === 'POST' && segments.length === 4 && segments[0] === 'instances'
    && INSTANCE_ID.test(segments[1]) && segments[2] === 'lan' && segments[3] === 'enable'
    && ![...searchParams].length
  ) {
    return `/v1/instances/${encodeURIComponent(segments[1])}/lan/enable`;
  }
  if (
    method === 'POST' && segments.length === 4 && segments[0] === 'instances'
    && INSTANCE_ID.test(segments[1]) && segments[2] === 'retired-version' && segments[3] === 'purge'
    && ![...searchParams].length
  ) {
    return `/v1/instances/${encodeURIComponent(segments[1])}/retired-version/purge`;
  }
  if (method === 'POST' && segments.length === 1 && segments[0] === 'provision' && ![...searchParams].length) {
    return '/v1/provision';
  }
  return null;
}

async function sanitizedAccountRegistrationBody(request: NextRequest): Promise<string> {
  const input = await readBoundedJsonBody(request, 'Account registration request');
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MinecraftAccessError(400, 'INVALID_APP_REGISTRATION', 'Account registration request must contain one public application client ID.');
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.prototype.hasOwnProperty.call(record, 'clientId')) {
    throw new MinecraftAccessError(400, 'UNSAFE_FIELD_REJECTED', 'Account registration accepts only the public application client ID.');
  }
  if (typeof record.clientId !== 'string' || !APP_CLIENT_ID.test(record.clientId)) {
    throw new MinecraftAccessError(400, 'INVALID_APP_REGISTRATION', 'Application client ID must be a valid GUID.');
  }
  return JSON.stringify({ clientId: record.clientId.toLowerCase() });
}

function exactKeys(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MinecraftAccessError(400, 'INVALID_COMPANION_ACTION', `${label} must be an object.`);
  }
  const present = Object.keys(value);
  if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
    throw new MinecraftAccessError(400, 'UNSAFE_FIELD_REJECTED', `${label} contains an unsupported field.`);
  }
}

function boundedNumber(value: unknown, min: number, max: number, integer = false): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
}

function sanitizedCompanionAction(input: unknown): Record<string, unknown> {
  exactKeys(input, ['kind', 'args'], 'Companion action');
  const kind = input.kind;
  const args = input.args;
  if (typeof kind !== 'string') throw new MinecraftAccessError(400, 'INVALID_COMPANION_ACTION', 'Companion action kind is invalid.');

  switch (kind) {
    case 'direct.say':
      exactKeys(args, ['text'], `${kind} arguments`);
      if (typeof args.text !== 'string' || args.text.length < 1 || args.text.length > 256 || /[\x00-\x1f\x7f]/.test(args.text) || args.text.startsWith('/')) break;
      return { kind, args: { text: args.text } };
    case 'direct.lookAt':
      exactKeys(args, ['x', 'y', 'z', 'durationMs'], `${kind} arguments`);
      if (!boundedNumber(args.x, -30_000_000, 30_000_000) || !boundedNumber(args.y, -2_048, 2_048) || !boundedNumber(args.z, -30_000_000, 30_000_000) || !boundedNumber(args.durationMs, 50, 5_000, true)) break;
      return { kind, args: { x: args.x, y: args.y, z: args.z, durationMs: args.durationMs } };
    case 'direct.lookDelta':
      exactKeys(args, ['yawDelta', 'pitchDelta', 'durationMs'], `${kind} arguments`);
      if (!boundedNumber(args.yawDelta, -180, 180) || !boundedNumber(args.pitchDelta, -90, 90) || !boundedNumber(args.durationMs, 50, 5_000, true)) break;
      return { kind, args: { yawDelta: args.yawDelta, pitchDelta: args.pitchDelta, durationMs: args.durationMs } };
    case 'direct.moveFor':
      exactKeys(args, ['forward', 'strafe', 'durationMs', 'sprint', 'sneak'], `${kind} arguments`);
      if (!boundedNumber(args.forward, -1, 1) || !boundedNumber(args.strafe, -1, 1) || !boundedNumber(args.durationMs, 50, 5_000, true) || typeof args.sprint !== 'boolean' || typeof args.sneak !== 'boolean' || (args.sprint && args.sneak)) break;
      return { kind, args: { forward: args.forward, strafe: args.strafe, durationMs: args.durationMs, sprint: args.sprint, sneak: args.sneak } };
    case 'direct.jump':
    case 'direct.attack':
    case 'skill.escapeDanger':
      exactKeys(args, [], `${kind} arguments`);
      return { kind, args: {} };
    case 'skill.navigateTo':
      exactKeys(args, ['x', 'y', 'z', 'tolerance'], `${kind} arguments`);
      if (!boundedNumber(args.x, -30_000_000, 30_000_000, true) || !boundedNumber(args.y, -2_048, 2_048, true) || !boundedNumber(args.z, -30_000_000, 30_000_000, true) || !boundedNumber(args.tolerance, 1, 16, true)) break;
      return { kind, args: { x: args.x, y: args.y, z: args.z, tolerance: args.tolerance } };
    case 'skill.followPlayer':
      exactKeys(args, ['playerUuid', 'distance'], `${kind} arguments`);
      if (typeof args.playerUuid !== 'string' || !ACTION_ID.test(args.playerUuid) || !boundedNumber(args.distance, 2, 16)) break;
      return { kind, args: { playerUuid: args.playerUuid.toLowerCase(), distance: args.distance } };
    case 'skill.gatherBlock':
      exactKeys(args, ['blockId', 'count', 'maxDistance'], `${kind} arguments`);
      if (typeof args.blockId !== 'string' || args.blockId.length > 128 || !REGISTRY_ID.test(args.blockId) || !boundedNumber(args.count, 1, 64, true) || !boundedNumber(args.maxDistance, 1, 128, true)) break;
      return { kind, args: { blockId: args.blockId, count: args.count, maxDistance: args.maxDistance } };
    case 'skill.explore':
      exactKeys(args, ['radius'], `${kind} arguments`);
      if (!boundedNumber(args.radius, 16, 1_024, true)) break;
      return { kind, args: { radius: args.radius } };
    case 'skill.returnToKnownSafePoint':
      exactKeys(args, ['safePointId'], `${kind} arguments`);
      if (typeof args.safePointId !== 'string' || !SAFE_ID.test(args.safePointId)) break;
      return { kind, args: { safePointId: args.safePointId } };
    default:
      throw new MinecraftAccessError(400, 'UNSUPPORTED_COMPANION_ACTION', 'This companion action is not supported.');
  }
  throw new MinecraftAccessError(400, 'INVALID_COMPANION_ACTION', 'Companion action arguments are invalid.');
}

async function sanitizedCompanionActionBody(request: NextRequest): Promise<string> {
  const input = await readBoundedJsonBody(request, 'Companion action request');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MinecraftAccessError(400, 'INVALID_COMPANION_ACTION', 'Companion action request must be an object.');
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['action', 'timeoutMs'].includes(key)) || !Object.prototype.hasOwnProperty.call(record, 'action')) {
    throw new MinecraftAccessError(400, 'UNSAFE_FIELD_REJECTED', 'Companion action request contains an unsupported field.');
  }
  if (record.timeoutMs !== undefined && !boundedNumber(record.timeoutMs, 100, 30 * 60 * 1000, true)) {
    throw new MinecraftAccessError(400, 'INVALID_COMPANION_ACTION', 'Companion action timeout is invalid.');
  }
  return JSON.stringify({ action: sanitizedCompanionAction(record.action), ...(record.timeoutMs === undefined ? {} : { timeoutMs: record.timeoutMs }) });
}

async function sanitizedProvisionBody(request: NextRequest): Promise<string> {
  const input = await readBoundedJsonBody(request, 'Provisioning request');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MinecraftAccessError(400, 'INVALID_REQUEST', 'Provisioning request must be an object.');
  const record = input as Record<string, unknown>;
  const allowed = new Set(['kind', 'instanceId', 'displayName', 'memoryMb', 'eulaAccepted']);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new MinecraftAccessError(400, 'UNSAFE_FIELD_REJECTED', 'Provisioning contains an unsupported field.');
  }
  if (
    record.kind !== 'family-server' ||
    typeof record.instanceId !== 'string' || !INSTANCE_ID.test(record.instanceId) ||
    typeof record.displayName !== 'string' || record.displayName.trim().length < 1 || record.displayName.trim().length > 64 || /[\r\n\0]/.test(record.displayName) ||
    !Number.isInteger(record.memoryMb) || Number(record.memoryMb) < 512 || Number(record.memoryMb) > 32768 ||
    record.eulaAccepted !== true
  ) {
    throw new MinecraftAccessError(400, 'INVALID_PROVISION_REQUEST', 'The family-server profile, memory, and EULA acceptance must be valid.');
  }
  return JSON.stringify({
    kind: 'family-server',
    instanceId: record.instanceId,
    displayName: record.displayName.trim(),
    memoryMb: record.memoryMb,
    eulaAccepted: true,
  });
}

async function sanitizedUpdateBody(request: NextRequest): Promise<string> {
  const input = await readBoundedJsonBody(request, 'Update request') ?? {};
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => key !== 'approval')) {
    throw new MinecraftAccessError(400, 'INVALID_UPDATE_REQUEST', 'Update request contains an unsupported field.');
  }
  const record = input as Record<string, unknown>;
  if (record.approval === undefined) return '{}';
  if (!record.approval || typeof record.approval !== 'object' || Array.isArray(record.approval)) {
    throw new MinecraftAccessError(400, 'INVALID_UPDATE_APPROVAL', 'Minecraft version approval is invalid.');
  }
  const approval = record.approval as Record<string, unknown>;
  if (
    Object.keys(approval).some((key) => !['planId', 'minecraftVersionChange'].includes(key))
    || typeof approval.planId !== 'string' || !/^[a-f0-9]{64}$/i.test(approval.planId)
    || approval.minecraftVersionChange !== true
  ) throw new MinecraftAccessError(400, 'INVALID_UPDATE_APPROVAL', 'Minecraft version approval is invalid.');
  return JSON.stringify({ approval: { planId: approval.planId.toLowerCase(), minecraftVersionChange: true } });
}

async function sanitizedFirstPartyCoreBody(request: NextRequest, action: string): Promise<string> {
  const value = await readBoundedJsonBody(request, 'The first-party core request', MAX_FIRST_PARTY_CORE_BODY_BYTES);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MinecraftAccessError(400, 'FAMILY_CORE_ARTIFACT_INVALID', 'The first-party core request is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (action === 'promote') {
    const keys = ['expectedSha256', 'expectedSize', 'backupId', 'confirmation'];
    if (Object.keys(record).length !== keys.length || Object.keys(record).some((key) => !keys.includes(key))
      || typeof record.expectedSha256 !== 'string' || !SHA256.test(record.expectedSha256)
      || !Number.isInteger(record.expectedSize) || Number(record.expectedSize) < 22 || Number(record.expectedSize) > 16 * 1024 * 1024
      || typeof record.backupId !== 'string' || !BACKUP_ID.test(record.backupId)
      || record.confirmation !== 'PROMOTE FIRST-PARTY FAMILY CORE') {
      throw new MinecraftAccessError(400, 'FAMILY_CORE_ARTIFACT_INVALID', 'Promotion requires the pinned Family Core artifact, verified backup, and exact confirmation.');
    }
    return JSON.stringify({
      expectedSha256: record.expectedSha256,
      expectedSize: record.expectedSize,
      backupId: record.backupId,
      confirmation: record.confirmation,
    });
  }
  const keys = ['expectedGeneration', 'confirmation'];
  if (action !== 'rollback' || Object.keys(record).length !== keys.length
    || Object.keys(record).some((key) => !keys.includes(key))
    || typeof record.expectedGeneration !== 'string' || !SHA256.test(record.expectedGeneration)
    || record.confirmation !== 'ROLL BACK FIRST-PARTY FAMILY CORE') {
    throw new MinecraftAccessError(400, 'FAMILY_CORE_STATE_CHANGED', 'Rollback requires the current generation and exact confirmation.');
  }
  return JSON.stringify({
    expectedGeneration: record.expectedGeneration,
    confirmation: record.confirmation,
  });
}

async function sanitizedFamilyCoreParentIdentityBody(request: NextRequest): Promise<string> {
  const value = await readBoundedJsonBody(request, 'The parent identity request', MAX_FIRST_PARTY_CORE_BODY_BYTES);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MinecraftAccessError(400, 'FAMILY_CORE_IDENTITY_INVALID', 'The parent identity request is invalid.');
  }
  const record = value as Record<string, unknown>;
  const keys = ['playerId', 'minecraftUuid', 'displayName', 'confirmation'];
  if (Object.keys(record).length !== keys.length || Object.keys(record).some((key) => !keys.includes(key))
    || typeof record.playerId !== 'string' || !ACTION_ID.test(record.playerId)
    || typeof record.minecraftUuid !== 'string' || !ACTION_ID.test(record.minecraftUuid)
    || typeof record.displayName !== 'string' || !JAVA_PROFILE_NAME.test(record.displayName)
    || record.confirmation !== 'BIND FAMILY CORE PARENT') {
    throw new MinecraftAccessError(400, 'FAMILY_CORE_IDENTITY_INVALID', 'Parent identity binding requires exact UUID evidence and confirmation.');
  }
  return JSON.stringify({
    playerId: record.playerId.toLowerCase(),
    minecraftUuid: record.minecraftUuid.toLowerCase(),
    displayName: record.displayName,
    confirmation: record.confirmation,
  });
}

async function sanitizedBackupPolicyBody(request: NextRequest): Promise<string> {
  const input = await readBoundedJsonBody(request, 'Backup policy request');
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MinecraftAccessError(400, 'INVALID_BACKUP_POLICY', 'Backup policy request must be an object.');
  }
  const record = input as Record<string, unknown>;
  const allowed = ['enabled', 'intervalHours', 'retentionCount'];
  if (Object.keys(record).length !== allowed.length || Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new MinecraftAccessError(400, 'UNSAFE_FIELD_REJECTED', 'Backup policy request contains an unsupported or missing field.');
  }
  if (
    typeof record.enabled !== 'boolean'
    || !Number.isInteger(record.intervalHours) || !BACKUP_INTERVAL_HOURS.has(Number(record.intervalHours))
    || !Number.isInteger(record.retentionCount) || Number(record.retentionCount) < 3 || Number(record.retentionCount) > 30
  ) {
    throw new MinecraftAccessError(400, 'INVALID_BACKUP_POLICY', 'Backup policy must use an allowed interval and retain between 3 and 30 backups.');
  }
  return JSON.stringify({
    enabled: record.enabled,
    intervalHours: record.intervalHours,
    retentionCount: record.retentionCount,
  });
}

async function sanitizedBackupRestoreBody(request: NextRequest): Promise<string> {
  const input = await readBoundedJsonBody(request, 'Backup restore request');
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MinecraftAccessError(400, 'INVALID_BACKUP_APPROVAL', 'Backup restore request must be an object.');
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.prototype.hasOwnProperty.call(record, 'approval')) {
    throw new MinecraftAccessError(400, 'UNSAFE_FIELD_REJECTED', 'Backup restore request accepts only a restore-plan approval.');
  }
  const approval = record.approval;
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
    throw new MinecraftAccessError(400, 'INVALID_BACKUP_APPROVAL', 'Backup restore approval is invalid.');
  }
  const approvalRecord = approval as Record<string, unknown>;
  if (
    Object.keys(approvalRecord).length !== 1 || !Object.prototype.hasOwnProperty.call(approvalRecord, 'planId')
    || typeof approvalRecord.planId !== 'string' || !RESTORE_PLAN_ID.test(approvalRecord.planId)
  ) {
    throw new MinecraftAccessError(400, 'INVALID_BACKUP_APPROVAL', 'Backup restore approval requires one valid restore plan ID.');
  }
  return JSON.stringify({ approval: { planId: approvalRecord.planId } });
}

async function sanitizedBackupPurgeBody(request: NextRequest): Promise<string> {
  const label = 'Backup purge request';
  const input = await readBoundedJsonBody(request, label);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MinecraftAccessError(400, 'INVALID_BACKUP_CONFIRMATION', `${label} must be an object.`);
  }
  const record = input as Record<string, unknown>;
  const confirmation = 'PURGE';
  if (Object.keys(record).length !== 1 || Object.keys(record)[0] !== 'confirmation' || record.confirmation !== confirmation) {
    throw new MinecraftAccessError(400, 'INVALID_BACKUP_CONFIRMATION', `${label} requires the exact ${confirmation} confirmation.`);
  }
  return JSON.stringify({ confirmation });
}

const PROTECTED_ADMIN_KINDS = new Set([
  'whitelist.set', 'whitelist.add', 'whitelist.remove',
  'player.kick', 'player.ban', 'player.pardon', 'player.op', 'player.deop',
]);

function sanitizedAdminActionRecord(input: unknown, requestId: string | null, approvalRequired: boolean): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MinecraftAccessError(400, 'INVALID_ADMIN_ACTION', 'Family Server administration action must be an object.');
  }
  const record = input as Record<string, unknown>;
  if (typeof record.kind !== 'string') {
    throw new MinecraftAccessError(400, 'INVALID_ADMIN_ACTION', 'Family Server administration action kind is invalid.');
  }
  const prefix = requestId === null ? [] : ['requestId'];
  const approval = approvalRequired ? ['approval'] : [];
  const exactAdminKeys = (keys: string[]) => {
    const expected = [...prefix, 'kind', ...keys, ...approval];
    const present = Object.keys(record);
    if (present.length !== expected.length || present.some((key) => !expected.includes(key))) {
      throw new MinecraftAccessError(400, 'UNSAFE_FIELD_REJECTED', 'Family Server administration action contains an unsupported or missing field.');
    }
  };
  if (record.kind === 'players.refresh' || record.kind === 'whitelist.refresh') {
    if (approvalRequired) throw new MinecraftAccessError(400, 'INVALID_ADMIN_APPROVAL', 'Refresh actions do not accept an approval.');
    exactAdminKeys([]);
  } else if (record.kind === 'broadcast') {
    if (approvalRequired) throw new MinecraftAccessError(400, 'INVALID_ADMIN_APPROVAL', 'Broadcast actions do not accept an approval.');
    exactAdminKeys(['message']);
    if (
      typeof record.message !== 'string' || record.message.length < 1 || record.message.length > 256
      || !/^[\x20-\x7e]+$/.test(record.message) || UNSAFE_ADMIN_TEXT.test(record.message)
      || record.message.trim() !== record.message
    ) throw new MinecraftAccessError(400, 'INVALID_ADMIN_MESSAGE', 'Broadcast must contain 1 to 256 printable ASCII characters without leading or trailing whitespace.');
  } else if (record.kind === 'whitelist.set') {
    exactAdminKeys(['enabled']);
    if (typeof record.enabled !== 'boolean') throw new MinecraftAccessError(400, 'INVALID_ADMIN_ACTION', 'Whitelist state must be a boolean.');
  } else {
    if (!PROTECTED_ADMIN_KINDS.has(record.kind)) {
      throw new MinecraftAccessError(400, 'UNSUPPORTED_ADMIN_ACTION', 'This Family Server administration action is not supported.');
    }
    const acceptsReasonCode = record.kind === 'player.kick' || record.kind === 'player.ban';
    exactAdminKeys(acceptsReasonCode && record.reasonCode !== undefined ? ['player', 'reasonCode'] : ['player']);
    if (typeof record.player !== 'string' || !JAVA_PROFILE_NAME.test(record.player)) {
      throw new MinecraftAccessError(400, 'INVALID_JAVA_PLAYER', 'Player must be a Java profile name containing 3 to 16 ASCII letters, numbers, or underscores.');
    }
    if (
      record.reasonCode !== undefined
      && (!acceptsReasonCode || !['operator-request', 'rule-violation', 'unsafe-behavior'].includes(String(record.reasonCode)))
    ) throw new MinecraftAccessError(400, 'INVALID_ADMIN_REASON', 'The selected administration reason is not supported.');
  }

  const action: Record<string, unknown> = {
    ...(requestId === null ? {} : { requestId }),
    kind: record.kind,
    ...(record.message === undefined ? {} : { message: record.message }),
    ...(record.enabled === undefined ? {} : { enabled: record.enabled }),
    ...(record.player === undefined ? {} : { player: record.player }),
    ...(record.reasonCode === undefined ? {} : { reasonCode: record.reasonCode }),
  };
  if (approvalRequired) {
    const source = record.approval;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new MinecraftAccessError(400, 'INVALID_ADMIN_APPROVAL', 'Protected administration action approval is invalid.');
    }
    const approvalRecord = source as Record<string, unknown>;
    const keys = Object.keys(approvalRecord);
    if (
      keys.length !== 2 || keys.some((key) => !['planId', 'confirmation'].includes(key))
      || typeof approvalRecord.planId !== 'string' || !ADMIN_PLAN_ID.test(approvalRecord.planId)
      || typeof approvalRecord.confirmation !== 'string' || !ADMIN_CONFIRMATIONS.has(approvalRecord.confirmation)
    ) throw new MinecraftAccessError(400, 'INVALID_ADMIN_APPROVAL', 'Protected administration action approval is invalid.');
    action.approval = { planId: approvalRecord.planId, confirmation: approvalRecord.confirmation };
  }
  return action;
}

async function sanitizedAdminPlanBody(request: NextRequest): Promise<string> {
  const input = await readBoundedJsonBody(request, 'Family Server administration plan request', MAX_ADMIN_BODY_BYTES);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MinecraftAccessError(400, 'INVALID_ADMIN_PLAN', 'Family Server administration plan request must be an object.');
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || Object.keys(record).some((key) => !['requestId', 'action'].includes(key))) {
    throw new MinecraftAccessError(400, 'UNSAFE_FIELD_REJECTED', 'Family Server administration plan request contains an unsupported or missing field.');
  }
  if (typeof record.requestId !== 'string' || !ADMIN_REQUEST_ID.test(record.requestId)) {
    throw new MinecraftAccessError(400, 'INVALID_ADMIN_REQUEST_ID', 'Family Server administration request ID must be a valid UUID.');
  }
  const action = sanitizedAdminActionRecord(record.action, null, false);
  if (!PROTECTED_ADMIN_KINDS.has(String(action.kind))) {
    throw new MinecraftAccessError(400, 'ADMIN_PLAN_NOT_REQUIRED', 'This bounded administration action does not use an approval plan.');
  }
  return JSON.stringify({ requestId: record.requestId.toLowerCase(), action });
}

async function sanitizedAdminActionBody(request: NextRequest): Promise<string> {
  const input = await readBoundedJsonBody(request, 'Family Server administration request', MAX_ADMIN_BODY_BYTES);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MinecraftAccessError(400, 'INVALID_ADMIN_ACTION', 'Family Server administration request must be an object.');
  }
  const record = input as Record<string, unknown>;
  if (typeof record.requestId !== 'string' || !ADMIN_REQUEST_ID.test(record.requestId)) {
    throw new MinecraftAccessError(400, 'INVALID_ADMIN_REQUEST_ID', 'Family Server administration request ID must be a valid UUID.');
  }
  const protectedAction = typeof record.kind === 'string' && PROTECTED_ADMIN_KINDS.has(record.kind);
  return JSON.stringify(sanitizedAdminActionRecord(record, record.requestId.toLowerCase(), protectedAction));
}

async function sanitizedModPlanBody(request: NextRequest): Promise<string> {
  const input = await readBoundedJsonBody(request, 'Family Server Modrinth plan request', MAX_MOD_BODY_BYTES);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MinecraftAccessError(400, 'MOD_INVALID_REQUEST', 'Mod transaction plan request must be an object.');
  }
  const record = input as Record<string, unknown>;
  if (typeof record.requestId !== 'string' || !ADMIN_REQUEST_ID.test(record.requestId)) {
    throw new MinecraftAccessError(400, 'MOD_INVALID_REQUEST', 'Mod transaction request ID must be a valid UUID.');
  }
  const base = { requestId: record.requestId.toLowerCase() };
  if (record.operation === 'install') {
    if (
      Object.keys(record).length !== 3 || Object.keys(record).some((key) => !['requestId', 'operation', 'catalogRef'].includes(key))
      || typeof record.catalogRef !== 'string' || !MOD_CATALOG_REF.test(record.catalogRef)
    ) throw new MinecraftAccessError(400, 'MOD_INVALID_REF', 'Install plan requires one opaque catalog reference.');
    return JSON.stringify({ ...base, operation: 'install', catalogRef: record.catalogRef });
  }
  if (record.operation === 'update' || record.operation === 'remove') {
    if (
      Object.keys(record).length !== 3 || Object.keys(record).some((key) => !['requestId', 'operation', 'installedRef'].includes(key))
      || typeof record.installedRef !== 'string' || !MOD_INSTALLED_REF.test(record.installedRef)
    ) throw new MinecraftAccessError(400, 'MOD_INVALID_REF', 'Update or removal plan requires one opaque installed-mod reference.');
    return JSON.stringify({ ...base, operation: record.operation, installedRef: record.installedRef });
  }
  if (record.operation === 'rollback') {
    if (
      Object.keys(record).length !== 3 || Object.keys(record).some((key) => !['requestId', 'operation', 'transactionRef'].includes(key))
      || typeof record.transactionRef !== 'string' || !MOD_TRANSACTION_ID.test(record.transactionRef)
    ) throw new MinecraftAccessError(400, 'MOD_INVALID_REF', 'Rollback plan requires one opaque mod transaction reference.');
    return JSON.stringify({ ...base, operation: 'rollback', transactionRef: record.transactionRef });
  }
  throw new MinecraftAccessError(400, 'MOD_INVALID_REQUEST', 'This mod transaction operation is not supported.');
}

async function sanitizedModActionBody(request: NextRequest): Promise<string> {
  const input = await readBoundedJsonBody(request, 'Family Server mod transaction request', MAX_MOD_BODY_BYTES);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MinecraftAccessError(400, 'MOD_INVALID_REQUEST', 'Mod transaction request must be an object.');
  }
  const record = input as Record<string, unknown>;
  const allowed = ['requestId', 'planId', 'confirmation'];
  if (Object.keys(record).length !== allowed.length || Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new MinecraftAccessError(400, 'UNSAFE_FIELD_REJECTED', 'Mod transaction request contains an unsupported or missing field.');
  }
  if (
    typeof record.requestId !== 'string' || !ADMIN_REQUEST_ID.test(record.requestId)
    || typeof record.planId !== 'string' || !MOD_PLAN_ID.test(record.planId)
    || typeof record.confirmation !== 'string' || !MOD_CONFIRMATIONS.has(record.confirmation)
  ) throw new MinecraftAccessError(400, 'MOD_APPROVAL_INVALID', 'Mod transaction approval is invalid.');
  return JSON.stringify({
    requestId: record.requestId.toLowerCase(),
    planId: record.planId,
    confirmation: record.confirmation,
  });
}

function safeWorldDisplayLabel(value: unknown): string {
  if (
    typeof value !== 'string' || value.length < 1 || value.length > 64 || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > 256 || UNSAFE_SEARCH_TEXT.test(value)
  ) throw new MinecraftAccessError(400, 'WORLD_INVALID_LABEL', 'World label must contain 1 to 64 safe visible characters without surrounding whitespace.');
  return value;
}

async function sanitizedWorldPlanBody(request: NextRequest): Promise<string> {
  const input = await readBoundedJsonBody(request, 'Family Server world plan request', MAX_WORLD_BODY_BYTES);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MinecraftAccessError(400, 'WORLD_INVALID_REQUEST', 'World plan request must be an object.');
  }
  const record = input as Record<string, unknown>;
  if (typeof record.requestId !== 'string' || !WORLD_REQUEST_ID.test(record.requestId)) {
    throw new MinecraftAccessError(400, 'WORLD_INVALID_REQUEST', 'World plan request ID must be a lowercase UUID.');
  }
  const requestId = record.requestId;
  if (record.operation === 'create') {
    if (Object.keys(record).length !== 3 || Object.keys(record).some((key) => !['requestId', 'operation', 'displayLabel'].includes(key))) {
      throw new MinecraftAccessError(400, 'UNSAFE_FIELD_REJECTED', 'Create-world plan accepts only a request ID, operation, and display label.');
    }
    return JSON.stringify({ requestId, operation: 'create', displayLabel: safeWorldDisplayLabel(record.displayLabel) });
  }
  if (record.operation === 'clone' || record.operation === 'rename') {
    if (
      Object.keys(record).length !== 4 || Object.keys(record).some((key) => !['requestId', 'operation', 'targetWorldRef', 'displayLabel'].includes(key))
      || typeof record.targetWorldRef !== 'string' || !WORLD_REF.test(record.targetWorldRef)
    ) throw new MinecraftAccessError(400, 'WORLD_INVALID_REF', 'This world plan requires one opaque world reference and a safe display label.');
    return JSON.stringify({ requestId, operation: record.operation, targetWorldRef: record.targetWorldRef, displayLabel: safeWorldDisplayLabel(record.displayLabel) });
  }
  if (record.operation === 'archive' || record.operation === 'switch') {
    if (
      Object.keys(record).length !== 3 || Object.keys(record).some((key) => !['requestId', 'operation', 'targetWorldRef'].includes(key))
      || typeof record.targetWorldRef !== 'string' || !WORLD_REF.test(record.targetWorldRef)
    ) throw new MinecraftAccessError(400, 'WORLD_INVALID_REF', 'This world plan requires one opaque world reference.');
    return JSON.stringify({ requestId, operation: record.operation, targetWorldRef: record.targetWorldRef });
  }
  throw new MinecraftAccessError(400, 'WORLD_INVALID_REQUEST', 'This world plan operation is not supported.');
}

async function sanitizedWorldActionBody(request: NextRequest): Promise<string> {
  const input = await readBoundedJsonBody(request, 'Family Server world action request', MAX_WORLD_BODY_BYTES);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MinecraftAccessError(400, 'WORLD_INVALID_REQUEST', 'World action request must be an object.');
  }
  const record = input as Record<string, unknown>;
  const allowed = ['requestId', 'planId', 'planDigest', 'confirmation'];
  if (Object.keys(record).length !== allowed.length || Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new MinecraftAccessError(400, 'UNSAFE_FIELD_REJECTED', 'World action request contains an unsupported or missing field.');
  }
  if (
    typeof record.requestId !== 'string' || !WORLD_REQUEST_ID.test(record.requestId)
    || typeof record.planId !== 'string' || !WORLD_PLAN_ID.test(record.planId)
    || typeof record.planDigest !== 'string' || !SHA256.test(record.planDigest)
    || typeof record.confirmation !== 'string' || !WORLD_CONFIRMATIONS.has(record.confirmation)
  ) throw new MinecraftAccessError(400, 'WORLD_APPROVAL_INVALID', 'World action approval is invalid.');
  return JSON.stringify({
    requestId: record.requestId,
    planId: record.planId,
    planDigest: record.planDigest,
    confirmation: record.confirmation,
  });
}

async function handle(request: NextRequest, context: RouteContext) {
  try {
    await requireMinecraftAccess(request);
    const { path } = await context.params;
    const target = mapTarget(request.method, path, request.nextUrl.searchParams);
    if (!target) return errorResponse(404, 'CONTROL_ACTION_NOT_ALLOWED', 'This Minecraft control action is not allowed.');
    const { baseUrl, token } = getControlPlaneConfiguration();
    const isBodylessAction = request.method === 'POST' && (
      (path[0] === 'instances' && (
        ['start', 'stop'].includes(path[2] ?? '')
        || (path[2] === 'lan' && path[3] === 'enable')
        || (path[2] === 'retired-version' && path[3] === 'purge')
        || (path[2] === 'backups' && path.length === 3)
        || (path[2] === 'backups' && path.length === 5 && ['restore-plan', 'verify'].includes(path[4]))
      ))
      || (path[0] === 'companion' && (
        ['start', 'stop'].includes(path[1] ?? '')
        || (path[1] === 'actions' && path[3] === 'cancel')
      ))
      || (path[0] === 'client' && path.length === 2 && path[1] === 'provision')
      || (path[0] === 'account' && (
        (path.length === 3 && path[1] === 'device' && path[2] === 'start')
        || (path.length === 4 && path[1] === 'device' && path[3] === 'poll')
        || (path.length === 2 && ['refresh', 'signout'].includes(path[1] ?? ''))
      ))
    );
    if (isBodylessAction && (request.headers.has('transfer-encoding') || Number(request.headers.get('content-length') || 0) > 0)) {
      return errorResponse(400, 'UNEXPECTED_BODY', 'This Minecraft control action does not accept a request body.');
    }
    const body = request.method === 'POST' && path[0] === 'provision'
      ? await sanitizedProvisionBody(request)
      : request.method === 'POST' && path[0] === 'account' && path[1] === 'registration'
        ? await sanitizedAccountRegistrationBody(request)
      : request.method === 'POST' && path[0] === 'instances' && path[2] === 'update'
        ? await sanitizedUpdateBody(request)
        : request.method === 'POST' && path[0] === 'instances' && path[2] === 'backups' && path[3] === 'policy'
          ? await sanitizedBackupPolicyBody(request)
        : request.method === 'POST' && path[0] === 'instances' && path[2] === 'backups' && path.length === 5 && path[4] === 'restore'
          ? await sanitizedBackupRestoreBody(request)
        : request.method === 'POST' && path[0] === 'instances' && path[2] === 'backups' && path.length === 5 && path[4] === 'purge'
          ? await sanitizedBackupPurgeBody(request)
        : request.method === 'POST' && path[0] === 'instances' && path[1] === FAMILY_SERVER_ID && path[2] === 'admin' && path[3] === 'actions'
          ? await sanitizedAdminActionBody(request)
        : request.method === 'POST' && path[0] === 'instances' && path[1] === FAMILY_SERVER_ID && path[2] === 'admin' && path[3] === 'plans'
          ? await sanitizedAdminPlanBody(request)
        : request.method === 'POST' && path[0] === 'instances' && path[1] === FAMILY_SERVER_ID && path[2] === 'mods' && path[3] === 'plans'
          ? await sanitizedModPlanBody(request)
        : request.method === 'POST' && path[0] === 'instances' && path[1] === FAMILY_SERVER_ID && path[2] === 'mods' && path[3] === 'actions'
          ? await sanitizedModActionBody(request)
        : request.method === 'POST' && path[0] === 'instances' && path[1] === FAMILY_SERVER_ID && path[2] === 'worlds' && path[3] === 'plans'
          ? await sanitizedWorldPlanBody(request)
        : request.method === 'POST' && path[0] === 'instances' && path[1] === FAMILY_SERVER_ID && path[2] === 'worlds' && path[3] === 'actions'
          ? await sanitizedWorldActionBody(request)
        : request.method === 'POST' && path[0] === 'instances' && path[1] === FAMILY_SERVER_ID
          && path[2] === 'first-party-core' && ['promote', 'rollback'].includes(path[3] ?? '')
          ? await sanitizedFirstPartyCoreBody(request, path[3])
        : request.method === 'POST' && path[0] === 'family-core' && path[1] === 'identities' && path[2] === 'parent'
          ? await sanitizedFamilyCoreParentIdentityBody(request)
        : request.method === 'POST' && path[0] === 'companion' && path[1] === 'actions' && path.length === 2
          ? await sanitizedCompanionActionBody(request)
        : undefined;
    const isBackupRequest = path[0] === 'instances' && path[2] === 'backups';
    const isBackupPost = request.method === 'POST' && isBackupRequest;
    const isBackupMutationWithAmbiguousTransportFailure = isBackupPost && !(
      path.length === 5 && path[4] === 'restore-plan'
    );
    const isAdminActionMutation = request.method === 'POST'
      && path[0] === 'instances' && path[1] === FAMILY_SERVER_ID
      && path[2] === 'admin' && path[3] === 'actions';
    const isAdminPlanMutation = request.method === 'POST'
      && path[0] === 'instances' && path[1] === FAMILY_SERVER_ID
      && path[2] === 'admin' && path[3] === 'plans';
    const isModRequest = path[0] === 'instances' && path[1] === FAMILY_SERVER_ID && path[2] === 'mods';
    const isModActionMutation = request.method === 'POST' && isModRequest && path[3] === 'actions';
    const isModPlanMutation = request.method === 'POST' && isModRequest && path[3] === 'plans';
    const isModCatalogDetail = request.method === 'GET' && isModRequest && path[3] === 'catalog' && path.length === 5;
    const isWorldRequest = path[0] === 'instances' && path[1] === FAMILY_SERVER_ID && path[2] === 'worlds';
    const isWorldPlanMutation = request.method === 'POST' && isWorldRequest && path[3] === 'plans';
    const isWorldActionMutation = request.method === 'POST' && isWorldRequest && path[3] === 'actions';
    const isWorldOperationRead = request.method === 'GET' && isWorldRequest && path[3] === 'operations' && path.length === 5;
    const isInstanceInventory = request.method === 'GET' && path.length === 1 && path[0] === 'instances';
    const isUpdateStatus = request.method === 'GET' && path.length === 3
      && path[0] === 'instances' && path[2] === 'update-status';
    const isFirstPartyCoreStatus = request.method === 'GET' && path.length === 3
      && path[0] === 'instances' && path[1] === FAMILY_SERVER_ID && path[2] === 'first-party-core';
    const isFirstPartyCoreMutation = request.method === 'POST' && path.length === 4
      && path[0] === 'instances' && path[1] === FAMILY_SERVER_ID && path[2] === 'first-party-core'
      && ['promote', 'rollback'].includes(path[3] ?? '');
    const isFamilyCoreIdentityBinding = request.method === 'POST' && path.length === 3
      && path[0] === 'family-core' && path[1] === 'identities' && path[2] === 'parent';
    const isUpdateAction = request.method === 'POST' && path.length === 3
      && path[0] === 'instances' && path[2] === 'update';
    const isBrainStatus = request.method === 'GET' && path.length === 2
      && path[0] === 'brain' && path[1] === 'status';
    const isConversationStatus = request.method === 'GET' && path.length === 2
      && path[0] === 'brain' && path[1] === 'conversation-status';
    const isRetiredVersionPurge = request.method === 'POST' && path.length === 4
      && path[0] === 'instances' && path[2] === 'retired-version' && path[3] === 'purge';
    if (process.platform === 'win32' && (isModPlanMutation || isModActionMutation)) {
      return errorResponse(
        503,
        'MOD_MUTATION_UNAVAILABLE',
        'Managed Modrinth changes are read-only on this Windows safety boundary.',
      );
    }
    const worldBody = body && (isWorldPlanMutation || isWorldActionMutation)
      ? JSON.parse(body) as Record<string, unknown>
      : null;
    const worldExpected = isWorldPlanMutation && worldBody
      ? worldBody
      : isWorldActionMutation && worldBody && typeof worldBody.confirmation === 'string'
        ? { ...worldBody, operation: WORLD_OPERATION_BY_CONFIRMATION[worldBody.confirmation] }
        : isWorldOperationRead
          ? { requestId: path[4] }
          : null;
    const isLogRequest = request.method === 'GET' && path[0] === 'instances' && path[2] === 'logs';
    const timeoutMs = isBackupRequest
      ? BACKUP_OPERATION_TIMEOUT_MS
      : isModActionMutation
        ? BACKUP_OPERATION_TIMEOUT_MS
      : isModPlanMutation || isModCatalogDetail
        ? MOD_PLAN_TIMEOUT_MS
      : isWorldActionMutation
        ? BACKUP_OPERATION_TIMEOUT_MS
      : isWorldPlanMutation
        ? MOD_PLAN_TIMEOUT_MS
      : isWorldRequest
        ? MOD_PLAN_TIMEOUT_MS
      : isFirstPartyCoreMutation
        ? 60 * 60 * 1000
      : path[0] === 'provision'
      ? 10 * 60 * 1000
      : path[0] === 'client' && path[1] === 'provision'
        ? 15 * 60 * 1000
      : path[0] === 'instances' && ['start', 'update', 'retired-version'].includes(path[2] ?? '')
        ? 60 * 60 * 1000
      : path[0] === 'instances' && path[2] === 'lan'
        ? 11 * 60 * 1000
        : isAdminActionMutation || isAdminPlanMutation || isModRequest
          ? 30_000
        : path[0] === 'companion' && ['start', 'stop'].includes(path[1] ?? '')
          ? 2 * 60 * 1000
        : 15_000;
    let upstream: Response;
    let responseBody: string;
    try {
      const upstreamUrl = new URL(target, baseUrl);
      const upstreamHeaders = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      };
      const signal = AbortSignal.timeout(timeoutMs);
      upstream = timeoutMs > BUFFERED_LOCAL_CONTROL_THRESHOLD_MS
        ? await bufferedLocalControlRequest(upstreamUrl, {
          method: request.method,
          headers: upstreamHeaders,
          body,
          signal,
        })
        : await fetch(upstreamUrl, {
        method: request.method,
        headers: upstreamHeaders,
        body,
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
      responseBody = await readBoundedUpstreamJson(
        upstream,
        isLogRequest ? MAX_LOG_RESPONSE_BYTES : MAX_UPSTREAM_RESPONSE_BYTES,
        isWorldRequest
          ? (envelope) => sanitizeWorldEnvelope(
            envelope,
            isWorldPlanMutation ? 'plan' : isWorldActionMutation || isWorldOperationRead ? 'operation' : 'inventory',
            worldExpected,
          )
          : isInstanceInventory
            ? publicInstancesEnvelope
            : isUpdateStatus
              ? (envelope) => publicUpdateStatusEnvelope(envelope, path[1])
              : isFirstPartyCoreStatus
                ? publicFirstPartyCoreEnvelope
              : isFirstPartyCoreMutation
                ? publicFirstPartyCoreOperationEnvelope
              : isFamilyCoreIdentityBinding
                ? publicFamilyCoreIdentityEnvelope
              : isUpdateAction
                ? (envelope) => publicUpdateActionEnvelope(envelope, path[1])
                : isRetiredVersionPurge
                  ? (envelope) => publicRetiredVersionPurgeEnvelope(envelope, path[1])
                  : isBrainStatus
                    ? publicBrainEnvelope
                  : isConversationStatus
                    ? publicConversationStatusEnvelope
                  : undefined,
      );
    } catch (error) {
      if (isFirstPartyCoreMutation) {
        return errorResponse(
          504,
          'FAMILY_CORE_OPERATION_COMPLETION_UNKNOWN',
          'The Family Core request may have reached the local agent. Do not retry it; refresh first-party core status and reconcile the exact generation.',
        );
      }
      if (isRetiredVersionPurge) {
        return errorResponse(
          504,
          'RETIRED_VERSION_PURGE_COMPLETION_UNKNOWN',
          'The cleanup request may have reached the local agent. Do not retry it; refresh managed instance state and reconcile the retained update payload.',
        );
      }
      if (isUpdateAction) {
        return errorResponse(
          504,
          'UPDATE_OPERATION_COMPLETION_UNKNOWN',
          'The update request may have reached the local agent. Do not retry it; refresh authoritative instance and update status before taking another action.',
        );
      }
      if (isWorldActionMutation) {
        return errorResponse(
          504,
          'WORLD_OPERATION_COMPLETION_UNKNOWN',
          'The local agent did not return a trustworthy final world-operation result. Do not retry it; reconcile the exact request ID.',
        );
      }
      if (isWorldPlanMutation) {
        return errorResponse(
          504,
          'WORLD_PLAN_COMPLETION_UNKNOWN',
          'The local agent did not return a trustworthy world-plan result. No world action was submitted.',
        );
      }
      if (isModActionMutation) {
        return errorResponse(
          504,
          'MOD_OPERATION_COMPLETION_UNKNOWN',
          'The local agent did not return a final mod transaction result. The transaction may have committed or rolled back; do not retry it automatically.',
        );
      }
      if (isModPlanMutation) {
        return errorResponse(
          504,
          'MOD_PLAN_COMPLETION_UNKNOWN',
          'The local agent did not return a final mod-plan result. A plan may exist, but no mod transaction was submitted.',
        );
      }
      if (isAdminActionMutation) {
        return errorResponse(
          504,
          'ADMIN_OPERATION_COMPLETION_UNKNOWN',
          'The local agent did not return a final administration result. The action may have been accepted; do not retry it automatically.',
        );
      }
      if (isAdminPlanMutation) {
        return errorResponse(
          504,
          'ADMIN_PLAN_COMPLETION_UNKNOWN',
          'The local agent did not return a final administration-plan result. A plan may exist, but no game action was submitted.',
        );
      }
      if (isBackupMutationWithAmbiguousTransportFailure) {
        return errorResponse(
          504,
          'BACKUP_OPERATION_COMPLETION_UNKNOWN',
          'The local agent did not return a final backup result. The operation may still be running; do not retry it until backup inventory confirms the outcome.',
        );
      }
      if (error instanceof MinecraftAccessError) throw error;
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
        return errorResponse(504, 'CONTROL_PLANE_TIMEOUT', 'The local Minecraft agent did not answer before the local request timed out.');
      }
      return errorResponse(503, 'CONTROL_PLANE_OFFLINE', 'The local Minecraft agent is not reachable.');
    }
    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'Content-Security-Policy': "default-src 'none'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof MinecraftAccessError) return errorResponse(error.status, error.code, error.message);
    return errorResponse(500, 'CONTROL_PROXY_ERROR', 'The local control boundary failed safely.');
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}
