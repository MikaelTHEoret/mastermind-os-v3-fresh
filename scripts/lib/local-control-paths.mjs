import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function resolveLocalControlPaths({
  launcherUrl,
  realpath = fs.realpath,
} = {}) {
  if (!(launcherUrl instanceof URL) || launcherUrl.protocol !== 'file:') {
    throw new TypeError('launcherUrl must be the file URL for run-local-control.mjs');
  }

  const launcherEntrypoint = await realpath(fileURLToPath(launcherUrl));
  const workspace = await realpath(path.resolve(path.dirname(launcherEntrypoint), '..'));
  const expectedLauncherEntrypoint = path.join(workspace, 'scripts', 'run-local-control.mjs');
  const observedLauncher = path.normalize(launcherEntrypoint);
  const expectedLauncher = path.normalize(expectedLauncherEntrypoint);
  const sameLauncher = process.platform === 'win32'
    ? observedLauncher.toLowerCase() === expectedLauncher.toLowerCase()
    : observedLauncher === expectedLauncher;

  if (!sameLauncher) {
    throw new Error('The local-control launcher must remain at scripts/run-local-control.mjs inside its bundle');
  }

  const require = createRequire(launcherUrl);

  return Object.freeze({
    workspace,
    launcherEntrypoint,
    nextEntrypoint: require.resolve('next/dist/bin/next'),
    nodeLinkEntrypoint: path.join(
      workspace,
      'services',
      'mastermind-node-link',
      'src',
      'run-worker.mjs',
    ),
    agentEntrypoint: path.join(
      workspace,
      'services',
      'minecraft-control-plane',
      'src',
      'agent.mjs',
    ),
  });
}
