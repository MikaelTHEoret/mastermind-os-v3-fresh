'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

const C = {
  cyan: '#00ffff',
  green: '#00ffaa',
  gold: '#ffaa00',
  red: '#ff4444',
  magenta: '#ff00ff',
  dim: 'rgba(0,255,255,0.35)',
  muted: 'rgba(255,255,255,0.48)',
  panel: 'rgba(0,15,35,0.76)',
};

const mono = 'Orbitron, monospace';
const body = 'Rajdhani, sans-serif';

type InstanceState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';

type ManagedInstance = {
  id: string;
  displayName: string;
  projectId?: 'family-server';
  kind?: 'server';
  status: InstanceState;
  pid?: number | null;
  minecraftVersion: string;
  latestMinecraftVersion?: string;
  updateChannel?: 'latest-compatible';
  javaPort?: number;
  serverPort?: number;
  bedrockPort?: number;
  loader?: string;
  loaderVersion?: string;
  components?: {
    fabricApi?: { versionNumber?: string };
    geyser?: { versionNumber?: string };
    floodgate?: { versionNumber?: string };
  };
  provisioningStatus?: string;
  lastError?: string | null;
  updateStatus?: {
    state?: 'pending-unverified' | 'verified';
    previousMinecraftVersion?: string;
    targetMinecraftVersion?: string;
    backupAvailable?: boolean;
    verifiedAt?: string;
  };
  lastRestore?: {
    backupId?: string;
    rescueBackupId?: string;
    restoredAt?: string;
    state?: 'verified';
  } | null;
};

type Overview = {
  service?: { online?: boolean; version?: string | number; projectId?: 'family-server' };
  counts?: {
    total?: number;
    running?: number;
    failed?: number;
  };
  capabilities?: {
    familyServerProvisioning?: boolean;
    latestCompatibleRelease?: boolean;
    geyser?: boolean;
    floodgate?: boolean;
    ps4Lan?: boolean;
    companionProvisioning?: boolean;
    microsoftDeviceCode?: boolean;
  };
  backupRecovery?: {
    reconciled?: number;
    manualRecoveryRequired?: number;
    globalRecoveryRequired?: number;
    initializationFailure?: {
      stage?: 'integration' | 'storage-roots' | 'authentication-key' | 'cleanup-recovery'
        | 'restore-recovery' | 'filesystem-safety-close' | 'unknown';
      code?: string;
      cause?: string;
    };
  };
};

type FamilyCatalog = {
  projectId?: 'family-server';
  updateChannel?: 'latest-compatible';
  latestMinecraftVersion?: string;
  minecraftVersion?: string;
  isLatestRelease?: boolean;
  requiredJavaMajor?: number;
  javaRuntimeComponent?: string;
  loader?: { name?: string; version?: string };
  java?: { requiredMajor?: number; managed?: boolean; vendor?: string };
  components?: {
    fabricApi?: { name?: string; version?: string };
    geyser?: { name?: string; version?: string };
    floodgate?: { name?: string; version?: string };
  };
};

type AccountStatus = {
  provider: 'microsoft';
  configured: boolean;
  signedIn: boolean;
  sessionReady: boolean;
  status: 'signed-out' | 'signed-in' | 'reauthentication-required';
  account?: { name: string } | null;
};

type AccountEnvelope = { ok?: boolean; account?: unknown };

type ManagedClientStatus = {
  targetInstanceId: 'family-server';
  state: 'not-installed' | 'installed' | 'invalid';
  integrity: 'not-installed' | 'verified' | 'failed';
  installed: boolean;
  minecraftVersion?: string;
  loader?: { name?: string; version?: string };
  requiredJavaMajor?: number;
  installedAt?: string | null;
  artifactCount?: number;
  nativeFiles?: number;
  launchReady: boolean;
  authenticationConfigured: boolean;
};

type ManagedClientEnvelope = { ok?: boolean; client?: unknown };

type DeviceFlowStatus = 'pending' | 'slow_down' | 'complete' | 'declined' | 'expired' | 'failed';

type DeviceFlow = {
  flowId: string;
  user_code: string;
  verification_uri: 'https://microsoft.com/devicelogin' | 'https://www.microsoft.com/link';
  expiry: string;
  status: DeviceFlowStatus;
};

type DeviceFlowEnvelope = { ok?: boolean; flow?: unknown };

type LogEntry = {
  at?: string;
  stream?: 'system' | 'stdout' | 'stderr';
  line?: string;
};

type InstanceEnvelope = { ok: true; instances: ManagedInstance[] };
type LogsEnvelope = { ok?: boolean; logs?: LogEntry[] };
type CatalogEnvelope = { ok?: boolean; catalog?: FamilyCatalog };

type LanStatus = {
  bindAddress?: string;
  addresses?: string[];
  bedrockPort?: number;
  portStatus?: 'available' | 'occupied' | 'unknown' | 'managed' | 'geyser-listening';
  owner?: { pid?: number; processName?: string };
  firewallRulesPresent?: boolean | null;
  localSubnetOnly?: boolean | null;
  checkedAt?: string;
};

type LanEnvelope = { ok?: boolean; lan?: LanStatus };

type LanFirewallResult = {
  action?: 'Enable';
  status?: 'requested' | 'completed' | 'pending' | 'cancelled' | 'error';
  code?: string;
};

type LanFirewallEnvelope = { ok?: boolean; lanFirewall?: LanFirewallResult };

type CompanionLifecycle = {
  state?: 'stopped' | 'starting' | 'running' | 'stopping' | 'failed' | 'orphaned';
  versionManifest?: {
    bridgeVersion?: string;
    minecraftVersion?: string;
    loaderVersion?: string;
    baritoneVersion?: string;
  } | null;
  startedAt?: string | null;
  stoppedAt?: string | null;
  lastError?: string | null;
};

type CompanionAction = {
  actionId?: string;
  kind?: string;
  status?: string;
  deadlineAt?: string;
  cancelRequestedAt?: string | null;
  terminal?: unknown;
};

type CompanionSnapshot = {
  phase?: 'main-menu' | 'connecting' | 'in-world';
  serverAlias?: 'family-server' | null;
  player?: { position?: { x?: number; y?: number; z?: number }; health?: number; maxHealth?: number } | null;
  baritone?: { state?: string; activeSkill?: string | null; goal?: unknown };
  safety?: { killSwitch?: boolean };
};

type CompanionStatus = {
  projectId?: 'family-server';
  targetInstanceId?: string;
  launchAvailable?: boolean;
  lifecycle?: CompanionLifecycle;
  bridge?: {
    state?: 'disconnected' | 'handshaking' | 'syncing' | 'ready';
    ready?: boolean;
    connectedAt?: string | null;
    lastHeartbeatAt?: string | null;
    lastSnapshotAt?: string | null;
    client?: { clientId?: string; bridgeVersion?: string; minecraftVersion?: string; loaderVersion?: string; baritoneVersion?: string } | null;
    capabilities?: string[];
    killSwitch?: boolean;
    activeAction?: CompanionAction | null;
    snapshot?: CompanionSnapshot | null;
    pendingShutdown?: unknown;
    lastDisconnect?: { at?: string; reason?: string; code?: number } | null;
  };
};

type CompanionEnvelope = { ok?: boolean; companion?: CompanionStatus };
type CompanionActionEnvelope = { ok?: boolean; action?: CompanionAction };
type CompanionCancellationEnvelope = { ok?: boolean; cancellation?: { action?: CompanionAction; alreadyTerminal?: boolean; alreadyRequested?: boolean } };

const FAMILY_BRAIN_FEATURE_NAMES = [
  'computerChat', 'companionConversation', 'modelReasoning', 'profileCapture',
  'physicalTaskPlanning', 'survivalAutomation', 'modRequestExecution',
  'inGameApprovals', 'visionRecovery',
] as const;
type FamilyBrainFeatureName = typeof FAMILY_BRAIN_FEATURE_NAMES[number];
type FamilyBrainFeatureState = 'planned' | 'stubbed' | 'implemented' | 'live-verified';
type FamilyBrainStatus = {
  schemaVersion: 1;
  flags: Record<FamilyBrainFeatureName, boolean>;
  states: Record<FamilyBrainFeatureName, FamilyBrainFeatureState>;
};
type FamilyBrainEnvelope = { ok?: boolean; brain?: unknown };

const FAMILY_BRAIN_LABELS: Record<FamilyBrainFeatureName, string> = {
  computerChat: 'Computer chat',
  companionConversation: 'Companion conversation',
  modelReasoning: 'Model reasoning',
  profileCapture: 'Profile capture',
  physicalTaskPlanning: 'Physical task planning',
  survivalAutomation: 'Survival automation',
  modRequestExecution: 'Mod request execution',
  inGameApprovals: 'In-game approvals',
  visionRecovery: 'Vision recovery',
};

type InstanceUpdateStatus = {
  state: 'current' | 'component-update-available' | 'minecraft-update-approval-required' | 'blocked-downgrade' | 'blocked-unknown-order';
  updateKind: 'current' | 'component' | 'upgrade' | 'legacy-migration' | 'downgrade' | 'unknown';
  planId: string;
  currentMinecraft: string;
  targetMinecraft: string;
  requiresApproval: boolean;
  checkedAt: string;
};

type UpdateTransaction = {
  transactionId: string;
  instanceId: string;
  phase: 'pending-readiness';
  updateKind: InstanceUpdateStatus['updateKind'];
  planId: string;
  backupAvailable: true;
  createdAt: string;
  updatedAt: string;
};
type UpdateStatusEnvelope = { ok: true; instanceId: string; update: InstanceUpdateStatus };
type UpdateActionEnvelope = { ok: boolean; updateResult: {
  action: 'current' | 'approval-required' | 'updated';
  instance: ManagedInstance;
  plan: InstanceUpdateStatus;
  transaction?: UpdateTransaction;
  readiness?: 'pending-unverified';
} };
type InstanceUpdateView = {
  loading: boolean;
  update?: InstanceUpdateStatus;
  completionUnknown?: boolean;
  error?: string;
};
type PendingInstanceUpdate = {
  instanceId: string;
  submittedAt: string;
  plan: InstanceUpdateStatus;
};

type RetiredVersionPurgeResult = {
  action: 'retired-version-purged';
  instanceId: string;
  transactionId: string;
  retiredMinecraftVersion: string;
  currentMinecraftVersion: string;
  backupAvailable: false;
  cacheEntriesPurged: number;
  purgedAt: string;
};

type RetiredVersionPurgeView = {
  pending: boolean;
  completionUnknown?: boolean;
  reconciledPurged?: boolean;
  reconciledRetained?: boolean;
  reconciliationBaseline?: PendingRetiredVersionPurge['baseline'];
  error?: string;
  result?: RetiredVersionPurgeResult;
};
type PendingRetiredVersionPurge = {
  instanceId: string;
  submittedAt: string;
  baseline: {
    previousMinecraftVersion: string;
    targetMinecraftVersion: string;
    verifiedAt: string;
  };
};

type BackupIntervalHours = 6 | 12 | 24 | 72 | 168;
type BackupKind = 'manual' | 'automatic' | 'rescue';
type BackupIntegrity = 'verified' | 'unverified' | 'failed';
type BackupRecord = {
  backupId: string;
  kind: BackupKind;
  createdAt: string;
  minecraftVersion: string;
  files: number;
  bytes: number;
  integrity: BackupIntegrity;
  verifiedAt: string | null;
  restorable: boolean;
  purgeable: boolean;
};
type BackupRetentionResult =
  | { state: 'applied' }
  | { state: 'failed'; code: 'BACKUP_RETENTION_FAILED' | 'BACKUP_STORAGE_FULL' };
type BackupPolicy = {
  enabled: boolean;
  intervalHours: BackupIntervalHours;
  retentionCount: number;
};
type BackupScheduleStatus = {
  state: 'idle' | 'due' | 'deferred-running' | 'creating' | 'restoring' | 'failed';
  due: boolean;
  deferred: boolean;
  lastAutomaticAttemptAt: string | null;
  lastAutomaticResult: string | null;
  nextDueAt: string | null;
  lastError: string | null;
};
type BackupInventory = {
  instanceId: string;
  policy: BackupPolicy;
  status: BackupScheduleStatus;
  backups: BackupRecord[];
};
type BackupPolicyDraft = BackupPolicy;
type RestorePlan = {
  planId: string;
  backupId: string;
  expiresAt: string;
  minecraftVersion: string;
  currentMinecraftVersion: string;
  safetySnapshotRequired: true;
};
type BackupCompletionUnknown =
  | { action: 'create'; startedAt: string; baselineBackupIds: string[] }
  | { action: 'policy'; startedAt: string; expectedPolicy: BackupPolicy }
  | { action: 'verify'; startedAt: string; backupId: string; previousIntegrity: BackupIntegrity; previousVerifiedAt: string | null }
  | { action: 'restore'; startedAt: string; backupId: string; previousRestoredAt: string | null }
  | { action: 'purge'; startedAt: string; backupId: string; baselineInventoryComplete: boolean };
type BackupReconciliationObservation = {
  startedAt: string;
  completedBarrierReads: number;
  inventory: BackupInventory;
  instance: ManagedInstance | null;
};
type BackupUnconfirmedResult = {
  action: BackupCompletionUnknown['action'];
  startedAt: string;
};

type AdminActionKind =
  | 'players.refresh'
  | 'whitelist.refresh'
  | 'broadcast'
  | 'whitelist.set'
  | 'whitelist.add'
  | 'whitelist.remove'
  | 'player.kick'
  | 'player.ban'
  | 'player.pardon'
  | 'player.op'
  | 'player.deop';
type AdminReasonCode = 'operator-request' | 'rule-violation' | 'unsafe-behavior';
type AdministrationStatus = {
  available: boolean;
  reason: 'ready' | 'instance-not-running' | 'process-unavailable';
  running: boolean;
  playerVisibility: 'unavailable';
  onlinePlayers: null;
  whitelist: { enabled: null; players: null };
  checkedAt: string;
};
type AdminOperation = {
  requestId: string;
  kind: AdminActionKind;
  player?: string;
  state: 'delivered-unconfirmed' | 'delivery-unknown' | 'rejected-before-delivery';
  application: 'unconfirmed' | 'not-delivered';
  updatedAt: string;
  outputRequested?: true;
};
type AdminAction =
  | { kind: 'players.refresh' | 'whitelist.refresh' }
  | { kind: 'broadcast'; message: string }
  | { kind: 'whitelist.set'; enabled: boolean }
  | { kind: 'whitelist.add' | 'whitelist.remove' | 'player.pardon' | 'player.op' | 'player.deop'; player: string }
  | { kind: 'player.kick' | 'player.ban'; player: string; reasonCode?: AdminReasonCode };
type AdminPlan = {
  planId: string;
  requestId: string;
  actionDigest: string;
  launchGeneration: string;
  confirmation: 'CONFIRM WHITELIST CHANGE' | 'CONFIRM PLAYER DISCIPLINE' | 'CONFIRM OPERATOR CHANGE';
  expiresAt: string;
};
type PendingAdminPlan = { plan: AdminPlan; action: AdminAction };
type PendingAdminOperation = {
  requestId: string;
  kind: AdminActionKind;
  player?: string;
  startedAt: string;
  observedState?: AdminOperation['state'];
};

type ModEnvironment = 'server_only' | 'dedicated_server_only' | 'server_only_client_optional';
type ModCatalogItem = {
  catalogRef: string;
  title: string;
  summary: string;
  author: string;
  compatibility: 'provisional';
};
type ModStack = { minecraftVersion: string; loader: 'fabric'; loaderVersion: string; generation: string; inventoryDigest: string };
type ModCatalogSearch = { stack: ModStack; query: string; offset: number; limit: number; totalHits: number; candidates: ModCatalogItem[] };
type ModProjectDetail = {
  catalogRef: string;
  title: string;
  summary: string;
  author: string;
  licenseId: string;
  compatibility: {
    state: 'compatible';
    reason: string | null;
    minecraftVersion: string;
    loader: 'fabric';
    environment: ModEnvironment;
    versionType: 'release';
    evidence: 'version-metadata';
  };
  selectedVersion: { versionNumber: string; publishedAt: string };
  graph: { nodeCount: number; requiredDependencyCount: number; totalBytes: number; warnings: string[]; digest: string };
};
type InstalledMod = {
  installedRef: string;
  title: string;
  versionNumber: string;
  environment: ModEnvironment;
  role: 'explicit' | 'dependency';
  requiredByCount: number;
  managedCore: false;
  installedAt: string;
};
type ModInventory = {
  stack: ModStack;
  recovery:
    | { required: false; transactionRef: null; state: null }
    | { required: true; transactionRef: string; state: 'completion-unknown' | 'manual-recovery-required' };
  installed: InstalledMod[];
  unmanaged: { present: boolean; count: number };
};
type ModPlanOperation = 'install' | 'update' | 'remove' | 'rollback';
type ModPlan = {
  planId: string;
  planDigest: string;
  requestId: string;
  operation: ModPlanOperation;
  requiredConfirmation: 'INSTALL THIRD-PARTY MOD CODE' | 'UPDATE THIRD-PARTY MOD CODE' | 'REMOVE MANAGED MODS' | 'RESTORE MOD SNAPSHOT';
  expiresAt: string;
  stackBinding: { minecraftVersion: string; loader: 'fabric'; loaderVersion: string; generation: string; inventoryDigest: string };
  rollbackSnapshot: { snapshotRef: string; state: 'reserved' };
  changes: {
    install: { title: string; versionNumber: string; environment: ModEnvironment; reason: 'requested' | 'required-dependency' }[];
    update: { title: string; fromVersion: string; toVersion: string; environment: ModEnvironment }[];
    remove: { title: string; versionNumber: string; reason: 'requested' | 'orphaned-dependency' }[];
  };
  dependentClosure: { state: 'clear' | 'blocked'; requiredBy: string[] };
  risk: { codeExecutesAsLocalUser: true; hashVerifiesBytesNotSafety: true };
};
type ModOperation = {
  requestId: string;
  planId: string;
  planDigest: string;
  operation: ModPlanOperation;
  state: 'committed' | 'rolled-back' | 'completion-unknown' | 'manual-recovery-required' | 'rejected-before-mutation';
  application: 'verified' | 'rolled-back-verified' | 'unknown' | 'not-applied';
  transactionRef: string;
  stackBefore: { generation: string; inventoryDigest: string };
  stackAfter: { generation: string; inventoryDigest: string } | null;
  rollbackSnapshot: { snapshotRef: string; state: 'verified' | 'restored-verified' | 'unavailable' };
  summary: { installedCount: number; updatedCount: number; removedCount: number };
  startedAt: string;
  updatedAt: string;
};
type PendingModOperation = {
  requestId: string;
  planId: string;
  planDigest: string;
  operation: ModPlanOperation;
  startedAt: string;
  observedState?: ModOperation['state'];
};
type ModPlanRequest =
  | { requestId: string; operation: 'install'; catalogRef: string }
  | { requestId: string; operation: 'update' | 'remove'; installedRef: string }
  | { requestId: string; operation: 'rollback'; transactionRef: string };
type PendingModPlanRequest = {
  request: ModPlanRequest;
  startedAt: string;
  state: 'resolving' | 'completion-unknown' | 'resolved';
};

type WorldState = 'active' | 'inactive' | 'archived';
type WorldIntegrity = 'verified' | 'pending-generation' | 'unverified-active' | 'locked-version';
type ManagedWorld = {
  worldRef: string;
  displayLabel: string;
  state: WorldState;
  pendingGeneration: boolean;
  minecraftVersion: string;
  dataVersion: number | null;
  createdAt: string;
  updatedAt: string;
  files: number;
  bytes: number;
  integrity: WorldIntegrity;
};
type WorldInventory = {
  generation: string;
  inventoryDigest: string;
  recovery:
    | { required: false; state: null; transactionRef: null }
    | { required: true; state: 'completion-unknown' | 'manual-recovery-required'; transactionRef: string };
  activeWorldRef: string;
  worlds: ManagedWorld[];
  limits: { maxWorlds: 12; maxWorldBytes: 17179869184; maxTotalBytes: 68719476736 };
};
type WorldPlanOperation = 'create' | 'clone' | 'rename' | 'archive' | 'switch';
type WorldPlanRequest =
  | { requestId: string; operation: 'create'; displayLabel: string }
  | { requestId: string; operation: 'clone' | 'rename'; targetWorldRef: string; displayLabel: string }
  | { requestId: string; operation: 'archive' | 'switch'; targetWorldRef: string };
type WorldPlanEndpoint = { worldRef: string; displayLabel: string; state: WorldState };
type WorldPlan = {
  planId: string;
  planDigest: string;
  requestId: string;
  operation: WorldPlanOperation;
  requiredConfirmation: 'CREATE NEW WORLD' | 'CLONE WORLD' | 'RENAME WORLD' | 'ARCHIVE WORLD' | 'SWITCH ACTIVE WORLD';
  expiresAt: string;
  source: WorldPlanEndpoint | null;
  target: WorldPlanEndpoint;
  changes: { worldRef: string; displayLabel: string; fromState: WorldState | null; toState: WorldState }[];
  safety: { requiresStopped: true; rescueBackupRequired: boolean; destructive: false };
  inventoryBinding: { generation: string; digest: string };
};
type WorldOperationState = 'committed' | 'rolled-back' | 'rejected-before-mutation' | 'completion-unknown' | 'manual-recovery-required';
type WorldMutationResult = {
  worldRef: string;
  displayLabel: string;
  state: WorldState;
  pendingGeneration: boolean;
  generation: string;
  inventoryDigest: string;
};
type WorldSwitchResult = {
  activeWorldRef: string;
  previousWorldRef: string;
  rescueVerified: true;
  pendingGeneration: boolean;
  generation: string;
  inventoryDigest: string;
};
type WorldOperation = {
  requestId: string;
  planId: string;
  planDigest: string;
  operation: WorldPlanOperation;
  state: WorldOperationState;
  application: 'verified' | 'rolled-back-verified' | 'not-applied' | 'unknown';
  transactionRef: string;
  failureCode: 'WORLD_RECOVERY_REQUIRED' | 'WORLD_PLAN_STALE' | 'WORLD_SOURCE_CHANGED' | 'WORLD_SNAPSHOT_FAILED' | 'WORLD_SWITCH_VERIFY_FAILED' | 'WORLD_STORAGE_FULL' | 'WORLD_OPERATION_FAILED' | null;
  result: WorldMutationResult | WorldSwitchResult | null;
  startedAt: string;
  updatedAt: string;
};
type PendingWorldExpectedResult =
  | {
    kind: 'world';
    worldRef: string;
    displayLabel: string;
    state: WorldState;
    pendingGeneration: boolean;
  }
  | {
    kind: 'switch';
    activeWorldRef: string;
    previousWorldRef: string;
    pendingGeneration: boolean;
  };
type PendingWorldOperation = {
  requestId: string;
  planId: string;
  planDigest: string;
  confirmation: WorldPlan['requiredConfirmation'];
  expiresAt: string;
  operation: WorldPlanOperation;
  submittedAt: string;
  baselineGeneration: string;
  baselineLastRestore: VerifiedWorldRestoreReceipt | null;
  expectedResult: PendingWorldExpectedResult;
};
type VerifiedWorldRestoreReceipt = {
  backupId: string;
  rescueBackupId: string;
  restoredAt: string;
  state: 'verified';
};

type ApiFailure = {
  status: number;
  code: string;
  message: string;
};

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: 'no-store' });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const object = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    throw new ApiError(
      response.status,
      typeof object.code === 'string' ? object.code : `HTTP_${response.status}`,
      typeof object.error === 'string'
        ? object.error
        : typeof object.message === 'string'
          ? object.message
          : `Request failed with HTTP ${response.status}`,
    );
  }
  return payload as T;
}

function familyBrainFromEnvelope(envelope: FamilyBrainEnvelope): FamilyBrainStatus {
  if (envelope.ok !== true || !envelope.brain || typeof envelope.brain !== 'object' || Array.isArray(envelope.brain)) {
    throw new Error('The local agent returned invalid companion foundation status.');
  }
  const brain = envelope.brain as Record<string, unknown>;
  if (brain.schemaVersion !== 1 || !brain.flags || typeof brain.flags !== 'object' || Array.isArray(brain.flags)
    || !brain.states || typeof brain.states !== 'object' || Array.isArray(brain.states)) {
    throw new Error('The local agent returned invalid companion foundation status.');
  }
  const flags = brain.flags as Record<string, unknown>;
  const states = brain.states as Record<string, unknown>;
  const allowedStates = new Set<FamilyBrainFeatureState>(['planned', 'stubbed', 'implemented', 'live-verified']);
  if (FAMILY_BRAIN_FEATURE_NAMES.some((feature) => (
    typeof flags[feature] !== 'boolean' || !allowedStates.has(states[feature] as FamilyBrainFeatureState)
  ))) throw new Error('The local agent returned invalid companion feature status.');
  return {
    schemaVersion: 1,
    flags: Object.fromEntries(FAMILY_BRAIN_FEATURE_NAMES.map((feature) => [feature, flags[feature]])) as Record<FamilyBrainFeatureName, boolean>,
    states: Object.fromEntries(FAMILY_BRAIN_FEATURE_NAMES.map((feature) => [feature, states[feature]])) as Record<FamilyBrainFeatureName, FamilyBrainFeatureState>,
  };
}

function failureOf(error: unknown): ApiFailure {
  if (error instanceof ApiError) return { status: error.status, code: error.code, message: error.message };
  return { status: 0, code: 'CONTROL_PLANE_OFFLINE', message: error instanceof Error ? error.message : String(error) };
}

function updateFailureMessage(error: unknown): string {
  const failure = failureOf(error);
  if (failure.code === 'CONTROL_RECOVERY_REQUIRED') {
    return 'Managed recovery evidence must be verified and repaired before local server mutations can continue.';
  }
  if (failure.code === 'MOD_MANUAL_RECOVERY_REQUIRED') {
    return 'Managed mod recovery requires verified repair before local server mutations can continue.';
  }
  if (failure.code === 'MOD_MUTATION_UNAVAILABLE') {
    return 'Managed Modrinth changes are read-only on this Windows safety boundary. Search and inventory remain available; install, update, remove, and rollback are disabled.';
  }
  if (failure.code === 'WORLD_RECOVERY_REQUIRED') {
    return 'Managed world recovery requires verified repair before local server mutations can continue.';
  }
  if (failure.code === 'UPDATE_BACKUP_RETENTION_REQUIRED') {
    return 'A prior update rollback or failed-candidate payload is still retained. Review and explicitly purge the retired version before starting another server update.';
  }
  if (failure.code === 'UPDATE_RECOVERY_REQUIRED') {
    return 'An interrupted server update still requires verified recovery. Start, stop, or update only after the local recovery fence is cleared.';
  }
  return failure.message;
}

function boundaryCopy(failure: ApiFailure): { title: string; detail: string } {
  switch (failure.code) {
    case 'LOCAL_CONTROL_REQUIRED':
      return {
        title: 'LOCAL COMMAND CENTER REQUIRED',
        detail: 'This hosted dashboard cannot manage programs or files on your PC. Open Mastermind locally with its Minecraft agent to enable server controls.',
      };
    case 'LOCAL_CONTROL_DISABLED':
      return {
        title: 'LOCAL CONTROL DISABLED',
        detail: 'The local command center is running in read-only mode. Enable the Minecraft control boundary in the local application before using server actions.',
      };
    case 'SIGN_IN_REQUIRED':
      return {
        title: 'OWNER SIGN-IN REQUIRED',
        detail: 'Sign in to the local Mastermind command center as its owner, then retry the connection.',
      };
    case 'OWNER_REQUIRED':
      return {
        title: 'OWNER ACCESS REQUIRED',
        detail: 'This session is not authorized to operate the local Minecraft agent.',
      };
    case 'CONTROL_RECOVERY_REQUIRED':
      return {
        title: 'MANAGED RECOVERY REQUIRED',
        detail: 'More than one managed recovery domain, or invalid recovery evidence, requires verified local repair. Server mutations remain locked while safe inventory and stop controls stay available.',
      };
    case 'MOD_MANUAL_RECOVERY_REQUIRED':
      return {
        title: 'MOD RECOVERY REQUIRED',
        detail: 'An interrupted managed mod transaction requires verified local repair. Server mutations remain locked while safe inventory and stop controls stay available.',
      };
    case 'MOD_MUTATION_UNAVAILABLE':
      return {
        title: 'MOD CHANGES READ-ONLY',
        detail: 'Search, compatibility evidence, and installed inventory remain available. Install, update, remove, and rollback are disabled on this Windows safety boundary.',
      };
    case 'WORLD_RECOVERY_REQUIRED':
      return {
        title: 'WORLD RECOVERY REQUIRED',
        detail: 'An interrupted managed world transaction requires verified local repair. Server mutations remain locked while safe inventory and stop controls stay available.',
      };
    case 'CONTROL_PLANE_OFFLINE':
      return {
        title: 'LOCAL AGENT OFFLINE',
        detail: 'Mastermind cannot reach the loopback-only Minecraft agent. Start the local command center, then use Retry connection.',
      };
    default:
      return {
        title: failure.status === 503 ? 'LOCAL AGENT UNAVAILABLE' : 'CONTROL REQUEST FAILED',
        detail: failure.message,
      };
  }
}

const panel: CSSProperties = {
  background: C.panel,
  border: `1px solid ${C.cyan}30`,
  borderRadius: 8,
  padding: 14,
  backdropFilter: 'blur(8px)',
};

const input: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'rgba(0,0,0,0.42)',
  border: `1px solid ${C.cyan}45`,
  borderRadius: 5,
  color: '#d9ffff',
  padding: '8px 10px',
  fontFamily: body,
  fontSize: 13,
  outlineOffset: 2,
};

const label: CSSProperties = {
  display: 'block',
  color: C.muted,
  fontFamily: mono,
  fontSize: 9,
  letterSpacing: 1.2,
  marginBottom: 5,
  textTransform: 'uppercase',
};

function Button({
  children,
  onClick,
  disabled = false,
  color = C.cyan,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  color?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        border: `1px solid ${disabled ? C.dim : color}`,
        borderRadius: 5,
        background: disabled ? 'rgba(255,255,255,0.03)' : `${color}12`,
        color: disabled ? C.dim : color,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: mono,
        fontSize: 9,
        letterSpacing: 1.2,
        opacity: disabled ? 0.6 : 1,
        outlineOffset: 2,
        padding: '7px 12px',
      }}
    >
      {children}
    </button>
  );
}

function Badge({ children, color = C.cyan }: { children: ReactNode; color?: string }) {
  return (
    <span style={{
      border: `1px solid ${color}55`,
      borderRadius: 3,
      color,
      fontFamily: mono,
      fontSize: 8,
      letterSpacing: 1,
      padding: '2px 6px',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

function Metric({ label: metricLabel, value, color = C.cyan }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ ...panel, padding: '10px 12px' }}>
      <div style={{ color: C.dim, fontFamily: mono, fontSize: 8, letterSpacing: 1.2 }}>{metricLabel}</div>
      <div style={{ color, fontFamily: mono, fontSize: 20, marginTop: 5, textShadow: `0 0 7px ${color}55` }}>{value}</div>
    </div>
  );
}

function stateColor(state: InstanceState): string {
  if (state === 'running') return C.green;
  if (state === 'starting' || state === 'stopping') return C.gold;
  if (state === 'failed') return C.red;
  return C.dim;
}

const PUBLIC_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_PROFILE_NAME = /^[A-Za-z0-9_]{1,16}$/;
const PUBLIC_USER_CODE = /^[A-Za-z0-9-]{4,32}$/;
const PUBLIC_TEXT = /^[^\x00-\x1f\x7f]{1,80}$/;
const PUBLIC_BACKUP_ID = /^bkp-[a-f0-9]{32}$/;
const PUBLIC_RESTORE_PLAN_ID = /^rst-[a-f0-9]{64}$/;
const PUBLIC_ADMIN_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_UPDATE_TRANSACTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PUBLIC_INSTANCE_ID = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const RETIRED_PURGE_STORAGE_PREFIX = 'mastermind.family-server.retired-version-purge.v1.';
const RETIRED_PURGE_LOCK_PREFIX = 'mastermind.family-server.retired-version-purge.lock.v1.';
const INSTANCE_UPDATE_STORAGE_PREFIX = 'mastermind.family-server.instance-update.v1.';
const INSTANCE_UPDATE_LOCK_PREFIX = 'mastermind.family-server.instance-update.lock.v1.';
const RETIRED_PURGE_NO_COMMIT_CODES = new Set([
  'LOCAL_CONTROL_REQUIRED', 'LOCAL_CONTROL_DISABLED', 'SIGN_IN_REQUIRED', 'OWNER_REQUIRED',
  'CONTROL_ACTION_NOT_ALLOWED', 'UNEXPECTED_BODY', 'INVALID_INSTANCE_ID', 'INSTANCE_NOT_FOUND',
  'CLEANUP_UNAVAILABLE', 'UPDATE_INVALID_STATE', 'UPDATE_RECOVERY_REQUIRED',
  'UPDATE_BACKUP_RETENTION_REQUIRED', 'BACKUP_MANUAL_RECOVERY_REQUIRED', 'CONTROL_RECOVERY_REQUIRED',
  'MOD_MANUAL_RECOVERY_REQUIRED', 'WORLD_RECOVERY_REQUIRED',
]);
const INSTANCE_UPDATE_NO_COMMIT_CODES = new Set([
  'BROWSER_LOCK_UNAVAILABLE', 'BROWSER_JOURNAL_UNAVAILABLE',
  'LOCAL_CONTROL_REQUIRED', 'LOCAL_CONTROL_DISABLED', 'SIGN_IN_REQUIRED', 'OWNER_REQUIRED',
  'CONTROL_ACTION_NOT_ALLOWED', 'UNEXPECTED_BODY', 'INVALID_INSTANCE_ID', 'INSTANCE_NOT_FOUND',
  'UPDATE_INVALID_STATE', 'UPDATE_APPROVAL_REQUIRED', 'UPDATE_RECOVERY_REQUIRED',
  'UPDATE_BACKUP_RETENTION_REQUIRED', 'BACKUP_MANUAL_RECOVERY_REQUIRED', 'CONTROL_RECOVERY_REQUIRED',
  'MOD_MANUAL_RECOVERY_REQUIRED', 'WORLD_RECOVERY_REQUIRED',
]);
const PUBLIC_ADMIN_PLAN_ID = /^admplan-[a-f0-9]{64}$/;
const PUBLIC_SHA256 = /^[a-f0-9]{64}$/;
const JAVA_PROFILE_NAME = /^[A-Za-z0-9_]{3,16}$/;
const PRINTABLE_ASCII_BROADCAST = /^[\x20-\x7e]{1,256}$/;
const ADMIN_PENDING_STORAGE_KEY = 'mastermind.family-server.admin.pending.v1';
const PUBLIC_MOD_CATALOG_REF = /^modref-[a-f0-9]{64}$/;
const PUBLIC_MOD_INSTALLED_REF = /^modinst-[a-f0-9]{64}$/;
const PUBLIC_MOD_PLAN_ID = /^modplan-[a-f0-9]{64}$/;
const PUBLIC_MOD_TRANSACTION_ID = /^modtx-[a-f0-9]{64}$/;
const PUBLIC_MOD_SNAPSHOT_REF = /^modsnap-[a-f0-9]{64}$/;
const PUBLIC_MOD_TEXT = /^[^\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]+$/u;
const MOD_PLAN_STORAGE_PREFIX = 'mastermind.family-server.mods.plan.v2.';
const MOD_OPERATION_STORAGE_PREFIX = 'mastermind.family-server.mods.operation.v2.';
const MOD_MUTATION_WEB_LOCK = 'mastermind.family-server.mods.mutation.v2';
const MAX_MOD_JOURNAL_ENTRIES = 8;
const MOD_ENVIRONMENTS = new Set<ModEnvironment>(['server_only', 'dedicated_server_only', 'server_only_client_optional']);
const PUBLIC_WORLD_REF = /^world-[a-f0-9]{64}$/;
const PUBLIC_WORLD_PLAN_ID = /^worldplan-[a-f0-9]{64}$/;
const PUBLIC_WORLD_TRANSACTION_REF = /^worldtx-[a-f0-9]{64}$/;
const WORLD_OPERATION_STORAGE_PREFIX = 'mastermind.family-server.worlds.operation.v1.';
const WORLD_MUTATION_WEB_LOCK = 'mastermind.family-server.worlds.mutation.v1';
const MAX_WORLD_JOURNAL_ENTRIES = 4;
const WORLD_CONFIRMATION_BY_OPERATION: Record<WorldPlanOperation, WorldPlan['requiredConfirmation']> = {
  create: 'CREATE NEW WORLD',
  clone: 'CLONE WORLD',
  rename: 'RENAME WORLD',
  archive: 'ARCHIVE WORLD',
  switch: 'SWITCH ACTIVE WORLD',
};
const WORLD_FAILURE_CODES = new Set<NonNullable<WorldOperation['failureCode']>>([
  'WORLD_RECOVERY_REQUIRED', 'WORLD_PLAN_STALE', 'WORLD_SOURCE_CHANGED', 'WORLD_SNAPSHOT_FAILED',
  'WORLD_SWITCH_VERIFY_FAILED', 'WORLD_STORAGE_FULL', 'WORLD_OPERATION_FAILED',
]);
const WORLD_AUTHORITATIVE_NO_COMMIT_CODES = new Set([
  'WORLD_PLAN_NOT_FOUND', 'BACKUP_MANUAL_RECOVERY_REQUIRED', 'CONTROL_RECOVERY_REQUIRED',
  'MOD_MANUAL_RECOVERY_REQUIRED', 'UPDATE_RECOVERY_REQUIRED',
  'UPDATE_BACKUP_RETENTION_REQUIRED',
]);
const MOD_AUTHORITATIVE_NO_COMMIT_CODES = new Set([
  'LOCAL_CONTROL_REQUIRED', 'LOCAL_CONTROL_DISABLED', 'SIGN_IN_REQUIRED', 'OWNER_REQUIRED', 'CONTROL_ACTION_NOT_ALLOWED',
  'UNSUPPORTED_CONTENT_ENCODING', 'INVALID_CONTENT_LENGTH', 'BODY_TOO_LARGE', 'CONTENT_LENGTH_MISMATCH', 'INVALID_JSON',
  'UNSAFE_FIELD_REJECTED', 'MOD_INVALID_REQUEST', 'MOD_INVALID_REF', 'MOD_INSTANCE_NOT_FOUND', 'MOD_SERVER_NOT_QUIESCENT',
  'MOD_CATALOG_EXPIRED', 'MOD_INCOMPATIBLE', 'MOD_DEPENDENCY_UNRESOLVED', 'MOD_CORE_PROTECTED',
  'MOD_PLAN_NOT_FOUND', 'MOD_WORLD_STATE_BLOCKED', 'MOD_MANUAL_RECOVERY_REQUIRED', 'MOD_MUTATION_UNAVAILABLE', 'WORLD_RECOVERY_REQUIRED',
  'BACKUP_MANUAL_RECOVERY_REQUIRED', 'CONTROL_RECOVERY_REQUIRED',
  'UPDATE_RECOVERY_REQUIRED', 'UPDATE_BACKUP_RETENTION_REQUIRED',
]);
const MOD_AUTHORITATIVE_PLAN_REJECT_CODES = new Set([
  'LOCAL_CONTROL_REQUIRED', 'LOCAL_CONTROL_DISABLED', 'SIGN_IN_REQUIRED', 'OWNER_REQUIRED', 'CONTROL_ACTION_NOT_ALLOWED',
  'UNSUPPORTED_CONTENT_ENCODING', 'INVALID_CONTENT_LENGTH', 'BODY_TOO_LARGE', 'CONTENT_LENGTH_MISMATCH', 'INVALID_JSON',
  'UNSAFE_FIELD_REJECTED', 'MOD_INVALID_REQUEST', 'MOD_INVALID_REF', 'MOD_INSTANCE_NOT_FOUND', 'MOD_SERVER_NOT_QUIESCENT',
  'MOD_CATALOG_EXPIRED', 'MOD_CATALOG_REF_EXPIRED', 'MOD_INCOMPATIBLE', 'MOD_DEPENDENCY_UNRESOLVED', 'MOD_DEPENDENT_ROOT_EXISTS', 'MOD_CORE_PROTECTED', 'MOD_REQUEST_ID_CONFLICT',
  'MOD_WORLD_STATE_BLOCKED', 'MOD_MUTATION_UNAVAILABLE',
  'MOD_MANUAL_RECOVERY_REQUIRED', 'WORLD_RECOVERY_REQUIRED', 'BACKUP_MANUAL_RECOVERY_REQUIRED',
  'CONTROL_RECOVERY_REQUIRED', 'UPDATE_RECOVERY_REQUIRED', 'UPDATE_BACKUP_RETENTION_REQUIRED',
]);
const MOD_MUTATIONS_RELEASE_ENABLED = false;
const ADMIN_ACTION_KINDS = new Set<AdminActionKind>([
  'players.refresh', 'whitelist.refresh', 'broadcast', 'whitelist.set', 'whitelist.add', 'whitelist.remove',
  'player.kick', 'player.ban', 'player.pardon', 'player.op', 'player.deop',
]);
const ADMIN_AUTHORITATIVE_NO_DELIVERY_CODES = new Set([
  'LOCAL_CONTROL_REQUIRED', 'LOCAL_CONTROL_DISABLED', 'SIGN_IN_REQUIRED', 'OWNER_REQUIRED', 'CONTROL_ACTION_NOT_ALLOWED',
  'UNSUPPORTED_CONTENT_ENCODING', 'INVALID_CONTENT_LENGTH', 'BODY_TOO_LARGE', 'CONTENT_LENGTH_MISMATCH', 'INVALID_JSON',
  'UNSAFE_FIELD_REJECTED', 'INVALID_ADMIN_ACTION', 'INVALID_ADMIN_REQUEST_ID', 'INVALID_JAVA_PLAYER',
  'INVALID_ADMIN_MESSAGE', 'INVALID_ADMIN_REASON', 'INVALID_ADMIN_APPROVAL', 'UNSUPPORTED_ADMIN_ACTION',
  'ADMIN_INVALID_REQUEST', 'ADMIN_INVALID_PLAYER', 'ADMIN_INVALID_MESSAGE', 'ADMIN_INVALID_REASON', 'ADMIN_ACTION_UNSUPPORTED',
  'ADMIN_APPROVAL_INVALID', 'ADMIN_APPROVAL_REQUIRED', 'ADMIN_AUDIT_UNAVAILABLE', 'ADMIN_INSTANCE_NOT_FOUND',
  'ADMIN_INVALID_INSTANCE', 'ADMIN_INVALID_INSTANCE_ID', 'ADMIN_JOURNAL_FULL', 'ADMIN_JOURNAL_UNAVAILABLE',
  'ADMIN_PLAN_EXPIRED', 'ADMIN_PLAN_NOT_REQUIRED', 'ADMIN_PROCESS_UNAVAILABLE', 'ADMIN_REQUEST_ID_CONFLICT',
  'ADMIN_SERVER_NOT_RUNNING',
]);
const BACKUP_INTERVALS = new Set<BackupIntervalHours>([6, 12, 24, 72, 168]);
const PUBLIC_VERIFICATION_URIS = new Set<DeviceFlow['verification_uri']>([
  'https://microsoft.com/devicelogin',
  'https://www.microsoft.com/link',
]);
const DEVICE_FLOW_STATES = new Set<DeviceFlowStatus>(['pending', 'slow_down', 'complete', 'declined', 'expired', 'failed']);

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function publicTimestamp(value: unknown, nullable = true): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('The local agent returned an invalid backup timestamp.');
  return new Date(value).toISOString();
}

function publicBackupText(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > 160 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`The local agent returned an invalid ${label}.`);
  }
  return value;
}

function retiredPurgeStorageKey(instanceId: string): string {
  return `${RETIRED_PURGE_STORAGE_PREFIX}${instanceId}`;
}

function pendingRetiredPurgeFromStorage(raw: string | null): PendingRetiredVersionPurge | null {
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('The persisted retired-version cleanup lock is invalid.'); }
  const source = objectOf(parsed);
  const baseline = objectOf(source?.baseline);
  if (!source || !baseline) throw new Error('The persisted retired-version cleanup lock is invalid.');
  exactPublicKeys(source, ['instanceId', 'submittedAt', 'baseline'], 'retired-version cleanup lock');
  exactPublicKeys(baseline, ['previousMinecraftVersion', 'targetMinecraftVersion', 'verifiedAt'], 'retired-version cleanup baseline');
  const submittedAt = publicTimestamp(source.submittedAt, false);
  const verifiedAt = publicTimestamp(baseline.verifiedAt, false);
  if (typeof source.instanceId !== 'string' || !PUBLIC_INSTANCE_ID.test(source.instanceId)
    || typeof baseline.previousMinecraftVersion !== 'string' || baseline.previousMinecraftVersion.length > 96
    || typeof baseline.targetMinecraftVersion !== 'string' || baseline.targetMinecraftVersion.length > 96) {
    throw new Error('The persisted retired-version cleanup lock is invalid.');
  }
  return {
    instanceId: source.instanceId,
    submittedAt: submittedAt as string,
    baseline: {
      previousMinecraftVersion: publicBackupText(baseline.previousMinecraftVersion, 'retired Minecraft version') as string,
      targetMinecraftVersion: publicBackupText(baseline.targetMinecraftVersion, 'current Minecraft version') as string,
      verifiedAt: verifiedAt as string,
    },
  };
}

async function withRetiredPurgeLock<T>(instanceId: string, callback: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) {
    throw new ApiError(409, 'BROWSER_LOCK_UNAVAILABLE', 'This browser cannot provide the cross-tab lock required for a destructive cleanup.');
  }
  return navigator.locks.request(`${RETIRED_PURGE_LOCK_PREFIX}${instanceId}`, { mode: 'exclusive' }, callback);
}

function backupRecordFromUnknown(value: unknown): BackupRecord {
  const source = objectOf(value);
  if (!source) throw new Error('The local agent returned an invalid backup record.');
  if (
    typeof source.backupId !== 'string' || !PUBLIC_BACKUP_ID.test(source.backupId)
    || !['manual', 'automatic', 'rescue'].includes(String(source.kind))
    || !Number.isSafeInteger(source.files) || Number(source.files) < 0
    || !Number.isSafeInteger(source.bytes) || Number(source.bytes) < 0
    || !['verified', 'unverified', 'failed'].includes(String(source.integrity))
    || typeof source.restorable !== 'boolean' || typeof source.purgeable !== 'boolean'
  ) throw new Error('The local agent returned an invalid backup record.');
  const integrity = source.integrity as BackupIntegrity;
  const verifiedAt = publicTimestamp(source.verifiedAt);
  if (integrity === 'verified' && verifiedAt === null) {
    throw new Error('The local agent returned inconsistent backup verification state.');
  }
  if (source.restorable && integrity !== 'verified') {
    throw new Error('The local agent marked an unverified backup as restorable.');
  }
  return {
    backupId: source.backupId,
    kind: source.kind as BackupKind,
    createdAt: publicTimestamp(source.createdAt, false) as string,
    minecraftVersion: publicBackupText(source.minecraftVersion, 'backup Minecraft version') as string,
    files: Number(source.files),
    bytes: Number(source.bytes),
    integrity,
    verifiedAt,
    restorable: source.restorable,
    purgeable: source.purgeable,
  };
}

function backupPolicyFromUnknown(value: unknown): BackupPolicy {
  const source = objectOf(value);
  if (
    !source || typeof source.enabled !== 'boolean'
    || !Number.isInteger(source.intervalHours) || !BACKUP_INTERVALS.has(Number(source.intervalHours) as BackupIntervalHours)
    || !Number.isInteger(source.retentionCount) || Number(source.retentionCount) < 3 || Number(source.retentionCount) > 30
  ) throw new Error('The local agent returned an invalid automatic-backup policy.');
  return {
    enabled: source.enabled,
    intervalHours: Number(source.intervalHours) as BackupIntervalHours,
    retentionCount: Number(source.retentionCount),
  };
}

function backupStatusFromUnknown(value: unknown): BackupScheduleStatus {
  const source = objectOf(value);
  if (
    !source || !['idle', 'due', 'deferred-running', 'creating', 'restoring', 'failed'].includes(String(source.state))
    || typeof source.due !== 'boolean' || typeof source.deferred !== 'boolean'
    || ((source.state === 'deferred-running') !== source.deferred)
    || (source.deferred && !source.due)
  ) throw new Error('The local agent returned an invalid backup schedule status.');
  return {
    state: source.state as BackupScheduleStatus['state'],
    due: source.due,
    deferred: source.deferred,
    lastAutomaticAttemptAt: publicTimestamp(source.lastAutomaticAttemptAt),
    lastAutomaticResult: publicBackupText(source.lastAutomaticResult, 'automatic backup result', true),
    nextDueAt: publicTimestamp(source.nextDueAt),
    lastError: publicBackupText(source.lastError, 'backup error', true),
  };
}

function backupInventoryFromUnknown(value: unknown, expectedInstanceId: string): BackupInventory {
  const source = objectOf(value);
  if (!source || source.ok !== true || source.instanceId !== expectedInstanceId || !Array.isArray(source.backups) || source.backups.length > 100) {
    throw new Error('The local agent returned an invalid backup inventory.');
  }
  return {
    instanceId: expectedInstanceId,
    policy: backupPolicyFromUnknown(source.policy),
    status: backupStatusFromUnknown(source.status),
    backups: source.backups.map(backupRecordFromUnknown),
  };
}

function backupFromActionEnvelope(value: unknown): BackupRecord {
  const source = objectOf(value);
  if (!source || source.ok !== true) throw new Error('The local agent did not confirm the backup action.');
  return backupRecordFromUnknown(source.backup);
}

function manualBackupFromActionEnvelope(value: unknown): { backup: BackupRecord; retention: BackupRetentionResult | null } {
  const source = objectOf(value);
  const rawBackup = objectOf(source?.backup);
  if (!source || source.ok !== true || !rawBackup) throw new Error('The local agent did not confirm manual backup creation.');
  const retention = objectOf(rawBackup.retention);
  if (!retention) return { backup: backupRecordFromUnknown(rawBackup), retention: null };
  if (retention.state === 'applied' && Object.keys(retention).length === 1) {
    return { backup: backupRecordFromUnknown(rawBackup), retention: { state: 'applied' } };
  }
  if (
    retention.state === 'failed'
    && ['BACKUP_RETENTION_FAILED', 'BACKUP_STORAGE_FULL'].includes(String(retention.code))
    && Object.keys(retention).length === 2
  ) {
    return {
      backup: backupRecordFromUnknown(rawBackup),
      retention: { state: 'failed', code: retention.code as 'BACKUP_RETENTION_FAILED' | 'BACKUP_STORAGE_FULL' },
    };
  }
  throw new Error('The local agent returned an invalid backup-retention result.');
}

function restorePlanFromUnknown(value: unknown, expectedBackupId: string): RestorePlan {
  const envelope = objectOf(value);
  const source = objectOf(envelope?.plan);
  if (
    envelope?.ok !== true || !source
    || typeof source.planId !== 'string' || !PUBLIC_RESTORE_PLAN_ID.test(source.planId)
    || source.backupId !== expectedBackupId || source.safetySnapshotRequired !== true
  ) throw new Error('The local agent returned an invalid backup restore plan.');
  return {
    planId: source.planId,
    backupId: expectedBackupId,
    expiresAt: publicTimestamp(source.expiresAt, false) as string,
    minecraftVersion: publicBackupText(source.minecraftVersion, 'restore Minecraft version') as string,
    currentMinecraftVersion: publicBackupText(source.currentMinecraftVersion, 'current Minecraft version') as string,
    safetySnapshotRequired: true,
  };
}

function formatBackupBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unit = -1;
  do { amount /= 1024; unit += 1; } while (amount >= 1024 && unit < units.length - 1);
  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unit]}`;
}

function formatBackupTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'never';
}

function exactPublicKeys(source: Record<string, unknown>, keys: string[], label: string) {
  const present = Object.keys(source);
  if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
    throw new Error(`The local agent returned an invalid ${label}.`);
  }
}

function retiredVersionPurgeEnvelopeFromUnknown(
  value: unknown,
  expectedInstanceId: string,
): RetiredVersionPurgeResult {
  const envelope = objectOf(value);
  if (!envelope) throw new Error('The local agent returned an invalid retired-version cleanup response.');
  exactPublicKeys(envelope, ['ok', 'cleanup'], 'retired-version cleanup envelope');
  const cleanup = objectOf(envelope.cleanup);
  if (envelope.ok !== true || !cleanup) {
    throw new Error('The local agent did not confirm the retired-version cleanup.');
  }
  exactPublicKeys(cleanup, [
    'action', 'instanceId', 'transactionId', 'retiredMinecraftVersion', 'currentMinecraftVersion',
    'backupAvailable', 'cacheEntriesPurged', 'purgedAt',
  ], 'retired-version cleanup');
  if (cleanup.action !== 'retired-version-purged' || cleanup.instanceId !== expectedInstanceId
    || typeof cleanup.transactionId !== 'string' || !PUBLIC_UPDATE_TRANSACTION_ID.test(cleanup.transactionId)
    || cleanup.backupAvailable !== false
    || !Number.isSafeInteger(cleanup.cacheEntriesPurged) || Number(cleanup.cacheEntriesPurged) < 0
    || Number(cleanup.cacheEntriesPurged) > 1_000_000) {
    throw new Error('The local agent returned an invalid retired-version cleanup result.');
  }
  return {
    action: 'retired-version-purged',
    instanceId: expectedInstanceId,
    transactionId: cleanup.transactionId,
    retiredMinecraftVersion: publicBackupText(cleanup.retiredMinecraftVersion, 'retired Minecraft version') as string,
    currentMinecraftVersion: publicBackupText(cleanup.currentMinecraftVersion, 'current Minecraft version') as string,
    backupAvailable: false,
    cacheEntriesPurged: cleanup.cacheEntriesPurged as number,
    purgedAt: publicTimestamp(cleanup.purgedAt, false) as string,
  };
}

function administrationFromUnknown(value: unknown): AdministrationStatus {
  const envelope = objectOf(value);
  if (!envelope) throw new Error('The local agent returned an invalid administration status.');
  exactPublicKeys(envelope, ['ok', 'instanceId', 'administration'], 'administration envelope');
  const source = objectOf(envelope.administration);
  if (envelope.ok !== true || envelope.instanceId !== 'family-server' || !source) {
    throw new Error('The local agent returned an invalid Family Server administration status.');
  }
  exactPublicKeys(source, ['available', 'reason', 'running', 'playerVisibility', 'onlinePlayers', 'whitelist', 'checkedAt'], 'administration status');
  const whitelist = objectOf(source.whitelist);
  if (!whitelist) throw new Error('The local agent returned invalid whitelist visibility.');
  exactPublicKeys(whitelist, ['enabled', 'players'], 'whitelist visibility');
  if (
    typeof source.available !== 'boolean'
    || !['ready', 'instance-not-running', 'process-unavailable'].includes(String(source.reason))
    || typeof source.running !== 'boolean'
    || source.playerVisibility !== 'unavailable'
    || source.onlinePlayers !== null
    || whitelist.enabled !== null
    || whitelist.players !== null
    || typeof source.checkedAt !== 'string'
    || !Number.isFinite(Date.parse(source.checkedAt))
    || source.available !== (source.reason === 'ready')
    || (source.reason === 'instance-not-running' && source.running)
  ) throw new Error('The local agent returned inconsistent Family Server administration status.');
  return {
    available: source.available,
    reason: source.reason as AdministrationStatus['reason'],
    running: source.running,
    playerVisibility: 'unavailable',
    onlinePlayers: null,
    whitelist: { enabled: null, players: null },
    checkedAt: new Date(source.checkedAt).toISOString(),
  };
}

function adminPlanFromUnknown(
  value: unknown,
  expectedRequestId: string,
): AdminPlan {
  const envelope = objectOf(value);
  if (!envelope) throw new Error('The local agent returned an invalid administration plan.');
  exactPublicKeys(envelope, ['ok', 'instanceId', 'plan'], 'administration plan envelope');
  const source = objectOf(envelope.plan);
  if (envelope.ok !== true || envelope.instanceId !== 'family-server' || !source) {
    throw new Error('The local agent did not return a Family Server administration plan.');
  }
  exactPublicKeys(source, ['planId', 'requestId', 'actionDigest', 'launchGeneration', 'confirmation', 'expiresAt'], 'administration plan');
  if (
    typeof source.planId !== 'string' || !PUBLIC_ADMIN_PLAN_ID.test(source.planId)
    || source.requestId !== expectedRequestId
    || typeof source.actionDigest !== 'string' || !PUBLIC_SHA256.test(source.actionDigest)
    || typeof source.launchGeneration !== 'string' || !PUBLIC_SHA256.test(source.launchGeneration)
    || !['CONFIRM WHITELIST CHANGE', 'CONFIRM PLAYER DISCIPLINE', 'CONFIRM OPERATOR CHANGE'].includes(String(source.confirmation))
    || typeof source.expiresAt !== 'string' || !Number.isFinite(Date.parse(source.expiresAt))
  ) throw new Error('The local agent returned a mismatched administration plan.');
  return {
    planId: source.planId,
    requestId: expectedRequestId,
    actionDigest: source.actionDigest,
    launchGeneration: source.launchGeneration,
    confirmation: source.confirmation as AdminPlan['confirmation'],
    expiresAt: new Date(source.expiresAt).toISOString(),
  };
}

function adminOperationFromUnknown(
  value: unknown,
  expected: { requestId: string; kind?: AdminActionKind; player?: string },
): AdminOperation {
  const envelope = objectOf(value);
  if (!envelope) throw new Error('The local agent returned an invalid administration operation.');
  exactPublicKeys(envelope, ['ok', 'instanceId', 'operation'], 'administration operation envelope');
  const source = objectOf(envelope.operation);
  if (envelope.ok !== true || envelope.instanceId !== 'family-server' || !source) {
    throw new Error('The local agent did not return a Family Server administration operation.');
  }
  const isRefresh = source.kind === 'players.refresh' || source.kind === 'whitelist.refresh';
  const expectedKeys = [
    'requestId', 'kind',
    'state', 'application', 'updatedAt',
    ...(isRefresh && source.state === 'delivered-unconfirmed' ? ['outputRequested'] : []),
  ];
  exactPublicKeys(source, expectedKeys, 'administration operation');
  if (
    typeof source.requestId !== 'string' || !PUBLIC_ADMIN_REQUEST_ID.test(source.requestId)
    || source.requestId !== expected.requestId
    || typeof source.kind !== 'string' || !ADMIN_ACTION_KINDS.has(source.kind as AdminActionKind)
    || (expected.kind !== undefined && source.kind !== expected.kind)
    || source.player !== undefined
    || !['delivered-unconfirmed', 'delivery-unknown', 'rejected-before-delivery'].includes(String(source.state))
    || !['unconfirmed', 'not-delivered'].includes(String(source.application))
    || (source.state === 'rejected-before-delivery') !== (source.application === 'not-delivered')
    || typeof source.updatedAt !== 'string' || !Number.isFinite(Date.parse(source.updatedAt))
    || (isRefresh && source.state === 'delivered-unconfirmed'
      && source.outputRequested !== true)
  ) throw new Error('The local agent returned a mismatched administration operation.');
  return {
    requestId: source.requestId,
    kind: source.kind as AdminActionKind,
    ...(expected.player === undefined ? {} : { player: expected.player }),
    state: source.state as AdminOperation['state'],
    application: source.application as AdminOperation['application'],
    updatedAt: new Date(source.updatedAt).toISOString(),
    ...(source.outputRequested === true ? { outputRequested: true as const } : {}),
  };
}

function pendingAdminOperationFromStorage(value: string | null): PendingAdminOperation | null {
  if (!value) return null;
  try {
    const source = objectOf(JSON.parse(value));
    if (!source) return null;
    const keys = [
      'requestId', 'kind', 'startedAt',
      ...(source.player === undefined ? [] : ['player']),
      ...(source.observedState === undefined ? [] : ['observedState']),
    ];
    exactPublicKeys(source, keys, 'pending administration operation');
    if (
      typeof source.requestId !== 'string' || !PUBLIC_ADMIN_REQUEST_ID.test(source.requestId)
      || typeof source.kind !== 'string' || !ADMIN_ACTION_KINDS.has(source.kind as AdminActionKind)
      || (source.player !== undefined && (typeof source.player !== 'string' || !JAVA_PROFILE_NAME.test(source.player)))
      || (source.observedState !== undefined && !['delivered-unconfirmed', 'delivery-unknown', 'rejected-before-delivery'].includes(String(source.observedState)))
      || typeof source.startedAt !== 'string' || !Number.isFinite(Date.parse(source.startedAt))
    ) return null;
    return {
      requestId: source.requestId.toLowerCase(),
      kind: source.kind as AdminActionKind,
      ...(source.player === undefined ? {} : { player: source.player }),
      startedAt: new Date(source.startedAt).toISOString(),
      ...(source.observedState === undefined ? {} : { observedState: source.observedState as AdminOperation['state'] }),
    };
  } catch {
    return null;
  }
}

function publicModText(value: unknown, max: number, label: string, allowEmpty = false): string {
  if (
    typeof value !== 'string' || value.length > max || (!allowEmpty && value.length < 1)
    || (value.length > 0 && !PUBLIC_MOD_TEXT.test(value))
  ) throw new Error(`The local agent returned invalid ${label}.`);
  return value;
}

function publicModInteger(value: unknown, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) {
    throw new Error(`The local agent returned invalid ${label}.`);
  }
  return Number(value);
}

function modStackFromUnknown(value: unknown, label: string): ModStack {
  const stack = objectOf(value);
  if (!stack) throw new Error(`The local agent returned invalid ${label}.`);
  exactPublicKeys(stack, ['minecraftVersion', 'loader', 'loaderVersion', 'generation', 'inventoryDigest'], label);
  if (
    stack.loader !== 'fabric'
    || typeof stack.generation !== 'string' || !PUBLIC_SHA256.test(stack.generation)
    || typeof stack.inventoryDigest !== 'string' || !PUBLIC_SHA256.test(stack.inventoryDigest)
  ) throw new Error(`The local agent returned invalid ${label}.`);
  return {
    minecraftVersion: publicModText(stack.minecraftVersion, 128, `${label} Minecraft version`),
    loader: 'fabric',
    loaderVersion: publicModText(stack.loaderVersion, 128, `${label} Fabric loader version`),
    generation: stack.generation,
    inventoryDigest: stack.inventoryDigest,
  };
}

function modCatalogSearchFromUnknown(value: unknown, expectedQuery: string): ModCatalogSearch {
  const envelope = objectOf(value);
  if (!envelope) throw new Error('The local agent returned invalid Modrinth search data.');
  exactPublicKeys(envelope, ['ok', 'instanceId', 'stack', 'catalog'], 'Modrinth search envelope');
  const source = objectOf(envelope.catalog);
  if (envelope.ok !== true || envelope.instanceId !== 'family-server' || !source) throw new Error('The local agent returned invalid Family Server search data.');
  const stack = modStackFromUnknown(envelope.stack, 'Modrinth search stack');
  exactPublicKeys(source, ['query', 'offset', 'limit', 'totalHits', 'candidates'], 'Modrinth search result');
  if (
    source.query !== expectedQuery || !Number.isInteger(source.offset) || Number(source.offset) < 0 || Number(source.offset) > 1_000
    || !Number.isInteger(source.limit) || Number(source.limit) < 1 || Number(source.limit) > 20
    || !Number.isSafeInteger(source.totalHits) || Number(source.totalHits) < 0
    || !Array.isArray(source.candidates) || source.candidates.length > Number(source.limit) || source.candidates.length > 20
  ) throw new Error('The local agent returned inconsistent Modrinth search data.');
  const candidates = source.candidates.map((item): ModCatalogItem => {
    const record = objectOf(item);
    if (!record) throw new Error('The local agent returned an invalid Modrinth search item.');
    exactPublicKeys(record, ['catalogRef', 'title', 'summary', 'author', 'compatibility'], 'Modrinth search item');
    if (
      typeof record.catalogRef !== 'string' || !PUBLIC_MOD_CATALOG_REF.test(record.catalogRef)
      || record.compatibility !== 'provisional'
    ) throw new Error('The local agent returned an invalid Modrinth search item.');
    return {
      catalogRef: record.catalogRef,
      title: publicModText(record.title, 128, 'mod title'),
      summary: publicModText(record.summary, 512, 'mod summary', true),
      author: publicModText(record.author, 64, 'mod author'),
      compatibility: 'provisional',
    };
  });
  return { stack, query: expectedQuery, offset: Number(source.offset), limit: Number(source.limit), totalHits: Number(source.totalHits), candidates };
}

function modProjectFromUnknown(value: unknown, expectedRef: string): ModProjectDetail {
  const envelope = objectOf(value);
  if (!envelope) throw new Error('The local agent returned invalid Modrinth project evidence.');
  exactPublicKeys(envelope, ['ok', 'instanceId', 'detail'], 'Modrinth project envelope');
  const source = objectOf(envelope.detail);
  if (envelope.ok !== true || envelope.instanceId !== 'family-server' || !source) throw new Error('The local agent returned invalid Family Server project evidence.');
  exactPublicKeys(source, ['catalogRef', 'title', 'summary', 'author', 'licenseId', 'compatibility', 'selectedVersion', 'graph'], 'Modrinth project evidence');
  const compatibility = objectOf(source.compatibility);
  const selectedVersion = objectOf(source.selectedVersion);
  const graph = objectOf(source.graph);
  if (
    source.catalogRef !== expectedRef || !compatibility || !selectedVersion || !graph
  ) throw new Error('The local agent returned inconsistent Modrinth project evidence.');
  exactPublicKeys(compatibility, ['state', 'reason', 'minecraftVersion', 'loader', 'environment', 'versionType', 'evidence'], 'compatible mod evidence');
  if (
    compatibility.state !== 'compatible' || compatibility.reason !== null || compatibility.loader !== 'fabric'
    || compatibility.versionType !== 'release' || compatibility.evidence !== 'version-metadata'
    || typeof compatibility.environment !== 'string' || !MOD_ENVIRONMENTS.has(compatibility.environment as ModEnvironment)
  ) {
    throw new Error('The local agent did not return an allowed dedicated-server mod environment.');
  }
  exactPublicKeys(selectedVersion, ['versionNumber', 'publishedAt'], 'selected compatible mod version');
  if (typeof selectedVersion.publishedAt !== 'string' || !Number.isFinite(Date.parse(selectedVersion.publishedAt))) {
    throw new Error('The local agent returned invalid compatible mod publication evidence.');
  }
  exactPublicKeys(graph, ['nodeCount', 'requiredDependencyCount', 'totalBytes', 'warnings', 'digest'], 'compatible mod graph evidence');
  if (
    !Number.isInteger(graph.nodeCount) || Number(graph.nodeCount) < 1 || Number(graph.nodeCount) > 64
    || !Number.isInteger(graph.requiredDependencyCount) || Number(graph.requiredDependencyCount) < 0 || Number(graph.requiredDependencyCount) > 63
    || !Number.isSafeInteger(graph.totalBytes) || Number(graph.totalBytes) < 1 || Number(graph.totalBytes) > 536_870_912
    || !Array.isArray(graph.warnings) || graph.warnings.length > 16
    || typeof graph.digest !== 'string' || !PUBLIC_SHA256.test(graph.digest)
    || graph.warnings.some((warning) => !['optional-dependencies-not-installed', 'server-metadata-not-bedrock-proof'].includes(String(warning)))
  ) throw new Error('The local agent returned invalid compatible mod graph evidence.');
  return {
    catalogRef: expectedRef,
    title: publicModText(source.title, 128, 'mod title'),
    summary: publicModText(source.summary, 512, 'mod summary', true),
    author: publicModText(source.author, 64, 'mod author'),
    licenseId: publicModText(source.licenseId, 64, 'mod license ID'),
    compatibility: {
      state: 'compatible',
      reason: null,
      minecraftVersion: publicModText(compatibility.minecraftVersion, 128, 'compatible Minecraft version'),
      loader: 'fabric',
      environment: compatibility.environment as ModEnvironment,
      versionType: 'release',
      evidence: 'version-metadata',
    },
    selectedVersion: {
      versionNumber: publicModText(selectedVersion.versionNumber, 128, 'compatible mod version'),
      publishedAt: new Date(selectedVersion.publishedAt).toISOString(),
    },
    graph: {
      nodeCount: Number(graph.nodeCount),
      requiredDependencyCount: Number(graph.requiredDependencyCount),
      totalBytes: Number(graph.totalBytes),
      warnings: graph.warnings.map((warning) => String(warning)),
      digest: graph.digest,
    },
  };
}

function modInventoryFromUnknown(value: unknown): ModInventory {
  const envelope = objectOf(value);
  if (!envelope) throw new Error('The local agent returned invalid mod inventory.');
  exactPublicKeys(envelope, ['ok', 'instanceId', 'stack', 'recovery', 'installed', 'unmanaged'], 'mod inventory envelope');
  if (envelope.ok !== true || envelope.instanceId !== 'family-server' || !Array.isArray(envelope.installed) || envelope.installed.length > 64) {
    throw new Error('The local agent returned invalid Family Server mod inventory.');
  }
  const recovery = objectOf(envelope.recovery);
  const unmanaged = objectOf(envelope.unmanaged);
  if (!recovery || !unmanaged) throw new Error('The local agent returned inconsistent mod inventory.');
  const stack = modStackFromUnknown(envelope.stack, 'mod inventory stack');
  exactPublicKeys(recovery, ['required', 'transactionRef', 'state'], 'mod recovery fence');
  const recoveryClear = recovery.required === false && recovery.transactionRef === null && recovery.state === null;
  const recoveryRequired = recovery.required === true
    && typeof recovery.transactionRef === 'string' && PUBLIC_MOD_TRANSACTION_ID.test(recovery.transactionRef)
    && ['completion-unknown', 'manual-recovery-required'].includes(String(recovery.state));
  if (!recoveryClear && !recoveryRequired) throw new Error('The local agent returned invalid mod recovery-fence state.');
  exactPublicKeys(unmanaged, ['present', 'count'], 'unmanaged mod count');
  if (
    typeof unmanaged.present !== 'boolean' || !Number.isInteger(unmanaged.count)
    || Number(unmanaged.count) < 0 || Number(unmanaged.count) > 500
    || unmanaged.present !== (Number(unmanaged.count) > 0)
  ) throw new Error('The local agent returned inconsistent unmanaged mod state.');
  const installed = envelope.installed.map((item): InstalledMod => {
    const record = objectOf(item); if (!record) throw new Error('The local agent returned invalid installed-mod inventory.');
    exactPublicKeys(record, ['installedRef', 'title', 'versionNumber', 'environment', 'role', 'requiredByCount', 'managedCore', 'installedAt'], 'installed mod');
    if (
      typeof record.installedRef !== 'string' || !PUBLIC_MOD_INSTALLED_REF.test(record.installedRef)
      || typeof record.environment !== 'string' || !MOD_ENVIRONMENTS.has(record.environment as ModEnvironment)
      || !['explicit', 'dependency'].includes(String(record.role))
      || !Number.isInteger(record.requiredByCount) || Number(record.requiredByCount) < 0 || Number(record.requiredByCount) > 64
      || record.managedCore !== false
      || typeof record.installedAt !== 'string' || !Number.isFinite(Date.parse(record.installedAt))
    ) {
      throw new Error('The local agent returned invalid installed-mod inventory.');
    }
    return {
      installedRef: record.installedRef,
      title: publicModText(record.title, 128, 'installed mod title'),
      versionNumber: publicModText(record.versionNumber, 128, 'installed mod version'),
      environment: record.environment as ModEnvironment,
      role: record.role as InstalledMod['role'],
      requiredByCount: Number(record.requiredByCount),
      managedCore: false,
      installedAt: new Date(record.installedAt).toISOString(),
    };
  });
  if (new Set(installed.map((mod) => mod.installedRef)).size !== installed.length) throw new Error('The local agent returned duplicate installed-mod references.');
  return {
    stack,
    recovery: recoveryClear
      ? { required: false, transactionRef: null, state: null }
      : { required: true, transactionRef: recovery.transactionRef as string, state: recovery.state as 'completion-unknown' | 'manual-recovery-required' },
    installed,
    unmanaged: { present: unmanaged.present as boolean, count: Number(unmanaged.count) },
  };
}

function modPlanFromUnknown(value: unknown, expectedRequestId: string): ModPlan {
  const envelope = objectOf(value);
  if (!envelope) throw new Error('The local agent returned invalid mod transaction plan.');
  exactPublicKeys(envelope, ['ok', 'instanceId', 'plan'], 'mod plan envelope');
  const source = objectOf(envelope.plan);
  if (envelope.ok !== true || envelope.instanceId !== 'family-server' || !source) throw new Error('The local agent returned invalid Family Server mod plan.');
  exactPublicKeys(source, [
    'planId', 'planDigest', 'requestId', 'operation', 'requiredConfirmation', 'expiresAt', 'stackBinding',
    'rollbackSnapshot', 'changes', 'dependentClosure', 'risk',
  ], 'mod transaction plan');
  const stackBinding = objectOf(source.stackBinding);
  const rollbackSnapshot = objectOf(source.rollbackSnapshot);
  const changes = objectOf(source.changes);
  const dependentClosure = objectOf(source.dependentClosure);
  const risk = objectOf(source.risk);
  if (
    typeof source.planId !== 'string' || !PUBLIC_MOD_PLAN_ID.test(source.planId)
    || typeof source.planDigest !== 'string' || !PUBLIC_SHA256.test(source.planDigest)
    || source.requestId !== expectedRequestId || !['install', 'update', 'remove', 'rollback'].includes(String(source.operation))
    || !['INSTALL THIRD-PARTY MOD CODE', 'UPDATE THIRD-PARTY MOD CODE', 'REMOVE MANAGED MODS', 'RESTORE MOD SNAPSHOT'].includes(String(source.requiredConfirmation))
    || typeof source.expiresAt !== 'string' || !Number.isFinite(Date.parse(source.expiresAt))
    || !stackBinding || !rollbackSnapshot || !changes || !dependentClosure || !risk
  ) throw new Error('The local agent returned inconsistent mod transaction plan.');
  const operation = source.operation as ModPlanOperation;
  const expectedConfirmation: Record<ModPlanOperation, ModPlan['requiredConfirmation']> = {
    install: 'INSTALL THIRD-PARTY MOD CODE',
    update: 'UPDATE THIRD-PARTY MOD CODE',
    remove: 'REMOVE MANAGED MODS',
    rollback: 'RESTORE MOD SNAPSHOT',
  };
  if (source.requiredConfirmation !== expectedConfirmation[operation]) {
    throw new Error('The local agent returned a mismatched mod approval phrase.');
  }
  exactPublicKeys(stackBinding, ['minecraftVersion', 'loader', 'loaderVersion', 'generation', 'inventoryDigest'], 'mod plan stack binding');
  if (
    stackBinding.loader !== 'fabric'
    || typeof stackBinding.generation !== 'string' || !PUBLIC_SHA256.test(stackBinding.generation)
    || typeof stackBinding.inventoryDigest !== 'string' || !PUBLIC_SHA256.test(stackBinding.inventoryDigest)
  ) throw new Error('The local agent returned invalid mod plan stack binding.');
  exactPublicKeys(rollbackSnapshot, ['snapshotRef', 'state'], 'reserved mod rollback snapshot');
  if (typeof rollbackSnapshot.snapshotRef !== 'string' || !PUBLIC_MOD_SNAPSHOT_REF.test(rollbackSnapshot.snapshotRef) || rollbackSnapshot.state !== 'reserved') {
    throw new Error('The local agent returned invalid reserved mod rollback snapshot.');
  }
  exactPublicKeys(changes, ['install', 'update', 'remove'], 'mod plan changes');
  if (![changes.install, changes.update, changes.remove].every((items) => Array.isArray(items) && items.length <= 64)) {
    throw new Error('The local agent returned invalid mod plan changes.');
  }
  const totalChanges = (changes.install as unknown[]).length + (changes.update as unknown[]).length
    + (changes.remove as unknown[]).length;
  if (totalChanges < 1 || totalChanges > 64) throw new Error('The local agent returned an invalid mod change closure size.');
  const install = (changes.install as unknown[]).map((item) => {
    const record = objectOf(item); if (!record) throw new Error('The local agent returned invalid mod install closure.');
    exactPublicKeys(record, ['title', 'versionNumber', 'environment', 'reason'], 'mod install closure');
    if (typeof record.environment !== 'string' || !MOD_ENVIRONMENTS.has(record.environment as ModEnvironment) || !['requested', 'required-dependency'].includes(String(record.reason))) {
      throw new Error('The local agent returned invalid mod install closure.');
    }
    return { title: publicModText(record.title, 128, 'planned mod title'), versionNumber: publicModText(record.versionNumber, 128, 'planned mod version'), environment: record.environment as ModEnvironment, reason: record.reason as 'requested' | 'required-dependency' };
  });
  const update = (changes.update as unknown[]).map((item) => {
    const record = objectOf(item); if (!record) throw new Error('The local agent returned invalid mod update closure.');
    exactPublicKeys(record, ['title', 'fromVersion', 'toVersion', 'environment'], 'mod update closure');
    if (typeof record.environment !== 'string' || !MOD_ENVIRONMENTS.has(record.environment as ModEnvironment)) throw new Error('The local agent returned invalid mod update closure.');
    return { title: publicModText(record.title, 128, 'planned mod title'), fromVersion: publicModText(record.fromVersion, 128, 'source mod version'), toVersion: publicModText(record.toVersion, 128, 'target mod version'), environment: record.environment as ModEnvironment };
  });
  const remove = (changes.remove as unknown[]).map((item) => {
    const record = objectOf(item); if (!record) throw new Error('The local agent returned invalid mod removal closure.');
    exactPublicKeys(record, ['title', 'versionNumber', 'reason'], 'mod removal closure');
    if (!['requested', 'orphaned-dependency'].includes(String(record.reason))) throw new Error('The local agent returned invalid mod removal closure.');
    return { title: publicModText(record.title, 128, 'planned mod title'), versionNumber: publicModText(record.versionNumber, 128, 'planned mod version'), reason: record.reason as 'requested' | 'orphaned-dependency' };
  });
  exactPublicKeys(dependentClosure, ['state', 'requiredBy'], 'mod dependent closure');
  if (!['clear', 'blocked'].includes(String(dependentClosure.state)) || !Array.isArray(dependentClosure.requiredBy) || dependentClosure.requiredBy.length > 64) {
    throw new Error('The local agent returned invalid mod dependent closure.');
  }
  const requiredBy = dependentClosure.requiredBy.map((title) => publicModText(title, 128, 'dependent mod title'));
  if ((dependentClosure.state === 'clear') !== (requiredBy.length === 0)) throw new Error('The local agent returned inconsistent mod dependent closure.');
  exactPublicKeys(risk, ['codeExecutesAsLocalUser', 'hashVerifiesBytesNotSafety'], 'mod code risk');
  if (risk.codeExecutesAsLocalUser !== true || risk.hashVerifiesBytesNotSafety !== true) throw new Error('The local agent returned invalid mod code-risk evidence.');
  return {
    planId: source.planId,
    planDigest: source.planDigest,
    requestId: expectedRequestId,
    operation,
    requiredConfirmation: source.requiredConfirmation as ModPlan['requiredConfirmation'],
    expiresAt: new Date(source.expiresAt).toISOString(),
    stackBinding: {
      minecraftVersion: publicModText(stackBinding.minecraftVersion, 128, 'plan Minecraft version'),
      loader: 'fabric', loaderVersion: publicModText(stackBinding.loaderVersion, 128, 'plan Fabric loader version'),
      generation: stackBinding.generation, inventoryDigest: stackBinding.inventoryDigest,
    },
    rollbackSnapshot: { snapshotRef: rollbackSnapshot.snapshotRef, state: 'reserved' },
    changes: { install, update, remove },
    dependentClosure: { state: dependentClosure.state as 'clear' | 'blocked', requiredBy },
    risk: { codeExecutesAsLocalUser: true, hashVerifiesBytesNotSafety: true },
  };
}

function modOperationFromUnknown(value: unknown, expected: Pick<PendingModOperation, 'requestId' | 'planId' | 'planDigest' | 'operation'>): ModOperation {
  const envelope = objectOf(value);
  if (!envelope) throw new Error('The local agent returned invalid mod transaction state.');
  exactPublicKeys(envelope, ['ok', 'instanceId', 'operation'], 'mod operation envelope');
  const source = objectOf(envelope.operation);
  if (envelope.ok !== true || envelope.instanceId !== 'family-server' || !source) throw new Error('The local agent returned invalid Family Server mod transaction state.');
  exactPublicKeys(source, [
    'requestId', 'planId', 'planDigest', 'operation', 'state', 'application', 'transactionRef', 'stackBefore', 'stackAfter',
    'rollbackSnapshot', 'summary', 'startedAt', 'updatedAt',
  ], 'mod operation');
  const before = objectOf(source.stackBefore);
  const after = source.stackAfter === null ? null : objectOf(source.stackAfter);
  const rollbackSnapshot = objectOf(source.rollbackSnapshot);
  const summary = objectOf(source.summary);
  if (
    source.requestId !== expected.requestId || source.planId !== expected.planId || source.planDigest !== expected.planDigest || source.operation !== expected.operation
    || !['committed', 'rolled-back', 'completion-unknown', 'manual-recovery-required', 'rejected-before-mutation'].includes(String(source.state))
    || !['verified', 'rolled-back-verified', 'unknown', 'not-applied'].includes(String(source.application))
    || typeof source.transactionRef !== 'string' || !PUBLIC_MOD_TRANSACTION_ID.test(source.transactionRef)
    || !before || (source.stackAfter !== null && !after) || !rollbackSnapshot || !summary
    || typeof source.startedAt !== 'string' || !Number.isFinite(Date.parse(source.startedAt))
    || typeof source.updatedAt !== 'string' || !Number.isFinite(Date.parse(source.updatedAt))
    || Date.parse(source.updatedAt) < Date.parse(source.startedAt)
  ) throw new Error('The local agent returned inconsistent mod transaction state.');
  exactPublicKeys(before, ['generation', 'inventoryDigest'], 'pre-transaction mod stack');
  if (typeof before.generation !== 'string' || !PUBLIC_SHA256.test(before.generation) || typeof before.inventoryDigest !== 'string' || !PUBLIC_SHA256.test(before.inventoryDigest)) {
    throw new Error('The local agent returned invalid pre-transaction mod stack.');
  }
  if (after) {
    exactPublicKeys(after, ['generation', 'inventoryDigest'], 'post-transaction mod stack');
    if (typeof after.generation !== 'string' || !PUBLIC_SHA256.test(after.generation) || typeof after.inventoryDigest !== 'string' || !PUBLIC_SHA256.test(after.inventoryDigest)) {
      throw new Error('The local agent returned invalid post-transaction mod stack.');
    }
  }
  exactPublicKeys(rollbackSnapshot, ['snapshotRef', 'state'], 'mod rollback snapshot');
  if (typeof rollbackSnapshot.snapshotRef !== 'string' || !PUBLIC_MOD_SNAPSHOT_REF.test(rollbackSnapshot.snapshotRef) || !['verified', 'restored-verified', 'unavailable'].includes(String(rollbackSnapshot.state))) {
    throw new Error('The local agent returned invalid mod rollback snapshot.');
  }
  exactPublicKeys(summary, ['installedCount', 'updatedCount', 'removedCount'], 'mod transaction summary');
  const installedCount = publicModInteger(summary.installedCount, 64, 'installed mod count');
  const updatedCount = publicModInteger(summary.updatedCount, 64, 'updated mod count');
  const removedCount = publicModInteger(summary.removedCount, 64, 'removed mod count');
  if (installedCount + updatedCount + removedCount > 64) throw new Error('The local agent returned an invalid mod transaction summary size.');
  const state = source.state as ModOperation['state'];
  const application = source.application as ModOperation['application'];
  if (
    (state === 'committed' && (application !== 'verified' || !after || rollbackSnapshot.state !== 'verified'))
    || (state === 'rolled-back' && (
      application !== 'rolled-back-verified' || !after || rollbackSnapshot.state !== 'restored-verified'
      || after.generation !== before.generation || after.inventoryDigest !== before.inventoryDigest
    ))
    || (state === 'completion-unknown' && (application !== 'unknown' || after !== null || !['verified', 'unavailable'].includes(String(rollbackSnapshot.state))))
    || (state === 'manual-recovery-required' && (application !== 'unknown' || after !== null || rollbackSnapshot.state !== 'unavailable'))
    || (state === 'rejected-before-mutation' && (application !== 'not-applied' || after !== null || !['verified', 'unavailable'].includes(String(rollbackSnapshot.state))))
  ) throw new Error('The local agent returned an impossible mod transaction state.');
  return {
    requestId: expected.requestId, planId: expected.planId, planDigest: expected.planDigest, operation: expected.operation,
    state, application, transactionRef: source.transactionRef,
    stackBefore: { generation: before.generation as string, inventoryDigest: before.inventoryDigest as string },
    stackAfter: after ? { generation: after.generation as string, inventoryDigest: after.inventoryDigest as string } : null,
    rollbackSnapshot: { snapshotRef: rollbackSnapshot.snapshotRef, state: rollbackSnapshot.state as ModOperation['rollbackSnapshot']['state'] },
    summary: { installedCount, updatedCount, removedCount },
    startedAt: new Date(source.startedAt).toISOString(),
    updatedAt: new Date(source.updatedAt).toISOString(),
  };
}

function pendingModOperationFromStorage(value: string | null): PendingModOperation | null {
  if (!value) return null;
  try {
    const source = objectOf(JSON.parse(value)); if (!source) return null;
    const keys = ['requestId', 'planId', 'planDigest', 'operation', 'startedAt', ...(source.observedState === undefined ? [] : ['observedState'])];
    exactPublicKeys(source, keys, 'pending mod transaction');
    if (
      typeof source.requestId !== 'string' || !PUBLIC_ADMIN_REQUEST_ID.test(source.requestId)
      || typeof source.planId !== 'string' || !PUBLIC_MOD_PLAN_ID.test(source.planId)
      || typeof source.planDigest !== 'string' || !PUBLIC_SHA256.test(source.planDigest)
      || !['install', 'update', 'remove', 'rollback'].includes(String(source.operation))
      || typeof source.startedAt !== 'string' || !Number.isFinite(Date.parse(source.startedAt))
      || (source.observedState !== undefined && !['committed', 'rolled-back', 'completion-unknown', 'manual-recovery-required', 'rejected-before-mutation'].includes(String(source.observedState)))
    ) return null;
    return {
      requestId: source.requestId.toLowerCase(),
      planId: source.planId,
      planDigest: source.planDigest,
      operation: source.operation as ModPlanOperation,
      startedAt: new Date(source.startedAt).toISOString(),
      ...(source.observedState === undefined ? {} : { observedState: source.observedState as ModOperation['state'] }),
    };
  } catch { return null; }
}

function modPlanRequestFromUnknown(value: unknown): ModPlanRequest | null {
  const source = objectOf(value);
  if (!source || typeof source.requestId !== 'string' || !PUBLIC_ADMIN_REQUEST_ID.test(source.requestId)) return null;
  const requestId = source.requestId.toLowerCase();
  if (source.operation === 'install') {
    try { exactPublicKeys(source, ['requestId', 'operation', 'catalogRef'], 'pending install plan request'); } catch { return null; }
    return typeof source.catalogRef === 'string' && PUBLIC_MOD_CATALOG_REF.test(source.catalogRef)
      ? { requestId, operation: 'install', catalogRef: source.catalogRef }
      : null;
  }
  if (source.operation === 'update' || source.operation === 'remove') {
    try { exactPublicKeys(source, ['requestId', 'operation', 'installedRef'], 'pending installed-mod plan request'); } catch { return null; }
    return typeof source.installedRef === 'string' && PUBLIC_MOD_INSTALLED_REF.test(source.installedRef)
      ? { requestId, operation: source.operation, installedRef: source.installedRef }
      : null;
  }
  if (source.operation === 'rollback') {
    try { exactPublicKeys(source, ['requestId', 'operation', 'transactionRef'], 'pending rollback plan request'); } catch { return null; }
    return typeof source.transactionRef === 'string' && PUBLIC_MOD_TRANSACTION_ID.test(source.transactionRef)
      ? { requestId, operation: 'rollback', transactionRef: source.transactionRef }
      : null;
  }
  return null;
}

function pendingModPlanRequestFromStorage(value: string | null): PendingModPlanRequest | null {
  if (!value) return null;
  try {
    const source = objectOf(JSON.parse(value));
    if (!source) return null;
    exactPublicKeys(source, ['request', 'startedAt', 'state'], 'pending Modrinth plan request');
    const request = modPlanRequestFromUnknown(source.request);
    if (
      !request || typeof source.startedAt !== 'string' || !Number.isFinite(Date.parse(source.startedAt))
      || !['resolving', 'completion-unknown', 'resolved'].includes(String(source.state))
    ) return null;
    return { request, startedAt: new Date(source.startedAt).toISOString(), state: source.state as PendingModPlanRequest['state'] };
  } catch { return null; }
}

type ModClientJournal = {
  plan: PendingModPlanRequest | null;
  operation: PendingModOperation | null;
  error: string | null;
};

function modPlanStorageKey(requestId: string): string {
  return `${MOD_PLAN_STORAGE_PREFIX}${requestId}`;
}

function modOperationStorageKey(requestId: string): string {
  return `${MOD_OPERATION_STORAGE_PREFIX}${requestId}`;
}

function readModClientJournal(): ModClientJournal {
  const plans: PendingModPlanRequest[] = [];
  const operations: PendingModOperation[] = [];
  let entries = 0;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || (!key.startsWith(MOD_PLAN_STORAGE_PREFIX) && !key.startsWith(MOD_OPERATION_STORAGE_PREFIX))) continue;
      entries += 1;
      if (entries > MAX_MOD_JOURNAL_ENTRIES) return { plan: null, operation: null, error: 'The local mod transaction journal exceeds its safe entry limit.' };
      const value = window.localStorage.getItem(key);
      if (key.startsWith(MOD_PLAN_STORAGE_PREFIX)) {
        const requestId = key.slice(MOD_PLAN_STORAGE_PREFIX.length);
        const plan = pendingModPlanRequestFromStorage(value);
        if (!plan || plan.request.requestId !== requestId) return { plan: null, operation: null, error: 'The local mod plan journal is invalid. Mod mutations remain locked.' };
        plans.push(plan);
      } else {
        const requestId = key.slice(MOD_OPERATION_STORAGE_PREFIX.length);
        const operation = pendingModOperationFromStorage(value);
        if (!operation || operation.requestId !== requestId) return { plan: null, operation: null, error: 'The local mod operation journal is invalid. Mod mutations remain locked.' };
        operations.push(operation);
      }
    }
  } catch {
    return { plan: null, operation: null, error: 'The browser could not read the local mod transaction journal. Mod mutations remain locked.' };
  }
  if (plans.length > 1 || operations.length > 1 || (plans[0] && operations[0] && plans[0].request.requestId !== operations[0].requestId)) {
    return { plan: null, operation: null, error: 'Conflicting mod transaction journal entries require recovery before another mutation.' };
  }
  return { plan: plans[0] ?? null, operation: operations[0] ?? null, error: null };
}

function sameModPlanRequest(left: ModPlanRequest, right: ModPlanRequest): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function withModMutationLock<T>(callback: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) throw new Error('This browser does not provide the Web Lock required for safe cross-tab mod mutations.');
  return navigator.locks.request(MOD_MUTATION_WEB_LOCK, { mode: 'exclusive' }, callback);
}

function worldTextFromUnknown(value: unknown, max: number, labelName: string): string {
  if (
    typeof value !== 'string' || value.length < 1 || value.length > max
    || new TextEncoder().encode(value).byteLength > max * 4 || !PUBLIC_MOD_TEXT.test(value)
  ) throw new Error(`The local agent returned invalid ${labelName}.`);
  return value;
}

function worldLabelFromUnknown(value: unknown): string {
  const valueLabel = worldTextFromUnknown(value, 64, 'world label');
  if (valueLabel.trim() !== valueLabel) throw new Error('The local agent returned an invalid world label.');
  return valueLabel;
}

function safeWorldLabelInput(value: string): string | null {
  if (
    value.length < 1 || value.length > 64 || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > 256 || !PUBLIC_MOD_TEXT.test(value)
  ) return null;
  return value;
}

function worldTimestampFromUnknown(value: unknown, labelName: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`The local agent returned invalid ${labelName}.`);
  }
  return new Date(value).toISOString();
}

function worldIntegerFromUnknown(value: unknown, max: number, labelName: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) {
    throw new Error(`The local agent returned invalid ${labelName}.`);
  }
  return Number(value);
}

function worldStateFromUnknown(value: unknown): WorldState {
  if (!['active', 'inactive', 'archived'].includes(String(value))) {
    throw new Error('The local agent returned an invalid world state.');
  }
  return value as WorldState;
}

function worldInventoryFromUnknown(value: unknown): WorldInventory {
  const envelope = objectOf(value);
  if (!envelope) throw new Error('The local agent returned invalid world inventory.');
  exactPublicKeys(envelope, ['ok', 'instanceId', 'generation', 'inventoryDigest', 'recovery', 'activeWorldRef', 'worlds', 'limits'], 'world inventory envelope');
  if (
    envelope.ok !== true || envelope.instanceId !== 'family-server'
    || typeof envelope.generation !== 'string' || !PUBLIC_SHA256.test(envelope.generation)
    || typeof envelope.inventoryDigest !== 'string' || !PUBLIC_SHA256.test(envelope.inventoryDigest)
    || typeof envelope.activeWorldRef !== 'string' || !PUBLIC_WORLD_REF.test(envelope.activeWorldRef)
    || !Array.isArray(envelope.worlds) || envelope.worlds.length < 1 || envelope.worlds.length > 12
  ) throw new Error('The local agent returned invalid Family Server world inventory.');

  const recovery = objectOf(envelope.recovery);
  const limits = objectOf(envelope.limits);
  if (!recovery || !limits) throw new Error('The local agent returned incomplete world inventory.');
  exactPublicKeys(recovery, ['required', 'state', 'transactionRef'], 'world recovery fence');
  const recoveryClear = recovery.required === false && recovery.state === null && recovery.transactionRef === null;
  const recoveryRequired = recovery.required === true
    && ['completion-unknown', 'manual-recovery-required'].includes(String(recovery.state))
    && typeof recovery.transactionRef === 'string' && PUBLIC_WORLD_TRANSACTION_REF.test(recovery.transactionRef);
  if (!recoveryClear && !recoveryRequired) throw new Error('The local agent returned an invalid world recovery fence.');

  exactPublicKeys(limits, ['maxWorlds', 'maxWorldBytes', 'maxTotalBytes'], 'world limits');
  if (limits.maxWorlds !== 12 || limits.maxWorldBytes !== 17_179_869_184 || limits.maxTotalBytes !== 68_719_476_736) {
    throw new Error('The local agent returned invalid world storage limits.');
  }

  const worlds = envelope.worlds.map((entry): ManagedWorld => {
    const source = objectOf(entry);
    if (!source) throw new Error('The local agent returned an invalid world record.');
    exactPublicKeys(source, [
      'worldRef', 'displayLabel', 'state', 'pendingGeneration', 'minecraftVersion', 'dataVersion',
      'createdAt', 'updatedAt', 'files', 'bytes', 'integrity',
    ], 'world record');
    if (
      typeof source.worldRef !== 'string' || !PUBLIC_WORLD_REF.test(source.worldRef)
      || typeof source.pendingGeneration !== 'boolean'
      || (source.dataVersion === null
        ? source.pendingGeneration !== true
        : (!Number.isSafeInteger(source.dataVersion) || Number(source.dataVersion) < 1
          || Number(source.dataVersion) > 0x7fffffff || source.pendingGeneration !== false))
      || !['verified', 'pending-generation', 'unverified-active', 'locked-version'].includes(String(source.integrity))
    ) throw new Error('The local agent returned an invalid world record.');
    if (
      (source.integrity === 'pending-generation' && source.pendingGeneration !== true)
      || (source.integrity === 'verified' && source.pendingGeneration !== false)
      || (source.integrity === 'unverified-active' && source.state !== 'active')
      || (source.integrity === 'locked-version' && source.state !== 'archived')
    ) throw new Error('The local agent returned inconsistent world integrity state.');
    const createdAt = worldTimestampFromUnknown(source.createdAt, 'world creation time');
    const updatedAt = worldTimestampFromUnknown(source.updatedAt, 'world update time');
    if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new Error('The local agent returned inconsistent world timestamps.');
    return {
      worldRef: source.worldRef,
      displayLabel: worldLabelFromUnknown(source.displayLabel),
      state: worldStateFromUnknown(source.state),
      pendingGeneration: source.pendingGeneration,
      minecraftVersion: worldTextFromUnknown(source.minecraftVersion, 96, 'world Minecraft version'),
      dataVersion: source.dataVersion === null ? null : Number(source.dataVersion),
      createdAt,
      updatedAt,
      files: worldIntegerFromUnknown(source.files, 500_000, 'world file count'),
      bytes: worldIntegerFromUnknown(source.bytes, 17_179_869_184, 'world byte count'),
      integrity: source.integrity as WorldIntegrity,
    };
  });
  const worldRefs = worlds.map((world) => world.worldRef);
  const normalizedLabels = worlds.map((world) => world.displayLabel.normalize('NFKC').toLocaleLowerCase('en-US'));
  const activeWorlds = worlds.filter((world) => world.state === 'active');
  if (
    new Set(worldRefs).size !== worldRefs.length || activeWorlds.length !== 1
    || new Set(normalizedLabels).size !== normalizedLabels.length
    || activeWorlds[0].worldRef !== envelope.activeWorldRef
    || worlds.reduce((sum, world) => sum + world.bytes, 0) > 68_719_476_736
  ) throw new Error('The local agent returned inconsistent world inventory state.');
  return {
    generation: envelope.generation,
    inventoryDigest: envelope.inventoryDigest,
    recovery: recoveryClear
      ? { required: false, state: null, transactionRef: null }
      : {
        required: true,
        state: recovery.state as 'completion-unknown' | 'manual-recovery-required',
        transactionRef: recovery.transactionRef as string,
      },
    activeWorldRef: envelope.activeWorldRef,
    worlds,
    limits: { maxWorlds: 12, maxWorldBytes: 17_179_869_184, maxTotalBytes: 68_719_476_736 },
  };
}

function worldPlanEndpointFromUnknown(value: unknown, nullable: boolean): WorldPlanEndpoint | null {
  if (nullable && value === null) return null;
  const source = objectOf(value);
  if (!source) throw new Error('The local agent returned an invalid world plan endpoint.');
  exactPublicKeys(source, ['worldRef', 'displayLabel', 'state'], 'world plan endpoint');
  if (typeof source.worldRef !== 'string' || !PUBLIC_WORLD_REF.test(source.worldRef)) {
    throw new Error('The local agent returned an invalid world plan reference.');
  }
  return { worldRef: source.worldRef, displayLabel: worldLabelFromUnknown(source.displayLabel), state: worldStateFromUnknown(source.state) };
}

function worldPlanFromUnknown(value: unknown, request: WorldPlanRequest, inventory: WorldInventory): WorldPlan {
  const envelope = objectOf(value);
  const source = objectOf(envelope?.plan);
  if (!envelope || envelope.ok !== true || envelope.instanceId !== 'family-server' || !source) {
    throw new Error('The local agent returned an invalid Family Server world plan.');
  }
  exactPublicKeys(envelope, ['ok', 'instanceId', 'plan'], 'world plan envelope');
  exactPublicKeys(source, [
    'planId', 'planDigest', 'requestId', 'operation', 'requiredConfirmation', 'expiresAt', 'source', 'target',
    'changes', 'safety', 'inventoryBinding',
  ], 'world plan');
  if (
    typeof source.planId !== 'string' || !PUBLIC_WORLD_PLAN_ID.test(source.planId)
    || typeof source.planDigest !== 'string' || !PUBLIC_SHA256.test(source.planDigest)
    || source.requestId !== request.requestId || source.operation !== request.operation
    || source.requiredConfirmation !== WORLD_CONFIRMATION_BY_OPERATION[request.operation]
    || !Array.isArray(source.changes) || source.changes.length < 1 || source.changes.length > 2
    || typeof source.expiresAt !== 'string' || !Number.isFinite(Date.parse(source.expiresAt))
    || new Date(source.expiresAt).toISOString() !== source.expiresAt
    || Date.parse(source.expiresAt) <= Date.now() || Date.parse(source.expiresAt) > Date.now() + 330_000
  ) throw new Error('The local agent returned a mismatched world plan.');
  const expiresAt = worldTimestampFromUnknown(source.expiresAt, 'world plan expiry');
  const planSource = worldPlanEndpointFromUnknown(source.source, true);
  const target = worldPlanEndpointFromUnknown(source.target, false);
  if (!target) throw new Error('The local agent returned a world plan without a target.');
  const changes = source.changes.map((entry): WorldPlan['changes'][number] => {
    const change = objectOf(entry);
    if (!change) throw new Error('The local agent returned an invalid world plan change.');
    exactPublicKeys(change, ['worldRef', 'displayLabel', 'fromState', 'toState'], 'world plan change');
    if (
      typeof change.worldRef !== 'string' || !PUBLIC_WORLD_REF.test(change.worldRef)
      || (change.fromState !== null && !['active', 'inactive', 'archived'].includes(String(change.fromState)))
    ) throw new Error('The local agent returned an invalid world plan change.');
    return {
      worldRef: change.worldRef,
      displayLabel: worldLabelFromUnknown(change.displayLabel),
      fromState: change.fromState as WorldState | null,
      toState: worldStateFromUnknown(change.toState),
    };
  });
  const safety = objectOf(source.safety);
  const binding = objectOf(source.inventoryBinding);
  if (!safety || !binding) throw new Error('The local agent returned an incomplete world plan.');
  exactPublicKeys(safety, ['requiresStopped', 'rescueBackupRequired', 'destructive'], 'world plan safety state');
  exactPublicKeys(binding, ['generation', 'digest'], 'world plan inventory binding');
  if (
    safety.requiresStopped !== true || safety.destructive !== false
    || safety.rescueBackupRequired !== (request.operation === 'switch')
    || binding.generation !== inventory.generation || binding.digest !== inventory.inventoryDigest
  ) throw new Error('The local agent returned a stale or unsafe world plan.');

  const oneChange = changes.length === 1 ? changes[0] : null;
  const requestRef = 'targetWorldRef' in request ? request.targetWorldRef : null;
  const requestedLabel = 'displayLabel' in request ? request.displayLabel : null;
  const requestedWorld = requestRef ? inventory.worlds.find((world) => world.worldRef === requestRef) ?? null : null;
  const activeWorld = inventory.worlds.find((world) => world.worldRef === inventory.activeWorldRef) ?? null;
  const labelConflict = requestedLabel !== null && inventory.worlds.some((world) => (
    world.worldRef !== (request.operation === 'rename' ? requestRef : null)
    && world.displayLabel.normalize('NFKC').toLocaleLowerCase('en-US') === requestedLabel.normalize('NFKC').toLocaleLowerCase('en-US')
  ));
  const sourceMatchesWorld = (endpoint: WorldPlanEndpoint | null, world: ManagedWorld | null) => Boolean(
    endpoint && world && endpoint.worldRef === world.worldRef
    && endpoint.displayLabel === world.displayLabel && endpoint.state === world.state,
  );
  const impossible =
    (request.operation === 'create' && (
      planSource !== null || labelConflict || inventory.worlds.some((world) => world.worldRef === target.worldRef)
      || target.displayLabel !== request.displayLabel || target.state !== 'inactive'
      || !oneChange || oneChange.worldRef !== target.worldRef || oneChange.displayLabel !== request.displayLabel
      || oneChange.fromState !== null || oneChange.toState !== 'inactive'
    ))
    || (request.operation === 'clone' && (
      !sourceMatchesWorld(planSource, requestedWorld) || labelConflict || target.worldRef === requestRef
      || inventory.worlds.some((world) => world.worldRef === target.worldRef)
      || target.displayLabel !== request.displayLabel || target.state !== 'inactive'
      || !oneChange || oneChange.worldRef !== target.worldRef || oneChange.displayLabel !== request.displayLabel
      || oneChange.fromState !== null || oneChange.toState !== 'inactive'
    ))
    || (request.operation === 'rename' && (
      !sourceMatchesWorld(planSource, requestedWorld) || labelConflict || target.worldRef !== requestRef
      || target.displayLabel !== request.displayLabel || target.state !== requestedWorld?.state
      || !oneChange || oneChange.worldRef !== requestRef || oneChange.fromState !== oneChange.toState
      || oneChange.fromState !== requestedWorld?.state || oneChange.displayLabel !== request.displayLabel
    ))
    || (request.operation === 'archive' && (
      !sourceMatchesWorld(planSource, requestedWorld) || requestedWorld?.state !== 'inactive'
      || target.worldRef !== requestRef || target.displayLabel !== requestedWorld.displayLabel || target.state !== 'archived'
      || !oneChange || oneChange.worldRef !== requestRef || oneChange.fromState !== 'inactive' || oneChange.toState !== 'archived'
      || oneChange.displayLabel !== requestedWorld.displayLabel
    ))
    || (request.operation === 'switch' && (
      !sourceMatchesWorld(planSource, activeWorld) || !requestedWorld || !['inactive', 'archived'].includes(requestedWorld.state)
      || target.worldRef !== requestRef || target.displayLabel !== requestedWorld.displayLabel || target.state !== 'active' || changes.length !== 2
      || !changes.some((change) => change.worldRef === requestRef && change.displayLabel === requestedWorld.displayLabel && change.fromState === requestedWorld.state && change.toState === 'active')
      || !changes.some((change) => change.worldRef === activeWorld?.worldRef && change.displayLabel === activeWorld.displayLabel && change.fromState === 'active' && change.toState === 'inactive')
    ));
  if (impossible) throw new Error('The local agent returned impossible world-plan changes.');
  return {
    planId: source.planId,
    planDigest: source.planDigest,
    requestId: request.requestId,
    operation: request.operation,
    requiredConfirmation: source.requiredConfirmation as WorldPlan['requiredConfirmation'],
    expiresAt,
    source: planSource,
    target,
    changes,
    safety: { requiresStopped: true, rescueBackupRequired: request.operation === 'switch', destructive: false },
    inventoryBinding: { generation: inventory.generation, digest: inventory.inventoryDigest },
  };
}

function worldMutationResultFromUnknown(value: unknown, operation: Exclude<WorldPlanOperation, 'switch'>): WorldMutationResult {
  const source = objectOf(value);
  if (!source) throw new Error('The local agent returned an invalid world-operation result.');
  exactPublicKeys(source, ['worldRef', 'displayLabel', 'state', 'pendingGeneration', 'generation', 'inventoryDigest'], 'world-operation result');
  if (
    typeof source.worldRef !== 'string' || !PUBLIC_WORLD_REF.test(source.worldRef)
    || typeof source.pendingGeneration !== 'boolean'
    || typeof source.generation !== 'string' || !PUBLIC_SHA256.test(source.generation)
    || typeof source.inventoryDigest !== 'string' || !PUBLIC_SHA256.test(source.inventoryDigest)
  ) throw new Error('The local agent returned an invalid world-operation result.');
  const state = worldStateFromUnknown(source.state);
  if ((['create', 'clone'].includes(operation) && state !== 'inactive') || (operation === 'archive' && state !== 'archived')) {
    throw new Error('The local agent returned an impossible world-operation result.');
  }
  return {
    worldRef: source.worldRef,
    displayLabel: worldLabelFromUnknown(source.displayLabel),
    state,
    pendingGeneration: source.pendingGeneration,
    generation: source.generation,
    inventoryDigest: source.inventoryDigest,
  };
}

function worldSwitchResultFromUnknown(value: unknown): WorldSwitchResult {
  const source = objectOf(value);
  if (!source) throw new Error('The local agent returned an invalid world-switch result.');
  exactPublicKeys(source, ['activeWorldRef', 'previousWorldRef', 'rescueVerified', 'pendingGeneration', 'generation', 'inventoryDigest'], 'world-switch result');
  if (
    typeof source.activeWorldRef !== 'string' || !PUBLIC_WORLD_REF.test(source.activeWorldRef)
    || typeof source.previousWorldRef !== 'string' || !PUBLIC_WORLD_REF.test(source.previousWorldRef)
    || source.activeWorldRef === source.previousWorldRef || source.rescueVerified !== true
    || typeof source.pendingGeneration !== 'boolean'
    || typeof source.generation !== 'string' || !PUBLIC_SHA256.test(source.generation)
    || typeof source.inventoryDigest !== 'string' || !PUBLIC_SHA256.test(source.inventoryDigest)
  ) throw new Error('The local agent returned an invalid world-switch result.');
  return {
    activeWorldRef: source.activeWorldRef,
    previousWorldRef: source.previousWorldRef,
    rescueVerified: true,
    pendingGeneration: source.pendingGeneration,
    generation: source.generation,
    inventoryDigest: source.inventoryDigest,
  };
}

function worldOperationFromUnknown(value: unknown, expected: PendingWorldOperation): WorldOperation {
  const envelope = objectOf(value);
  const source = objectOf(envelope?.operation);
  if (!envelope || envelope.ok !== true || envelope.instanceId !== 'family-server' || !source) {
    throw new Error('The local agent returned an invalid Family Server world operation.');
  }
  exactPublicKeys(envelope, ['ok', 'instanceId', 'operation'], 'world operation envelope');
  exactPublicKeys(source, [
    'requestId', 'planId', 'planDigest', 'operation', 'state', 'application', 'transactionRef',
    'failureCode', 'result', 'startedAt', 'updatedAt',
  ], 'world operation');
  const stateApplication: Record<WorldOperationState, WorldOperation['application']> = {
    committed: 'verified',
    'rolled-back': 'rolled-back-verified',
    'rejected-before-mutation': 'not-applied',
    'completion-unknown': 'unknown',
    'manual-recovery-required': 'unknown',
  };
  if (
    source.requestId !== expected.requestId || source.planId !== expected.planId || source.planDigest !== expected.planDigest
    || source.operation !== expected.operation || !Object.prototype.hasOwnProperty.call(stateApplication, String(source.state))
    || stateApplication[source.state as WorldOperationState] !== source.application
    || typeof source.transactionRef !== 'string' || !PUBLIC_WORLD_TRANSACTION_REF.test(source.transactionRef)
  ) throw new Error('The local agent returned a mismatched world operation.');
  const startedAt = worldTimestampFromUnknown(source.startedAt, 'world operation start time');
  const updatedAt = worldTimestampFromUnknown(source.updatedAt, 'world operation update time');
  if (Date.parse(updatedAt) < Date.parse(startedAt)) throw new Error('The local agent returned inconsistent world-operation timestamps.');
  const state = source.state as WorldOperationState;
  const success = state === 'committed' || state === 'rolled-back';
  if (success
    ? source.failureCode !== null
    : typeof source.failureCode !== 'string' || !WORLD_FAILURE_CODES.has(source.failureCode as NonNullable<WorldOperation['failureCode']>)
  ) {
    throw new Error('The local agent returned an invalid world-operation failure state.');
  }
  let result: WorldOperation['result'] = null;
  if (state === 'committed') {
    result = expected.operation === 'switch'
      ? worldSwitchResultFromUnknown(source.result)
      : worldMutationResultFromUnknown(source.result, expected.operation);
    if (expected.expectedResult.kind === 'switch') {
      if (!('activeWorldRef' in result)
        || result.activeWorldRef !== expected.expectedResult.activeWorldRef
        || result.previousWorldRef !== expected.expectedResult.previousWorldRef
        || result.pendingGeneration !== expected.expectedResult.pendingGeneration) {
        throw new Error('The local agent returned a committed switch result for a different approved world transition.');
      }
    } else if ('activeWorldRef' in result
      || result.worldRef !== expected.expectedResult.worldRef
      || result.displayLabel !== expected.expectedResult.displayLabel
      || result.state !== expected.expectedResult.state
      || result.pendingGeneration !== expected.expectedResult.pendingGeneration) {
      throw new Error('The local agent returned a committed result for a different approved world change.');
    }
  } else if (source.result !== null) {
    throw new Error('The local agent returned an impossible world-operation result.');
  }
  return {
    requestId: expected.requestId,
    planId: expected.planId,
    planDigest: expected.planDigest,
    operation: expected.operation,
    state,
    application: source.application as WorldOperation['application'],
    transactionRef: source.transactionRef,
    failureCode: source.failureCode as WorldOperation['failureCode'],
    result,
    startedAt,
    updatedAt,
  };
}

function expectedWorldResultForPlan(plan: WorldPlan, inventory: WorldInventory): PendingWorldExpectedResult {
  if (plan.operation === 'switch') {
    const targetBefore = inventory.worlds.find((world) => world.worldRef === plan.target.worldRef);
    if (!plan.source || !targetBefore || plan.source.worldRef !== inventory.activeWorldRef) {
      throw new Error('The approved switch plan cannot be bound to the current source and target inventory.');
    }
    return {
      kind: 'switch',
      activeWorldRef: plan.target.worldRef,
      previousWorldRef: plan.source.worldRef,
      pendingGeneration: targetBefore.pendingGeneration,
    };
  }
  let pendingGeneration: boolean;
  if (plan.operation === 'create') pendingGeneration = true;
  else if (plan.operation === 'clone') pendingGeneration = false;
  else {
    const current = inventory.worlds.find((world) => world.worldRef === plan.target.worldRef);
    if (!current) throw new Error('The approved world plan target is absent from the bound inventory.');
    pendingGeneration = current.pendingGeneration;
  }
  return {
    kind: 'world',
    worldRef: plan.target.worldRef,
    displayLabel: plan.target.displayLabel,
    state: plan.target.state,
    pendingGeneration,
  };
}

function committedWorldOperationMatchesInventory(
  operation: WorldOperation,
  inventory: WorldInventory,
  allowLaterGeneration = false,
): boolean {
  if (operation.state !== 'committed' || !operation.result) return true;
  const result = operation.result;
  if (inventory.recovery.required) return false;
  const sameGeneration = result.generation === inventory.generation;
  if (sameGeneration && result.inventoryDigest !== inventory.inventoryDigest) return false;
  if (!sameGeneration && !allowLaterGeneration) return false;
  const pendingMatches = (current: ManagedWorld) => current.pendingGeneration === result.pendingGeneration
    || (!sameGeneration && result.pendingGeneration === true && current.pendingGeneration === false && current.state === 'active');
  if ('activeWorldRef' in result) {
    const active = inventory.worlds.find((world) => world.worldRef === result.activeWorldRef);
    const previous = inventory.worlds.find((world) => world.worldRef === result.previousWorldRef);
    return inventory.activeWorldRef === result.activeWorldRef
      && active?.state === 'active' && pendingMatches(active)
      && previous?.state === 'inactive';
  }
  const world = inventory.worlds.find((candidate) => candidate.worldRef === result.worldRef);
  return Boolean(world && world.displayLabel === result.displayLabel && world.state === result.state
    && pendingMatches(world));
}

function noVerifiedRestoreAfterOperation(instance: ManagedInstance | null, operation: WorldOperation): boolean {
  if (!instance || instance.id !== 'family-server' || instance.projectId !== 'family-server' || instance.kind !== 'server') return false;
  if (instance.lastRestore === null || instance.lastRestore === undefined) return true;
  const receipt = verifiedWorldRestoreReceiptFromUnknown(instance.lastRestore);
  return receipt !== null && Date.parse(receipt.restoredAt) <= Date.parse(operation.startedAt);
}

function verifiedWorldRestoreReceiptFromUnknown(value: unknown): VerifiedWorldRestoreReceipt | null {
  if (value === null || value === undefined) return null;
  const source = objectOf(value);
  if (!source) return null;
  try {
    exactPublicKeys(source, ['backupId', 'rescueBackupId', 'restoredAt', 'state'], 'verified world-restore receipt');
  } catch {
    return null;
  }
  if (
    typeof source.backupId !== 'string' || !PUBLIC_BACKUP_ID.test(source.backupId)
    || typeof source.rescueBackupId !== 'string' || !PUBLIC_BACKUP_ID.test(source.rescueBackupId)
    || typeof source.restoredAt !== 'string' || !Number.isFinite(Date.parse(source.restoredAt))
    || new Date(source.restoredAt).toISOString() !== source.restoredAt
    || source.state !== 'verified'
  ) return null;
  return {
    backupId: source.backupId,
    rescueBackupId: source.rescueBackupId,
    restoredAt: source.restoredAt,
    state: 'verified',
  };
}

const PUBLIC_INSTANCE_TEXT = /^[^\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]+$/u;

function exactOptionalPublicKeys(
  source: Record<string, unknown>,
  required: string[],
  optional: string[],
  label: string,
) {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(source, key)) || Object.keys(source).some((key) => !allowed.has(key))) {
    throw new Error(`The local agent returned an invalid ${label}.`);
  }
}

function managedInstanceText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
    || new TextEncoder().encode(value).byteLength > maximum * 4 || !PUBLIC_INSTANCE_TEXT.test(value)) {
    throw new Error(`The local agent returned invalid ${label}.`);
  }
  return value;
}

function managedInstanceFromUnknown(value: unknown): ManagedInstance {
  const source = objectOf(value);
  if (!source) throw new Error('The local agent returned an invalid instance inventory record.');
  exactOptionalPublicKeys(source, ['id', 'displayName', 'status', 'minecraftVersion'], [
    'projectId', 'kind', 'pid', 'latestMinecraftVersion', 'updateChannel', 'javaPort', 'serverPort',
    'bedrockPort', 'loader', 'loaderVersion', 'components', 'provisioningStatus', 'lastError',
    'updateStatus', 'lastRestore',
  ], 'instance inventory record');
  if (typeof source.id !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(source.id)
    || !['stopped', 'starting', 'running', 'stopping', 'failed'].includes(String(source.status))) {
    throw new Error('The local agent returned invalid instance identity or state.');
  }
  const result: ManagedInstance = {
    id: source.id,
    displayName: managedInstanceText(source.displayName, 64, 'instance display label'),
    status: source.status as InstanceState,
    minecraftVersion: managedInstanceText(source.minecraftVersion, 96, 'instance Minecraft version'),
  };
  if (source.projectId !== undefined) {
    if (source.projectId !== 'family-server') throw new Error('The local agent returned an invalid project identity.');
    result.projectId = 'family-server';
  }
  if (source.kind !== undefined) {
    if (source.kind !== 'server') throw new Error('The local agent returned an invalid instance kind.');
    result.kind = 'server';
  }
  if (source.pid !== undefined) {
    if (source.pid !== null && (!Number.isSafeInteger(source.pid) || Number(source.pid) < 1 || Number(source.pid) > 0xffffffff)) {
      throw new Error('The local agent returned invalid process identity.');
    }
    result.pid = source.pid as number | null;
  }
  if (source.latestMinecraftVersion !== undefined) result.latestMinecraftVersion = managedInstanceText(source.latestMinecraftVersion, 96, 'latest Minecraft version');
  if (source.updateChannel !== undefined) {
    if (source.updateChannel !== 'latest-compatible') throw new Error('The local agent returned an invalid update channel.');
    result.updateChannel = 'latest-compatible';
  }
  for (const key of ['javaPort', 'serverPort', 'bedrockPort'] as const) {
    if (source[key] === undefined) continue;
    if (!Number.isSafeInteger(source[key]) || Number(source[key]) < 1 || Number(source[key]) > 65535) {
      throw new Error('The local agent returned invalid network port state.');
    }
    result[key] = Number(source[key]);
  }
  if (source.loader !== undefined) result.loader = managedInstanceText(source.loader, 32, 'instance loader');
  if (source.loaderVersion !== undefined) result.loaderVersion = managedInstanceText(source.loaderVersion, 128, 'loader version');
  if (source.components !== undefined) {
    const components = objectOf(source.components);
    if (!components) throw new Error('The local agent returned invalid component inventory.');
    exactOptionalPublicKeys(components, [], ['fabricApi', 'geyser', 'floodgate'], 'component inventory');
    const parsed: NonNullable<ManagedInstance['components']> = {};
    for (const key of ['fabricApi', 'geyser', 'floodgate'] as const) {
      if (components[key] === undefined) continue;
      const component = objectOf(components[key]);
      if (!component) throw new Error('The local agent returned an invalid component record.');
      exactPublicKeys(component, ['versionNumber'], 'component record');
      parsed[key] = { versionNumber: managedInstanceText(component.versionNumber, 128, 'component version') };
    }
    result.components = parsed;
  }
  if (source.provisioningStatus !== undefined) {
    if (typeof source.provisioningStatus !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(source.provisioningStatus)) {
      throw new Error('The local agent returned invalid provisioning state.');
    }
    result.provisioningStatus = source.provisioningStatus;
  }
  if (source.lastError !== undefined) {
    result.lastError = source.lastError === null ? null : managedInstanceText(source.lastError, 256, 'instance error summary');
  }
  if (source.updateStatus !== undefined) {
    const status = objectOf(source.updateStatus);
    if (!status) throw new Error('The local agent returned invalid update status.');
    exactOptionalPublicKeys(status, ['state'], ['previousMinecraftVersion', 'targetMinecraftVersion', 'backupAvailable', 'verifiedAt'], 'instance update status');
    if (!['pending-unverified', 'verified'].includes(String(status.state))) throw new Error('The local agent returned invalid update state.');
    const parsed: NonNullable<ManagedInstance['updateStatus']> = { state: status.state as 'pending-unverified' | 'verified' };
    if (status.previousMinecraftVersion !== undefined) parsed.previousMinecraftVersion = managedInstanceText(status.previousMinecraftVersion, 96, 'previous Minecraft version');
    if (status.targetMinecraftVersion !== undefined) parsed.targetMinecraftVersion = managedInstanceText(status.targetMinecraftVersion, 96, 'target Minecraft version');
    if (status.backupAvailable !== undefined) {
      if (typeof status.backupAvailable !== 'boolean') throw new Error('The local agent returned invalid update backup state.');
      parsed.backupAvailable = status.backupAvailable;
    }
    if (status.verifiedAt !== undefined) {
      if (typeof status.verifiedAt !== 'string' || !Number.isFinite(Date.parse(status.verifiedAt))
        || new Date(status.verifiedAt).toISOString() !== status.verifiedAt) throw new Error('The local agent returned invalid update verification time.');
      parsed.verifiedAt = status.verifiedAt;
    }
    result.updateStatus = parsed;
  }
  if (source.lastRestore !== undefined) {
    if (source.lastRestore === null) result.lastRestore = null;
    else {
      const receipt = verifiedWorldRestoreReceiptFromUnknown(source.lastRestore);
      if (!receipt) throw new Error('The local agent returned an invalid restore receipt.');
      result.lastRestore = receipt;
    }
  }
  return result;
}

const UPDATE_STATE_BY_KIND: Record<InstanceUpdateStatus['updateKind'], InstanceUpdateStatus['state']> = {
  current: 'current',
  component: 'component-update-available',
  upgrade: 'minecraft-update-approval-required',
  'legacy-migration': 'minecraft-update-approval-required',
  downgrade: 'blocked-downgrade',
  unknown: 'blocked-unknown-order',
};

function instanceUpdateStatusFromUnknown(value: unknown): InstanceUpdateStatus {
  const source = objectOf(value);
  if (!source) throw new Error('The local agent returned an invalid server update plan.');
  exactPublicKeys(source, [
    'state', 'updateKind', 'planId', 'currentMinecraft', 'targetMinecraft', 'requiresApproval', 'checkedAt',
  ], 'server update plan');
  if (!['current', 'component', 'upgrade', 'legacy-migration', 'downgrade', 'unknown'].includes(String(source.updateKind))) {
    throw new Error('The local agent returned an invalid server update kind.');
  }
  const updateKind = source.updateKind as InstanceUpdateStatus['updateKind'];
  const requiresApproval = updateKind === 'upgrade' || updateKind === 'legacy-migration';
  if (source.state !== UPDATE_STATE_BY_KIND[updateKind] || source.requiresApproval !== requiresApproval
    || typeof source.planId !== 'string' || !PUBLIC_SHA256.test(source.planId)
    || typeof source.checkedAt !== 'string' || !Number.isFinite(Date.parse(source.checkedAt))
    || new Date(source.checkedAt).toISOString() !== source.checkedAt) {
    throw new Error('The local agent returned an inconsistent server update plan.');
  }
  return {
    state: UPDATE_STATE_BY_KIND[updateKind],
    updateKind,
    planId: source.planId,
    currentMinecraft: managedInstanceText(source.currentMinecraft, 96, 'current Minecraft version'),
    targetMinecraft: managedInstanceText(source.targetMinecraft, 96, 'target Minecraft version'),
    requiresApproval,
    checkedAt: source.checkedAt,
  };
}

function updateStatusEnvelopeFromUnknown(value: unknown, expectedInstanceId: string): UpdateStatusEnvelope {
  const source = objectOf(value);
  if (!source) throw new Error('The local agent returned an invalid update status envelope.');
  exactPublicKeys(source, ['ok', 'instanceId', 'update'], 'server update status envelope');
  if (source.ok !== true || source.instanceId !== expectedInstanceId) {
    throw new Error('The local agent returned mismatched update status identity.');
  }
  return { ok: true, instanceId: expectedInstanceId, update: instanceUpdateStatusFromUnknown(source.update) };
}

function updateTransactionFromUnknown(
  value: unknown,
  expectedInstanceId: string,
  expectedPlan: InstanceUpdateStatus,
): UpdateTransaction {
  const source = objectOf(value);
  if (!source) throw new Error('The local agent returned an invalid update transaction.');
  exactPublicKeys(source, [
    'transactionId', 'instanceId', 'phase', 'updateKind', 'planId', 'backupAvailable', 'createdAt', 'updatedAt',
  ], 'server update transaction');
  if (typeof source.transactionId !== 'string' || !PUBLIC_UPDATE_TRANSACTION_ID.test(source.transactionId)
    || source.instanceId !== expectedInstanceId || source.phase !== 'pending-readiness'
    || source.updateKind !== expectedPlan.updateKind || source.planId !== expectedPlan.planId
    || source.backupAvailable !== true || typeof source.createdAt !== 'string' || typeof source.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(source.createdAt)) || !Number.isFinite(Date.parse(source.updatedAt))
    || new Date(source.createdAt).toISOString() !== source.createdAt
    || new Date(source.updatedAt).toISOString() !== source.updatedAt
    || Date.parse(source.updatedAt) < Date.parse(source.createdAt)) {
    throw new Error('The local agent returned an inconsistent update transaction.');
  }
  return {
    transactionId: source.transactionId,
    instanceId: expectedInstanceId,
    phase: 'pending-readiness',
    updateKind: expectedPlan.updateKind,
    planId: expectedPlan.planId,
    backupAvailable: true,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

function updateActionEnvelopeFromUnknown(value: unknown, expectedInstanceId: string): UpdateActionEnvelope {
  const source = objectOf(value);
  if (!source) throw new Error('The local agent returned an invalid update action envelope.');
  exactPublicKeys(source, ['ok', 'updateResult'], 'server update action envelope');
  const result = objectOf(source.updateResult);
  if (!result) throw new Error('The local agent returned an invalid update action result.');
  exactOptionalPublicKeys(result, ['action', 'instance', 'plan'], ['transaction', 'readiness'], 'server update action result');
  const instance = managedInstanceFromUnknown(result.instance);
  const plan = instanceUpdateStatusFromUnknown(result.plan);
  if (instance.id !== expectedInstanceId || !['current', 'approval-required', 'updated'].includes(String(result.action))) {
    throw new Error('The local agent returned mismatched update action identity.');
  }
  const action = result.action as UpdateActionEnvelope['updateResult']['action'];
  if (action === 'current') {
    if (source.ok !== true || plan.state !== 'current' || result.transaction !== undefined || result.readiness !== undefined) {
      throw new Error('The local agent returned an invalid current-update result.');
    }
    return { ok: true, updateResult: { action, instance, plan } };
  }
  if (action === 'approval-required') {
    if (source.ok !== false || plan.state !== 'minecraft-update-approval-required'
      || result.transaction !== undefined || result.readiness !== undefined) {
      throw new Error('The local agent returned an invalid update-approval result.');
    }
    return { ok: false, updateResult: { action, instance, plan } };
  }
  if (source.ok !== true || result.readiness !== 'pending-unverified'
    || !['component-update-available', 'minecraft-update-approval-required'].includes(plan.state)) {
    throw new Error('The local agent returned an invalid completed update result.');
  }
  return {
    ok: true,
    updateResult: {
      action: 'updated',
      instance,
      plan,
      transaction: updateTransactionFromUnknown(result.transaction, expectedInstanceId, plan),
      readiness: 'pending-unverified',
    },
  };
}

function instanceUpdateStorageKey(instanceId: string): string {
  return `${INSTANCE_UPDATE_STORAGE_PREFIX}${instanceId}`;
}

function pendingInstanceUpdateFromStorage(raw: string | null): PendingInstanceUpdate | null {
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('The persisted server-update lock is invalid.'); }
  const source = objectOf(parsed);
  if (!source) throw new Error('The persisted server-update lock is invalid.');
  exactPublicKeys(source, ['instanceId', 'submittedAt', 'plan'], 'persisted server-update lock');
  if (typeof source.instanceId !== 'string' || !PUBLIC_INSTANCE_ID.test(source.instanceId)
    || typeof source.submittedAt !== 'string' || !Number.isFinite(Date.parse(source.submittedAt))
    || new Date(source.submittedAt).toISOString() !== source.submittedAt) {
    throw new Error('The persisted server-update lock is invalid.');
  }
  return {
    instanceId: source.instanceId,
    submittedAt: source.submittedAt,
    plan: instanceUpdateStatusFromUnknown(source.plan),
  };
}

async function withInstanceUpdateLock<T>(instanceId: string, callback: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) {
    throw new ApiError(409, 'BROWSER_LOCK_UNAVAILABLE', 'This browser cannot provide the cross-tab lock required for a server update.');
  }
  return navigator.locks.request(`${INSTANCE_UPDATE_LOCK_PREFIX}${instanceId}`, { mode: 'exclusive' }, callback);
}

function instanceEnvelopeFromUnknown(value: unknown): InstanceEnvelope {
  const envelope = objectOf(value);
  if (!envelope) throw new Error('The local agent returned an invalid instance inventory.');
  exactPublicKeys(envelope, ['ok', 'instances'], 'instance inventory envelope');
  if (envelope.ok !== true || !Array.isArray(envelope.instances) || envelope.instances.length > 128) {
    throw new Error('The local agent returned an invalid instance inventory.');
  }
  const instances = envelope.instances.map(managedInstanceFromUnknown);
  if (new Set(instances.map((instance) => instance.id)).size !== instances.length) {
    throw new Error('The local agent returned duplicate instance identities.');
  }
  return { ok: true, instances };
}

function sameWorldRestoreReceipt(left: VerifiedWorldRestoreReceipt | null, right: VerifiedWorldRestoreReceipt): boolean {
  return left !== null && left.backupId === right.backupId && left.rescueBackupId === right.rescueBackupId
    && left.restoredAt === right.restoredAt;
}

function restoredWorldHistorySupersedes(
  pending: PendingWorldOperation,
  inventory: WorldInventory | null,
  instance: ManagedInstance | null,
): boolean {
  const receipt = verifiedWorldRestoreReceiptFromUnknown(instance?.lastRestore);
  return Boolean(
    inventory && inventory.recovery.required === false
    && inventory.generation !== pending.baselineGeneration
    && receipt
    && Date.parse(receipt.restoredAt) > Date.parse(pending.submittedAt)
    && !sameWorldRestoreReceipt(pending.baselineLastRestore, receipt),
  );
}

function pendingWorldExpectedResultFromUnknown(value: unknown): PendingWorldExpectedResult | null {
  const source = objectOf(value);
  if (!source || (source.kind !== 'world' && source.kind !== 'switch')) return null;
  try {
    if (source.kind === 'switch') {
      exactPublicKeys(source, ['kind', 'activeWorldRef', 'previousWorldRef', 'pendingGeneration'], 'pending world switch result');
      if (typeof source.activeWorldRef !== 'string' || !PUBLIC_WORLD_REF.test(source.activeWorldRef)
        || typeof source.previousWorldRef !== 'string' || !PUBLIC_WORLD_REF.test(source.previousWorldRef)
        || source.activeWorldRef === source.previousWorldRef || typeof source.pendingGeneration !== 'boolean') return null;
      return {
        kind: 'switch', activeWorldRef: source.activeWorldRef, previousWorldRef: source.previousWorldRef,
        pendingGeneration: source.pendingGeneration,
      };
    }
    exactPublicKeys(source, ['kind', 'worldRef', 'displayLabel', 'state', 'pendingGeneration'], 'pending world result');
    if (typeof source.worldRef !== 'string' || !PUBLIC_WORLD_REF.test(source.worldRef)
      || typeof source.pendingGeneration !== 'boolean') return null;
    return {
      kind: 'world', worldRef: source.worldRef, displayLabel: worldLabelFromUnknown(source.displayLabel),
      state: worldStateFromUnknown(source.state), pendingGeneration: source.pendingGeneration,
    };
  } catch {
    return null;
  }
}

function pendingWorldOperationFromStorage(value: string | null): PendingWorldOperation | null {
  if (!value) return null;
  try {
    const source = objectOf(JSON.parse(value));
    if (!source) return null;
    exactPublicKeys(source, [
      'requestId', 'planId', 'planDigest', 'confirmation', 'expiresAt', 'operation',
      'submittedAt', 'baselineGeneration', 'baselineLastRestore', 'expectedResult',
    ], 'pending world operation');
    if (
      typeof source.requestId !== 'string' || !PUBLIC_GUID.test(source.requestId) || source.requestId !== source.requestId.toLowerCase()
      || typeof source.planId !== 'string' || !PUBLIC_WORLD_PLAN_ID.test(source.planId)
      || typeof source.planDigest !== 'string' || !PUBLIC_SHA256.test(source.planDigest)
      || !['create', 'clone', 'rename', 'archive', 'switch'].includes(String(source.operation))
      || typeof source.expiresAt !== 'string' || !Number.isFinite(Date.parse(source.expiresAt))
      || new Date(source.expiresAt).toISOString() !== source.expiresAt
      || typeof source.submittedAt !== 'string' || !Number.isFinite(Date.parse(source.submittedAt))
      || new Date(source.submittedAt).toISOString() !== source.submittedAt
      || typeof source.baselineGeneration !== 'string' || !PUBLIC_SHA256.test(source.baselineGeneration)
    ) return null;
    const operation = source.operation as WorldPlanOperation;
    if (source.confirmation !== WORLD_CONFIRMATION_BY_OPERATION[operation]) return null;
    const baselineLastRestore = verifiedWorldRestoreReceiptFromUnknown(source.baselineLastRestore);
    if (source.baselineLastRestore !== null && baselineLastRestore === null) return null;
    const expectedResult = pendingWorldExpectedResultFromUnknown(source.expectedResult);
    if (!expectedResult || (operation === 'switch') !== (expectedResult.kind === 'switch')) return null;
    return {
      requestId: source.requestId,
      planId: source.planId,
      planDigest: source.planDigest,
      confirmation: source.confirmation as WorldPlan['requiredConfirmation'],
      expiresAt: new Date(source.expiresAt).toISOString(),
      operation,
      submittedAt: source.submittedAt,
      baselineGeneration: source.baselineGeneration,
      baselineLastRestore,
      expectedResult,
    };
  } catch {
    return null;
  }
}

type WorldClientJournal = { operation: PendingWorldOperation | null; error: string | null };

function worldOperationStorageKey(operation: WorldPlanOperation, requestId: string): string {
  return `${WORLD_OPERATION_STORAGE_PREFIX}${operation}.${requestId}`;
}

function readWorldClientJournal(): WorldClientJournal {
  const operations: PendingWorldOperation[] = [];
  let entries = 0;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(WORLD_OPERATION_STORAGE_PREFIX)) continue;
      entries += 1;
      if (entries > MAX_WORLD_JOURNAL_ENTRIES) {
        return { operation: null, error: 'The local world-operation journal exceeds its safe entry limit. World mutations remain locked.' };
      }
      const suffix = key.slice(WORLD_OPERATION_STORAGE_PREFIX.length);
      const separator = suffix.indexOf('.');
      const operationName = suffix.slice(0, separator);
      const requestId = suffix.slice(separator + 1);
      const operation = pendingWorldOperationFromStorage(window.localStorage.getItem(key));
      if (
        separator < 1 || !operation || operation.operation !== operationName || operation.requestId !== requestId
      ) return { operation: null, error: 'The local world-operation journal is invalid. World mutations remain locked.' };
      operations.push(operation);
    }
  } catch {
    return { operation: null, error: 'The browser could not read the world-operation journal. World mutations remain locked.' };
  }
  if (operations.length > 1) {
    return { operation: null, error: 'Conflicting world-operation journal entries require reconciliation before another mutation.' };
  }
  return { operation: operations[0] ?? null, error: null };
}

async function withWorldMutationLock<T>(callback: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) throw new Error('This browser does not provide the Web Lock required for safe cross-tab world mutations.');
  return navigator.locks.request(WORLD_MUTATION_WEB_LOCK, { mode: 'exclusive' }, callback);
}

function accountFromEnvelope(envelope: AccountEnvelope): AccountStatus {
  const source = objectOf(envelope.account);
  if (!source) throw new Error('The local agent returned an invalid public account status.');
  const status = source.status;
  if (
    source.provider !== 'microsoft'
    || typeof source.configured !== 'boolean'
    || typeof source.signedIn !== 'boolean'
    || typeof source.sessionReady !== 'boolean'
    || !['signed-out', 'signed-in', 'reauthentication-required'].includes(String(status))
    || (source.signedIn && (!source.configured || status !== 'signed-in'))
    || (source.sessionReady && !source.signedIn)
  ) throw new Error('The local agent returned an invalid public account status.');

  const publicAccount = objectOf(source.account);
  const name = publicAccount?.name;
  if (source.signedIn && (typeof name !== 'string' || !PUBLIC_PROFILE_NAME.test(name))) {
    throw new Error('The local agent returned an invalid public account profile.');
  }
  return {
    provider: 'microsoft',
    configured: source.configured,
    signedIn: source.signedIn,
    sessionReady: source.sessionReady,
    status: status as AccountStatus['status'],
    account: source.signedIn ? { name: name as string } : null,
  };
}

function clientFromEnvelope(envelope: ManagedClientEnvelope): ManagedClientStatus {
  const source = objectOf(envelope.client);
  if (!source) throw new Error('The local agent returned an invalid managed-client status.');
  const state = source.state;
  const integrity = source.integrity;
  const validInstallCombination = (
    source.installed === true && state === 'installed' && integrity === 'verified'
  ) || (
    source.installed === false && state === 'not-installed' && integrity === 'not-installed'
  ) || (
    source.installed === false && state === 'invalid' && integrity === 'failed'
  );
  if (
    source.targetInstanceId !== 'family-server'
    || !['not-installed', 'installed', 'invalid'].includes(String(state))
    || !['not-installed', 'verified', 'failed'].includes(String(integrity))
    || typeof source.installed !== 'boolean'
    || typeof source.launchReady !== 'boolean'
    || typeof source.authenticationConfigured !== 'boolean'
    || !validInstallCombination
    || (source.launchReady && (!source.installed || !source.authenticationConfigured))
  ) throw new Error('The local agent returned an invalid managed-client status.');

  const loader = objectOf(source.loader);
  const safeOptionalText = (value: unknown) => typeof value === 'string' && PUBLIC_TEXT.test(value) ? value : undefined;
  const safeInteger = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
  const installedAt = source.installedAt === null
    ? null
    : typeof source.installedAt === 'string' && Number.isFinite(Date.parse(source.installedAt))
      ? new Date(source.installedAt).toISOString()
      : undefined;
  return {
    targetInstanceId: 'family-server',
    state: state as ManagedClientStatus['state'],
    integrity: integrity as ManagedClientStatus['integrity'],
    installed: source.installed,
    minecraftVersion: safeOptionalText(source.minecraftVersion),
    loader: loader ? { name: safeOptionalText(loader.name), version: safeOptionalText(loader.version) } : undefined,
    requiredJavaMajor: safeInteger(source.requiredJavaMajor),
    installedAt,
    artifactCount: safeInteger(source.artifactCount),
    nativeFiles: safeInteger(source.nativeFiles),
    launchReady: source.launchReady,
    authenticationConfigured: source.authenticationConfigured,
  };
}

function flowFromEnvelope(envelope: DeviceFlowEnvelope): DeviceFlow {
  const source = objectOf(envelope.flow);
  const allowedKeys = new Set(['flowId', 'user_code', 'verification_uri', 'expiry', 'status']);
  if (!source || Object.keys(source).length !== allowedKeys.size || Object.keys(source).some((key) => !allowedKeys.has(key))) {
    throw new Error('The local agent returned an invalid public device sign-in flow.');
  }
  if (
    typeof source.flowId !== 'string' || !PUBLIC_GUID.test(source.flowId)
    || typeof source.user_code !== 'string' || !PUBLIC_USER_CODE.test(source.user_code)
    || typeof source.verification_uri !== 'string' || !PUBLIC_VERIFICATION_URIS.has(source.verification_uri as DeviceFlow['verification_uri'])
    || typeof source.expiry !== 'string' || !Number.isFinite(Date.parse(source.expiry))
    || typeof source.status !== 'string' || !DEVICE_FLOW_STATES.has(source.status as DeviceFlowStatus)
  ) throw new Error('The local agent returned an invalid public device sign-in flow.');
  return {
    flowId: source.flowId.toLowerCase(),
    user_code: source.user_code,
    verification_uri: source.verification_uri as DeviceFlow['verification_uri'],
    expiry: new Date(source.expiry).toISOString(),
    status: source.status as DeviceFlowStatus,
  };
}

function accountSummary(account: AccountStatus | null): { label: string; detail: string; color: string } {
  if (!account) return { label: 'STATUS UNAVAILABLE', detail: 'Microsoft account status has not completed.', color: C.gold };
  if (account.signedIn) {
    return {
      label: 'SIGNED IN',
      detail: account.account?.name ?? 'Minecraft account connected',
      color: C.green,
    };
  }
  if (!account.configured) {
    return { label: 'APP REGISTRATION REQUIRED', detail: 'Enter the public Application (client) ID for your Microsoft app registration.', color: C.gold };
  }
  if (account.status === 'reauthentication-required') {
    return { label: 'SIGN-IN EXPIRED', detail: 'Microsoft requires a new device-code sign-in.', color: C.gold };
  }
  return { label: 'NOT SIGNED IN', detail: 'No Minecraft account is connected to the local agent.', color: C.dim };
}

function updateSummary(update: InstanceUpdateStatus): { label: string; detail: string; color: string } {
  const current = update.currentMinecraft ?? 'unknown';
  const target = update.targetMinecraft ?? 'unknown';
  switch (update.state) {
    case 'current':
      return {
        label: 'CATALOG CURRENT',
        detail: `Installed Minecraft ${current}; catalog target ${target}. The component plan also matches the current catalog.`,
        color: C.cyan,
      };
    case 'component-update-available':
      return {
        label: 'COMPONENT-ONLY · AUTO-SAFE',
        detail: `Minecraft remains ${current}; the catalog target is ${target}. Only managed loader/mod components differ, so no Minecraft-version approval is required.`,
        color: C.gold,
      };
    case 'minecraft-update-approval-required':
      return {
        label: 'VERSION CHANGE · APPROVAL REQUIRED',
        detail: `Installed Minecraft ${current} → catalog target ${target}. Mastermind must not apply this Minecraft-version change without explicit owner approval.`,
        color: C.gold,
      };
    case 'blocked-downgrade':
    case 'blocked-unknown-order':
      return {
        label: 'UPDATE BLOCKED',
        detail: `Installed Minecraft ${current}; catalog target ${target}. Mastermind cannot prove this is a safe forward migration, so it will not alter the world.`,
        color: C.red,
      };
    default:
      return {
        label: 'UPDATE STATUS UNKNOWN',
        detail: `Installed Minecraft ${current}; catalog target ${target}. The local agent returned an unrecognized update state.`,
        color: C.red,
      };
  }
}

function backupReason(kind: BackupKind): string {
  if (kind === 'automatic') return 'Automatic policy snapshot';
  if (kind === 'rescue') return 'Pre-restore rescue snapshot';
  return 'Manual owner snapshot';
}

function BackupManagerPanel({
  instance,
  onInstanceChanged,
  allowVerificationAndRestore = true,
}: {
  instance: ManagedInstance;
  onInstanceChanged: () => Promise<void>;
  allowVerificationAndRestore?: boolean;
}) {
  const requestGeneration = useRef(0);
  const policyDirty = useRef(false);
  const onInstanceChangedRef = useRef(onInstanceChanged);
  const actionRef = useRef<string | null>(null);
  const activeBackupLoads = useRef(0);
  const [inventory, setInventory] = useState<BackupInventory | null>(null);
  const [policyDraft, setPolicyDraft] = useState<BackupPolicyDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [inventoryRefreshing, setInventoryRefreshing] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [completionUnknown, setCompletionUnknown] = useState<BackupCompletionUnknown | null>(null);
  const [reconciliationObservation, setReconciliationObservation] = useState<BackupReconciliationObservation | null>(null);
  const [unconfirmedResult, setUnconfirmedResult] = useState<BackupUnconfirmedResult | null>(null);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);

  useEffect(() => {
    onInstanceChangedRef.current = onInstanceChanged;
  }, [onInstanceChanged]);

  useEffect(() => {
    actionRef.current = action;
  }, [action]);

  const loadBackups = useCallback(async (showLoading = false, preserveMessage = false): Promise<BackupInventory | null> => {
    const generation = ++requestGeneration.current;
    activeBackupLoads.current += 1;
    setInventoryRefreshing(true);
    if (showLoading) setLoading(true);
    try {
      const value = await api<unknown>(`/api/minecraft/instances/${encodeURIComponent(instance.id)}/backups`);
      const next = backupInventoryFromUnknown(value, instance.id);
      if (generation !== requestGeneration.current) return null;
      setInventory(next);
      if (!policyDirty.current) setPolicyDraft(next.policy);
      if (!preserveMessage) {
        setMessageError(false);
        setMessage('');
      }
      return next;
    } catch (error) {
      if (generation !== requestGeneration.current) return null;
      const failure = failureOf(error);
      if (!preserveMessage) {
        setInventory(null);
        setMessageError(true);
        setMessage(failure.status === 404
          ? 'Backup management is not available from this local agent yet. Restart the local command center after the backup service is installed.'
          : failure.message);
      }
      return null;
    } finally {
      activeBackupLoads.current = Math.max(0, activeBackupLoads.current - 1);
      if (activeBackupLoads.current === 0) setInventoryRefreshing(false);
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [instance.id]);

  useEffect(() => {
    if (!completionUnknown) return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      if (actionRef.current !== null) {
        if (!disposed) timer = window.setTimeout(() => void poll(), 1_000);
        return;
      }
      const nextInventory = await loadBackups(false, true);
      if (nextInventory && !disposed) {
        let observedInstance: ManagedInstance | null = null;
        if (completionUnknown.action === 'restore') {
          try {
            const envelope = instanceEnvelopeFromUnknown(await api<unknown>('/api/minecraft/instances'));
            observedInstance = envelope.instances.find((candidate) => candidate.id === instance.id) ?? null;
            if (!observedInstance) throw new Error('The restored instance is absent from local inventory.');
          } catch {
            observedInstance = null;
          }
        }
        if (completionUnknown.action !== 'restore' || observedInstance) {
          setReconciliationObservation((current) => ({
            startedAt: completionUnknown.startedAt,
            completedBarrierReads: current?.startedAt === completionUnknown.startedAt
              ? current.completedBarrierReads + 1
              : 1,
            inventory: nextInventory,
            instance: observedInstance,
          }));
          if (completionUnknown.action === 'restore') await Promise.allSettled([onInstanceChangedRef.current()]);
        }
      }
      if (!disposed) timer = window.setTimeout(() => void poll(), 5_000);
    };
    const initial = window.setTimeout(() => void poll(), 0);
    return () => {
      disposed = true;
      window.clearTimeout(initial);
      if (timer !== undefined) window.clearTimeout(timer);
      requestGeneration.current += 1;
    };
  }, [completionUnknown, instance.id, loadBackups]);

  const stopped = instance.status === 'stopped';
  const working = action !== null || inventoryRefreshing || completionUnknown !== null || unconfirmedResult !== null;

  const markCompletionUnknown = (error: unknown, pending: BackupCompletionUnknown): boolean => {
    const failure = failureOf(error);
    if (failure.code !== 'BACKUP_OPERATION_COMPLETION_UNKNOWN') return false;
    setReconciliationObservation(null);
    setUnconfirmedResult(null);
    setCompletionUnknown(pending);
    setMessageError(false);
    setMessage(
      `${failure.code === 'BACKUP_OPERATION_COMPLETION_UNKNOWN' ? failure.message : 'The browser did not receive a trustworthy final backup result.'} `
      + 'This is not evidence that the agent is offline. '
      + 'Mastermind has locked all backup mutations and is polling authoritative inventory and instance status every five seconds.',
    );
    return true;
  };

  useEffect(() => {
    if (
      !completionUnknown
      || !reconciliationObservation
      || reconciliationObservation.startedAt !== completionUnknown.startedAt
    ) return;

    const authoritativeInventory = reconciliationObservation.inventory;
    const finish = (nextMessage: string, error = false) => {
      setReconciliationObservation(null);
      setCompletionUnknown(null);
      setMessageError(error);
      setMessage(nextMessage);
    };
    const finishUnconfirmedAfterReview = () => {
      if (reconciliationObservation.completedBarrierReads < 2) return;
      setReconciliationObservation(null);
      setCompletionUnknown(null);
      setUnconfirmedResult({ action: completionUnknown.action, startedAt: completionUnknown.startedAt });
      setMessageError(true);
      setMessage(
        `The ${completionUnknown.action} operation ended, but the requested change was not confirmed after two authoritative status reads. `
        + 'No retry was sent. Review the current backup inventory and instance status, then acknowledge the unconfirmed result before retrying.',
      );
    };

    if (completionUnknown.action === 'create') {
      const created = authoritativeInventory.backups.find((backup) => (
        backup.kind === 'manual'
        && !completionUnknown.baselineBackupIds.includes(backup.backupId)
        && backup.integrity === 'verified'
        && backup.verifiedAt !== null
      ));
      if (created) {
        finish(`Manual backup ${created.backupId} was created and verified; inventory confirmed the previously unknown outcome.`);
      } else {
        finishUnconfirmedAfterReview();
      }
      return;
    }

    if (completionUnknown.action === 'policy') {
      const expected = completionUnknown.expectedPolicy;
      if (
        authoritativeInventory.policy.enabled === expected.enabled
        && authoritativeInventory.policy.intervalHours === expected.intervalHours
        && authoritativeInventory.policy.retentionCount === expected.retentionCount
      ) {
        policyDirty.current = false;
        setPolicyDraft(authoritativeInventory.policy);
        finish('Authoritative backup status confirms that the automatic-backup policy was saved.');
      } else {
        finishUnconfirmedAfterReview();
      }
      return;
    }

    if (completionUnknown.action === 'verify') {
      const backup = authoritativeInventory.backups.find((candidate) => candidate.backupId === completionUnknown.backupId);
      if (backup?.integrity === 'failed' && completionUnknown.previousIntegrity !== 'failed') {
        finish(`Backup ${backup.backupId} failed full verification; inventory confirmed the previously unknown outcome.`, true);
      } else if (
        backup?.integrity === 'verified'
        && backup.verifiedAt !== null
        && backup.verifiedAt !== completionUnknown.previousVerifiedAt
      ) {
        finish(`Backup ${backup.backupId} passed full verification; inventory confirmed the previously unknown outcome.`);
      } else {
        finishUnconfirmedAfterReview();
      }
      return;
    }

    if (completionUnknown.action === 'purge') {
      if (
        completionUnknown.baselineInventoryComplete
        && !authoritativeInventory.backups.some((backup) => backup.backupId === completionUnknown.backupId)
      ) {
        finish(`Backup ${completionUnknown.backupId} is absent from authoritative inventory, confirming that the purge completed.`);
      } else {
        finishUnconfirmedAfterReview();
      }
      return;
    }

    if (completionUnknown.action === 'restore') {
      const lastRestore = reconciliationObservation.instance?.lastRestore;
      if (
        lastRestore?.state === 'verified'
        && lastRestore.backupId === completionUnknown.backupId
        && typeof lastRestore.rescueBackupId === 'string'
        && PUBLIC_BACKUP_ID.test(lastRestore.rescueBackupId)
        && typeof lastRestore.restoredAt === 'string'
        && Number.isFinite(Date.parse(lastRestore.restoredAt))
        && lastRestore.restoredAt !== completionUnknown.previousRestoredAt
      ) {
        finish(
          `Instance status confirms that backup ${completionUnknown.backupId} was restored and verified at ${formatBackupTime(lastRestore.restoredAt)}.`,
        );
      } else {
        finishUnconfirmedAfterReview();
      }
    }
  }, [completionUnknown, reconciliationObservation]);

  const acknowledgeUnconfirmedResult = () => {
    if (!unconfirmedResult) return;
    const confirmed = window.confirm(
      `ACKNOWLEDGE UNCONFIRMED RESULT\n\nThe ${unconfirmedResult.action} operation ended without a confirmed requested change. `
      + 'Confirm that you reviewed the current backup inventory and instance status. This only unlocks controls; it does not retry any operation.',
    );
    if (!confirmed) return;
    setUnconfirmedResult(null);
    setMessageError(false);
    setMessage('Unconfirmed result acknowledged. No operation was retried; backup controls are unlocked for a deliberate next action.');
  };

  const createBackup = async () => {
    if (!stopped || working || activeBackupLoads.current > 0 || !inventory) return;
    const pending: BackupCompletionUnknown = {
      action: 'create',
      startedAt: new Date().toISOString(),
      baselineBackupIds: inventory.backups.map((backup) => backup.backupId),
    };
    setAction('create');
    setMessageError(false);
    setMessage('Creating and fully verifying a manual backup...');
    try {
      const result = manualBackupFromActionEnvelope(await api<unknown>(
        `/api/minecraft/instances/${encodeURIComponent(instance.id)}/backups`,
        { method: 'POST' },
      ));
      const created = result.backup;
      if (created.integrity !== 'verified' || created.verifiedAt === null) {
        throw new Error('The local agent did not confirm a fully verified manual backup.');
      }
      if (result.retention?.state === 'failed') {
        setMessageError(true);
        setMessage(
          `Manual backup ${created.backupId} was created and fully verified, but retention cleanup failed (${result.retention.code}). `
          + 'The new backup remains valid; review backup inventory and available storage before relying on automatic cleanup.',
        );
      } else if (result.retention?.state === 'applied') {
        setMessage(`Manual backup ${created.backupId} was created and verified; retention cleanup completed.`);
      } else {
        setMessageError(true);
        setMessage(
          `Manual backup ${created.backupId} was created and fully verified, but this agent did not report retention-cleanup status. `
          + 'The new backup remains valid; review backup inventory.',
        );
      }
      await loadBackups(false, true);
    } catch (error) {
      if (!markCompletionUnknown(error, pending)) {
        setMessageError(true);
        setMessage(failureOf(error).message);
      }
    } finally {
      setAction(null);
    }
  };

  const savePolicy = async () => {
    if (!stopped || working || activeBackupLoads.current > 0 || !policyDraft) return;
    const requestedPolicy = { ...policyDraft };
    const pending: BackupCompletionUnknown = {
      action: 'policy',
      startedAt: new Date().toISOString(),
      expectedPolicy: requestedPolicy,
    };
    setAction('policy');
    setMessageError(false);
    setMessage('Saving the automatic-backup policy...');
    try {
      const value = await api<unknown>(`/api/minecraft/instances/${encodeURIComponent(instance.id)}/backups/policy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestedPolicy),
      });
      const envelope = objectOf(value);
      if (envelope?.ok !== true || envelope.instanceId !== instance.id) throw new Error('The local agent did not confirm the backup policy.');
      backupPolicyFromUnknown(envelope.policy);
      backupStatusFromUnknown(envelope.status);
      policyDirty.current = false;
      setMessage('Automatic-backup policy saved. A due backup will wait until the server is safely stopped.');
      await loadBackups(false, true);
    } catch (error) {
      if (!markCompletionUnknown(error, pending)) {
        setMessageError(true);
        setMessage(failureOf(error).message);
      }
    } finally {
      setAction(null);
    }
  };

  const verifyBackup = async (backup: BackupRecord) => {
    if (!stopped || working || activeBackupLoads.current > 0) return;
    const pending: BackupCompletionUnknown = {
      action: 'verify',
      startedAt: new Date().toISOString(),
      backupId: backup.backupId,
      previousIntegrity: backup.integrity,
      previousVerifiedAt: backup.verifiedAt,
    };
    setAction(`verify:${backup.backupId}`);
    setMessageError(false);
    setMessage(`Rehashing every file in ${backup.backupId}...`);
    try {
      const verified = backupFromActionEnvelope(await api<unknown>(
        `/api/minecraft/instances/${encodeURIComponent(instance.id)}/backups/${encodeURIComponent(backup.backupId)}/verify`,
        { method: 'POST' },
      ));
      if (verified.backupId !== backup.backupId || verified.integrity !== 'verified') {
        throw new Error('The local agent did not confirm full backup integrity.');
      }
      setMessage(`Backup ${backup.backupId} passed full verification.`);
      await loadBackups(false, true);
    } catch (error) {
      if (!markCompletionUnknown(error, pending)) {
        setMessageError(true);
        setMessage(failureOf(error).message);
      }
    } finally {
      setAction(null);
    }
  };

  const restoreBackup = async (backup: BackupRecord) => {
    if (!stopped || working || activeBackupLoads.current > 0 || !backup.restorable || backup.integrity !== 'verified') return;
    let pending: BackupCompletionUnknown | null = null;
    setAction(`restore-plan:${backup.backupId}`);
    setMessageError(false);
    setMessage('Preparing a short-lived restore plan against the current server state...');
    try {
      const plan = restorePlanFromUnknown(await api<unknown>(
        `/api/minecraft/instances/${encodeURIComponent(instance.id)}/backups/${encodeURIComponent(backup.backupId)}/restore-plan`,
        { method: 'POST' },
      ), backup.backupId);
      if (Date.parse(plan.expiresAt) <= Date.now()) throw new Error('The restore plan expired before it could be approved.');
      const confirmed = window.confirm(
        `IRREVERSIBLE RESTORE\n\nRestore backup ${backup.backupId} from ${formatBackupTime(backup.createdAt)}?\n\n`
        + `Current world state (Minecraft ${plan.currentMinecraftVersion}) will be replaced with the selected backup state (Minecraft ${plan.minecraftVersion}).\n\n`
        + 'MANDATORY SAFETY SNAPSHOT: Before replacing anything, Mastermind will create and fully verify a rescue backup of the current server. '
        + 'If that rescue snapshot cannot be created and verified, the restore will abort. The managed server stack will be preserved.\n\n'
        + `This approval expires at ${formatBackupTime(plan.expiresAt)}. Continue?`,
      );
      if (!confirmed) {
        setMessage('Restore cancelled. The short-lived restore plan was not used.');
        return;
      }

      setAction(`restore:${backup.backupId}`);
      setMessage('Creating the verified rescue snapshot, then restoring the selected backup...');
      pending = {
        action: 'restore',
        startedAt: new Date().toISOString(),
        backupId: backup.backupId,
        previousRestoredAt: instance.lastRestore?.restoredAt ?? null,
      };
      const value = await api<unknown>(
        `/api/minecraft/instances/${encodeURIComponent(instance.id)}/backups/${encodeURIComponent(backup.backupId)}/restore`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approval: { planId: plan.planId } }),
        },
      );
      const envelope = objectOf(value);
      const restoration = objectOf(envelope?.restoration);
      if (
        envelope?.ok !== true || !restoration || restoration.backupId !== backup.backupId
        || typeof restoration.rescueBackupId !== 'string' || !PUBLIC_BACKUP_ID.test(restoration.rescueBackupId)
        || restoration.safetySnapshotVerified !== true || restoration.stackPreserved !== true
      ) throw new Error('The local agent did not confirm a safety-verified restore.');
      const restoredAt = publicTimestamp(restoration.restoredAt, false);
      const restoredVersion = publicBackupText(restoration.minecraftVersion, 'restored Minecraft version');
      setMessage(
        `Restore completed at ${formatBackupTime(restoredAt)}. Minecraft ${restoredVersion} state is active; `
        + `verified rescue backup ${restoration.rescueBackupId} preserves the replaced state.`,
      );
      await onInstanceChanged();
      await loadBackups(false, true);
    } catch (error) {
      if (!pending || !markCompletionUnknown(error, pending)) {
        setMessageError(true);
        setMessage(failureOf(error).message);
      }
    } finally {
      setAction(null);
    }
  };

  const purgeBackup = async (backup: BackupRecord) => {
    if (!stopped || working || activeBackupLoads.current > 0 || !backup.purgeable) return;
    const confirmed = window.confirm(
      `PERMANENTLY PURGE BACKUP\n\nDelete ${backup.backupId}, created ${formatBackupTime(backup.createdAt)}? `
      + 'This cannot be undone. The active server is not changed.',
    );
    if (!confirmed) return;
    const pending: BackupCompletionUnknown = {
      action: 'purge',
      startedAt: new Date().toISOString(),
      backupId: backup.backupId,
      baselineInventoryComplete: (inventory?.backups.length ?? 100) < 100,
    };
    setAction(`purge:${backup.backupId}`);
    setMessageError(false);
    setMessage(`Permanently purging ${backup.backupId}...`);
    try {
      const value = await api<unknown>(
        `/api/minecraft/instances/${encodeURIComponent(instance.id)}/backups/${encodeURIComponent(backup.backupId)}/purge`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation: 'PURGE' }),
        },
      );
      const envelope = objectOf(value);
      const purge = objectOf(envelope?.purge);
      if (envelope?.ok !== true || purge?.backupId !== backup.backupId) throw new Error('The local agent did not confirm backup deletion.');
      publicTimestamp(purge.purgedAt, false);
      setMessage(`Backup ${backup.backupId} was permanently purged.`);
      await loadBackups(false, true);
    } catch (error) {
      if (!markCompletionUnknown(error, pending)) {
        setMessageError(true);
        setMessage(failureOf(error).message);
      }
    } finally {
      setAction(null);
    }
  };

  const status = inventory?.status;
  const statusColor = completionUnknown || unconfirmedResult ? C.gold : status?.state === 'failed' ? C.red : status?.deferred || status?.due ? C.gold : C.green;
  const statusLabel = completionUnknown
    ? 'COMPLETION UNKNOWN · RECONCILING'
    : unconfirmedResult
      ? 'UNCONFIRMED RESULT · REVIEW REQUIRED'
    : status?.state === 'deferred-running'
    ? 'DUE · DEFERRED WHILE RUNNING'
    : status?.state === 'creating'
      ? 'CREATING BACKUP'
      : status?.state === 'restoring'
        ? 'RESTORING BACKUP'
        : status?.state === 'failed'
          ? 'BACKUP ACTION FAILED'
          : status?.due
            ? 'BACKUP DUE'
            : 'SCHEDULE IDLE';

  return (
    <section style={{ ...panel, borderColor: `${C.magenta}45` }}>
      <div style={{ alignItems: 'flex-start', display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' }}>
        <div>
          <div style={{ color: C.magenta, fontFamily: mono, fontSize: 10, letterSpacing: 1.5 }}>BACKUPS · VERIFIED RESTORES ONLY · {instance.displayName}</div>
          <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.55, marginTop: 5 }}>
            Backup listings show the last recorded integrity result; loading this list does not rehash disk data. Use Verify backup for a fresh full check.
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Button disabled={loading || inventoryRefreshing || action !== null} onClick={() => void loadBackups(true, completionUnknown !== null)}>{loading || inventoryRefreshing ? 'LOADING…' : 'REFRESH BACKUPS'}</Button>
          <Button color={C.magenta} disabled={!stopped || working || loading || !inventory} onClick={() => void createBackup()}>
            {action === 'create' ? 'CREATING…' : 'CREATE MANUAL BACKUP'}
          </Button>
        </div>
      </div>

      {!stopped ? (
        <div style={{ background: `${C.gold}0a`, border: `1px solid ${C.gold}35`, borderRadius: 5, color: C.gold, fontSize: 10, lineHeight: 1.5, marginTop: 10, padding: '8px 10px' }}>
          BACKUP MUTATIONS DEFERRED · Stop the server safely before creating, verifying, restoring, purging, or changing policy. Mastermind never stops a running server just to satisfy the schedule.
        </div>
      ) : null}

      {message ? (
        <div role={messageError ? 'alert' : 'status'} style={{ color: messageError ? C.red : completionUnknown || unconfirmedResult ? C.gold : C.green, fontSize: 10, lineHeight: 1.5, marginTop: 9 }}>
          {message}
        </div>
      ) : null}

      {unconfirmedResult ? (
        <div style={{ alignItems: 'center', background: `${C.gold}0a`, border: `1px solid ${C.gold}35`, borderRadius: 5, display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', marginTop: 9, padding: '8px 10px' }}>
          <span style={{ color: C.gold, fontSize: 10, lineHeight: 1.5 }}>
            Review required: verify inventory and instance state before unlocking. Acknowledging does not retry the {unconfirmedResult.action} operation.
          </span>
          <Button color={C.gold} onClick={acknowledgeUnconfirmedResult}>ACKNOWLEDGE UNCONFIRMED RESULT</Button>
        </div>
      ) : null}

      {inventory && policyDraft ? (
        <>
          <div style={{ alignItems: 'end', display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,170px),1fr))', marginTop: 12 }}>
            <div>
              <label style={label} htmlFor={`backup-enabled-${instance.id}`}>Automatic backups</label>
              <select
                id={`backup-enabled-${instance.id}`}
                disabled={working}
                value={policyDraft.enabled ? 'enabled' : 'disabled'}
                onChange={(event) => {
                  policyDirty.current = true;
                  setPolicyDraft((current) => current ? { ...current, enabled: event.target.value === 'enabled' } : current);
                }}
                style={input}
              >
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
            <div>
              <label style={label} htmlFor={`backup-interval-${instance.id}`}>Fixed interval</label>
              <select
                id={`backup-interval-${instance.id}`}
                disabled={working}
                value={policyDraft.intervalHours}
                onChange={(event) => {
                  policyDirty.current = true;
                  setPolicyDraft((current) => current ? { ...current, intervalHours: Number(event.target.value) as BackupIntervalHours } : current);
                }}
                style={input}
              >
                <option value={6}>Every 6 hours</option>
                <option value={12}>Every 12 hours</option>
                <option value={24}>Daily</option>
                <option value={72}>Every 3 days</option>
                <option value={168}>Weekly</option>
              </select>
            </div>
            <div>
              <label style={label} htmlFor={`backup-retention-${instance.id}`}>Retain count</label>
              <select
                id={`backup-retention-${instance.id}`}
                disabled={working}
                value={policyDraft.retentionCount}
                onChange={(event) => {
                  policyDirty.current = true;
                  setPolicyDraft((current) => current ? { ...current, retentionCount: Number(event.target.value) } : current);
                }}
                style={input}
              >
                {Array.from({ length: 28 }, (_, index) => index + 3).map((count) => <option key={count} value={count}>{count} backups</option>)}
              </select>
            </div>
            <div><Button color={C.magenta} disabled={!stopped || working || !policyDirty.current} onClick={() => void savePolicy()}>{action === 'policy' ? 'SAVING…' : 'SAVE POLICY'}</Button></div>
          </div>

          <div style={{ background: `${statusColor}09`, border: `1px solid ${statusColor}30`, borderRadius: 5, marginTop: 10, padding: '8px 10px' }}>
            <Badge color={statusColor}>{statusLabel}</Badge>
            <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.5, marginTop: 6 }}>
              {completionUnknown
                ? `No final response was received for the ${completionUnknown.action} operation started at ${formatBackupTime(completionUnknown.startedAt)}. Keep the local agent running; all backup mutations remain locked until an authoritative result is visible.`
                : unconfirmedResult
                  ? `The ${unconfirmedResult.action} operation ended, but the requested result was not confirmed. Controls remain locked until you review the current state and explicitly acknowledge it.`
                : status?.deferred
                ? 'An automatic backup is due, but the server is running. It will remain deferred until a safe stopped state; no forced stop occurs.'
                : inventory.policy.enabled
                  ? `Next due: ${formatBackupTime(status?.nextDueAt ?? null)}. Last automatic attempt: ${formatBackupTime(status?.lastAutomaticAttemptAt ?? null)}.`
                  : 'Automatic backups are disabled. Manual and rescue backups remain available while stopped.'}
              {!completionUnknown && !unconfirmedResult && status?.lastAutomaticResult ? ` Last result: ${status.lastAutomaticResult}.` : ''}
              {!completionUnknown && !unconfirmedResult && status?.lastError ? ` Error: ${status.lastError}` : ''}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {!inventory.backups.length ? (
              <div style={{ color: C.dim, fontSize: 11 }}>No backups are recorded for this instance.</div>
            ) : inventory.backups.map((backup) => {
              const integrityColor = backup.integrity === 'verified' ? C.green : backup.integrity === 'failed' ? C.red : C.gold;
              return (
                <div key={backup.backupId} style={{ background: 'rgba(0,0,0,0.28)', border: `1px solid ${integrityColor}30`, borderLeft: `3px solid ${integrityColor}`, borderRadius: 5, display: 'grid', gap: 9, gridTemplateColumns: 'minmax(0,1fr) auto', padding: '9px 10px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <Badge color={integrityColor}>{backup.integrity.toUpperCase()}</Badge>
                      <span style={{ color: '#e8ffff', fontFamily: mono, fontSize: 9 }}>{backup.backupId}</span>
                      <Badge color={backup.kind === 'rescue' ? C.magenta : C.cyan}>{backupReason(backup.kind)}</Badge>
                    </div>
                    <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.5, marginTop: 6 }}>
                      Created {formatBackupTime(backup.createdAt)} · Minecraft {backup.minecraftVersion} · {formatBackupBytes(backup.bytes)} · {backup.files.toLocaleString()} files
                    </div>
                    <div style={{ color: C.dim, fontSize: 9, lineHeight: 1.5, marginTop: 3 }}>
                      {backup.verifiedAt ? `Last fully verified ${formatBackupTime(backup.verifiedAt)}.` : 'No successful full verification is recorded.'}
                    </div>
                  </div>
                  <div style={{ alignContent: 'start', display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'flex-end' }}>
                    {allowVerificationAndRestore ? (
                      <>
                        <Button disabled={!stopped || working} onClick={() => void verifyBackup(backup)}>{action === `verify:${backup.backupId}` ? 'VERIFYING…' : 'VERIFY BACKUP'}</Button>
                        <Button color={C.gold} disabled={!stopped || working || !backup.restorable || backup.integrity !== 'verified'} onClick={() => void restoreBackup(backup)}>
                          {action?.includes(backup.backupId) && action.startsWith('restore') ? 'RESTORING…' : 'RESTORE'}
                        </Button>
                      </>
                    ) : null}
                    <Button color={C.red} disabled={!stopped || working || !backup.purgeable} onClick={() => void purgeBackup(backup)}>
                      {action === `purge:${backup.backupId}` ? 'PURGING…' : 'PURGE'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : loading ? (
        <div style={{ color: C.dim, fontSize: 11, marginTop: 10 }}>Loading backup inventory…</div>
      ) : (
        <div style={{ color: C.dim, fontSize: 11, marginTop: 10 }}>Backup inventory is not loaded. Select Refresh Backups when you need it.</div>
      )}
    </section>
  );
}

function adminActionLabel(kind: AdminActionKind): string {
  return kind.replace('.', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ServerAdministrationPanel({ instance }: { instance: ManagedInstance }) {
  const [administration, setAdministration] = useState<AdministrationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);
  const [pendingOperation, setPendingOperation] = useState<PendingAdminOperation | null>(null);
  const [pendingStorageLoaded, setPendingStorageLoaded] = useState(false);
  const [lastOperation, setLastOperation] = useState<AdminOperation | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PendingAdminPlan | null>(null);
  const [confirmationInput, setConfirmationInput] = useState('');
  const [broadcast, setBroadcast] = useState('');
  const [player, setPlayer] = useState('');
  const [reasonCode, setReasonCode] = useState<AdminReasonCode>('operator-request');
  const requestGeneration = useRef(0);

  const managedFamilyServer = instance.id === 'family-server'
    && instance.projectId === 'family-server'
    && instance.kind === 'server';

  const loadAdministration = useCallback(async (showLoading = false) => {
    const generation = ++requestGeneration.current;
    if (showLoading) setLoading(true);
    if (!managedFamilyServer) {
      setAdministration(null);
      setStatusError('Administration controls are pinned to the owned Family Server instance.');
      setLoading(false);
      return;
    }
    try {
      const value = await api<unknown>('/api/minecraft/instances/family-server/admin');
      const next = administrationFromUnknown(value);
      if (generation !== requestGeneration.current) return;
      setAdministration(next);
      setStatusError('');
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      const failure = failureOf(error);
      setAdministration(null);
      setStatusError(failure.status === 404
        ? 'Restart the local command center to load typed Family Server administration.'
        : failure.message);
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [managedFamilyServer]);

  useEffect(() => {
    setPendingOperation(pendingAdminOperationFromStorage(window.localStorage.getItem(ADMIN_PENDING_STORAGE_KEY)));
    setPendingStorageLoaded(true);
  }, []);

  useEffect(() => {
    if (!pendingStorageLoaded) return;
    if (pendingOperation) window.localStorage.setItem(ADMIN_PENDING_STORAGE_KEY, JSON.stringify(pendingOperation));
    else window.localStorage.removeItem(ADMIN_PENDING_STORAGE_KEY);
  }, [pendingOperation, pendingStorageLoaded]);

  useEffect(() => {
    const synchronizePendingOperation = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || event.key !== ADMIN_PENDING_STORAGE_KEY) return;
      if (event.newValue === null) {
        setPendingOperation(null);
        return;
      }
      const synchronized = pendingAdminOperationFromStorage(event.newValue);
      if (synchronized) setPendingOperation(synchronized);
    };
    window.addEventListener('storage', synchronizePendingOperation);
    return () => window.removeEventListener('storage', synchronizePendingOperation);
  }, []);

  const pendingRequestId = pendingOperation?.requestId;
  const pendingKind = pendingOperation?.kind;
  const pendingPlayer = pendingOperation?.player;
  useEffect(() => {
    if (!pendingRequestId || !pendingKind) return;
    let disposed = false;
    let timer: number | undefined;
    const reconcile = async () => {
      try {
        const value = await api<unknown>(`/api/minecraft/instances/family-server/admin/operations/${encodeURIComponent(pendingRequestId)}`);
        const operation = adminOperationFromUnknown(value, {
          requestId: pendingRequestId,
          kind: pendingKind,
          ...(pendingPlayer === undefined ? {} : { player: pendingPlayer }),
        });
        if (disposed) return;
        setLastOperation(operation);
        setPendingOperation((current) => current?.requestId === operation.requestId
          ? { ...current, observedState: operation.state }
          : current);
        setMessageError(operation.state !== 'delivered-unconfirmed');
        setMessage(
          operation.state === 'delivered-unconfirmed'
            ? `${adminActionLabel(operation.kind)} ${operation.requestId} was written to the owned Family Server input stream. Minecraft consumption and application remain unconfirmed.${operation.outputRequested ? ' Output was requested and may be reviewed in existing server logs; it is not authoritative player state.' : ''}`
            : operation.state === 'rejected-before-delivery'
              ? `${adminActionLabel(operation.kind)} ${operation.requestId} was rejected before delivery; the operation is durably reconciled.`
              : `${adminActionLabel(operation.kind)} ${operation.requestId} has a durable delivery-unknown result. Do not retry it automatically.`,
        );
      } catch (error) {
        if (disposed) return;
        const failure = failureOf(error);
        if (failure.status !== 404) {
          setMessageError(true);
          setMessage(`Operation reconciliation is still pending: ${failure.message}`);
        }
      }
      if (!disposed) timer = window.setTimeout(() => void reconcile(), 5_000);
    };
    void reconcile();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pendingKind, pendingPlayer, pendingRequestId]);

  const baseCanOperate = managedFamilyServer
    && pendingStorageLoaded
    && instance.status === 'running'
    && administration?.available === true
    && administration.running
    && busyRequestId === null
    && pendingOperation === null;
  const canOperate = baseCanOperate && pendingPlan === null;

  const submitAction = async (requestId: string, action: AdminAction, approval?: { planId: string; confirmation: string }) => {
    if (!baseCanOperate) return;
    const expectedPlayer = 'player' in action ? action.player : undefined;
    const pending: PendingAdminOperation = {
      requestId,
      kind: action.kind,
      ...(expectedPlayer === undefined ? {} : { player: expectedPlayer }),
      startedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(ADMIN_PENDING_STORAGE_KEY, JSON.stringify(pending));
    setPendingOperation(pending);
    setBusyRequestId(requestId);
    setMessageError(false);
    setMessage(`Submitting typed ${adminActionLabel(action.kind)} request ${requestId}...`);
    try {
      const operation = adminOperationFromUnknown(await api<unknown>(
        '/api/minecraft/instances/family-server/admin/actions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, ...action, ...(approval ? { approval } : {}) }),
        },
      ), { requestId, kind: action.kind, ...(expectedPlayer === undefined ? {} : { player: expectedPlayer }) });
      setLastOperation(operation);
      setPendingOperation((current) => current?.requestId === operation.requestId
        ? { ...current, observedState: operation.state }
        : current);
      setMessageError(operation.state !== 'delivered-unconfirmed');
      setMessage(
        `${adminActionLabel(operation.kind)} ${operation.requestId} was written to the owned Family Server input stream at ${new Date(operation.updatedAt).toLocaleString()}. `
        + `Minecraft consumption and application remain unconfirmed.${operation.outputRequested ? ' Output was requested and may be reviewed in existing server logs; it is not authoritative player state.' : ''}`,
      );
      await loadAdministration(false);
    } catch (error) {
      const failure = failureOf(error);
      if (!ADMIN_AUTHORITATIVE_NO_DELIVERY_CODES.has(failure.code)) {
        setMessageError(true);
        setMessage(`${failure.message} Request ${requestId} is locked for exact operation reconciliation. No automatic retry will be sent.`);
      } else {
        setPendingOperation(null);
        window.localStorage.removeItem(ADMIN_PENDING_STORAGE_KEY);
        setMessageError(true);
        setMessage(`${failure.message} The agent rejected this request before an ambiguous delivery result; controls are unlocked and no retry was sent.`);
      }
    } finally {
      setBusyRequestId(null);
    }
  };

  const requestProtectedPlan = async (action: Exclude<AdminAction, { kind: 'players.refresh' | 'whitelist.refresh' | 'broadcast' }>) => {
    if (!canOperate) return;
    const requestId = window.crypto.randomUUID();
    setBusyRequestId(requestId);
    setMessageError(false);
    setMessage(`Preparing a launch-bound ${adminActionLabel(action.kind)} approval plan...`);
    try {
      const plan = adminPlanFromUnknown(await api<unknown>('/api/minecraft/instances/family-server/admin/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action }),
      }), requestId);
      if (Date.parse(plan.expiresAt) <= Date.now()) throw new Error('The local agent returned an expired administration plan.');
      setPendingPlan({ plan, action });
      setConfirmationInput('');
      setMessage('Review the exact action, manual target, launch binding, and expiry; then type the server-issued confirmation phrase.');
    } catch (error) {
      const failure = failureOf(error);
      setMessageError(true);
      setMessage(failure.code === 'ADMIN_PLAN_COMPLETION_UNKNOWN'
        ? 'The plan response was lost. No action was submitted. Refresh availability before preparing a new plan.'
        : failure.message);
    } finally {
      setBusyRequestId(null);
    }
  };

  const requestPlayerPlan = (kind: Extract<AdminActionKind,
    'whitelist.add' | 'whitelist.remove' | 'player.kick' | 'player.ban' | 'player.pardon' | 'player.op' | 'player.deop'>) => {
    const javaProfile = player.trim();
    if (!JAVA_PROFILE_NAME.test(javaProfile)) {
      setMessageError(true);
      setMessage('Enter a Java profile name containing 3 to 16 ASCII letters, numbers, or underscores. Bedrock gamertags are not accepted in this version.');
      return;
    }
    void requestProtectedPlan(
      kind === 'player.kick' || kind === 'player.ban'
        ? { kind, player: javaProfile, reasonCode }
        : { kind, player: javaProfile },
    );
  };

  const submitApprovedPlan = () => {
    if (!pendingPlan || confirmationInput !== pendingPlan.plan.confirmation || Date.parse(pendingPlan.plan.expiresAt) <= Date.now()) return;
    const { plan, action } = pendingPlan;
    setPendingPlan(null);
    setConfirmationInput('');
    void submitAction(plan.requestId, action, { planId: plan.planId, confirmation: plan.confirmation });
  };

  const acknowledgeReconciledOperation = () => {
    if (!pendingOperation?.observedState || !['delivered-unconfirmed', 'rejected-before-delivery'].includes(pendingOperation.observedState)) return;
    setPendingOperation(null);
    setMessageError(false);
    setMessage(`Durable ${pendingOperation.observedState} result acknowledged. No operation was retried.`);
  };

  const statusColor = administration?.available ? C.green : instance.status === 'running' ? C.gold : C.dim;
  const statusLabel = loading
    ? 'CHECKING'
    : administration?.available
      ? 'TYPED INPUT READY'
      : administration?.reason === 'instance-not-running'
        ? 'SERVER STOPPED'
        : administration?.reason === 'process-unavailable'
          ? 'PROCESS INPUT UNAVAILABLE'
          : administration
            ? 'UNAVAILABLE'
            : 'NOT LOADED';

  return (
    <section style={{ ...panel, borderColor: `${statusColor}45` }}>
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
        <div style={{ color: statusColor, fontFamily: mono, fontSize: 10, letterSpacing: 1.5 }}>FAMILY SERVER · TYPED ADMINISTRATION</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          <Badge color={statusColor}>{statusLabel}</Badge>
          <Badge color={C.gold}>APPLICATION UNCONFIRMED</Badge>
        </div>
      </div>
      <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.6, marginTop: 8 }}>
        This boundary exposes only bounded administration actions—never a raw console or arbitrary command field. A delivered result proves only that the command was written to the exact agent-owned input stream; Minecraft consumption and application remain unconfirmed.
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', marginTop: 10 }}>
        <div style={{ background: 'rgba(0,0,0,0.28)', border: `1px solid ${C.gold}30`, borderRadius: 5, padding: '9px 10px' }}>
          <div style={label}>Online player visibility</div>
          <Badge color={C.gold}>UNAVAILABLE · NOT AUTHORITATIVE</Badge>
          <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.5, marginTop: 6 }}>
            No player is shown as online from uncorrelated stdout or logs.
          </div>
        </div>
        <div style={{ background: 'rgba(0,0,0,0.28)', border: `1px solid ${C.gold}30`, borderRadius: 5, padding: '9px 10px' }}>
          <div style={label}>Whitelist visibility</div>
          <Badge color={C.gold}>STATE + LIST UNAVAILABLE</Badge>
          <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.5, marginTop: 6 }}>
            Enablement and membership are not inferred from command text or server logs.
          </div>
        </div>
      </div>

      {statusError ? <div role="alert" style={{ color: C.red, fontSize: 10, lineHeight: 1.5, marginTop: 9 }}>{statusError}</div> : null}
      {!loading && !administration && !statusError ? (
        <div style={{ color: C.dim, fontSize: 10, lineHeight: 1.5, marginTop: 9 }}>Administration availability is not loaded. Select Refresh Availability when you need these controls.</div>
      ) : null}
      {administration?.checkedAt ? (
        <div style={{ color: C.dim, fontFamily: mono, fontSize: 8, marginTop: 7 }}>AVAILABILITY CHECKED {new Date(administration.checkedAt).toLocaleString()}</div>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
        <Button disabled={!canOperate} onClick={() => void submitAction(window.crypto.randomUUID(), { kind: 'players.refresh' })}>REQUEST PLAYER OUTPUT</Button>
        <Button disabled={!canOperate} onClick={() => void submitAction(window.crypto.randomUUID(), { kind: 'whitelist.refresh' })}>REQUEST WHITELIST OUTPUT</Button>
        <Button disabled={loading || busyRequestId !== null} onClick={() => void loadAdministration(true)}>{loading ? 'CHECKING…' : 'REFRESH AVAILABILITY'}</Button>
      </div>

      <div style={{ borderTop: `1px solid ${C.cyan}20`, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', marginTop: 12, paddingTop: 12 }}>
        <div>
          <label htmlFor="minecraft-admin-broadcast" style={label}>Bounded broadcast · printable ASCII · {broadcast.length}/256</label>
          <textarea
            id="minecraft-admin-broadcast"
            disabled={!canOperate}
            maxLength={256}
            rows={3}
            value={broadcast}
            onChange={(event) => setBroadcast(event.target.value)}
            placeholder="Message to players (no raw commands)"
            style={{ ...input, resize: 'vertical' }}
          />
          <div style={{ marginTop: 7 }}>
            <Button
              disabled={!canOperate || !PRINTABLE_ASCII_BROADCAST.test(broadcast) || broadcast.trim() !== broadcast}
              onClick={() => void submitAction(window.crypto.randomUUID(), { kind: 'broadcast', message: broadcast })}
            >BROADCAST</Button>
          </div>
        </div>

        <div>
          <label htmlFor="minecraft-admin-player" style={label}>Manual unverified Java profile · 3–16 ASCII characters</label>
          <input
            id="minecraft-admin-player"
            autoComplete="off"
            disabled={!canOperate}
            maxLength={16}
            value={player}
            onChange={(event) => setPlayer(event.target.value)}
            placeholder="JavaProfile"
            style={input}
          />
          <div style={{ color: C.gold, fontSize: 9, lineHeight: 1.45, marginTop: 5 }}>
            Manual, unverified Java profile identity only. Arbitrary Bedrock gamertags are not supported by this v1 boundary.
          </div>
          <label htmlFor="minecraft-admin-reason" style={{ ...label, marginTop: 8 }}>Kick / ban reason</label>
          <select id="minecraft-admin-reason" disabled={!canOperate} value={reasonCode} onChange={(event) => setReasonCode(event.target.value as AdminReasonCode)} style={input}>
            <option value="operator-request">Operator request</option>
            <option value="rule-violation">Rule violation</option>
            <option value="unsafe-behavior">Unsafe behavior</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', marginTop: 10 }}>
        <div style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.cyan}20`, borderRadius: 5, padding: 9 }}>
          <div style={label}>Whitelist actions</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            <Button color={C.green} disabled={!canOperate} onClick={() => void requestProtectedPlan({ kind: 'whitelist.set', enabled: true })}>ENABLE</Button>
            <Button color={C.red} disabled={!canOperate} onClick={() => void requestProtectedPlan({ kind: 'whitelist.set', enabled: false })}>DISABLE</Button>
            <Button disabled={!canOperate} onClick={() => requestPlayerPlan('whitelist.add')}>ADD</Button>
            <Button color={C.red} disabled={!canOperate} onClick={() => requestPlayerPlan('whitelist.remove')}>REMOVE</Button>
          </div>
        </div>
        <div style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.red}20`, borderRadius: 5, padding: 9 }}>
          <div style={label}>Player moderation</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            <Button color={C.gold} disabled={!canOperate} onClick={() => requestPlayerPlan('player.kick')}>KICK</Button>
            <Button color={C.red} disabled={!canOperate} onClick={() => requestPlayerPlan('player.ban')}>BAN</Button>
            <Button disabled={!canOperate} onClick={() => requestPlayerPlan('player.pardon')}>PARDON</Button>
          </div>
        </div>
        <div style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.magenta}20`, borderRadius: 5, padding: 9 }}>
          <div style={label}>Privilege changes</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            <Button color={C.magenta} disabled={!canOperate} onClick={() => requestPlayerPlan('player.op')}>OP</Button>
            <Button color={C.red} disabled={!canOperate} onClick={() => requestPlayerPlan('player.deop')}>DEOP</Button>
          </div>
        </div>
      </div>

      {pendingPlan ? (
        <div style={{ background: `${C.gold}0a`, border: `1px solid ${C.gold}45`, borderRadius: 5, marginTop: 10, padding: '10px 11px' }}>
          <div style={{ color: C.gold, fontFamily: mono, fontSize: 9 }}>LAUNCH-BOUND APPROVAL PLAN · REVIEW REQUIRED</div>
          <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.6, marginTop: 6 }}>
            Action: <span style={{ color: '#e8ffff' }}>{adminActionLabel(pendingPlan.action.kind)}</span>
            {'player' in pendingPlan.action ? <> · Manual unverified Java target: <span style={{ color: '#e8ffff' }}>{pendingPlan.action.player}</span></> : null}
            {'enabled' in pendingPlan.action ? <> · Requested whitelist state: <span style={{ color: '#e8ffff' }}>{pendingPlan.action.enabled ? 'enabled' : 'disabled'}</span></> : null}
            {'reasonCode' in pendingPlan.action && pendingPlan.action.reasonCode ? <> · Fixed reason: <span style={{ color: '#e8ffff' }}>{pendingPlan.action.reasonCode}</span></> : null}
          </div>
          <div style={{ color: C.dim, fontFamily: mono, fontSize: 8, lineHeight: 1.55, marginTop: 5, overflowWrap: 'anywhere' }}>
            REQUEST {pendingPlan.plan.requestId}<br />
            LAUNCH BINDING {pendingPlan.plan.launchGeneration}<br />
            ACTION DIGEST {pendingPlan.plan.actionDigest}<br />
            EXPIRES {new Date(pendingPlan.plan.expiresAt).toLocaleString()}
          </div>
          <label htmlFor="minecraft-admin-confirmation" style={{ ...label, marginTop: 9 }}>Type exactly: {pendingPlan.plan.confirmation}</label>
          <input id="minecraft-admin-confirmation" autoComplete="off" value={confirmationInput} onChange={(event) => setConfirmationInput(event.target.value)} style={input} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            <Button color={C.red} disabled={confirmationInput !== pendingPlan.plan.confirmation || Date.parse(pendingPlan.plan.expiresAt) <= Date.now()} onClick={submitApprovedPlan}>SUBMIT PLANNED ACTION</Button>
            <Button onClick={() => { setPendingPlan(null); setConfirmationInput(''); setMessage('Administration plan cancelled; no action was submitted.'); }}>CANCEL PLAN</Button>
          </div>
        </div>
      ) : null}

      {message ? (
        <div role={messageError ? 'alert' : 'status'} aria-live="polite" style={{ color: messageError ? C.red : C.green, fontSize: 10, lineHeight: 1.55, marginTop: 10 }}>
          {message}
        </div>
      ) : null}
      {pendingOperation ? (
        <div style={{ background: `${pendingOperation.observedState === 'delivered-unconfirmed' ? C.gold : C.red}0a`, border: `1px solid ${pendingOperation.observedState === 'delivered-unconfirmed' ? C.gold : C.red}40`, borderRadius: 5, marginTop: 9, padding: '9px 10px' }}>
          <div style={{ color: pendingOperation.observedState === 'delivered-unconfirmed' ? C.gold : C.red, fontFamily: mono, fontSize: 9 }}>
            {pendingOperation.observedState ? pendingOperation.observedState.replace(/-/g, ' ').toUpperCase() : 'RECONCILING EXACT REQUEST'} · MUTATIONS LOCKED
          </div>
          <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.5, marginTop: 5 }}>
            {adminActionLabel(pendingOperation.kind)} request {pendingOperation.requestId}, started {new Date(pendingOperation.startedAt).toLocaleString()}. Mastermind polls this exact durable request ID and never resubmits it.
          </div>
          {pendingOperation.observedState === 'delivered-unconfirmed' || pendingOperation.observedState === 'rejected-before-delivery' ? (
            <div style={{ marginTop: 7 }}><Button color={C.gold} onClick={acknowledgeReconciledOperation}>ACKNOWLEDGE RECONCILED RESULT</Button></div>
          ) : pendingOperation.observedState === 'delivery-unknown' ? (
            <div style={{ color: C.red, fontSize: 10, lineHeight: 1.5, marginTop: 7 }}>Delivery remains unknown. This lock cannot be cleared by a simple acknowledgement.</div>
          ) : null}
        </div>
      ) : lastOperation ? (
        <div style={{ color: C.dim, fontFamily: mono, fontSize: 8, marginTop: 7 }}>
          LAST OPERATION · {lastOperation.requestId} · {adminActionLabel(lastOperation.kind).toUpperCase()} · {lastOperation.state.toUpperCase()} · APPLICATION {lastOperation.application.toUpperCase()}
        </div>
      ) : null}
    </section>
  );
}

function ModrinthModsPanel({ instance }: { instance: ManagedInstance }) {
  const [inventory, setInventory] = useState<ModInventory | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<ModCatalogSearch | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [detail, setDetail] = useState<ModProjectDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<ModPlan | null>(null);
  const [pendingPlanRequest, setPendingPlanRequest] = useState<PendingModPlanRequest | null>(null);
  const [confirmationInput, setConfirmationInput] = useState('');
  const [pendingOperation, setPendingOperation] = useState<PendingModOperation | null>(null);
  const [pendingStorageLoaded, setPendingStorageLoaded] = useState(false);
  const [journalError, setJournalError] = useState('');
  const [lastOperation, setLastOperation] = useState<ModOperation | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);

  const ownedFamilyServer = instance.id === 'family-server' && instance.projectId === 'family-server' && instance.kind === 'server';
  const stopped = ownedFamilyServer && instance.status === 'stopped';

  const loadInventory = useCallback(async (showLoading = false) => {
    if (showLoading) setInventoryLoading(true);
    try {
      const next = modInventoryFromUnknown(await api<unknown>('/api/minecraft/instances/family-server/mods/installed'));
      setInventory(next);
      setInventoryError('');
    } catch (error) {
      setInventory(null);
      const failure = failureOf(error);
      setInventoryError(failure.status === 404
        ? 'Restart the local command center to load the Family Server Modrinth manager.'
        : failure.message);
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  const refreshClientJournal = useCallback(() => {
    const journal = readModClientJournal();
    setJournalError(journal.error ?? '');
    setPendingPlanRequest(journal.plan);
    setPendingOperation(journal.operation);
    setPendingPlan((current) => current && journal.plan?.request.requestId === current.requestId ? current : null);
    setPendingStorageLoaded(true);
  }, []);

  useEffect(() => refreshClientJournal(), [refreshClientJournal]);

  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (
        event.storageArea !== window.localStorage || !event.key
        || (!event.key.startsWith(MOD_PLAN_STORAGE_PREFIX) && !event.key.startsWith(MOD_OPERATION_STORAGE_PREFIX))
      ) return;
      refreshClientJournal();
    };
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, [refreshClientJournal]);

  const pendingRequestId = pendingOperation?.requestId;
  const pendingPlanId = pendingOperation?.planId;
  const pendingPlanDigest = pendingOperation?.planDigest;
  const pendingRequestedOperation = pendingOperation?.operation;
  useEffect(() => {
    if (!pendingRequestId || !pendingPlanId || !pendingPlanDigest || !pendingRequestedOperation) return;
    let disposed = false;
    let timer: number | undefined;
    const reconcile = async () => {
      try {
        const operation = await withModMutationLock(async () => {
          const journal = readModClientJournal();
          if (journal.error) throw new Error(journal.error);
          if (!journal.operation || journal.operation.requestId !== pendingRequestId) return null;
          if (journal.plan?.request.requestId === pendingRequestId) {
            window.localStorage.removeItem(modPlanStorageKey(pendingRequestId));
          }
          const value = await api<unknown>(`/api/minecraft/instances/family-server/mods/operations/${encodeURIComponent(pendingRequestId)}`);
          const next = modOperationFromUnknown(value, { requestId: pendingRequestId, planId: pendingPlanId, planDigest: pendingPlanDigest, operation: pendingRequestedOperation });
          const updated = { ...journal.operation, observedState: next.state };
          window.localStorage.setItem(modOperationStorageKey(pendingRequestId), JSON.stringify(updated));
          return next;
        });
        if (disposed || !operation) return;
        setLastOperation(operation);
        setPendingOperation((current) => current?.requestId === operation.requestId ? { ...current, observedState: operation.state } : current);
        setMessageError(!['committed', 'rolled-back'].includes(operation.state));
        setMessage(
          operation.state === 'committed'
            ? `Mod transaction ${operation.transactionRef} committed with verified post-transaction stack evidence.`
            : operation.state === 'rolled-back'
              ? `Mod transaction ${operation.transactionRef} rolled back to its verified snapshot.`
              : operation.state === 'rejected-before-mutation'
                ? `Mod transaction ${operation.transactionRef} was durably rejected before mutation; no stack change was applied.`
              : operation.state === 'manual-recovery-required'
                ? `Mod transaction ${operation.transactionRef} requires manual recovery. Server start and further mod mutations remain fenced.`
                : `Mod transaction ${operation.transactionRef} has a durable completion-unknown result. Do not retry it automatically.`,
        );
        if (['committed', 'rolled-back'].includes(operation.state)) await loadInventory(false);
      } catch (error) {
        if (disposed) return;
        const failure = failureOf(error);
        if (failure.status !== 404) {
          setMessageError(true);
          setMessage(`Mod transaction reconciliation is still pending: ${failure.message}`);
        }
      }
      if (!disposed) timer = window.setTimeout(() => void reconcile(), 5_000);
    };
    void reconcile();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadInventory, pendingPlanDigest, pendingPlanId, pendingRequestId, pendingRequestedOperation]);

  const searchCatalog = async () => {
    const nextQuery = query.trim();
    if (nextQuery.length < 1 || nextQuery.length > 80 || !PUBLIC_MOD_TEXT.test(nextQuery)) {
      setSearchError('Search must contain 1 to 80 visible characters without control or direction-changing text.');
      return;
    }
    setSearchBusy(true);
    setSearchError('');
    setDetail(null);
    try {
      const params = new URLSearchParams({ q: nextQuery, offset: '0', limit: '20' });
      setSearch(modCatalogSearchFromUnknown(await api<unknown>(`/api/minecraft/instances/family-server/mods/catalog/search?${params.toString()}`), nextQuery));
    } catch (error) {
      setSearch(null);
      setSearchError(failureOf(error).message);
    } finally {
      setSearchBusy(false);
    }
  };

  const loadProject = async (catalogRef: string) => {
    if (!PUBLIC_MOD_CATALOG_REF.test(catalogRef)) return;
    setDetailBusy(true);
    setSearchError('');
    try {
      setDetail(modProjectFromUnknown(await api<unknown>(`/api/minecraft/instances/family-server/mods/catalog/${encodeURIComponent(catalogRef)}`), catalogRef));
    } catch (error) {
      setDetail(null);
      setSearchError(failureOf(error).message);
    } finally {
      setDetailBusy(false);
    }
  };

  const requestPlan = async (request: ModPlanRequest) => {
    if (
      !stopped || actionBusy || pendingOperation || pendingPlan || !inventory || journalError
      || inventory.recovery.required || inventory.unmanaged.present
    ) return;
    setActionBusy(true);
    setMessageError(false);
    setMessage(`Resolving the complete ${request.operation} dependency graph against the stopped Family Server...`);
    let planPersisted = false;
    try {
      const plan = await withModMutationLock(async () => {
        const journal = readModClientJournal();
        if (journal.error) throw new Error(journal.error);
        if (journal.operation) throw new Error(`Mod transaction ${journal.operation.requestId} is already pending reconciliation.`);
        if (journal.plan && !sameModPlanRequest(journal.plan.request, request)) {
          throw new Error(`Mod plan ${journal.plan.request.requestId} already owns the cross-tab mutation lock.`);
        }
        const pendingRequest: PendingModPlanRequest = journal.plan ?? { request, startedAt: new Date().toISOString(), state: 'resolving' };
        const resolving = { ...pendingRequest, state: 'resolving' as const };
        window.localStorage.setItem(modPlanStorageKey(request.requestId), JSON.stringify(resolving));
        planPersisted = true;
        setPendingPlanRequest(resolving);
        const next = modPlanFromUnknown(await api<unknown>('/api/minecraft/instances/family-server/mods/plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        }), request.requestId);
        if (next.operation !== request.operation) throw new Error('The local agent returned a plan for a different operation.');
        const resolved = { ...resolving, state: 'resolved' as const };
        window.localStorage.setItem(modPlanStorageKey(request.requestId), JSON.stringify(resolved));
        setPendingPlanRequest(resolved);
        return next;
      });
      if (
        Date.parse(plan.expiresAt) <= Date.now()
        || plan.stackBinding.minecraftVersion !== inventory.stack.minecraftVersion
        || plan.stackBinding.loader !== inventory.stack.loader
        || plan.stackBinding.loaderVersion !== inventory.stack.loaderVersion
        || plan.stackBinding.generation !== inventory.stack.generation
        || plan.stackBinding.inventoryDigest !== inventory.stack.inventoryDigest
      ) throw new Error('The local agent returned an expired or stale mod transaction plan. Refresh inventory and prepare a new plan.');
      setPendingPlan(plan);
      setConfirmationInput('');
      setMessage('Review the immutable stack binding and every requested, dependency, dependent, or rollback effect before approval.');
    } catch (error) {
      const failure = failureOf(error);
      if (!planPersisted || MOD_AUTHORITATIVE_PLAN_REJECT_CODES.has(failure.code)) {
        await withModMutationLock(async () => {
          const journal = readModClientJournal();
          if (journal.plan && sameModPlanRequest(journal.plan.request, request) && !journal.operation) {
            window.localStorage.removeItem(modPlanStorageKey(request.requestId));
          }
        }).catch(() => undefined);
      } else {
        await withModMutationLock(async () => {
          const journal = readModClientJournal();
          if (journal.plan && sameModPlanRequest(journal.plan.request, request) && !journal.operation) {
            const unknown = { ...journal.plan, state: 'completion-unknown' as const };
            window.localStorage.setItem(modPlanStorageKey(request.requestId), JSON.stringify(unknown));
          }
        }).catch(() => undefined);
      }
      refreshClientJournal();
      setMessageError(true);
      setMessage(!planPersisted
        ? `${failure.message} The request was not submitted because the cross-tab safety boundary rejected it first.`
        : MOD_AUTHORITATIVE_PLAN_REJECT_CODES.has(failure.code)
        ? `${failure.message} No transaction was submitted and the rejected plan request was removed.`
        : `${failure.message} No transaction was submitted. The exact plan request remains locked and may only be resumed with the same request ID and body.`);
    } finally {
      setActionBusy(false);
    }
  };

  const submitPlan = async () => {
    if (
      !pendingPlan || !stopped || actionBusy || pendingOperation
      || pendingPlan.dependentClosure.state !== 'clear'
      || confirmationInput !== pendingPlan.requiredConfirmation
      || Date.parse(pendingPlan.expiresAt) <= Date.now()
      || !inventory || inventory.recovery.required || inventory.unmanaged.present
      || pendingPlan.stackBinding.minecraftVersion !== inventory.stack.minecraftVersion
      || pendingPlan.stackBinding.loader !== inventory.stack.loader
      || pendingPlan.stackBinding.loaderVersion !== inventory.stack.loaderVersion
      || pendingPlan.stackBinding.generation !== inventory.stack.generation
      || pendingPlan.stackBinding.inventoryDigest !== inventory.stack.inventoryDigest
    ) return;
    setActionBusy(true);
    setMessageError(false);
    setMessage(`Submitting approved ${pendingPlan.operation} transaction. A verified backup is mandatory before commit...`);
    const submittedPlan = pendingPlan;
    setPendingPlan(null);
    setConfirmationInput('');
    let actionPersisted = false;
    try {
      const operation = await withModMutationLock(async () => {
        const journal = readModClientJournal();
        if (journal.error) throw new Error(journal.error);
        if (journal.operation) throw new Error(`Mod transaction ${journal.operation.requestId} already owns the cross-tab mutation lock.`);
        if (!journal.plan || journal.plan.request.requestId !== submittedPlan.requestId || journal.plan.state !== 'resolved') {
          throw new Error('The durable mod plan journal no longer matches this approval.');
        }
        const pending: PendingModOperation = {
          requestId: submittedPlan.requestId,
          planId: submittedPlan.planId,
          planDigest: submittedPlan.planDigest,
          operation: submittedPlan.operation,
          startedAt: new Date().toISOString(),
        };
        window.localStorage.setItem(modOperationStorageKey(pending.requestId), JSON.stringify(pending));
        actionPersisted = true;
        window.localStorage.removeItem(modPlanStorageKey(pending.requestId));
        setPendingPlanRequest(null);
        setPendingOperation(pending);
        const next = modOperationFromUnknown(await api<unknown>('/api/minecraft/instances/family-server/mods/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: submittedPlan.requestId,
            planId: submittedPlan.planId,
            confirmation: submittedPlan.requiredConfirmation,
          }),
        }), { requestId: submittedPlan.requestId, planId: submittedPlan.planId, planDigest: submittedPlan.planDigest, operation: submittedPlan.operation });
        const observed = { ...pending, observedState: next.state };
        window.localStorage.setItem(modOperationStorageKey(pending.requestId), JSON.stringify(observed));
        return next;
      });
      setLastOperation(operation);
      setPendingOperation((current) => current?.requestId === operation.requestId ? { ...current, observedState: operation.state } : current);
      setMessageError(!['committed', 'rolled-back'].includes(operation.state));
      setMessage(operation.state === 'committed'
        ? `Mod transaction ${operation.transactionRef} committed with verified post-transaction stack evidence.`
        : operation.state === 'rolled-back'
          ? `Mod transaction ${operation.transactionRef} rolled back with verified restored-stack evidence.`
          : operation.state === 'rejected-before-mutation'
            ? `Mod transaction ${operation.transactionRef} was durably rejected before mutation; no stack change was applied.`
          : operation.state === 'manual-recovery-required'
            ? `Mod transaction ${operation.transactionRef} requires manual recovery; controls remain locked.`
            : `Mod transaction ${operation.transactionRef} has a completion-unknown result; controls remain locked and no retry will be sent.`);
      if (['committed', 'rolled-back'].includes(operation.state)) await loadInventory(false);
    } catch (error) {
      const failure = failureOf(error);
      if (actionPersisted && !MOD_AUTHORITATIVE_NO_COMMIT_CODES.has(failure.code)) {
        setMessageError(true);
        setMessage(`${failure.message} Request ${submittedPlan.requestId} remains locked for exact transaction reconciliation; no automatic retry will be sent.`);
      } else {
        await withModMutationLock(async () => {
          const journal = readModClientJournal();
          if (journal.operation?.requestId === submittedPlan.requestId) {
            window.localStorage.removeItem(modOperationStorageKey(submittedPlan.requestId));
          }
        }).catch(() => undefined);
        refreshClientJournal();
        setMessageError(true);
        setMessage(actionPersisted
          ? `${failure.message} The agent rejected this request before a possible commit; controls are unlocked and no retry was sent.`
          : `${failure.message} The cross-tab safety boundary rejected this request before it was submitted.`);
      }
    } finally {
      setActionBusy(false);
    }
  };

  const acknowledgeOperation = async () => {
    if (!pendingOperation?.observedState || !['committed', 'rolled-back', 'rejected-before-mutation'].includes(pendingOperation.observedState)) return;
    const acknowledged = pendingOperation;
    try {
      await withModMutationLock(async () => {
        const journal = readModClientJournal();
        if (
          journal.operation?.requestId !== acknowledged.requestId
          || !journal.operation.observedState || !['committed', 'rolled-back', 'rejected-before-mutation'].includes(journal.operation.observedState)
        ) throw new Error('The durable operation journal changed before acknowledgement.');
        window.localStorage.removeItem(modOperationStorageKey(acknowledged.requestId));
        window.localStorage.removeItem(modPlanStorageKey(acknowledged.requestId));
      });
      refreshClientJournal();
      setMessageError(false);
      setMessage(`Durable ${acknowledged.observedState} result acknowledged. No transaction was retried.`);
    } catch (error) {
      setMessageError(true);
      setMessage(failureOf(error).message);
    }
  };

  const cancelPlan = async () => {
    if (!pendingPlanRequest || pendingOperation || actionBusy) return;
    const requestId = pendingPlanRequest.request.requestId;
    try {
      await withModMutationLock(async () => {
        const journal = readModClientJournal();
        if (journal.error) throw new Error(journal.error);
        if (journal.operation) throw new Error('A mod transaction has already replaced this plan and must be reconciled.');
        if (!journal.plan || journal.plan.request.requestId !== requestId) throw new Error('The durable plan journal changed before cancellation.');
        window.localStorage.removeItem(modPlanStorageKey(requestId));
      });
      setPendingPlan(null);
      setConfirmationInput('');
      refreshClientJournal();
      setMessageError(false);
      setMessage('Mod plan cancelled. No transaction was submitted.');
    } catch (error) {
      setMessageError(true);
      setMessage(failureOf(error).message);
    }
  };

  const controlsReady = MOD_MUTATIONS_RELEASE_ENABLED && stopped && pendingStorageLoaded && !journalError && !pendingOperation && !pendingPlanRequest && !pendingPlan && !actionBusy
    && inventory !== null && !inventory.recovery.required && !inventory.unmanaged.present;
  const searchStackMatchesInventory = Boolean(search && inventory
    && search.stack.minecraftVersion === inventory.stack.minecraftVersion
    && search.stack.loader === inventory.stack.loader
    && search.stack.loaderVersion === inventory.stack.loaderVersion
    && search.stack.generation === inventory.stack.generation
    && search.stack.inventoryDigest === inventory.stack.inventoryDigest);
  const detailMatchesInventory = Boolean(detail && inventory && searchStackMatchesInventory
    && detail.compatibility.state === 'compatible'
    && detail.compatibility.minecraftVersion === inventory.stack.minecraftVersion
    && detail.compatibility.loader === inventory.stack.loader
    && search?.candidates.some((candidate) => candidate.catalogRef === detail.catalogRef));
  const pendingPlanStackCurrent = Boolean(pendingPlan && inventory
    && !inventory.recovery.required && !inventory.unmanaged.present
    && pendingPlan.stackBinding.minecraftVersion === inventory.stack.minecraftVersion
    && pendingPlan.stackBinding.loader === inventory.stack.loader
    && pendingPlan.stackBinding.loaderVersion === inventory.stack.loaderVersion
    && pendingPlan.stackBinding.generation === inventory.stack.generation
    && pendingPlan.stackBinding.inventoryDigest === inventory.stack.inventoryDigest);
  const statusColor = !stopped ? C.gold : inventoryError ? C.red : C.green;

  return (
    <section style={{ ...panel, borderColor: `${statusColor}45` }}>
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
        <div style={{ color: C.cyan, fontFamily: mono, fontSize: 10, letterSpacing: 1.5 }}>FAMILY SERVER · MODRINTH MODS</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Badge color={C.gold}>{stopped ? 'STOPPED - MOD CHANGES READ ONLY' : 'RUNNING - READ ONLY'}</Badge>
          <Badge color={C.magenta}>FABRIC SERVER ONLY</Badge>
        </div>
      </div>
      <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.6, marginTop: 8 }}>
        Search results are provisional Modrinth discovery evidence, not compatibility proof. Mastermind accepts only opaque catalog references and resolves release files, hashes, required dependencies, and dedicated-server compatibility locally. URLs, paths, filenames, hashes, executables, dependency overrides, force removal, beta/alpha selection, and managed-core overrides are never accepted from this browser.
      </div>
      <div role="status" style={{ color: C.gold, fontSize: 10, fontWeight: 700, lineHeight: 1.5, marginTop: 8 }}>
        WINDOWS SAFETY FENCE - catalog search, compatibility evidence, and inventory remain available. Install, update, remove, and rollback are unavailable in this release.
      </div>
      {!stopped ? <div style={{ color: C.gold, fontSize: 10, lineHeight: 1.5, marginTop: 8 }}>Stop the exact Family Server safely before installing, updating, removing, or rolling back mods.</div> : null}
      {journalError ? <div role="alert" style={{ color: C.red, fontSize: 10, fontWeight: 700, lineHeight: 1.5, marginTop: 8 }}>LOCAL TRANSACTION JOURNAL INVALID · {journalError}</div> : null}
      {pendingPlanRequest && !pendingPlan && !pendingOperation ? (
        <div style={{ background: `${C.gold}0a`, border: `1px solid ${C.gold}45`, borderRadius: 5, marginTop: 9, padding: '9px 10px' }}>
          <div style={{ color: C.gold, fontFamily: mono, fontSize: 9 }}>DURABLE PLAN REQUEST · {pendingPlanRequest.state.replace(/-/g, ' ').toUpperCase()}</div>
          <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.5, marginTop: 5 }}>
            {pendingPlanRequest.request.operation.toUpperCase()} request {pendingPlanRequest.request.requestId}. No mod transaction has been submitted. Resume replays only this exact request ID and body; it never generates a replacement.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
            <Button color={C.gold} disabled={!MOD_MUTATIONS_RELEASE_ENABLED || actionBusy || !stopped || !inventory || inventory.recovery.required || inventory.unmanaged.present} onClick={() => void requestPlan(pendingPlanRequest.request)}>RESUME EXACT PLAN REQUEST</Button>
            <Button disabled={actionBusy} onClick={() => void cancelPlan()}>CANCEL WITHOUT TRANSACTION</Button>
          </div>
        </div>
      ) : null}

      <form onSubmit={(event) => { event.preventDefault(); void searchCatalog(); }} style={{ display: 'grid', gap: 7, gridTemplateColumns: 'minmax(0,1fr) auto', marginTop: 11 }}>
        <div>
          <label htmlFor="minecraft-modrinth-search" style={label}>Search Modrinth catalog · discovery only</label>
          <input id="minecraft-modrinth-search" maxLength={80} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Server-side Fabric mod" style={input} />
        </div>
        <div style={{ alignSelf: 'end' }}><Button type="submit" disabled={searchBusy}>{searchBusy ? 'SEARCHING…' : 'SEARCH'}</Button></div>
      </form>
      {searchError ? <div role="alert" style={{ color: C.red, fontSize: 10, marginTop: 7 }}>{searchError}</div> : null}

      {search ? (
        <div style={{ display: 'grid', gap: 7, marginTop: 10 }}>
          <div style={{ color: C.dim, fontFamily: mono, fontSize: 8 }}>
            {search.totalHits.toLocaleString()} CATALOG HITS · SHOWING {search.candidates.length} · STACK MC {search.stack.minecraftVersion} / FABRIC {search.stack.loaderVersion}
          </div>
          {search.candidates.map((item) => (
            <div key={item.catalogRef} style={{ alignItems: 'center', background: 'rgba(0,0,0,0.25)', border: `1px solid ${C.cyan}25`, borderRadius: 5, display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0,1fr) auto', padding: '8px 10px' }}>
              <div>
                <div style={{ color: '#e8ffff', fontWeight: 700 }}>{item.title}</div>
                <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.45 }}>{item.summary || 'No public summary.'}</div>
                <div style={{ color: C.dim, fontFamily: mono, fontSize: 8, marginTop: 4 }}>
                  BY {item.author} · {item.compatibility.toUpperCase()} DISCOVERY RESULT
                </div>
              </div>
              <Button disabled={detailBusy} onClick={() => void loadProject(item.catalogRef)}>COMPATIBILITY EVIDENCE</Button>
            </div>
          ))}
        </div>
      ) : null}

      {detail ? (
        <div style={{ background: `${C.magenta}08`, border: `1px solid ${C.magenta}35`, borderRadius: 6, marginTop: 10, padding: '10px 11px' }}>
          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            <span style={{ color: '#e8ffff', fontWeight: 700 }}>{detail.title}</span>
            <Badge color={C.green}>{detail.compatibility.environment.replace(/_/g, ' ').toUpperCase()}</Badge>
            <Badge>MC {detail.compatibility.minecraftVersion}</Badge><Badge>FABRIC</Badge><Badge>{detail.selectedVersion.versionNumber}</Badge>
          </div>
          <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.55, marginTop: 6 }}>
            Publisher version-metadata evidence · release · license {detail.licenseId} · selected {new Date(detail.selectedVersion.publishedAt).toLocaleDateString()} · graph {detail.graph.nodeCount} nodes / {detail.graph.requiredDependencyCount} required dependencies / {(detail.graph.totalBytes / (1024 * 1024)).toFixed(1)} MiB. Final compatibility is re-resolved and bound in the transaction plan.
          </div>
          {detail.graph.warnings.length ? <div style={{ color: C.gold, fontSize: 10, lineHeight: 1.5, marginTop: 6 }}>{detail.graph.warnings.map((warning) => warning.replace(/-/g, ' ').toUpperCase()).join(' · ')}</div> : null}
          <div style={{ color: C.gold, fontSize: 10, fontWeight: 700, lineHeight: 1.5, marginTop: 6 }}>
            Server-only metadata does not guarantee PS4/Bedrock compatibility; mods that change registries, packets, or required client content may still prevent joining.
          </div>
          <div style={{ color: C.red, fontSize: 10, fontWeight: 700, lineHeight: 1.5, marginTop: 6 }}>
            A verified hash proves downloaded bytes match catalog metadata; it does not prove code safety. Third-party mod code runs with the server user&apos;s permissions.
          </div>
          {!detailMatchesInventory ? <div role="alert" style={{ color: C.red, fontSize: 10, marginTop: 7 }}>Compatibility evidence is not bound to the latest loaded inventory stack. Refresh inventory and search again.</div> : null}
          <div style={{ marginTop: 8 }}><Button color={C.magenta} disabled={!controlsReady || !detailMatchesInventory} onClick={() => void requestPlan({ requestId: window.crypto.randomUUID(), operation: 'install', catalogRef: detail.catalogRef })}>PREPARE INSTALL PLAN</Button></div>
        </div>
      ) : null}

      <div style={{ borderTop: `1px solid ${C.cyan}20`, marginTop: 12, paddingTop: 11 }}>
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 7, justifyContent: 'space-between' }}>
          <div style={{ color: C.cyan, fontFamily: mono, fontSize: 9 }}>INSTALLED FAMILY SERVER INVENTORY</div>
          <Button disabled={inventoryLoading || actionBusy} onClick={() => void loadInventory(true)}>{inventoryLoading ? 'CHECKING…' : 'REFRESH INVENTORY'}</Button>
        </div>
        {inventoryError ? <div role="alert" style={{ color: C.red, fontSize: 10, marginTop: 7 }}>{inventoryError}</div> : null}
        {inventory ? (
          <>
            <div style={{ color: C.dim, fontFamily: mono, fontSize: 8, lineHeight: 1.5, marginTop: 7, overflowWrap: 'anywhere' }}>
              MINECRAFT {inventory.stack.minecraftVersion} · FABRIC {inventory.stack.loaderVersion}<br />
              GENERATION {inventory.stack.generation}<br />INVENTORY DIGEST {inventory.stack.inventoryDigest}
            </div>
            <div style={{ display: 'grid', gap: 7, marginTop: 9 }}>
              {!inventory.installed.length ? <div style={{ color: C.dim, fontSize: 10 }}>No Mastermind-managed optional mods are installed.</div> : inventory.installed.map((mod) => (
                  <div key={mod.installedRef} style={{ alignItems: 'center', background: 'rgba(0,0,0,0.25)', border: `1px solid ${C.green}30`, borderRadius: 5, display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0,1fr) auto', padding: '8px 10px' }}>
                    <div>
                      <div style={{ color: '#e8ffff', fontWeight: 700 }}>{mod.title} <span style={{ color: C.dim }}>· {mod.versionNumber}</span></div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                        <Badge color={C.green}>MANAGED</Badge>
                        <Badge>{mod.role.toUpperCase()}</Badge>
                        <Badge>{mod.environment.replace(/_/g, ' ').toUpperCase()}</Badge>
                        {mod.requiredByCount > 0 ? <Badge color={C.gold}>REQUIRED BY {mod.requiredByCount}</Badge> : null}
                      </div>
                      <div style={{ color: C.dim, fontFamily: mono, fontSize: 8, marginTop: 4 }}>INSTALLED {new Date(mod.installedAt).toLocaleString()}</div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {mod.role === 'explicit' ? (
                        <>
                          <Button disabled={!controlsReady} onClick={() => void requestPlan({ requestId: window.crypto.randomUUID(), operation: 'update', installedRef: mod.installedRef })}>PREPARE UPDATE</Button>
                          <Button color={C.red} disabled={!controlsReady} onClick={() => void requestPlan({ requestId: window.crypto.randomUUID(), operation: 'remove', installedRef: mod.installedRef })}>PREPARE REMOVE</Button>
                        </>
                      ) : <Badge color={C.gold}>DEPENDENCY · MUTATE THROUGH EXPLICIT MOD</Badge>}
                    </div>
                  </div>
                ))}
            </div>
            {inventory.recovery.required ? (
              <div role="alert" style={{ color: C.red, fontSize: 10, fontWeight: 700, lineHeight: 1.5, marginTop: 8 }}>
                RECOVERY FENCE ACTIVE · {inventory.recovery.state.replace(/-/g, ' ').toUpperCase()} · TRANSACTION {inventory.recovery.transactionRef}. Server start and all mod mutations remain blocked by durable local-agent state.
              </div>
            ) : null}
            {inventory.unmanaged.present ? (
              <div role="alert" style={{ color: C.red, fontSize: 10, fontWeight: 700, lineHeight: 1.5, marginTop: 8 }}>
                UNMANAGED MODS BLOCK MUTATIONS · {inventory.unmanaged.count} unverified mod {inventory.unmanaged.count === 1 ? 'entry is' : 'entries are'} outside the verified dependency graph. Names and filesystem details are intentionally hidden. Remove or formally import them outside this manager before planning any mutation.
              </div>
            ) : null}
          </>
        ) : inventoryLoading ? <div style={{ color: C.dim, fontSize: 10, marginTop: 7 }}>Loading verified mod inventory…</div> : (
          <div style={{ color: C.dim, fontSize: 10, marginTop: 7 }}>Installed mod inventory is not loaded. Select Refresh Inventory when you need it.</div>
        )}
      </div>

      {pendingPlan ? (
        <div style={{ background: `${C.gold}0a`, border: `1px solid ${C.gold}45`, borderRadius: 6, marginTop: 11, padding: '10px 11px' }}>
          <div style={{ color: C.gold, fontFamily: mono, fontSize: 9 }}>IMMUTABLE MOD GRAPH · APPROVAL REQUIRED</div>
          <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.55, marginTop: 6 }}>
            {pendingPlan.operation.toUpperCase()} · rollback snapshot {pendingPlan.rollbackSnapshot.state} · dependency closure {pendingPlan.dependentClosure.state}.
          </div>
          {pendingPlan.dependentClosure.requiredBy.length ? (
            <div role="alert" style={{ color: C.red, fontSize: 10, lineHeight: 1.5, marginTop: 6 }}>
              BLOCKED BY · {pendingPlan.dependentClosure.requiredBy.join(' · ')}
            </div>
          ) : null}
          <div style={{ display: 'grid', gap: 5, marginTop: 7 }}>
            {pendingPlan.changes.install.map((change, index) => (
              <div key={`install-${change.title}-${index}`} style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${C.gold}25`, borderRadius: 4, color: C.muted, fontSize: 10, padding: '6px 8px' }}>
                <Badge color={change.reason === 'required-dependency' ? C.gold : C.cyan}>{change.reason.replace(/-/g, ' ').toUpperCase()}</Badge>
                <span style={{ marginLeft: 7 }}>INSTALL · {change.title} · {change.versionNumber} · {change.environment.replace(/_/g, ' ')}</span>
              </div>
            ))}
            {pendingPlan.changes.update.map((change, index) => (
              <div key={`update-${change.title}-${index}`} style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${C.gold}25`, borderRadius: 4, color: C.muted, fontSize: 10, padding: '6px 8px' }}>
                <Badge color={C.gold}>UPDATE</Badge><span style={{ marginLeft: 7 }}>{change.title} · {change.fromVersion} → {change.toVersion} · {change.environment.replace(/_/g, ' ')}</span>
              </div>
            ))}
            {pendingPlan.changes.remove.map((change, index) => (
              <div key={`remove-${change.title}-${index}`} style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${C.red}25`, borderRadius: 4, color: C.muted, fontSize: 10, padding: '6px 8px' }}>
                <Badge color={change.reason === 'orphaned-dependency' ? C.gold : C.red}>{change.reason.replace(/-/g, ' ').toUpperCase()}</Badge>
                <span style={{ marginLeft: 7 }}>REMOVE · {change.title} · {change.versionNumber}</span>
              </div>
            ))}
          </div>
          <div style={{ color: C.dim, fontFamily: mono, fontSize: 8, lineHeight: 1.5, marginTop: 7, overflowWrap: 'anywhere' }}>
            MC {pendingPlan.stackBinding.minecraftVersion} · FABRIC {pendingPlan.stackBinding.loaderVersion}<br />
            PLAN DIGEST {pendingPlan.planDigest}<br />GENERATION {pendingPlan.stackBinding.generation}<br />INVENTORY DIGEST {pendingPlan.stackBinding.inventoryDigest}<br />RESERVED SNAPSHOT {pendingPlan.rollbackSnapshot.snapshotRef}<br />EXPIRES {new Date(pendingPlan.expiresAt).toLocaleString()}
          </div>
          <div style={{ color: C.red, fontSize: 10, fontWeight: 700, lineHeight: 1.5, marginTop: 7 }}>
            A hash verifies downloaded bytes, not code safety. Third-party mod code runs with the server user&apos;s permissions.
          </div>
          <div style={{ color: C.gold, fontSize: 10, fontWeight: 700, lineHeight: 1.5, marginTop: 5 }}>
            Server-only metadata does not guarantee PS4/Bedrock compatibility; mods that change registries, packets, or required client content may still prevent joining.
          </div>
          <label htmlFor="mod-plan-confirmation" style={{ ...label, marginTop: 8 }}>Type exactly: {pendingPlan.requiredConfirmation}</label>
          <input id="mod-plan-confirmation" autoComplete="off" value={confirmationInput} onChange={(event) => setConfirmationInput(event.target.value)} style={input} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            <Button color={C.red} disabled={pendingPlan.dependentClosure.state !== 'clear' || !pendingPlanStackCurrent || !stopped || confirmationInput !== pendingPlan.requiredConfirmation || Date.parse(pendingPlan.expiresAt) <= Date.now()} onClick={() => void submitPlan()}>CREATE SNAPSHOT + APPLY PLAN</Button>
            <Button onClick={() => void cancelPlan()}>CANCEL PLAN</Button>
          </div>
        </div>
      ) : null}

      {message ? <div role={messageError ? 'alert' : 'status'} aria-live="polite" style={{ color: messageError ? C.red : C.green, fontSize: 10, lineHeight: 1.55, marginTop: 9 }}>{message}</div> : null}
      {pendingOperation ? (
        <div style={{ background: `${['committed', 'rolled-back', 'rejected-before-mutation'].includes(pendingOperation.observedState ?? '') ? C.gold : C.red}0a`, border: `1px solid ${['committed', 'rolled-back', 'rejected-before-mutation'].includes(pendingOperation.observedState ?? '') ? C.gold : C.red}40`, borderRadius: 5, marginTop: 9, padding: '9px 10px' }}>
          <div style={{ color: ['committed', 'rolled-back', 'rejected-before-mutation'].includes(pendingOperation.observedState ?? '') ? C.gold : C.red, fontFamily: mono, fontSize: 9 }}>
            {pendingOperation.observedState ? pendingOperation.observedState.replace(/-/g, ' ').toUpperCase() : 'RECONCILING EXACT TRANSACTION'} · MOD MUTATIONS LOCKED
          </div>
          <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.5, marginTop: 5 }}>
            {pendingOperation.operation.toUpperCase()} request {pendingOperation.requestId}, started {new Date(pendingOperation.startedAt).toLocaleString()}. Every tab polls this exact durable request ID; none resubmits it.
          </div>
          {['committed', 'rolled-back', 'rejected-before-mutation'].includes(pendingOperation.observedState ?? '') ? <div style={{ marginTop: 7 }}><Button color={C.gold} onClick={() => void acknowledgeOperation()}>ACKNOWLEDGE FINAL RESULT</Button></div> : null}
          {['completion-unknown', 'manual-recovery-required'].includes(pendingOperation.observedState ?? '') ? <div style={{ color: C.red, fontSize: 10, marginTop: 7 }}>This state cannot be cleared by a browser acknowledgement.</div> : null}
        </div>
      ) : lastOperation ? (
        <div style={{ background: 'rgba(0,0,0,0.22)', border: `1px solid ${C.cyan}25`, borderRadius: 5, marginTop: 9, padding: '8px 10px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            <Badge color={lastOperation.state === 'committed' || lastOperation.state === 'rolled-back' ? C.green : C.red}>{lastOperation.state.toUpperCase()}</Badge>
            <Badge>{lastOperation.application.toUpperCase()}</Badge>
            <Badge>+{lastOperation.summary.installedCount} · ↑{lastOperation.summary.updatedCount} · −{lastOperation.summary.removedCount}</Badge>
          </div>
          <div style={{ color: C.dim, fontFamily: mono, fontSize: 8, lineHeight: 1.5, marginTop: 6, overflowWrap: 'anywhere' }}>
            TRANSACTION {lastOperation.transactionRef}<br />SNAPSHOT {lastOperation.rollbackSnapshot.snapshotRef} · {lastOperation.rollbackSnapshot.state}<br />
            BEFORE {lastOperation.stackBefore.generation} / {lastOperation.stackBefore.inventoryDigest}<br />
            AFTER {lastOperation.stackAfter ? `${lastOperation.stackAfter.generation} / ${lastOperation.stackAfter.inventoryDigest}` : 'UNKNOWN'}<br />
            STARTED {new Date(lastOperation.startedAt).toLocaleString()} · UPDATED {new Date(lastOperation.updatedAt).toLocaleString()}
          </div>
          {lastOperation.rollbackSnapshot.state === 'verified' && lastOperation.state === 'committed' ? (
            <div style={{ marginTop: 7 }}><Button color={C.gold} disabled={!controlsReady} onClick={() => void requestPlan({ requestId: window.crypto.randomUUID(), operation: 'rollback', transactionRef: lastOperation.transactionRef })}>PREPARE SNAPSHOT RESTORE</Button></div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function WorldManagementPanel({
  instance,
  companionLifecycleState,
  companionBridgeState,
}: {
  instance: ManagedInstance;
  companionLifecycleState: NonNullable<CompanionLifecycle['state']> | 'unknown';
  companionBridgeState: NonNullable<NonNullable<CompanionStatus['bridge']>['state']> | 'unknown';
}) {
  const [inventory, setInventory] = useState<WorldInventory | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState('');
  const [createLabel, setCreateLabel] = useState('');
  const [worldLabelDrafts, setWorldLabelDrafts] = useState<Record<string, string>>({});
  const [pendingPlan, setPendingPlan] = useState<WorldPlan | null>(null);
  const [confirmationInput, setConfirmationInput] = useState('');
  const [pendingOperation, setPendingOperation] = useState<PendingWorldOperation | null>(null);
  const [journalLoaded, setJournalLoaded] = useState(false);
  const [journalError, setJournalError] = useState('');
  const [lastOperation, setLastOperation] = useState<WorldOperation | null>(null);
  const [operationMissingRequestId, setOperationMissingRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);

  const ownedFamilyServer = instance.id === 'family-server' && instance.projectId === 'family-server' && instance.kind === 'server';
  const serverStopped = ownedFamilyServer && instance.status === 'stopped' && instance.pid === null;
  const companionStopped = companionLifecycleState === 'stopped';
  const bridgeDisconnected = companionBridgeState === 'disconnected';
  const currentRestoreReceipt = verifiedWorldRestoreReceiptFromUnknown(instance.lastRestore);
  const restoreReceiptValid = instance.lastRestore === null || instance.lastRestore === undefined || currentRestoreReceipt !== null;

  const loadInventory = useCallback(async (showLoading = false) => {
    if (showLoading) setInventoryLoading(true);
    try {
      const next = worldInventoryFromUnknown(await api<unknown>('/api/minecraft/instances/family-server/worlds'));
      setInventory(next);
      setInventoryError('');
    } catch (error) {
      setInventory(null);
      const failure = failureOf(error);
      setInventoryError(
        failure.status === 404
          ? 'Restart the local command center after installing the Family Server world manager backend.'
          : failure.code === 'WORLD_VERSION_METADATA_REQUIRED'
            ? 'World Management requires trusted DataVersion metadata. Run a verified same-version Family Server update, then refresh this inventory.'
            : failure.message,
      );
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  const refreshWorldJournal = useCallback(() => {
    const journal = readWorldClientJournal();
    setJournalError(journal.error ?? '');
    setPendingOperation(journal.operation);
    setJournalLoaded(true);
  }, []);

  useEffect(() => refreshWorldJournal(), [refreshWorldJournal]);

  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || !event.key?.startsWith(WORLD_OPERATION_STORAGE_PREFIX)) return;
      refreshWorldJournal();
    };
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, [refreshWorldJournal]);

  const pendingRequestId = pendingOperation?.requestId;
  const pendingPlanId = pendingOperation?.planId;
  const pendingPlanDigest = pendingOperation?.planDigest;
  const pendingWorldOperation = pendingOperation?.operation;
  useEffect(() => {
    setOperationMissingRequestId(null);
  }, [pendingRequestId]);
  useEffect(() => {
    if (!pendingRequestId || !pendingPlanId || !pendingPlanDigest || !pendingWorldOperation || !pendingOperation) return;
    const expected = pendingOperation;
    let disposed = false;
    let timer: number | undefined;
    const reconcile = async () => {
      try {
        const reconciled = await withWorldMutationLock(async () => {
          const journal = readWorldClientJournal();
          if (journal.error) throw new Error(journal.error);
          if (!journal.operation || journal.operation.requestId !== expected.requestId) return null;
          const value = await api<unknown>(`/api/minecraft/instances/family-server/worlds/operations/${encodeURIComponent(expected.requestId)}`);
          const operation = worldOperationFromUnknown(value, expected);
          if (operation.state !== 'committed') return { operation, inventory: null };
          const observedInventory = worldInventoryFromUnknown(await api<unknown>('/api/minecraft/instances/family-server/worlds'));
          if (!committedWorldOperationMatchesInventory(operation, observedInventory)) {
            const envelope = instanceEnvelopeFromUnknown(await api<unknown>('/api/minecraft/instances'));
            const observedInstance = envelope.instances.find((candidate) => candidate.id === 'family-server') ?? null;
            if (!noVerifiedRestoreAfterOperation(observedInstance, operation)
              || !committedWorldOperationMatchesInventory(operation, observedInventory, true)) {
              throw new Error('The committed world result does not match a safe monotonic successor of its bound world inventory. Reconciliation remains locked.');
            }
          }
          return { operation, inventory: observedInventory };
        });
        if (disposed || !reconciled) return;
        const { operation, inventory: observedInventory } = reconciled;
        setOperationMissingRequestId(null);
        setLastOperation(operation);
        if (observedInventory) setInventory(observedInventory);
        const successful = operation.state === 'committed' || operation.state === 'rolled-back';
        setMessageError(!successful);
        setMessage(
          operation.state === 'committed'
            ? `World transaction ${operation.transactionRef} committed with a verified result.`
            : operation.state === 'rolled-back'
              ? `World transaction ${operation.transactionRef} rolled back with verified recovery evidence.`
              : operation.state === 'rejected-before-mutation'
                ? `World transaction ${operation.transactionRef} was durably rejected before mutation; no world change was applied.`
                : operation.state === 'manual-recovery-required'
                  ? `World transaction ${operation.transactionRef} requires manual recovery. Server start and world mutations remain fenced.`
                  : `World transaction ${operation.transactionRef} remains completion-unknown. Do not retry it; Mastermind continues exact-ID reconciliation.`,
        );
        if (!observedInventory) await loadInventory(false);
      } catch (error) {
        if (disposed) return;
        const failure = failureOf(error);
        if (failure.status === 404 && failure.code === 'WORLD_OPERATION_NOT_FOUND') {
          setOperationMissingRequestId(expected.requestId);
          setMessageError(true);
          setMessage(`World request ${expected.requestId} is absent from the current authenticated operation history. It remains locked; a verified later backup restore can only be acknowledged explicitly after inventory reconciliation.`);
          await loadInventory(false);
        } else {
          setMessageError(true);
          setMessage(`World transaction reconciliation remains pending: ${failure.message}`);
        }
      }
      if (!disposed) timer = window.setTimeout(() => void reconcile(), 5_000);
    };
    void reconcile();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadInventory, pendingOperation, pendingPlanDigest, pendingPlanId, pendingRequestId, pendingWorldOperation]);

  const planGateReady = serverStopped && companionStopped && bridgeDisconnected && restoreReceiptValid && journalLoaded && !journalError
    && !pendingOperation && !pendingPlan && !busy && inventory !== null && !inventory.recovery.required;

  const requestPlan = async (request: WorldPlanRequest) => {
    if (!planGateReady || !inventory) return;
    if ('displayLabel' in request && !safeWorldLabelInput(request.displayLabel)) {
      setMessageError(true);
      setMessage('World labels must contain 1 to 64 safe visible characters without surrounding whitespace.');
      return;
    }
    if ('displayLabel' in request) {
      const normalized = request.displayLabel.normalize('NFKC').toLocaleLowerCase('en-US');
      const conflict = inventory.worlds.some((world) => (
        world.worldRef !== (request.operation === 'rename' ? request.targetWorldRef : null)
        && world.displayLabel.normalize('NFKC').toLocaleLowerCase('en-US') === normalized
      ));
      if (conflict) {
        setMessageError(true);
        setMessage('World labels must be unique after case-insensitive Unicode normalization.');
        return;
      }
    }
    setBusy(true);
    setMessageError(false);
    setMessage(`Preparing an immutable ${request.operation} plan against the stopped Family Server inventory...`);
    try {
      const next = worldPlanFromUnknown(await api<unknown>('/api/minecraft/instances/family-server/worlds/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }), request, inventory);
      if (Date.parse(next.expiresAt) <= Date.now()) throw new Error('The local agent returned an expired world plan.');
      setPendingPlan(next);
      setConfirmationInput('');
      setMessage('Review the exact world-state changes, inventory binding, and safety requirements before approval.');
    } catch (error) {
      const failure = failureOf(error);
      setMessageError(true);
      setMessage(failure.code === 'WORLD_PLAN_COMPLETION_UNKNOWN'
        ? `${failure.message} No world action was submitted; prepare a new plan only after checking inventory.`
        : failure.message);
    } finally {
      setBusy(false);
    }
  };

  const planCurrent = Boolean(pendingPlan && inventory
    && pendingPlan.inventoryBinding.generation === inventory.generation
    && pendingPlan.inventoryBinding.digest === inventory.inventoryDigest
    && Date.parse(pendingPlan.expiresAt) > Date.now());

  const submitPlan = async () => {
    const submittedPlan = pendingPlan;
    const submittedInventory = inventory;
    if (
      !submittedPlan || !planCurrent || confirmationInput !== submittedPlan.requiredConfirmation
      || !submittedInventory || !serverStopped || !companionStopped || !bridgeDisconnected || submittedInventory.recovery.required
      || !restoreReceiptValid || pendingOperation || journalError || busy
    ) return;
    setBusy(true);
    setMessageError(false);
    let persisted = false;
    try {
      const reconciled = await withWorldMutationLock(async () => {
        const journal = readWorldClientJournal();
        if (journal.error) throw new Error(journal.error);
        if (journal.operation) throw new Error(`World request ${journal.operation.requestId} already owns the cross-tab mutation lock.`);
        const pending: PendingWorldOperation = {
          requestId: submittedPlan.requestId,
          planId: submittedPlan.planId,
          planDigest: submittedPlan.planDigest,
          confirmation: submittedPlan.requiredConfirmation,
          expiresAt: submittedPlan.expiresAt,
          operation: submittedPlan.operation,
          submittedAt: new Date().toISOString(),
          baselineGeneration: submittedPlan.inventoryBinding.generation,
          baselineLastRestore: currentRestoreReceipt,
          expectedResult: expectedWorldResultForPlan(submittedPlan, submittedInventory),
        };
        window.localStorage.setItem(worldOperationStorageKey(pending.operation, pending.requestId), JSON.stringify(pending));
        persisted = true;
        setPendingOperation(pending);
        setPendingPlan(null);
        setConfirmationInput('');
        const value = await api<unknown>('/api/minecraft/instances/family-server/worlds/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: pending.requestId,
            planId: pending.planId,
            planDigest: pending.planDigest,
            confirmation: pending.confirmation,
          }),
        });
        const operation = worldOperationFromUnknown(value, pending);
        if (operation.state !== 'committed') return { operation, inventory: null };
        const observedInventory = worldInventoryFromUnknown(await api<unknown>('/api/minecraft/instances/family-server/worlds'));
        if (!committedWorldOperationMatchesInventory(operation, observedInventory)) {
          throw new Error('The committed world result does not match the latest bound world inventory. Reconciliation remains locked.');
        }
        return { operation, inventory: observedInventory };
      });
      const { operation, inventory: observedInventory } = reconciled;
      setLastOperation(operation);
      if (observedInventory) setInventory(observedInventory);
      setMessageError(!['committed', 'rolled-back'].includes(operation.state));
      setMessage(
        operation.state === 'committed'
          ? `World transaction ${operation.transactionRef} committed with a verified result.`
          : operation.state === 'rolled-back'
            ? `World transaction ${operation.transactionRef} rolled back with verified recovery evidence.`
            : operation.state === 'rejected-before-mutation'
              ? `World transaction ${operation.transactionRef} was rejected before mutation; no world change was applied.`
              : operation.state === 'manual-recovery-required'
                ? `World transaction ${operation.transactionRef} requires manual recovery and remains locked.`
                : `World transaction ${operation.transactionRef} is completion-unknown and remains locked. Do not retry it.`,
      );
      if (!observedInventory) await loadInventory(false);
    } catch (error) {
      const failure = failureOf(error);
      if (persisted && WORLD_AUTHORITATIVE_NO_COMMIT_CODES.has(failure.code)) {
        await withWorldMutationLock(async () => {
          const journal = readWorldClientJournal();
          if (journal.operation?.requestId === submittedPlan.requestId) {
            window.localStorage.removeItem(worldOperationStorageKey(journal.operation.operation, journal.operation.requestId));
          }
        }).catch(() => undefined);
        refreshWorldJournal();
        setMessageError(true);
        setMessage(failure.code === 'WORLD_PLAN_NOT_FOUND'
          ? 'The agent proved that this plan did not exist before any transaction marker or mutation. The local lock was released; prepare a new plan.'
          : `${failure.message} The agent rejected the request at a cross-domain recovery fence before any world transaction marker or mutation; the local lock was released.`);
      } else if (persisted) {
        setMessageError(true);
        setMessage(`${failure.message} Request ${submittedPlan.requestId} remains locked for exact operation reconciliation; no retry will be sent.`);
      } else {
        setMessageError(true);
        setMessage(`${failure.message} The cross-tab safety boundary rejected this request before it was submitted.`);
      }
    } finally {
      setBusy(false);
    }
  };

  const acknowledgeTerminal = async () => {
    const expected = pendingOperation;
    if (!expected || !lastOperation || lastOperation.requestId !== expected.requestId
      || !['committed', 'rolled-back', 'rejected-before-mutation'].includes(lastOperation.state)) return;
    try {
      const reconciled = await withWorldMutationLock(async () => {
        const journal = readWorldClientJournal();
        if (journal.error) throw new Error(journal.error);
        if (!journal.operation || journal.operation.requestId !== expected.requestId) {
          throw new Error('The durable world-operation journal changed before acknowledgement.');
        }
        const operation = worldOperationFromUnknown(
          await api<unknown>(`/api/minecraft/instances/family-server/worlds/operations/${encodeURIComponent(expected.requestId)}`),
          expected,
        );
        if (!['committed', 'rolled-back', 'rejected-before-mutation'].includes(operation.state)) {
          throw new Error('The world operation is not in an acknowledgeable terminal state.');
        }
        const currentInventory = worldInventoryFromUnknown(await api<unknown>('/api/minecraft/instances/family-server/worlds'));
        if (currentInventory.recovery.required) throw new Error('The durable world recovery fence is still active.');
        if (!committedWorldOperationMatchesInventory(operation, currentInventory)) {
          const envelope = instanceEnvelopeFromUnknown(await api<unknown>('/api/minecraft/instances'));
          const observedInstance = envelope.instances.find((candidate) => candidate.id === 'family-server') ?? null;
          if (!noVerifiedRestoreAfterOperation(observedInstance, operation)
            || !committedWorldOperationMatchesInventory(operation, currentInventory, true)) {
            throw new Error('The committed world result does not match a safe monotonic successor of its bound world inventory.');
          }
        }
        window.localStorage.removeItem(worldOperationStorageKey(expected.operation, expected.requestId));
        return { operation, inventory: currentInventory };
      });
      setLastOperation(reconciled.operation);
      setInventory(reconciled.inventory);
      refreshWorldJournal();
      setMessageError(false);
      setMessage(`Durable ${reconciled.operation.state} result acknowledged. No world operation was retried.`);
    } catch (error) {
      setMessageError(true);
      setMessage(failureOf(error).message);
    }
  };

  const acknowledgeRestoredHistory = async () => {
    const expected = pendingOperation;
    const phrase = 'ACKNOWLEDGE RESTORED WORLD HISTORY';
    if (!expected || operationMissingRequestId !== expected.requestId
      || !restoredWorldHistorySupersedes(expected, inventory, instance)) return;
    if (window.prompt(`Type exactly: ${phrase}`) !== phrase) {
      setMessageError(true);
      setMessage('Restored world history was not acknowledged. The exact request remains locked and will not be retried.');
      return;
    }
    try {
      const reconciled = await withWorldMutationLock(async () => {
        const journal = readWorldClientJournal();
        if (journal.error) throw new Error(journal.error);
        if (!journal.operation || journal.operation.requestId !== expected.requestId) {
          throw new Error('The durable world-operation journal changed before restored-history acknowledgement.');
        }
        try {
          const value = await api<unknown>(`/api/minecraft/instances/family-server/worlds/operations/${encodeURIComponent(expected.requestId)}`);
          worldOperationFromUnknown(value, expected);
          throw new Error('The world operation reappeared in durable history and must be reconciled normally.');
        } catch (error) {
          const failure = failureOf(error);
          if (failure.status !== 404 || failure.code !== 'WORLD_OPERATION_NOT_FOUND') throw error;
        }
        const currentInventory = worldInventoryFromUnknown(await api<unknown>('/api/minecraft/instances/family-server/worlds'));
        const envelope = instanceEnvelopeFromUnknown(await api<unknown>('/api/minecraft/instances'));
        const observedInstance = envelope.instances.find((candidate) => (
          candidate.id === 'family-server' && candidate.projectId === 'family-server' && candidate.kind === 'server'
        )) ?? null;
        if (!restoredWorldHistorySupersedes(expected, currentInventory, observedInstance)) {
          throw new Error('A later verified restore and clear world inventory do not yet prove that this missing operation belongs to restored-away history.');
        }
        window.localStorage.removeItem(worldOperationStorageKey(expected.operation, expected.requestId));
        return currentInventory;
      });
      setInventory(reconciled);
      setOperationMissingRequestId(null);
      setLastOperation(null);
      refreshWorldJournal();
      setMessageError(false);
      setMessage('Restored-away world history explicitly acknowledged. No world operation was retried or inferred complete.');
    } catch (error) {
      setMessageError(true);
      setMessage(`Restored-history acknowledgement remains blocked: ${failureOf(error).message}`);
    }
  };

  const cancelPlan = () => {
    if (busy || pendingOperation) return;
    setPendingPlan(null);
    setConfirmationInput('');
    setMessageError(false);
    setMessage('World plan cancelled. No world action was submitted.');
  };

  const totalBytes = inventory?.worlds.reduce((sum, world) => sum + world.bytes, 0) ?? 0;
  const atWorldLimit = Boolean(inventory && inventory.worlds.length >= inventory.limits.maxWorlds);
  const validCreateLabel = safeWorldLabelInput(createLabel);
  const createLabelAvailable = Boolean(validCreateLabel && inventory && !inventory.worlds.some((world) => (
    world.displayLabel.normalize('NFKC').toLocaleLowerCase('en-US') === validCreateLabel.normalize('NFKC').toLocaleLowerCase('en-US')
  )));
  const terminalObserved = lastOperation && pendingOperation?.requestId === lastOperation.requestId
    && ['committed', 'rolled-back', 'rejected-before-mutation'].includes(lastOperation.state);
  const restoredHistoryCanBeAcknowledged = Boolean(
    pendingOperation && operationMissingRequestId === pendingOperation.requestId
    && restoredWorldHistorySupersedes(pendingOperation, inventory, instance),
  );
  const statusColor = inventoryError || journalError || inventory?.recovery.required ? C.red
    : planGateReady ? C.green : C.gold;

  return (
    <section style={{ ...panel, borderColor: `${statusColor}45` }}>
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
        <div style={{ color: C.cyan, fontFamily: mono, fontSize: 10, letterSpacing: 1.5 }}>FAMILY SERVER · WORLD MANAGEMENT</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Badge color={serverStopped ? C.green : C.gold}>SERVER {serverStopped ? 'STOPPED' : instance.status.toUpperCase()}</Badge>
          <Badge color={companionStopped ? C.green : C.gold}>COMPANION {companionLifecycleState.toUpperCase()}</Badge>
          <Badge color={bridgeDisconnected ? C.green : C.gold}>BRIDGE {companionBridgeState.toUpperCase()}</Badge>
        </div>
      </div>
      <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.6, marginTop: 8 }}>
        Create, clone, rename, preserve by archive, or switch the active Family Server world through an inventory-bound local plan. The browser never supplies a path, folder, seed, generator setting, DataVersion, backup identifier, URL, or raw filesystem name. Archive preserves a world; it does not delete it.
      </div>
      {(!serverStopped || !companionStopped || !bridgeDisconnected) ? (
        <div style={{ color: C.gold, fontSize: 10, lineHeight: 1.5, marginTop: 8 }}>
          Mutations require three separately verified facts: the exact Family Server is stopped, the AI companion lifecycle is stopped, and its bridge is disconnected. Unknown or stale status remains read-only.
        </div>
      ) : null}
      {!restoreReceiptValid ? (
        <div role="alert" style={{ color: C.red, fontSize: 10, fontWeight: 700, lineHeight: 1.5, marginTop: 8 }}>
          INSTANCE RESTORE RECEIPT INVALID - World mutations remain locked because the public verified-restore receipt is incomplete or malformed.
        </div>
      ) : null}
      {journalError ? <div role="alert" style={{ color: C.red, fontSize: 10, fontWeight: 700, lineHeight: 1.5, marginTop: 8 }}>LOCAL WORLD JOURNAL INVALID · {journalError}</div> : null}

      <div style={{ borderTop: `1px solid ${C.cyan}20`, marginTop: 11, paddingTop: 10 }}>
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 7, justifyContent: 'space-between' }}>
          <div style={{ color: C.cyan, fontFamily: mono, fontSize: 9 }}>VERIFIED WORLD INVENTORY</div>
          <Button disabled={inventoryLoading || busy} onClick={() => void loadInventory(true)}>{inventoryLoading ? 'CHECKING…' : 'REFRESH INVENTORY'}</Button>
        </div>
        {inventoryError ? <div role="alert" style={{ color: C.red, fontSize: 10, marginTop: 7 }}>{inventoryError}</div> : null}
        {inventory ? (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              <Badge color={inventory.recovery.required ? C.red : C.green}>{inventory.recovery.required ? 'RECOVERY REQUIRED' : 'RECOVERY CLEAR'}</Badge>
              <Badge>{inventory.worlds.length} / {inventory.limits.maxWorlds} WORLDS</Badge>
              <Badge>{formatBackupBytes(totalBytes)} / {formatBackupBytes(inventory.limits.maxTotalBytes)}</Badge>
            </div>
            <div style={{ color: C.dim, fontFamily: mono, fontSize: 8, lineHeight: 1.5, marginTop: 7, overflowWrap: 'anywhere' }}>
              GENERATION {inventory.generation}<br />INVENTORY DIGEST {inventory.inventoryDigest}
            </div>
            {inventory.recovery.required ? (
              <div role="alert" style={{ background: `${C.red}0a`, border: `1px solid ${C.red}45`, borderRadius: 5, color: C.red, fontSize: 10, fontWeight: 700, lineHeight: 1.5, marginTop: 8, padding: '8px 10px' }}>
                RECOVERY FENCE ACTIVE · {inventory.recovery.state.replace(/-/g, ' ').toUpperCase()} · TRANSACTION {inventory.recovery.transactionRef}. Server start and world mutations remain blocked by durable agent state.
              </div>
            ) : null}
          </>
        ) : inventoryLoading ? <div style={{ color: C.dim, fontSize: 10, marginTop: 7 }}>Loading bounded world inventory…</div> : (
          <div style={{ color: C.dim, fontSize: 10, marginTop: 7 }}>World inventory is not loaded. Select Refresh Inventory when you need it.</div>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const displayLabel = safeWorldLabelInput(createLabel);
          if (displayLabel) void requestPlan({ requestId: window.crypto.randomUUID(), operation: 'create', displayLabel });
        }}
        style={{ display: 'grid', gap: 7, gridTemplateColumns: 'minmax(0,1fr) auto', marginTop: 11 }}
      >
        <div>
          <label htmlFor="minecraft-world-create-label" style={label}>New world display label</label>
          <input id="minecraft-world-create-label" maxLength={64} value={createLabel} onChange={(event) => setCreateLabel(event.target.value)} placeholder="Family survival" style={input} />
        </div>
        <div style={{ alignSelf: 'end' }}>
          <Button type="submit" color={C.green} disabled={!planGateReady || atWorldLimit || !createLabelAvailable}>PREPARE CREATE</Button>
        </div>
      </form>
      {atWorldLimit ? <div style={{ color: C.gold, fontSize: 10, marginTop: 6 }}>The 12-world inventory limit is reached. V1 intentionally provides archive rather than browser deletion, so creating or cloning is unavailable.</div> : null}

      {inventory ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 11 }}>
          {inventory.worlds.map((world, index) => {
            const color = world.state === 'active' ? C.green : world.state === 'archived' ? C.dim : C.cyan;
            const draft = worldLabelDrafts[world.worldRef] ?? '';
            const validDraft = safeWorldLabelInput(draft);
            const normalizedDraft = validDraft?.normalize('NFKC').toLocaleLowerCase('en-US') ?? null;
            const renameLabelAvailable = Boolean(normalizedDraft && !inventory.worlds.some((candidate) => (
              candidate.worldRef !== world.worldRef
              && candidate.displayLabel.normalize('NFKC').toLocaleLowerCase('en-US') === normalizedDraft
            )));
            const cloneLabelAvailable = Boolean(normalizedDraft && !inventory.worlds.some((candidate) => (
              candidate.displayLabel.normalize('NFKC').toLocaleLowerCase('en-US') === normalizedDraft
            )));
            const incompatible = world.integrity === 'locked-version';
            return (
              <article key={world.worldRef} style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${color}35`, borderLeft: `3px solid ${color}`, borderRadius: 6, padding: '10px 11px' }}>
                <div style={{ alignItems: 'flex-start', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ color: '#e8ffff', fontWeight: 700 }}>{world.displayLabel}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                      <Badge color={color}>{world.state.toUpperCase()}</Badge>
                      {world.pendingGeneration ? <Badge color={C.gold}>PENDING GENERATION</Badge> : null}
                      {incompatible ? <Badge color={C.red}>INCOMPATIBLE</Badge> : null}
                      {world.integrity === 'unverified-active' ? <Badge color={C.gold}>UNVERIFIED ACTIVE</Badge> : null}
                      {world.integrity === 'verified' ? <Badge color={C.green}>VERIFIED</Badge> : null}
                    </div>
                  </div>
                  <div style={{ color: C.dim, fontFamily: mono, fontSize: 8, lineHeight: 1.5, textAlign: 'right' }}>
                    MC {world.minecraftVersion} · DATA {world.dataVersion ?? 'UNKNOWN'}<br />
                    {world.files.toLocaleString()} FILES · {formatBackupBytes(world.bytes)}<br />UPDATED {new Date(world.updatedAt).toLocaleString()}
                  </div>
                </div>
                {incompatible ? <div style={{ color: C.red, fontSize: 10, lineHeight: 1.5, marginTop: 7 }}>This archived world is locked to an incompatible game version. V1 does not expose a force switch or conversion override.</div> : null}
                {world.pendingGeneration ? <div style={{ color: C.gold, fontSize: 10, lineHeight: 1.5, marginTop: 7 }}>The world record is reserved but terrain has not yet been generated. Do not interpret its zero/unknown facts as an empty verified world.</div> : null}
                <div style={{ display: 'grid', gap: 7, gridTemplateColumns: 'minmax(0,1fr) auto', marginTop: 9 }}>
                  <div>
                    <label htmlFor={`world-label-${index}`} style={label}>New unique label for rename or clone</label>
                    <input
                      id={`world-label-${index}`}
                      maxLength={64}
                      value={draft}
                      onChange={(event) => setWorldLabelDrafts((current) => ({ ...current, [world.worldRef]: event.target.value }))}
                      placeholder="New display label"
                      style={input}
                    />
                  </div>
                  <div style={{ alignItems: 'flex-end', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    <Button
                      disabled={!planGateReady || !validDraft || !renameLabelAvailable || validDraft === world.displayLabel}
                      onClick={() => validDraft && void requestPlan({ requestId: window.crypto.randomUUID(), operation: 'rename', targetWorldRef: world.worldRef, displayLabel: validDraft })}
                    >PREPARE RENAME</Button>
                    <Button
                      disabled={!planGateReady || !validDraft || !cloneLabelAvailable || atWorldLimit || incompatible}
                      onClick={() => validDraft && void requestPlan({ requestId: window.crypto.randomUUID(), operation: 'clone', targetWorldRef: world.worldRef, displayLabel: validDraft })}
                    >PREPARE CLONE</Button>
                    {world.state === 'inactive' ? (
                      <Button color={C.gold} disabled={!planGateReady} onClick={() => void requestPlan({ requestId: window.crypto.randomUUID(), operation: 'archive', targetWorldRef: world.worldRef })}>PREPARE ARCHIVE</Button>
                    ) : null}
                    {world.state !== 'active' ? (
                      <Button color={C.red} disabled={!planGateReady || incompatible} onClick={() => void requestPlan({ requestId: window.crypto.randomUUID(), operation: 'switch', targetWorldRef: world.worldRef })}>
                        {world.state === 'archived' ? 'SWITCH + UNARCHIVE' : 'PREPARE SWITCH'}
                      </Button>
                    ) : <Badge color={C.green}>ACTIVE WORLD · ARCHIVE DISABLED</Badge>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {pendingPlan ? (
        <div style={{ background: `${C.gold}0a`, border: `1px solid ${C.gold}45`, borderRadius: 6, marginTop: 11, padding: '10px 11px' }}>
          <div style={{ color: C.gold, fontFamily: mono, fontSize: 9 }}>IMMUTABLE WORLD PLAN · APPROVAL REQUIRED</div>
          <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.55, marginTop: 6 }}>
            {pendingPlan.operation.toUpperCase()} · source {pendingPlan.source?.displayLabel ?? 'NEW WORLD'} · target {pendingPlan.target.displayLabel} ({pendingPlan.target.state.toUpperCase()}).
          </div>
          <div style={{ display: 'grid', gap: 5, marginTop: 7 }}>
            {pendingPlan.changes.map((change) => (
              <div key={`${change.worldRef}-${change.fromState ?? 'new'}-${change.toState}`} style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${C.gold}25`, borderRadius: 4, color: C.muted, fontSize: 10, padding: '6px 8px' }}>
                <Badge color={change.toState === 'active' ? C.green : change.toState === 'archived' ? C.gold : C.cyan}>{change.toState.toUpperCase()}</Badge>
                <span style={{ marginLeft: 7 }}>{change.displayLabel} · {change.fromState?.toUpperCase() ?? 'NEW'} → {change.toState.toUpperCase()}</span>
              </div>
            ))}
          </div>
          <div style={{ color: pendingPlan.safety.rescueBackupRequired ? C.gold : C.muted, fontSize: 10, lineHeight: 1.5, marginTop: 7 }}>
            STOPPED SERVER REQUIRED · {pendingPlan.safety.rescueBackupRequired ? 'VERIFIED RESCUE SNAPSHOT REQUIRED BEFORE SWITCH' : 'NO SWITCH RESCUE SNAPSHOT REQUIRED'} · NON-DESTRUCTIVE
          </div>
          {pendingPlan.operation === 'archive' ? <div style={{ color: C.gold, fontSize: 10, marginTop: 5 }}>Archive preserves the world and removes it from normal active selection; it is not deletion.</div> : null}
          {pendingPlan.operation === 'switch' && pendingPlan.source?.state === 'archived' ? <div style={{ color: C.gold, fontSize: 10, marginTop: 5 }}>This switch explicitly restores the archived target to ACTIVE while moving the current active world to INACTIVE.</div> : null}
          <div style={{ color: C.dim, fontFamily: mono, fontSize: 8, lineHeight: 1.5, marginTop: 7, overflowWrap: 'anywhere' }}>
            PLAN {pendingPlan.planId}<br />DIGEST {pendingPlan.planDigest}<br />GENERATION {pendingPlan.inventoryBinding.generation}<br />INVENTORY DIGEST {pendingPlan.inventoryBinding.digest}<br />EXPIRES {new Date(pendingPlan.expiresAt).toLocaleString()}
          </div>
          {!planCurrent ? <div role="alert" style={{ color: C.red, fontSize: 10, marginTop: 7 }}>This plan is expired or no longer matches the latest inventory generation and cannot be submitted.</div> : null}
          <label htmlFor="world-plan-confirmation" style={{ ...label, marginTop: 8 }}>Type exactly: {pendingPlan.requiredConfirmation}</label>
          <input id="world-plan-confirmation" autoComplete="off" value={confirmationInput} onChange={(event) => setConfirmationInput(event.target.value)} style={input} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            <Button color={C.red} disabled={!planCurrent || !serverStopped || !companionStopped || !bridgeDisconnected || confirmationInput !== pendingPlan.requiredConfirmation || busy} onClick={() => void submitPlan()}>SUBMIT EXACT WORLD PLAN</Button>
            <Button disabled={busy} onClick={cancelPlan}>CANCEL PLAN</Button>
          </div>
        </div>
      ) : null}

      {message ? <div role={messageError ? 'alert' : 'status'} aria-live="polite" style={{ color: messageError ? C.red : C.green, fontSize: 10, lineHeight: 1.55, marginTop: 9 }}>{message}</div> : null}
      {pendingOperation ? (
        <div style={{ background: `${terminalObserved ? C.gold : C.red}0a`, border: `1px solid ${terminalObserved ? C.gold : C.red}40`, borderRadius: 5, marginTop: 9, padding: '9px 10px' }}>
          <div style={{ color: terminalObserved ? C.gold : C.red, fontFamily: mono, fontSize: 9 }}>
            {lastOperation?.requestId === pendingOperation.requestId ? lastOperation.state.replace(/-/g, ' ').toUpperCase() : 'RECONCILING EXACT REQUEST'} · WORLD MUTATIONS LOCKED
          </div>
          <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.5, marginTop: 5 }}>
            {pendingOperation.operation.toUpperCase()} request {pendingOperation.requestId}, submitted {new Date(pendingOperation.submittedAt).toLocaleString()}. Every tab polls this exact durable request ID; no tab resubmits it automatically. Plan expiry does not clear an in-flight operation lock.
          </div>
          {lastOperation?.failureCode ? <div style={{ color: C.red, fontFamily: mono, fontSize: 9, marginTop: 6 }}>SAFE FAILURE CODE · {lastOperation.failureCode}</div> : null}
          {terminalObserved ? (
            <div style={{ marginTop: 7 }}><Button color={C.gold} disabled={inventory?.recovery.required !== false} onClick={() => void acknowledgeTerminal()}>ACKNOWLEDGE DURABLE TERMINAL RESULT</Button></div>
          ) : null}
          {lastOperation && ['completion-unknown', 'manual-recovery-required'].includes(lastOperation.state) ? (
            <div style={{ color: C.red, fontSize: 10, lineHeight: 1.5, marginTop: 7 }}>This state cannot be cleared by a browser acknowledgement. Keep the server stopped and use the agent&apos;s recovery workflow.</div>
          ) : null}
          {operationMissingRequestId === pendingOperation.requestId ? (
            <div style={{ color: restoredHistoryCanBeAcknowledged ? C.gold : C.red, fontSize: 10, lineHeight: 1.5, marginTop: 7 }}>
              The exact request is absent from current authenticated operation history. This is not evidence of failure or completion. A later verified backup restore, changed bound inventory generation, and clear recovery state are all required before an explicit restored-history acknowledgement is offered.
              {restoredHistoryCanBeAcknowledged ? (
                <div style={{ marginTop: 7 }}>
                  <Button color={C.gold} onClick={() => void acknowledgeRestoredHistory()}>ACKNOWLEDGE RESTORED WORLD HISTORY</Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : lastOperation ? (
        <div style={{ background: 'rgba(0,0,0,0.22)', border: `1px solid ${C.cyan}25`, borderRadius: 5, marginTop: 9, padding: '8px 10px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <Badge color={['committed', 'rolled-back'].includes(lastOperation.state) ? C.green : C.gold}>{lastOperation.state.toUpperCase()}</Badge>
            <Badge>{lastOperation.application.toUpperCase()}</Badge>
          </div>
          <div style={{ color: C.dim, fontFamily: mono, fontSize: 8, lineHeight: 1.5, marginTop: 6, overflowWrap: 'anywhere' }}>
            TRANSACTION {lastOperation.transactionRef}<br />STARTED {new Date(lastOperation.startedAt).toLocaleString()} · UPDATED {new Date(lastOperation.updatedAt).toLocaleString()}
          </div>
          {lastOperation.state === 'committed' && lastOperation.result ? (
            'activeWorldRef' in lastOperation.result ? (
              <div style={{ color: C.green, fontSize: 10, lineHeight: 1.5, marginTop: 6 }}>Active-world switch verified with its rescue snapshot. Pending generation: {lastOperation.result.pendingGeneration ? 'YES' : 'NO'}.</div>
            ) : (
              <div style={{ color: C.green, fontSize: 10, lineHeight: 1.5, marginTop: 6 }}>{lastOperation.operation.toUpperCase()} verified · {lastOperation.result.displayLabel} · {lastOperation.result.state.toUpperCase()} · pending generation {lastOperation.result.pendingGeneration ? 'YES' : 'NO'}.</div>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default function MinecraftConsole({ active = true }: { active?: boolean }) {
  const refreshGeneration = useRef(0);
  const updateGeneration = useRef(0);
  const updateFingerprint = useRef('');
  const devicePollAbort = useRef<AbortController | null>(null);
  const clientStatusAbort = useRef<AbortController | null>(null);
  const clientStatusInFlight = useRef<Promise<void> | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [catalog, setCatalog] = useState<FamilyCatalog | null>(null);
  const [catalogMessage, setCatalogMessage] = useState('Resolving the newest metadata-compatible stack...');
  const [instances, setInstances] = useState<ManagedInstance[]>([]);
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [managedClient, setManagedClient] = useState<ManagedClientStatus | null>(null);
  const [clientStatusLoading, setClientStatusLoading] = useState(false);
  const [clientProvisioning, setClientProvisioning] = useState(false);
  const [clientMessage, setClientMessage] = useState('Managed client status has not completed.');
  const [clientMessageError, setClientMessageError] = useState(false);
  const [appClientId, setAppClientId] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState('');
  const [accountMessageError, setAccountMessageError] = useState(false);
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlow | null>(null);
  const [devicePollingEnabled, setDevicePollingEnabled] = useState(false);
  const [deviceClock, setDeviceClock] = useState(0);
  const [companion, setCompanion] = useState<CompanionStatus | null>(null);
  const [companionMessage, setCompanionMessage] = useState('Companion status has not completed.');
  const [companionBusy, setCompanionBusy] = useState(false);
  const [familyBrain, setFamilyBrain] = useState<FamilyBrainStatus | null>(null);
  const [familyBrainMessage, setFamilyBrainMessage] = useState('Companion foundation status has not completed.');
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [busyInstance, setBusyInstance] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsMessage, setLogsMessage] = useState('');
  const [backupInstanceId, setBackupInstanceId] = useState('');
  const [lanInstanceId, setLanInstanceId] = useState('');
  const [lan, setLan] = useState<LanStatus | null>(null);
  const [lanMessage, setLanMessage] = useState('LAN diagnostics have not completed.');
  const [lanActionActive, setLanActionActive] = useState(false);
  const [lanActionMessage, setLanActionMessage] = useState('');
  const [instanceUpdates, setInstanceUpdates] = useState<Record<string, InstanceUpdateView>>({});
  const [retiredVersionPurges, setRetiredVersionPurges] = useState<Record<string, RetiredVersionPurgeView>>({});

  const [instanceId, setInstanceId] = useState('family-server');
  const [displayName, setDisplayName] = useState('Family Server');
  const [memoryMb, setMemoryMb] = useState(4096);
  const [eulaAccepted, setEulaAccepted] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionMessage, setProvisionMessage] = useState('');
  const [provisionError, setProvisionError] = useState(false);

  const reconcileRetiredPurgeJournals = useCallback(async (authoritativeInstances: ManagedInstance[]) => {
    for (const instance of authoritativeInstances) {
      const key = retiredPurgeStorageKey(instance.id);
      const raw = window.localStorage.getItem(key);
      if (raw === null) {
        setRetiredVersionPurges((previous) => {
          const view = previous[instance.id];
          const baseline = view?.reconciliationBaseline;
          if (!view?.completionUnknown || !baseline || instance.updateStatus?.state !== 'verified') return previous;
          if (instance.updateStatus.backupAvailable === false) {
            return {
              ...previous,
              [instance.id]: {
                pending: false,
                reconciledPurged: true,
                error: 'Authoritative instance inventory confirms the retained rollback payload is no longer available. The ambiguous cleanup journal is reconciled.',
              },
            };
          }
          if (instance.updateStatus.backupAvailable === true
            && instance.updateStatus.previousMinecraftVersion === baseline.previousMinecraftVersion
            && instance.updateStatus.targetMinecraftVersion === baseline.targetMinecraftVersion
            && instance.updateStatus.verifiedAt === baseline.verifiedAt) {
            return {
              ...previous,
              [instance.id]: {
                pending: false,
                reconciledRetained: true,
                error: 'Fresh authoritative inventory confirms the same verified rollback payload remains retained. No cleanup was committed; a new request may be submitted.',
              },
            };
          }
          return previous;
        });
        continue;
      }
      let pending: PendingRetiredVersionPurge;
      try {
        pending = pendingRetiredPurgeFromStorage(raw) as PendingRetiredVersionPurge;
        if (pending.instanceId !== instance.id) throw new Error('Persisted cleanup identity does not match this instance.');
      } catch {
        setRetiredVersionPurges((previous) => ({
          ...previous,
          [instance.id]: {
            pending: false, completionUnknown: true,
            error: 'PERSISTED CLEANUP LOCK INVALID - Do not retry this destructive action. Repair the local browser journal and reconcile server inventory.',
          },
        }));
        continue;
      }
      if (instance.updateStatus?.state === 'verified' && instance.updateStatus.backupAvailable === false) {
        let journalCleared = false;
        await withRetiredPurgeLock(instance.id, async () => {
          const current = window.localStorage.getItem(key);
          if (current === raw) {
            window.localStorage.removeItem(key);
            journalCleared = true;
          } else if (current === null) {
            journalCleared = true;
          }
        }).catch(() => undefined);
        if (!journalCleared) {
          setRetiredVersionPurges((previous) => ({
            ...previous,
            [instance.id]: {
              pending: false,
              completionUnknown: true,
              reconciliationBaseline: pending.baseline,
              error: 'COMPLETION UNKNOWN - The authoritative inventory indicates cleanup, but the cross-tab journal could not be safely cleared. Do not retry.',
            },
          }));
          continue;
        }
        setRetiredVersionPurges((previous) => ({
          ...previous,
          [instance.id]: {
            pending: false, reconciledPurged: true,
            error: 'Authoritative instance inventory confirms the retained rollback payload is no longer available. The ambiguous cleanup journal is reconciled.',
          },
        }));
      } else {
        setRetiredVersionPurges((previous) => ({
          ...previous,
          [instance.id]: {
            pending: false, completionUnknown: true,
            reconciliationBaseline: pending.baseline,
            error: `COMPLETION UNKNOWN - Cleanup submitted ${new Date(pending.submittedAt).toLocaleString()}. Do not retry; the retained rollback payload has not been authoritatively reconciled as purged.`,
          },
        }));
      }
    }
  }, []);

  const reconcileInstanceUpdateJournals = useCallback(async (authoritativeInstances: ManagedInstance[]) => {
    for (const instance of authoritativeInstances) {
      const key = instanceUpdateStorageKey(instance.id);
      const raw = window.localStorage.getItem(key);
      if (raw === null) continue;
      let pending: PendingInstanceUpdate;
      try {
        pending = pendingInstanceUpdateFromStorage(raw) as PendingInstanceUpdate;
        if (pending.instanceId !== instance.id) throw new Error('Persisted update identity mismatch.');
      } catch {
        setInstanceUpdates((previous) => ({
          ...previous,
          [instance.id]: {
            loading: false,
            completionUnknown: true,
            error: 'PERSISTED UPDATE LOCK INVALID - Do not retry this update until the local browser journal is repaired.',
          },
        }));
        continue;
      }
      const status = instance.updateStatus;
      const versionMigrationVerified = pending.plan.currentMinecraft !== pending.plan.targetMinecraft
        && instance.minecraftVersion === pending.plan.targetMinecraft
        && ['pending-unverified', 'verified'].includes(status?.state ?? '')
        && status?.previousMinecraftVersion === pending.plan.currentMinecraft
        && status.targetMinecraftVersion === pending.plan.targetMinecraft
        && status.backupAvailable === true;
      if (versionMigrationVerified) {
        let journalCleared = false;
        await withInstanceUpdateLock(instance.id, async () => {
          const current = window.localStorage.getItem(key);
          if (current === raw) {
            window.localStorage.removeItem(key);
            journalCleared = true;
          } else if (current === null) {
            journalCleared = true;
          }
        }).catch(() => undefined);
        if (journalCleared) {
          setInstanceUpdates((previous) => ({
            ...previous,
            [instance.id]: {
              loading: false,
              error: 'UPDATE RECONCILED - Authoritative instance inventory confirms the approved Minecraft version migration reached managed inventory.',
            },
          }));
          continue;
        }
      }
      setInstanceUpdates((previous) => ({
        ...previous,
        [instance.id]: {
          loading: false,
          update: pending.plan,
          completionUnknown: true,
          error: `COMPLETION UNKNOWN - Update submitted ${new Date(pending.submittedAt).toLocaleString()}. Do not retry; authoritative managed inventory has not proved the outcome.`,
        },
      }));
    }
  }, []);

  const checkInstanceUpdates = useCallback(async (targets: ManagedInstance[], signal?: AbortSignal) => {
    const generation = ++updateGeneration.current;
    if (targets.length === 0) {
      updateFingerprint.current = '';
      setInstanceUpdates({});
      return;
    }
    setInstanceUpdates((previous) => Object.fromEntries(targets.map((instance) => [
      instance.id,
      { loading: true, update: previous[instance.id]?.update },
    ])));

    const results = await Promise.all(targets.map(async (instance) => {
      try {
        const rawEnvelope = await api<unknown>(
          `/api/minecraft/instances/${encodeURIComponent(instance.id)}/update-status`,
          { signal },
        );
        const envelope = updateStatusEnvelopeFromUnknown(rawEnvelope, instance.id);
        return [instance.id, { loading: false, update: envelope.update }] as const;
      } catch (error) {
        return [instance.id, { loading: false, error: failureOf(error).message }] as const;
      }
    }));

    if (signal?.aborted || generation !== updateGeneration.current) return;
    const next = Object.fromEntries(results) as Record<string, InstanceUpdateView>;
    for (const instance of targets) {
      const raw = window.localStorage.getItem(instanceUpdateStorageKey(instance.id));
      if (raw === null) continue;
      try {
        const pending = pendingInstanceUpdateFromStorage(raw);
        if (!pending || pending.instanceId !== instance.id) throw new Error('Persisted update identity mismatch.');
        next[instance.id] = {
          loading: false,
          update: pending.plan,
          completionUnknown: true,
          error: `COMPLETION UNKNOWN - Update submitted ${new Date(pending.submittedAt).toLocaleString()}. Do not retry; authoritative managed inventory has not proved the outcome.`,
        };
      } catch {
        next[instance.id] = {
          loading: false,
          completionUnknown: true,
          error: 'PERSISTED UPDATE LOCK INVALID - Do not retry this update until the local browser journal is repaired.',
        };
      }
    }
    setInstanceUpdates(next);
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const generation = ++refreshGeneration.current;
    const isCurrent = () => !signal?.aborted && generation === refreshGeneration.current;
    if (isCurrent()) setRefreshing(true);
    try {
      const [overviewResult, instancesResult, catalogResult, accountResult, lanResult, companionResult, brainResult] = await Promise.allSettled([
        api<Overview>('/api/minecraft/overview', { signal }),
        api<unknown>('/api/minecraft/instances', { signal }),
        api<CatalogEnvelope>('/api/minecraft/catalog', { signal }),
        api<AccountEnvelope>('/api/minecraft/account', { signal }),
        api<LanEnvelope>('/api/minecraft/lan', { signal }),
        api<CompanionEnvelope>('/api/minecraft/companion/status', { signal }),
        api<FamilyBrainEnvelope>('/api/minecraft/brain/status', { signal }),
      ]);
      if (!isCurrent()) return;
      if (overviewResult.status === 'rejected') throw overviewResult.reason;
      if (instancesResult.status === 'rejected') throw instancesResult.reason;
      setOverview(overviewResult.value);
      const nextInstances = instanceEnvelopeFromUnknown(instancesResult.value).instances;
      setInstances(nextInstances);
      await reconcileRetiredPurgeJournals(nextInstances);
      await reconcileInstanceUpdateJournals(nextInstances);
      setFailure(null);

      if (catalogResult.status === 'fulfilled') {
        setCatalog(catalogResult.value.catalog ?? null);
        setCatalogMessage('');
      } else {
        const catalogFailure = failureOf(catalogResult.reason);
        setCatalog(null);
        setCatalogMessage(catalogFailure.message);
      }

      if (accountResult.status === 'fulfilled') {
        try {
          setAccount(accountFromEnvelope(accountResult.value));
        } catch (error) {
          setAccount(null);
          setAccountMessageError(true);
          setAccountMessage(error instanceof Error ? error.message : 'The public account status was invalid.');
        }
      } else {
        const accountFailure = failureOf(accountResult.reason);
        if (accountFailure.status === 401 || accountFailure.status === 403 || accountFailure.status === 503) {
          setFailure(accountFailure);
        } else {
          setAccount(null);
          setAccountMessageError(true);
          setAccountMessage(accountFailure.status === 404
            ? 'Restart the local command center to load Microsoft device-code sign-in.'
            : accountFailure.message);
        }
      }

      if (lanResult.status === 'fulfilled') {
        setLan(lanResult.value.lan ?? null);
        setLanMessage(lanResult.value.lan ? '' : 'The local agent returned no LAN diagnostics.');
      } else {
        setLan(null);
        setLanMessage(failureOf(lanResult.reason).message);
      }

      if (companionResult.status === 'fulfilled') {
        setCompanion(companionResult.value.companion ?? null);
        setCompanionMessage(companionResult.value.companion ? '' : 'The local agent returned no companion status.');
      } else {
        const companionFailure = failureOf(companionResult.reason);
        setCompanion(null);
        setCompanionMessage(
          companionFailure.status === 404
            ? 'Restart the local command center to load the new companion control boundary.'
            : companionFailure.message,
        );
      }

      if (brainResult.status === 'fulfilled') {
        try {
          setFamilyBrain(familyBrainFromEnvelope(brainResult.value));
          setFamilyBrainMessage('');
        } catch (error) {
          setFamilyBrain(null);
          setFamilyBrainMessage(error instanceof Error ? error.message : 'The companion foundation status was invalid.');
        }
      } else {
        const brainFailure = failureOf(brainResult.reason);
        setFamilyBrain(null);
        setFamilyBrainMessage(brainFailure.status === 404
          ? 'Restart the local command center to load the companion foundation status.'
          : brainFailure.message);
      }

      const fingerprint = nextInstances.map((instance) => `${instance.id}:${instance.minecraftVersion}`).sort().join('|');
      if (fingerprint !== updateFingerprint.current) {
        updateFingerprint.current = fingerprint;
        void checkInstanceUpdates(nextInstances, signal);
      }
    } catch (error) {
      if (!isCurrent()) return;
      setOverview(null);
      setInstances([]);
      setCatalog(null);
      setAccount(null);
      setLan(null);
      setCompanion(null);
      setFamilyBrain(null);
      setFailure(failureOf(error));
    } finally {
      if (isCurrent()) setRefreshing(false);
    }
  }, [checkInstanceUpdates, reconcileInstanceUpdateJournals, reconcileRetiredPurgeJournals]);

  const refreshClientStatus = useCallback((restart = false): Promise<void> => {
    if (!restart && clientStatusInFlight.current) return clientStatusInFlight.current;
    if (restart) clientStatusAbort.current?.abort();
    const controller = new AbortController();
    clientStatusAbort.current = controller;
    setClientStatusLoading(true);
    setClientMessageError(false);
    setClientMessage('Verifying the managed client installation...');
    const promise = (async () => {
      try {
        const envelope = await api<ManagedClientEnvelope>('/api/minecraft/client/status', { signal: controller.signal });
        if (controller.signal.aborted) return;
        setManagedClient(clientFromEnvelope(envelope));
        setClientMessageError(false);
        setClientMessage('');
      } catch (error) {
        if (controller.signal.aborted) return;
        const clientFailure = failureOf(error);
        setClientMessageError(true);
        setClientMessage(clientFailure.status === 404
          ? 'Restart the local command center to load managed client installation.'
          : clientFailure.message);
      } finally {
        if (clientStatusAbort.current === controller) {
          clientStatusAbort.current = null;
          clientStatusInFlight.current = null;
          setClientStatusLoading(false);
        }
      }
    })();
    clientStatusInFlight.current = promise;
    return promise;
  }, []);

  useEffect(() => () => clientStatusAbort.current?.abort(), []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const poll = async () => {
      await refresh(controller.signal);
      if (!controller.signal.aborted) timer = window.setTimeout(() => void poll(), 7500);
    };
    void poll();
    return () => {
      controller.abort();
      refreshGeneration.current += 1;
      updateGeneration.current += 1;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, refresh]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || !event.key?.startsWith(RETIRED_PURGE_STORAGE_PREFIX)) return;
      const instanceId = event.key.slice(RETIRED_PURGE_STORAGE_PREFIX.length);
      if (!PUBLIC_INSTANCE_ID.test(instanceId)) return;
      if (event.newValue !== null) {
        try {
          const pending = pendingRetiredPurgeFromStorage(event.newValue);
          if (!pending || pending.instanceId !== instanceId) throw new Error('Cleanup journal identity mismatch.');
          setRetiredVersionPurges((previous) => ({
            ...previous,
            [instanceId]: {
              pending: false, completionUnknown: true,
              reconciliationBaseline: pending.baseline,
              error: `COMPLETION UNKNOWN - Another tab submitted cleanup ${new Date(pending.submittedAt).toLocaleString()}. Do not retry; refresh authoritative instance inventory.`,
            },
          }));
        } catch {
          setRetiredVersionPurges((previous) => ({
            ...previous,
            [instanceId]: {
              pending: false, completionUnknown: true,
              error: 'PERSISTED CLEANUP LOCK INVALID - Do not retry this destructive action.',
            },
          }));
        }
      } else {
        try {
          const pending = pendingRetiredPurgeFromStorage(event.oldValue);
          if (!pending || pending.instanceId !== instanceId) throw new Error('Cleanup journal identity mismatch.');
          setRetiredVersionPurges((previous) => ({
            ...previous,
            [instanceId]: {
              pending: false,
              completionUnknown: true,
              reconciliationBaseline: pending.baseline,
              error: 'RECONCILING - Another tab completed or rejected cleanup. Fresh authoritative inventory is required before this control can unlock.',
            },
          }));
        } catch {
          setRetiredVersionPurges((previous) => ({
            ...previous,
            [instanceId]: {
              pending: false,
              completionUnknown: true,
              error: 'PERSISTED CLEANUP LOCK REMOVAL INVALID - Do not retry this destructive action.',
            },
          }));
        }
      }
      void refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || !event.key?.startsWith(INSTANCE_UPDATE_STORAGE_PREFIX)) return;
      const instanceId = event.key.slice(INSTANCE_UPDATE_STORAGE_PREFIX.length);
      if (!PUBLIC_INSTANCE_ID.test(instanceId)) return;
      if (event.newValue !== null) {
        try {
          const pending = pendingInstanceUpdateFromStorage(event.newValue);
          if (!pending || pending.instanceId !== instanceId) throw new Error('Persisted update identity mismatch.');
          setInstanceUpdates((previous) => ({
            ...previous,
            [instanceId]: {
              loading: false,
              update: pending.plan,
              completionUnknown: true,
              error: `COMPLETION UNKNOWN - Another tab submitted this update ${new Date(pending.submittedAt).toLocaleString()}. Do not retry; refreshing authoritative inventory.`,
            },
          }));
        } catch {
          setInstanceUpdates((previous) => ({
            ...previous,
            [instanceId]: {
              loading: false,
              completionUnknown: true,
              error: 'PERSISTED UPDATE LOCK INVALID - Do not retry this update.',
            },
          }));
        }
      } else {
        setInstanceUpdates((previous) => ({
          ...previous,
          [instanceId]: {
            loading: true,
            completionUnknown: true,
            error: 'RECONCILING - Another tab finished handling the update request. Fresh authoritative status is required before controls unlock.',
          },
        }));
      }
      updateFingerprint.current = '';
      void refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh]);

  useEffect(() => {
    if (!deviceFlow) {
      setDeviceClock(0);
      return;
    }
    setDeviceClock(Date.now());
    const timer = window.setInterval(() => setDeviceClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [deviceFlow]);

  useEffect(() => {
    const flow = deviceFlow;
    if (!flow || !devicePollingEnabled || !['pending', 'slow_down'].includes(flow.status)) return;

    devicePollAbort.current?.abort();
    const controller = new AbortController();
    devicePollAbort.current = controller;
    let timer: number | undefined;
    const poll = async () => {
      if (controller.signal.aborted) return;
      if (Date.now() >= Date.parse(flow.expiry)) {
        setDeviceFlow((current) => current?.flowId === flow.flowId ? { ...current, status: 'expired' } : current);
        setDevicePollingEnabled(false);
        setAccountMessageError(true);
        setAccountMessage('This Microsoft device code expired. Start a new sign-in.');
        return;
      }
      try {
        const envelope = await api<DeviceFlowEnvelope>(
          `/api/minecraft/account/device/${encodeURIComponent(flow.flowId)}/poll`,
          { method: 'POST', signal: controller.signal },
        );
        const nextFlow = flowFromEnvelope(envelope);
        if (nextFlow.flowId !== flow.flowId) throw new Error('The local agent returned a mismatched device sign-in flow.');
        if (controller.signal.aborted) return;
        if (nextFlow.status === 'complete') {
          const accountEnvelope = await api<AccountEnvelope>('/api/minecraft/account', { signal: controller.signal });
          const nextAccount = accountFromEnvelope(accountEnvelope);
          if (!nextAccount.signedIn) throw new Error('Microsoft sign-in completed without a usable Minecraft account session.');
          if (controller.signal.aborted) return;
          setAccount(nextAccount);
          setDeviceFlow(null);
          setDevicePollingEnabled(false);
          setAccountMessageError(false);
          setAccountMessage(`Minecraft profile ${nextAccount.account?.name ?? 'connected'} is signed in.`);
          return;
        }
        setDeviceFlow((current) => (
          current
          && current.flowId === nextFlow.flowId
          && current.status === nextFlow.status
          && current.expiry === nextFlow.expiry
            ? current
            : nextFlow
        ));
        if (['declined', 'expired', 'failed'].includes(nextFlow.status)) {
          setDevicePollingEnabled(false);
          setAccountMessageError(true);
          setAccountMessage(nextFlow.status === 'declined'
            ? 'Microsoft sign-in was declined. Start a new device-code sign-in when ready.'
            : nextFlow.status === 'expired'
              ? 'This Microsoft device code expired. Start a new sign-in.'
              : 'Microsoft device-code sign-in failed safely. Start a new sign-in to retry.');
          return;
        }
        timer = window.setTimeout(() => void poll(), nextFlow.status === 'slow_down' ? 10_000 : 5_000);
      } catch (error) {
        if (controller.signal.aborted) return;
        setDevicePollingEnabled(false);
        setAccountMessageError(true);
        setAccountMessage(failureOf(error).message);
      }
    };
    timer = window.setTimeout(() => void poll(), flow.status === 'slow_down' ? 10_000 : 1_500);
    return () => {
      controller.abort();
      if (devicePollAbort.current === controller) devicePollAbort.current = null;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [deviceFlow, devicePollingEnabled]);

  const provisionManagedClient = async () => {
    if (clientProvisioning) return;
    setClientProvisioning(true);
    setClientMessageError(false);
    setClientMessage('Installing the pinned Family AI client, Fabric, assets, libraries, natives, bridge, Baritone, and managed Java runtime...');
    try {
      const envelope = await api<ManagedClientEnvelope>('/api/minecraft/client/provision', { method: 'POST' });
      const nextClient = clientFromEnvelope(envelope);
      if (!nextClient.installed) throw new Error('Managed client installation finished without a verified install.');
      setManagedClient(nextClient);
      setClientMessage(`Managed Minecraft ${nextClient.minecraftVersion ?? 'client'} installed and integrity verified.`);
      await refresh();
    } catch (error) {
      setClientMessageError(true);
      setClientMessage(failureOf(error).message);
    } finally {
      setClientProvisioning(false);
    }
  };

  const saveAppRegistration = async () => {
    const clientId = appClientId.trim().toLowerCase();
    if (!PUBLIC_GUID.test(clientId)) {
      setAccountMessageError(true);
      setAccountMessage('Enter a valid Microsoft public Application (client) ID GUID. Client secrets are never accepted.');
      return;
    }
    if (account?.configured && !window.confirm('Replace the Microsoft app registration? This signs out the managed Minecraft account and deletes its current local encrypted refresh token/session.')) return;
    devicePollAbort.current?.abort();
    devicePollAbort.current = null;
    setDevicePollingEnabled(false);
    setDeviceFlow(null);
    setAccountBusy(true);
    setAccountMessageError(false);
    setAccountMessage('Saving the public Microsoft application identifier locally...');
    try {
      const envelope = await api<AccountEnvelope>('/api/minecraft/account/registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      const nextAccount = accountFromEnvelope(envelope);
      setAccount(nextAccount);
      setAppClientId('');
      setDeviceFlow(null);
      setDevicePollingEnabled(false);
      setAccountMessage('Public app registration saved. No client secret was requested or stored.');
    } catch (error) {
      setAccountMessageError(true);
      setAccountMessage(failureOf(error).message);
    } finally {
      setAccountBusy(false);
    }
  };

  const startDeviceSignIn = async () => {
    if (accountBusy || !account?.configured) return;
    devicePollAbort.current?.abort();
    setAccountBusy(true);
    setAccountMessageError(false);
    setAccountMessage('Requesting a one-time Microsoft device code...');
    try {
      const envelope = await api<DeviceFlowEnvelope>('/api/minecraft/account/device/start', { method: 'POST' });
      const flow = flowFromEnvelope(envelope);
      if (!['pending', 'slow_down'].includes(flow.status) || Date.parse(flow.expiry) <= Date.now()) {
        throw new Error('The local agent returned an unusable Microsoft device code.');
      }
      setDeviceFlow(flow);
      setDevicePollingEnabled(true);
      setAccountMessage('Open the verified Microsoft address, enter the code, and approve the Minecraft account. Mastermind will check automatically.');
    } catch (error) {
      setDeviceFlow(null);
      setDevicePollingEnabled(false);
      setAccountMessageError(true);
      setAccountMessage(failureOf(error).message);
    } finally {
      setAccountBusy(false);
    }
  };

  const refreshMicrosoftSession = async () => {
    if (accountBusy || !account?.signedIn) return;
    setAccountBusy(true);
    setAccountMessageError(false);
    setAccountMessage('Refreshing the encrypted Microsoft session...');
    try {
      const envelope = await api<AccountEnvelope>('/api/minecraft/account/refresh', { method: 'POST' });
      const nextAccount = accountFromEnvelope(envelope);
      if (!nextAccount.signedIn) throw new Error('Microsoft requires a new device-code sign-in.');
      setAccount(nextAccount);
      setAccountMessage(`Minecraft profile ${nextAccount.account?.name ?? 'connected'} is ready.`);
    } catch (error) {
      setAccountMessageError(true);
      setAccountMessage(failureOf(error).message);
      void refresh();
    } finally {
      setAccountBusy(false);
    }
  };

  const signOutMicrosoft = async () => {
    if (accountBusy || !account?.signedIn) return;
    if (!window.confirm('Sign out this managed Minecraft account and delete its local encrypted refresh token?')) return;
    devicePollAbort.current?.abort();
    setAccountBusy(true);
    setAccountMessageError(false);
    setAccountMessage('Signing out and clearing the local encrypted Minecraft account record...');
    try {
      const envelope = await api<AccountEnvelope>('/api/minecraft/account/signout', { method: 'POST' });
      const nextAccount = accountFromEnvelope(envelope);
      if (nextAccount.signedIn) throw new Error('The local agent did not confirm sign-out.');
      setAccount(nextAccount);
      setDeviceFlow(null);
      setDevicePollingEnabled(false);
      setAccountMessage('Microsoft Minecraft account signed out.');
    } catch (error) {
      setAccountMessageError(true);
      setAccountMessage(failureOf(error).message);
    } finally {
      setAccountBusy(false);
    }
  };

  const toggleDevicePolling = () => {
    if (!deviceFlow || !['pending', 'slow_down'].includes(deviceFlow.status)) return;
    if (devicePollingEnabled) {
      devicePollAbort.current?.abort();
      setDevicePollingEnabled(false);
      setAccountMessage('Automatic sign-in checks are paused. The displayed code remains valid until its expiry time.');
    } else {
      setAccountMessageError(false);
      setDevicePollingEnabled(true);
      setAccountMessage('Automatic sign-in checks resumed.');
    }
  };

  const operate = async (instance: ManagedInstance, action: 'start' | 'stop') => {
    setBusyInstance(instance.id);
    try {
      await api(`/api/minecraft/instances/${encodeURIComponent(instance.id)}/${action}`, { method: 'POST' });
      await refresh();
    } catch (error) {
      setFailure(failureOf(error));
    } finally {
      setBusyInstance(null);
    }
  };

  const loadLogs = async (instance: ManagedInstance) => {
    setLogsFor(instance.id);
    setLogs([]);
    setLogsMessage('Loading recent logs...');
    try {
      const nextLogs = await api<LogsEnvelope>(`/api/minecraft/instances/${encodeURIComponent(instance.id)}/logs?limit=200`);
      const entries = Array.isArray(nextLogs.logs) ? nextLogs.logs : [];
      setLogs(entries);
      setLogsMessage(entries.length ? '' : 'No log entries yet.');
    } catch (error) {
      const nextFailure = failureOf(error);
      setLogsMessage(nextFailure.message);
      if (nextFailure.status === 401 || nextFailure.status === 403 || nextFailure.status === 503 || nextFailure.status === 0) {
        setFailure(nextFailure);
      }
    }
  };

  const applyInstanceUpdate = async (instance: ManagedInstance, update: InstanceUpdateStatus) => {
    const versionApproval = update.requiresApproval === true;
    const storageKey = instanceUpdateStorageKey(instance.id);
    const journal: PendingInstanceUpdate = {
      instanceId: instance.id,
      submittedAt: new Date().toISOString(),
      plan: update,
    };
    setBusyInstance(instance.id);
    setInstanceUpdates((previous) => ({ ...previous, [instance.id]: { loading: true, update } }));
    try {
      await withInstanceUpdateLock(instance.id, async () => {
        const existingRaw = window.localStorage.getItem(storageKey);
        if (existingRaw !== null) {
          pendingInstanceUpdateFromStorage(existingRaw);
          throw new ApiError(409, 'UPDATE_OPERATION_PENDING', 'A prior update request still requires authoritative reconciliation.');
        }
        try { window.localStorage.setItem(storageKey, JSON.stringify(journal)); }
        catch { throw new ApiError(409, 'BROWSER_JOURNAL_UNAVAILABLE', 'The server-update journal could not be persisted; no request was submitted.'); }
        setInstanceUpdates((previous) => ({
          ...previous,
          [instance.id]: { loading: true, update, completionUnknown: true },
        }));
        try {
          const rawResponse = await api<unknown>(`/api/minecraft/instances/${encodeURIComponent(instance.id)}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(versionApproval
              ? { approval: { planId: update.planId, minecraftVersionChange: true } }
              : {}),
          });
          const response = updateActionEnvelopeFromUnknown(rawResponse, instance.id);
          window.localStorage.removeItem(storageKey);
          if (response.updateResult.action === 'approval-required') {
            throw new ApiError(409, 'UPDATE_APPROVAL_REQUIRED', 'The catalog plan changed before approval was applied. Check updates again.');
          }
        } catch (error) {
          const failure = failureOf(error);
          if (error instanceof ApiError && INSTANCE_UPDATE_NO_COMMIT_CODES.has(failure.code)) {
            window.localStorage.removeItem(storageKey);
          }
          throw error;
        }
      });
      updateFingerprint.current = '';
      await refresh();
      await checkInstanceUpdates([instance]);
    } catch (error) {
      const failure = failureOf(error);
      const completionUnknown = window.localStorage.getItem(storageKey) !== null
        || failure.code === 'UPDATE_OPERATION_PENDING'
        || failure.code === 'UPDATE_OPERATION_COMPLETION_UNKNOWN'
        || !(error instanceof ApiError)
        || !INSTANCE_UPDATE_NO_COMMIT_CODES.has(failure.code);
      setInstanceUpdates((previous) => ({
        ...previous,
        [instance.id]: {
          loading: false,
          update,
          completionUnknown,
          error: completionUnknown
            ? 'COMPLETION UNKNOWN - Do not retry this update. Every tab remains locked until authoritative managed inventory proves the outcome.'
            : updateFailureMessage(error),
        },
      }));
      if (completionUnknown) await refresh().catch(() => undefined);
    } finally {
      setBusyInstance(null);
    }
  };

  const purgeRetiredVersion = async (instance: ManagedInstance) => {
    const updateStatus = instance.updateStatus;
    if (instance.status !== 'stopped' || updateStatus?.state !== 'verified' || updateStatus.backupAvailable !== true) {
      return;
    }
    if (typeof updateStatus.previousMinecraftVersion !== 'string'
      || typeof updateStatus.targetMinecraftVersion !== 'string'
      || typeof updateStatus.verifiedAt !== 'string') {
      setRetiredVersionPurges((previous) => ({
        ...previous,
        [instance.id]: { pending: false, error: 'Verified retained-version identity is incomplete. Refresh before using permanent cleanup.' },
      }));
      return;
    }
    const retiredVersion = updateStatus.previousMinecraftVersion;
    const currentVersion = updateStatus.targetMinecraftVersion;
    const confirmed = window.confirm(
      `Permanently delete the rollback backup for Minecraft ${retiredVersion} and its obsolete version-specific caches? `
      + `This cannot be undone. The current Minecraft ${currentVersion} server and world will be retained.`,
    );
    if (!confirmed) return;

    const journal: PendingRetiredVersionPurge = {
      instanceId: instance.id,
      submittedAt: new Date().toISOString(),
      baseline: {
        previousMinecraftVersion: retiredVersion,
        targetMinecraftVersion: currentVersion,
        verifiedAt: updateStatus.verifiedAt,
      },
    };
    const storageKey = retiredPurgeStorageKey(instance.id);
    setBusyInstance(instance.id);
    try {
      await withRetiredPurgeLock(instance.id, async () => {
        const existingRaw = window.localStorage.getItem(storageKey);
        if (existingRaw !== null) {
          pendingRetiredPurgeFromStorage(existingRaw);
          throw new ApiError(409, 'RETIRED_VERSION_PURGE_PENDING', 'A prior cleanup request still requires authoritative reconciliation.');
        }
        try { window.localStorage.setItem(storageKey, JSON.stringify(journal)); }
        catch { throw new ApiError(409, 'BROWSER_JOURNAL_UNAVAILABLE', 'The destructive cleanup journal could not be persisted; no request was submitted.'); }
        setRetiredVersionPurges((previous) => ({
          ...previous,
          [instance.id]: {
            pending: true,
            completionUnknown: true,
            reconciliationBaseline: journal.baseline,
          },
        }));
        try {
          const rawResponse = await api<unknown>(
            `/api/minecraft/instances/${encodeURIComponent(instance.id)}/retired-version/purge`,
            { method: 'POST' },
          );
          const cleanup = retiredVersionPurgeEnvelopeFromUnknown(rawResponse, instance.id);
          window.localStorage.removeItem(storageKey);
          setRetiredVersionPurges((previous) => ({
            ...previous, [instance.id]: { pending: false, result: cleanup },
          }));
        } catch (error) {
          const failure = failureOf(error);
          if (error instanceof ApiError && RETIRED_PURGE_NO_COMMIT_CODES.has(failure.code)) {
            window.localStorage.removeItem(storageKey);
          }
          throw error;
        }
      });
      updateFingerprint.current = '';
      await refresh();
    } catch (error) {
      const failure = failureOf(error);
      const completionUnknown = failure.code === 'RETIRED_VERSION_PURGE_PENDING'
        || failure.code === 'RETIRED_VERSION_PURGE_COMPLETION_UNKNOWN'
        || !(error instanceof ApiError)
        || !RETIRED_PURGE_NO_COMMIT_CODES.has(failure.code);
      setRetiredVersionPurges((previous) => ({
        ...previous, [instance.id]: {
          pending: false,
          completionUnknown,
          reconciliationBaseline: completionUnknown ? journal.baseline : undefined,
          error: completionUnknown
            ? 'COMPLETION UNKNOWN - Do not retry. Every tab remains locked until authoritative instance inventory proves the retained rollback payload is no longer available.'
            : updateFailureMessage(error),
        },
      }));
      if (completionUnknown) await refresh().catch(() => undefined);
    } finally {
      setBusyInstance(null);
    }
  };

  const enableHomeLan = async () => {
    if (!selectedLanInstance || !selectedLanJavaPort || lanActionActive) return;
    setLanActionActive(true);
    setLanActionMessage('LAN access requested. Approve the single Windows UAC prompt to add private-home-network rules.');
    try {
      const response = await api<LanFirewallEnvelope>(
        `/api/minecraft/instances/${encodeURIComponent(selectedLanInstance.id)}/lan/enable`,
        { method: 'POST' },
      );
      const status = response.lanFirewall?.status;
      if (status === 'completed') {
        setLanActionMessage('Home LAN firewall rules are enabled for the selected server. PS4 discovery still needs to be confirmed on the console.');
      } else if (status === 'cancelled') {
        setLanActionMessage('Windows UAC was cancelled. No LAN firewall change was confirmed.');
      } else if (status === 'pending') {
        setLanActionMessage('Windows is still completing the elevated firewall action. Completion is unknown; Mastermind will refresh the read-only LAN status before you retry.');
      } else {
        setLanActionMessage('Windows could not confirm the home LAN firewall rules.');
      }
    } catch (error) {
      setLanActionMessage(failureOf(error).message);
    } finally {
      setLanActionActive(false);
      await refresh();
    }
  };

  const operateCompanion = async (action: 'start' | 'stop') => {
    if (companionBusy) return;
    setCompanionBusy(true);
    setCompanionMessage(action === 'start' ? 'Starting the managed Family AI client...' : 'Requesting a safe companion shutdown...');
    try {
      const response = await api<CompanionEnvelope>(`/api/minecraft/companion/${action}`, { method: 'POST' });
      setCompanion(response.companion ?? null);
      setCompanionMessage(action === 'start' ? 'The managed client is starting.' : 'The managed client stopped safely.');
      await refresh();
    } catch (error) {
      setCompanionMessage(failureOf(error).message);
    } finally {
      setCompanionBusy(false);
    }
  };

  const dispatchCompanionAction = async (action: Record<string, unknown>, timeoutMs?: number) => {
    if (companionBusy) return;
    setCompanionBusy(true);
    setCompanionMessage('Sending one typed action to the Family AI client...');
    try {
      const response = await api<CompanionActionEnvelope>('/api/minecraft/companion/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(timeoutMs ? { timeoutMs } : {}) }),
      });
      setCompanionMessage(response.action?.actionId
        ? `${response.action.kind ?? 'Action'} accepted as ${response.action.actionId}.`
        : 'The companion action was accepted.');
      await refresh();
    } catch (error) {
      setCompanionMessage(failureOf(error).message);
    } finally {
      setCompanionBusy(false);
    }
  };

  const cancelCompanionAction = async () => {
    const actionId = companion?.bridge?.activeAction?.actionId;
    if (!actionId || companionBusy) return;
    setCompanionBusy(true);
    setCompanionMessage('Cancelling the active companion action...');
    try {
      const response = await api<CompanionCancellationEnvelope>(
        `/api/minecraft/companion/actions/${encodeURIComponent(actionId)}/cancel`,
        { method: 'POST' },
      );
      setCompanionMessage(response.cancellation?.alreadyTerminal
        ? 'The action had already finished.'
        : response.cancellation?.alreadyRequested
          ? 'Cancellation was already requested.'
          : 'Cancellation was sent to the companion.');
      await refresh();
    } catch (error) {
      setCompanionMessage(failureOf(error).message);
    } finally {
      setCompanionBusy(false);
    }
  };

  const provision = async () => {
    const id = instanceId.trim();
    const name = displayName.trim();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(id)) {
      setProvisionError(true);
      setProvisionMessage('Instance ID must use lowercase letters, numbers, and hyphens.');
      return;
    }
    if (!name) {
      setProvisionError(true);
      setProvisionMessage('A display name is required.');
      return;
    }
    if (!eulaAccepted) {
      setProvisionError(true);
      setProvisionMessage('You must accept the Minecraft EULA before Mastermind can provision a server.');
      return;
    }

    setProvisioning(true);
    setProvisionError(false);
    setProvisionMessage('Resolving a metadata-compatible Minecraft, Fabric, Geyser, and Floodgate stack...');
    try {
      await api('/api/minecraft/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'family-server',
          instanceId: id,
          displayName: name,
          memoryMb: Math.min(32768, Math.max(1024, Math.round(memoryMb))),
          eulaAccepted: true,
        }),
      });
      setProvisionMessage(`Server “${name}” was provisioned and is ready to start.`);
      await refresh();
    } catch (error) {
      const nextFailure = failureOf(error);
      setProvisionError(true);
      setProvisionMessage(nextFailure.message);
      if (nextFailure.status === 401 || nextFailure.status === 403 || nextFailure.status === 503 || nextFailure.status === 0) {
        setFailure(nextFailure);
      }
    } finally {
      setProvisioning(false);
    }
  };

  const boundary = failure ? boundaryCopy(failure) : null;
  const connected = !failure && overview?.service?.online === true;
  const accountView = accountSummary(account);
  const clientInstalled = managedClient?.installed === true && managedClient.integrity === 'verified';
  const clientStatusColor = clientProvisioning
    ? C.gold
    : clientInstalled
      ? C.green
      : managedClient?.state === 'invalid'
        ? C.red
        : C.dim;
  const clientStatusLabel = clientProvisioning
    ? 'INSTALLING'
    : clientInstalled
      ? 'VERIFIED INSTALL'
      : managedClient === null
        ? 'STATUS NOT LOADED'
      : managedClient?.state === 'invalid'
        ? 'REPAIR REQUIRED'
        : 'NOT INSTALLED';
  const managedClientTarget = managedClient?.targetInstanceId;
  const familyServerRunning = managedClientTarget === 'family-server'
    && instances.some((instance) => (
      instance.id === managedClientTarget
      && instance.projectId === 'family-server'
      && instance.kind === 'server'
      && instance.status === 'running'
    ));
  const companionTargetMatches = companion?.targetInstanceId === undefined || companion.targetInstanceId === 'family-server';
  const companionLifecycleState = companion?.lifecycle?.state ?? 'stopped';
  const worldCompanionLifecycleState = companion?.lifecycle?.state ?? 'unknown';
  const worldCompanionBridgeState = companion?.bridge?.state ?? 'unknown';
  const companionBridgeReady = companion?.bridge?.ready === true || companion?.bridge?.state === 'ready';
  const companionActive = ['starting', 'running', 'stopping'].includes(companionLifecycleState);
  const companionKillSwitch = companion?.bridge?.killSwitch === true || companion?.bridge?.snapshot?.safety?.killSwitch === true;
  const companionStatusColor = companionKillSwitch || ['failed', 'orphaned'].includes(companionLifecycleState)
    ? C.red
    : companionBridgeReady
      ? C.green
      : companionActive
        ? C.gold
        : C.dim;
  const companionStatusLabel = companionKillSwitch
    ? 'LOCAL STOP LATCHED'
    : companionBridgeReady
      ? 'READY IN FAMILY SERVER'
      : companionActive
        ? (companion?.bridge?.state ?? companionLifecycleState).toUpperCase()
        : companionLifecycleState.toUpperCase();
  const companionCapabilities = new Set(companion?.bridge?.capabilities ?? []);
  const companionPosition = companion?.bridge?.snapshot?.player?.position;
  const companionPositionText = companionPosition
    && [companionPosition.x, companionPosition.y, companionPosition.z].every((value) => typeof value === 'number')
    ? `${Number(companionPosition.x).toFixed(1)}, ${Number(companionPosition.y).toFixed(1)}, ${Number(companionPosition.z).toFixed(1)}`
    : 'NO FRESH POSITION';
  const launchBlockedReason = !clientInstalled
    ? 'Install and verify the managed client first.'
    : account?.signedIn !== true || account.sessionReady !== true
      ? 'Complete Microsoft Minecraft sign-in and refresh a usable session first.'
      : !familyServerRunning
        ? 'Start the Family Server first.'
        : !companionTargetMatches
          ? 'The companion target does not match the managed Family Server.'
        : companion?.launchAvailable !== true
          ? 'The local agent has not confirmed launch readiness.'
          : '';
  const deviceExpiryMs = deviceFlow ? Date.parse(deviceFlow.expiry) : 0;
  const deviceSecondsRemaining = deviceFlow ? Math.max(0, Math.ceil((deviceExpiryMs - (deviceClock || Date.now())) / 1_000)) : 0;
  const deviceRemainingText = `${Math.floor(deviceSecondsRemaining / 60)}:${String(deviceSecondsRemaining % 60).padStart(2, '0')}`;
  const running = overview?.counts?.running ?? instances.filter((item) => item.status === 'running').length;
  const failed = overview?.counts?.failed ?? instances.filter((item) => item.status === 'failed').length;
  const familyVersion = catalog?.minecraftVersion ?? instances[0]?.minecraftVersion ?? 'CHECKING';
  const stackResolved = Boolean(
    catalog?.minecraftVersion
    && catalog?.loader?.version
    && catalog?.components?.fabricApi?.version
    && catalog?.components?.geyser?.version
    && catalog?.components?.floodgate?.version,
  );
  const managedJavaMajor = catalog?.java?.requiredMajor ?? catalog?.requiredJavaMajor;
  const selectedBackupInstance = instances.find((instance) => instance.id === backupInstanceId) ?? instances[0] ?? null;
  const selectedLanInstance = instances.find((instance) => instance.id === lanInstanceId) ?? instances[0] ?? null;
  const selectedLanJavaPort = selectedLanInstance?.javaPort ?? selectedLanInstance?.serverPort;
  const agentSupportsFamilyV2 = Number(overview?.service?.version ?? 0) >= 2;
  const lanPortStatus = lan?.portStatus ?? 'unknown';
  const geyserListening = lanPortStatus === 'managed' || lanPortStatus === 'geyser-listening';
  const lanStatusColor = lanPortStatus === 'occupied' ? C.red : geyserListening ? C.green : C.gold;
  const lanStatusLabel = lanPortStatus === 'occupied'
    ? 'UDP PORT CONFLICT'
    : geyserListening
      ? 'GEYSER LISTENING'
    : lanPortStatus === 'available'
      ? 'AVAILABLE TO GEYSER'
      : 'PORT STATUS UNKNOWN';
  const lanBedrockPort = lan?.bedrockPort ?? selectedLanInstance?.bedrockPort ?? 19132;
  const lanOwner = lan?.owner?.processName
    ? `${lan.owner.processName}${lan.owner.pid ? ` (PID ${lan.owner.pid})` : ''}`
    : lan?.owner?.pid
      ? `PID ${lan.owner.pid}`
      : 'another process';

  return (
    <div style={{ color: '#d9ffff', display: 'flex', flexDirection: 'column', fontFamily: body, gap: 12, height: '100%', overflowY: 'auto' }}>
      <div style={{ alignItems: 'flex-start', display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between', minWidth: 0 }}>
        <div>
          <div style={{ color: C.cyan, fontFamily: mono, fontSize: 12, letterSpacing: 2, textShadow: `0 0 7px ${C.cyan}` }}>
            FAMILY SERVER · COMMAND CENTER
          </div>
          <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.5, marginTop: 5 }}>
            Metadata-compatible Fabric, Geyser, and Floodgate stack, isolated from the version-pinned 2b2t project.
          </div>
        </div>
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {overview?.service?.version && <Badge>AGENT v{overview.service.version}</Badge>}
          <Badge color={connected ? C.green : refreshing && !failure ? C.gold : C.red}>
            {connected ? 'LOCAL AGENT ONLINE' : refreshing && !failure ? 'CONNECTING' : 'LOCAL AGENT OFFLINE'}
          </Badge>
        </div>
      </div>

      {boundary && (
        <section style={{ ...panel, background: `${failure?.code === 'LOCAL_CONTROL_REQUIRED' ? C.gold : C.red}0d`, borderColor: `${failure?.code === 'LOCAL_CONTROL_REQUIRED' ? C.gold : C.red}55` }} aria-live="polite">
          <div style={{ color: failure?.code === 'LOCAL_CONTROL_REQUIRED' ? C.gold : C.red, fontFamily: mono, fontSize: 11, letterSpacing: 1.5 }}>{boundary.title}</div>
          <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.6, marginTop: 7 }}>{boundary.detail}</div>
          <div style={{ marginTop: 10 }}><Button color={C.gold} disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'CHECKING...' : 'RETRY CONNECTION'}</Button></div>
        </section>
      )}

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
        <Metric label="MINECRAFT" value={familyVersion} color={stackResolved ? C.green : C.gold} />
        <Metric label="RUNNING" value={running} color={running > 0 ? C.green : C.dim} />
        <Metric label="FAILED" value={failed} color={failed > 0 ? C.red : C.dim} />
        <Metric label="BEDROCK STACK" value={stackResolved ? 'RESOLVED' : 'CHECKING'} color={stackResolved ? C.green : C.gold} />
      </div>

      <section style={{ ...panel, borderColor: `${C.magenta}35` }}>
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
          <div style={{ color: C.magenta, fontFamily: mono, fontSize: 10, letterSpacing: 1.5 }}>FAMILY COMPANION · FOUNDATION</div>
          <Badge color={familyBrain && Object.values(familyBrain.flags).some(Boolean) ? C.gold : C.dim}>
            {familyBrain ? 'RUNTIME DISABLED' : 'STATUS UNAVAILABLE'}
          </Badge>
        </div>
        <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.55, marginTop: 7 }}>
          Computer and The_AlChemist___ have separate typed boundaries. This foundation is visible for review, but it is not installed into the live server and cannot chat, profile players, plan tasks, automate survival, approve changes, or call a model.
        </div>
        {familyBrain ? (
          <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,190px),1fr))', marginTop: 10 }}>
            {FAMILY_BRAIN_FEATURE_NAMES.map((feature) => {
              const state = familyBrain.states[feature];
              const activeFeature = familyBrain.flags[feature];
              const stateColor = activeFeature ? C.gold : state === 'implemented' || state === 'live-verified' ? C.green : C.dim;
              return (
                <div key={feature} style={{ alignItems: 'center', background: 'rgba(0,0,0,0.2)', border: `1px solid ${stateColor}25`, borderRadius: 4, display: 'flex', gap: 7, justifyContent: 'space-between', padding: '7px 8px' }}>
                  <span style={{ color: C.muted, fontSize: 10 }}>{FAMILY_BRAIN_LABELS[feature]}</span>
                  <Badge color={stateColor}>{activeFeature ? 'ENABLED' : state.toUpperCase()}</Badge>
                </div>
              );
            })}
          </div>
        ) : (
          <div role="status" style={{ color: C.gold, fontSize: 10, lineHeight: 1.5, marginTop: 8 }}>{familyBrainMessage}</div>
        )}
      </section>

      <section style={{ ...panel, borderColor: `${stackResolved ? C.green : C.gold}35` }}>
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Badge color={stackResolved ? C.green : C.gold}>{stackResolved ? 'STACK RESOLVED' : 'RESOLVING STACK'}</Badge>
          <span style={{ color: '#e8ffff', fontFamily: mono, fontSize: 10 }}>
            {catalog?.minecraftVersion ? `MC ${catalog.minecraftVersion}` : catalogMessage}
          </span>
          {catalog?.components?.geyser?.version ? <Badge>GEYSER {catalog.components.geyser.version}</Badge> : null}
          {catalog?.components?.floodgate?.version ? <Badge>FLOODGATE {catalog.components.floodgate.version}</Badge> : null}
          {catalog?.components?.fabricApi?.version ? <Badge>FABRIC API {catalog.components.fabricApi.version}</Badge> : null}
          {managedJavaMajor ? <Badge>{catalog?.java?.managed ? 'MANAGED ' : ''}JAVA {managedJavaMajor} REQUIRED</Badge> : null}
        </div>
        <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.55, marginTop: 8 }}>
          Resolved means the catalog metadata declares a matching Minecraft, Fabric, Geyser, and Floodgate set. Runtime readiness still requires a successful server start and clean logs.
        </div>
      </section>

      <section style={panel}>
        <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ color: C.cyan, fontFamily: mono, fontSize: 10, letterSpacing: 1.5 }}>SERVER INSTANCES</div>
          <Button disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'REFRESHING...' : 'REFRESH'}</Button>
        </div>
        {!instances.length && (
          <div style={{ color: C.dim, fontSize: 12, padding: '7px 0' }}>
            {failure ? 'No local inventory is available while the agent is offline.' : 'No servers provisioned yet.'}
          </div>
        )}
        <div style={{ display: 'grid', gap: 8 }}>
          {instances.map((instance) => {
            const color = stateColor(instance.status);
            const active = ['starting', 'running', 'stopping'].includes(instance.status);
            const busy = busyInstance === instance.id;
            const updateView = instanceUpdates[instance.id];
            const updateCopy = updateView?.update ? updateSummary(updateView.update) : null;
            const retiredVersionPurge = retiredVersionPurges[instance.id];
            const retiredVersionPurgeResolved = retiredVersionPurge?.result !== undefined
              || retiredVersionPurge?.reconciledPurged === true;
            const retiredVersionPurgeColor = retiredVersionPurgeResolved
              ? C.green
              : retiredVersionPurge?.reconciledRetained ? C.gold : C.red;
            const canPurgeRetiredVersion = instance.status === 'stopped'
              && instance.updateStatus?.state === 'verified'
              && instance.updateStatus.backupAvailable === true
              && typeof instance.updateStatus.previousMinecraftVersion === 'string'
              && typeof instance.updateStatus.targetMinecraftVersion === 'string'
              && typeof instance.updateStatus.verifiedAt === 'string'
              && retiredVersionPurge?.completionUnknown !== true;
            const canApplyUpdate = !active && !busy && updateView?.completionUnknown !== true && (
              updateView?.update?.state === 'component-update-available'
              || updateView?.update?.state === 'minecraft-update-approval-required'
            );
            const startBlockedByMigration = !agentSupportsFamilyV2
              || !updateView?.update
              || updateView.loading
              || Boolean(updateView.error)
              || updateView.completionUnknown === true
              || updateView.update.requiresApproval === true
              || instance.provisioningStatus === 'legacy-update-required';
            return (
              <div key={instance.id} style={{ alignItems: 'center', background: 'rgba(0,0,0,0.28)', border: `1px solid ${color}35`, borderLeft: `3px solid ${color}`, borderRadius: 6, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', padding: '10px 12px' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#e8ffff', fontWeight: 700 }}>{instance.displayName}</div>
                  <div style={{ color: C.dim, fontFamily: mono, fontSize: 9, marginTop: 3 }}>
                    {instance.id} · MC {instance.minecraftVersion}
                    {(instance.javaPort ?? instance.serverPort) ? ` · JAVA TCP ${instance.javaPort ?? instance.serverPort}` : ''}
                    {instance.bedrockPort ? ` · BEDROCK UDP ${instance.bedrockPort}` : ''}
                    {instance.pid ? ` · PID ${instance.pid}` : ''}
                  </div>
                  {instance.lastError && <div style={{ color: C.red, fontSize: 11, marginTop: 4 }}>{instance.lastError}</div>}
                  <div aria-live="polite" style={{ marginTop: 7 }}>
                    {updateView?.loading ? (
                      <span style={{ color: C.dim, fontFamily: mono, fontSize: 9 }}>CHECKING CATALOG TARGET…</span>
                    ) : updateView?.error ? (
                      <div style={{ color: C.red, fontSize: 10, lineHeight: 1.45 }}>
                        UPDATE STATUS UNAVAILABLE · {updateView.error}
                      </div>
                    ) : updateCopy ? (
                      <div>
                        <Badge color={updateCopy.color}>{updateCopy.label}</Badge>
                        <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.45, marginTop: 5 }}>{updateCopy.detail}</div>
                        {updateView.update?.checkedAt ? <div style={{ color: C.dim, fontFamily: mono, fontSize: 8, marginTop: 3 }}>CHECKED {new Date(updateView.update.checkedAt).toLocaleString()}</div> : null}
                      </div>
                    ) : (
                      <span style={{ color: C.dim, fontFamily: mono, fontSize: 9 }}>UPDATE STATUS NOT CHECKED</span>
                    )}
                  </div>
                  {(canPurgeRetiredVersion || retiredVersionPurge) ? (
                    <div
                      aria-live="polite"
                      style={{
                        background: `${retiredVersionPurgeColor}0a`,
                        border: `1px solid ${retiredVersionPurgeColor}35`,
                        borderRadius: 5,
                        marginTop: 9,
                        padding: '8px 10px',
                      }}
                    >
                      {retiredVersionPurge?.result ? (
                        <div style={{ color: C.green, fontSize: 10, lineHeight: 1.5 }}>
                          RETIRED VERSION PURGED · The rollback backup for Minecraft {retiredVersionPurge.result.retiredMinecraftVersion ?? 'the retired version'} was permanently deleted along with {retiredVersionPurge.result.cacheEntriesPurged ?? 0} obsolete cache {retiredVersionPurge.result.cacheEntriesPurged === 1 ? 'entry' : 'entries'}. Minecraft {retiredVersionPurge.result.currentMinecraftVersion ?? instance.minecraftVersion} remains current.
                        </div>
                      ) : retiredVersionPurge?.reconciledPurged ? (
                        <div style={{ color: C.green, fontSize: 10, lineHeight: 1.5 }}>
                          RETIRED PAYLOAD RECONCILED - Fresh authoritative instance inventory confirms that no retained rollback payload remains. The prior completion-unknown lock has been cleared.
                        </div>
                      ) : retiredVersionPurge?.reconciledRetained ? (
                        <>
                          <div style={{ color: C.gold, fontSize: 10, lineHeight: 1.5 }}>
                            CLEANUP NOT COMMITTED - Fresh authoritative inventory confirms that the same verified rollback payload remains retained. You may submit a new cleanup request.
                          </div>
                          <div style={{ marginTop: 7 }}>
                            <Button
                              color={C.red}
                              disabled={!canPurgeRetiredVersion || busy}
                              onClick={() => void purgeRetiredVersion(instance)}
                            >
                              PERMANENTLY DELETE RETIRED VERSION
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ color: C.red, fontSize: 10, fontWeight: 700, lineHeight: 1.5 }}>
                            PERMANENT ACTION · Delete the Minecraft {instance.updateStatus?.previousMinecraftVersion ?? 'retired-version'} rollback backup and obsolete version-specific caches. This cannot be undone. The current server and world are retained.
                          </div>
                          {retiredVersionPurge?.error ? (
                            <div role="alert" style={{ color: C.red, fontSize: 10, lineHeight: 1.5, marginTop: 6 }}>
                              PURGE FAILED · {retiredVersionPurge.error}
                            </div>
                          ) : null}
                          <div style={{ marginTop: 7 }}>
                            <Button
                              color={C.red}
                              disabled={!canPurgeRetiredVersion || retiredVersionPurge?.pending === true || busy}
                              onClick={() => void purgeRetiredVersion(instance)}
                            >
                              {retiredVersionPurge?.pending ? 'PERMANENTLY DELETING…' : 'PERMANENTLY DELETE RETIRED VERSION'}
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
                <Badge color={color}>{instance.status.toUpperCase()}</Badge>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
                  <Button disabled={busy || active || startBlockedByMigration} color={C.green} onClick={() => void operate(instance, 'start')}>{busy ? 'WORKING...' : 'START'}</Button>
                  <Button disabled={busy || !active || instance.status === 'stopping'} color={C.gold} onClick={() => void operate(instance, 'stop')}>SAFE STOP</Button>
                  <Button color={C.cyan} onClick={() => void loadLogs(instance)}>LOGS</Button>
                  <Button disabled={updateView?.loading === true} color={C.gold} onClick={() => void checkInstanceUpdates([instance])}>{updateView?.loading ? 'CHECKING…' : 'CHECK UPDATES'}</Button>
                  {canApplyUpdate && updateView?.update ? (
                    <Button color={updateView.update.requiresApproval ? C.red : C.gold} onClick={() => void applyInstanceUpdate(instance, updateView.update!)}>
                      {updateView.update.requiresApproval ? 'BACK UP + APPROVE VERSION UPDATE' : 'APPLY COMPONENT UPDATE'}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {instances.find((instance) => instance.id === 'family-server' && instance.projectId === 'family-server' && instance.kind === 'server') ? (
        <ServerAdministrationPanel
          instance={instances.find((instance) => instance.id === 'family-server' && instance.projectId === 'family-server' && instance.kind === 'server')!}
        />
      ) : null}

      {instances.find((instance) => instance.id === 'family-server' && instance.projectId === 'family-server' && instance.kind === 'server') ? (
        <ModrinthModsPanel
          instance={instances.find((instance) => instance.id === 'family-server' && instance.projectId === 'family-server' && instance.kind === 'server')!}
        />
      ) : null}

      {instances.find((instance) => instance.id === 'family-server' && instance.projectId === 'family-server' && instance.kind === 'server') ? (
        <WorldManagementPanel
          instance={instances.find((instance) => instance.id === 'family-server' && instance.projectId === 'family-server' && instance.kind === 'server')!}
          companionLifecycleState={worldCompanionLifecycleState}
          companionBridgeState={worldCompanionBridgeState}
        />
      ) : null}

      {selectedBackupInstance ? (
        <>
          {instances.length > 1 ? (
            <section style={{ ...panel, padding: '10px 14px' }}>
              <label htmlFor="minecraft-backup-instance" style={label}>Backup instance</label>
              <select
                id="minecraft-backup-instance"
                value={selectedBackupInstance.id}
                onChange={(event) => setBackupInstanceId(event.target.value)}
                style={input}
              >
                {instances.map((instance) => <option key={instance.id} value={instance.id}>{instance.displayName} · Minecraft {instance.minecraftVersion}</option>)}
              </select>
            </section>
          ) : null}
          <BackupManagerPanel
            key={selectedBackupInstance.id}
            instance={selectedBackupInstance}
            onInstanceChanged={() => refresh()}
            allowVerificationAndRestore
          />
        </>
      ) : null}

      {logsFor && (
        <section style={panel}>
          <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ color: C.cyan, fontFamily: mono, fontSize: 10, letterSpacing: 1.5 }}>RECENT LOGS · {logsFor}</div>
            <Button onClick={() => { setLogsFor(null); setLogs([]); }}>CLOSE</Button>
          </div>
          <pre style={{ background: 'rgba(0,0,0,0.55)', border: `1px solid ${C.cyan}22`, borderRadius: 5, color: '#b8dedd', fontFamily: 'Cascadia Code, ui-monospace, monospace', fontSize: 10, lineHeight: 1.55, margin: 0, maxHeight: 300, minHeight: 80, overflow: 'auto', padding: 10, whiteSpace: 'pre-wrap' }}>
            {logsMessage || logs.map((entry) => `[${entry.at ?? 'unknown'}] ${(entry.stream ?? 'system').toUpperCase()}  ${entry.line ?? ''}`).join('\n')}
          </pre>
        </section>
      )}

      <section style={{ ...panel, borderColor: `${lanStatusColor}45` }}>
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
          <div style={{ color: lanStatusColor, fontFamily: mono, fontSize: 10, letterSpacing: 1.5 }}>PS4 · LAN PRIMARY SETUP</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            <Badge color={C.gold}>PS4 UNVERIFIED</Badge>
            <Badge color={lanStatusColor}>{lanStatusLabel}</Badge>
          </div>
        </div>
        <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.6, marginTop: 8 }}>
          Start the selected server, keep the PS4 on the same private network, enable the local-only firewall rules as Administrator, then check Minecraft on PS4 under Friends → LAN Games. The command center does not mark this path ready until it has been tested on this network.
        </div>
        {lanPortStatus === 'occupied' && (
          <div role="alert" style={{ background: `${C.red}0d`, border: `1px solid ${C.red}45`, borderRadius: 5, color: C.red, fontSize: 11, lineHeight: 1.55, marginTop: 9, padding: '8px 10px' }}>
            Bedrock UDP {lanBedrockPort} is occupied by {lanOwner}. Geyser cannot own that port until the conflicting process is stopped or reconfigured.
          </div>
        )}
        {lanPortStatus === 'available' && (
          <div style={{ color: C.gold, fontSize: 10, lineHeight: 1.5, marginTop: 8 }}>
            UDP {lanBedrockPort} is available for Geyser. Availability alone does not mean Geyser is running or that PS4 discovery has succeeded.
          </div>
        )}
        {geyserListening && (
          <div style={{ color: C.green, fontSize: 10, lineHeight: 1.5, marginTop: 8 }}>
            Geyser is listening on UDP {lanBedrockPort}. PS4 LAN discovery remains unverified until it is observed on the console.
          </div>
        )}
        {lanPortStatus === 'unknown' && (
          <div style={{ color: C.gold, fontSize: 10, lineHeight: 1.5, marginTop: 8 }}>
            {lanMessage || `Mastermind could not determine ownership of Bedrock UDP ${lanBedrockPort}.`}
          </div>
        )}
        {lan && (
          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8 }}>
            <Badge color={lan.firewallRulesPresent === true ? C.green : C.gold}>
              {lan.firewallRulesPresent === true ? 'FIREWALL RULES FOUND' : lan.firewallRulesPresent === false ? 'FIREWALL RULES NOT FOUND' : 'FIREWALL UNKNOWN'}
            </Badge>
            {lan.localSubnetOnly === true ? <Badge>LOCAL SUBNET ONLY</Badge> : null}
            {lan.localSubnetOnly === false ? <Badge color={C.red}>FIREWALL SCOPE MISMATCH</Badge> : null}
            {lan.addresses?.length ? <span style={{ color: C.dim, fontFamily: mono, fontSize: 9 }}>LAN {lan.addresses.join(', ')}</span> : null}
          </div>
        )}
        {instances.length > 0 && (
          <div style={{ marginTop: 10, maxWidth: 420 }}>
            <label style={label} htmlFor="minecraft-lan-instance">Server for LAN rule</label>
            <select id="minecraft-lan-instance" value={selectedLanInstance?.id ?? ''} onChange={(event) => setLanInstanceId(event.target.value)} style={input}>
              {instances.map((instance) => <option key={instance.id} value={instance.id}>{instance.displayName} · Java {instance.javaPort ?? instance.serverPort ?? 'port unavailable'}</option>)}
            </select>
          </div>
        )}
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: 10 }}>
          <Button
            color={C.green}
            disabled={!agentSupportsFamilyV2 || !selectedLanInstance || !selectedLanJavaPort || lanActionActive}
            onClick={() => void enableHomeLan()}
          >
            {lanActionActive ? 'WAITING FOR WINDOWS...' : 'ENABLE HOME LAN'}
          </Button>
          <span style={{ color: C.dim, fontSize: 10 }}>
            {selectedLanJavaPort ? `Java TCP ${selectedLanJavaPort} + Bedrock UDP 19132` : 'Provision a server with a managed Java port first.'}
          </span>
        </div>
        <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.5, marginTop: 7 }}>
          Windows will show one UAC prompt. Approval adds inbound rules only for the Private profile and LocalSubnet; the browser cannot provide a command, file path, or port.
        </div>
        {lanActionMessage ? <div aria-live="polite" style={{ color: C.gold, fontSize: 10, lineHeight: 1.5, marginTop: 7 }}>{lanActionMessage}</div> : null}
        <div style={{ color: C.dim, fontSize: 10, lineHeight: 1.5, marginTop: 7 }}>
          The helper limits access to the Windows Private profile and local subnet. If direct LAN discovery fails, follow the official Geyser console guide for a BedrockConnect/DNS or LAN-proxy fallback.{' '}
          <a href="https://geysermc.org/wiki/geyser/using-geyser-with-consoles/" target="_blank" rel="noopener noreferrer" style={{ color: C.cyan }}>Official Geyser console guide</a>
        </div>
      </section>

      <div style={{ alignItems: 'start', display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))' }}>
        <section style={panel}>
          <div style={{ color: C.green, fontFamily: mono, fontSize: 10, letterSpacing: 1.5 }}>CREATE FAMILY SERVER</div>
          <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.5, margin: '5px 0 12px' }}>
            The local agent selects a metadata-compatible stack from its catalog. The browser cannot submit a game version, executable path, download URL, or credential.
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void provision(); }}>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,210px),1fr))' }}>
              <div><label style={label} htmlFor="minecraft-instance-id">Instance ID</label><input id="minecraft-instance-id" value={instanceId} onChange={(event) => setInstanceId(event.target.value.toLowerCase())} placeholder="family-server" style={input} /></div>
              <div><label style={label} htmlFor="minecraft-display-name">Display name</label><input id="minecraft-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Family Server" style={input} /></div>
              <div><label style={label}>Release channel</label><div style={{ ...input, color: catalog?.minecraftVersion ? C.green : C.gold }}>LATEST COMPATIBLE · {catalog?.minecraftVersion ?? 'RESOLVING'}</div></div>
              <div><label style={label} htmlFor="minecraft-memory">Memory (MB)</label><input id="minecraft-memory" type="number" min={1024} max={32768} step={512} value={memoryMb} onChange={(event) => setMemoryMb(Number(event.target.value))} style={input} /></div>
            </div>
            <div style={{ alignItems: 'flex-start', color: C.muted, display: 'flex', fontSize: 11, gap: 8, lineHeight: 1.45, marginTop: 12 }}>
              <input id="minecraft-eula" type="checkbox" checked={eulaAccepted} onChange={(event) => setEulaAccepted(event.target.checked)} />
              <label htmlFor="minecraft-eula">I have read and accept the <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noopener noreferrer" style={{ color: C.cyan }}>Minecraft EULA</a> for this server. Mastermind will record that acceptance in the managed instance.</label>
            </div>
            <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
              <Button type="submit" color={C.green} disabled={!!failure || provisioning}>{provisioning ? 'PROVISIONING...' : 'PROVISION SERVER'}</Button>
              {provisionMessage && <span aria-live="polite" style={{ color: provisionError ? C.red : C.green, fontSize: 11 }}>{provisionMessage}</span>}
            </div>
          </form>
        </section>

        <section style={{ ...panel, borderColor: `${companionStatusColor}45` }}>
          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
            <div style={{ color: companionStatusColor, fontFamily: mono, fontSize: 10, letterSpacing: 1.5 }}>FAMILY AI COMPANION</div>
            <Badge color={companionStatusColor}>{companionStatusLabel}</Badge>
          </div>

          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))', marginTop: 10 }}>
            <Metric label="CLIENT" value={clientInstalled ? `MC ${managedClient?.minecraftVersion ?? 'INSTALLED'}` : clientStatusLabel} color={clientStatusColor} />
            <Metric label="FAMILY SERVER" value={familyServerRunning ? 'RUNNING' : 'STOPPED'} color={familyServerRunning ? C.green : C.gold} />
            <Metric label="BRIDGE" value={(companion?.bridge?.state ?? 'OFFLINE').toUpperCase()} color={companionStatusColor} />
            <Metric label="POSITION" value={companionPositionText} color={companionBridgeReady ? C.green : C.dim} />
          </div>

          <div style={{ borderTop: `1px solid ${C.cyan}20`, marginTop: 10, paddingTop: 10 }}>
            <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
              <div style={{ color: C.muted, fontFamily: mono, fontSize: 8, letterSpacing: 1 }}>MANAGED GAME CLIENT</div>
              <Badge color={clientStatusColor}>{clientStatusLabel}</Badge>
            </div>
            <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.55, marginTop: 6 }}>
              One-click local installation downloads about 603 MB and verifies the latest Family Minecraft client, Fabric, Baritone, bridge mod, libraries, assets, natives, and managed Java runtime. It does not modify Modrinth or the separate 2b2t project.
            </div>
            {clientInstalled ? (
              <div style={{ color: C.dim, fontFamily: mono, fontSize: 9, lineHeight: 1.5, marginTop: 6 }}>
                INTEGRITY VERIFIED{managedClient?.loader?.version ? ` · FABRIC ${managedClient.loader.version}` : ''}{managedClient?.requiredJavaMajor ? ` · JAVA ${managedClient.requiredJavaMajor}` : ''}{managedClient?.artifactCount !== undefined ? ` · ${managedClient.artifactCount} ARTIFACTS` : ''}
              </div>
            ) : null}
            <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <Button disabled={clientProvisioning || clientStatusLoading} onClick={() => void refreshClientStatus(true)}>
                {clientStatusLoading ? 'CHECKING...' : managedClient === null ? 'CHECK CLIENT STATUS' : 'REFRESH CLIENT STATUS'}
              </Button>
              <Button
                color={managedClient?.state === 'invalid' ? C.red : C.green}
                disabled={!!failure || clientProvisioning || clientStatusLoading || managedClient === null || clientInstalled || managedClient?.state === 'invalid'}
                onClick={() => void provisionManagedClient()}
              >
                {clientProvisioning ? 'INSTALLING (~603 MB)...' : managedClient?.state === 'invalid' ? 'INSTALL BLOCKED' : 'INSTALL MANAGED CLIENT (~603 MB)'}
              </Button>
              {managedClient?.state === 'invalid' ? (
                <>
                  <Button disabled={clientStatusLoading} onClick={() => void refreshClientStatus(true)}>{clientStatusLoading ? 'CHECKING...' : 'RETRY STATUS'}</Button>
                  <span role="alert" style={{ color: C.red, fontSize: 10, lineHeight: 1.5 }}>
                    The local agent found an unverified or partial managed-client directory and will not overwrite it. Restart the local command center, then retry status. If it remains invalid, stop here: this UI does not expose deletion or recovery.
                  </span>
                </>
              ) : clientMessage ? (
                <span aria-live="polite" role={clientMessageError ? 'alert' : undefined} style={{ color: clientMessageError ? C.red : C.green, fontSize: 10, lineHeight: 1.5 }}>
                  {clientMessage}
                </span>
              ) : null}
            </div>
          </div>

          <div style={{ borderBottom: `1px solid ${C.gold}20`, borderTop: `1px solid ${C.gold}20`, margin: '10px 0', padding: '10px 0' }}>
            <div style={{ color: C.muted, fontFamily: mono, fontSize: 8, letterSpacing: 1 }}>MICROSOFT MINECRAFT ACCOUNT</div>
            <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              <Badge color={accountView.color}>{accountView.label}</Badge>
              <span style={{ color: C.muted, fontSize: 11 }}>{accountView.detail}</span>
              {account?.sessionReady ? <Badge color={C.green}>SESSION READY</Badge> : null}
            </div>

            <details style={{ background: 'rgba(0,0,0,0.22)', border: `1px solid ${C.cyan}25`, borderRadius: 5, marginTop: 9, padding: '7px 9px' }}>
              <summary style={{ color: C.cyan, cursor: 'pointer', fontFamily: mono, fontSize: 9, letterSpacing: 0.8, outlineOffset: 3 }}>
                APP REGISTRATION SETUP
              </summary>
              <div id="minecraft-app-client-id-help" style={{ color: C.muted, fontSize: 10, lineHeight: 1.55, marginTop: 8 }}>
                In Microsoft Entra, create an app registration that supports personal Microsoft accounts and set <strong>Allow public client flows</strong> to <strong>Yes</strong>. Device-code sign-in uses the public Application (client) ID and requires no client secret; this form and proxy reject secret fields. Minecraft Services may still reject a valid but unapproved app registration.
                {' '}<a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer" style={{ color: C.cyan }}>Open official Entra App registrations</a>.
                {account?.configured ? ' Replacing the saved identifier signs out the managed Minecraft account and clears its current encrypted refresh token/session after confirmation.' : ''}
              </div>
              <form onSubmit={(event) => { event.preventDefault(); void saveAppRegistration(); }} style={{ marginTop: 9 }}>
                <label htmlFor="minecraft-app-client-id" style={label}>Public Application (client) ID</label>
                <div style={{ alignItems: 'center', display: 'grid', gap: 7, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,210px),1fr))' }}>
                  <input
                    id="minecraft-app-client-id"
                    aria-describedby="minecraft-app-client-id-help"
                    autoComplete="off"
                    inputMode="text"
                    maxLength={36}
                    placeholder="00000000-0000-4000-8000-000000000000"
                    spellCheck={false}
                    style={{ ...input, fontFamily: mono, fontSize: 11 }}
                    value={appClientId}
                    onChange={(event) => setAppClientId(event.target.value)}
                  />
                  <div><Button type="submit" disabled={accountBusy || !PUBLIC_GUID.test(appClientId.trim())}>SAVE PUBLIC CLIENT ID</Button></div>
                </div>
              </form>
            </details>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 9 }}>
              <Button disabled={accountBusy || account?.configured !== true || account?.signedIn === true} onClick={() => void startDeviceSignIn()}>
                {accountBusy ? 'WORKING...' : 'START DEVICE-CODE SIGN-IN'}
              </Button>
              <Button disabled={accountBusy || account?.signedIn !== true} color={C.green} onClick={() => void refreshMicrosoftSession()}>REFRESH SESSION</Button>
              <Button disabled={accountBusy || account?.signedIn !== true} color={C.red} onClick={() => void signOutMicrosoft()}>SIGN OUT...</Button>
            </div>

            {deviceFlow ? (
              <div style={{ background: `${C.gold}0a`, border: `1px solid ${C.gold}35`, borderRadius: 5, marginTop: 9, padding: '10px 11px' }}>
                <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                  <div style={{ color: C.muted, fontFamily: mono, fontSize: 8, letterSpacing: 1 }}>ONE-TIME MICROSOFT CODE</div>
                  <span role="status" aria-live="polite">
                    <Badge color={deviceSecondsRemaining > 0 && ['pending', 'slow_down'].includes(deviceFlow.status) ? C.gold : deviceFlow.status === 'complete' ? C.green : C.red}>
                      {deviceSecondsRemaining === 0 ? 'EXPIRED' : deviceFlow.status.replace('_', ' ').toUpperCase()}
                    </Badge>
                  </span>
                </div>
                <code aria-label={`Microsoft device code ${deviceFlow.user_code}`} style={{ color: C.gold, display: 'block', fontFamily: mono, fontSize: 22, letterSpacing: 3, marginTop: 8, overflowWrap: 'anywhere' }}>
                  {deviceFlow.user_code}
                </code>
                <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.6, marginTop: 7 }}>
                  Open <a href={deviceFlow.verification_uri} target="_blank" rel="noopener noreferrer" style={{ color: C.cyan }}>{deviceFlow.verification_uri}</a>, enter the code, and approve access. Expires in {deviceRemainingText} at <time dateTime={deviceFlow.expiry}>{new Date(deviceFlow.expiry).toLocaleTimeString()}</time>.
                </div>
                <div style={{ marginTop: 7 }}>
                  <Button disabled={deviceSecondsRemaining === 0 || !['pending', 'slow_down'].includes(deviceFlow.status)} onClick={toggleDevicePolling}>
                    {devicePollingEnabled ? 'PAUSE AUTOMATIC CHECKS' : 'RESUME AUTOMATIC CHECKS'}
                  </Button>
                </div>
              </div>
            ) : null}

            {accountMessage ? (
              <div aria-live="polite" role={accountMessageError ? 'alert' : undefined} style={{ color: accountMessageError ? C.red : C.gold, fontSize: 10, lineHeight: 1.5, marginTop: 8 }}>
                {accountMessage}
              </div>
            ) : null}
          </div>

          <div aria-live="polite" style={{ color: companionKillSwitch ? C.red : C.muted, fontSize: 11, lineHeight: 1.6 }}>
            {companionMessage || (
              companionBridgeReady
                ? `Authenticated bridge connected${companion?.bridge?.client?.bridgeVersion ? ` · v${companion.bridge.client.bridgeVersion}` : ''}. Actions are accepted only with a fresh in-world Family Server snapshot.`
                : 'The bridge and exact process lifecycle are installed in the command center. Managed client installation and Microsoft device-code sign-in must complete before launch.'
            )}
          </div>
          {companion?.bridge?.activeAction ? (
            <div style={{ background: `${C.magenta}0a`, border: `1px solid ${C.magenta}35`, borderRadius: 5, color: C.muted, fontSize: 10, lineHeight: 1.5, marginTop: 9, padding: '8px 10px' }}>
              ACTIVE · {companion.bridge.activeAction.kind ?? 'ACTION'} · {(companion.bridge.activeAction.status ?? 'DISPATCHED').toUpperCase()}
            </div>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 11 }}>
            <Button
              disabled={companionBusy || companionActive || Boolean(launchBlockedReason)}
              color={C.magenta}
              onClick={() => void operateCompanion('start')}
            >
              {companionBusy ? 'WORKING...' : 'LAUNCH COMPANION'}
            </Button>
            <Button disabled={companionBusy || !companionActive} color={C.gold} onClick={() => void operateCompanion('stop')}>SAFE STOP CLIENT</Button>
            <Button disabled={companionBusy || !companion?.bridge?.activeAction?.actionId} color={C.red} onClick={() => void cancelCompanionAction()}>CANCEL ACTION</Button>
            <Button
              disabled={companionBusy || !companionBridgeReady || companionKillSwitch || !companionCapabilities.has('direct.jump')}
              onClick={() => void dispatchCompanionAction({ kind: 'direct.jump', args: {} }, 5_000)}
            >
              TEST JUMP
            </Button>
            <Button
              disabled={companionBusy || !companionBridgeReady || companionKillSwitch || !companionCapabilities.has('direct.moveFor')}
              onClick={() => void dispatchCompanionAction({ kind: 'direct.moveFor', args: { forward: 0.75, strafe: 0, durationMs: 1_000, sprint: false, sneak: false } }, 5_000)}
            >
              STEP FORWARD 1S
            </Button>
          </div>
          {!companionActive && launchBlockedReason ? (
            <div aria-live="polite" style={{ color: C.gold, fontSize: 10, lineHeight: 1.5, marginTop: 8 }}>LAUNCH LOCKED · {launchBlockedReason}</div>
          ) : null}
          <div style={{ color: C.dim, fontSize: 9, lineHeight: 1.5, marginTop: 9 }}>
            The per-launch bridge token, Microsoft session, executable, arguments, and local paths are never sent to this page. F8 on the companion PC is a local emergency stop and cannot be reset here.
          </div>
        </section>
      </div>
    </div>
  );
}
