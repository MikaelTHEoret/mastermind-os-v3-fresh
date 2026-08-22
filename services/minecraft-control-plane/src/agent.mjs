import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  memoryIdentityRequiredError,
  readConfig,
  validMemoryEventPlayerId,
  validateInstanceId,
  validateProvisionRequest,
} from './config.mjs';
import { InstanceStore } from './store.mjs';
import { LogStore } from './log-store.mjs';
import { getLanStatus, isPrivateIpv4 } from './lan-status.mjs';
import { runLanFirewallAction } from './lan-firewall.mjs';
import { discoverLegacyFamilyInstances, importLegacyFamilyInstance } from './legacy-importer.mjs';
import { ProcessManager, isTcpPortOccupied } from './process-manager.mjs';
import { ServerProvisioner } from './provisioner.mjs';
import { FamilyServerUpdateManager } from './update-manager.mjs';
import { FamilyServerBackupManager } from './backup-manager.mjs';
import { FamilyServerAdminManager } from './server-admin.mjs';
import { FamilyModManager } from './family-mod-manager.mjs';
import { FamilyCoreArtifactManager } from './family-core-artifact-manager.mjs';
import { ModrinthClient } from './modrinth-client.mjs';
import { FamilyWorldManager, removeManagedFabricRuntimeCache } from './world-manager.mjs';
import { verifyFamilyServerInstall } from './artifact-integrity.mjs';
import { acquireLaunchIntegrityKey } from './integrity-key-continuity.mjs';
import { CompanionBridgeServer } from './companion/bridge-server.mjs';
import { CompanionLifecycleManager } from './companion/lifecycle-manager.mjs';
import { FamilyBridgeProtocolError, validateFamilyBridgeAction } from './companion/protocol.mjs';
import { CompanionSessionManager } from './companion/session-manager.mjs';
import { FamilyCoreBridgeServer } from './family-core/bridge-server.mjs';
import { FamilyCoreCredentialManager } from './family-core/credential-manager.mjs';
import { FamilyCoreSessionManager } from './family-core/session-manager.mjs';
import { FamilyCoreIdentityRegistry } from './family-core/identity-registry.mjs';
import { FamilyClientProvisioner } from './companion/client-provisioner.mjs';
import { DpapiMinecraftAccountVault } from './companion/dpapi-vault.mjs';
import { MicrosoftMinecraftAuth } from './companion/microsoft-auth.mjs';
import { MinecraftAccountRegistrationStore, validateMinecraftPublicClientId } from './companion/account-registration.mjs';
import { createManagedClientLaunchFactory } from './companion/managed-client-launch.mjs';
import { FileMastermindEventOutbox } from './domain-events/outbox.mjs';
import { attachCompanionDomainEventProducer } from './domain-events/companion-producer.mjs';
import {
  MastermindMemoryApiConsumer,
  MastermindMemoryEventSyncController,
} from './domain-events/memory-api-consumer.mjs';
import { createFamilyCompanionSkeleton } from './brain/index.mjs';

const MAX_BODY_BYTES = 32 * 1024;
const SUPERVISOR_DRAIN_TIMEOUT_MS = 30_000;
const CLIENT_STATUS_CACHE_TTL_MS = 5 * 60 * 1000;
const COMPANION_ACTION_MIN_TIMEOUT_MS = 100;
const COMPANION_ACTION_MAX_TIMEOUT_MS = 30 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BACKUP_RECOVERY_SAFE_ACCOUNT_POST_PATHS = new Set([
  '/v1/account/registration',
  '/v1/account/device/start',
  '/v1/account/refresh',
  '/v1/account/signout',
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BACKUP_ID_PATTERN = /^bkp-[a-f0-9]{32}$/;
const FAMILY_CORE_CANDIDATE_PATH = fileURLToPath(new URL('../../../minecraft/family-core/build/libs/family-core-0.4.0.jar', import.meta.url));
const FAMILY_CORE_BRIDGE_SHA256 = '1a9babbce78c4105a71a9bb35c121cad4d567e988d2035f2cdbc1667324105f1';
const FAMILY_CORE_DETERMINISTIC_COMPUTER_COMMAND_ENABLED = true;
const FAMILY_CORE_IDENTITY_EVENTS_ENABLED = true;
const RESTORE_PLAN_ID_PATTERN = /^rst-[a-f0-9]{64}$/;
const SAFE_BACKUP_ROUTE_CODES = new Set([
  'BODY_TOO_LARGE',
  'COMPANION_ALREADY_ACTIVE',
  'INVALID_BACKUP_APPROVAL',
  'INVALID_BACKUP_CONFIRMATION',
  'INVALID_BACKUP_ID',
  'INVALID_INSTANCE_ID',
  'INVALID_JSON',
  'INSTANCE_NOT_FOUND',
  'UNEXPECTED_BODY',
]);
const ADMIN_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BACKUP_STORAGE_ERROR_CODES = new Set(['ENOSPC', 'EDQUOT']);
const RECOVERY_TRANSACTION_REFS = Object.freeze({
  backup: /^rtx-[a-f0-9]{32}$/,
  mods: /^modtx-[a-f0-9]{64}$/,
  world: /^worldtx-[a-f0-9]{64}$/,
  worlds: /^worldtx-[a-f0-9]{64}$/,
  update: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
});
const SAFE_UPDATE_ROUTE_MESSAGES = new Map([
  ['UPDATE_RECOVERY_REQUIRED', 'An interrupted server update requires verified recovery before this action can continue.'],
  ['UPDATE_BACKUP_RETENTION_REQUIRED', 'A prior update rollback or cleanup payload must be explicitly retained or purged before another server update.'],
  ['UPDATE_LEGACY_MIGRATION_UNAVAILABLE', 'The authenticated legacy launch migration is unavailable until its cleanup boundary is explicitly authorized.'],
  ['UPDATE_PLAN_CHANGED', 'The approved server update plan no longer matches the current verified server state.'],
  ['UPDATE_INVALID_STATE', 'The retired-version cleanup is unavailable in the current verified server state.'],
  ['CLEANUP_UNAVAILABLE', 'The retired-version cleanup boundary is unavailable.'],
]);
const GLOBAL_RECOVERY_MESSAGES = new Map([
  ['CONTROL_RECOVERY_REQUIRED', 'Managed recovery evidence requires verified repair before local mutations can continue.'],
  ['BACKUP_MANUAL_RECOVERY_REQUIRED', 'Backup recovery requires verified manual repair before local mutations can continue.'],
  ['MOD_MANUAL_RECOVERY_REQUIRED', 'Managed mod recovery requires verified repair before local mutations can continue.'],
  ['WORLD_RECOVERY_REQUIRED', 'Managed world recovery requires verified repair before local mutations can continue.'],
  ['UPDATE_RECOVERY_REQUIRED', 'An interrupted server update requires verified recovery before local mutations can continue.'],
]);
const SAFE_LIFECYCLE_MESSAGES = new Map([
  ['INSTANCE_NOT_FOUND', 'Instance was not found.'],
  ['MOD_INTEGRITY_FAILED', 'Managed mod integrity verification blocked the server lifecycle action.'],
  ['UPDATE_APPROVAL_REQUIRED', 'An approved Minecraft version migration is required before the server can start.'],
  ['LAUNCH_TRUST_UNAVAILABLE', 'The authenticated launch boundary is unavailable on this system.'],
  ['LAUNCH_INTEGRITY_UNAVAILABLE', 'The authenticated launch-integrity boundary is unavailable.'],
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isBackupRecoverySafeAccountPost(request, url) {
  if (request.method !== 'POST' || url.search !== '') return false;
  if (BACKUP_RECOVERY_SAFE_ACCOUNT_POST_PATHS.has(url.pathname)) return true;
  const devicePoll = url.pathname.match(/^\/v1\/account\/device\/([^/]+)\/poll$/);
  return devicePoll !== null && UUID_PATTERN.test(devicePoll[1]);
}

export function composeWorldStackBinding(instance, stack, errorCode = 'WORLD_STATE_UNAVAILABLE') {
  const artifact = instance?.minecraftServerArtifact;
  const runtime = instance?.javaRuntime;
  if (!instance || !artifact || typeof artifact !== 'object' || Array.isArray(artifact)
    || !Number.isSafeInteger(instance.worldDataVersion) || instance.worldDataVersion !== artifact.worldDataVersion
    || !runtime || typeof runtime !== 'object' || Array.isArray(runtime)
    || !SHA256_PATTERN.test(runtime.launchAssetDigest ?? '')
    || !SHA256_PATTERN.test(runtime.launchInventoryDigest ?? '')
    || !stack || typeof stack !== 'object' || Array.isArray(stack)
    || !SHA256_PATTERN.test(stack.generation ?? '') || !SHA256_PATTERN.test(stack.inventoryDigest ?? '')) {
    throw Object.assign(new Error('The verified Minecraft server compatibility binding is unavailable.'), {
      code: errorCode,
      statusCode: 503,
    });
  }
  return {
    generation: sha256(canonicalJson({
      modStackGeneration: stack.generation,
      minecraftServerArtifact: artifact,
      worldDataVersion: instance.worldDataVersion,
      launchTrust: {
        launchAssetDigest: runtime.launchAssetDigest,
        launchInventoryDigest: runtime.launchInventoryDigest,
      },
    })),
    inventoryDigest: stack.inventoryDigest,
  };
}

function publicInstanceText(value, maximum) {
  return typeof value === 'string' && value.length >= 1 && value.length <= maximum
    && Buffer.byteLength(value, 'utf8') <= maximum * 4
    && !/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(value)
    ? value
    : null;
}

function publicInstanceTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
    ? value
    : null;
}

function validateRecoveryPreflight(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'domain') || !Object.hasOwn(value, 'instances')
    || typeof value.domain !== 'string' || !Object.hasOwn(RECOVERY_TRANSACTION_REFS, value.domain)
    || !Array.isArray(value.instances) || value.instances.length > 4_096) {
    throw Object.assign(new Error('Managed recovery preflight returned invalid evidence.'), { code: 'CONTROL_RECOVERY_REQUIRED', statusCode: 409 });
  }
  const pattern = RECOVERY_TRANSACTION_REFS[value.domain];
  const seen = new Set();
  const seenInstances = new Set();
  let previousKey = null;
  const instances = value.instances.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).length !== 2 || !Object.hasOwn(item, 'instanceId') || !Object.hasOwn(item, 'transactionRef')
      || !validateInstanceId(item.instanceId) || typeof item.transactionRef !== 'string' || !pattern.test(item.transactionRef)) {
      throw Object.assign(new Error('Managed recovery preflight returned invalid evidence.'), { code: 'CONTROL_RECOVERY_REQUIRED', statusCode: 409 });
    }
    const key = `${item.instanceId}:${item.transactionRef}`;
    if (seen.has(key) || seenInstances.has(item.instanceId) || (previousKey !== null && key.localeCompare(previousKey, 'en') <= 0)) {
      throw Object.assign(new Error('Managed recovery preflight returned duplicate or noncanonical evidence.'), { code: 'CONTROL_RECOVERY_REQUIRED', statusCode: 409 });
    }
    seen.add(key);
    seenInstances.add(item.instanceId);
    previousKey = key;
    return { instanceId: item.instanceId, transactionRef: item.transactionRef };
  });
  return { domain: value.domain === 'worlds' ? 'world' : value.domain, instances };
}

function publicInstance(instance) {
  if (!instance) return null;
  if (typeof instance !== 'object' || Array.isArray(instance)
    || !validateInstanceId(instance.id)
    || !publicInstanceText(instance.displayName, 64)
    || !publicInstanceText(instance.minecraftVersion, 96)
    || !['stopped', 'starting', 'running', 'stopping', 'failed'].includes(instance.status)) {
    throw Object.assign(new Error('The managed instance inventory is invalid.'), { code: 'INSTANCE_INVENTORY_INVALID', statusCode: 503 });
  }
  if (instance.pid !== undefined && instance.pid !== null
    && (!Number.isSafeInteger(instance.pid) || instance.pid < 1 || instance.pid > 0xffffffff)) {
    throw Object.assign(new Error('The managed instance process identity is invalid.'), { code: 'INSTANCE_INVENTORY_INVALID', statusCode: 503 });
  }
  const result = {
    id: instance.id,
    displayName: instance.displayName,
    status: instance.status,
    minecraftVersion: instance.minecraftVersion,
    ...(instance.projectId === 'family-server' ? { projectId: 'family-server' } : {}),
    ...(instance.kind === 'server' ? { kind: 'server' } : {}),
    ...(instance.pid === null || Number.isSafeInteger(instance.pid) ? { pid: instance.pid } : {}),
  };
  for (const key of ['latestMinecraftVersion', 'loader', 'loaderVersion']) {
    const value = publicInstanceText(instance[key], 128);
    if (value) result[key] = value;
  }
  if (instance.updateChannel === 'latest-compatible') result.updateChannel = 'latest-compatible';
  for (const key of ['javaPort', 'serverPort', 'bedrockPort']) {
    if (Number.isSafeInteger(instance[key]) && instance[key] >= 1 && instance[key] <= 65535) result[key] = instance[key];
  }
  if (instance.components && typeof instance.components === 'object' && !Array.isArray(instance.components)) {
    const components = {};
    for (const key of ['fabricApi', 'geyser', 'floodgate']) {
      const component = instance.components[key];
      const versionNumber = component && typeof component === 'object' && !Array.isArray(component)
        ? publicInstanceText(component.versionNumber, 128)
        : null;
      if (versionNumber) components[key] = { versionNumber };
    }
    if (Object.keys(components).length > 0) result.components = components;
  }
  if (typeof instance.provisioningStatus === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(instance.provisioningStatus)) {
    result.provisioningStatus = instance.provisioningStatus;
  }
  if (instance.lastError === null) result.lastError = null;
  else if (typeof instance.lastError === 'string' && instance.lastError.length > 0) {
    result.lastError = 'The managed server reported an error. Review the bounded local server logs.';
  }
  if (instance.updateStatus && typeof instance.updateStatus === 'object' && !Array.isArray(instance.updateStatus)
    && ['pending-unverified', 'verified'].includes(instance.updateStatus.state)) {
    const updateStatus = { state: instance.updateStatus.state };
    for (const key of ['previousMinecraftVersion', 'targetMinecraftVersion']) {
      const value = publicInstanceText(instance.updateStatus[key], 96);
      if (value) updateStatus[key] = value;
    }
    if (typeof instance.updateStatus.backupAvailable === 'boolean') {
      updateStatus.backupAvailable = instance.updateStatus.backupAvailable;
    }
    const verifiedAt = publicInstanceTimestamp(instance.updateStatus.verifiedAt);
    if (verifiedAt) updateStatus.verifiedAt = verifiedAt;
    result.updateStatus = updateStatus;
  }
  if (instance.lastRestore === null) result.lastRestore = null;
  else if (instance.lastRestore && typeof instance.lastRestore === 'object' && !Array.isArray(instance.lastRestore)) {
    const restoredAt = publicInstanceTimestamp(instance.lastRestore.restoredAt);
    if (BACKUP_ID_PATTERN.test(instance.lastRestore.backupId ?? '')
      && BACKUP_ID_PATTERN.test(instance.lastRestore.rescueBackupId ?? '')
      && restoredAt && instance.lastRestore.state === 'verified') {
      result.lastRestore = {
        backupId: instance.lastRestore.backupId,
        rescueBackupId: instance.lastRestore.rescueBackupId,
        restoredAt,
        state: 'verified',
      };
    } else {
      throw Object.assign(new Error('The managed instance restore receipt is invalid.'), { code: 'INSTANCE_INVENTORY_INVALID', statusCode: 503 });
    }
  }
  return result;
}

function publicUpdatePlan(plan) {
  const state = plan?.state === 'automatic-component-update' ? 'component-update-available' : plan?.state;
  return {
    state,
    updateKind: plan?.updateKind,
    planId: typeof plan?.planId === 'string' ? plan.planId : undefined,
    requiresApproval: plan?.requiresApproval === true,
    currentMinecraft: plan?.currentMinecraftVersion,
    targetMinecraft: plan?.targetMinecraftVersion,
    checkedAt: new Date().toISOString(),
  };
}

function publicUpdateResult(result) {
  return {
    action: result?.action,
    instance: publicInstance(result?.instance),
    plan: result?.plan ? publicUpdatePlan(result.plan) : undefined,
    transaction: result?.transaction,
    readiness: result?.readiness,
  };
}

