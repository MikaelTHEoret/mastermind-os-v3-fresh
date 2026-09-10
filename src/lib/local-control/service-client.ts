import 'server-only';

import net from 'node:net';
import path from 'node:path';
import {
  LOCAL_SERVICE_REQUEST_BYTES,
  LOCAL_SERVICE_RESPONSE_BYTES,
  LOCAL_SERVICE_SCHEMA_VERSION,
  LocalServiceProtocolError,
  parseSupervisorError,
  publicLocalServiceInventory,
  publicLocalServiceLogs,
  publicLocalServiceRestart,
} from './protocol.mjs';

export type LocalServiceRole = 'supervisor' | 'minecraft-control-agent' | 'next-web' | 'mastermind-node-link';
export type LocalServiceState = 'running' | 'restarting' | 'failed';

export type LocalServiceLastExit = null | {
  at: string;
  kind: 'clean' | 'unexpected';
  code: number | null;
  signal: string | null;
};

export type LocalServiceSummary = {
  role: LocalServiceRole;
  state: LocalServiceState;
  generation: number;
  port: 3000 | 43100 | null;
  lastExit: LocalServiceLastExit;
};

export type LocalServiceInventory = {
  ok: true;
  supervisor: { mode: 'development' | 'production'; startedAt: string };
  services: LocalServiceSummary[];
};

export type LocalServiceLogEntry = {
  sequence: number;
  at: string;
  role: LocalServiceRole;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
};

export type LocalServiceLogs = {
  ok: true;
  role: LocalServiceRole;
  entries: LocalServiceLogEntry[];
};

export type LocalServiceRestartAcceptance = {
  ok: true;
  accepted: true;
  requestId: string;
  generation: number;
  operation: { state: 'accepted' };
};

export class LocalServiceClientError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'LocalServiceClientError';
  }
}

type ServiceControlConfiguration = {
  pipeName: string;
  supervisorId: string;
  token: string;
};

type LogQuery = { limit: number; after?: number };
type RestartRequest = { requestId: string; expectedGeneration: number };

const CONTROL_TOKEN = /^[a-f0-9]{64}$/;
const SUPERVISOR_ID = /^[a-f0-9]{32}$/;
const WINDOWS_PIPE = /^\\\\\.\\pipe\\mastermind-local-control-[a-f0-9]{32}$/;
const POSIX_PIPE_BASENAME = /^mastermind-local-control-[a-f0-9]{32}\.sock$/;
const IPC_TIMEOUT_MS = 5_000;

const INTERNAL_ERROR_MAP: Record<string, [number, string, string]> = {
  STALE_GENERATION: [409, 'SERVICE_GENERATION_STALE', 'The service generation changed. Refresh service status before trying again.'],
  SERVICE_BUSY: [409, 'SERVICE_RESTART_BUSY', 'The Minecraft control agent is already changing state.'],
  REQUEST_ID_CONFLICT: [409, 'SERVICE_REQUEST_ID_CONFLICT', 'That restart request ID was already used for a different request.'],
  RESTART_FAILED: [503, 'SERVICE_RESTART_FAILED', 'The supervisor could not safely restart the Minecraft control agent.'],
  RESPONSE_TOO_LARGE: [502, 'SERVICE_CONTROL_RESPONSE_TOO_LARGE', 'The local supervisor response exceeded the service-control limit.'],
};

function configuration(): ServiceControlConfiguration {
  if (process.env.MASTERMIND_LOCAL_CHILD_ROLE !== 'next-web') {
    throw new LocalServiceClientError(503, 'SERVICE_CONTROL_UNAVAILABLE', 'Service control is unavailable outside the supervised command center.');
  }
  const pipeName = process.env.MASTERMIND_LOCAL_SERVICE_PIPE ?? '';
  const supervisorId = process.env.MASTERMIND_LOCAL_SUPERVISOR_ID ?? '';
  const token = process.env.MASTERMIND_CONTROL_TOKEN ?? '';
  const validPipe = pipeName.length >= 8 && pipeName.length <= 240 && !pipeName.includes('\0') && (process.platform === 'win32'
    ? WINDOWS_PIPE.test(pipeName)
    : path.isAbsolute(pipeName) && POSIX_PIPE_BASENAME.test(path.basename(pipeName)));
  if (!validPipe || !SUPERVISOR_ID.test(supervisorId) || !CONTROL_TOKEN.test(token)) {
    throw new LocalServiceClientError(503, 'SERVICE_CONTROL_UNAVAILABLE', 'The supervised service-control channel is not ready.');
  }
  return { pipeName, supervisorId, token };
}

function transportError(mutation: boolean, dispatched: boolean): LocalServiceClientError {
  if (mutation && dispatched) {
    return new LocalServiceClientError(
      504,
      'SERVICE_RESTART_COMPLETION_UNKNOWN',
      'The restart request may have reached the supervisor. Refresh service status before taking another action.',
    );
  }
  return new LocalServiceClientError(503, 'SERVICE_CONTROL_OFFLINE', 'The local service supervisor is not reachable.');
}

