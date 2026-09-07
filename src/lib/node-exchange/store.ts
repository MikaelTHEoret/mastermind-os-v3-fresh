import 'server-only';

import crypto from 'node:crypto';

import { getMemoryDb } from '@/lib/db';
import { LOCAL_FAMILY_OPERATOR_PROFILE } from '@/lib/memory/local-family-profile.mjs';
import {
  MASTERMIND_NODE_CAPABILITY,
  MASTERMIND_CORE_STATUS_CAPABILITY,
  MASTERMIND_NODE_EXCHANGE_MAX_BYTES,
  MASTERMIND_NODE_POLICY_CLASS,
  MASTERMIND_NODE_SCHEMA_VERSION,
  canonicalMastermindNodeExchangeRequest,
  digestMastermindNodeCommand,
  digestMastermindNodeCredential,
  digestMastermindNodeReceipt,
  parseMastermindNodeCredential,
  parseMastermindNodePairingCredential,
  validateMastermindNodeExchangeRequest,
  validateMastermindNodeExchangeResponse,
  validateMastermindNodePairRequest,
  validateMastermindNodePairResponse,
  validateMastermindNodeStatus,
  validateMastermindNodeWorker,
  validateMastermindNodeCommand,
  validateMastermindCoreStatus,
} from '../../../protocol/mastermind-node-exchange/contract.mjs';

export type NodeExchangeSql = ReturnType<typeof getMemoryDb>;

type DatabaseRow = Record<string, unknown>;

export type OwnerNodeProfile = Readonly<{
  householdId: string;
  parentPlayerId: string;
}>;

export const OWNER_NODE_PROFILE: OwnerNodeProfile = Object.freeze({
  householdId: LOCAL_FAMILY_OPERATOR_PROFILE.householdId,
  parentPlayerId: LOCAL_FAMILY_OPERATOR_PROFILE.parentPlayerId,
});

export const NODE_EXCHANGE_NEXT_POLL_MS = 5_000;
export const NODE_EXCHANGE_MAX_BODY_BYTES = MASTERMIND_NODE_EXCHANGE_MAX_BYTES;
const PAIRING_LIFETIME_MS = 10 * 60 * 1_000;
const JOB_LIFETIME_MS = 30 * 60 * 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const JOB_STATES = new Set(['queued', 'leased', 'running', 'succeeded', 'failed', 'expired']);

export class NodeExchangeServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'NodeExchangeServiceError';
    this.status = status;
    this.code = code;
  }
}

function fail(status: number, code: string, message: string): never {
  throw new NodeExchangeServiceError(status, code, message);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function createPairingCredential(id: string): string {
  return `mnp1.${id}.${crypto.randomBytes(32).toString('base64url')}`;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    fail(503, 'NODE_STORE_INVALID', `Stored ${label} is invalid.`);
  }
  return value;
}

function text(value: unknown, label: string, maximum = 256): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || /[\r\n\0]/.test(value)) {
    fail(503, 'NODE_STORE_INVALID', `Stored ${label} is invalid.`);
  }
  return value;
}

function nullableText(value: unknown, label: string, maximum = 256): string | null {
  return value === null || value === undefined ? null : text(value, label, maximum);
}

function iso(value: unknown, label: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) fail(503, 'NODE_STORE_INVALID', `Stored ${label} is invalid.`);
  return date.toISOString();
}

function nullableIso(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : iso(value, label);
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); }
    catch { fail(503, 'NODE_STORE_INVALID', `Stored ${label} is invalid.`); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(503, 'NODE_STORE_INVALID', `Stored ${label} is invalid.`);
  }
  return parsed as Record<string, unknown>;
}

function nullableObject(value: unknown, label: string): Record<string, unknown> | null {
  return value === null || value === undefined ? null : objectValue(value, label);
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail(503, 'NODE_STORE_INVALID', `Stored ${label} is invalid.`);
  }
  return [...value] as string[];
}

function first(rows: unknown, operation: string): DatabaseRow {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') {
    fail(503, 'NODE_STORE_UNAVAILABLE', `${operation} did not return its expected result.`);
  }
  return rows[0] as DatabaseRow;
}

