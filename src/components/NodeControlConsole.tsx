'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  HOSTED_NODE_CONTROL_URL,
  NODE_ENSURE_RUNNING_CAPABILITY,
  NODE_CORE_STATUS_CAPABILITY,
  nodeSupportsCoreStatus,
  nodeSupportsFamily,
  buildLocalNodePairingHandoffUrl,
  isLocalNodeControlOrigin,
  isTerminalNodeJob,
  parseNodeApiError,
  parseNodeInventory,
  parseNodeJob,
  parseNodeJobEnqueue,
  parseNodePairing,
} from './node-control-contract.mjs';

type Connectivity = 'online' | 'offline' | 'never-seen';
type NodeState = 'active' | 'revoked';
type JobState = 'queued' | 'leased' | 'running' | 'succeeded' | 'failed' | 'expired';
type NodeControlSurface = 'checking' | 'hosted' | 'local';
type NodeCapability = typeof NODE_ENSURE_RUNNING_CAPABILITY | typeof NODE_CORE_STATUS_CAPABILITY;
type CoreObservation = Readonly<{ kind: typeof NODE_CORE_STATUS_CAPABILITY; observedAt: string;
  services: Readonly<{ mcpHost: string; memory: string; modules: string }>;
  capabilities: Readonly<{ count: number | null; sha256: string | null }>;
  activeTurns: number | null; complete: boolean }>;
type FamilyResult = Readonly<{ familyServer: string; companion: string; companionBridge: string }>;
type NodeStatus = Readonly<{
  observedAt: string;
  controlAgent: 'online' | 'unreachable';
  recovery: 'clear' | 'manual-repair-required' | 'unknown';
  familyServer: 'unknown' | 'missing' | 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
  companion: 'unknown' | 'not-installed' | 'sign-in-required' | 'stopped' | 'starting' | 'running' | 'stopping' | 'failed' | 'orphaned';
  companionBridge: 'unknown' | 'disconnected' | 'handshaking' | 'syncing' | 'ready';
  localKillSwitch: boolean | null;
  attentionCodes: string[];
}>;
type PublicNode = Readonly<{
  nodeId: string;
  displayName: string;
  state: NodeState;
  connectivity: Connectivity;
  agentVersion: string;
  pairedAt: string;
  lastExchangeAt: string | null;
  lastJobReceiptAt: string | null;
  status: NodeStatus | null;
  worker?: null | Readonly<{ protocolVersion: 2; capabilities: ReadonlyArray<{ id: string; version: number }> }>; 
}>;
type PublicJob = Readonly<{
  jobId: string;
  nodeId: string;
  capability: NodeCapability;
  capabilityVersion: 1;
  policyClass: 'routine';
  state: JobState;
  createdAt: string;
  expiresAt: string;
  lease: null | Readonly<{ leaseId: string; leasedAt: string; leaseExpiresAt: string }>;
  terminal: null | Readonly<{
    code: string;
    result: null | FamilyResult | CoreObservation;
    finishedAt: string;
  }>;
}>;
type NodeInventory = Readonly<{ ok: true; nodes: PublicNode[] }>;
type NodeRun = Readonly<{
  requestId: string;
  capability: NodeCapability;
  job: PublicJob | null;
  busy: boolean;
  needsReconciliation: boolean;
  message: string | null;
  error: boolean;
}>;

const NODES_PATH = '/api/nodes';
const NODE_PAIRINGS_PATH = '/api/nodes/pairings';
const INVENTORY_POLL_MS = 5_000;
const JOB_POLL_MS = 2_000;
const MAX_INVENTORY_BYTES = 128 * 1024;
const MAX_JOB_BYTES = 32 * 1024;
const MAX_PAIRING_BYTES = 8 * 1024;

const C = {
  cyan: '#00ffff',
  dim: 'rgba(0,255,255,0.35)',
  green: '#00ffaa',
  gold: '#ffaa00',
  red: '#ff4444',
  muted: 'rgba(220,255,255,0.62)',
  panel: 'rgba(0,15,35,0.78)',
};
const mono = 'Orbitron, monospace';
const body = 'Rajdhani, monospace';

const panel: CSSProperties = {
  background: C.panel,
  border: `1px solid ${C.cyan}30`,
  borderRadius: 8,
  padding: 14,
};

const ATTENTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'companion-failed': 'AI companion failed',
  'companion-local-kill-switch': 'Local AI kill switch is active',
  'companion-not-installed': 'AI companion is not installed',
  'companion-orphaned': 'AI companion needs a clean local restart',
  'companion-sign-in-required': 'Minecraft sign-in is required locally',
  'control-agent-unreachable': 'Local Minecraft agent is unreachable',
  'family-server-failed': 'Family Server failed to start',
  'family-server-not-provisioned': 'Family Server is not provisioned',
  'local-response-invalid': 'Local status could not be verified',
  'local-safe-stop-required': 'A local safe stop must finish first',
  'minecraft-update-approval-required': 'Minecraft update approval is required',
  'recovery-manual-repair': 'Backup recovery needs local repair',
});

const TERMINAL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'desired-state-reached': 'Family ecosystem is ready',
  'companion-local-kill-switch': 'Local AI kill switch is active',
  'companion-not-installed': 'AI companion is not installed',
  'companion-orphaned': 'AI companion needs a clean local restart',
  'companion-sign-in-required': 'Minecraft sign-in is required locally',
  'companion-start-failed': 'AI companion did not start',
  'control-agent-unreachable': 'Local Minecraft agent is unreachable',
  'execution-timeout': 'The start request timed out',
  'family-server-not-provisioned': 'Family Server is not provisioned',
  'family-server-start-failed': 'Family Server did not start',
  'lease-lost': 'The node lost its execution lease',
  'local-response-invalid': 'Local status could not be verified',
  'local-safe-stop-required': 'A local safe stop must finish first',
  'minecraft-update-approval-required': 'Minecraft update approval is required',
  'recovery-manual-repair': 'Backup recovery needs local repair',
});

class NodeApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super('The hosted node request failed safely.');
    this.name = 'NodeApiError';
  }
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('The hosted node response was too large.');
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('The hosted node response was not JSON.');
  }
  if (!response.body) throw new Error('The hosted node response had no body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error('The hosted node response was too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('The hosted node response was not valid UTF-8.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('The hosted node response was not valid JSON.');
  }
}

async function requestJson(path: string, maximumBytes: number, init: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
  });
  const payload = await readBoundedJson(response, maximumBytes);
  if (!response.ok) {
    const error = parseNodeApiError(payload);
    throw new NodeApiError(response.status, error.error.code);
  }
  return payload;
}

function jobPath(nodeId: string, jobId?: string): string {
  const base = `${NODES_PATH}/${encodeURIComponent(nodeId)}/jobs`;
  return jobId === undefined ? base : `${base}/${encodeURIComponent(jobId)}`;
}

async function readJob(nodeId: string, jobId: string, signal: AbortSignal, capability: NodeCapability = NODE_ENSURE_RUNNING_CAPABILITY): Promise<PublicJob> {
  const payload = await requestJson(jobPath(nodeId, jobId), MAX_JOB_BYTES, { method: 'GET', signal });
  return (parseNodeJob(payload, nodeId, jobId, capability) as Readonly<{ ok: true; job: PublicJob }>).job;
}

async function enqueueJob(nodeId: string, requestId: string, signal: AbortSignal, capability: NodeCapability = NODE_ENSURE_RUNNING_CAPABILITY): Promise<PublicJob> {
  const payload = await requestJson(jobPath(nodeId), MAX_JOB_BYTES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capability, requestId }),
    signal,
  });
  return (parseNodeJobEnqueue(payload, nodeId, requestId, capability) as Readonly<{ ok: true; job: PublicJob }>).job;
}

async function reconcileExactRequest(nodeId: string, requestId: string, signal: AbortSignal, capability: NodeCapability = NODE_ENSURE_RUNNING_CAPABILITY, allowEnqueue: boolean | (() => boolean) = true): Promise<PublicJob> {
  try {
    return await readJob(nodeId, requestId, signal, capability);
  } catch (error) {
    if (!(error instanceof NodeApiError) || error.status !== 404) throw error;
  }
  if (!(typeof allowEnqueue === 'function' ? allowEnqueue() : allowEnqueue)) {
    throw new NodeApiError(409, 'NODE_RECONCILIATION_HELD');
  }
  return enqueueJob(nodeId, requestId, signal, capability);
}

