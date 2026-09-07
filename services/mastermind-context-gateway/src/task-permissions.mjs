import crypto from 'node:crypto';
import { ContextGatewayError, exactObject, requiredString, stringArray, uuid, projectId } from './validation.mjs';

export const MODULE_OPERATIONS = Object.freeze(['module.generate', 'module.reconstruct', 'module.test', 'module.promote', 'module.rollback', 'module.call']);
export const PURE_MODULE_POLICY = Object.freeze({ isolationProfile: 'windows-lpac-pure-json-v1', effectClass: 'READ_ONLY',
  network: false, childProcesses: false, filesystem: 'staged-inputs-only', codingAgent: false });
const NAME = /^[a-z][a-z0-9_.-]{1,127}$/;
const CAPABILITY = /^[a-z][a-z0-9_.-]{1,179}$/;
const fail = (message) => { throw new ContextGatewayError('INVALID_PERMISSION_SCOPE', message); };

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function permissionDigest(scope) { return crypto.createHash('sha256').update(canonicalJson(scope)).digest('hex'); }

export function windowsScopePath(value, field) {
  requiredString(value, field, 2048);
  const normalized = value.replaceAll('\\', '/');
  if (!/^[A-Za-z]:\//.test(normalized) || normalized.endsWith('/')
    || normalized.slice(3).split('/').some((part) => !part || part === '.' || part === '..'
      || /[<>:"|?*\u0000-\u001f]/.test(part) || /[. ]$/.test(part))) fail(`${field} must be an exact absolute Windows path without traversal or wildcards.`);
  return normalized[0].toUpperCase() + normalized.slice(1);
}

function distinct(values, field, maximum, pattern) {
  const rows = stringArray(values, field, maximum, 180);
  if (!rows.length || rows.some((row) => !pattern.test(row)) || new Set(rows).size !== rows.length) fail(`${field} must be a nonempty exact set.`);
  return rows.sort();
}

export function validatePermissionScope(raw) {
  const scope = exactObject(raw, ['schemaVersion', 'status', 'executionPolicy', 'modules']);
  if (scope.schemaVersion !== 1 || !['active', 'revoked'].includes(scope.status)) fail('Unknown permission scope version or state.');
  if (canonicalJson(scope.executionPolicy) !== canonicalJson(PURE_MODULE_POLICY)) fail('Only the verified pure JSON isolation policy is supported.');
  if (!Array.isArray(scope.modules) || scope.modules.length > 16 || (scope.status === 'active' && !scope.modules.length)) fail('A bounded exact module list is required.');
  const modules = scope.modules.map((rawModule) => {
    const entry = exactObject(rawModule, ['moduleId', 'repositoryRoot', 'candidateRoot', 'operations', 'capabilities']);
    const moduleId = requiredString(entry.moduleId, 'moduleId', 128, NAME);
    const operations = distinct(entry.operations, 'operations', MODULE_OPERATIONS.length, /^module\.[a-z]+$/);
    if (operations.some((operation) => !MODULE_OPERATIONS.includes(operation))) fail('Unknown module operation.');
    const capabilities = distinct(entry.capabilities, 'capabilities', 64, CAPABILITY);
    if (capabilities.some((name) => !name.startsWith(`${moduleId}.`))) fail('Capabilities must use the exact module namespace.');
    return { moduleId, repositoryRoot: windowsScopePath(entry.repositoryRoot, 'repositoryRoot'),
      candidateRoot: windowsScopePath(entry.candidateRoot, 'candidateRoot'), operations, capabilities };
  }).sort((left, right) => left.moduleId.localeCompare(right.moduleId, 'en'));
  if (new Set(modules.map((entry) => entry.moduleId)).size !== modules.length) fail('Each module must have one unambiguous scope.');
  const result = { schemaVersion: 1, status: scope.status, executionPolicy: { ...PURE_MODULE_POLICY }, modules };
  if (Buffer.byteLength(canonicalJson(result), 'utf8') > 32768) fail('Permission scope exceeds its metadata budget.');
  return result;
}

export function permissionRevision(value, name = 'permissionRevision') {
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 0) fail(`${name} must be a non-negative safe revision.`);
  return value;
}
export function permissionGrantRef(taskId, revision, digest) {
  uuid(taskId, 'taskId');
  revision = permissionRevision(revision);
  if (revision < 1 || !/^[a-f0-9]{64}$/.test(digest ?? '')) fail('An installed permission revision and exact digest are required.');
  return `task-grant/${taskId.toLowerCase()}/${revision}/${digest}`;
}

export function validateModuleAuthorization(raw) {
  const input = exactObject(raw, ['taskId', 'project', 'grantRef', 'operation', 'moduleId', 'repositoryRoot', 'entrypoint', 'capabilities', 'isolationProfile']);
  const taskId = uuid(input.taskId, 'taskId');
  const project = projectId(input.project ?? 'mastermind');
  const grantRef = requiredString(input.grantRef, 'grantRef', 200);
  if (!MODULE_OPERATIONS.includes(input.operation)) fail('Unknown module operation.');
  const moduleId = requiredString(input.moduleId, 'moduleId', 128, NAME);
  const capabilities = distinct(input.capabilities, 'capabilities', 64, CAPABILITY);
  return { taskId, project, grantRef, operation: input.operation, moduleId,
    repositoryRoot: windowsScopePath(input.repositoryRoot, 'repositoryRoot'), entrypoint: windowsScopePath(input.entrypoint, 'entrypoint'),
    capabilities, isolationProfile: input.isolationProfile };
}

export function authorizeModuleFromTask(task, input) {
  const denied = (reason) => ({ authorized: false, reason });
  if (!task || task.taskId !== input.taskId || task.project !== input.project) return denied('OWNED_TASK_REQUIRED');
  if (task.state !== 'active') return denied('ACTIVE_TASK_REQUIRED');
  if (!task.permissionScope || !task.permissionScopeSha256) return denied('TASK_PERMISSION_REQUIRED');
  let scope, revision, digest, grantRef;
  try {
    scope = validatePermissionScope(task.permissionScope);
    revision = permissionRevision(task.permissionRevision);
    digest = permissionDigest(scope);
    grantRef = permissionGrantRef(task.taskId, revision, digest);
    if (digest !== task.permissionScopeSha256) return denied('PERMISSION_INTEGRITY_FAILED');
  } catch { return denied('PERMISSION_INTEGRITY_FAILED'); }
  if (scope.status !== 'active') return denied('PERMISSION_REVOKED');
  if (input.grantRef !== grantRef) return denied('PERMISSION_REVISION_CHANGED');
  const entry = scope.modules.find((row) => row.moduleId === input.moduleId);
  if (!entry || !entry.operations.includes(input.operation)) return denied('MODULE_OPERATION_OUTSIDE_SCOPE');
  if (input.isolationProfile !== scope.executionPolicy.isolationProfile) return denied('ISOLATION_PROFILE_REQUIRED');
  if (input.repositoryRoot.toLowerCase() !== entry.repositoryRoot.toLowerCase()
    || !input.entrypoint.toLowerCase().startsWith(entry.candidateRoot.toLowerCase() + '/')) return denied('MODULE_PATH_OUTSIDE_SCOPE');
  if (canonicalJson(input.capabilities) !== canonicalJson(entry.capabilities)) return denied('EXACT_CAPABILITIES_REQUIRED');
  return { authorized: true, grantRef, permissionRevision: revision, scopeSha256: digest,
    operation: input.operation, moduleId: input.moduleId, executionPolicy: scope.executionPolicy,
    requiresHostPathResolution: true };
}