function databaseFailure(error: unknown): never {
  if (error instanceof NodeExchangeServiceError) throw error;
  const code = typeof (error as { code?: unknown })?.code === 'string'
    ? (error as { code: string }).code
    : '';
  if (code === '28000') fail(401, 'NODE_CREDENTIAL_INVALID', 'The node credential is invalid.');
  if (code === '55000') fail(409, 'NODE_PAIRING_CONSUMED', 'The pairing credential was already used.');
  if (code === '57014') fail(410, 'NODE_PAIRING_EXPIRED', 'The pairing credential expired.');
  if (code === '42501') fail(403, 'NODE_NOT_AVAILABLE', 'The requested node is not available.');
  if (code === '23505') fail(409, 'NODE_CONFLICT', 'The node request conflicts with existing state.');
  if (code === '22023' || code === '22P02') fail(400, 'NODE_REQUEST_INVALID', 'The node request is invalid.');
  fail(503, 'NODE_STORE_UNAVAILABLE', 'The hosted node exchange is temporarily unavailable.');
}

export type OwnerPairing = Readonly<{
  pairingId: string;
  pairingCredential: string;
  expiresAt: string;
}>;

export async function createOwnerPairing(
  sql: NodeExchangeSql,
  profile: OwnerNodeProfile = OWNER_NODE_PROFILE,
  now = new Date(),
): Promise<OwnerPairing> {
  const pairingId = crypto.randomUUID();
  const pairingCredential = createPairingCredential(pairingId);
  const expiresAt = new Date(now.getTime() + PAIRING_LIFETIME_MS).toISOString();
  try {
    const row = first(await sql`
      SELECT * FROM public.create_mastermind_node_pairing_v1(
        ${pairingId}::uuid,
        ${sha256(pairingCredential)}::text,
        ${profile.householdId}::text,
        ${profile.parentPlayerId}::uuid,
        ${expiresAt}::timestamptz
      )
    `, 'Pairing creation');
    const status = text(row.status, 'pairing status', 16);
    if (status !== 'applied' || uuid(row.pairing_id, 'pairing ID') !== pairingId) {
      fail(409, 'NODE_PAIRING_CONFLICT', 'A pairing credential could not be created.');
    }
    return Object.freeze({ pairingId, pairingCredential, expiresAt: iso(row.expires_at, 'pairing expiry') });
  } catch (error) {
    databaseFailure(error);
  }
}

export async function claimNodePairing(
  sql: NodeExchangeSql,
  pairingCredential: string,
  rawRequest: unknown,
): Promise<Record<string, unknown>> {
  const request = validateMastermindNodePairRequest(rawRequest);
  const parsed = parseMastermindNodePairingCredential(pairingCredential);
  if (parsed.pairingId !== request.pairingId) {
    fail(401, 'NODE_PAIRING_SCOPE_MISMATCH', 'The pairing credential does not match this request.');
  }
  try {
    const row = first(await sql`
      SELECT * FROM public.claim_mastermind_node_pairing_v1(
        ${parsed.pairingId}::uuid,
        ${sha256(pairingCredential)}::text,
        ${request.node.nodeId}::uuid,
        ${request.node.credentialSha256}::text,
        ${request.node.displayName}::text,
        ${request.node.agentVersion}::text
      )
    `, 'Pairing claim');
    const pairedAt = iso(row.paired_at, 'paired time');
    const response = {
      schemaVersion: MASTERMIND_NODE_SCHEMA_VERSION,
      nodeId: uuid(row.node_id, 'node ID'),
      pairedAt,
      nextPollAfterMs: NODE_EXCHANGE_NEXT_POLL_MS,
    };
    return validateMastermindNodePairResponse(response, { expectedNodeId: request.node.nodeId });
  } catch (error) {
    databaseFailure(error);
  }
}