function invalidResponse(mutation: boolean): LocalServiceClientError {
  if (mutation) {
    return new LocalServiceClientError(
      504,
      'SERVICE_RESTART_COMPLETION_UNKNOWN',
      'The restart request may have reached the supervisor. Refresh service status before taking another action.',
    );
  }
  return new LocalServiceClientError(502, 'INVALID_SERVICE_CONTROL_RESPONSE', 'The local supervisor returned an invalid response.');
}

async function exchangeFrame(
  config: ServiceControlConfiguration,
  action: Record<string, unknown>,
  mutation: boolean,
): Promise<unknown> {
  const request = {
    schemaVersion: LOCAL_SERVICE_SCHEMA_VERSION,
    supervisorId: config.supervisorId,
    token: config.token,
    ...action,
  };
  const frame = Buffer.from(`${JSON.stringify(request)}\n`, 'utf8');
  if (frame.byteLength > LOCAL_SERVICE_REQUEST_BYTES) {
    throw new LocalServiceClientError(500, 'SERVICE_CONTROL_BOUNDARY_ERROR', 'The local service-control boundary failed safely.');
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let dispatched = false;
    let received = Buffer.alloc(0);
    const finish = (error: LocalServiceClientError | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const socket = net.createConnection(config.pipeName);
    socket.setTimeout(IPC_TIMEOUT_MS);
    socket.once('connect', () => {
      dispatched = true;
      socket.write(frame, (error) => {
        if (error) finish(transportError(mutation, dispatched));
      });
    });
    socket.on('data', (chunk: Buffer) => {
      if (settled) return;
      received = Buffer.concat([received, chunk]);
      if (received.byteLength > LOCAL_SERVICE_RESPONSE_BYTES) finish(invalidResponse(mutation));
    });
    socket.once('end', () => {
      if (settled) return;
      const newline = received.indexOf(0x0a);
      if (
        newline < 0
        || newline !== received.byteLength - 1
        || received.lastIndexOf(0x0a) !== newline
      ) return finish(invalidResponse(mutation));
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(received.subarray(0, newline));
        finish(null, JSON.parse(text) as unknown);
      } catch {
        finish(invalidResponse(mutation));
      }
    });
    socket.once('timeout', () => finish(transportError(mutation, dispatched)));
    socket.once('error', () => finish(transportError(mutation, dispatched)));
    socket.once('close', () => finish(transportError(mutation, dispatched)));
  });
}

function mappedSupervisorError(value: unknown): LocalServiceClientError | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Record<string, unknown>).ok !== false) return null;
  let code: string;
  try {
    ({ code } = parseSupervisorError(value) as { code: string });
  } catch {
    return new LocalServiceClientError(502, 'INVALID_SERVICE_CONTROL_RESPONSE', 'The local supervisor returned an invalid response.');
  }
  const mapped = INTERNAL_ERROR_MAP[code];
  if (mapped) return new LocalServiceClientError(...mapped);
  if (code === 'CONTROL_AUTH_FAILED') {
    return new LocalServiceClientError(503, 'SERVICE_CONTROL_UNAVAILABLE', 'The supervised service-control channel could not be authenticated.');
  }
  return new LocalServiceClientError(502, 'INVALID_SERVICE_CONTROL_RESPONSE', 'The local supervisor rejected a request generated by this boundary.');
}

async function requestSupervisor(
  action: Record<string, unknown>,
  mutation: boolean,
): Promise<{ config: ServiceControlConfiguration; response: unknown }> {
  const config = configuration();
  const response = await exchangeFrame(config, action, mutation);
  const supervisorError = mappedSupervisorError(response);
  if (supervisorError) throw supervisorError;
  return { config, response };
}

export async function getLocalServiceInventory(): Promise<LocalServiceInventory> {
  const { config, response } = await requestSupervisor({ action: 'status' }, false);
  try {
    return publicLocalServiceInventory(response, config.supervisorId) as LocalServiceInventory;
  } catch (error) {
    if (error instanceof LocalServiceProtocolError) throw invalidResponse(false);
    throw error;
  }
}

export async function getLocalServiceLogs(role: LocalServiceRole, query: LogQuery): Promise<LocalServiceLogs> {
  const { config, response } = await requestSupervisor({
    action: 'logs',
    role,
    limit: query.limit,
    ...(query.after === undefined ? {} : { after: query.after }),
  }, false);
  try {
    return publicLocalServiceLogs(response, config.supervisorId, role, query) as LocalServiceLogs;
  } catch (error) {
    if (error instanceof LocalServiceProtocolError) throw invalidResponse(false);
    throw error;
  }
}

export async function restartMinecraftControlAgent(request: RestartRequest): Promise<LocalServiceRestartAcceptance> {
  const { config, response } = await requestSupervisor({
    action: 'restart',
    role: 'minecraft-control-agent',
    requestId: request.requestId,
    expectedGeneration: request.expectedGeneration,
  }, true);
  try {
    return publicLocalServiceRestart(response, config.supervisorId, request) as LocalServiceRestartAcceptance;
  } catch (error) {
    if (error instanceof LocalServiceProtocolError) throw invalidResponse(true);
    throw error;
  }
}
