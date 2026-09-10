'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { isLocalNodeControlOrigin, parseNodeInventory } from './node-control-contract.mjs';
import { parseServiceInventory } from './service-control-contract.mjs';
import { parseCoreHealth } from '@/lib/live-status/core-health-contract.mjs';
import {
  createLiveStatusPoller,
  emptyLiveResource,
  liveResourceFailed,
  liveResourcePresentation,
  liveResourceSucceeded,
  liveStatusPollDelay,
  parseMinecraftInstanceSummary,
} from '@/lib/live-status/live-status.mjs';

type ServiceRecord = Readonly<{
  role: 'supervisor' | 'minecraft-control-agent' | 'next-web' | 'mastermind-node-link';
  state: 'running' | 'restarting' | 'failed';
  generation: number;
  port: number | null;
  lastExit: unknown;
}>;
type ServiceInventory = Readonly<{
  ok: true;
  supervisor: Readonly<{ mode: 'development' | 'production'; startedAt: string }>;
  services: ServiceRecord[];
}>;
type InstanceSummary = Readonly<{
  id: string;
  displayName: string;
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
}>;
type InstanceInventory = Readonly<{ ok: true; instances: readonly InstanceSummary[] }>;
type NodeSummary = Readonly<{
  nodeId: string;
  state: 'active' | 'revoked';
  connectivity: 'online' | 'offline' | 'never-seen';
  status: null | Readonly<{
    familyServer: 'unknown' | 'missing' | 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
    attentionCodes: string[];
  }>;
}>;
type NodeInventory = Readonly<{ ok: true; nodes: NodeSummary[] }>;
type LiveResource<T> = Readonly<{
  value: T | null;
  lastGoodAt: number | null;
  lastAttemptAt: number | null;
  error: string | null;
  errorCount: number;
}>;
type LiveStatusState = Readonly<{
  surface: 'checking' | 'local' | 'hosted';
  services: LiveResource<ServiceInventory>;
  core: LiveResource<ReturnType<typeof parseCoreHealth>>;
  instances: LiveResource<InstanceInventory>;
  nodes: LiveResource<NodeInventory>;
}>;

const SERVICES_PATH = '/api/local-control/services';
const INSTANCES_PATH = '/api/minecraft/instances';
const NODES_PATH = '/api/nodes';
const MAX_SERVICES_BYTES = 64 * 1024;
const MAX_INSTANCES_BYTES = 128 * 1024;
const MAX_NODES_BYTES = 128 * 1024;
const LIVE_STATUS_REQUEST_TIMEOUT_MS = 12_000;

const C = {
  cyan: '#00ffff',
  dim: 'rgba(0,255,255,0.35)',
  green: '#00ffaa',
  gold: '#ffaa00',
  red: '#ff4444',
  panel: 'rgba(0,15,35,0.68)',
};
const mono = 'Orbitron, monospace';

function initialState(): LiveStatusState {
  return {
    surface: 'checking',
    services: emptyLiveResource() as LiveResource<ServiceInventory>,
    core: emptyLiveResource() as LiveResource<ReturnType<typeof parseCoreHealth>>,
    instances: emptyLiveResource() as LiveResource<InstanceInventory>,
    nodes: emptyLiveResource() as LiveResource<NodeInventory>,
  };
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Response exceeded its live-status boundary.');
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Live-status endpoint did not return JSON.');
  }
  if (!response.body) throw new Error('Live-status endpoint returned no body.');
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
        throw new Error('Response exceeded its live-status boundary.');
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
    throw new Error('Live-status endpoint returned invalid UTF-8.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Live-status endpoint returned invalid JSON.');
  }
}