function publicLanStatus(value, instances = []) {
  let portStatus = ['available', 'occupied', 'unknown'].includes(value?.portStatus) ? value.portStatus : 'unknown';
  const addresses = Array.isArray(value?.addresses)
    ? [...new Set(value.addresses.filter((address) => isPrivateIpv4(address)))].slice(0, 16)
    : [];
  const pid = Number.isInteger(value?.owner?.pid) && value.owner.pid > 0 && value.owner.pid <= 0xffffffff
    ? value.owner.pid
    : null;
  const processName = typeof value?.owner?.processName === 'string'
    && value.owner.processName.length <= 128
    && !/[\x00-\x1f\x7f\\/:<>"|]/.test(value.owner.processName)
    ? value.owner.processName
    : null;
  const checkedAt = typeof value?.checkedAt === 'string' && Number.isFinite(Date.parse(value.checkedAt))
    ? value.checkedAt
    : new Date().toISOString();
  const managedGeyser = portStatus === 'occupied' && pid !== null && instances.some((instance) => (
    instance?.projectId === 'family-server'
    && instance?.kind === 'server'
    && instance?.status === 'running'
    && instance?.pid === pid
    && instance?.bedrockPort === 19132
  ));
  if (managedGeyser) portStatus = 'geyser-listening';
  return {
    bindAddress: '0.0.0.0',
    addresses,
    bedrockPort: 19132,
    portStatus,
    ...(portStatus === 'occupied' && (pid || processName) ? {
      owner: {
        ...(pid ? { pid } : {}),
        ...(processName ? { processName } : {}),
      },
    } : {}),
    firewallRulesPresent: typeof value?.firewallRulesPresent === 'boolean' ? value.firewallRulesPresent : null,
    localSubnetOnly: typeof value?.localSubnetOnly === 'boolean' ? value.localSubnetOnly : null,
    checkedAt,
  };
}

function publicCompanionLifecycle(value) {
  const manifest = value?.versionManifest;
  const versionManifest = manifest ? {
    clientId: manifest.clientId,
    bridgeVersion: manifest.bridgeVersion,
    minecraftVersion: manifest.minecraftVersion,
    loaderVersion: manifest.loaderVersion,
    baritoneVersion: manifest.baritoneVersion,
  } : null;
  const lastExit = value?.lastExit ? {
    code: Number.isInteger(value.lastExit.code) ? value.lastExit.code : null,
    at: value.lastExit.at ?? null,
  } : null;
  return {
    state: value?.state ?? 'stopped',
    versionManifest,
    startedAt: value?.startedAt ?? null,
    stoppedAt: value?.stoppedAt ?? null,
    updatedAt: value?.updatedAt ?? null,
    lastExit,
    lastError: value?.lastError ? 'The managed Family AI companion requires attention.' : null,
  };
}

function publicCompanionBridge(value) {
  const client = value?.client ? {
    clientId: value.client.clientId,
    bridgeVersion: value.client.bridgeVersion,
    minecraftVersion: value.client.minecraftVersion,
    loaderVersion: value.client.loaderVersion,
    baritoneVersion: value.client.baritoneVersion,
  } : null;
  return {
    state: value?.state ?? 'disconnected',
    ready: value?.state === 'ready',
    connectedAt: value?.connectedAt ?? null,
    lastHeartbeatAt: value?.lastHeartbeatAt ?? null,
    lastSnapshotAt: value?.lastSnapshotAt ?? null,
    client,
    capabilities: Array.isArray(value?.client?.capabilities) ? [...value.client.capabilities] : [],
    killSwitch: value?.killSwitch === true,
    activeAction: value?.activeAction ?? null,
    snapshot: value?.latestSnapshot ?? null,
    pendingShutdown: value?.pendingShutdown ?? null,
    lastDisconnect: value?.lastDisconnect ?? null,
  };
}

function publicCompanionStatus({ lifecycle, sessions, launchAvailable, targetInstanceId = 'family-server' }) {
  return {
    projectId: 'family-server',
    targetInstanceId,
    launchAvailable: launchAvailable === true,
    lifecycle: publicCompanionLifecycle(lifecycle.status()),
    bridge: publicCompanionBridge(sessions.status()),
  };
}

function publicClientStatus(value, account, { targetInstanceId = 'family-server' } = {}) {
  const installed = value?.state === 'installed' && value?.integrity === 'verified';
  return {
    projectId: 'family-ai-client',
    targetInstanceId,
    state: value?.state ?? 'not-installed',
    integrity: value?.integrity ?? 'not-installed',
    installed,
    minecraftVersion: value?.minecraftVersion ?? '26.2',
    loader: value?.loader ?? { name: 'Fabric Loader', version: '0.19.3' },
    requiredJavaMajor: value?.requiredJavaMajor ?? 25,
    installedAt: value?.installedAt ?? null,
    artifactCount: Number.isInteger(value?.artifactCount) ? value.artifactCount : 0,
    nativeFiles: Number.isInteger(value?.nativeFiles) ? value.nativeFiles : 0,
    launchReady: installed && account?.sessionReady === true,
    authenticationConfigured: account?.configured === true,
  };
}

function companionLifecycleIsActive(lifecycle) {
  if (typeof lifecycle?.isActive === 'function') return lifecycle.isActive() === true;
  return ['starting', 'running', 'stopping', 'orphaned'].includes(lifecycle?.status?.()?.state);
}

function validateCompanionActionRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Companion action request must be a JSON object');
  }
  const allowed = new Set(['action', 'timeoutMs']);
  if (Object.keys(input).some((key) => !allowed.has(key)) || !Object.hasOwn(input, 'action')) {
    throw new TypeError('Companion action request contains unsupported fields');
  }
  validateFamilyBridgeAction(input.action);
  if (input.timeoutMs !== undefined && (
    !Number.isInteger(input.timeoutMs)
    || input.timeoutMs < COMPANION_ACTION_MIN_TIMEOUT_MS
    || input.timeoutMs > COMPANION_ACTION_MAX_TIMEOUT_MS
  )) {
    throw new TypeError(`timeoutMs must be an integer between ${COMPANION_ACTION_MIN_TIMEOUT_MS} and ${COMPANION_ACTION_MAX_TIMEOUT_MS}`);
  }
  return {
    action: structuredClone(input.action),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}

async function isExactOwnedServerChild(processes, instance) {
  if (!instance || !Number.isInteger(instance.pid) || instance.pid < 1 || instance.pid > 0xffffffff) return false;
  if (typeof processes.ownsActiveChild === 'function') {
    return await processes.ownsActiveChild(instance.id, instance.pid) === true;
  }
  const entry = processes?.children instanceof Map ? processes.children.get(instance.id) : null;
  return entry?.child?.pid === instance.pid;
}

async function requireExactOwnedFamilyServerChild({ processes, store, instanceId }) {
  let instance = null;
  let owned = false;
  try {
    instance = await store.get(instanceId);
    owned = Boolean(
      instance
      && instance.projectId === 'family-server'
      && instance.kind === 'server'
      && instance.status === 'running'
      && Number.isInteger(instance.javaPort)
      && instance.javaPort >= 1
      && instance.javaPort <= 65535
      && await isExactOwnedServerChild(processes, instance)
    );
  } catch {
    owned = false;
  }
  if (!owned) {
    throw Object.assign(new Error('The target Family Server is no longer the exact running child owned by this control plane.'), {
      statusCode: 409,
      code: 'COMPANION_SERVER_NOT_READY',
    });
  }
  return instance;
}

function json(response, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(body);
}

function tokenMatches(header, expected) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice(7), 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

function supervisorIdMatches(header, expected) {
  if (typeof header !== 'string' || typeof expected !== 'string' || !/^[a-f0-9]{32}$/.test(expected)) return false;
  const actual = Buffer.from(header, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

async function readJsonBody(request) {
  const declared = Number(request.headers['content-length'] ?? 0);
  if (declared > MAX_BODY_BYTES) throw Object.assign(new Error('Request body is too large'), { statusCode: 413, code: 'BODY_TOO_LARGE' });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request body is too large'), { statusCode: 413, code: 'BODY_TOO_LARGE' });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Request body is not valid JSON'), { statusCode: 400, code: 'INVALID_JSON' }); }
}

function requestHasBody(request) {
  const declared = Number(request.headers['content-length'] ?? 0);
  return declared > 0 || typeof request.headers['transfer-encoding'] === 'string';
}

function classifyError(error) {
  if (error?.statusCode) return { status: error.statusCode, code: error.code ?? 'REQUEST_FAILED' };
  if (error instanceof FamilyBridgeProtocolError) return { status: 400, code: error.code ?? 'INVALID_ACTION' };
  if (error instanceof TypeError) return { status: 400, code: 'INVALID_REQUEST' };
  if (/already exists/i.test(error?.message ?? '')) return { status: 409, code: 'INSTANCE_EXISTS' };
  if (/not found/i.test(error?.message ?? '')) return { status: 404, code: 'INSTANCE_NOT_FOUND' };
  if (/not ready|already active|not owned by this manager|port .* already in use|integrity|managed artifact|private instance manifest|managed Java/i.test(error?.message ?? '')) {
    return { status: 409, code: 'INVALID_STATE' };
  }
  return { status: 500, code: 'CONTROL_PLANE_ERROR' };
}

function backupRouteFailure(error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{3,64}$/.test(error.code)
    ? error.code
    : 'BACKUP_OPERATION_FAILED';
  if (BACKUP_STORAGE_ERROR_CODES.has(code)) {
    return {
      status: 507,
      code: 'BACKUP_STORAGE_FULL',
      message: 'Family Server backup storage is full.',
      sanitized: true,
      logCode: code,
    };
  }
  if (code.startsWith('BACKUP_')) {
    const status = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
      ? error.statusCode
      : 500;
    return {
      status,
      code,
      message: typeof error?.message === 'string' && error.message ? error.message : 'The Family Server backup operation failed safely.',
      sanitized: false,
      logCode: code,
    };
  }
  if (SAFE_BACKUP_ROUTE_CODES.has(code) && Number.isInteger(error?.statusCode)) {
    return {
      status: error.statusCode,
      code,
      message: error?.message ?? 'The Family Server backup request was rejected.',
      sanitized: false,
      logCode: code,
    };
  }
  return {
    status: 500,
    code: 'BACKUP_OPERATION_FAILED',
    message: 'The Family Server backup operation failed safely.',
    sanitized: true,
    logCode: code,
  };
}

function adminRouteFailure(error) {
  const code = typeof error?.code === 'string' && /^ADMIN_[A-Z0-9_]{3,64}$/.test(error.code)
    ? error.code
    : 'ADMIN_OPERATION_FAILED';
  const safeCodes = new Set([
    'ADMIN_ACTION_UNSUPPORTED', 'ADMIN_APPROVAL_INVALID', 'ADMIN_APPROVAL_REQUIRED', 'ADMIN_AUDIT_UNAVAILABLE',
    'ADMIN_COMPLETION_UNKNOWN', 'ADMIN_INSTANCE_NOT_FOUND', 'ADMIN_INVALID_INSTANCE', 'ADMIN_INVALID_INSTANCE_ID',
    'ADMIN_INVALID_MESSAGE', 'ADMIN_INVALID_PLAYER', 'ADMIN_INVALID_REASON', 'ADMIN_INVALID_REQUEST',
    'ADMIN_JOURNAL_FULL', 'ADMIN_JOURNAL_UNAVAILABLE', 'ADMIN_OPERATION_NOT_FOUND', 'ADMIN_PLAN_EXPIRED',
    'ADMIN_PLAN_NOT_REQUIRED', 'ADMIN_PROCESS_UNAVAILABLE', 'ADMIN_REQUEST_ID_CONFLICT', 'ADMIN_SERVER_NOT_RUNNING',
  ]);
  const status = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
    ? error.statusCode
    : 500;
  if (safeCodes.has(code)) return { status, code, message: error.message, sanitized: false };
  return { status: 500, code: 'ADMIN_OPERATION_FAILED', message: 'The Family Server administration request failed safely.', sanitized: true };
}

function modRouteFailure(error) {
  const safeCodes = new Set([
    'MOD_ALREADY_MANAGED', 'MOD_APPROVAL_INVALID', 'MOD_AUDIT_UNAVAILABLE', 'MOD_CATALOG_REF_EXPIRED',
    'MOD_COMPLETION_UNKNOWN', 'MOD_CORE_INTEGRITY_FAILED', 'MOD_CORE_PROTECTED', 'MOD_DEPENDENCY_OWNED',
    'MOD_DEPENDENCY_UNRESOLVED', 'MOD_DEPENDENT_ROOT_EXISTS', 'MOD_INCOMPATIBLE', 'MOD_INSTALLED_NOT_FOUND',
    'MOD_INTEGRITY_FAILED', 'MOD_INVALID_INSTANCE', 'MOD_INVALID_REF', 'MOD_INVALID_REQUEST', 'MOD_MANUAL_RECOVERY_REQUIRED',
    'MOD_NOT_FOUND', 'MOD_OPERATION_NOT_FOUND', 'MOD_PLAN_EXPIRED', 'MOD_PLAN_NOT_FOUND', 'MOD_PLAN_QUOTA_EXCEEDED',
    'MOD_PLAN_STALE', 'MOD_REQUEST_ID_CONFLICT', 'MOD_ROLLBACK_STALE', 'MOD_SERVER_NOT_QUIESCENT',
    'MOD_SNAPSHOT_FAILED', 'MOD_STATE_UNAVAILABLE', 'MOD_TRANSACTION_NOT_FOUND', 'MOD_UNMANAGED_MODS_PRESENT',
    'MOD_MUTATION_UNAVAILABLE',
    'MOD_UPSTREAM_UNAVAILABLE', 'MOD_WORLD_STATE_BLOCKED', 'MODS_BLOCK_MINECRAFT_UPDATE',
  ]);
  const code = typeof error?.code === 'string' && /^MODS?_[A-Z0-9_]{3,64}$/.test(error.code) ? error.code : 'MOD_OPERATION_FAILED';
  if (safeCodes.has(code)) return { status: code === 'MOD_COMPLETION_UNKNOWN' ? 202 : (Number.isInteger(error?.statusCode) ? error.statusCode : 500), code, message: error.message, sanitized: false };
  return { status: 500, code: 'MOD_OPERATION_FAILED', message: 'The Family Server mod request failed safely.', sanitized: true };
}

function worldRouteFailure(error) {
  const aliases = new Map([
    ['WORLD_INVALID_INSTANCE', 'WORLD_INVALID_REQUEST'], ['WORLD_INVALID_STATE', 'WORLD_SOURCE_CHANGED'],
    ['WORLD_NOT_FOUND', 'WORLD_INVALID_REF'], ['WORLD_INTEGRITY_FAILED', 'WORLD_SOURCE_CHANGED'],
    ['WORLD_STATE_UNAVAILABLE', 'WORLD_RECOVERY_REQUIRED'], ['WORLD_VERSION_INCOMPATIBLE', 'WORLD_SOURCE_CHANGED'],
  ]);
  const safeCodes = new Set([
    'WORLD_APPROVAL_INVALID', 'WORLD_COMPANION_NOT_QUIESCENT', 'WORLD_INTEGRITY_FAILED', 'WORLD_INVALID_INSTANCE',
    'WORLD_INVALID_LABEL', 'WORLD_INVALID_REF', 'WORLD_INVALID_REQUEST', 'WORLD_INVALID_STATE', 'WORLD_NOT_FOUND',
    'WORLD_OPERATION_NOT_FOUND', 'WORLD_PLAN_NOT_FOUND', 'WORLD_PLAN_STALE', 'WORLD_SOURCE_CHANGED',
    'WORLD_QUOTA_EXCEEDED', 'WORLD_RECOVERY_REQUIRED', 'WORLD_REQUEST_ID_CONFLICT', 'WORLD_SERVER_NOT_QUIESCENT',
    'WORLD_SNAPSHOT_FAILED', 'WORLD_STATE_UNAVAILABLE', 'WORLD_STORAGE_FULL', 'WORLD_SWITCH_VERIFY_FAILED',
    'WORLD_VERSION_INCOMPATIBLE', 'WORLD_VERSION_METADATA_REQUIRED', 'WORLDS_BLOCK_MINECRAFT_UPDATE',
    'WORLDS_BLOCK_MOD_MUTATION', 'WORLDS_BLOCK_STACK_UPDATE',
  ]);
  const rawCode = typeof error?.code === 'string' && /^WORLDS?_[A-Z0-9_]{3,64}$/.test(error.code) ? error.code : null;
  if (!rawCode) return { status: 500, code: 'WORLD_OPERATION_FAILED', message: 'The Family Server world request failed safely.', sanitized: true };
  const code = aliases.get(rawCode) ?? rawCode;
  const status = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 500;
  if (safeCodes.has(code)) return { status, code, message: error.message, sanitized: false };
  return { status: 500, code: 'WORLD_OPERATION_FAILED', message: 'The Family Server world request failed safely.', sanitized: true };
}

