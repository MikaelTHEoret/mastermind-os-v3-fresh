import os from 'node:os';
import path from 'node:path';

export const INSTANCE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
export const MEMORY_EVENT_PLAYER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function validMemoryEventPlayerId(value) {
  return typeof value === 'string' && MEMORY_EVENT_PLAYER_ID_PATTERN.test(value);
}

export function memoryIdentityRequiredError() {
  return Object.assign(
    new Error('Memory event synchronization requires a configured family player identity.'),
    { code: 'MEMORY_IDENTITY_REQUIRED' },
  );
}

export function defaultDataRoot(env = process.env) {
  if (env.MASTERMIND_MINECRAFT_DATA_DIR) return path.resolve(env.MASTERMIND_MINECRAFT_DATA_DIR);
  if (env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'Mastermind', 'minecraft');
  return path.join(os.homedir(), '.mastermind', 'minecraft');
}

export function readConfig(env = process.env) {
  const token = env.MASTERMIND_CONTROL_TOKEN ?? '';
  if (token.length < 32) {
    throw new Error('MASTERMIND_CONTROL_TOKEN must contain at least 32 characters');
  }
  const memoryEventSyncEnabled = env.MASTERMIND_MEMORY_EVENT_SYNC_ENABLED === 'true';
  const memoryEventPlayerId = validMemoryEventPlayerId(env.MASTERMIND_MEMORY_PLAYER_ID)
    ? env.MASTERMIND_MEMORY_PLAYER_ID
    : null;
  if (memoryEventSyncEnabled && memoryEventPlayerId === null) {
    throw memoryIdentityRequiredError();
  }
  return {
    host: '127.0.0.1',
    port: 43100,
    token,
    dataRoot: defaultDataRoot(env),
    javaExecutable: env.MASTERMIND_JAVA_EXECUTABLE || 'java',
    memoryEventSyncEnabled,
    memoryEventPlayerId,
  };
}

export function validateInstanceId(value) {
  return typeof value === 'string' && INSTANCE_ID_PATTERN.test(value);
}

export function validateProvisionRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Request body must be a JSON object');
  }
  const allowed = new Set(['kind', 'instanceId', 'displayName', 'memoryMb', 'eulaAccepted']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`Unsupported provisioning field: ${key}`);
  }
  if (input.kind !== 'family-server') throw new TypeError('Only the isolated family-server profile is available here');
  if (!validateInstanceId(input.instanceId)) throw new TypeError('instanceId must be 1-48 lowercase letters, numbers, or hyphens');
  if (typeof input.displayName !== 'string' || input.displayName.trim().length < 1 || input.displayName.trim().length > 64 || /[\r\n\0]/.test(input.displayName)) {
    throw new TypeError('displayName must contain 1-64 characters');
  }
  if (!Number.isInteger(input.memoryMb) || input.memoryMb < 512 || input.memoryMb > 32768) {
    throw new TypeError('memoryMb must be an integer between 512 and 32768');
  }
  if (input.eulaAccepted !== true) throw new TypeError('The Minecraft EULA must be accepted before provisioning');
  return {
    kind: 'family-server',
    projectId: 'family-server',
    instanceId: input.instanceId,
    displayName: input.displayName.trim(),
    memoryMb: input.memoryMb,
    eulaAccepted: true,
  };
}
