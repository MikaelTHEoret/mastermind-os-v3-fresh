const LOCAL_AGENT_URL = 'http://127.0.0.1:43100/v1/control/prepare-shutdown';
const MAX_RESPONSE_BYTES = 64 * 1024;
export const LOCAL_AGENT_DRAIN_TIMEOUT_MS = 70_000;

async function readJson(response) {
  const declared = Number(response.headers?.get?.('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error('A local-control drain response was unexpectedly large');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('A local-control drain response was unexpectedly large');
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('A local-control drain response was not valid JSON');
  }
}

async function fetchJson(fetchImpl, url, options, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`The existing local command center could not complete its safe server drain: ${error?.message ?? String(error)}`);
  }
  const body = await readJson(response);
  if (!response.ok) {
    const code = typeof body?.code === 'string' ? ` (${body.code})` : '';
    throw new Error(`The existing local command center refused its safe server drain${code}`);
  }
  return body;
}

// Future signed-supervisor handoff. The token remains only in the old
// supervisor's memory and the supervisor ID is authenticated independently by
// the loopback agent. This endpoint is deliberately not exposed by Next.
export async function requestSupervisorManagedDrain({ token, supervisorId, fetchImpl = fetch } = {}) {
  if (typeof token !== 'string' || token.length < 32 || !/^[a-f0-9]{32}$/.test(supervisorId ?? '')) {
    throw new Error('The local supervisor drain identity is invalid');
  }
  const result = await fetchJson(fetchImpl, LOCAL_AGENT_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Mastermind-Supervisor-Id': supervisorId,
    },
  }, LOCAL_AGENT_DRAIN_TIMEOUT_MS);
  if (result?.ok !== true || result.prepared !== true || result.draining !== true) {
    throw new Error('The local Minecraft agent did not confirm a safe supervisor drain');
  }
  return { prepared: true };
}
