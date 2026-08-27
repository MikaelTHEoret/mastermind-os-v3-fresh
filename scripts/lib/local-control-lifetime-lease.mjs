import crypto from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const LEASE_PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 1024;
const OWNER_ID_PATTERN = /^[a-f0-9]{32}$/;
const heldServers = new Set();

export class LocalControlLeaseError extends Error {
  constructor(message, code, options) {
    super(message, options);
    this.name = 'LocalControlLeaseError';
    this.code = code;
  }
}

function normalizedWorkspace(workspace) {
  const resolved = path.resolve(workspace);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function localControlLifetimeLeaseName(workspace) {
  const digest = crypto.createHash('sha256').update(normalizedWorkspace(workspace), 'utf8').digest('hex').slice(0, 32);
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\mastermind-local-control-lifetime-${digest}`
    : path.join(os.tmpdir(), `mastermind-local-control-lifetime-${digest}.sock`);
}

function validateOptions({ workspace, ownerId, contenderStartedAtMs }) {
  if (typeof workspace !== 'string' || !path.isAbsolute(path.resolve(workspace))) {
    throw new TypeError('A valid local-control workspace is required');
  }
  if (typeof ownerId !== 'string' || !OWNER_ID_PATTERN.test(ownerId)) {
    throw new TypeError('A valid local-control lease owner ID is required');
  }
  if (!Number.isSafeInteger(contenderStartedAtMs) || contenderStartedAtMs < 1) {
    throw new TypeError('A valid local-control launch time is required');
  }
}

function handleIdentification(socket, identity) {
  socket.setEncoding('utf8');
  socket.setTimeout(2_000, () => socket.destroy());
  socket.on('error', () => {});
  let request = '';
  let handled = false;
  socket.on('data', (chunk) => {
    if (handled) return;
    request += chunk;
    if (request.length > MAX_MESSAGE_BYTES) {
      handled = true;
      socket.destroy();
      return;
    }
    const newline = request.indexOf('\n');
    if (newline < 0) return;
    handled = true;
    try {
      const message = JSON.parse(request.slice(0, newline));
      if (message?.action !== 'identify' || message?.protocolVersion !== LEASE_PROTOCOL_VERSION) {
        socket.end(`${JSON.stringify({ ok: false })}\n`);
        return;
      }
      socket.end(`${JSON.stringify({ ok: true, ...identity })}\n`);
    } catch {
      socket.end(`${JSON.stringify({ ok: false })}\n`);
    }
  });
}

async function tryBindLease(leaseName, identity) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => handleIdentification(socket, identity));
    const onInitialError = (error) => {
      server.removeAllListeners();
      if (error?.code === 'EADDRINUSE' || error?.code === 'EACCES') {
        resolve(null);
        return;
      }
      reject(error);
    };
    server.once('error', onInitialError);
    server.listen({ path: leaseName, exclusive: true }, () => {
      server.off('error', onInitialError);
      resolve(server);
    });
  });
}

async function identifyLeaseOwner(leaseName, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(leaseName);
    let settled = false;
    let response = '';
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new LocalControlLeaseError(
      'The existing local-control lifetime lease did not identify itself.',
      'LEASE_IDENTITY_TIMEOUT',
    )), timeoutMs);
    socket.setEncoding('utf8');
    socket.once('connect', () => {
      socket.write(`${JSON.stringify({ action: 'identify', protocolVersion: LEASE_PROTOCOL_VERSION })}\n`);
    });
    socket.on('data', (chunk) => {
      response += chunk;
      if (response.length > MAX_MESSAGE_BYTES) {
        finish(new LocalControlLeaseError('The local-control lease response was too large.', 'LEASE_IDENTITY_INVALID'));
        return;
      }
      const newline = response.indexOf('\n');
      if (newline < 0) return;
      try {
        const message = JSON.parse(response.slice(0, newline));
        if (
          message?.ok !== true || message.protocolVersion !== LEASE_PROTOCOL_VERSION
          || typeof message.ownerId !== 'string' || !OWNER_ID_PATTERN.test(message.ownerId)
          || !Number.isSafeInteger(message.acquiredAtMs) || message.acquiredAtMs < 1
        ) {
          throw new Error('invalid lease identity');
        }
        finish(null, { ownerId: message.ownerId, acquiredAtMs: message.acquiredAtMs });
      } catch (error) {
        finish(new LocalControlLeaseError(
          'The process holding the local-control lifetime endpoint did not present a valid lease identity.',
          'LEASE_IDENTITY_INVALID',
          { cause: error },
        ));
      }
    });
    socket.once('error', (error) => finish(new LocalControlLeaseError(
      'The local-control lifetime endpoint could not be inspected safely.',
      'LEASE_IDENTITY_UNAVAILABLE',
      { cause: error },
    )));
    socket.once('close', () => {
      if (!settled) finish(new LocalControlLeaseError(
        'The local-control lifetime endpoint closed before presenting its identity.',
        'LEASE_IDENTITY_UNAVAILABLE',
      ));
    });
  });
}

function retainLease(server, identity, leaseName, replacedOwnerId = null, unref = false) {
  heldServers.add(server);
  if (unref) server.unref();
  let lost = null;
  const listeners = new Set();
  const reportLost = (error) => {
    if (lost) return;
    lost = error;
    heldServers.delete(server);
    for (const listener of listeners) queueMicrotask(() => listener(error));
    listeners.clear();
  };
  server.on('error', (error) => reportLost(new LocalControlLeaseError(
    'The local-control lifetime lease failed while the supervisor was running.',
    'LEASE_LOST',
    { cause: error },
  )));
  server.once('close', () => reportLost(new LocalControlLeaseError(
    'The local-control lifetime lease closed before the supervisor exited.',
    'LEASE_LOST',
  )));
  return Object.freeze({
    name: leaseName,
    ownerId: identity.ownerId,
    acquiredAtMs: identity.acquiredAtMs,
    replacedOwnerId,
    onLost(listener) {
      if (typeof listener !== 'function') throw new TypeError('A lease-loss listener must be a function');
      if (lost) queueMicrotask(() => listener(lost));
      else listeners.add(listener);
    },
  });
}

async function wait(delayMs) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function acquireLocalControlLifetimeLease(options) {
  const {
    workspace,
    ownerId,
    contenderStartedAtMs,
    expectedIncumbentOwnerId = null,
    requestIncumbentRelease,
    unref = false,
    handoffTimeoutMs = 50_000,
    retryIntervalMs = 50,
  } = options;
  validateOptions({ workspace, ownerId, contenderStartedAtMs });
  if (typeof unref !== 'boolean') throw new TypeError('The local-control lease unref option must be boolean');
  if (expectedIncumbentOwnerId !== null && !OWNER_ID_PATTERN.test(expectedIncumbentOwnerId)) {
    throw new TypeError('The expected incumbent lease owner ID is invalid');
  }
  if (!Number.isInteger(handoffTimeoutMs) || handoffTimeoutMs < 100 || handoffTimeoutMs > 120_000) {
    throw new TypeError('The lease handoff timeout is invalid');
  }
  if (!Number.isInteger(retryIntervalMs) || retryIntervalMs < 5 || retryIntervalMs > 1_000) {
    throw new TypeError('The lease retry interval is invalid');
  }

  const leaseName = localControlLifetimeLeaseName(workspace);
  const attemptBind = async () => {
    const identity = {
      protocolVersion: LEASE_PROTOCOL_VERSION,
      ownerId,
      acquiredAtMs: Date.now(),
    };
    const server = await tryBindLease(leaseName, identity);
    return server ? { server, identity } : null;
  };
  let bound = await attemptBind();
  if (bound) return retainLease(bound.server, bound.identity, leaseName, null, unref);

  let incumbent;
  try {
    incumbent = await identifyLeaseOwner(leaseName);
  } catch (error) {
    // The owner can exit between bind and identification. One immediate retry
    // distinguishes that harmless race from an untrusted or broken endpoint.
    bound = await attemptBind();
    if (bound) return retainLease(bound.server, bound.identity, leaseName, null, unref);
    throw error;
  }

  if (
    expectedIncumbentOwnerId === null || incumbent.ownerId !== expectedIncumbentOwnerId
    || typeof requestIncumbentRelease !== 'function'
  ) {
    const concurrent = incumbent.acquiredAtMs >= contenderStartedAtMs;
    throw new LocalControlLeaseError(
      concurrent
        ? 'Another local-control launch that started concurrently already won the lifetime lease.'
        : 'Another process owns the local-control lifetime lease, but it does not match the authenticated supervisor record. It was left running.',
      concurrent ? 'CONCURRENT_LAUNCH_WON' : 'LEASE_OWNER_UNVERIFIED',
    );
  }

  await requestIncumbentRelease(incumbent.ownerId);
  const deadline = Date.now() + handoffTimeoutMs;
  do {
    bound = await attemptBind();
    if (bound) return retainLease(bound.server, bound.identity, leaseName, incumbent.ownerId, unref);
    try {
      const current = await identifyLeaseOwner(leaseName);
      if (current.ownerId !== incumbent.ownerId) {
        throw new LocalControlLeaseError(
          'Another successor won the local-control lifetime lease after the prior supervisor exited.',
          'CONCURRENT_LAUNCH_WON',
        );
      }
    } catch (error) {
      if (error instanceof LocalControlLeaseError && error.code === 'CONCURRENT_LAUNCH_WON') throw error;
      // A named pipe briefly disappears while Windows releases it. Binding is
      // retried until the bounded handoff deadline instead of guessing ownership.
    }
    if (Date.now() >= deadline) {
      throw new LocalControlLeaseError(
        'The prior supervisor accepted handoff but did not release its lifetime lease. It was left running.',
        'LEASE_HANDOFF_TIMEOUT',
      );
    }
    await wait(retryIntervalMs);
  } while (true);
}
