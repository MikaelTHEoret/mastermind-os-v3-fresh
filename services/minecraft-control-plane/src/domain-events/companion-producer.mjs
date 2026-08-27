import {
  createMastermindDomainEvent,
  deterministicMastermindEventId,
} from './contract.mjs';

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const SAFE_CODE = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const SAFE_ACTION_KIND = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/;
const PLAYER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function safeCode(value) {
  return typeof value === 'string' && SAFE_CODE.test(value) ? value : null;
}

function safeActionKind(value) {
  return typeof value === 'string' && value.length <= 64 && SAFE_ACTION_KIND.test(value) ? value : null;
}

function sessionIdFrom(sessionManager, fallback, remembered) {
  if (typeof fallback === 'string') return fallback;
  if (typeof remembered === 'string') return remembered;
  try {
    const value = sessionManager.status?.().sessionId;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function attachCompanionDomainEventProducer(sessionManager, outbox, options = {}) {
  if (!outbox || typeof outbox.enqueue !== 'function') throw new TypeError('Companion domain events require an outbox enqueue function');
  const playerId = options.playerId;
  if (typeof playerId !== 'string' || !PLAYER_ID.test(playerId)) {
    throw new TypeError('Companion domain event playerId must be a canonical lowercase UUID');
  }
  const householdId = options.householdId ?? 'family-local';
  const producer = options.producer ?? 'minecraft-control-plane';
  const visibility = options.visibility ?? 'private';
  const now = options.now ?? (() => Date.now());
  const onError = options.onError ?? (() => undefined);
  let queue = Promise.resolve();
  let closed = false;
  let accepted = 0;
  let failed = 0;
  let lastErrorCode = null;
  let activeSessionId = null;
  let activeConnectionStartedAt = null;

  const report = (error) => {
    failed += 1;
    lastErrorCode = typeof error?.code === 'string' ? error.code : 'EVENT_OUTBOX_WRITE_FAILED';
    try { onError(error); } catch { /* Observability cannot affect companion authority. */ }
  };

  const submit = (input, keyParts) => {
    if (closed) return;
    let event;
    try {
      event = createMastermindDomainEvent({
        ...input,
        eventId: deterministicMastermindEventId([producer, ...keyParts]),
        producer,
        householdId,
        playerId,
        visibility,
      }, { now });
    } catch (error) {
      report(error);
      return;
    }
    queue = queue.catch(() => undefined).then(async () => {
      await outbox.enqueue(event);
      accepted += 1;
    }).catch(report);
  };

  const onReady = (status) => {
    const sessionId = sessionIdFrom(sessionManager, status?.sessionId, activeSessionId);
    if (!sessionId) return;
    const connectionStartedAt = typeof status?.connectedAt === 'string'
      ? status.connectedAt
      : new Date(now()).toISOString();
    activeSessionId = sessionId;
    activeConnectionStartedAt = connectionStartedAt;
    submit({
      occurredAt: connectionStartedAt,
      domain: 'companion', kind: 'session.started', namespace: `session/${sessionId}`, sessionId,
      payload: { state: 'ready' },
    }, [sessionId, connectionStartedAt, 'session.started']);
  };

  const onDisconnect = (disconnect, status) => {
    if (!activeSessionId || !activeConnectionStartedAt) return;
    const sessionId = sessionIdFrom(sessionManager, status?.sessionId, activeSessionId);
    if (!sessionId || sessionId !== activeSessionId) return;
    const connectionStartedAt = activeConnectionStartedAt;
    const code = Number.isSafeInteger(disconnect?.code) && disconnect.code >= 1_000 && disconnect.code <= 4_999
      ? disconnect.code
      : 1_000;
    const reason = safeCode(disconnect?.reason) ?? 'bridge-closed';
    submit({
      occurredAt: disconnect?.at ?? undefined,
      domain: 'companion', kind: 'session.ended', namespace: `session/${sessionId}`, sessionId,
      payload: { code, reason },
    }, [sessionId, connectionStartedAt, 'session.ended']);
    activeSessionId = null;
    activeConnectionStartedAt = null;
  };

  const onActionDispatched = (action) => {
    const sessionId = sessionIdFrom(sessionManager, null, activeSessionId);
    const actionId = action?.actionId;
    const actionKind = safeActionKind(action?.kind);
    if (!sessionId || typeof actionId !== 'string' || !actionKind) return;
    const payload = { actionId, actionKind, status: 'dispatched' };
    if (typeof action.deadlineAt === 'string') payload.deadlineAt = action.deadlineAt;
    submit({
      occurredAt: action?.dispatchedAt ?? undefined,
      domain: 'companion', kind: 'action.requested', namespace: `session/${sessionId}`,
      sessionId, correlationId: actionId, payload,
    }, [sessionId, actionId, 'action.requested']);
  };

  const onActionStatus = (terminal, action) => {
    if (!TERMINAL_STATUSES.has(terminal?.status)) return;
    const sessionId = sessionIdFrom(sessionManager, null, activeSessionId);
    const actionId = action?.actionId ?? terminal?.actionId;
    const actionKind = safeActionKind(action?.kind);
    if (!sessionId || typeof actionId !== 'string' || !actionKind) return;
    const payload = { actionId, actionKind, status: terminal.status };
    const resultCode = safeCode(terminal?.result?.code);
    const errorCode = safeCode(terminal?.error?.code);
    const cancellationReason = safeCode(terminal?.cancellation?.reason);
    if (resultCode) payload.resultCode = resultCode;
    if (errorCode) payload.errorCode = errorCode;
    if (cancellationReason) payload.cancellationReason = cancellationReason;
    const kind = terminal.status === 'succeeded' ? 'action.completed' : 'action.blocked';
    submit({
      domain: 'companion', kind, namespace: `session/${sessionId}`,
      sessionId, correlationId: actionId, payload,
    }, [sessionId, actionId, kind]);
  };

  const listeners = [
    ['ready', onReady],
    ['disconnect', onDisconnect],
    ['actionDispatched', onActionDispatched],
    ['actionStatus', onActionStatus],
  ];
  const eventSourceAvailable = typeof sessionManager?.on === 'function' && typeof sessionManager?.off === 'function';
  if (eventSourceAvailable) for (const [name, listener] of listeners) sessionManager.on(name, listener);

  const status = () => ({ enabled: eventSourceAvailable && !closed, accepted, failed, lastErrorCode });
  return {
    status,
    async flush() { await queue; return status(); },
    async close() {
      if (closed) return status();
      closed = true;
      if (eventSourceAvailable) for (const [name, listener] of listeners) sessionManager.off(name, listener);
      await queue;
      return status();
    },
  };
}
