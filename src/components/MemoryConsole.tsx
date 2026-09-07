'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import HoldToConfirmButton from '@/components/ui/HoldToConfirmButton';

type MemoryMode = 'active' | 'forgotten';
type MemoryRanking = 'text' | 'recent';
type SessionState = 'checking' | 'locked' | 'unlocked';

type MemoryRecord = Readonly<{
  memoryKey: string;
  revision: number;
  summary: string;
  namespace: string;
  visibility: 'private' | 'family' | 'system';
  playerId: string | null;
  worldRef: string | null;
  sessionId: string;
  occurredAt: string;
  state: MemoryMode;
}>;

type ForgetPlan = Readonly<{
  status: 'planned' | 'duplicate';
  planId: string;
  planDigest: string;
  memoryKey: string;
  expectedRevision: number;
  notBefore: string;
  expiresAt: string;
}>;

type StatusEnvelope = Readonly<{ unlocked: boolean; expiresAt: string | null }>;
type ForgetPlanView = Readonly<{ plan: ForgetPlan; target: MemoryRecord }>;
type ActionReceipt = Readonly<{
  status: 'applied' | 'duplicate';
  actionId: string;
  memoryKey: string;
  revision: number;
  state: MemoryMode;
}>;
type BusyKind = 'status' | 'unlock' | 'lock' | 'search' | 'plan' | 'forget' | 'restore' | null;

const C = {
  cyan: '#00ffff', dim: 'rgba(0,255,255,0.35)', green: '#00ffaa', gold: '#ffaa00',
  red: '#ff4444', muted: 'rgba(220,255,255,0.58)', panel: 'rgba(0,15,35,0.75)',
};
const mono = 'Orbitron, monospace';
const body = 'Rajdhani, monospace';
const IDLE_LOCK_MS = 5 * 60 * 1000;
const SEARCH_LIMIT = 20;
const ACTIVITY_STORAGE_KEY = 'mastermind-memory-operator-activity-v1';
const LOCK_REQUIRED_STORAGE_KEY = 'mastermind-memory-operator-lock-required-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;

const panel: CSSProperties = {
  background: C.panel,
  border: `1px solid ${C.cyan}30`,
  borderRadius: 8,
  padding: 14,
};
const input: CSSProperties = {
  background: 'rgba(0,0,0,0.42)',
  border: `1px solid ${C.dim}`,
  borderRadius: 5,
  boxSizing: 'border-box',
  color: '#d9ffff',
  fontFamily: body,
  fontSize: 13,
  outline: 'none',
  padding: '8px 10px',
  width: '100%',
};

class OperatorApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super('The memory operator request failed safely.');
    this.name = 'OperatorApiError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function readLastActivityAt(): number | null {
  try {
    const stored = window.sessionStorage.getItem(ACTIVITY_STORAGE_KEY);
    if (stored === null || !/^\d{1,16}$/.test(stored)) return null;
    const parsed = Number(stored);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeLastActivityAt(value: number | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(ACTIVITY_STORAGE_KEY);
    else window.sessionStorage.setItem(ACTIVITY_STORAGE_KEY, String(value));
  } catch {
    // The in-memory timer still fails closed while this component is mounted.
  }
}

