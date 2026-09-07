'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import HoldToConfirmButton from '@/components/ui/HoldToConfirmButton';
import CoreServiceStatus from './CoreServiceStatus';
import {
  MINECRAFT_CONTROL_AGENT_ROLE,
  SERVICE_RESTART_CONFIRMATION,
  parseRestartReceipt,
  parseServiceInventory,
  parseServiceLogs,
} from './service-control-contract.mjs';

type ServiceRole = 'supervisor' | 'minecraft-control-agent' | 'next-web' | 'mastermind-node-link';
type ServiceState = 'running' | 'restarting' | 'failed';
type ServiceLastExit = Readonly<{
  at: string;
  kind: 'clean' | 'unexpected';
  code: number | null;
  signal: string | null;
}>;
type ServiceRecord = Readonly<{
  role: ServiceRole;
  state: ServiceState;
  generation: number;
  port: number | null;
  lastExit: ServiceLastExit | null;
}>;
type ServiceInventory = Readonly<{
  ok: true;
  supervisor: Readonly<{ mode: 'development' | 'production'; startedAt: string }>;
  services: ServiceRecord[];
}>;
type ServiceLogEntry = Readonly<{
  sequence: number;
  at: string;
  role: ServiceRole;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
}>;
type ServiceLogs = Readonly<{
  ok: true;
  role: 'minecraft-control-agent';
  entries: ServiceLogEntry[];
}>;
type RepeatedFailure = Readonly<{ message: string; count: number }>;

const INVENTORY_PATH = '/api/local-control/services';
const AGENT_LOGS_PATH = '/api/local-control/services/minecraft-control-agent/logs?limit=200';
const AGENT_RESTART_PATH = '/api/local-control/services/minecraft-control-agent/restart';
const POLL_DELAY_MS = 5_000;
const MAX_INVENTORY_BYTES = 64 * 1024;
const MAX_LOG_BYTES = 128 * 1024;
const MAX_RESTART_BYTES = 16 * 1024;
const SERVICE_ORDER: ServiceRole[] = ['supervisor', 'minecraft-control-agent', 'next-web', 'mastermind-node-link'];

const C = {
  cyan: '#00ffff',
  dim: 'rgba(0,255,255,0.35)',
  green: '#00ffaa',
  gold: '#ffaa00',
  red: '#ff4444',
  muted: 'rgba(220,255,255,0.58)',
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

class ServiceApiError extends Error {
  constructor(readonly status: number) {
    super('The local service request failed safely.');
    this.name = 'ServiceApiError';
  }
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('The local service response was too large.');
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('The local service response was not JSON.');
  }
  if (!response.body) throw new Error('The local service response had no body.');
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
        throw new Error('The local service response was too large.');
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
    throw new Error('The local service response was not valid UTF-8.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('The local service response was not valid JSON.');
  }
}

async function requestJson(path: string, maximumBytes: number, init: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const payload = await readBoundedJson(response, maximumBytes);
  if (!response.ok) throw new ServiceApiError(response.status);
  return payload;
}

function inventoryFailureMessage(): string {
  return 'Local service inventory is unavailable. The Minecraft control agent is shown offline until a verified response arrives.';
}

function logsFailureMessage(error: unknown): string {
  if (error instanceof ServiceApiError && error.status === 403) {
    return 'This local session is not authorized to view service logs.';
  }
  return 'The bounded local agent logs could not be loaded.';
}

