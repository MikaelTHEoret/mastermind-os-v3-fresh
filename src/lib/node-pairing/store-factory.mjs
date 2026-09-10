import {
  resolveMastermindNodeCredentialVaultFile,
  resolveMastermindNodeDpapiScriptFile,
  resolveMastermindNodeStateRoot,
} from '../../../services/mastermind-node-link/src/state-paths.mjs';
import {
  WindowsDpapiMastermindNodeCredentialStore,
} from '../../../services/mastermind-node-link/src/windows-dpapi-credential-store.mjs';

export function createLocalNodePairingCredentialStore(
  environment = process.env,
  bundleRoot = process.cwd(),
) {
  return new WindowsDpapiMastermindNodeCredentialStore({
    vaultFile: resolveMastermindNodeCredentialVaultFile(
      resolveMastermindNodeStateRoot(environment),
    ),
    dpapiScriptFile: resolveMastermindNodeDpapiScriptFile(bundleRoot),
  });
}