export async function exchangeNodeState(
  sql: NodeExchangeSql,
  nodeCredential: string,
  rawRequest: unknown,
): Promise<Record<string, unknown>> {
  const protocol = { core: (rawRequest as { schemaVersion?: unknown })?.schemaVersion === 2 };
  const request = validateMastermindNodeExchangeRequest(rawRequest, protocol);
  const parsed = parseMastermindNodeCredential(nodeCredential);
  if (parsed.nodeId !== request.nodeId) {
    fail(401, 'NODE_CREDENTIAL_SCOPE_MISMATCH', 'The node credential does not match this request.');
  }
  const requestDigest = sha256(canonicalMastermindNodeExchangeRequest(request, protocol));
  const receiptDigests = request.receipts.map((receipt: unknown) => digestMastermindNodeReceipt(receipt, protocol));
  const candidateLeaseId = crypto.randomUUID();
  try {
    const rows = protocol.core ? await sql`
      SELECT * FROM public.exchange_mastermind_node_v2(
        ${request.exchangeId}::uuid, ${requestDigest}::text, ${request.nodeId}::uuid,
        ${digestMastermindNodeCredential(nodeCredential)}::text, ${request.bootId}::uuid,
        ${request.sentAt}::timestamptz, ${request.agentVersion}::text,
        ${JSON.stringify(request.status)}::jsonb, ${JSON.stringify(request.receipts)}::jsonb,
        ${receiptDigests}::text[], ${candidateLeaseId}::uuid, ${JSON.stringify(request.worker)}::jsonb
      )
    ` : await sql`
      SELECT * FROM public.exchange_mastermind_node_v1(
        ${request.exchangeId}::uuid,
        ${requestDigest}::text,
        ${request.nodeId}::uuid,
        ${digestMastermindNodeCredential(nodeCredential)}::text,
        ${request.bootId}::uuid,
        ${request.sentAt}::timestamptz,
        ${request.agentVersion}::text,
        ${JSON.stringify(request.status)}::jsonb,
        ${JSON.stringify(request.receipts)}::jsonb,
        ${receiptDigests}::text[],
        ${candidateLeaseId}::uuid
      )
    `;
    const row = first(rows, 'Node exchange');
    const lease = nullableObject(row.lease, 'job lease');
    const response = {
      schemaVersion: protocol.core ? 2 : MASTERMIND_NODE_SCHEMA_VERSION,
      exchangeId: uuid(row.exchange_id, 'exchange ID'),
      serverTime: iso(row.server_time, 'exchange time'),
      nextPollAfterMs: NODE_EXCHANGE_NEXT_POLL_MS,
      acknowledgedReceiptIds: stringArray(row.acknowledged_receipt_ids, 'acknowledged receipts'),
      lease,
      ...(protocol.core ? { acceptedWorker: validateMastermindNodeWorker(request.worker) } : {}),
    };
    return validateMastermindNodeExchangeResponse(response, {
      expectedExchangeId: request.exchangeId,
      expectedNodeId: request.nodeId,
      expectedReceiptIds: request.receipts.map((receipt: { receiptId: string }) => receipt.receiptId),
      ...protocol,
      expectedWorker: request.worker,
    });
  } catch (error) {
    databaseFailure(error);
  }
}

export type PublicNode = Readonly<{
  nodeId: string;
  displayName: string;
  state: 'active' | 'revoked';
  connectivity: 'online' | 'offline' | 'never-seen';
  agentVersion: string;
  pairedAt: string;
  lastExchangeAt: string | null;
  lastJobReceiptAt: string | null;
  status: Record<string, unknown> | null;
  worker: Record<string, unknown> | null;
}>;

function publicNode(row: DatabaseRow, now: Date): PublicNode {
  const state = text(row.state, 'node state', 16);
  if (state !== 'active' && state !== 'revoked') fail(503, 'NODE_STORE_INVALID', 'Stored node state is invalid.');
  const lastExchangeAt = nullableIso(row.lastExchangeAt, 'last exchange time');
  const connectivity = lastExchangeAt === null
    ? 'never-seen'
    : now.getTime() - Date.parse(lastExchangeAt) <= 30_000 ? 'online' : 'offline';
  const rawStatus = nullableObject(row.status, 'node status');
  const status = rawStatus === null ? null : validateMastermindNodeStatus(rawStatus);
  const rawWorker = nullableObject(row.worker, 'worker advertisement');
  const worker = rawWorker === null || rawWorker.protocolVersion === 1 ? null : validateMastermindNodeWorker(rawWorker);
  return Object.freeze({
    nodeId: uuid(row.nodeId, 'node ID'),
    displayName: text(row.displayName, 'display name', 64),
    state,
    connectivity,
    agentVersion: text(row.agentVersion, 'agent version', 32),
    pairedAt: iso(row.pairedAt, 'paired time'),
    lastExchangeAt,
    lastJobReceiptAt: nullableIso(row.lastJobReceiptAt, 'last receipt time'),
    status,
    worker,
  });
}

export async function listOwnerNodes(
  sql: NodeExchangeSql,
  profile: OwnerNodeProfile = OWNER_NODE_PROFILE,
  now = new Date(),
): Promise<PublicNode[]> {
  try {
    const rows = await sql`
      SELECT
        node.node_id AS "nodeId",
        node.display_name AS "displayName",
        node.state,
        node.agent_version AS "agentVersion",
        node.paired_at AS "pairedAt",
        node.last_exchange_at AS "lastExchangeAt",
        node.last_job_receipt_at AS "lastJobReceiptAt",
        node.last_status AS status,
        to_jsonb(node) -> 'last_worker' AS worker
      FROM public.mastermind_nodes_v1 AS node
      WHERE node.household_id = ${profile.householdId}::text
        AND EXISTS (
          SELECT 1 FROM public.mastermind_active_parent_profile_v1(
            ${profile.householdId}::text, ${profile.parentPlayerId}::uuid
          )
        )
      ORDER BY node.paired_at DESC, node.node_id
    `;
    if (!Array.isArray(rows)) fail(503, 'NODE_STORE_UNAVAILABLE', 'Node inventory is unavailable.');
    return rows.map((row) => publicNode(row as DatabaseRow, now));
  } catch (error) {
    databaseFailure(error);
  }
}

