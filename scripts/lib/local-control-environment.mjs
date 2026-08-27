const MEMORY_EVENT_SYNC_KEY = 'MASTERMIND_MEMORY_EVENT_SYNC_ENABLED';
const NEXT_ONLY_KEYS = new Set(['MASTERMIND_MEMORY_OPERATOR_PIN_SCRYPT']);
const CHILD_MANAGED_KEYS = new Set(['MASTERMIND_LOCAL_CHILD_ROLE', 'MASTERMIND_LOCAL_SERVICE_PIPE']);
const NODE_LINK_ROLE = 'mastermind-node-link';
const NODE_LINK_UNSAFE_RUNTIME_KEYS = new Set([
  'NODE_DEBUG',
  'NODE_DEBUG_NATIVE',
  'NODE_OPTIONS',
  'NODE_EXTRA_CA_CERTS',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'SSLKEYLOGFILE',
]);
const CONTROL_TOKEN = /^[a-f0-9]{64}$/;
const SUPERVISOR_ID = /^[a-f0-9]{32}$/;
const WINDOWS_SERVICE_PIPE = /^\\\\\.\\pipe\\mastermind-local-control-[a-f0-9]{32}$/;
const POSIX_SERVICE_PIPE_NAME = /^mastermind-local-control-[a-f0-9]{32}\.sock$/;

function withoutMemorySyncSetting(environment) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => (
    key.toUpperCase() !== MEMORY_EVENT_SYNC_KEY
    && !NEXT_ONLY_KEYS.has(key.toUpperCase())
    && !CHILD_MANAGED_KEYS.has(key.toUpperCase())
  )));
}

function validServicePipe(pipeName, platform = process.platform) {
  if (typeof pipeName !== 'string' || pipeName.length < 8 || pipeName.length > 240 || pipeName.includes('\0')) return false;
  if (platform === 'win32') return WINDOWS_SERVICE_PIPE.test(pipeName);
  return pipeName.startsWith('/') && POSIX_SERVICE_PIPE_NAME.test(pipeName.split(/[\\/]/u).at(-1) ?? '');
}

export function createSharedLocalControlEnvironment(options = {}) {
  const parentEnvironment = options.parentEnvironment ?? {};
  const args = options.args ?? [];
  if (!parentEnvironment || typeof parentEnvironment !== 'object' || Array.isArray(parentEnvironment)) {
    throw new TypeError('The parent environment must be an object');
  }
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
    throw new TypeError('The local-control arguments must be strings');
  }
  if (typeof options.controlToken !== 'string' || !CONTROL_TOKEN.test(options.controlToken)) {
    throw new TypeError('The local-control token must be 32 random bytes encoded as lowercase hex');
  }
  if (typeof options.supervisorId !== 'string' || !SUPERVISOR_ID.test(options.supervisorId)) {
    throw new TypeError('The local supervisor id must be 16 random bytes encoded as lowercase hex');
  }

  const memoryEventSyncEnabled = args.includes('--memory-event-sync')
    || parentEnvironment[MEMORY_EVENT_SYNC_KEY] === 'true';
  return {
    ...withoutMemorySyncSetting(parentEnvironment),
    MASTERMIND_LOCAL_CONTROL_ENABLED: 'true',
    MASTERMIND_CONTROL_URL: 'http://127.0.0.1:43100',
    MASTERMIND_CONTROL_TOKEN: options.controlToken,
    MASTERMIND_LOCAL_SUPERVISOR_ID: options.supervisorId,
    [MEMORY_EVENT_SYNC_KEY]: memoryEventSyncEnabled ? 'true' : 'false',
  };
}

export function createLocalControlChildEnvironment(options = {}) {
  const sharedEnvironment = options.sharedEnvironment;
  const role = options.role;
  const platform = options.platform ?? process.platform;
  if (!sharedEnvironment || typeof sharedEnvironment !== 'object' || Array.isArray(sharedEnvironment)
    || !['minecraft-control-agent', 'next-web', NODE_LINK_ROLE].includes(role)
    || !validServicePipe(options.pipeName, platform)) {
    throw new TypeError('Invalid managed local-control child environment');
  }
  const environment = Object.fromEntries(Object.entries(sharedEnvironment).filter(([key]) => (
    !CHILD_MANAGED_KEYS.has(key.toUpperCase())
    // The node link loads its protected hosted identity from the canonical
    // host vault. Never let inherited NODE_* settings become a second,
    // unaudited credential or endpoint channel.
    && (role !== NODE_LINK_ROLE || !key.toUpperCase().startsWith('MASTERMIND_NODE_'))
    // Node's HTTPS debug output can stringify request options, including the
    // Authorization header. Preload/TLS diagnostic settings are likewise not
    // inherited into the credential-owning node-link process.
    && (role !== NODE_LINK_ROLE || !NODE_LINK_UNSAFE_RUNTIME_KEYS.has(key.toUpperCase()))
  )));
  return {
    ...environment,
    MASTERMIND_LOCAL_CHILD_ROLE: role,
    ...(role === 'next-web' ? { MASTERMIND_LOCAL_SERVICE_PIPE: options.pipeName } : {}),
  };
}