function firstPartyCoreRouteFailure(error) {
  const code = typeof error?.code === 'string' && /^FAMILY_CORE_[A-Z0-9_]{3,64}$/.test(error.code)
    ? error.code
    : 'FAMILY_CORE_OPERATION_FAILED';
  const safeCodes = new Set([
    'FAMILY_CORE_ARTIFACT_INVALID', 'FAMILY_CORE_BACKUP_REQUIRED', 'FAMILY_CORE_CONFIRMATION_REQUIRED',
    'FAMILY_CORE_INSTANCE_INVALID', 'FAMILY_CORE_INTEGRITY_FAILED', 'FAMILY_CORE_RECOVERY_REQUIRED',
    'FAMILY_CORE_STATE_CHANGED', 'FAMILY_CORE_STATE_INVALID', 'FAMILY_CORE_STATE_UNAVAILABLE',
    'FAMILY_CORE_UNMANAGED',
  ]);
  const status = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
    ? error.statusCode
    : 500;
  if (safeCodes.has(code)) return { status, code, message: error.message, sanitized: false };
  return {
    status: 500,
    code: 'FAMILY_CORE_OPERATION_FAILED',
    message: 'The first-party Family Core operation failed safely.',
    sanitized: true,
  };
}

export function publicBackupInitializationFailure(error) {
  const stage = [
    'integration', 'storage-roots', 'authentication-key', 'cleanup-recovery',
    'restore-recovery', 'filesystem-safety-close',
  ].includes(error?.backupInitializationStage)
    ? error.backupInitializationStage
    : 'unknown';
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.code)
    ? error.code
    : 'BACKUP_INITIALIZATION_FAILED';
  const causeCode = typeof error?.cause?.code === 'string'
    && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.cause.code)
    ? error.cause.code
    : 'UNAVAILABLE';
  return { stage, code, cause: causeCode };
}

export function formatBackupInitializationDiagnostic(error) {
  const diagnostic = publicBackupInitializationFailure(error);
  return `Family Server backup initialization fenced mutations safely (stage=${diagnostic.stage}, code=${diagnostic.code}, cause=${diagnostic.cause}).`;
}

export function formatLifecycleFailureDiagnostic(error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{3,64}$/.test(error.code)
    ? error.code
    : 'CONTROL_ACTION_FAILED';
  const stage = [
    'instance-validation', 'manifest-read', 'base-integrity', 'launch-inventory',
    'windows-policy', 'mod-inventory', 'native-metadata', 'launch-session',
    'classpath', 'lease-acquire', 'lease-assert',
  ].includes(error?.launchVerificationStage)
    ? error.launchVerificationStage
    : null;
  return stage
    ? `Family Server lifecycle action failed at ${stage} (${code}).`
    : `Family Server lifecycle action failed (${code}).`;
}

export function formatUpdateLifecycleFailureDiagnostic(error) {
  const stage = [
    'recovery-state', 'marker-inventory', 'marker-key', 'marker-authentication',
    'store-receipt', 'key-continuity',
  ].includes(error?.updateLifecycleStage)
    ? error.updateLifecycleStage
    : 'unknown';
  return `Family Server update lifecycle fence failed at ${stage} (UPDATE_RECOVERY_REQUIRED).`;
}

export function formatWorldInitializationFailureDiagnostic(error) {
  const stage = [
    'restore-validation', 'store-read', 'lifecycle-lock', 'store-recheck', 'instance-validation',
    'version-verification', 'running-recovery', 'quiescence', 'root-initialization',
    'catalog-initialization', 'journal-recovery',
  ].includes(error?.worldInitializationStage)
    ? error.worldInitializationStage
    : 'unknown';
  const code = typeof error?.code === 'string'
    && (/^WORLD_[A-Z0-9_]+$/.test(error.code) || ['EACCES', 'EBUSY', 'EPERM', 'ENOENT'].includes(error.code))
    ? error.code
    : 'WORLD_INITIALIZATION_FAILED';
  const kind = new Map([
    ['Error', 'ERROR'], ['TypeError', 'TYPE_ERROR'], ['SyntaxError', 'SYNTAX_ERROR'], ['RangeError', 'RANGE_ERROR'],
  ]).get(error?.name) ?? 'UNKNOWN_ERROR';
  return `Family Server world manager initialization failed at ${stage} (${code}; ${kind}).`;
}

export function publicBackupRecoveryOverview({
  reconciled,
  manualRecoveryRequired,
  globalRecoveryRequired,
  initializationFailure = null,
}) {
  return {
    reconciled,
    manualRecoveryRequired,
    globalRecoveryRequired,
    ...(initializationFailure === null ? {} : {
      initializationFailure: {
        stage: initializationFailure.stage,
        code: initializationFailure.code,
        cause: initializationFailure.cause,
      },
    }),
  };
}

async function prepareLegacyMigration({ dataRoot, managedRoot, store, discover, importer, isLegacyActive }) {
  if ((await store.list()).length > 0) return { state: 'managed-inventory-present', candidateCount: 0 };
  const candidates = await discover(dataRoot);
  if (candidates.length === 0) return { state: 'not-found', candidateCount: 0 };
  if (candidates.length > 1) return { state: 'selection-required', candidateCount: candidates.length };
  try {
    const result = await importer({ dataRoot, managedRoot, store, instanceId: candidates[0].id, isLegacyActive });
    return result.imported
      ? { state: 'imported-update-required', candidateCount: 1, instanceId: candidates[0].id }
      : { state: result.reason ?? 'not-imported', candidateCount: 1 };
  } catch (error) {
    // Keep the manager available so the operator can stop a changing legacy server and retry.
    // Do not surface source paths or raw filesystem errors through the browser API.
    console.warn(`Legacy Family Server import was not completed: ${error?.message ?? String(error)}`);
    return { state: 'failed', candidateCount: 1 };
  }
}