function jobMessage(job: PublicJob): string {
  if (job.capability === NODE_CORE_STATUS_CAPABILITY) {
    if (job.state === 'succeeded') {
      const result = job.terminal?.result as CoreObservation;
      return result.complete ? 'Core status observed · all sources available' : 'Core status observed · incomplete';
    }
    if (job.state === 'failed' || job.state === 'expired') return 'Core status request did not complete';
    return `CORE STATUS ${humanState(job.state)}${job.state === 'queued' ? ' · WAITING FOR NODE' : ''}`;
  }
  return job.terminal === null ? `START REQUEST ${humanState(job.state)}` : TERMINAL_LABELS[job.terminal.code] ?? humanState(job.terminal.code);
}

function abortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function mutationDefinitelyRejected(error: unknown): boolean {
  return error instanceof NodeApiError && [400, 401, 403, 404, 405].includes(error.status);
}

function inventoryFailureMessage(error: unknown): string {
  if (error instanceof NodeApiError && (error.status === 401 || error.status === 403)) {
    return 'The hosted owner session is not authorized to view family nodes.';
  }
  return 'Hosted node status is temporarily unavailable. Previously verified status is marked stale.';
}

function mutationFailureMessage(error: unknown): string {
  if (error instanceof NodeApiError) {
    if (error.code === 'NODE_RECONCILIATION_HELD') return 'The original request was not found. Current node support does not allow resubmission; no new request was sent.';
    if (error.status === 401 || error.status === 403) return 'The hosted owner session is not authorized to request this operation.';
    if (error.status === 404) return 'This node is no longer available. Status was refreshed.';
    if (error.status === 400) return 'The request was rejected before it could run.';
    if (error.status === 409) return 'The hosted job state changed. The exact request can be reconciled safely.';
  }
  return 'The request result is not yet known. Reconcile reuses the exact same request; it does not create a second intent.';
}

function pairingFailureMessage(error: unknown): string {
  if (error instanceof NodeApiError) {
    if (error.status === 401 || error.status === 403) return 'Sign in as the Mastermind owner to pair this PC.';
    if (error.status === 503) return 'Hosted pairing is temporarily unavailable. Nothing was saved on this PC.';
  }
  return 'Pairing could not be handed to this PC. No credential was stored locally; try again.';
}

function waitForPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, JOB_POLL_MS);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function formatTime(value: string | null): string {
  return value === null ? 'never' : new Date(value).toLocaleString();
}

function humanState(value: string): string {
  return value.split('-').join(' ').toUpperCase();
}

function connectivityColor(connectivity: Connectivity): string {
  if (connectivity === 'online') return C.green;
  if (connectivity === 'offline') return C.red;
  return C.gold;
}

function jobColor(state: JobState): string {
  if (state === 'succeeded') return C.green;
  if (state === 'failed' || state === 'expired') return C.red;
  return C.gold;
}

function StatusBadge({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        background: `${color}12`,
        border: `1px solid ${color}55`,
        borderRadius: 999,
        color,
        fontFamily: mono,
        fontSize: 9,
        letterSpacing: 1.1,
        padding: '4px 8px',
        textShadow: `0 0 6px ${color}`,
      }}
    >
      {label}
    </span>
  );
}

function PlainButton({ children, disabled = false, onClick }: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        appearance: 'none',
        background: 'rgba(0,255,255,0.07)',
        border: `1px solid ${C.cyan}55`,
        borderRadius: 5,
        color: C.cyan,
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: mono,
        fontSize: 9,
        letterSpacing: 1.1,
        minHeight: 34,
        opacity: disabled ? 0.5 : 1,
        padding: '7px 11px',
      }}
    >
      {children}
    </button>
  );
}

function Detail({ label, value, color = C.muted }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'contents' }}>
      <dt style={{ color: C.dim }}>{label}</dt>
      <dd style={{ color, margin: 0, textAlign: 'right' }}>{value}</dd>
    </div>
  );
}