export type PublicJob = Readonly<{
  jobId: string;
  nodeId: string;
  capability: typeof MASTERMIND_NODE_CAPABILITY | typeof MASTERMIND_CORE_STATUS_CAPABILITY;
  capabilityVersion: 1;
  policyClass: typeof MASTERMIND_NODE_POLICY_CLASS;
  state: 'queued' | 'leased' | 'running' | 'succeeded' | 'failed' | 'expired';
  createdAt: string;
  expiresAt: string;
  lease: null | Readonly<{ leaseId: string; leasedAt: string; leaseExpiresAt: string }>;
  terminal: null | Readonly<{ code: string; result: Record<string, unknown> | null; finishedAt: string }>;
}>;

function publicJob(row: DatabaseRow): PublicJob {
  const command = validateMastermindNodeCommand({ jobId: row.jobId, nodeId: row.nodeId,
    capability: row.capability, capabilityVersion: row.capabilityVersion, policyClass: row.policyClass, input: {} }, { core: true });
  const state = text(row.state, 'job state', 16);
  if (!JOB_STATES.has(state)) fail(503, 'NODE_STORE_INVALID', 'Stored job state is invalid.');
  const leaseId = row.leaseId === null || row.leaseId === undefined ? null : uuid(row.leaseId, 'lease ID');
  const leasedAt = nullableIso(row.leasedAt, 'leased time');
  const leaseExpiresAt = nullableIso(row.leaseExpiresAt, 'lease expiry');
  if ((leaseId === null) !== (leasedAt === null) || (leaseId === null) !== (leaseExpiresAt === null)) {
    fail(503, 'NODE_STORE_INVALID', 'Stored job lease is invalid.');
  }
  const terminalCode = nullableText(row.terminalCode, 'terminal code', 128);
  const finishedAt = nullableIso(row.finishedAt, 'finished time');
  const terminalResult = nullableObject(row.terminalResult, 'terminal result');
  if ((terminalCode === null) !== (finishedAt === null)) {
    fail(503, 'NODE_STORE_INVALID', 'Stored job terminal state is invalid.');
  }
  if (command.capability === MASTERMIND_CORE_STATUS_CAPABILITY) {
    if (state === 'succeeded') {
      try { validateMastermindCoreStatus(terminalResult); }
      catch { fail(503, 'NODE_STORE_INVALID', 'Stored core observation is invalid.'); }
    } else if (terminalResult !== null) {
      fail(503, 'NODE_STORE_INVALID', 'Stored core failure cannot contain another capability result.');
    }
  }
  return Object.freeze({
    jobId: uuid(row.jobId, 'job ID'),
    nodeId: uuid(row.nodeId, 'node ID'),
    capability: command.capability,
    capabilityVersion: 1,
    policyClass: MASTERMIND_NODE_POLICY_CLASS,
    state: state as PublicJob['state'],
    createdAt: iso(row.createdAt, 'job creation time'),
    expiresAt: iso(row.expiresAt, 'job expiry'),
    lease: leaseId === null ? null : Object.freeze({ leaseId, leasedAt: leasedAt!, leaseExpiresAt: leaseExpiresAt! }),
    terminal: terminalCode === null
      ? null
      : Object.freeze({ code: terminalCode, result: terminalResult, finishedAt: finishedAt! }),
  });
}

async function readOwnerJob(
  sql: NodeExchangeSql,
  nodeId: string,
  jobId: string,
  profile: OwnerNodeProfile,
): Promise<PublicJob | null> {
  const rows = await sql`
    SELECT
      job.job_id AS "jobId", job.node_id AS "nodeId", job.state,
      job.capability, job.capability_version AS "capabilityVersion", job.policy_class AS "policyClass",
      job.created_at AS "createdAt", job.expires_at AS "expiresAt",
      job.lease_id AS "leaseId", job.leased_at AS "leasedAt",
      job.lease_expires_at AS "leaseExpiresAt", job.terminal_code AS "terminalCode",
      job.terminal_result AS "terminalResult", job.finished_at AS "finishedAt"
    FROM public.mastermind_node_jobs_v1 AS job
    WHERE job.job_id = ${jobId}::uuid
      AND job.node_id = ${nodeId}::uuid
      AND job.household_id = ${profile.householdId}::text
      AND EXISTS (
        SELECT 1 FROM public.mastermind_active_parent_profile_v1(
          ${profile.householdId}::text, ${profile.parentPlayerId}::uuid
        )
      )
  `;
  if (!Array.isArray(rows) || rows.length > 1) fail(503, 'NODE_STORE_UNAVAILABLE', 'Job lookup is unavailable.');
  return rows.length === 0 ? null : publicJob(rows[0] as DatabaseRow);
}

