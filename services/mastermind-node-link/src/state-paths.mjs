import path from 'node:path';

export const MASTERMIND_NODE_CREDENTIAL_VAULT_FILE = 'credential-v1.dpapi.json';
export const MASTERMIND_NODE_DPAPI_SCRIPT_RELATIVE_PATH = Object.freeze([
  'scripts',
  'protect-minecraft-account.ps1',
]);

function absolutePath(value, label) {
  if (typeof value !== 'string' || value.length < 3 || value.includes('\0')
    || (!path.isAbsolute(value) && !path.win32.isAbsolute(value))) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  const pathApi = path.win32.isAbsolute(value) ? path.win32 : path;
  return pathApi.resolve(value);
}

/**
 * Resolve the host-bound node-link state directory. Enrollment credentials are
 * intentionally kept under the current Windows user's LocalAppData so moving
 * the portable game data cannot create or select a second identity vault.
 */
export function resolveMastermindNodeStateRoot(environment = process.env) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    throw new TypeError('A process environment object is required');
  }
  const localAppData = absolutePath(environment.LOCALAPPDATA, 'LOCALAPPDATA');
  const pathApi = path.win32.isAbsolute(localAppData) ? path.win32 : path;
  return pathApi.join(localAppData, 'Mastermind', 'node-link');
}

/** One canonical credential filename shared by the worker and local receiver. */
export function resolveMastermindNodeCredentialVaultFile(stateRoot) {
  const root = absolutePath(stateRoot, 'The node-link state root');
  const pathApi = path.win32.isAbsolute(root) ? path.win32 : path;
  return pathApi.join(root, MASTERMIND_NODE_CREDENTIAL_VAULT_FILE);
}

/** Resolve the fixed DPAPI helper from the verified portable bundle root. */
export function resolveMastermindNodeDpapiScriptFile(bundleRoot) {
  const root = absolutePath(bundleRoot, 'The Mastermind bundle root');
  const pathApi = path.win32.isAbsolute(root) ? path.win32 : path;
  return pathApi.join(root, ...MASTERMIND_NODE_DPAPI_SCRIPT_RELATIVE_PATH);
}
