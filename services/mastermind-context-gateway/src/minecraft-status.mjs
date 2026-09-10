import { sanitizeValue } from './validation.mjs';

export function createMinecraftStatusClient({
  baseUrl = process.env.MASTERMIND_CONTROL_URL || 'http://127.0.0.1:43100',
  token = process.env.MASTERMIND_CONTROL_TOKEN || '',
  fetchImpl = globalThis.fetch,
  timeoutMs = 3_000,
} = {}) {
  let root;
  try { root = new URL(baseUrl); }
  catch { root = null; }
  const validRoot = root
    && root.protocol === 'http:'
    && root.hostname === '127.0.0.1'
    && root.port === '43100'
    && root.pathname === '/'
    && !root.username
    && !root.password
    && !root.search
    && !root.hash;

  async function get(pathname, authenticated) {
    const headers = { Accept: 'application/json' };
    if (authenticated) headers.Authorization = `Bearer ${token}`;
    const response = await fetchImpl(new URL(pathname, root), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Minecraft control returned HTTP ${response.status}.`);
    return sanitizeValue(await response.json());
  }

  return async function minecraftStatus() {
    if (!validRoot) return { configured: false, reachable: false, reason: 'CONTROL_URL_INVALID' };
    try {
      const health = await get('/healthz', false);
      if (token.length < 32) {
        return { configured: false, reachable: true, health, reason: 'CONTROL_TOKEN_UNAVAILABLE' };
      }
      const [overview, companion] = await Promise.all([
        get('/v1/overview', true),
        get('/v1/companion/status', true),
      ]);
      return { configured: true, reachable: true, health, overview, companion, actionsEnabled: false };
    } catch (error) {
      return {
        configured: token.length >= 32,
        reachable: false,
        reason: 'CONTROL_PLANE_UNAVAILABLE',
        detail: String(error?.message ?? error).slice(0, 240),
        actionsEnabled: false,
      };
    }
  };
}
