import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const CONFIRMATION = 'UPDATE FAMILY CLIENT RESPAWN';
const BRIDGE_PATH = 'mods/family-agent-bridge-0.1.0.jar';
const PROVIDER_PATH = 'mods/family-agent-baritone-provider-0.1.0.jar';
const PROFILE_PATH = 'versions/fabric-loader-0.19.3-26.2/fabric-loader-0.19.3-26.2.json';

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function inside(root, target) { return target.startsWith(`${root}${path.sep}`); }
async function regularFile(target) {
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe managed file: ${target}`);
}
function oneArtifact(manifest, relativePath) {
  const matches = manifest.artifacts?.filter((item) => item?.relativePath === relativePath) ?? [];
  if (matches.length !== 1) throw new Error(`Manifest did not contain one ${relativePath} record`);
  return matches[0];
}
async function writeNew(target, bytes) {
  const handle = await fs.open(target, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}

if (process.argv[2] !== CONFIRMATION) throw new Error(`Exact confirmation required: ${CONFIRMATION}`);
if (!process.env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is unavailable');

const workspace = path.resolve(import.meta.dirname, '..');
const managedRoot = path.resolve(process.env.LOCALAPPDATA, 'Mastermind', 'minecraft', 'projects', 'family-server');
const clientRoot = path.resolve(managedRoot, 'clients', 'family-ai-client');
const privateRoot = path.resolve(managedRoot, 'private');
const targets = {
  bridge: path.resolve(clientRoot, BRIDGE_PATH),
  provider: path.resolve(clientRoot, PROVIDER_PATH),
  profile: path.resolve(clientRoot, PROFILE_PATH),
  publicManifest: path.resolve(clientRoot, 'install.json'),
  privateManifest: path.resolve(privateRoot, 'family-ai-client-install.json'),
};
if (![targets.bridge, targets.profile, targets.publicManifest].every((target) => inside(clientRoot, target))
  || !inside(privateRoot, targets.privateManifest)) throw new Error('Managed update target escaped its fixed root');

const statusResponse = await fetch('http://127.0.0.1:3000/api/minecraft/companion/status');
const status = await statusResponse.json();
if (!statusResponse.ok || status?.companion?.lifecycle?.state !== 'stopped' || status?.companion?.bridge?.ready !== false) {
  throw new Error('The managed companion must be stopped and disconnected');
}

const lock = JSON.parse(await fs.readFile(path.resolve(workspace, 'minecraft', 'family-client-lock.v1.json'), 'utf8'));
const lockedBridge = lock.mods.local.find((item) => item.id === 'mastermind-family-agent-bridge');
const lockedProvider = lock.mods.local.find((item) => item.id === 'mastermind-family-agent-baritone-provider');
const lockedProfile = lock.fabric.profile;
const bridgeSource = path.resolve(workspace, 'minecraft', lockedBridge.source);
const providerSource = path.resolve(workspace, 'minecraft', lockedProvider.source);
for (const target of [...Object.values(targets), bridgeSource, providerSource]) await regularFile(target);

const [bridgeBytes, providerBytes, oldBridgeBytes, oldProviderBytes, oldProfileBytes, oldPublicBytes, oldPrivateBytes] = await Promise.all([
  fs.readFile(bridgeSource), fs.readFile(providerSource), fs.readFile(targets.bridge), fs.readFile(targets.provider), fs.readFile(targets.profile),
  fs.readFile(targets.publicManifest), fs.readFile(targets.privateManifest),
]);
if (bridgeBytes.length !== lockedBridge.size || sha256(bridgeBytes) !== lockedBridge.sha256) {
  throw new Error('Rebuilt bridge did not match the audited lock');
}
if (providerBytes.length !== lockedProvider.size || sha256(providerBytes) !== lockedProvider.sha256) {
  throw new Error('Rebuilt Baritone provider did not match the audited lock');
}
if (oldProfileBytes.length !== lockedProfile.size || sha256(oldProfileBytes) !== lockedProfile.sha256) {
  throw new Error('Installed Fabric profile did not match the audited lock');
}

const publicManifest = JSON.parse(oldPublicBytes.toString('utf8'));
const privateManifest = JSON.parse(oldPrivateBytes.toString('utf8'));
const { javaExecutable, clientDirectory, ...privateCommon } = privateManifest;
if (JSON.stringify(publicManifest) !== JSON.stringify(privateCommon)) throw new Error('Managed manifests disagreed before update');
for (const [manifest, oldBridge, oldProvider, oldProfile] of [
  [publicManifest, oldBridgeBytes, oldProviderBytes, oldProfileBytes],
  [privateManifest, oldBridgeBytes, oldProviderBytes, oldProfileBytes],
]) {
  const bridge = oneArtifact(manifest, BRIDGE_PATH);
  const provider = oneArtifact(manifest, PROVIDER_PATH);
  const profile = oneArtifact(manifest, PROFILE_PATH);
  if (bridge.size !== oldBridge.length || bridge.digest !== sha256(oldBridge)
    || provider.size !== oldProvider.length || provider.digest !== sha256(oldProvider)
    || profile.size !== oldProfile.length || profile.digest !== sha256(oldProfile)) {
    throw new Error('Managed manifest did not bind the installed artifact');
  }
  Object.assign(bridge, { size: lockedBridge.size, digest: lockedBridge.sha256 });
  Object.assign(provider, { size: lockedProvider.size, digest: lockedProvider.sha256 });
  if (profile.size !== lockedProfile.size || profile.digest !== lockedProfile.sha256) {
    throw new Error('Managed manifest did not retain the audited Fabric profile');
  }
}
const nextPublic = Buffer.from(`${JSON.stringify(publicManifest, null, 2)}\n`, 'utf8');
const nextPrivate = Buffer.from(`${JSON.stringify(privateManifest, null, 2)}\n`, 'utf8');
const suffix = `.respawn-update-${crypto.randomUUID()}`;
const updates = [
  [targets.bridge, bridgeBytes], [targets.provider, providerBytes],
  [targets.publicManifest, nextPublic], [targets.privateManifest, nextPrivate],
].map(([target, bytes]) => ({ target, bytes, temporary: `${target}${suffix}.tmp`, backup: `${target}${suffix}.bak` }));
const published = [];
try {
  for (const update of updates) {
    await writeNew(update.temporary, update.bytes);
    await fs.rename(update.target, update.backup);
    try { await fs.rename(update.temporary, update.target); }
    catch (error) { await fs.rename(update.backup, update.target); throw error; }
    published.push(update);
  }
  if (sha256(await fs.readFile(targets.bridge)) !== lockedBridge.sha256
    || sha256(await fs.readFile(targets.provider)) !== lockedProvider.sha256
    || sha256(await fs.readFile(targets.profile)) !== lockedProfile.sha256) throw new Error('Published artifacts failed verification');
  const checkedPublic = JSON.parse(await fs.readFile(targets.publicManifest, 'utf8'));
  const checkedPrivate = JSON.parse(await fs.readFile(targets.privateManifest, 'utf8'));
  const { javaExecutable: checkedJava, clientDirectory: checkedDirectory, ...checkedCommon } = checkedPrivate;
  if (checkedJava !== javaExecutable || checkedDirectory !== clientDirectory
    || JSON.stringify(checkedPublic) !== JSON.stringify(checkedCommon)) throw new Error('Published manifests failed verification');
  for (const update of published) await fs.unlink(update.backup);
} catch (error) {
  for (const update of published.reverse()) {
    await fs.rm(update.target, { force: true });
    await fs.rename(update.backup, update.target);
  }
  throw error;
} finally {
  for (const update of updates) {
    await fs.rm(update.temporary, { force: true });
    await fs.rm(update.backup, { force: true });
  }
}

console.log(JSON.stringify({
  ok: true,
  bridgeBytes: bridgeBytes.length,
  bridgeSha256: sha256(bridgeBytes),
  providerBytes: providerBytes.length,
  providerSha256: sha256(providerBytes),
  profileSha256: sha256(oldProfileBytes),
}));
