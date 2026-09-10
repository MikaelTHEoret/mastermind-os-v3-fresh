import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';

/** One live worker per canonical credential root, across core/family profiles.
 * The OS releases this endpoint on process exit; no PID file or stale lock is
 * deleted, and a competing worker is never stopped or adopted.
 */
export async function acquireMastermindNodeWorkerLifetime(stateRoot, { netApi = net, platform = process.platform } = {}) {
  if (typeof stateRoot !== 'string' || !path.isAbsolute(stateRoot) || stateRoot.includes('\0')) {
    throw Object.assign(new Error('Canonical worker state root required'), { code: 'NODE_WORKER_STATE_INVALID' });
  }
  const canonicalRoot = path.resolve(stateRoot);
  const digest = crypto.createHash('sha256').update(platform === 'win32' ? canonicalRoot.toLowerCase() : canonicalRoot).digest('hex');
  const endpoint = platform === 'win32' ? `\\\\.\\pipe\\mastermind-node-worker-${digest}` : path.join(canonicalRoot, '.worker-lifetime.sock');
  const server = netApi.createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    const failed = () => reject(Object.assign(new Error('Another worker owns this enrolled node, or its lifetime boundary is unavailable.'), { code: 'NODE_WORKER_LIFETIME_UNAVAILABLE' }));
    server.once('error', failed);
    server.listen(endpoint, () => { server.removeListener('error', failed); resolve(); });
  });
  // Any unexpected boundary loss must stop the owning process, never leave an
  // unguarded exchange loop. An emitted error is intentionally fatal.
  server.on('error', () => { throw Object.assign(new Error('Worker lifetime boundary failed'), { code: 'NODE_WORKER_LIFETIME_LOST' }); });
  let released = false;
  return Object.freeze({ release: async () => {
    if (released) return;
    released = true;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } });
}