function readLockRequired(): boolean {
  try {
    return window.sessionStorage.getItem(LOCK_REQUIRED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeLockRequired(required: boolean): void {
  try {
    if (required) window.sessionStorage.setItem(LOCK_REQUIRED_STORAGE_KEY, '1');
    else window.sessionStorage.removeItem(LOCK_REQUIRED_STORAGE_KEY);
  } catch {
    // The visible retry state remains fail-closed for this component lifetime.
  }
}

function dispatchKeepaliveLock(): void {
  void fetch('/api/memory/operator/lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    cache: 'no-store',
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => undefined);
}

function isAmbiguousFailure(error: unknown): boolean {
  return !(error instanceof OperatorApiError)
    && !(error instanceof DOMException && error.name === 'AbortError');
}

async function replayOnceIfAmbiguous<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (failure) {
    if (!isAmbiguousFailure(failure)) throw failure;
    return attempt();
  }
}

function parseStatus(value: unknown): StatusEnvelope {
  if (!isObject(value) || Object.keys(value).sort().join('\0') !== 'expiresAt\0ok\0unlocked'
    || value.ok !== true || typeof value.unlocked !== 'boolean'
    || (value.expiresAt !== null && !validDate(value.expiresAt))
    || (value.unlocked && value.expiresAt === null)
    || (!value.unlocked && value.expiresAt !== null)) {
    throw new Error('invalid operator status');
  }
  return { unlocked: value.unlocked, expiresAt: value.expiresAt as string | null };
}

function parseMemoryRecord(value: unknown): MemoryRecord {
  if (!isObject(value)
    || typeof value.memoryKey !== 'string' || value.memoryKey.length < 1 || value.memoryKey.length > 256
    || !validRevision(value.revision)
    || typeof value.summary !== 'string' || value.summary.length > 2048
    || typeof value.namespace !== 'string' || value.namespace.length < 1 || value.namespace.length > 180
    || !['private', 'family', 'system'].includes(String(value.visibility))
    || (value.playerId !== null && (typeof value.playerId !== 'string' || !UUID.test(value.playerId)))
    || (value.worldRef !== null && (typeof value.worldRef !== 'string' || value.worldRef.length > 80))
    || typeof value.sessionId !== 'string' || !UUID.test(value.sessionId)
    || !validDate(value.occurredAt)
    || !['active', 'forgotten'].includes(String(value.state))) {
    throw new Error('invalid memory record');
  }
  return value as MemoryRecord;
}

function parseSearch(value: unknown): { mode: MemoryMode; ranking: MemoryRanking; results: MemoryRecord[] } {
  if (!isObject(value) || value.ok !== true || !['active', 'forgotten'].includes(String(value.mode))
    || !['text', 'recent'].includes(String(value.ranking))
    || !Array.isArray(value.results) || value.results.length > SEARCH_LIMIT) {
    throw new Error('invalid search response');
  }
  const results = value.results.map(parseMemoryRecord);
  if (results.some((result) => result.state !== value.mode)) throw new Error('invalid search scope');
  return { mode: value.mode as MemoryMode, ranking: value.ranking as MemoryRanking, results };
}

function parsePlan(value: unknown): ForgetPlan {
  if (!isObject(value) || value.ok !== true || !['planned', 'duplicate'].includes(String(value.status))
    || typeof value.planId !== 'string' || !UUID.test(value.planId)
    || typeof value.planDigest !== 'string' || !SHA256.test(value.planDigest)
    || typeof value.memoryKey !== 'string' || value.memoryKey.length < 1 || value.memoryKey.length > 256
    || !validRevision(value.expectedRevision) || !validDate(value.notBefore) || !validDate(value.expiresAt)
    || Date.parse(value.notBefore) > Date.parse(value.expiresAt)) {
    throw new Error('invalid forget plan');
  }
  return value as ForgetPlan;
}

function parseAction(value: unknown): ActionReceipt {
  if (!isObject(value) || value.ok !== true || !['applied', 'duplicate'].includes(String(value.status))
    || typeof value.actionId !== 'string' || !UUID.test(value.actionId)
    || typeof value.memoryKey !== 'string' || value.memoryKey.length < 1 || value.memoryKey.length > 256
    || !validRevision(value.revision) || !['active', 'forgotten'].includes(String(value.state))) {
    throw new Error('invalid memory action');
  }
  return value as ActionReceipt;
}

async function postJson(path: string, bodyValue: object, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyValue),
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = isObject(payload) && typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`;
    throw new OperatorApiError(response.status, code);
  }
  return payload;
}

function safeError(error: unknown): string {
  if (!(error instanceof OperatorApiError)) return 'The local memory operator is not reachable. Nothing was changed.';
  if (error.code === 'MEMORY_OPERATOR_UNLOCK_FAILED') return 'The PIN was not accepted. Nothing was unlocked.';
  if (error.status === 401 || error.code === 'LOCKED' || error.code === 'MEMORY_OPERATOR_LOCKED') {
    return 'Parent controls are locked. Enter the PIN again.';
  }
  if (error.status === 429) return 'Too many PIN attempts. Wait briefly before trying again.';
  if (error.status === 409) return 'That memory changed. Refresh the list before trying again.';
  if (error.status === 403) return 'This local session is not authorized for parent memory controls.';
  if (error.status === 400) return 'The memory request was rejected safely. Refresh and try once more.';
  if (error.status === 503) return 'Parent memory controls are not ready on this local command center.';
  return 'The memory operator request failed safely. Nothing was changed.';
}

function formatTime(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : 'unknown time';
}

function Button({
  children, color = C.cyan, disabled = false, onClick,
}: Readonly<{ children: ReactNode; color?: string; disabled?: boolean; onClick: () => void }>) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} style={{
      appearance: 'none', background: `${color}12`, border: `1px solid ${color}`,
      borderRadius: 5, color: disabled ? C.dim : color, cursor: disabled ? 'default' : 'pointer',
      fontFamily: mono, fontSize: 10, letterSpacing: 1.2, opacity: disabled ? 0.55 : 1,
      padding: '7px 12px',
    }}>
      {children}
    </button>
  );
}

function Badge({ children, color = C.cyan }: Readonly<{ children: ReactNode; color?: string }>) {
  return <span style={{
    background: `${color}10`, border: `1px solid ${color}55`, borderRadius: 3,
    color, fontFamily: mono, fontSize: 8, letterSpacing: 1, padding: '3px 6px', whiteSpace: 'nowrap',
  }}>{children}</span>;
}

export default function MemoryConsole() {
  const [session, setSession] = useState<SessionState>('checking');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<MemoryMode>('active');
  const [ranking, setRanking] = useState<MemoryRanking>('recent');
  const [results, setResults] = useState<MemoryRecord[]>([]);
  const [forgetPlan, setForgetPlan] = useState<ForgetPlanView | null>(null);
  const [busy, setBusy] = useState<BusyKind>('status');
  const [busyMemoryKey, setBusyMemoryKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [lockRetryNeeded, setLockRetryNeeded] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const requestGenerationRef = useRef(0);
  const requestControllersRef = useRef<Set<AbortController>>(new Set());
  const unlockPendingRef = useRef(false);
  const lastActivityRef = useRef(0);
  const hiddenSinceRef = useRef<number | null>(null);

  const beginRequest = useCallback(() => {
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    return { controller, generation: requestGenerationRef.current };
  }, []);

  const finishRequest = useCallback((controller: AbortController) => {
    requestControllersRef.current.delete(controller);
  }, []);

  const requestIsCurrent = useCallback((generation: number) => (
    generation === requestGenerationRef.current
  ), []);

  const invalidateRequests = useCallback(() => {
    requestGenerationRef.current += 1;
    requestControllersRef.current.forEach((controller) => controller.abort());
    requestControllersRef.current.clear();
  }, []);

  useEffect(() => () => {
    if (unlockPendingRef.current) {
      writeLastActivityAt(null);
      writeLockRequired(true);
      dispatchKeepaliveLock();
      unlockPendingRef.current = false;
    }
    invalidateRequests();
  }, [invalidateRequests]);

  const applyLocked = useCallback((notice = '', requiresServerLock = false) => {
    invalidateRequests();
    if (!requiresServerLock) unlockPendingRef.current = false;
    writeLastActivityAt(null);
    writeLockRequired(requiresServerLock);
    setSession('locked');
    setExpiresAt(null);
    setPin('');
    setQuery('');
    setMode('active');
    setRanking('recent');
    setResults([]);
    setForgetPlan(null);
    setBusy(null);
    setBusyMemoryKey(null);
    setError('');
    setMessage(notice);
    setLockRetryNeeded(requiresServerLock);
  }, [invalidateRequests]);

  const broadcastLock = useCallback((confirmed: boolean) => {
    channelRef.current?.postMessage({ type: 'lock', confirmed });
  }, []);

  const handleFailure = useCallback((failure: unknown) => {
    if (failure instanceof DOMException && failure.name === 'AbortError') return;
    const relock = failure instanceof OperatorApiError
      && (failure.code === 'LOCKED' || failure.code === 'MEMORY_OPERATOR_LOCKED');
    if (relock) {
      applyLocked('Parent controls locked.', false);
      broadcastLock(true);
    }
    setError(safeError(failure));
  }, [applyLocked, broadcastLock]);

  const applyUnlocked = useCallback((status: StatusEnvelope, freshUnlock = false) => {
    const now = Date.now();
    const previousActivity = readLastActivityAt();
    const activityAt = freshUnlock || previousActivity === null || previousActivity > now
      ? now
      : previousActivity;
    lastActivityRef.current = activityAt;
    writeLastActivityAt(activityAt);
    writeLockRequired(false);
    unlockPendingRef.current = false;
    setSession('unlocked');
    setExpiresAt(status.expiresAt);
    setError('');
    setLockRetryNeeded(false);
    hiddenSinceRef.current = document.hidden ? now : null;
  }, []);

  const markActivity = useCallback(() => {
    if (session !== 'unlocked') return;
    const now = Date.now();
    lastActivityRef.current = now;
    writeLastActivityAt(now);
  }, [session]);

  const lockNow = useCallback(async (confirmedNotice = 'Parent controls locked.') => {
    applyLocked('Parent controls are hidden while the server lock is confirmed.', true);
    broadcastLock(false);
    setBusy('lock');
    const request = beginRequest();
    try {
      const status = parseStatus(await postJson('/api/memory/operator/lock', {}, request.controller.signal));
      if (!requestIsCurrent(request.generation)) return;
      if (status.unlocked) throw new Error('lock response remained unlocked');
      unlockPendingRef.current = false;
      writeLockRequired(false);
      setLockRetryNeeded(false);
      setError('');
      setMessage(confirmedNotice);
      broadcastLock(true);
    } catch (failure) {
      if (!requestIsCurrent(request.generation)
        || (failure instanceof DOMException && failure.name === 'AbortError')) return;
      writeLockRequired(true);
      setLockRetryNeeded(true);
      setError('Controls are hidden locally, but the server lock could not be confirmed. Retry below; the absolute session expiry still applies.');
      setMessage('Parent controls remain hidden in this tab.');
    } finally {
      finishRequest(request.controller);
      if (requestIsCurrent(request.generation)) setBusy(null);
    }
  }, [applyLocked, beginRequest, broadcastLock, finishRequest, requestIsCurrent]);

  const runSearch = useCallback(async (
    searchQuery: string,
    searchMode: MemoryMode,
  ) => {
    setBusy('search');
    setError('');
    setForgetPlan(null);
    setResults([]);
    const request = beginRequest();
    try {
      const payload = parseSearch(await postJson('/api/memory/operator/search', {
        query: searchQuery.trim(), mode: searchMode, limit: SEARCH_LIMIT,
      }, request.controller.signal));
      if (!requestIsCurrent(request.generation)) return;
      if (payload.mode !== searchMode) throw new Error('search mode mismatch');
      setMode(payload.mode);
      setResults(payload.results);
      setRanking(payload.ranking);
    } catch (failure) {
      if (requestIsCurrent(request.generation)) handleFailure(failure);
    } finally {
      finishRequest(request.controller);
      if (requestIsCurrent(request.generation)) setBusy(null);
    }
  }, [beginRequest, finishRequest, handleFailure, requestIsCurrent]);

  useEffect(() => {
    const request = beginRequest();
    const inspect = async () => {
      setBusy('status');
      try {
        const status = parseStatus(await postJson('/api/memory/operator/status', {}, request.controller.signal));
        if (!requestIsCurrent(request.generation)) return;
        if (!status.unlocked) {
          applyLocked('', false);
          return;
        }
        const lastActivityAt = readLastActivityAt();
        if (readLockRequired()) {
          await lockNow('Parent controls locked.');
          return;
        }
        if (lastActivityAt !== null && Date.now() - lastActivityAt >= IDLE_LOCK_MS) {
          await lockNow('Parent controls locked after five minutes of inactivity.');
          return;
        }
        applyUnlocked(status);
        await runSearch('', 'active');
      } catch (failure) {
        if (!requestIsCurrent(request.generation)
          || (failure instanceof DOMException && failure.name === 'AbortError')) return;
        const lockedFailure = failure instanceof OperatorApiError
          && (failure.code === 'LOCKED' || failure.code === 'MEMORY_OPERATOR_LOCKED');
        if (lockedFailure) handleFailure(failure);
        else {
          applyLocked('Parent controls are hidden because server status could not be confirmed.', true);
          setError(safeError(failure));
        }
      } finally {
        finishRequest(request.controller);
        if (requestIsCurrent(request.generation)) setBusy(null);
      }
    };
    void inspect();
    return () => {
      request.controller.abort();
      finishRequest(request.controller);
    };
  }, [applyLocked, applyUnlocked, beginRequest, finishRequest, handleFailure, lockNow, requestIsCurrent, runSearch]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('mastermind-memory-operator-v1');
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (isObject(event.data) && event.data.type === 'lock') {
        const confirmed = event.data.confirmed === true;
        applyLocked(
          confirmed ? 'Parent controls were locked in another tab.' : 'Another tab is confirming the server lock.',
          !confirmed,
        );
      }
    };
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, [applyLocked]);

  useEffect(() => {
    if (session !== 'unlocked') return;
    const checkLock = () => {
      const now = Date.now();
      const expired = expiresAt !== null && now >= Date.parse(expiresAt);
      const idle = now - lastActivityRef.current >= IDLE_LOCK_MS;
      const hiddenTooLong = hiddenSinceRef.current !== null && now - hiddenSinceRef.current >= IDLE_LOCK_MS;
      if (expired || idle || hiddenTooLong) void lockNow(expired ? 'Parent unlock expired.' : 'Parent controls locked after five minutes of inactivity.');
    };
    const visibilityChanged = () => {
      if (document.hidden) hiddenSinceRef.current = Date.now();
      else {
        checkLock();
        hiddenSinceRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    const timer = window.setInterval(checkLock, 5000);
    checkLock();
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.clearInterval(timer);
    };
  }, [expiresAt, lockNow, session]);

  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pin || busy !== null || lockRetryNeeded) return;
    const submittedPin = pin;
    setPin('');
    setBusy('unlock');
    setError('');
    setMessage('');
    const request = beginRequest();
    unlockPendingRef.current = true;
    let unlocked = false;
    try {
      const status = parseStatus(await postJson(
        '/api/memory/operator/unlock',
        { pin: submittedPin },
        request.controller.signal,
      ));
      if (!requestIsCurrent(request.generation)) return;
      if (!status.unlocked) throw new Error('unlock rejected');
      unlockPendingRef.current = false;
      applyUnlocked(status, true);
      setMessage('Parent controls unlocked for this short local session.');
      unlocked = true;
    } catch (failure) {
      if (requestIsCurrent(request.generation)) {
        if (failure instanceof OperatorApiError) {
          unlockPendingRef.current = false;
          handleFailure(failure);
        } else {
          await lockNow('The unlock outcome was unclear, so parent controls were locked safely.');
        }
      }
    } finally {
      finishRequest(request.controller);
      if (requestIsCurrent(request.generation)) setBusy(null);
    }
    if (unlocked && requestIsCurrent(request.generation)) await runSearch('', 'active');
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session === 'unlocked' && busy === null) {
      markActivity();
      void runSearch(query, mode);
    }
  };

  const changeMode = (nextMode: MemoryMode) => {
    if (busy !== null || nextMode === mode) return;
    markActivity();
    void runSearch(query, nextMode);
  };

  const requestForgetPlan = async (target: MemoryRecord) => {
    if (busy !== null) return;
    markActivity();
    const planId = window.crypto.randomUUID().toLowerCase();
    setBusy('plan');
    setBusyMemoryKey(target.memoryKey);
    setError('');
    setMessage('');
    const request = beginRequest();
    const requestBody = Object.freeze({
      planId,
      memoryKey: target.memoryKey,
      expectedRevision: target.revision,
    });
    try {
      const planned = await replayOnceIfAmbiguous(async () => {
        const response = parsePlan(await postJson(
          '/api/memory/operator/forget-plans',
          requestBody,
          request.controller.signal,
        ));
        if (!requestIsCurrent(request.generation)) {
          throw new DOMException('Request superseded.', 'AbortError');
        }
        if (response.planId !== planId || response.memoryKey !== target.memoryKey
          || response.expectedRevision !== target.revision) throw new Error('forget plan mismatch');
        return response;
      });
      if (!requestIsCurrent(request.generation)) return;
      setForgetPlan({ plan: planned, target });
    } catch (failure) {
      if (requestIsCurrent(request.generation)) {
        if (isAmbiguousFailure(failure)) {
          setForgetPlan(null);
          setError('Forget planning could not be confirmed. No lifecycle action was sent; select Forget to try again.');
        } else handleFailure(failure);
      }
    } finally {
      finishRequest(request.controller);
      if (requestIsCurrent(request.generation)) {
        setBusy(null);
        setBusyMemoryKey(null);
      }
    }
  };

  const forget = async () => {
    if (!forgetPlan || busy !== null) return;
    markActivity();
    const { plan, target } = forgetPlan;
    const actionId = window.crypto.randomUUID().toLowerCase();
    setBusy('forget');
    setBusyMemoryKey(target.memoryKey);
    setError('');
    const request = beginRequest();
    const requestBody = Object.freeze({
      actionId,
      planId: plan.planId,
      planDigest: plan.planDigest,
    });
    try {
      await replayOnceIfAmbiguous(async () => {
        const response = parseAction(await postJson(
          '/api/memory/operator/forget-actions',
          requestBody,
          request.controller.signal,
        ));
        if (!requestIsCurrent(request.generation)) {
          throw new DOMException('Request superseded.', 'AbortError');
        }
        if (response.actionId !== actionId || response.memoryKey !== target.memoryKey || response.state !== 'forgotten') {
          throw new Error('forget result mismatch');
        }
        return response;
      });
      if (!requestIsCurrent(request.generation)) return;
      setResults((current) => current.filter((item) => item.memoryKey !== target.memoryKey));
      setForgetPlan(null);
      setMessage('Memory forgotten. Its source remains intact and it can be restored from the Forgotten view.');
    } catch (failure) {
      if (requestIsCurrent(request.generation)) {
        if (isAmbiguousFailure(failure)) {
          await runSearch(query, mode);
          if (requestIsCurrent(request.generation)) {
            setError('The forget outcome could not be confirmed. Refresh was attempted; check Active and Forgotten before trying again.');
          }
        } else handleFailure(failure);
      }
    } finally {
      finishRequest(request.controller);
      if (requestIsCurrent(request.generation)) {
        setBusy(null);
        setBusyMemoryKey(null);
      }
    }
  };

  const restore = async (target: MemoryRecord) => {
    if (busy !== null) return;
    markActivity();
    const actionId = window.crypto.randomUUID().toLowerCase();
    setBusy('restore');
    setBusyMemoryKey(target.memoryKey);
    setError('');
    setMessage('');
    const request = beginRequest();
    const requestBody = Object.freeze({
      actionId,
      memoryKey: target.memoryKey,
      expectedRevision: target.revision,
    });
    try {
      await replayOnceIfAmbiguous(async () => {
        const response = parseAction(await postJson(
          '/api/memory/operator/restore-actions',
          requestBody,
          request.controller.signal,
        ));
        if (!requestIsCurrent(request.generation)) {
          throw new DOMException('Request superseded.', 'AbortError');
        }
        if (response.actionId !== actionId || response.memoryKey !== target.memoryKey || response.state !== 'active') {
          throw new Error('restore result mismatch');
        }
        return response;
      });
      if (!requestIsCurrent(request.generation)) return;
      setResults((current) => current.filter((item) => item.memoryKey !== target.memoryKey));
      setMessage('Memory restored to active recall.');
    } catch (failure) {
      if (requestIsCurrent(request.generation)) {
        if (isAmbiguousFailure(failure)) {
          await runSearch(query, mode);
          if (requestIsCurrent(request.generation)) {
            setError('The restore outcome could not be confirmed. Refresh was attempted; check Active and Forgotten before trying again.');
          }
        } else handleFailure(failure);
      }
    } finally {
      finishRequest(request.controller);
      if (requestIsCurrent(request.generation)) {
        setBusy(null);
        setBusyMemoryKey(null);
      }
    }
  };

  const unlocked = session === 'unlocked';
  const expiryLabel = expiresAt ? new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div
      onPointerDownCapture={markActivity}
      style={{ color: '#d9ffff', display: 'flex', flexDirection: 'column', fontFamily: body, gap: 12, height: '100%', overflowY: 'auto' }}
    >
      <div style={{ alignItems: 'flex-start', display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
        <div>
          <div style={{ color: C.cyan, fontFamily: mono, fontSize: 12, letterSpacing: 2, textShadow: `0 0 7px ${C.cyan}` }}>
            FAMILY MEMORY · PARENT CONSOLE
          </div>
          <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.5, marginTop: 5 }}>
            Search sanitized family memories, hide one from recall, or undo that choice. Permanent deletion is not exposed here.
          </div>
        </div>
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Badge color={unlocked ? C.green : session === 'checking' ? C.gold : C.red}>
            {unlocked ? 'PARENT UNLOCKED' : session === 'checking' ? 'CHECKING' : 'LOCKED'}
          </Badge>
          {unlocked && expiryLabel ? <Badge color={C.gold}>ABSOLUTE LOCK {expiryLabel}</Badge> : null}
          {unlocked ? <Button color={C.gold} disabled={busy === 'lock'} onClick={() => void lockNow()}>LOCK NOW</Button> : null}
        </div>
      </div>

      {error ? <div role="alert" style={{ ...panel, background: `${C.red}0d`, borderColor: `${C.red}55`, color: C.red, fontSize: 12 }}>{error}</div> : null}
      {message ? <div role="status" style={{ ...panel, background: `${lockRetryNeeded ? C.gold : C.green}0a`, borderColor: `${lockRetryNeeded ? C.gold : C.green}40`, color: lockRetryNeeded ? C.gold : C.green, fontSize: 12 }}>{message}</div> : null}

      {session === 'checking' ? (
        <section style={panel} aria-live="polite">
          <div style={{ color: C.gold, fontFamily: mono, fontSize: 10, letterSpacing: 1.4 }}>CHECKING LOCAL PARENT BOUNDARY…</div>
        </section>
      ) : null}

      {session === 'locked' ? (
        <section style={{ ...panel, maxWidth: 560 }}>
          <div style={{ color: C.gold, fontFamily: mono, fontSize: 11, letterSpacing: 1.4 }}>
            {lockRetryNeeded ? 'SERVER LOCK CONFIRMATION REQUIRED' : 'PARENT PIN REQUIRED'}
          </div>
          <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.55, marginTop: 7 }}>
            The PIN stays in its unlock request only and is never stored. This tab keeps only a non-secret activity time so navigating away cannot reset the five-minute idle lock.
          </div>
          {lockRetryNeeded ? (
            <div style={{ marginTop: 12 }}>
              <Button color={C.gold} disabled={busy === 'lock'} onClick={() => void lockNow()}>
                {busy === 'lock' ? 'CONFIRMING…' : 'RETRY SERVER LOCK'}
              </Button>
            </div>
          ) : (
            <form onSubmit={unlock} style={{ alignItems: 'flex-end', display: 'flex', gap: 9, marginTop: 12 }}>
              <label style={{ flex: 1 }}>
                <span style={{ color: C.muted, display: 'block', fontFamily: mono, fontSize: 9, letterSpacing: 1.2, marginBottom: 4 }}>PARENT PIN</span>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={32}
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                  disabled={busy !== null}
                  style={input}
                />
              </label>
              <button type="submit" disabled={!pin || busy !== null} style={{
                appearance: 'none', background: `${C.gold}12`, border: `1px solid ${C.gold}`,
                borderRadius: 5, color: !pin || busy !== null ? C.dim : C.gold,
                cursor: !pin || busy !== null ? 'default' : 'pointer', fontFamily: mono,
                fontSize: 10, letterSpacing: 1.2, padding: '8px 14px',
              }}>{busy === 'unlock' ? 'CHECKING…' : 'UNLOCK'}</button>
            </form>
          )}
        </section>
      ) : null}

      {unlocked ? (
        <>
          <section style={panel}>
            <form onSubmit={submitSearch} style={{ alignItems: 'flex-end', display: 'flex', flexWrap: 'wrap', gap: 9 }}>
              <label style={{ flex: '1 1 300px' }}>
                <span style={{ color: C.muted, display: 'block', fontFamily: mono, fontSize: 9, letterSpacing: 1.2, marginBottom: 4 }}>SEARCH · EMPTY SHOWS RECENT</span>
                <input
                  type="search"
                  autoComplete="off"
                  maxLength={256}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="What did we build or decide?"
                  style={input}
                />
              </label>
              <button type="submit" disabled={busy !== null} style={{
                appearance: 'none', background: `${C.cyan}12`, border: `1px solid ${C.cyan}`,
                borderRadius: 5, color: busy !== null ? C.dim : C.cyan,
                cursor: busy !== null ? 'default' : 'pointer', fontFamily: mono, fontSize: 10,
                letterSpacing: 1.2, padding: '8px 14px',
              }}>{busy === 'search' ? 'SEARCHING…' : 'SEARCH'}</button>
            </form>
            <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
              <span style={{ color: C.muted, fontFamily: mono, fontSize: 9, letterSpacing: 1 }}>VIEW</span>
              <Button color={mode === 'active' ? C.green : C.dim} disabled={busy !== null} onClick={() => changeMode('active')}>ACTIVE</Button>
              <Button color={mode === 'forgotten' ? C.gold : C.dim} disabled={busy !== null} onClick={() => changeMode('forgotten')}>FORGOTTEN</Button>
              <Badge color={ranking === 'text' ? C.cyan : C.gold}>{ranking === 'text' ? 'TEXT RANKING' : 'RECENT RANKING'}</Badge>
              <span style={{ color: C.muted, fontSize: 11 }}>{results.length} result{results.length === 1 ? '' : 's'}</span>
            </div>
          </section>

          {forgetPlan ? (
            <section style={{ ...panel, background: `${C.red}08`, borderColor: `${C.red}55` }} aria-label="Forget memory confirmation">
              <div style={{ color: C.red, fontFamily: mono, fontSize: 11, letterSpacing: 1.4 }}>CONFIRM SOFT-FORGET</div>
              <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.5, marginTop: 6 }}>
                This exact memory will disappear from normal recall. Its immutable source remains intact and Restore remains available.
              </div>
              <div style={{ background: 'rgba(0,0,0,0.32)', borderLeft: `3px solid ${C.red}`, color: '#e8ffff', fontSize: 13, lineHeight: 1.55, marginTop: 10, padding: '10px 12px' }}>
                {forgetPlan.target.summary || 'Sanitized session summary'}
              </div>
              <div style={{ color: C.muted, fontFamily: mono, fontSize: 8, marginTop: 7, overflowWrap: 'anywhere' }}>
                {forgetPlan.target.memoryKey} · revision {forgetPlan.target.revision} · plan expires {formatTime(forgetPlan.plan.expiresAt)}
              </div>
              <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: 11 }}>
                <HoldToConfirmButton disabled={busy !== null} durationMs={1500} onConfirm={() => void forget()}>
                  HOLD 1.5s TO FORGET
                </HoldToConfirmButton>
                <Button color={C.dim} disabled={busy !== null} onClick={() => setForgetPlan(null)}>CANCEL</Button>
                <span style={{ color: C.gold, fontSize: 10 }}>Pointer hold only; keyboard presses cannot submit this action.</span>
              </div>
            </section>
          ) : null}

          <section aria-busy={busy === 'search'} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.map((item) => (
              <article key={item.memoryKey} style={{ ...panel, contentVisibility: 'auto' }}>
                <div style={{ alignItems: 'flex-start', display: 'flex', gap: 10, justifyContent: 'space-between' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: '#e8ffff', fontSize: 13, lineHeight: 1.55 }}>{item.summary || 'Sanitized session summary'}</div>
                    <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      <Badge color={item.state === 'active' ? C.green : C.gold}>{item.state.toUpperCase()}</Badge>
                      <Badge>{item.visibility.toUpperCase()}</Badge>
                      <span style={{ color: C.muted, fontSize: 10 }}>{formatTime(item.occurredAt)}</span>
                      {item.worldRef ? <span style={{ color: C.muted, fontFamily: mono, fontSize: 8 }}>{item.worldRef}</span> : null}
                    </div>
                    <div style={{ color: C.dim, fontFamily: mono, fontSize: 8, marginTop: 7, overflowWrap: 'anywhere' }}>
                      {item.namespace} · revision {item.revision} · {item.memoryKey}
                    </div>
                  </div>
                  <div style={{ flex: '0 0 auto' }}>
                    {item.state === 'active' ? (
                      <Button color={C.red} disabled={busy !== null} onClick={() => void requestForgetPlan(item)}>
                        {busyMemoryKey === item.memoryKey && busy === 'plan' ? 'PLANNING…' : 'FORGET…'}
                      </Button>
                    ) : (
                      <Button color={C.green} disabled={busy !== null} onClick={() => void restore(item)}>
                        {busyMemoryKey === item.memoryKey && busy === 'restore' ? 'RESTORING…' : 'RESTORE'}
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            ))}
            {busy !== 'search' && results.length === 0 ? (
              <div style={{ ...panel, color: C.muted, fontSize: 12 }}>
                {mode === 'active' ? 'No active memories match this view.' : 'Nothing is currently forgotten.'}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