export function NodeJobResult({ job }: { job: PublicJob }) {
  const result = job.terminal?.result;
  const core = result && 'kind' in result && result.kind === NODE_CORE_STATUS_CAPABILITY ? result as CoreObservation : null;
  const family = result && !('kind' in result) ? result as FamilyResult : null;
  return <div aria-label={job.capability === NODE_CORE_STATUS_CAPABILITY ? 'Core status request' : 'Family start request'}>
    <dl style={{ display: 'grid', fontFamily: body, fontSize: 11, gap: 6, gridTemplateColumns: 'auto 1fr', margin: '12px 0 0' }}>
      <Detail label="Requested" value={formatTime(job.createdAt)} />
      <Detail label="Request expires" value={formatTime(job.expiresAt)} />
      {core ? <>
        <Detail label="Core observed" value={formatTime(core.observedAt)} />
        <Detail label="Observation" value={core.complete ? 'ALL SOURCES AVAILABLE' : 'INCOMPLETE'} color={core.complete ? C.green : C.gold} />
        <Detail label="MCP host" value={humanState(core.services.mcpHost)} />
        <Detail label="Memory" value={humanState(core.services.memory)} />
        <Detail label="Modules" value={humanState(core.services.modules)} />
        <Detail label="Available tools" value={core.capabilities.count === null ? 'UNVERIFIED' : String(core.capabilities.count)} />
        <Detail label="Active turns" value={core.activeTurns === null ? 'UNVERIFIED' : String(core.activeTurns)} />
      </> : null}
      {family ? <>
        <Detail label="Family result · server" value={humanState(family.familyServer)} />
        <Detail label="Family result · companion" value={humanState(family.companion)} />
        <Detail label="Family result · bridge" value={humanState(family.companionBridge)} />
      </> : null}
    </dl>
  </div>;
}