export async function createControlPlane(options = {}) {
  const config = options.config ?? readConfig();
  if (typeof config.token !== 'string' || config.token.length < 32) throw new Error('Control token must contain at least 32 characters');
  if (config.host !== '127.0.0.1') throw new Error('The Minecraft control plane must bind exactly to IPv4 loopback');
  const memoryEventPlayerId = validMemoryEventPlayerId(config.memoryEventPlayerId)
    ? config.memoryEventPlayerId
    : null;
  if (config.memoryEventSyncEnabled === true && memoryEventPlayerId === null) {
    throw memoryIdentityRequiredError();
  }
  const familyCompanionBrain = options.familyCompanionBrain ?? createFamilyCompanionSkeleton();
  const managedRoot = options.managedRoot ?? path.join(config.dataRoot, 'projects', 'family-server');
  const store = options.store ?? new InstanceStore(managedRoot);
  const logs = options.logs ?? new LogStore(managedRoot);
  await store.initialize();
  const launchKeyPin = await (options.launchIntegrityKeyAcquirer ?? acquireLaunchIntegrityKey)(managedRoot, { createIfMissing: true });
  const pinnedLaunchIntegrityKey = Buffer.isBuffer(launchKeyPin?.key) && launchKeyPin.key.length === 32
    ? Buffer.from(launchKeyPin.key)
    : null;
  await launchKeyPin.release();
  // Discovery/import is deliberately deferred until every authenticated recovery
  // namespace has been admitted and reconciled. Importing earlier could publish a
  // legacy live/store record into a crash layout that an unfinished transaction owns.
  let legacyMigration = options.legacyMigration ?? null;
  let updater;
  let updateLifecycleFencesReady = false;
  let managedLifecycleFencesReady = false;
  const withStrictUpdateLifecycleLock = (id, operation) => processes.withInstanceLock(id, async () => {
    if (managedLifecycleFencesReady) await assertManagedLifecycleSafeWithinInstanceLock(id);
    else if (updateLifecycleFencesReady) {
      if (typeof updater?.assertSafeForLifecycle !== 'function') {
        throw Object.assign(new Error('The authenticated update recovery fence is unavailable.'), {
          code: 'UPDATE_RECOVERY_REQUIRED', statusCode: 409,
        });
      }
      // During ordered startup recovery, mod/world managers must initialize
      // before a real server launch can prove a pending update ready. The
      // updater still authenticates the exact pending receipt; other unfinished
      // phases remain rejected.
      await updater.assertSafeForLifecycle(id, { allowPendingReadiness: true });
      await assertBackupSafeForLifecycle(id);
    }
    return operation();
  });
  const acknowledgeReadiness = async (id) => {
    const instance = await store.get(id);
    const transactionId = instance?.updateStatus?.state === 'pending-unverified'
      ? instance.updateStatus.transactionId
      : null;
    if (transactionId && updater) {
      const result = await updater.markReady({ instanceId: id, transactionId });
      if (result?.transaction?.phase === 'ready' && result?.instance?.updateStatus?.state === 'verified'
        && Array.isArray(updateRecovery)) {
        updateRecovery = updateRecovery.map((item) => (
          item?.instanceId === id && item?.action === 'awaiting-readiness'
            ? { ...item, phase: 'ready', action: 'readiness-verified' }
            : item
        ));
      }
    }
  };
  const processes = options.processes ?? new ProcessManager(
    store,
    logs,
    config.javaExecutable,
    options.commandFactory,
    {
      onReady: acknowledgeReadiness,
      readinessStabilityMs: options.readinessStabilityMs ?? 5_000,
      defaultInstallVerifier: async (instance, verificationOptions) => {
        await removeManagedFabricRuntimeCache(managedRoot, instance);
        return verifyFamilyServerInstall(instance, {
          ...verificationOptions,
          windowsModDiscoveryPolicy: 'authenticated-local-home',
        });
      },
      ...(typeof options.verifyInstall === 'function' ? { verifyInstall: options.verifyInstall } : {}),
      ...(typeof options.inspectProcessState === 'function' ? { inspectProcessState: options.inspectProcessState } : {}),
      ...(Number.isInteger(options.portReleasePollMs) ? { portReleasePollMs: options.portReleasePollMs } : {}),
    },
  );
  const processRecovery = options.processRecovery ?? (
    typeof processes.reconcilePersistedState === 'function' ? await processes.reconcilePersistedState() : []
  );
  const provisioner = options.provisioner ?? new ServerProvisioner(managedRoot, store, options.fetcher ?? fetch, {
    runtimeOptions: { preferredExecutable: config.javaExecutable },
  });
  const mods = options.mods ?? new FamilyModManager(managedRoot, store, new ModrinthClient(options.modrinthFetcher ?? options.fetcher ?? fetch), {
    withInstanceLock: withStrictUpdateLifecycleLock,
    assertQuiescentWithinInstanceLock: (id) => {
      if (typeof processes.assertQuiescentWithinInstanceLock !== 'function') throw Object.assign(new Error('The exact mod lifecycle boundary is unavailable.'), { code: 'MOD_STATE_UNAVAILABLE', statusCode: 503 });
      return processes.assertQuiescentWithinInstanceLock(id);
    },
  });
  const firstPartyCore = options.firstPartyCore ?? new FamilyCoreArtifactManager(managedRoot, store, {
    withInstanceLock: withStrictUpdateLifecycleLock,
    assertQuiescentWithinInstanceLock: (id) => {
      if (typeof processes.assertQuiescentWithinInstanceLock !== 'function') {
        throw Object.assign(new Error('The exact first-party core lifecycle boundary is unavailable.'), {
          code: 'FAMILY_CORE_STATE_UNAVAILABLE', statusCode: 503,
        });
      }
      return processes.assertQuiescentWithinInstanceLock(id);
    },
    assertVerifiedBackupWithinInstanceLock: (id, backupId) => {
      if (typeof backups?.assertVerifiedSnapshotWithinInstanceLock !== 'function') {
        throw Object.assign(new Error('The verified Family Server snapshot boundary is unavailable.'), {
          code: 'FAMILY_CORE_BACKUP_REQUIRED', statusCode: 503,
        });
      }
      return backups.assertVerifiedSnapshotWithinInstanceLock(id, backupId);
    },
  });
  if (typeof firstPartyCore.initialize === 'function') await firstPartyCore.initialize();
  if (typeof mods.setLifecycleLock === 'function') mods.setLifecycleLock(withStrictUpdateLifecycleLock);
  if (typeof processes.setLaunchModBindingProvider === 'function') {
    processes.setLaunchModBindingProvider((instanceId) => {
      if (typeof mods.acquireLaunchBindingWithinInstanceLock !== 'function') {
        throw Object.assign(new Error('The authenticated mod launch binding is unavailable.'), {
          code: 'LAUNCH_TRUST_UNAVAILABLE', statusCode: 503,
        });
      }
      return mods.acquireLaunchBindingWithinInstanceLock(instanceId);
    });
  }
  if (typeof processes.setFirstPartyCoreLaunchBindingProvider === 'function') {
    processes.setFirstPartyCoreLaunchBindingProvider((instanceId) => {
      if (typeof firstPartyCore.acquireLaunchBindingWithinInstanceLock !== 'function') {
        throw Object.assign(new Error('The authenticated first-party core launch binding is unavailable.'), {
          code: 'LAUNCH_TRUST_UNAVAILABLE', statusCode: 503,
        });
      }
      return firstPartyCore.acquireLaunchBindingWithinInstanceLock(instanceId);
    });
  }
  let modRecovery = options.modRecovery ?? null;
  const currentWorldStackBindingWithinInstanceLock = async (instanceOrId, errorCode = 'WORLD_STATE_UNAVAILABLE') => {
    if (typeof mods.stackBindingWithinInstanceLock !== 'function') {
      throw Object.assign(new Error('The managed world and mod stack binding is unavailable.'), { code: errorCode, statusCode: 503 });
    }
    const instance = typeof instanceOrId === 'string' ? await store.get(instanceOrId) : instanceOrId;
    const stack = await mods.stackBindingWithinInstanceLock(instance.id);
    return composeWorldStackBinding(instance, stack, errorCode);
  };
  updater = options.updater ?? new FamilyServerUpdateManager(managedRoot, store, {
    resolveTarget: (instance) => provisioner.resolveUpdateTarget(instance),
    prepareCandidate: (input) => provisioner.prepareUpdateCandidate(input),
    isInstanceActive: (id) => processes.isActive(id),
    withInstanceLock: (id, operation) => processes.withInstanceLock(id, operation),
    assertQuiescentWithinInstanceLock: async (id) => {
      if (typeof processes.assertQuiescentWithinInstanceLock !== 'function') {
        throw Object.assign(new Error('The exact update lifecycle boundary is unavailable.'), {
          code: 'UPDATE_RECOVERY_REQUIRED', statusCode: 409,
        });
      }
      await processes.assertQuiescentWithinInstanceLock(id);
      return true;
    },
    assertStackUpdateAllowedWithinInstanceLock: (id, target) => mods.assertStackUpdateAllowedWithinInstanceLock(id, target),
  });
  let updateRecovery = options.updateRecovery ?? [];
  const backups = options.backups ?? new FamilyServerBackupManager(managedRoot, store, {
    withInstanceLock: withStrictUpdateLifecycleLock,
    assertQuiescentWithinInstanceLock: (id) => {
      if (typeof processes.assertQuiescentWithinInstanceLock !== 'function') {
        throw Object.assign(new Error('The process manager does not expose the exact backup quiescence boundary'), {
          code: 'BACKUP_UNAVAILABLE', statusCode: 503,
        });
      }
      return processes.assertQuiescentWithinInstanceLock(id);
    },
    verifyInstall: options.verifyBackupInstall ?? verifyFamilyServerInstall,
    currentWorldStackBindingWithinInstanceLock: (id) => currentWorldStackBindingWithinInstanceLock(id, 'BACKUP_STACK_UNAVAILABLE'),
  });
  let backupRecovery = options.backupRecovery ?? null;
  let backupInitializationFailure = null;
  const administration = options.administration ?? new FamilyServerAdminManager(managedRoot, store, processes, {
    ...(typeof options.adminNow === 'function' ? { now: options.adminNow } : {}),
    ...(Number.isInteger(options.adminPlanTtlMs) ? { planTtlMs: options.adminPlanTtlMs } : {}),
  });
  if (typeof administration.initialize === 'function') await administration.initialize();
  let manualBackupRecovery = [];
  const assertBackupSafeForLifecycle = async (instanceId) => {
    if (typeof backups.assertSafeForLifecycle === 'function') {
      await backups.assertSafeForLifecycle({ instanceId });
      return;
    }
    const blocked = manualBackupRecovery.some((item) => (
      !validateInstanceId(item?.instanceId) || item.instanceId === instanceId
    ));
    if (blocked) {
      throw Object.assign(new Error('A prior Family Server restore requires manual recovery before lifecycle changes can continue.'), {
        statusCode: 409,
        code: 'BACKUP_MANUAL_RECOVERY_REQUIRED',
      });
    }
  };
  const lanStatus = options.lanStatus ?? getLanStatus;
  const lanFirewall = options.lanFirewall ?? runLanFirewallAction;
  const lanFirewallScript = options.lanFirewallScript
    ?? fileURLToPath(new URL('../../../scripts/configure-family-server-lan.ps1', import.meta.url));
  const supervisorId = options.supervisorId ?? process.env.MASTERMIND_LOCAL_SUPERVISOR_ID;
  const familyServerInstanceId = options.familyServerInstanceId ?? 'family-server';
  if (!validateInstanceId(familyServerInstanceId)) throw new TypeError('The trusted Family Server instance id is invalid');
  const familyCoreCredentials = options.familyCoreCredentials ?? new FamilyCoreCredentialManager(managedRoot, {
    ...(pinnedLaunchIntegrityKey ? { integrityKey: pinnedLaunchIntegrityKey } : {}),
  });
  if (typeof familyCoreCredentials.initialize !== 'function' || typeof familyCoreCredentials.reconcile !== 'function'
    || typeof familyCoreCredentials.prepareLaunch !== 'function' || typeof familyCoreCredentials.authenticate !== 'function'
    || typeof familyCoreCredentials.verifyHello !== 'function' || typeof familyCoreCredentials.status !== 'function') {
    throw new TypeError('The Family Core credential manager is invalid');
  }
  await familyCoreCredentials.initialize();
  const familyCoreIdentities = options.familyCoreIdentities ?? new FamilyCoreIdentityRegistry(managedRoot, {
    integrityKey: pinnedLaunchIntegrityKey,
  });
  if (typeof familyCoreIdentities.initialize !== 'function' || typeof familyCoreIdentities.bind !== 'function'
    || typeof familyCoreIdentities.resolvePlayer !== 'function'
    || typeof familyCoreIdentities.status !== 'function') {
    throw new TypeError('The Family Core identity registry is invalid');
  }
  await familyCoreIdentities.initialize();
  const credentialInstance = await store.get(familyServerInstanceId);
  if (credentialInstance) {
    const active = typeof processes.isActive === 'function'
      ? await processes.isActive(familyServerInstanceId)
      : false;
    await familyCoreCredentials.reconcile(credentialInstance, { active });
  }
  if (typeof processes.setRuntimeCredentialProvider === 'function') {
    processes.setRuntimeCredentialProvider(async (instance) => {
      if (instance?.id !== familyServerInstanceId) return null;
      const core = await firstPartyCore.status(familyServerInstanceId);
      if (core?.state !== 'installed' || core.artifact?.version !== '0.4.0'
        || core.artifact?.sha256 !== FAMILY_CORE_BRIDGE_SHA256) return null;
      return familyCoreCredentials.prepareLaunch(instance, {
        computerCommandEnabled: FAMILY_CORE_DETERMINISTIC_COMPUTER_COMMAND_ENABLED,
        identityEventsEnabled: FAMILY_CORE_IDENTITY_EVENTS_ENABLED,
      });
    });
  }
  const modrinthSeed = process.env.APPDATA ? path.join(process.env.APPDATA, 'ModrinthApp', 'meta') : null;
  const seedCacheRoots = [];
  if (modrinthSeed) {
    try {
      const stat = await fs.lstat(modrinthSeed);
      if (stat.isDirectory() && !stat.isSymbolicLink()) seedCacheRoots.push(modrinthSeed);
    } catch { /* Modrinth is an optional read-only verified seed. */ }
  }
  const clientProvisioner = options.clientProvisioner ?? new FamilyClientProvisioner(managedRoot, {
    fetcher: options.fetcher ?? fetch,
    runtimeOptions: { preferredExecutable: config.javaExecutable },
    seedCacheRoots,
  });
  let clientStatusCache = null;
  let clientStatusInFlight = null;
  let clientStatusGeneration = 0;
  const invalidateClientStatus = () => {
    clientStatusGeneration += 1;
    clientStatusCache = null;
    clientStatusInFlight = null;
  };
  const readClientStatus = async () => {
    const now = Date.now();
    if (clientStatusCache !== null && clientStatusCache.expiresAt > now) return clientStatusCache.status;
    if (clientStatusInFlight !== null) return clientStatusInFlight.promise;
    const generation = clientStatusGeneration;
    const promise = Promise.resolve().then(() => clientProvisioner.status());
    const current = { generation, promise };
    clientStatusInFlight = current;
    try {
      const status = await promise;
      if (clientStatusGeneration === generation) {
        clientStatusCache = { status, expiresAt: Date.now() + CLIENT_STATUS_CACHE_TTL_MS };
      }
      return status;
    } finally {
      if (clientStatusInFlight === current) clientStatusInFlight = null;
    }
  };
  const accountVault = options.accountVault ?? new DpapiMinecraftAccountVault({
    vaultFile: path.join(managedRoot, 'private', 'minecraft-account.dpapi.json'),
  });
  const accountRegistration = options.accountRegistration ?? new MinecraftAccountRegistrationStore(
    path.join(managedRoot, 'private', 'minecraft-account-registration.json'),
  );
  let accountConfig = options.accountConfig ?? await accountRegistration.load();
  const authFactory = options.authFactory ?? ((config) => new MicrosoftMinecraftAuth({ config, vault: accountVault }));
  let minecraftAuth = options.minecraftAuth ?? authFactory(accountConfig);
  await minecraftAuth.initialize();
  let accountOperationQueue = Promise.resolve();
  const withAccountLock = (operation) => {
    const current = accountOperationQueue.catch(() => undefined).then(operation);
    accountOperationQueue = current;
    return current;
  };
  const suppliedLaunchFactory = options.trustedCompanionLaunchFactory ?? null;
  let trustedCompanionLaunchFactory = suppliedLaunchFactory;
  trustedCompanionLaunchFactory ??= createManagedClientLaunchFactory({
    provisioner: clientProvisioner,
    getAuth: () => minecraftAuth,
    familyServerInstanceId,
  });
  if (
    !trustedCompanionLaunchFactory || typeof trustedCompanionLaunchFactory.create !== 'function'
    || !validateInstanceId(trustedCompanionLaunchFactory.familyServerInstanceId)
  ) throw new TypeError('The trusted companion launch factory is invalid');
  let companionLifecycle = options.companionLifecycle ?? null;
  const companionSessions = options.companionSessions ?? new CompanionSessionManager({
    verifyHello: (payload, context) => companionLifecycle.verifyHello(payload, context),
  });
  const familyCoreSessions = options.familyCoreSessions ?? new FamilyCoreSessionManager({
    verifyHello: options.verifyFamilyCoreHello ?? (async (payload, context) => {
      const instance = await store.get(familyServerInstanceId);
      return instance !== null
        && familyCoreCredentials.verifyHello(payload, context)
        && payload.serverId === familyServerInstanceId
        && payload.modVersion === '0.4.0'
        && payload.minecraftVersion === instance.minecraftVersion
        && (
          payload.commandEnabled === false && payload.capabilities.length === 1
            && payload.capabilities[0] === 'identity.events'
          || payload.commandEnabled === true
            && payload.capabilities.length === 2
            && payload.capabilities[0] === 'computer.request'
            && payload.capabilities[1] === 'identity.events'
        );
    }),
    resolvePlayer: (player) => familyCoreIdentities.resolvePlayer(player),
    ...(typeof options.onComputerRequest === 'function' ? { onComputerRequest: options.onComputerRequest } : {}),
  });
  if (!companionLifecycle) {
    companionLifecycle = new CompanionLifecycleManager({
      stateFile: path.join(managedRoot, 'private', 'companion-lifecycle.json'),
      bridgeControl: companionSessions,
      ...(typeof options.inspectCompanionProcessState === 'function'
        ? { inspectProcessState: options.inspectCompanionProcessState }
        : {}),
    });
  }
  if (typeof companionLifecycle.initialize !== 'function') {
    throw new TypeError('The companion lifecycle manager must expose initialize()');
  }
  await companionLifecycle.initialize();
  const worlds = options.worlds ?? new FamilyWorldManager(managedRoot, store, {
    withInstanceLock: withStrictUpdateLifecycleLock,
    assertQuiescentWithinInstanceLock: (id) => processes.assertQuiescentWithinInstanceLock(id),
    createRescueWithinInstanceLock: (id) => {
      if (typeof backups.createRescueWithinInstanceLock !== 'function') {
        throw Object.assign(new Error('The verified world rescue boundary is unavailable.'), { code: 'WORLD_SNAPSHOT_FAILED', statusCode: 503 });
      }
      return backups.createRescueWithinInstanceLock(id);
    },
    assertCompanionInactiveWithinInstanceLock: async () => {
      if (companionLifecycleIsActive(companionLifecycle)) {
        throw Object.assign(new Error('Stop the managed Family AI client before changing worlds.'), { code: 'WORLD_COMPANION_NOT_QUIESCENT', statusCode: 409 });
      }
      return true;
    },
    verifyInstall: options.verifyWorldInstall ?? (async (instance) => {
      await removeManagedFabricRuntimeCache(managedRoot, instance);
      return verifyFamilyServerInstall(instance);
    }),
    currentStackBindingWithinInstanceLock: (instance) => currentWorldStackBindingWithinInstanceLock(instance),
    assertLifecycleMutationAllowedWithinInstanceLock: async (id) => {
      if (!updateLifecycleFencesReady || typeof updater?.assertSafeForLifecycle !== 'function') {
        throw Object.assign(new Error('The authenticated update recovery fence is unavailable.'), {
          code: 'UPDATE_RECOVERY_REQUIRED', statusCode: 409,
        });
      }
      await updater.assertSafeForLifecycle(id);
      await assertBackupSafeForLifecycle(id);
      if (typeof mods.assertSafeForLifecycle !== 'function') {
        throw Object.assign(new Error('The managed mod recovery boundary is unavailable.'), {
          code: 'WORLD_STATE_UNAVAILABLE', statusCode: 503,
        });
      }
      await mods.assertSafeForLifecycle({ instanceId: id });
      return true;
    },
    ...(typeof options.worldNow === 'function' ? { now: options.worldNow } : {}),
  });
  if (typeof worlds.prepareRestoreValidation === 'function') await worlds.prepareRestoreValidation();
  if (typeof mods.prepareStackValidation === 'function') await mods.prepareStackValidation();
  if (typeof backups.setWorldInterlock === 'function') backups.setWorldInterlock((id) => worlds.assertMutationAllowedWithinInstanceLock(id));
  if (typeof backups.setWorldRestoreValidator === 'function') {
    backups.setWorldRestoreValidator((id, binding, validationOptions) => {
      if (typeof worlds.validateRestoredStateWithinInstanceLock !== 'function') {
        throw Object.assign(new Error('The authenticated world restore validator is unavailable.'), { code: 'BACKUP_WORLD_VALIDATOR_UNAVAILABLE', statusCode: 503 });
      }
      return worlds.validateRestoredStateWithinInstanceLock(id, binding, validationOptions);
    });
  }
  if (typeof mods.setWorldInterlock === 'function') {
    mods.setWorldInterlock(async (id) => {
      try {
        if (typeof worlds.assertModMutationAllowedWithinInstanceLock !== 'function') {
          throw Object.assign(new Error('The managed world safety boundary is unavailable.'), { code: 'MOD_STATE_UNAVAILABLE', statusCode: 503 });
        }
        return await worlds.assertModMutationAllowedWithinInstanceLock(id);
      } catch (error) {
        if (error?.code === 'WORLDS_BLOCK_MOD_MUTATION') {
          throw Object.assign(new Error('Stored Family Server worlds block this managed mod change.'), {
            code: 'MOD_WORLD_STATE_BLOCKED', statusCode: 409,
          });
        }
        throw error;
      }
    });
  }
  const assertManagedLifecycleSafeWithinInstanceLock = async (instanceId) => {
    if (!updateLifecycleFencesReady || typeof updater?.assertSafeForLifecycle !== 'function') {
      throw Object.assign(new Error('The authenticated update recovery fence is unavailable.'), {
        code: 'UPDATE_RECOVERY_REQUIRED', statusCode: 409,
      });
    }
    await updater.assertSafeForLifecycle(instanceId);
    await assertBackupSafeForLifecycle(instanceId);
    if (instanceId !== familyServerInstanceId) return true;
    if (typeof mods.assertSafeForLifecycle !== 'function') {
      throw Object.assign(new Error('The authenticated mod recovery fence is unavailable.'), {
        code: 'MOD_MANUAL_RECOVERY_REQUIRED', statusCode: 409,
      });
    }
    await mods.assertSafeForLifecycle({ instanceId });
    if (typeof firstPartyCore.assertSafeForLifecycleWithinInstanceLock !== 'function') {
      throw Object.assign(new Error('The authenticated first-party core recovery fence is unavailable.'), {
        code: 'FAMILY_CORE_STATE_UNAVAILABLE', statusCode: 503,
      });
    }
    await firstPartyCore.assertSafeForLifecycleWithinInstanceLock(instanceId);
    if (typeof worlds.assertSafeForLifecycle !== 'function') {
      throw Object.assign(new Error('The authenticated world recovery fence is unavailable.'), {
        code: 'WORLD_RECOVERY_REQUIRED', statusCode: 409,
      });
    }
    await worlds.assertSafeForLifecycle({ instanceId });
    return true;
  };
  const combinedStackInterlock = async (id, target) => {
    await mods.assertStackUpdateAllowedWithinInstanceLock(id);
    await worlds.assertStackUpdateAllowedWithinInstanceLock(id, target);
  };
  if (typeof updater.setStackInterlock === 'function') updater.setStackInterlock(combinedStackInterlock);
  else if (typeof updater.setModInterlock === 'function') updater.setModInterlock(combinedStackInterlock);
  let recoveryPreflight = [];
  let recoveryPreflightFence = false;
  const recoveryManagers = [
    ['backup', backups], ['mods', mods], ['world', worlds], ['update', updater],
  ];
  const collectRecoveryPreflight = async () => {
    const collected = [];
    for (const [expectedDomain, manager] of recoveryManagers) {
      if (typeof manager?.preflightRecoveryEvidence !== 'function') {
        throw Object.assign(new Error('A required managed recovery preflight is unavailable.'), {
          code: 'CONTROL_RECOVERY_REQUIRED', statusCode: 409,
        });
      }
      const evidence = validateRecoveryPreflight(await manager.preflightRecoveryEvidence());
      if (evidence.domain !== expectedDomain) {
        throw Object.assign(new Error('Managed recovery preflight returned the wrong domain.'), {
          code: 'CONTROL_RECOVERY_REQUIRED', statusCode: 409,
        });
      }
      collected.push(evidence);
    }
    const domainsByInstance = new Map();
    for (const evidence of collected) {
      for (const item of evidence.instances) {
        const domains = domainsByInstance.get(item.instanceId) ?? new Set();
        domains.add(evidence.domain); domainsByInstance.set(item.instanceId, domains);
      }
    }
    const activeDomains = new Set(collected.filter((item) => item.instances.length > 0).map((item) => item.domain));
    if (activeDomains.size > 1 || [...domainsByInstance.values()].some((domains) => domains.size > 1)) {
      throw Object.assign(new Error('Multiple managed recovery domains are unfinished.'), {
        code: 'CONTROL_RECOVERY_REQUIRED', statusCode: 409,
      });
    }
    return collected;
  };
  try {
    recoveryPreflight = await collectRecoveryPreflight();
  } catch {
    recoveryPreflightFence = true;
  }
  const initialRecoveryEvidencePresent = recoveryPreflight.some((item) => item.instances.length > 0);
  if (legacyMigration === null) {
    if (recoveryPreflightFence || initialRecoveryEvidencePresent) {
      legacyMigration = { state: 'deferred-managed-recovery', candidateCount: 0 };
    } else {
      legacyMigration = await prepareLegacyMigration({
        dataRoot: config.dataRoot,
        managedRoot,
        store,
        discover: options.discoverLegacy ?? discoverLegacyFamilyInstances,
        importer: options.importLegacy ?? importLegacyFamilyInstance,
        isLegacyActive: options.isLegacyActive ?? (({ serverPort }) => isTcpPortOccupied(serverPort)),
      });
    }
  }
  const initialActiveDomain = recoveryPreflight.find((item) => item.instances.length > 0)?.domain ?? null;
  if (recoveryPreflightFence) {
    backupRecovery = [{ action: 'manual-recovery-required', code: 'CONTROL_RECOVERY_REQUIRED' }];
  } else if (backupRecovery === null) {
    try {
      backupRecovery = typeof backups.initialize === 'function' ? await backups.initialize() : [];
    } catch (error) {
      backupInitializationFailure = publicBackupInitializationFailure(error);
      console.error(formatBackupInitializationDiagnostic(error));
      backupRecovery = [{ action: 'manual-recovery-required', code: 'BACKUP_MANUAL_RECOVERY_REQUIRED' }];
    }
  }
  manualBackupRecovery = Array.isArray(backupRecovery)
    ? backupRecovery.filter((item) => item?.action === 'manual-recovery-required')
    : [];
  let liveBackupRecovery = null;
  try {
    liveBackupRecovery = typeof backups.recoveryStatus === 'function' ? backups.recoveryStatus() : null;
  } catch {
    liveBackupRecovery = { manualRecoveryRequired: 1, global: true, instanceIds: [] };
  }
  let globalRecoveryFence = recoveryPreflightFence || manualBackupRecovery.length > 0 || liveBackupRecovery?.global === true
    || (Number.isSafeInteger(liveBackupRecovery?.manualRecoveryRequired) && liveBackupRecovery.manualRecoveryRequired > 0);
  let globalRecoveryFenceCode = recoveryPreflightFence ? 'CONTROL_RECOVERY_REQUIRED' : 'BACKUP_MANUAL_RECOVERY_REQUIRED';
  let worldRecovery = options.worldRecovery ?? null;
  const manualResult = (value) => Array.isArray(value) && value.some((item) => (
    item?.action === 'manual-recovery-required' || item?.state === 'manual-recovery-required'
  ));
  const fenceDomain = (domain) => {
    globalRecoveryFence = true;
    globalRecoveryFenceCode = domain === 'mods' ? 'MOD_MANUAL_RECOVERY_REQUIRED'
      : domain === 'world' ? 'WORLD_RECOVERY_REQUIRED'
        : domain === 'update' ? 'UPDATE_RECOVERY_REQUIRED'
          : 'CONTROL_RECOVERY_REQUIRED';
  };
  const latchManagedRecoveryError = (error, fallbackDomain = null) => {
    if (GLOBAL_RECOVERY_MESSAGES.has(error?.code)) {
      globalRecoveryFence = true;
      globalRecoveryFenceCode = error.code;
      return true;
    }
    if (error?.code === 'MOD_COMPLETION_UNKNOWN') {
      fenceDomain('mods');
      return true;
    }
    if (fallbackDomain !== null) {
      fenceDomain(fallbackDomain);
      return true;
    }
    return false;
  };
  const latchLiveBackupRecoveryFence = async () => {
    if (globalRecoveryFence) return true;
    if (typeof backups.recoveryStatus !== 'function') return false;
    let status;
    try {
      status = await backups.recoveryStatus();
    } catch {
      globalRecoveryFence = true;
      globalRecoveryFenceCode = 'CONTROL_RECOVERY_REQUIRED';
      return true;
    }
    const manualCount = Number.isSafeInteger(status?.manualRecoveryRequired)
      ? status.manualRecoveryRequired
      : 0;
    const globalCount = Number.isSafeInteger(status?.globalRecoveryRequired)
      ? status.globalRecoveryRequired
      : 0;
    if (status?.global === true || status?.globalRecoveryRequired === true || manualCount > 0 || globalCount > 0
      || (Array.isArray(status?.instanceIds) && status.instanceIds.length > 0)) {
      globalRecoveryFence = true;
      globalRecoveryFenceCode = 'BACKUP_MANUAL_RECOVERY_REQUIRED';
      return true;
    }
    return false;
  };
  const verifyRecoveryCleared = async (domain, recoveryResult = []) => {
    try {
      const checked = await collectRecoveryPreflight();
      const remaining = checked.filter((item) => item.instances.length > 0).map((item) => item.domain);
      if (remaining.length > 0) {
        if (domain === 'update' && remaining.length === 1 && remaining[0] === 'update') {
          const pendingEvidence = checked.find((item) => item.domain === 'update')?.instances ?? [];
          const reconciledPendingIds = Array.isArray(recoveryResult)
            ? recoveryResult
              .filter((item) => item?.action === 'awaiting-readiness' && validateInstanceId(item?.instanceId))
              .map((item) => item.instanceId)
              .sort()
            : [];
          const evidenceIds = pendingEvidence.map((item) => item.instanceId).sort();
          if (canonicalJson(evidenceIds) === canonicalJson(reconciledPendingIds)
            && evidenceIds.length > 0 && typeof updater.assertSafeForLifecycle === 'function') {
            for (const instanceId of evidenceIds) {
              await updater.assertSafeForLifecycle(instanceId, { allowPendingReadiness: true });
            }
            recoveryPreflight = checked;
            return true;
          }
        }
        if (remaining.length === 1 && remaining[0] === domain) fenceDomain(domain);
        else {
          globalRecoveryFence = true;
          globalRecoveryFenceCode = 'CONTROL_RECOVERY_REQUIRED';
        }
        return false;
      }
      recoveryPreflight = checked;
      return true;
    } catch {
      globalRecoveryFence = true;
      globalRecoveryFenceCode = 'CONTROL_RECOVERY_REQUIRED';
      return false;
    }
  };
  const initializeDomain = async (domain) => {
    try {
      let result;
      if (domain === 'mods') {
        if (modRecovery !== null) return modRecovery;
        result = typeof mods.initialize === 'function' ? await mods.initialize() : [];
        modRecovery = result;
      } else if (domain === 'world') {
        if (worldRecovery !== null) return worldRecovery;
        result = typeof worlds.initialize === 'function' ? await worlds.initialize() : [];
        worldRecovery = result;
      } else {
        if (options.updateRecovery !== undefined && options.updateRecovery !== null) return updateRecovery;
        result = await updater.reconcileInterruptedTransactions();
        updateRecovery = result;
        updateLifecycleFencesReady = !manualResult(result);
      }
      if (manualResult(result)) fenceDomain(domain);
      return result;
    } catch (error) {
      if (domain === 'world') console.warn(formatWorldInitializationFailureDiagnostic(error));
      fenceDomain(domain);
      const deferred = [{ instanceId: familyServerInstanceId, action: 'manual-recovery-required' }];
      if (domain === 'mods') modRecovery = deferred;
      else if (domain === 'world') worldRecovery = deferred;
      else updateRecovery = deferred;
      return deferred;
    }
  };
  if (globalRecoveryFence) {
    if (modRecovery === null) modRecovery = [{ instanceId: familyServerInstanceId, action: 'deferred-backup-recovery' }];
    worldRecovery ??= [{ instanceId: familyServerInstanceId, action: 'deferred-backup-recovery' }];
    if (!options.updateRecovery) updateRecovery = [{ instanceId: familyServerInstanceId, action: 'deferred-backup-recovery' }];
  } else {
    let activeDomain = initialActiveDomain;
    if (activeDomain === 'backup') {
      if (!await verifyRecoveryCleared('backup')) activeDomain = null;
      else activeDomain = recoveryPreflight.find((item) => item.instances.length > 0)?.domain ?? null;
    }
    if (!globalRecoveryFence && options.updateRecovery !== undefined && options.updateRecovery !== null) {
      updateLifecycleFencesReady = !manualResult(updateRecovery);
      if (!updateLifecycleFencesReady) fenceDomain('update');
    }
    const initializationOrder = activeDomain === 'update'
      ? ['update', 'mods', 'world']
      : activeDomain === 'world'
        ? ['update', 'world', 'mods']
        : activeDomain === 'mods'
          ? ['mods', 'update', 'world']
          : ['mods', 'world', 'update'];
    for (const domain of initializationOrder) {
      if (globalRecoveryFence) break;
      const initializedRecovery = await initializeDomain(domain);
      if (!globalRecoveryFence && domain === activeDomain) await verifyRecoveryCleared(domain, initializedRecovery);
    }
    if (globalRecoveryFence) {
      if (modRecovery === null) modRecovery = [{ instanceId: familyServerInstanceId, action: 'deferred-managed-recovery' }];
      worldRecovery ??= [{ instanceId: familyServerInstanceId, action: 'deferred-managed-recovery' }];
      if (options.updateRecovery === undefined || options.updateRecovery === null) {
        if (!Array.isArray(updateRecovery) || updateRecovery.length === 0) {
          updateRecovery = [{ instanceId: familyServerInstanceId, action: 'deferred-managed-recovery' }];
        }
      }
    } else {
      updateLifecycleFencesReady = true;
      managedLifecycleFencesReady = true;
    }
  }
  let domainEventOutbox = null;
  let companionDomainEvents = null;
  if (!globalRecoveryFence && memoryEventPlayerId !== null) {
    const candidateOutbox = options.domainEventOutbox ?? new FileMastermindEventOutbox(
      path.join(managedRoot, 'private', 'shared-memory', 'outbox', 'v1'),
    );
    try {
      if (typeof candidateOutbox.initialize === 'function') await candidateOutbox.initialize();
      if (typeof candidateOutbox.enqueue !== 'function') throw new TypeError('The domain event outbox must expose enqueue()');
      if (typeof candidateOutbox.assertNoUnboundCompanionEvents !== 'function') {
        throw new TypeError('The domain event outbox must expose assertNoUnboundCompanionEvents()');
      }
      await candidateOutbox.assertNoUnboundCompanionEvents();
      domainEventOutbox = candidateOutbox;
      companionDomainEvents = attachCompanionDomainEventProducer(companionSessions, domainEventOutbox, {
        householdId: options.householdId ?? 'family-local',
        playerId: memoryEventPlayerId,
        onError: (error) => {
          const code = typeof error?.code === 'string' && /^[A-Z0-9_]{3,64}$/.test(error.code)
            ? error.code
            : 'EVENT_OUTBOX_WRITE_FAILED';
          console.warn(`Mastermind companion memory event capture failed safely (${code}).`);
        },
      });
    } catch (error) {
      const code = typeof error?.code === 'string' && /^[A-Z0-9_]{3,64}$/.test(error.code)
        ? error.code
        : 'EVENT_OUTBOX_UNAVAILABLE';
      console.warn(`Mastermind companion memory event capture is unavailable (${code}).`);
    }
  }
  let memoryEventConsumer = null;
  let memoryEventSync = null;
  const reportMemoryEventSyncFailure = (error, context = {}) => {
    const candidateCode = context.code ?? error?.code;
    const code = typeof candidateCode === 'string'
      && /^[A-Z0-9_]{3,64}$/.test(candidateCode)
      ? candidateCode
      : 'MEMORY_EVENT_SYNC_FAILED';
    console.warn(`Mastermind memory event sync deferred safely (${code}).`);
  };
  if (config.memoryEventSyncEnabled === true && domainEventOutbox) {
    try {
      if (options.memoryEventSync) {
        memoryEventSync = options.memoryEventSync;
      } else {
        memoryEventConsumer = options.memoryEventConsumer ?? new MastermindMemoryApiConsumer({
          token: config.token,
          fetcher: options.memoryEventFetcher ?? fetch,
          ...(Number.isInteger(options.memoryEventRequestTimeoutMs)
            ? { timeoutMs: options.memoryEventRequestTimeoutMs }
            : {}),
        });
        memoryEventSync = new MastermindMemoryEventSyncController({
          outbox: domainEventOutbox,
          consumer: memoryEventConsumer,
          onError: reportMemoryEventSyncFailure,
          ...(Number.isInteger(options.memoryEventSyncIntervalMs)
            ? { intervalMs: options.memoryEventSyncIntervalMs }
            : {}),
          ...(Number.isInteger(options.memoryEventSyncBatchLimit)
            ? { batchLimit: options.memoryEventSyncBatchLimit }
            : {}),
        });
      }
      if (typeof memoryEventSync.start !== 'function' || typeof memoryEventSync.finalDrain !== 'function'
        || typeof memoryEventSync.close !== 'function') {
        throw new TypeError('The memory event sync controller must expose start(), finalDrain(), and close()');
      }
      Promise.resolve(memoryEventSync.start()).catch((error) => reportMemoryEventSyncFailure(error, { reason: 'startup' }));
    } catch (error) {
      reportMemoryEventSyncFailure(error, { reason: 'startup' });
      memoryEventConsumer = null;
      memoryEventSync = null;
    }
  }
  let draining = false;
  let managedLifecycleRuns = 0;
  let backupRunInFlight = null;

  const withManagedLifecycleRun = async (operation) => {
    if (typeof operation !== 'function') throw new TypeError('Managed lifecycle operation must be a function');
    managedLifecycleRuns += 1;
    try {
      // Close a scheduler scan that won the race immediately before lifecycle
      // admission. Incrementing first prevents another timer tick from taking
      // its place while the exact prior run drains.
      if (backupRunInFlight) await backupRunInFlight;
      return await operation();
    }
    finally { managedLifecycleRuns -= 1; }
  };

  const startManagedInstanceWithinLock = async (id, { ensureRunning = false } = {}) => (
    withManagedLifecycleRun(() => processes.withInstanceLock(id, async () => {
      if (ensureRunning) {
        const current = await store.get(id);
        if (!current) {
          throw Object.assign(new Error('Instance was not found.'), {
            statusCode: 404,
            code: 'INSTANCE_NOT_FOUND',
          });
        }
        // The ordinary Start operation deliberately replaces a running child.
        // The hosted node capability is an ensure operation instead: inspect
        // under the same lifecycle lock and do no updater, filesystem, or
        // process work when any live server state is already present.
        if (await processes.isActive(id)) {
          return { action: 'already-running', instance: current };
        }
      }
      if (typeof updater.assertSafeForLifecycle === 'function') {
        await updater.assertSafeForLifecycle(id, { allowPendingReadiness: true });
      }
      await assertBackupSafeForLifecycle(id);
      if (id === familyServerInstanceId && typeof mods.assertStartAllowedWithinInstanceLock === 'function') {
        await mods.assertStartAllowedWithinInstanceLock(id);
      }
      const plan = await updater.check({ instanceId: id });
      if (plan.requiresApproval || ['minecraft-update-approval-required', 'blocked-downgrade', 'blocked-unknown-order'].includes(plan.state)) {
        throw Object.assign(new Error('This server requires an approved Minecraft version migration before it can start.'), {
          statusCode: 409,
          code: 'UPDATE_APPROVAL_REQUIRED',
        });
      }
      if (plan.state === 'component-update-available') {
        if (typeof updater.updateWithinInstanceLock !== 'function') {
          throw new Error('The component updater does not share the process lifecycle lock');
        }
        const result = await updater.updateWithinInstanceLock({ instanceId: id });
        if (!['updated', 'current'].includes(result?.action)) {
          throw new Error('The automatic component update did not reach a startable state');
        }
      }
      if (id === familyServerInstanceId) await worlds.assertMutationAllowedWithinInstanceLock(id);
      if (typeof processes.startWithinInstanceLock !== 'function') {
        throw new Error('The process manager does not expose its locked start boundary');
      }
      return { action: 'started', instance: await processes.startWithinInstanceLock(id) };
    }, { priority: 'lifecycle' }))
  );

  const server = http.createServer(async (request, response) => {
    let backupRouteContext = false;
    let adminRouteContext = false;
    let modRouteContext = false;
    let firstPartyCoreRouteContext = false;
    let worldRouteContext = false;
    let updateStatusRouteContext = false;
    let lifecycleMutationContext = false;
    let managedRecoveryProbe = null;
    try {
      const url = new URL(request.url ?? '/', `http://${config.host}:${config.port}`);
      backupRouteContext = /^\/v1\/instances\/[^/]+\/backups(?:\/|$)/.test(url.pathname);
      adminRouteContext = /^\/v1\/instances\/[^/]+\/admin(?:\/|$)/.test(url.pathname);
      modRouteContext = /^\/v1\/instances\/[^/]+\/mods(?:\/|$)/.test(url.pathname);
      firstPartyCoreRouteContext = /^\/v1\/instances\/[^/]+\/first-party-core(?:\/|$)/.test(url.pathname);
      worldRouteContext = /^\/v1\/instances\/[^/]+\/worlds(?:\/|$)/.test(url.pathname);
      updateStatusRouteContext = request.method === 'GET'
        && /^\/v1\/instances\/[^/]+\/update-status$/.test(url.pathname);
      lifecycleMutationContext = request.method === 'POST'
        && /^\/v1\/instances\/[^/]+\/(?:start|stop|ensure-running|update|retired-version\/purge)$/.test(url.pathname);
      if (request.method === 'GET' && url.pathname === '/healthz') {
        return json(response, 200, { ok: true, service: 'mastermind-minecraft-control', version: 2 });
      }
      if (request.headers.origin) {
        return json(response, 403, { ok: false, code: 'DIRECT_BROWSER_FORBIDDEN', message: 'Use the command center same-origin API.' });
      }
      if (!tokenMatches(request.headers.authorization, config.token)) {
        return json(response, 401, { ok: false, code: 'UNAUTHORIZED', message: 'A valid local control token is required.' });
      }

      await latchLiveBackupRecoveryFence();

      if (globalRecoveryFence) {
        const fencedInstanceRoute = url.pathname.match(/^\/v1\/instances\/([^/]+)\/(.+)$/);
        const isSafeStop = request.method === 'POST' && fencedInstanceRoute?.[2] === 'stop';
        const isSafeCompanionStop = request.method === 'POST' && url.pathname === '/v1/companion/stop';
        const isSafeSupervisorStop = request.method === 'POST' && url.pathname === '/v1/control/prepare-shutdown';
        const isSafeAccountPost = isBackupRecoverySafeAccountPost(request, url);
        const isUninitializedRecoveryRead = request.method === 'GET'
          && /^(?:mods|worlds)(?:\/|$)/.test(fencedInstanceRoute?.[2] ?? '');
        if ((request.method === 'POST' && !isSafeStop && !isSafeCompanionStop && !isSafeSupervisorStop && !isSafeAccountPost)
          || isUninitializedRecoveryRead) {
          throw Object.assign(new Error('Backup recovery requires verified manual repair before this action can continue.'), {
            code: globalRecoveryFenceCode, statusCode: 409,
          });
        }
      }

      if (request.method === 'GET' && url.pathname === '/v1/overview') {
        const instances = await store.list();
        const liveBackupRecovery = typeof backups.recoveryStatus === 'function'
          ? await backups.recoveryStatus()
          : null;
        const liveManualRecoveryCount = Number.isInteger(liveBackupRecovery?.manualRecoveryRequired)
          && liveBackupRecovery.manualRecoveryRequired >= 0
          ? liveBackupRecovery.manualRecoveryRequired
          : manualBackupRecovery.length;
        const liveGlobalRecoveryCount = liveBackupRecovery?.global === true || liveBackupRecovery?.globalRecoveryRequired === true
          ? 1
          : (Number.isInteger(liveBackupRecovery?.globalRecoveryRequired) && liveBackupRecovery.globalRecoveryRequired >= 0
            ? liveBackupRecovery.globalRecoveryRequired
            : manualBackupRecovery.filter((item) => !validateInstanceId(item?.instanceId)).length);
        return json(response, 200, {
          ok: true,
          service: { online: true, version: 2, projectId: 'family-server' },
          counts: {
            total: instances.length,
            running: instances.filter((item) => item.status === 'running').length,
            failed: instances.filter((item) => item.status === 'failed').length,
          },
          capabilities: {
            familyServerProvisioning: true,
            latestCompatibleRelease: true,
            transactionalUpdates: true,
            automaticComponentUpdates: true,
            minecraftVersionApproval: true,
            verifiedRetiredVersionCleanup: true,
            verifiedOperatorBackups: true,
            transactionalBackupRestore: true,
            deferredAutomaticBackups: true,
            managedModrinthMods: true,
            managedFirstPartyCoreArtifacts: true,
            geyser: true,
            floodgate: true,
            ps4ConnectionSetup: true,
            ps4LanVerified: false,
            companionProvisioning: true,
            companionBridge: true,
            companionActions: true,
            typedServerAdministration: true,
            managedWorlds: true,
            microsoftDeviceCode: true,
          },
          legacyMigration,
          updateRecovery: {
            reconciled: Array.isArray(updateRecovery) ? updateRecovery.length : 0,
            awaitingReadiness: Array.isArray(updateRecovery)
              ? updateRecovery.filter((item) => item?.action === 'awaiting-readiness').length
              : 0,
            manualRecoveryRequired: Array.isArray(updateRecovery)
              ? updateRecovery.filter((item) => item?.action === 'manual-recovery-required').length
              : 0,
          },
          backupRecovery: publicBackupRecoveryOverview({
            reconciled: Array.isArray(backupRecovery) ? backupRecovery.length : 0,
            manualRecoveryRequired: liveManualRecoveryCount,
            globalRecoveryRequired: liveGlobalRecoveryCount,
            initializationFailure: backupInitializationFailure,
          }),
          worldRecovery: {
            reconciled: Array.isArray(worldRecovery) ? worldRecovery.length : 0,
            manualRecoveryRequired: Array.isArray(worldRecovery)
              ? worldRecovery.filter((item) => item?.action === 'manual-recovery-required').length
              : 0,
          },
          processRecovery: {
            reconciled: Array.isArray(processRecovery) ? processRecovery.length : 0,
            managedOrphans: Array.isArray(processRecovery)
              ? processRecovery.filter((item) => ['preserved-managed-orphan', 'adopted-pre-identity-process'].includes(item?.action)).length
              : 0,
            unmanagedActive: Array.isArray(processRecovery)
              ? processRecovery.filter((item) => item?.action === 'preserved-unmanaged-active').length
              : 0,
          },
        });
      }
      if (request.method === 'GET' && url.pathname === '/v1/catalog') {
        return json(response, 200, { ok: true, catalog: await provisioner.catalog() });
      }
      if (request.method === 'GET' && url.pathname === '/v1/lan') {
        const instances = await store.list();
        const javaPorts = instances
          .filter((instance) => instance?.projectId === 'family-server' && instance?.kind === 'server')
          .map((instance) => instance.javaPort)
          .filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535);
        const value = await lanStatus({ javaPorts });
        return json(response, 200, { ok: true, lan: publicLanStatus(value, instances) });
      }
      if (request.method === 'GET' && url.pathname === '/v1/instances') {
        return json(response, 200, { ok: true, instances: (await store.list()).map(publicInstance) });
      }
      const firstPartyCoreStatus = url.search === ''
        ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/first-party-core$/)
        : null;
      if (request.method === 'GET' && firstPartyCoreStatus) {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        const id = decodeURIComponent(firstPartyCoreStatus[1]);
        if (id !== familyServerInstanceId) {
          return json(response, 400, { ok: false, code: 'FAMILY_CORE_INSTANCE_INVALID', message: 'First-party core artifacts are restricted to family-server.' });
        }
        const status = await processes.withInstanceLock(id, () => firstPartyCore.status(id));
        return json(response, 200, { ok: true, instanceId: id, firstPartyCore: status });
      }
      const firstPartyCoreAction = url.search === ''
        ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/first-party-core\/(promote|rollback)$/)
        : null;
      if (request.method === 'POST' && firstPartyCoreAction) {
        if (draining) return json(response, 503, { ok: false, code: 'CONTROL_PLANE_DRAINING', message: 'The local control plane is draining.' });
        const id = decodeURIComponent(firstPartyCoreAction[1]);
        if (id !== familyServerInstanceId) {
          return json(response, 400, { ok: false, code: 'FAMILY_CORE_INSTANCE_INVALID', message: 'First-party core artifacts are restricted to family-server.' });
        }
        if (companionLifecycleIsActive(companionLifecycle)) {
          throw Object.assign(new Error('Stop the managed Family AI client before changing first-party server artifacts.'), {
            code: 'FAMILY_CORE_STATE_CHANGED', statusCode: 409,
          });
        }
        const input = await readJsonBody(request);
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          throw Object.assign(new Error('The first-party core request is invalid.'), { code: 'FAMILY_CORE_ARTIFACT_INVALID', statusCode: 400 });
        }
        let operation;
        if (firstPartyCoreAction[2] === 'promote') {
          const keys = ['expectedSha256', 'expectedSize', 'backupId', 'confirmation'];
          if (Object.keys(input).length !== keys.length || Object.keys(input).some((key) => !keys.includes(key))
            || !SHA256_PATTERN.test(input.expectedSha256 ?? '')
            || !Number.isInteger(input.expectedSize) || input.expectedSize < 22 || input.expectedSize > 16 * 1024 * 1024
            || !BACKUP_ID_PATTERN.test(input.backupId ?? '') || input.confirmation !== 'PROMOTE FIRST-PARTY FAMILY CORE') {
            throw Object.assign(new Error('Family Core promotion requires one pinned artifact, verified backup, and exact confirmation.'), {
              code: 'FAMILY_CORE_ARTIFACT_INVALID', statusCode: 400,
            });
          }
          operation = await withManagedLifecycleRun(() => firstPartyCore.promote({
            instanceId: id,
            sourcePath: FAMILY_CORE_CANDIDATE_PATH,
            expectedSha256: input.expectedSha256,
            expectedSize: input.expectedSize,
            backupId: input.backupId,
            confirmation: input.confirmation,
          }));
        } else {
          const keys = ['expectedGeneration', 'confirmation'];
          if (Object.keys(input).length !== keys.length || Object.keys(input).some((key) => !keys.includes(key))
            || !SHA256_PATTERN.test(input.expectedGeneration ?? '')
            || input.confirmation !== 'ROLL BACK FIRST-PARTY FAMILY CORE') {
            throw Object.assign(new Error('Family Core rollback requires the current generation and exact confirmation.'), {
              code: 'FAMILY_CORE_STATE_CHANGED', statusCode: 400,
            });
          }
          operation = await withManagedLifecycleRun(() => firstPartyCore.rollback({
            instanceId: id,
            expectedGeneration: input.expectedGeneration,
            confirmation: input.confirmation,
          }));
        }
        return json(response, 200, { ok: true, instanceId: id, operation });
      }
      const modSearch = url.pathname.match(/^\/v1\/instances\/([^/]+)\/mods\/catalog\/search$/);
      if (request.method === 'GET' && modSearch) {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        const id = decodeURIComponent(modSearch[1]);
        const keys = [...url.searchParams.keys()];
        if (id !== 'family-server' || keys.some((key) => !['q', 'offset', 'limit'].includes(key))
          || ['q', 'offset', 'limit'].some((key) => url.searchParams.getAll(key).length !== 1)) {
          return json(response, 400, { ok: false, code: 'MOD_INVALID_REQUEST', message: 'Invalid Family Server mod catalog search.' });
        }
        const payload = await mods.search(id, { query: url.searchParams.get('q'), offset: Number(url.searchParams.get('offset')), limit: Number(url.searchParams.get('limit')) });
        return json(response, 200, { ok: true, instanceId: id, ...payload });
      }
      const modDetail = url.search === '' ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/mods\/catalog\/(modref-[a-f0-9]{64})$/) : null;
      if (request.method === 'GET' && modDetail) {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        const id = decodeURIComponent(modDetail[1]); const ref = modDetail[2];
        if (id !== 'family-server') return json(response, 400, { ok: false, code: 'MOD_INVALID_INSTANCE', message: 'Mod management is restricted to family-server.' });
        return json(response, 200, { ok: true, instanceId: id, detail: await mods.detail(id, ref) });
      }
      const modInventory = url.search === '' ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/mods\/installed$/) : null;
      if (request.method === 'GET' && modInventory) {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        const id = decodeURIComponent(modInventory[1]);
        if (id !== 'family-server') return json(response, 400, { ok: false, code: 'MOD_INVALID_INSTANCE', message: 'Mod management is restricted to family-server.' });
        const inventory = await withStrictUpdateLifecycleLock(id, () => mods.inventory(id));
        return json(response, 200, { ok: true, instanceId: id, ...inventory });
      }
      const modOperation = url.search === '' ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/mods\/operations\/([^/]+)$/) : null;
      if (request.method === 'GET' && modOperation) {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        const id = decodeURIComponent(modOperation[1]); const requestId = decodeURIComponent(modOperation[2]);
        if (id !== 'family-server' || !UUID_PATTERN.test(requestId)) return json(response, 400, { ok: false, code: 'MOD_INVALID_REQUEST', message: 'Invalid Family Server mod operation reference.' });
        return json(response, 200, { ok: true, instanceId: id, operation: await mods.operation(id, requestId) });
      }
      const modPlans = url.search === '' ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/mods\/plans$/) : null;
      if (request.method === 'POST' && modPlans) {
        if (draining) return json(response, 503, { ok: false, code: 'CONTROL_PLANE_DRAINING', message: 'The local control plane is draining.' });
        const id = decodeURIComponent(modPlans[1]);
        if (id !== 'family-server') return json(response, 400, { ok: false, code: 'MOD_INVALID_INSTANCE', message: 'Mod management is restricted to family-server.' });
        return json(response, 201, { ok: true, instanceId: id, plan: await mods.createPlan(id, await readJsonBody(request)) });
      }
      const modActions = url.search === '' ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/mods\/actions$/) : null;
      if (request.method === 'POST' && modActions) {
        if (draining) return json(response, 503, { ok: false, code: 'CONTROL_PLANE_DRAINING', message: 'The local control plane is draining.' });
        const id = decodeURIComponent(modActions[1]);
        if (id !== 'family-server') return json(response, 400, { ok: false, code: 'MOD_INVALID_INSTANCE', message: 'Mod management is restricted to family-server.' });
        managedRecoveryProbe = { domain: 'mods', instanceId: id };
        const operation = await mods.execute(id, await readJsonBody(request));
        if (operation.state === 'completion-unknown' || operation.state === 'manual-recovery-required') fenceDomain('mods');
        return json(response, operation.state === 'completion-unknown' ? 202 : 200, { ok: true, instanceId: id, operation });
      }
      const worldInventory = url.search === '' ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/worlds$/) : null;
      if (request.method === 'GET' && worldInventory) {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        const id = decodeURIComponent(worldInventory[1]);
        if (id !== 'family-server') return json(response, 400, { ok: false, code: 'WORLD_INVALID_INSTANCE', message: 'World management is restricted to family-server.' });
        managedRecoveryProbe = { domain: 'world', instanceId: id };
        return json(response, 200, { ok: true, instanceId: id, ...await worlds.inventory(id) });
      }
      const worldOperation = url.search === '' ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/worlds\/operations\/([^/]+)$/) : null;
      if (request.method === 'GET' && worldOperation) {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        const id = decodeURIComponent(worldOperation[1]); const requestId = decodeURIComponent(worldOperation[2]);
        if (id !== 'family-server' || !UUID_PATTERN.test(requestId) || requestId !== requestId.toLowerCase()) {
          return json(response, 400, { ok: false, code: 'WORLD_INVALID_REQUEST', message: 'Invalid Family Server world operation reference.' });
        }
        return json(response, 200, { ok: true, instanceId: id, operation: await worlds.operation(id, requestId) });
      }
      const worldPlans = url.search === '' ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/worlds\/plans$/) : null;
      if (request.method === 'POST' && worldPlans) {
        if (draining) return json(response, 503, { ok: false, code: 'CONTROL_PLANE_DRAINING', message: 'The local control plane is draining.' });
        const id = decodeURIComponent(worldPlans[1]);
        if (id !== 'family-server') return json(response, 400, { ok: false, code: 'WORLD_INVALID_INSTANCE', message: 'World management is restricted to family-server.' });
        return json(response, 201, { ok: true, instanceId: id, plan: await worlds.createPlan(id, await readJsonBody(request)) });
      }
      const worldActions = url.search === '' ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/worlds\/actions$/) : null;
      if (request.method === 'POST' && worldActions) {
        if (draining) return json(response, 503, { ok: false, code: 'CONTROL_PLANE_DRAINING', message: 'The local control plane is draining.' });
        const id = decodeURIComponent(worldActions[1]);
        if (id !== 'family-server') return json(response, 400, { ok: false, code: 'WORLD_INVALID_INSTANCE', message: 'World management is restricted to family-server.' });
        managedRecoveryProbe = { domain: 'world', instanceId: id };
        const operation = await worlds.execute(id, await readJsonBody(request));
        if (operation.state === 'completion-unknown' || operation.state === 'manual-recovery-required') fenceDomain('world');
        return json(response, operation.state === 'completion-unknown' ? 202 : 200, { ok: true, instanceId: id, operation });
      }
      const adminStatus = url.search === '' ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/admin$/) : null;
      if (request.method === 'GET' && adminStatus) {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        const id = decodeURIComponent(adminStatus[1]);
        if (!validateInstanceId(id)) return json(response, 400, { ok: false, code: 'ADMIN_INVALID_INSTANCE_ID', message: 'Invalid instance id.' });
        return json(response, 200, { ok: true, instanceId: id, administration: await administration.status(id) });
      }
      const adminOperation = url.search === '' ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/admin\/operations\/([^/]+)$/) : null;
      if (request.method === 'GET' && adminOperation) {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        const id = decodeURIComponent(adminOperation[1]);
        const requestId = decodeURIComponent(adminOperation[2]);
        if (!validateInstanceId(id)) return json(response, 400, { ok: false, code: 'ADMIN_INVALID_INSTANCE_ID', message: 'Invalid instance id.' });
        if (!ADMIN_REQUEST_ID_PATTERN.test(requestId)) return json(response, 400, { ok: false, code: 'ADMIN_INVALID_REQUEST', message: 'requestId must be a valid UUID.' });
        return json(response, 200, { ok: true, instanceId: id, operation: await administration.operation(id, requestId) });
      }
      const adminPlans = url.search === '' ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/admin\/plans$/) : null;
      if (request.method === 'POST' && adminPlans) {
        if (draining) return json(response, 503, { ok: false, code: 'CONTROL_PLANE_DRAINING', message: 'The local control plane is draining for supervisor handoff and will not accept mutations.' });
        const id = decodeURIComponent(adminPlans[1]);
        if (!validateInstanceId(id)) return json(response, 400, { ok: false, code: 'ADMIN_INVALID_INSTANCE_ID', message: 'Invalid instance id.' });
        return json(response, 201, { ok: true, instanceId: id, plan: await administration.createPlan(id, await readJsonBody(request)) });
      }
      const adminActions = url.search === '' ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/admin\/actions$/) : null;
      if (request.method === 'POST' && adminActions) {
        if (draining) return json(response, 503, { ok: false, code: 'CONTROL_PLANE_DRAINING', message: 'The local control plane is draining for supervisor handoff and will not accept mutations.' });
        const id = decodeURIComponent(adminActions[1]);
        if (!validateInstanceId(id)) return json(response, 400, { ok: false, code: 'ADMIN_INVALID_INSTANCE_ID', message: 'Invalid instance id.' });
        const operation = await administration.execute(id, await readJsonBody(request));
        return json(response, ['delivered-unconfirmed', 'delivery-unknown'].includes(operation.state) ? 202 : 200, { ok: true, instanceId: id, operation });
      }
      if (request.method === 'GET' && url.pathname === '/v1/companion/status' && url.search === '') {
        return json(response, 200, {
          ok: true,
          companion: publicCompanionStatus({
            lifecycle: companionLifecycle,
            sessions: companionSessions,
            launchAvailable: true,
            targetInstanceId: trustedCompanionLaunchFactory.familyServerInstanceId,
          }),
        });
      }
      if (request.method === 'GET' && url.pathname === '/v1/brain/status' && url.search === '') {
        return json(response, 200, {
          ok: true,
          brain: familyCompanionBrain.status(),
        });
      }
      if (request.method === 'GET' && url.pathname === '/v1/family-core/status' && url.search === '') {
        return json(response, 200, {
          ok: true,
          familyCore: {
            session: familyCoreSessions.status(),
            credentials: familyCoreCredentials.status(),
            identities: familyCoreIdentities.status(),
          },
        });
      }
      if (request.method === 'POST' && url.pathname === '/v1/family-core/identities/parent' && url.search === '') {
        const input = await readJsonBody(request);
        const keys = ['playerId', 'minecraftUuid', 'displayName', 'confirmation'];
        if (!input || typeof input !== 'object' || Array.isArray(input)
          || Object.keys(input).length !== keys.length || Object.keys(input).some((key) => !keys.includes(key))
          || !UUID_PATTERN.test(input.playerId ?? '') || !UUID_PATTERN.test(input.minecraftUuid ?? '')
          || typeof input.displayName !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(input.displayName)
          || input.confirmation !== 'BIND FAMILY CORE PARENT') {
          return json(response, 400, {
            ok: false,
            code: 'FAMILY_CORE_IDENTITY_INVALID',
            message: 'Parent identity binding requires exact UUID evidence and confirmation.',
          });
        }
        const result = await familyCoreIdentities.bind({
          playerId: input.playerId.toLowerCase(),
          minecraftUuid: input.minecraftUuid.toLowerCase(),
          registeredDisplayName: input.displayName,
          role: 'parent',
        });
        return json(response, result.created ? 201 : 200, {
          ok: true,
          created: result.created,
          identities: familyCoreIdentities.status(),
        });
      }
      if (request.method === 'POST' && url.pathname === '/v1/control/prepare-shutdown') {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        if (!/^[a-f0-9]{32}$/.test(supervisorId ?? '')) {
          return json(response, 503, { ok: false, code: 'SUPERVISOR_HANDOFF_UNAVAILABLE', message: 'This agent was not launched by an authenticated local supervisor.' });
        }
        if (!supervisorIdMatches(request.headers['x-mastermind-supervisor-id'], supervisorId)) {
          return json(response, 403, { ok: false, code: 'SUPERVISOR_ID_MISMATCH', message: 'The local supervisor identity did not match.' });
        }
        draining = true;
        try {
          await companionLifecycle.stop({ gracefulTimeoutMs: SUPERVISOR_DRAIN_TIMEOUT_MS });
          await processes.shutdown(SUPERVISOR_DRAIN_TIMEOUT_MS);
        } catch (error) {
          draining = false;
          throw error;
        }
        return json(response, 200, { ok: true, prepared: true, draining: true });
      }
      if (draining && request.method !== 'GET') {
        return json(response, 503, { ok: false, code: 'CONTROL_PLANE_DRAINING', message: 'The local control plane is draining for supervisor handoff and will not accept mutations.' });
      }
      if (request.method === 'POST' && url.pathname === '/v1/companion/start' && url.search === '') {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        await processes.withInstanceLock(trustedCompanionLaunchFactory.familyServerInstanceId, async () => {
          if (companionLifecycleIsActive(companionLifecycle)) {
            throw Object.assign(new Error('A managed Family AI companion launch is already active or orphaned.'), { statusCode: 409, code: 'COMPANION_ALREADY_ACTIVE' });
          }
          await requireExactOwnedFamilyServerChild({
            processes,
            store,
            instanceId: trustedCompanionLaunchFactory.familyServerInstanceId,
          });
          await withAccountLock(async () => {
            const specification = await trustedCompanionLaunchFactory.create();
            try {
              if (specification.familyServerInstanceId !== trustedCompanionLaunchFactory.familyServerInstanceId) {
                throw new Error('The trusted companion launch target changed during launch.');
              }
              // Profile verification and Microsoft refresh may take long enough for
              // the owned server child to exit. Re-read the record at the final
              // admission boundary while the same instance lock remains held.
              const instance = await requireExactOwnedFamilyServerChild({
                processes,
                store,
                instanceId: trustedCompanionLaunchFactory.familyServerInstanceId,
              });
              if (specification?.manifest?.minecraftVersion !== instance.minecraftVersion) {
                throw Object.assign(new Error('The verified Family AI client version does not match the running Family Server version.'), {
                  statusCode: 409,
                  code: 'COMPANION_VERSION_MISMATCH',
                });
              }
              await companionLifecycle.launch({ command: specification.command, manifest: specification.manifest, familyServerPort: instance.javaPort, credentialFrame: specification.credentialFrame });
            } finally {
              specification.credentialFrame?.fill?.(0);
            }
          });
        });
        return json(response, 200, {
          ok: true,
          companion: publicCompanionStatus({ lifecycle: companionLifecycle, sessions: companionSessions, launchAvailable: true, targetInstanceId: trustedCompanionLaunchFactory.familyServerInstanceId }),
        });
      }
      if (request.method === 'POST' && url.pathname === '/v1/companion/actions' && url.search === '') {
        const input = validateCompanionActionRequest(await readJsonBody(request));
        let action;
        try {
          action = await processes.withInstanceLock(trustedCompanionLaunchFactory.familyServerInstanceId, async () => {
            await requireExactOwnedFamilyServerChild({
              processes,
              store,
              instanceId: trustedCompanionLaunchFactory.familyServerInstanceId,
            });
            return companionSessions.dispatchAction(
              input.action,
              input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs },
            );
          });
        } catch (error) {
          if (error?.code === 'COMPANION_SERVER_NOT_READY') {
            companionSessions.closeConnection(4408, 'family-server-ownership-lost');
          }
          throw error;
        }
        return json(response, 200, { ok: true, action });
      }
      const companionCancel = url.search === ''
        ? url.pathname.match(/^\/v1\/companion\/actions\/([^/]+)\/cancel$/)
        : null;
      if (request.method === 'POST' && companionCancel) {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        const actionId = decodeURIComponent(companionCancel[1]);
        if (!UUID_PATTERN.test(actionId)) {
          return json(response, 400, { ok: false, code: 'INVALID_ACTION_ID', message: 'Companion action id is invalid.' });
        }
        return json(response, 200, { ok: true, cancellation: companionSessions.cancelAction(actionId.toLowerCase(), 'operator') });
      }
      if (request.method === 'POST' && url.pathname === '/v1/companion/stop' && url.search === '') {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        await companionLifecycle.stop();
        companionSessions.closeConnection(1001, 'companion-stopped');
        return json(response, 200, {
          ok: true,
          companion: publicCompanionStatus({
            lifecycle: companionLifecycle,
            sessions: companionSessions,
            launchAvailable: true,
            targetInstanceId: trustedCompanionLaunchFactory.familyServerInstanceId,
          }),
        });
      }
      const updateRoute = url.pathname.match(/^\/v1\/instances\/([^/]+)\/update-status$/);
      if (request.method === 'GET' && updateRoute) {
        const id = decodeURIComponent(updateRoute[1]);
        if (!validateInstanceId(id)) return json(response, 400, { ok: false, code: 'INVALID_INSTANCE_ID', message: 'Invalid instance id.' });
        const instance = await store.get(id);
        if (!instance) return json(response, 404, { ok: false, code: 'INSTANCE_NOT_FOUND', message: 'Instance was not found.' });
        if (instance.projectId !== 'family-server') return json(response, 409, { ok: false, code: 'INVALID_STATE', message: 'Instance is not a Family Server.' });
        return json(response, 200, { ok: true, instanceId: id, update: publicUpdatePlan(await updater.check({ instanceId: id })) });
      }
      if (request.method === 'GET' && url.pathname === '/v1/account') {
        return json(response, 200, { ok: true, account: minecraftAuth.status() });
      }
      if (request.method === 'GET' && url.pathname === '/v1/client/status' && url.search === '') {
        return json(response, 200, { ok: true, client: publicClientStatus(await readClientStatus(), minecraftAuth.status(), { targetInstanceId: trustedCompanionLaunchFactory.familyServerInstanceId }) });
      }
      if (request.method === 'POST' && url.pathname === '/v1/client/provision' && url.search === '') {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        invalidateClientStatus();
        try {
          const resolved = await clientProvisioner.resolve();
          const status = await clientProvisioner.provision(resolved);
          return json(response, 201, { ok: true, client: publicClientStatus(status, minecraftAuth.status(), { targetInstanceId: trustedCompanionLaunchFactory.familyServerInstanceId }) });
        } finally {
          invalidateClientStatus();
        }
      }
      if (request.method === 'POST' && url.pathname === '/v1/account/registration' && url.search === '') {
        const input = await readJsonBody(request);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'clientId')) {
          throw new TypeError('Account registration requires only a public clientId.');
        }
        const clientId = validateMinecraftPublicClientId(input.clientId);
        await withAccountLock(async () => {
          if (companionLifecycleIsActive(companionLifecycle)) {
            throw Object.assign(new Error('Stop the managed Family AI client before changing its account registration.'), { statusCode: 409, code: 'COMPANION_ALREADY_ACTIVE' });
          }
          await minecraftAuth.signOut();
          await accountRegistration.save(clientId);
          accountConfig = await accountRegistration.load();
          minecraftAuth = authFactory(accountConfig);
          await minecraftAuth.initialize();
        });
        return json(response, 200, { ok: true, account: minecraftAuth.status() });
      }
      if (request.method === 'POST' && url.pathname === '/v1/account/device/start' && url.search === '') {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        const flow = await withAccountLock(() => {
          if (companionLifecycleIsActive(companionLifecycle)) {
            throw Object.assign(new Error('Stop the managed Family AI client before starting sign-in.'), { statusCode: 409, code: 'COMPANION_ALREADY_ACTIVE' });
          }
          return minecraftAuth.startDeviceFlow();
        });
        return json(response, 200, { ok: true, flow });
      }
      const devicePoll = url.search === '' ? url.pathname.match(/^\/v1\/account\/device\/([^/]+)\/poll$/) : null;
      if (request.method === 'POST' && devicePoll) {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        const flowId = decodeURIComponent(devicePoll[1]);
        if (!UUID_PATTERN.test(flowId)) return json(response, 404, { ok: false, code: 'MINECRAFT_AUTH_FLOW_NOT_FOUND', message: 'The Minecraft sign-in flow was not found.' });
        const flow = await withAccountLock(() => {
          if (companionLifecycleIsActive(companionLifecycle)) {
            throw Object.assign(new Error('Stop the managed Family AI client before completing sign-in.'), { statusCode: 409, code: 'COMPANION_ALREADY_ACTIVE' });
          }
          return minecraftAuth.pollDeviceFlow(flowId);
        });
        return json(response, 200, { ok: true, flow });
      }
      if (request.method === 'POST' && url.pathname === '/v1/account/refresh' && url.search === '') {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        await withAccountLock(() => minecraftAuth.silentRefresh());
        return json(response, 200, { ok: true, account: minecraftAuth.status() });
      }
      if (request.method === 'POST' && url.pathname === '/v1/account/signout' && url.search === '') {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        await withAccountLock(async () => {
          if (companionLifecycleIsActive(companionLifecycle)) {
            throw Object.assign(new Error('Stop the managed Family AI client before signing out.'), { statusCode: 409, code: 'COMPANION_ALREADY_ACTIVE' });
          }
          await minecraftAuth.signOut();
        });
        return json(response, 200, { ok: true, account: minecraftAuth.status() });
      }
      if (request.method === 'POST' && url.pathname === '/v1/provision') {
        const input = validateProvisionRequest(await readJsonBody(request));
        const instance = await provisioner.provision(input);
        return json(response, 201, { ok: true, instance: publicInstance(instance) });
      }

      const backupCollection = url.search === '' ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/backups$/) : null;
      if (backupCollection && ['GET', 'POST'].includes(request.method ?? '')) {
        const id = decodeURIComponent(backupCollection[1]);
        if (!validateInstanceId(id)) return json(response, 400, { ok: false, code: 'INVALID_INSTANCE_ID', message: 'Invalid instance id.' });
        if (request.method === 'GET') {
          const inventory = await backups.list({ instanceId: id });
          return json(response, 200, { ok: true, ...inventory });
        }
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        if (companionLifecycleIsActive(companionLifecycle)) {
          throw Object.assign(new Error('Stop the managed Family AI client before changing Family Server backups.'), { statusCode: 409, code: 'COMPANION_ALREADY_ACTIVE' });
        }
        return json(response, 201, { ok: true, backup: await backups.create({ instanceId: id }) });
      }

      const backupPolicy = url.search === '' ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/backups\/policy$/) : null;
      if (request.method === 'POST' && backupPolicy) {
        const id = decodeURIComponent(backupPolicy[1]);
        if (!validateInstanceId(id)) return json(response, 400, { ok: false, code: 'INVALID_INSTANCE_ID', message: 'Invalid instance id.' });
        const input = await readJsonBody(request);
        if (companionLifecycleIsActive(companionLifecycle)) {
          throw Object.assign(new Error('Stop the managed Family AI client before changing the backup policy.'), { statusCode: 409, code: 'COMPANION_ALREADY_ACTIVE' });
        }
        const result = await backups.setPolicy({ instanceId: id, ...input });
        return json(response, 200, { ok: true, ...result });
      }

      const backupAction = url.search === ''
        ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/backups\/([^/]+)\/(verify|restore-plan|restore|purge)$/)
        : null;
      if (request.method === 'POST' && backupAction) {
        const id = decodeURIComponent(backupAction[1]);
        const backupId = decodeURIComponent(backupAction[2]);
        const actionName = backupAction[3];
        if (!validateInstanceId(id)) return json(response, 400, { ok: false, code: 'INVALID_INSTANCE_ID', message: 'Invalid instance id.' });
        if (!BACKUP_ID_PATTERN.test(backupId)) return json(response, 400, { ok: false, code: 'INVALID_BACKUP_ID', message: 'Invalid backup id.' });
        if (companionLifecycleIsActive(companionLifecycle)) {
          throw Object.assign(new Error('Stop the managed Family AI client before changing Family Server backups.'), { statusCode: 409, code: 'COMPANION_ALREADY_ACTIVE' });
        }
        if (actionName === 'verify') {
          if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
          return json(response, 200, { ok: true, backup: await backups.verify({ instanceId: id, backupId }) });
        }
        if (actionName === 'restore-plan') {
          if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
          return json(response, 200, { ok: true, plan: await backups.createRestorePlan({ instanceId: id, backupId }) });
        }
        const input = await readJsonBody(request);
        if (actionName === 'restore') {
          if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !input.approval || typeof input.approval !== 'object' || Array.isArray(input.approval) || Object.keys(input.approval).length !== 1 || !RESTORE_PLAN_ID_PATTERN.test(input.approval.planId ?? '')) {
            return json(response, 400, { ok: false, code: 'INVALID_BACKUP_APPROVAL', message: 'Restore requires one valid plan approval.' });
          }
          const restoration = await backups.restore({ instanceId: id, backupId, planId: input.approval.planId });
          return json(response, 200, { ok: true, restoration });
        }
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || input.confirmation !== 'PURGE') {
          return json(response, 400, { ok: false, code: 'INVALID_BACKUP_CONFIRMATION', message: 'Backup purge requires the exact PURGE confirmation.' });
        }
        return json(response, 200, { ok: true, purge: await backups.purge({ instanceId: id, backupId, confirmation: 'PURGE' }) });
      }

      const updateAction = url.pathname.match(/^\/v1\/instances\/([^/]+)\/update$/);
      if (request.method === 'POST' && updateAction) {
        const id = decodeURIComponent(updateAction[1]);
        if (!validateInstanceId(id)) return json(response, 400, { ok: false, code: 'INVALID_INSTANCE_ID', message: 'Invalid instance id.' });
        const input = await readJsonBody(request);
        const allowed = new Set(['approval']);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !allowed.has(key))) {
          return json(response, 400, { ok: false, code: 'INVALID_UPDATE_REQUEST', message: 'Update request is invalid.' });
        }
        const updateRequest = { instanceId: id, ...(input.approval === undefined ? {} : { approval: input.approval }) };
        managedRecoveryProbe = { domain: 'update', instanceId: id };
        let result;
        if (trustedCompanionLaunchFactory.familyServerInstanceId === id) {
          if (typeof updater.updateWithinInstanceLock !== 'function') {
            throw new Error('The companion-aware updater does not share the process lifecycle lock');
          }
          result = await processes.withInstanceLock(id, async () => {
            if (typeof updater.assertSafeForLifecycle === 'function') await updater.assertSafeForLifecycle(id);
            await assertBackupSafeForLifecycle(id);
            await companionLifecycle.stop();
            companionSessions.closeConnection(1001, 'family-server-updating');
            return updater.updateWithinInstanceLock(updateRequest);
          });
        } else if (typeof updater.updateWithinInstanceLock === 'function') {
          result = await processes.withInstanceLock(id, async () => {
            if (typeof updater.assertSafeForLifecycle === 'function') await updater.assertSafeForLifecycle(id);
            await assertBackupSafeForLifecycle(id);
            return updater.updateWithinInstanceLock(updateRequest);
          });
        } else {
          await assertBackupSafeForLifecycle(id);
          result = await updater.update(updateRequest);
        }
        if (['completion-unknown', 'manual-recovery-required', 'rollback-failed'].includes(result?.action)) fenceDomain('update');
        return json(response, 200, { ok: result.action !== 'approval-required', updateResult: publicUpdateResult(result) });
      }

      const retiredVersionPurge = url.pathname.match(/^\/v1\/instances\/([^/]+)\/retired-version\/purge$/);
      if (request.method === 'POST' && retiredVersionPurge) {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        const id = decodeURIComponent(retiredVersionPurge[1]);
        if (!validateInstanceId(id)) return json(response, 400, { ok: false, code: 'INVALID_INSTANCE_ID', message: 'Invalid instance id.' });
        if (typeof updater.purgeRetiredVersionWithinInstanceLock !== 'function') {
          throw Object.assign(new Error('Retired-version cleanup is unavailable.'), { statusCode: 503, code: 'CLEANUP_UNAVAILABLE' });
        }
        managedRecoveryProbe = { domain: 'update', instanceId: id };
        const cleanup = await processes.withInstanceLock(id, async () => {
          if (typeof updater.assertSafeForLifecycle === 'function') await updater.assertSafeForLifecycle(id);
          await assertBackupSafeForLifecycle(id);
          return updater.purgeRetiredVersionWithinInstanceLock({ instanceId: id });
        });
        return json(response, 200, { ok: true, cleanup });
      }

      const lanAction = url.pathname.match(/^\/v1\/instances\/([^/]+)\/lan\/(enable)$/);
      if (request.method === 'POST' && lanAction) {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        const id = decodeURIComponent(lanAction[1]);
        if (!validateInstanceId(id)) return json(response, 400, { ok: false, code: 'INVALID_INSTANCE_ID', message: 'Invalid instance id.' });
        const instance = await store.get(id);
        if (!instance) return json(response, 404, { ok: false, code: 'INSTANCE_NOT_FOUND', message: 'Instance was not found.' });
        if (instance.projectId !== 'family-server' || instance.kind !== 'server') {
          return json(response, 409, { ok: false, code: 'INVALID_STATE', message: 'Instance is not a Family Server.' });
        }
        const result = await lanFirewall(instance, lanFirewallScript, 'Enable');
        return json(response, 200, { ok: result.status === 'completed', lanFirewall: result });
      }

      const ensureRunningAction = url.search === ''
        ? url.pathname.match(/^\/v1\/instances\/([^/]+)\/ensure-running$/)
        : null;
      if (request.method === 'POST' && ensureRunningAction) {
        if (requestHasBody(request)) {
          return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        }
        const id = decodeURIComponent(ensureRunningAction[1]);
        if (id !== familyServerInstanceId) {
          return json(response, 404, { ok: false, code: 'INSTANCE_NOT_FOUND', message: 'Instance was not found.' });
        }
        managedRecoveryProbe = { domain: 'control', instanceId: id };
        const result = await startManagedInstanceWithinLock(id, { ensureRunning: true });
        return json(response, 200, { ok: true, action: result.action, instance: publicInstance(result.instance) });
      }

      const action = url.pathname.match(/^\/v1\/instances\/([^/]+)\/(start|stop)$/);
      if (request.method === 'POST' && action) {
        if (requestHasBody(request)) return json(response, 400, { ok: false, code: 'UNEXPECTED_BODY', message: 'This action does not accept a request body.' });
        const id = decodeURIComponent(action[1]);
        if (!validateInstanceId(id)) return json(response, 400, { ok: false, code: 'INVALID_INSTANCE_ID', message: 'Invalid instance id.' });
        let instance;
        managedRecoveryProbe = { domain: action[2] === 'start' ? 'control' : 'world', instanceId: id };
        if (action[2] === 'start') {
          instance = (await startManagedInstanceWithinLock(id)).instance;
        } else {
          if (trustedCompanionLaunchFactory.familyServerInstanceId === id) {
            if (typeof processes.stopWithinInstanceLock !== 'function') {
              throw new Error('The companion-aware process manager does not share the process lifecycle lock');
            }
            instance = await processes.withInstanceLock(id, async () => {
              await companionLifecycle.stop();
              companionSessions.closeConnection(1001, 'family-server-stopping');
              const stopped = await processes.stopWithinInstanceLock(id);
              if (stopped?.status === 'stopped' && stopped?.pid === null && stopped?.managedProcess == null) {
                await latchLiveBackupRecoveryFence();
                if (!globalRecoveryFence) {
                  try { await assertManagedLifecycleSafeWithinInstanceLock(id); }
                  catch (error) { latchManagedRecoveryError(error, 'control'); }
                }
                if (!globalRecoveryFence && typeof worlds.reconcileGeneratedWorldWithinInstanceLock === 'function') {
                  try { await worlds.reconcileGeneratedWorldWithinInstanceLock(id); }
                  catch (error) { latchManagedRecoveryError(error, 'world'); }
                }
              }
              return stopped;
            }, { priority: 'lifecycle' });
          } else {
            instance = await processes.stop(id);
          }
        }
        return json(response, 200, { ok: true, instance: publicInstance(instance) });
      }

      const logRoute = url.pathname.match(/^\/v1\/instances\/([^/]+)\/logs$/);
      if (request.method === 'GET' && logRoute) {
        const id = decodeURIComponent(logRoute[1]);
        if (!validateInstanceId(id)) return json(response, 400, { ok: false, code: 'INVALID_INSTANCE_ID', message: 'Invalid instance id.' });
        if (!await store.get(id)) return json(response, 404, { ok: false, code: 'INSTANCE_NOT_FOUND', message: 'Instance was not found.' });
        const limitText = url.searchParams.get('limit') ?? '200';
        if (!/^\d{1,4}$/.test(limitText)) return json(response, 400, { ok: false, code: 'INVALID_LIMIT', message: 'limit must be 1-1000.' });
        const limit = Number(limitText);
        if (limit < 1 || limit > 1000) return json(response, 400, { ok: false, code: 'INVALID_LIMIT', message: 'limit must be 1-1000.' });
        return json(response, 200, { ok: true, instanceId: id, logs: await logs.tail(id, limit) });
      }

      return json(response, 404, { ok: false, code: 'NOT_FOUND', message: 'Control endpoint was not found.' });
    } catch (error) {
      const recoveryLatched = latchManagedRecoveryError(error);
      if (!recoveryLatched && !globalRecoveryFence && managedRecoveryProbe) {
        try {
          await processes.withInstanceLock(
            managedRecoveryProbe.instanceId,
            () => assertManagedLifecycleSafeWithinInstanceLock(managedRecoveryProbe.instanceId),
          );
        } catch (recoveryError) {
          latchManagedRecoveryError(recoveryError, managedRecoveryProbe.domain);
        }
      }
      const safeUpdateMessage = SAFE_UPDATE_ROUTE_MESSAGES.get(error?.code);
      const globalRecoveryMessage = GLOBAL_RECOVERY_MESSAGES.get(error?.code);
      const safeLifecycleMessage = lifecycleMutationContext ? SAFE_LIFECYCLE_MESSAGES.get(error?.code) : null;
      const failure = globalRecoveryMessage
        ? { status: 409, code: error.code, message: globalRecoveryMessage, sanitized: false }
        : safeUpdateMessage
        ? { status: 409, code: error.code, message: safeUpdateMessage, sanitized: false }
        : safeLifecycleMessage
        ? { status: Number.isInteger(error?.statusCode) ? error.statusCode : 409, code: error.code, message: safeLifecycleMessage, sanitized: false }
        : lifecycleMutationContext
        ? { status: 500, code: 'CONTROL_ACTION_FAILED', message: 'The managed server action failed safely.', sanitized: true }
        : updateStatusRouteContext
        ? { status: 500, code: 'UPDATE_STATUS_FAILED', message: 'The Family Server update status is unavailable.', sanitized: true }
        : backupRouteContext ? backupRouteFailure(error) : adminRouteContext ? adminRouteFailure(error)
        : modRouteContext ? modRouteFailure(error) : firstPartyCoreRouteContext ? firstPartyCoreRouteFailure(error)
        : worldRouteContext ? worldRouteFailure(error) : classifyError(error);
      if (lifecycleMutationContext && failure.code === 'CONTROL_ACTION_FAILED') {
        console.warn(formatLifecycleFailureDiagnostic(error));
      }
      if (lifecycleMutationContext && failure.code === 'UPDATE_RECOVERY_REQUIRED') {
        console.warn(formatUpdateLifecycleFailureDiagnostic(error));
      }
      if (backupRouteContext && failure.sanitized) {
        console.warn(`Family Server backup request failed (${failure.logCode}).`);
      }
      if (adminRouteContext && failure.sanitized) {
        console.warn(`Family Server administration request failed (${failure.code}).`);
      }
      if (firstPartyCoreRouteContext && failure.sanitized) {
        console.warn(`Family Server first-party core request failed (${failure.code}).`);
      }
      if (worldRouteContext && failure.sanitized) console.warn(`Family Server world request failed (${failure.code}).`);
      const ownerPid = Number.isInteger(error?.owner?.pid) && error.owner.pid > 0 && error.owner.pid <= 0xffffffff
        ? error.owner.pid
        : null;
      const ownerName = typeof error?.owner?.processName === 'string'
        && error.owner.processName.length <= 128
        && !/[\x00-\x1f\x7f\\/:<>"|]/.test(error.owner.processName)
        ? error.owner.processName
        : null;
      return json(response, failure.status, {
        ok: false,
        code: failure.code,
        message: globalRecoveryMessage || safeUpdateMessage || safeLifecycleMessage
          || lifecycleMutationContext || updateStatusRouteContext || backupRouteContext || adminRouteContext || modRouteContext || firstPartyCoreRouteContext || worldRouteContext
          ? failure.message
          : (error?.message ?? 'Control request failed.'),
        ...(!lifecycleMutationContext && !updateStatusRouteContext && !backupRouteContext && !adminRouteContext && !modRouteContext && !firstPartyCoreRouteContext && !worldRouteContext && (ownerPid || ownerName)
          ? { owner: { ...(ownerPid ? { pid: ownerPid } : {}), ...(ownerName ? { processName: ownerName } : {}) } }
          : {}),
      });
    }
  });
  server.maxHeadersCount = 32;
  server.requestTimeout = 10 * 60 * 1000;
  server.headersTimeout = 15_000;
  const companionBridge = options.companionBridge ?? new CompanionBridgeServer({
    httpServer: server,
    sessionManager: companionSessions,
    authenticate: (credentials) => companionLifecycle.authenticateBridgeToken(credentials),
  });
  if (typeof companionBridge.start !== 'function' || typeof companionBridge.close !== 'function') {
    throw new TypeError('The companion bridge must expose start() and close()');
  }
  companionBridge.start();
  const familyCoreBridge = options.familyCoreBridge ?? new FamilyCoreBridgeServer({
    httpServer: server,
    sessionManager: familyCoreSessions,
    authenticate: options.authenticateFamilyCore ?? ((credentials) => familyCoreCredentials.authenticate(credentials)),
  });
  if (typeof familyCoreBridge.start !== 'function' || typeof familyCoreBridge.close !== 'function') {
    throw new TypeError('The Family Core bridge must expose start() and close()');
  }
  familyCoreBridge.start();
  const backupTimerMs = Number.isInteger(options.backupTimerMs) && options.backupTimerMs >= 1_000
    ? options.backupTimerMs
    : 60_000;
  const runScheduledBackups = () => {
    if (backupRunInFlight || managedLifecycleRuns > 0 || draining || globalRecoveryFence
      || companionLifecycleIsActive(companionLifecycle)) return;
    const run = Promise.resolve()
      .then(async () => {
        await latchLiveBackupRecoveryFence();
        if (globalRecoveryFence) return undefined;
        // The backup manager reads the policy before acquiring lifecycle or
        // filesystem proof work. Revalidating the whole install here would
        // turn a disabled one-minute scheduler tick into an expensive scan.
        const results = await backups.runDueBackups();
        if (Array.isArray(results) && results.some((item) => item?.action === 'manual-recovery-required')) {
          globalRecoveryFence = true;
          globalRecoveryFenceCode = 'BACKUP_MANUAL_RECOVERY_REQUIRED';
        }
        return results;
      })
      .catch(async (error) => {
        if (latchManagedRecoveryError(error)) {
          console.warn(`Family Server backup scheduler stopped at a managed recovery fence (${error.code}).`);
          return;
        }
        const failureCode = typeof error?.code === 'string' && /^[A-Z0-9_]{3,64}$/.test(error.code)
          ? error.code
          : 'BACKUP_SCHEDULER_FAILED';
        const failureStage = ['instance-list', 'policy-read', 'backup-list', 'scheduled-apply'].includes(error?.schedulerStage)
          ? error.schedulerStage
          : 'scheduled-apply';
        if (typeof backups.recordSchedulerFailure === 'function') {
          try {
            await backups.recordSchedulerFailure({ code: failureCode });
          } catch (recordError) {
            const recordCode = typeof recordError?.code === 'string' && /^[A-Z0-9_]{3,64}$/.test(recordError.code)
              ? recordError.code
              : 'BACKUP_SCHEDULER_RECORD_FAILED';
            console.warn(`Family Server backup scheduler could not record a failure (${recordCode}).`);
          }
        }
        console.warn(`Family Server backup scheduler failed at ${failureStage} (${failureCode}).`);
      })
      .finally(() => {
        if (backupRunInFlight === run) backupRunInFlight = null;
      });
    backupRunInFlight = run;
  };
  const backupTimer = typeof backups.runDueBackups === 'function'
    ? setInterval(runScheduledBackups, backupTimerMs)
    : null;
  backupTimer?.unref?.();

  return {
    config,
    store,
    logs,
    processes,
    updater,
    updateRecovery,
    recoveryPreflight,
    backups,
    mods,
    firstPartyCore,
    worlds,
    administration,
    backupRecovery,
    modRecovery,
    worldRecovery,
    processRecovery,
    legacyMigration,
    companionLifecycle,
    companionSessions,
    familyCoreSessions,
    familyCoreCredentials,
    familyCoreIdentities,
    domainEventOutbox,
    companionDomainEvents,
    memoryEventConsumer,
    memoryEventSync,
    companionBridge,
    familyCoreBridge,
    server,
    async listen(port = config.port) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, config.host, resolve);
      });
      return server.address();
    },
    async close() {
      if (backupTimer) clearInterval(backupTimer);
      if (backupRunInFlight) await backupRunInFlight;
      await companionBridge.close();
      await familyCoreBridge.close();
      await companionDomainEvents?.close();
      if (memoryEventSync) {
        try { await memoryEventSync.finalDrain(); }
        catch (error) { reportMemoryEventSyncFailure(error, { reason: 'shutdown' }); }
        try { await memoryEventSync.close(); }
        catch (error) { reportMemoryEventSyncFailure(error, { reason: 'close' }); }
      }
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function main() {
  if (process.env.MASTERMIND_LOCAL_CHILD_ROLE !== 'minecraft-control-agent') {
    throw new Error('Start the Minecraft control plane with `npm run dev:local`; standalone agent launch is disabled so the authenticated supervisor always owns shutdown and handoff.');
  }
  const app = await createControlPlane();
  await app.listen();
  console.log(`Mastermind Minecraft control plane listening on http://${app.config.host}:${app.config.port}`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await app.companionLifecycle.stop({ gracefulTimeoutMs: SUPERVISOR_DRAIN_TIMEOUT_MS });
      await app.processes.shutdown(SUPERVISOR_DRAIN_TIMEOUT_MS);
      await app.close();
      process.exit(0);
    } catch (error) {
      stopping = false;
      console.error(`Minecraft agent signal shutdown was refused because a safe graceful drain did not complete: ${error?.message ?? String(error)}`);
    }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