function restartFailureMessage(error: unknown): string {
  if (error instanceof ServiceApiError) {
    if (error.status === 409) return 'The agent generation changed or a restart is already active. Status was refreshed; nothing was resubmitted.';
    if (error.status === 403) return 'This local session is not authorized to restart the agent.';
    if (error.status === 503) return 'The local supervisor is not ready to restart the agent.';
    if (error.status === 400) return 'The restart request was rejected safely. Nothing was retried.';
  }
  return 'The restart result could not be verified. Status will refresh, and the request will not be resubmitted automatically.';
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function roleLabel(role: ServiceRole): string {
  if (role === 'minecraft-control-agent') return 'MINECRAFT CONTROL AGENT';
  if (role === 'next-web') return 'NEXT WEB';
  if (role === 'mastermind-node-link') return 'MASTERMIND NODE LINK';
  return 'LOCAL SUPERVISOR';
}

function stateColor(state: ServiceState | 'offline' | 'checking' | 'stale'): string {
  if (state === 'running') return C.green;
  if (state === 'failed' || state === 'offline') return C.red;
  return C.gold;
}

function StatusBadge({ state, label }: { state: ServiceState | 'offline' | 'checking' | 'stale'; label?: string }) {
  const color = stateColor(state);
  const text = label ?? state.toUpperCase();
  return (
    <span
      aria-label={`Service status: ${text.toLowerCase()}`}
      style={{
        background: `${color}12`,
        border: `1px solid ${color}55`,
        borderRadius: 999,
        color,
        fontFamily: mono,
        fontSize: 9,
        letterSpacing: 1.2,
        padding: '4px 8px',
        textShadow: `0 0 6px ${color}`,
      }}
    >
      {text}
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

export default function ServiceControlConsole() {
  const [inventory, setInventory] = useState<ServiceInventory | null>(null);
  const [pollFailure, setPollFailure] = useState<RepeatedFailure | null>(null);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<number | null>(null);
  const [pollNonce, setPollNonce] = useState(0);
  const [logs, setLogs] = useState<ServiceLogs | null>(null);
  const [logsBusy, setLogsBusy] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [restartBusy, setRestartBusy] = useState(false);
  const [restartMessage, setRestartMessage] = useState<string | null>(null);
  const [restartError, setRestartError] = useState(false);
  const pollEpochRef = useRef(0);
  const logsEpochRef = useRef(0);
  const mutationEpochRef = useRef(0);
  const logsControllerRef = useRef<AbortController | null>(null);
  const mutationControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const epoch = ++pollEpochRef.current;
    let disposed = false;
    let timer: number | undefined;
    let activeController: AbortController | null = null;
    const poll = async () => {
      activeController = new AbortController();
      try {
        const payload = await requestJson(INVENTORY_PATH, MAX_INVENTORY_BYTES, {
          method: 'GET',
          signal: activeController.signal,
        });
        const next = parseServiceInventory(payload) as ServiceInventory;
        if (disposed || epoch !== pollEpochRef.current) return;
        setInventory(next);
        setPollFailure(null);
        setLastVerifiedAt(Date.now());
      } catch (error) {
        if (disposed || epoch !== pollEpochRef.current
          || (error instanceof DOMException && error.name === 'AbortError')) return;
        const message = inventoryFailureMessage();
        setPollFailure((previous) => previous?.message === message
          ? { message, count: Math.min(previous.count + 1, 999) }
          : { message, count: 1 });
      } finally {
        activeController = null;
        if (!disposed && epoch === pollEpochRef.current) {
          timer = window.setTimeout(() => { void poll(); }, POLL_DELAY_MS);
        }
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      activeController?.abort();
      if (pollEpochRef.current === epoch) pollEpochRef.current += 1;
    };
  }, [pollNonce]);

  useEffect(() => () => {
    logsEpochRef.current += 1;
    mutationEpochRef.current += 1;
    logsControllerRef.current?.abort();
    mutationControllerRef.current?.abort();
  }, []);

  const serviceByRole = useMemo(() => new Map(
    inventory?.services.map((service) => [service.role, service]) ?? [],
  ), [inventory]);
  const agent = serviceByRole.get(MINECRAFT_CONTROL_AGENT_ROLE) ?? null;

  const refreshInventory = useCallback(() => {
    setPollNonce((value) => value + 1);
  }, []);

  const loadLogs = useCallback(async () => {
    const epoch = ++logsEpochRef.current;
    logsControllerRef.current?.abort();
    const controller = new AbortController();
    logsControllerRef.current = controller;
    setLogsBusy(true);
    setLogsError(null);
    try {
      const payload = await requestJson(AGENT_LOGS_PATH, MAX_LOG_BYTES, {
        method: 'GET',
        signal: controller.signal,
      });
      const next = parseServiceLogs(payload) as ServiceLogs;
      if (epoch !== logsEpochRef.current || controller.signal.aborted) return;
      setLogs(next);
    } catch (error) {
      if (epoch !== logsEpochRef.current || controller.signal.aborted) return;
      setLogsError(logsFailureMessage(error));
    } finally {
      if (epoch === logsEpochRef.current) {
        setLogsBusy(false);
        logsControllerRef.current = null;
      }
    }
  }, []);

  const restartAgent = useCallback(async () => {
    if (!agent || pollFailure || agent.state === 'restarting' || restartBusy) return;
    const expectedGeneration = agent.generation;
    const requestId = crypto.randomUUID().toLowerCase();
    const epoch = ++mutationEpochRef.current;
    mutationControllerRef.current?.abort();
    const controller = new AbortController();
    mutationControllerRef.current = controller;
    setRestartBusy(true);
    setRestartMessage(null);
    setRestartError(false);
    try {
      const payload = await requestJson(AGENT_RESTART_PATH, MAX_RESTART_BYTES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          expectedGeneration,
          confirmation: SERVICE_RESTART_CONFIRMATION,
        }),
        signal: controller.signal,
      });
      const receipt = parseRestartReceipt(payload, requestId);
      if (epoch !== mutationEpochRef.current || controller.signal.aborted) return;
      setRestartMessage(`Restart accepted for agent generation ${receipt.generation}. Status will verify the replacement.`);
      setLogs(null);
      setLogsError(null);
    } catch (error) {
      if (epoch !== mutationEpochRef.current || controller.signal.aborted) return;
      setRestartMessage(restartFailureMessage(error));
      setRestartError(true);
    } finally {
      if (epoch === mutationEpochRef.current) {
        setRestartBusy(false);
        mutationControllerRef.current = null;
        refreshInventory();
      }
    }
  }, [agent, pollFailure, refreshInventory, restartBusy]);

  const restartDisabled = !agent || pollFailure !== null || agent.state === 'restarting' || restartBusy;

  return (
    <section aria-labelledby="service-control-heading" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...panel, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 id="service-control-heading" style={{ color: C.cyan, fontFamily: mono, fontSize: 14, letterSpacing: 2, margin: 0 }}>
            SERVICES · LOCAL COMMAND CENTER
          </h1>
          <p style={{ color: C.muted, fontFamily: body, fontSize: 12, lineHeight: 1.5, margin: '8px 0 0' }}>
            Memory, models and orchestration, followed by Minecraft and node service controls. The Minecraft control agent is the only restartable service.
          </p>
        </div>
        <div style={{ alignItems: 'flex-end', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <PlainButton onClick={refreshInventory}>REFRESH MANAGED STATUS</PlainButton>
          <span role="status" aria-live="polite" style={{ color: C.dim, fontFamily: mono, fontSize: 9 }}>
            {lastVerifiedAt === null ? 'AWAITING VERIFIED INVENTORY' : `LAST VERIFIED ${new Date(lastVerifiedAt).toLocaleTimeString()}`}
          </span>
        </div>
      </div>

      <CoreServiceStatus />
      <h2 style={{color:C.cyan,fontFamily:mono,fontSize:12,margin:'8px 0 0'}}>MANAGED CONTROL PLANE</h2>

      {pollFailure ? (
        <div style={{ ...panel, background: `${C.red}0d`, borderColor: `${C.red}55` }}>
          <div role="alert" style={{ color: C.red, fontFamily: body, fontSize: 12 }}>{pollFailure.message}</div>
          {pollFailure.count > 1 ? (
            <div aria-hidden="true" style={{ color: C.dim, fontFamily: mono, fontSize: 9, marginTop: 5 }}>
              SAME ERROR COLLAPSED × {pollFailure.count}
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
        {SERVICE_ORDER.map((role) => {
          const service = serviceByRole.get(role) ?? null;
          const isAgent = role === MINECRAFT_CONTROL_AGENT_ROLE;
          const disconnected = pollFailure !== null;
          const badgeState = !service
            ? (disconnected && isAgent ? 'offline' : 'checking')
            : disconnected
              ? (isAgent ? 'offline' : 'stale')
              : service.state;
          const badgeLabel = badgeState === 'stale' && service ? `STALE · ${service.state.toUpperCase()}` : undefined;
          return (
            <article key={role} aria-label={roleLabel(role)} style={{ ...panel, minHeight: 180 }}>
              <div style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                <h2 style={{ color: isAgent ? C.cyan : C.muted, fontFamily: mono, fontSize: 11, letterSpacing: 1.4, margin: 0 }}>
                  {roleLabel(role)}
                </h2>
                <StatusBadge state={badgeState} label={badgeLabel} />
              </div>
              <dl style={{ display: 'grid', fontFamily: body, fontSize: 11, gap: 6, gridTemplateColumns: 'auto 1fr', margin: '14px 0 0' }}>
                <dt style={{ color: C.dim }}>Generation</dt>
                <dd style={{ color: C.muted, margin: 0, textAlign: 'right' }}>{service?.generation ?? '—'}</dd>
                <dt style={{ color: C.dim }}>Port</dt>
                <dd style={{ color: C.muted, margin: 0, textAlign: 'right' }}>{service?.port ?? 'none'}</dd>
                <dt style={{ color: C.dim }}>Last exit</dt>
                <dd style={{ color: service?.lastExit?.kind === 'unexpected' ? C.red : C.muted, margin: 0, textAlign: 'right' }}>
                  {service?.lastExit
                    ? `${service.lastExit.kind.toUpperCase()} · ${formatTime(service.lastExit.at)} · ${service.lastExit.signal ?? service.lastExit.code ?? 'NO CODE'}`
                    : 'none recorded'}
                </dd>
              </dl>
              {isAgent ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                  <PlainButton disabled={logsBusy} onClick={() => void loadLogs()}>
                    {logsBusy ? 'LOADING LOGS…' : logs ? 'REFRESH LOGS' : 'LOAD LAST 200 LOGS'}
                  </PlainButton>
                  <HoldToConfirmButton disabled={restartDisabled} durationMs={1500} onConfirm={() => void restartAgent()}>
                    {restartBusy ? 'RESTART REQUESTED' : 'HOLD TO RESTART AGENT'}
                  </HoldToConfirmButton>
                </div>
              ) : (
                <div style={{ color: C.dim, fontFamily: mono, fontSize: 9, letterSpacing: 1, marginTop: 16 }}>
                  READ ONLY · NO RESTART CONTROL
                </div>
              )}
            </article>
          );
        })}
      </div>

      {inventory ? (
        <div style={{ ...panel, color: C.dim, fontFamily: mono, fontSize: 9, letterSpacing: 0.8 }}>
          SUPERVISOR MODE {inventory.supervisor.mode.toUpperCase()} · STARTED {formatTime(inventory.supervisor.startedAt)}
        </div>
      ) : null}

      {restartMessage ? (
        <div role={restartError ? 'alert' : 'status'} aria-live="polite" style={{ ...panel, borderColor: `${restartError ? C.red : C.green}55`, color: restartError ? C.red : C.green, fontFamily: body, fontSize: 12 }}>
          {restartMessage}
        </div>
      ) : null}

      {logsError ? <div role="alert" style={{ ...panel, borderColor: `${C.red}55`, color: C.red, fontFamily: body, fontSize: 12 }}>{logsError}</div> : null}

      {logs ? (
        <section aria-labelledby="agent-log-heading" style={panel}>
          <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
            <h2 id="agent-log-heading" style={{ color: C.cyan, fontFamily: mono, fontSize: 11, letterSpacing: 1.4, margin: 0 }}>
              BOUNDED LOCAL SERVICE LOGS
            </h2>
            <span style={{ color: C.dim, fontFamily: mono, fontSize: 9 }}>{logs.entries.length} / 200 ENTRIES</span>
          </div>
          {logs.entries.length === 0 ? (
            <div style={{ color: C.dim, fontFamily: body, fontSize: 11 }}>No local service log entries are available.</div>
          ) : (
            <ol aria-label="Minecraft control agent logs" style={{ display: 'flex', flexDirection: 'column', gap: 5, listStyle: 'none', margin: 0, maxHeight: 420, overflowY: 'auto', padding: 0 }}>
              {logs.entries.map((entry) => {
                const color = entry.stream === 'stderr' ? C.red : entry.stream === 'system' ? C.gold : C.muted;
                return (
                  <li key={entry.sequence} style={{ borderBottom: `1px solid ${C.cyan}12`, color, fontFamily: 'monospace', fontSize: 10, lineHeight: 1.45, padding: '3px 0 6px', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
                    <span style={{ color: C.dim }}>[{new Date(entry.at).toLocaleTimeString()}] [{entry.role}] [{entry.stream}] </span>
                    {entry.line}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ) : null}
    </section>
  );
}