export async function getOwnerJob(
  sql: NodeExchangeSql,
  nodeId: string,
  jobId: string,
  profile: OwnerNodeProfile = OWNER_NODE_PROFILE,
): Promise<PublicJob> {
  if (!UUID.test(nodeId) || !UUID.test(jobId)) fail(400, 'NODE_REQUEST_INVALID', 'Node and job IDs must be UUIDs.');
  try {
    const job = await readOwnerJob(sql, nodeId, jobId, profile);
    if (!job) fail(404, 'NODE_JOB_NOT_FOUND', 'The requested node job was not found.');
    return job;
  } catch (error) {
    databaseFailure(error);
  }
}

export async function enqueueEnsureRunningJob(
  sql: NodeExchangeSql,
  nodeId: string,
  requestId: string,
  profile: OwnerNodeProfile = OWNER_NODE_PROFILE,
  now = new Date(),
): Promise<Readonly<{ status: 'created' | 'duplicate' | 'coalesced'; job: PublicJob }>> {
  return enqueueTypedJob(sql, nodeId, requestId, profile, now, MASTERMIND_NODE_CAPABILITY);
}

export async function enqueueCoreStatusJob(
  sql: NodeExchangeSql,
  nodeId: string,
  requestId: string,
  profile: OwnerNodeProfile = OWNER_NODE_PROFILE,
  now = new Date(),
): Promise<Readonly<{ status: 'created' | 'duplicate' | 'coalesced'; job: PublicJob }>> {
  return enqueueTypedJob(sql, nodeId, requestId, profile, now, MASTERMIND_CORE_STATUS_CAPABILITY);
}

async function enqueueTypedJob(
  sql: NodeExchangeSql, nodeId: string, requestId: string, profile: OwnerNodeProfile,
  now: Date, capability: typeof MASTERMIND_NODE_CAPABILITY | typeof MASTERMIND_CORE_STATUS_CAPABILITY,
): Promise<Readonly<{ status: 'created' | 'duplicate' | 'coalesced'; job: PublicJob }>> {
  if (!UUID.test(nodeId) || !UUID.test(requestId)) fail(400, 'NODE_REQUEST_INVALID', 'Node and request IDs must be UUIDs.');
  const command = {
    jobId: requestId,
    nodeId,
    capability,
    capabilityVersion: 1,
    policyClass: MASTERMIND_NODE_POLICY_CLASS,
    input: {},
  };
  const commandDigest = digestMastermindNodeCommand(command, { core: true });
  if (!SHA256.test(commandDigest)) fail(503, 'NODE_CONTRACT_INVALID', 'The command digest is invalid.');
  const expiresAt = new Date(now.getTime() + JOB_LIFETIME_MS).toISOString();
  try {
    const rows = capability === MASTERMIND_CORE_STATUS_CAPABILITY ? await sql`
      SELECT * FROM public.enqueue_mastermind_core_status_job_v2(
        ${requestId}::uuid, ${commandDigest}::text, ${nodeId}::uuid,
        ${profile.householdId}::text, ${profile.parentPlayerId}::uuid, ${expiresAt}::timestamptz
      )
    ` : await sql`
      SELECT * FROM public.enqueue_mastermind_node_job_v1(
        ${requestId}::uuid,
        ${commandDigest}::text,
        ${nodeId}::uuid,
        ${profile.householdId}::text,
        ${profile.parentPlayerId}::uuid,
        ${expiresAt}::timestamptz
      )
    `;
    const row = first(rows, 'Job enqueue');
    const databaseStatus = text(row.status, 'job enqueue status', 16);
    if (!['applied', 'duplicate', 'coalesced'].includes(databaseStatus)) {
      fail(409, 'NODE_JOB_CONFLICT', 'The node job conflicts with existing state.');
    }
    const returnedJobId = uuid(row.job_id, 'job ID');
    const job = await readOwnerJob(sql, nodeId, returnedJobId, profile);
    if (!job) fail(503, 'NODE_STORE_UNAVAILABLE', 'The created node job could not be read.');
    return Object.freeze({
      status: databaseStatus === 'applied' ? 'created' : databaseStatus as 'duplicate' | 'coalesced',
      job,
    });
  } catch (error) {
    databaseFailure(error);
  }
}