export default function NodeControlConsole() {
  const [controlSurface, setControlSurface] = useState<NodeControlSurface>('checking');
  const [inventory, setInventory] = useState<NodeInventory | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<number | null>(null);
  const [pollNonce, setPollNonce] = useState(0);
  const [runs, setRuns] = useState<Readonly<Record<string, NodeRun>>>({});
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const inventoryEpochRef = useRef(0);
  const inventoryRef = useRef<NodeInventory | null>(inventory);
  const inventoryStaleRef = useRef(inventoryError !== null);
  const mutationControllersRef = useRef(new Map<string, AbortController>());
  const jobControllersRef = useRef(new Map<string, AbortController>());
  const pairingControllerRef = useRef<AbortController | null>(null);
  const pairingInFlightRef = useRef(false);

  useEffect(() => {
    setControlSurface(isLocalNodeControlOrigin(window.location.origin) ? 'local' : 'hosted');
  }, []);

  useEffect(() => {
    if (controlSurface !== 'hosted') return;
    const epoch = ++inventoryEpochRef.current;
    let disposed = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    const poll = async () => {
      controller = new AbortController();
      try {
        const payload = await requestJson(NODES_PATH, MAX_INVENTORY_BYTES, {
          method: 'GET',
          signal: controller.signal,
        });
        const next = parseNodeInventory(payload) as NodeInventory;
        if (disposed || epoch !== inventoryEpochRef.current) return;
        inventoryRef.current = next;
        inventoryStaleRef.current = false;
        setInventory(next);
        setInventoryError(null);
        setLastVerifiedAt(Date.now());
      } catch (error) {
        if (disposed || epoch !== inventoryEpochRef.current || abortError(error)) return;
        inventoryStaleRef.current = true;
        setInventoryError(inventoryFailureMessage(error));
      } finally {
        controller = null;
        if (!disposed && epoch === inventoryEpochRef.current) {
          timer = window.setTimeout(() => { void poll(); }, INVENTORY_POLL_MS);
        }
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      if (inventoryEpochRef.current === epoch) inventoryEpochRef.current += 1;
    };
  }, [controlSurface, pollNonce]);

  useEffect(() => () => {
    inventoryEpochRef.current += 1;
    for (const controller of mutationControllersRef.current.values()) controller.abort();
    for (const controller of jobControllersRef.current.values()) controller.abort();
    mutationControllersRef.current.clear();
    jobControllersRef.current.clear();
    pairingControllerRef.current?.abort();
    pairingControllerRef.current = null;
    pairingInFlightRef.current = false;
  }, []);

  const refreshInventory = useCallback(() => {
    setPollNonce((value) => value + 1);
  }, []);

  const pairThisPc = useCallback(async () => {
    if (pairingInFlightRef.current) return;
    pairingInFlightRef.current = true;
    const controller = new AbortController();
    pairingControllerRef.current = controller;
    setPairingBusy(true);
    setPairingError(null);
    let navigationStarted = false;
    try {
      const payload = await requestJson(NODE_PAIRINGS_PATH, MAX_PAIRING_BYTES, {
        method: 'POST',
        signal: controller.signal,
      });
      const pairing = parseNodePairing(payload);
      const handoffUrl = buildLocalNodePairingHandoffUrl(pairing.pairingCredential);
      if (controller.signal.aborted) return;
      navigationStarted = true;
      window.location.assign(handoffUrl);
    } catch (error) {
      if (controller.signal.aborted || abortError(error)) return;
      setPairingError(pairingFailureMessage(error));
    } finally {
      if (pairingControllerRef.current === controller) {
        pairingControllerRef.current = null;
        if (!navigationStarted) {
          pairingInFlightRef.current = false;
          if (!controller.signal.aborted) setPairingBusy(false);
        }
      }
    }
  }, []);

  const watchJob = useCallback((nodeId: string, initialJob: PublicJob) => {
    jobControllersRef.current.get(nodeId)?.abort();
    if (isTerminalNodeJob(initialJob)) {
      jobControllersRef.current.delete(nodeId);
      setPollNonce((value) => value + 1);
      return;
    }
    const controller = new AbortController();
    jobControllersRef.current.set(nodeId, controller);
    const poll = async () => {
      try {
        await waitForPoll(controller.signal);
        const job = await readJob(nodeId, initialJob.jobId, controller.signal, initialJob.capability);
        if (controller.signal.aborted) return;
        setRuns((current) => ({
          ...current,
          [nodeId]: {
            requestId: current[nodeId]?.requestId ?? initialJob.jobId,
            capability: initialJob.capability,
            job,
            busy: false,
            needsReconciliation: false,
            message: jobMessage(job),
            error: job.state === 'failed' || job.state === 'expired',
          },
        }));
        if (isTerminalNodeJob(job)) {
          jobControllersRef.current.delete(nodeId);
          setPollNonce((value) => value + 1);
          return;
        }
        void poll();
      } catch (error) {
        if (controller.signal.aborted || abortError(error)) return;
        setRuns((current) => {
          const prior = current[nodeId];
          if (!prior || prior.job?.jobId !== initialJob.jobId) return current;
          return {
            ...current,
            [nodeId]: {
              ...prior,
              message: 'The job was accepted; its latest state is temporarily unavailable. Polling will continue.',
              error: false,
            },
          };
        });
        void poll();
      }
    };
    void poll();
  }, []);

  const adoptJob = useCallback((nodeId: string, requestId: string, job: PublicJob) => {
    setRuns((current) => ({
      ...current,
      [nodeId]: {
        requestId,
        capability: job.capability,
        job,
        busy: false,
        needsReconciliation: false,
        message: jobMessage(job),
        error: job.state === 'failed' || job.state === 'expired',
      },
    }));
    watchJob(nodeId, job);
  }, [watchJob]);

  const runExactRequest = useCallback(async (nodeId: string, capability: NodeCapability, existingRequestId?: string) => {
    if (mutationControllersRef.current.has(nodeId)) return;
    const canEnqueue = () => !inventoryStaleRef.current && (capability === NODE_CORE_STATUS_CAPABILITY
      ? nodeSupportsCoreStatus(inventoryRef.current?.nodes.find((node) => node.nodeId === nodeId))
      : nodeSupportsFamily(inventoryRef.current?.nodes.find((node) => node.nodeId === nodeId)));
    if (!existingRequestId && !canEnqueue()) return;
    const requestId = existingRequestId ?? crypto.randomUUID().toLowerCase();
    mutationControllersRef.current.get(nodeId)?.abort();
    const controller = new AbortController();
    mutationControllersRef.current.set(nodeId, controller);
    setRuns((current) => ({
      ...current,
      [nodeId]: {
        requestId,
        capability,
        job: current[nodeId]?.requestId === requestId ? current[nodeId].job : null,
        busy: true,
        needsReconciliation: false,
        message: existingRequestId ? 'RECONCILING THE SAME REQUEST' : capability === NODE_CORE_STATUS_CAPABILITY ? 'REQUESTING CORE STATUS' : 'SENDING ROUTINE START REQUEST',
        error: false,
      },
    }));

    try {
      const job = existingRequestId
        ? await reconcileExactRequest(nodeId, requestId, controller.signal, capability, canEnqueue)
        : await enqueueJob(nodeId, requestId, controller.signal, capability);
      if (controller.signal.aborted) return;
      adoptJob(nodeId, requestId, job);
    } catch (initialError) {
      if (controller.signal.aborted || abortError(initialError)) return;
      if (!existingRequestId && !mutationDefinitelyRejected(initialError)) {
        try {
          const job = await reconcileExactRequest(nodeId, requestId, controller.signal, capability, canEnqueue);
          if (controller.signal.aborted) return;
          adoptJob(nodeId, requestId, job);
          return;
        } catch (reconciliationError) {
          if (controller.signal.aborted || abortError(reconciliationError)) return;
          setRuns((current) => ({
            ...current,
            [nodeId]: {
              requestId,
              capability,
              job: current[nodeId]?.requestId === requestId ? current[nodeId].job : null,
              busy: false,
              needsReconciliation: true,
              message: mutationFailureMessage(reconciliationError),
              error: true,
            },
          }));
          return;
        }
      }
      const needsReconciliation = existingRequestId !== undefined || !mutationDefinitelyRejected(initialError);
      setRuns((current) => ({
        ...current,
        [nodeId]: {
          requestId,
          capability,
          job: current[nodeId]?.requestId === requestId ? current[nodeId].job : null,
          busy: false,
          needsReconciliation,
          message: mutationFailureMessage(initialError),
          error: true,
        },
      }));
      setPollNonce((value) => value + 1);
    } finally {
      if (mutationControllersRef.current.get(nodeId) === controller) {
        mutationControllersRef.current.delete(nodeId);
      }
    }
  }, [adoptJob]);

  if (controlSurface === 'checking') {
    return (
      <section aria-labelledby="node-control-heading" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={panel}>
          <h1 id="node-control-heading" style={{ color: C.cyan, fontFamily: mono, fontSize: 14, letterSpacing: 2, margin: 0 }}>
            NODES · CONNECTED SYSTEMS
          </h1>
          <div role="status" style={{ color: C.dim, fontFamily: mono, fontSize: 9, letterSpacing: 1, marginTop: 10 }}>
            CHECKING CONTROL SURFACE…
          </div>
        </div>
      </section>
    );
  }

  if (controlSurface === 'local') {
    return (
      <section aria-labelledby="node-control-heading" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={panel}>
          <h1 id="node-control-heading" style={{ color: C.cyan, fontFamily: mono, fontSize: 14, letterSpacing: 2, margin: 0 }}>
            NODES · CONNECTED SYSTEMS
          </h1>
          <p style={{ color: C.muted, fontFamily: body, fontSize: 12, lineHeight: 1.5, margin: '8px 0 0', maxWidth: 760 }}>
            Node inventory, pairing invitations, and remote starts use the protected owner session at mastermind-core.com.
            This local dashboard receives the one-click pairing handoff; it does not duplicate or bypass cloud login.
          </p>
        </div>

        <div style={{ ...panel, alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: C.gold, fontFamily: mono, fontSize: 10, letterSpacing: 1.3 }}>CLOUD OWNER CONTROL</div>
            <div style={{ color: C.muted, fontFamily: body, fontSize: 11, lineHeight: 1.5, marginTop: 5, maxWidth: 680 }}>
              Open the hosted Nodes panel in this tab. If you choose Pair this PC there, Mastermind returns here automatically with the short-lived invitation.
            </div>
          </div>
          <a
            href={HOSTED_NODE_CONTROL_URL}
            style={{
              appearance: 'none',
              background: 'rgba(0,255,255,0.07)',
              border: `1px solid ${C.cyan}55`,
              borderRadius: 5,
              color: C.cyan,
              fontFamily: mono,
              fontSize: 9,
              letterSpacing: 1.1,
              minHeight: 34,
              padding: '9px 11px 7px',
              textDecoration: 'none',
            }}
          >
            OPEN HOSTED NODES
          </a>
        </div>
      </section>
    );
  }

  const nodes = inventory?.nodes ?? [];

  return (
    <section aria-labelledby="node-control-heading" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...panel, alignItems: 'flex-start', display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
        <div>
          <h1 id="node-control-heading" style={{ color: C.cyan, fontFamily: mono, fontSize: 14, letterSpacing: 2, margin: 0 }}>
            NODES · CONNECTED SYSTEMS
          </h1>
          <p style={{ color: C.muted, fontFamily: body, fontSize: 12, lineHeight: 1.5, margin: '8px 0 0', maxWidth: 760 }}>
            Check Mastermind core status on compatible nodes, or start the Family Server and AI companion. Routine starts need one click and no parental PIN.
          </p>
        </div>
        <div style={{ alignItems: 'flex-end', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <PlainButton onClick={refreshInventory}>REFRESH STATUS</PlainButton>
          <span role="status" aria-live="polite" style={{ color: C.dim, fontFamily: mono, fontSize: 9 }}>
            {lastVerifiedAt === null ? 'AWAITING VERIFIED NODE STATUS' : `LAST VERIFIED ${new Date(lastVerifiedAt).toLocaleTimeString()}`}
          </span>
        </div>
      </div>

      <div style={{ ...panel, alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' }}>
        <div>
          <div style={{ color: C.cyan, fontFamily: mono, fontSize: 10, letterSpacing: 1.3 }}>PAIR THIS PC · ONE-CLICK HANDOFF</div>
          <div style={{ color: C.muted, fontFamily: body, fontSize: 11, marginTop: 5 }}>
            Mastermind hands a short-lived invitation directly to this PC and protects it locally. There is nothing to copy or configure.
          </div>
          {pairingError ? (
            <div role="alert" style={{ color: C.red, fontFamily: body, fontSize: 11, marginTop: 7 }}>
              {pairingError}
            </div>
          ) : null}
        </div>
        <PlainButton disabled={pairingBusy} onClick={() => void pairThisPc()}>
          {pairingBusy ? 'OPENING LOCAL HANDOFF…' : 'PAIR THIS PC'}
        </PlainButton>
      </div>

      {inventoryError ? (
        <div role="alert" style={{ ...panel, background: `${C.red}0d`, borderColor: `${C.red}55`, color: C.red, fontFamily: body, fontSize: 12 }}>
          {inventoryError}
        </div>
      ) : null}

      {nodes.length === 0 && inventory !== null ? (
        <div style={{ ...panel, color: C.muted, fontFamily: body, fontSize: 12 }}>
          No portable nodes are paired yet. Use Pair this PC above to connect this machine in one step.
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        {nodes.map((node) => {
          const run = runs[node.nodeId] ?? null;
          const status = node.status;
          const familySupported = nodeSupportsFamily(node);
          const coreOnly = node.worker != null && !node.worker.capabilities.some((item) => item.id === NODE_ENSURE_RUNNING_CAPABILITY);
          const ecosystemReady = !coreOnly && status?.familyServer === 'running'
            && status.companion === 'running'
            && status.companionBridge === 'ready';
          const activeJob = run?.job !== null && run?.job !== undefined && !isTerminalNodeJob(run.job);
          const startDisabled = node.state !== 'active' || run?.busy === true || activeJob;
          const familyReconcile = run?.needsReconciliation && run.capability === NODE_ENSURE_RUNNING_CAPABILITY;
          const coreReconcile = run?.needsReconciliation && run.capability === NODE_CORE_STATUS_CAPABILITY;
          const coreSupported = nodeSupportsCoreStatus(node);
          const actionLabel = familyReconcile
            ? 'RECONCILE SAME REQUEST'
            : run?.busy
              ? 'WORKING…'
              : activeJob
                ? run.job!.capability === NODE_CORE_STATUS_CAPABILITY ? 'CORE CHECK IN PROGRESS' : `START ${humanState(run.job!.state)}`
                : ecosystemReady
                  ? 'ENSURE ECOSYSTEM RUNNING'
                  : 'START ECOSYSTEM';
          return (
            <article key={node.nodeId} aria-label={node.displayName} style={{ ...panel, minHeight: 270 }}>
              <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                <h2 style={{ color: C.cyan, fontFamily: mono, fontSize: 12, letterSpacing: 1.4, margin: 0 }}>
                  {node.displayName}
                </h2>
                <div style={{ display: 'flex', gap: 6 }}>
                  {node.state === 'revoked' ? <StatusBadge color={C.red} label="REVOKED" /> : null}
                  <StatusBadge
                    color={inventoryError ? C.gold : connectivityColor(node.connectivity)}
                    label={inventoryError ? `STALE · ${humanState(node.connectivity)}` : humanState(node.connectivity)}
                  />
                </div>
              </div>

              <dl style={{ display: 'grid', fontFamily: body, fontSize: 11, gap: 6, gridTemplateColumns: 'auto 1fr', margin: '14px 0 0' }}>
                <Detail label="Agent" value={node.agentVersion} />
                <Detail label="Last contact" value={formatTime(node.lastExchangeAt)} />
                <Detail label="Status observed" value={status ? formatTime(status.observedAt) : 'never'} />
                {coreOnly ? <Detail label="Family controls" value="NOT AVAILABLE TO THIS PROFILE" color={C.muted} /> : <>
                <Detail label="Control agent" value={status ? humanState(status.controlAgent) : 'NO VERIFIED STATUS'} color={status?.controlAgent === 'online' ? C.green : C.gold} />
                <Detail label="Family Server" value={status ? humanState(status.familyServer) : 'UNKNOWN'} color={status?.familyServer === 'running' ? C.green : C.gold} />
                <Detail label="AI companion" value={status ? humanState(status.companion) : 'UNKNOWN'} color={status?.companion === 'running' ? C.green : C.gold} />
                <Detail label="Companion bridge" value={status ? humanState(status.companionBridge) : 'UNKNOWN'} color={status?.companionBridge === 'ready' ? C.green : C.gold} />
                <Detail label="Local AI switch" value={status?.localKillSwitch === true ? 'ACTIVE' : status?.localKillSwitch === false ? 'CLEAR' : 'UNKNOWN'} color={status?.localKillSwitch === true ? C.red : status?.localKillSwitch === false ? C.green : C.gold} />
                <Detail label="Recovery" value={status ? humanState(status.recovery) : 'UNKNOWN'} color={status?.recovery === 'clear' ? C.green : status?.recovery === 'manual-repair-required' ? C.red : C.gold} />
                </>}
              </dl>

              {!coreOnly && status?.attentionCodes.length ? (
                <ul aria-label="Node attention" style={{ color: C.gold, fontFamily: body, fontSize: 11, lineHeight: 1.45, margin: '12px 0 0', paddingLeft: 18 }}>
                  {status.attentionCodes.map((code) => <li key={code}>{ATTENTION_LABELS[code] ?? humanState(code)}</li>)}
                </ul>
              ) : (
                <div style={{ color: ecosystemReady ? C.green : C.dim, fontFamily: mono, fontSize: 9, letterSpacing: 0.8, marginTop: 12 }}>
                  {coreOnly ? 'CORE STATUS PROFILE' : ecosystemReady ? 'DESIRED STATE REACHED' : 'NO TYPED ATTENTION REPORTED'}
                </div>
              )}

              <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: 14 }}>
                <PlainButton
                  disabled={coreReconcile || (familyReconcile ? run.busy : startDisabled || !familySupported || inventoryError !== null)}
                  onClick={() => void runExactRequest(node.nodeId, NODE_ENSURE_RUNNING_CAPABILITY, familyReconcile ? run.requestId : undefined)}
                >
                  {actionLabel}
                </PlainButton>
                {coreSupported || coreReconcile ? <PlainButton
                  disabled={(!coreReconcile && inventoryError !== null) || run?.busy === true || activeJob || familyReconcile}
                  onClick={() => void runExactRequest(node.nodeId, NODE_CORE_STATUS_CAPABILITY, coreReconcile ? run.requestId : undefined)}
                >
                  {coreReconcile ? 'RECONCILE CORE REQUEST' : node.connectivity === 'online' ? 'CHECK CORE STATUS' : 'QUEUE CORE STATUS'}
                </PlainButton> : null}
                {run?.job ? <StatusBadge color={run.job.capability === NODE_CORE_STATUS_CAPABILITY && run.job.state === 'succeeded'
                  && !(run.job.terminal?.result as CoreObservation)?.complete ? C.gold : jobColor(run.job.state)}
                  label={`${run.job.capability === NODE_CORE_STATUS_CAPABILITY ? 'CORE' : 'FAMILY'} ${humanState(run.job.state)}`} /> : null}
              </div>

              {run?.message ? (
                <div role={run.error ? 'alert' : 'status'} aria-live="polite" style={{ color: run.error ? C.red : C.muted, fontFamily: body, fontSize: 11, lineHeight: 1.45, marginTop: 10 }}>
                  {run.message}
                </div>
              ) : null}
              {run?.job ? <NodeJobResult job={run.job} /> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