async function requestJson(path: string, maximumBytes: number, signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(signal.reason);
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, LIVE_STATUS_REQUEST_TIMEOUT_MS);
  signal.addEventListener('abort', forwardAbort, { once: true });
  try {
    const response = await fetch(path, {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: controller.signal,
    });
    const payload = await readBoundedJson(response, maximumBytes);
    if (!response.ok) throw new Error(`Live-status endpoint returned ${response.status}.`);
    return payload;
  } catch (error) {
    if (timedOut) throw new Error('Live-status request timed out.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener('abort', forwardAbort);
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function statusTitle<T>(resource: LiveResource<T>, label: string): string {
  if (resource.lastGoodAt === null) return `${label}: no verified response yet`;
  const verified = new Date(resource.lastGoodAt).toLocaleTimeString();
  if (resource.error) return `${label}: showing last verified state from ${verified}; ${resource.error}`;
  return `${label}: verified at ${verified}`;
}

function resourceSuffix<T>(resource: LiveResource<T>, now: number, visibility: DocumentVisibilityState): string {
  const presentation = liveResourcePresentation(resource, now, visibility);
  if (!presentation.hasValue && presentation.failed) return 'UNAVAILABLE';
  if (!presentation.hasValue) return 'CHECKING';
  if (presentation.failed) return `STALE · RETRY ${presentation.errorCount}`;
  if (presentation.stale) return 'STALE';
  return 'LIVE';
}

function statusColor(suffix: string, danger = false): string {
  if (danger || suffix === 'UNAVAILABLE') return C.red;
  if (suffix === 'LIVE') return C.green;
  return C.gold;
}

function StatusItem({ label, value, suffix, title, danger = false }: {
  label: string;
  value: string;
  suffix: string;
  title: string;
  danger?: boolean;
}) {
  const color = statusColor(suffix, danger);
  return (
    <span title={title} style={{alignItems:'center',display:'inline-flex',gap:6,minWidth:0,whiteSpace:'nowrap'}}>
      <span style={{color:C.dim}}>{label}</span>
      <span style={{color,textShadow:`0 0 6px ${color}`}}>{value}</span>
      <span style={{color,fontSize:8,letterSpacing:0.8}}>{suffix}</span>
    </span>
  );
}

export default function AppLiveStatus() {
  const [state, setState] = useState<LiveStatusState>(initialState);
  const [now, setNow] = useState(() => Date.now());
  const [visibility, setVisibility] = useState<DocumentVisibilityState>('visible');
  const [browserOnline, setBrowserOnline] = useState(true);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const local = isLocalNodeControlOrigin(window.location.origin);
    let transitioning = false;
    setState((previous) => ({ ...previous, surface: local ? 'local' : 'hosted' }));
    setVisibility(document.visibilityState);
    setBrowserOnline(navigator.onLine);

    const updateResource = async <T,>(
      key: 'services' | 'instances' | 'nodes' | 'core',
      path: string,
      maximumBytes: number,
      parse: (value: unknown) => T,
      failureMessage: string,
      signal: AbortSignal,
      observe?: (value: T) => void,
    ) => {
      try {
        const value = parse(await requestJson(path, maximumBytes, signal));
        if (signal.aborted) return;
        observe?.(value);
        const at = Date.now();
        setState((previous) => ({ ...previous, [key]: liveResourceSucceeded(previous[key], value, at) }));
        setNow(at);
      } catch (error) {
        if (signal.aborted || isAbort(error)) return;
        const at = Date.now();
        setState((previous) => ({ ...previous, [key]: liveResourceFailed(previous[key], failureMessage, at) }));
        setNow(at);
      }
    };

    const poller = createLiveStatusPoller({
      run: async (signal: AbortSignal) => {
        setNow(Date.now());
        if (local) {
          await Promise.all([
            updateResource(
              'core', '/api/local-control/core-health', 16*1024,
              parseCoreHealth,
              'Mastermind core health could not be refreshed.', signal,
            ),
            updateResource(
              'services', SERVICES_PATH, MAX_SERVICES_BYTES,
              (value) => parseServiceInventory(value) as ServiceInventory,
              'Local services could not be refreshed.', signal,
            ),
            updateResource(
              'instances', INSTANCES_PATH, MAX_INSTANCES_BYTES,
              (value) => parseMinecraftInstanceSummary(value) as InstanceInventory,
              'Minecraft status could not be refreshed.', signal,
              (value) => { transitioning = value.instances.some((instance) => ['starting', 'stopping'].includes(instance.status)); },
            ),
          ]);
          return;
        }
        await updateResource(
          'nodes', NODES_PATH, MAX_NODES_BYTES,
          (value) => parseNodeInventory(value) as NodeInventory,
          'Hosted nodes could not be refreshed.', signal,
          (value) => { transitioning = value.nodes.some((node) => ['starting', 'stopping'].includes(node.status?.familyServer ?? '')); },
        );
      },
      getDelay: () => liveStatusPollDelay(document.visibilityState, transitioning),
    });

    const refresh = () => {
      setNow(Date.now());
      poller.refresh();
    };
    const handleVisibility = () => {
      setVisibility(document.visibilityState);
      refresh();
    };
    const handleConnectivity = () => {
      setBrowserOnline(navigator.onLine);
      refresh();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', handleConnectivity);
    window.addEventListener('offline', handleConnectivity);
    document.addEventListener('visibilitychange', handleVisibility);
    poller.start();
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', handleConnectivity);
      window.removeEventListener('offline', handleConnectivity);
      document.removeEventListener('visibilitychange', handleVisibility);
      poller.stop();
    };
  }, []);

  const items = useMemo(() => {
    if (state.surface === 'local') {
      const servicesSuffix = resourceSuffix(state.services, now, visibility);
      const services = state.services.value?.services ?? [];
      const running = services.filter((service) => service.state === 'running').length;
      const serviceDanger = services.some((service) => service.state === 'failed');
      const family = state.instances.value?.instances.find((instance) => instance.id === 'family-server') ?? null;
      const instanceSuffix = resourceSuffix(state.instances, now, visibility);
      const coreServices = state.core.value?.services ?? [];
      return [
        {
          label:'MASTERMIND CORE',
          value:coreServices.length ? `${coreServices.filter(service=>service.state==='healthy').length}/${coreServices.length}` : '—',
          suffix:resourceSuffix(state.core,now,visibility),
          title:statusTitle(state.core,'Mastermind core health'),
          danger:coreServices.some(service=>service.state!=='healthy'),
        },
        {
          label: 'MANAGED CONTROL',
          value: services.length > 0 ? `${running}/${services.length}` : '—',
          suffix: servicesSuffix,
          title: statusTitle(state.services, 'Local services'),
          danger: serviceDanger,
        },
        {
          label: 'FAMILY SERVER',
          value: family?.status.toUpperCase() ?? 'UNKNOWN',
          suffix: instanceSuffix,
          title: statusTitle(state.instances, 'Minecraft instances'),
          danger: family?.status === 'failed',
        },
      ];
    }
    if (state.surface === 'hosted') {
      const suffix = resourceSuffix(state.nodes, now, visibility);
      const nodes = state.nodes.value?.nodes ?? [];
      const online = nodes.filter((node) => node.state === 'active' && node.connectivity === 'online').length;
      const family = nodes.find((node) => node.state === 'active' && node.status)?.status?.familyServer ?? 'unknown';
      const attention = nodes.reduce((count, node) => count + (node.status?.attentionCodes.length ?? 0), 0);
      return [
        {
          label: 'NODES',
          value: nodes.length > 0 ? `${online}/${nodes.length} ONLINE` : 'NONE',
          suffix,
          title: statusTitle(state.nodes, 'Hosted nodes'),
          danger: false,
        },
        {
          label: 'FAMILY SERVER',
          value: family.toUpperCase(),
          suffix,
          title: statusTitle(state.nodes, 'Hosted family ecosystem'),
          danger: family === 'failed' || attention > 0,
        },
      ];
    }
    return [{
      label: 'SYSTEM',
      value: 'CONNECTING',
      suffix: 'CHECKING',
      title: 'Selecting the local or hosted live-status boundary.',
      danger: false,
    }];
  }, [now, state, visibility]);

  const stripStyle: CSSProperties = {
    alignItems: 'center',
    background: C.panel,
    border: `1px solid ${browserOnline ? C.cyan : C.red}25`,
    borderRadius: 5,
    display: 'flex',
    flexWrap: 'wrap',
    gap: '7px 18px',
    minHeight: 26,
    minWidth: 0,
    padding: '4px 9px',
    fontFamily: mono,
    fontSize: 9,
    letterSpacing: 1,
  };

  return (
    <div aria-live="polite" aria-label="Mastermind live system status" style={stripStyle}>
      {items.map((item) => <StatusItem key={item.label} {...item}/>) }
      {!browserOnline ? <span style={{color:C.red,marginLeft:'auto'}}>BROWSER OFFLINE</span> : null}
    </div>
  );
}
