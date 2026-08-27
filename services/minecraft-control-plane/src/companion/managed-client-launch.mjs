import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { encodeMinecraftCredentialFrame } from './credential-frame.mjs';

const INSTANCE_ID = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;
const SHA1 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function isContained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function exactArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function javaArgumentFileText(argumentsList) {
  if (!Array.isArray(argumentsList) || argumentsList.length < 1 || argumentsList.length > 2048) {
    throw new Error('The verified Java launch argument set was invalid.');
  }
  return `${argumentsList.map((value) => {
    if (typeof value !== 'string' || value.length < 1 || value.length > 32_768 || /[\x00-\x1f\x7f]/u.test(value)) {
      throw new Error('The verified Java launch argument set was invalid.');
    }
    return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  }).join('\n')}\n`;
}

async function prepareJavaArgumentFile(profile, argumentsList) {
  const body = javaArgumentFileText(argumentsList);
  if (Buffer.byteLength(body, 'utf8') > 256 * 1024) throw new Error('The verified Java launch argument file exceeded its size limit.');
  const digest = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  const file = path.join(profile.launchArgumentsDirectory, `family-client-${digest}.args`);
  if (!isContained(profile.launchArgumentsDirectory, file)) throw new Error('The Java launch argument file escaped its trusted directory.');
  await fs.writeFile(file, body, { flag: 'wx', mode: 0o600 });
  await fs.chmod(file, 0o600);
  const stat = await fs.lstat(file);
  const observed = await fs.readFile(file);
  try {
    if (
      !stat.isFile() || stat.isSymbolicLink() || observed.length !== Buffer.byteLength(body, 'utf8')
      || crypto.createHash('sha256').update(observed).digest('hex') !== digest
    ) throw new Error('The Java launch argument file failed integrity verification.');
  } finally {
    observed.fill(0);
  }
  return Object.freeze({ file, digest });
}

function exactProfile(profile) {
  if (
    !profile || profile.projectId !== 'family-ai-client' || profile.serverProjectId !== 'family-server'
    || profile.kind !== 'client' || profile.platform !== 'windows-x64' || profile.minecraftVersion !== '26.2'
    || profile.loaderVersion !== '0.19.3' || profile.javaMajor !== 25 || profile.launchPrepared !== true
    || typeof profile.javaExecutable !== 'string' || !path.isAbsolute(profile.javaExecutable)
    || typeof profile.clientDirectory !== 'string' || !path.isAbsolute(profile.clientDirectory)
    || profile.mainClass !== 'com.mastermind.minecraft.familyclientbootstrap.FamilyClientBootstrap'
    || typeof profile.assetsDirectory !== 'string' || !path.isAbsolute(profile.assetsDirectory)
    || typeof profile.nativesDirectory !== 'string' || !path.isAbsolute(profile.nativesDirectory)
    || typeof profile.loggingConfiguration !== 'string' || !path.isAbsolute(profile.loggingConfiguration)
    || typeof profile.launchArgumentsDirectory !== 'string' || !path.isAbsolute(profile.launchArgumentsDirectory)
    || typeof profile.assetIndexId !== 'string' || typeof profile.versionId !== 'string'
    || !profile.runtimeNatives || !['root', 'jna', 'lwjgl', 'netty'].every((key) => path.isAbsolute(profile.runtimeNatives[key] ?? ''))
    || !Array.isArray(profile.classpath) || profile.classpath.length < 2 || profile.classpath.length > 1024
    || profile.classpath.some((value) => typeof value !== 'string' || !path.isAbsolute(value))
    || !Array.isArray(profile.jvmArguments) || profile.jvmArguments.length < 1 || profile.jvmArguments.length > 64
    || profile.jvmArguments.some((value) => typeof value !== 'string' || value.length < 1 || value.length > 32_768 || value.includes('\0'))
    || !Array.isArray(profile.bootstrapArguments) || profile.bootstrapArguments.length !== 10
    || profile.bootstrapArguments.some((value) => typeof value !== 'string' || value.length < 1 || value.length > 32_768 || value.includes('\0'))
    || !profile.verifiedMetadata || !SHA1.test(profile.verifiedMetadata.versionJsonSha1 ?? '')
    || !SHA256.test(profile.verifiedMetadata.fabricProfileSha256 ?? '')
    || !SHA256.test(profile.verifiedMetadata.bootstrapSha256 ?? '')
  ) throw new Error('The verified Family client launch profile was invalid.');
  if (
    !profile.classpath.every((value) => isContained(profile.clientDirectory, value))
    || !isContained(profile.clientDirectory, profile.assetsDirectory)
    || !isContained(profile.clientDirectory, profile.nativesDirectory)
    || !isContained(profile.clientDirectory, profile.loggingConfiguration)
    || !isContained(profile.clientDirectory, profile.runtimeNatives.root)
    || !isContained(profile.clientDirectory, profile.launchArgumentsDirectory)
    || !['jna', 'lwjgl', 'netty'].every((key) => isContained(profile.runtimeNatives.root, profile.runtimeNatives[key]))
  ) throw new Error('The verified Family client launch profile escaped its managed root.');
  const expectedJvmArguments = [
    '-Xms512m', '-Xmx2048m',
    '-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump',
    '--sun-misc-unsafe-memory-access=allow', '--enable-native-access=ALL-UNNAMED',
    `-Djava.library.path=${profile.nativesDirectory}`,
    `-Djna.tmpdir=${profile.runtimeNatives.jna}`,
    `-Dorg.lwjgl.system.SharedLibraryExtractPath=${profile.runtimeNatives.lwjgl}`,
    `-Dio.netty.native.workdir=${profile.runtimeNatives.netty}`,
    `-Dlog4j.configurationFile=${profile.loggingConfiguration}`,
    '-Dminecraft.launcher.brand=Mastermind', '-Dminecraft.launcher.version=0.1.0',
    `-Dmastermind.family.versionJson.sha1=${profile.verifiedMetadata.versionJsonSha1}`,
    `-Dmastermind.family.fabricProfile.sha256=${profile.verifiedMetadata.fabricProfileSha256}`,
    `-Dmastermind.family.bootstrap.sha256=${profile.verifiedMetadata.bootstrapSha256}`,
    '-DFabricMcEmu= net.minecraft.client.main.Main ',
  ];
  const expectedBootstrapArguments = [
    '--game-dir', profile.clientDirectory,
    '--assets-dir', profile.assetsDirectory,
    '--asset-index', profile.assetIndexId,
    '--version', profile.versionId,
    '--version-type', 'Mastermind',
  ];
  if (!exactArray(profile.jvmArguments, expectedJvmArguments) || !exactArray(profile.bootstrapArguments, expectedBootstrapArguments)) {
    throw new Error('The verified Family client launch arguments were not the exact audited contract.');
  }
  return profile;
}

function assertSecretFreeLaunch(command, manifest, session) {
  const publicLaunch = JSON.stringify({ command, manifest });
  if (publicLaunch.includes(session.accessToken)) {
    throw new Error('The managed Family client launch command contained private account material.');
  }
  const exactArguments = new Set([command.executable, command.cwd, ...command.args, ...Object.values(command.env)]);
  for (const value of [session.uuid, session.xuid, session.clientId]) {
    if (exactArguments.has(value)) throw new Error('The managed Family client launch command contained private account material.');
  }
}

export function createManagedClientLaunchFactory({
  provisioner,
  getAuth,
  familyServerInstanceId = 'family-server',
} = {}) {
  if (!provisioner || typeof provisioner.internalLaunchProfile !== 'function') {
    throw new TypeError('A verified Family client provisioner is required');
  }
  if (typeof getAuth !== 'function') throw new TypeError('A private Minecraft auth provider is required');
  if (typeof familyServerInstanceId !== 'string' || !INSTANCE_ID.test(familyServerInstanceId)) {
    throw new TypeError('A valid trusted Family Server instance id is required');
  }
  return Object.freeze({
    familyServerInstanceId,
    async create() {
      const profile = exactProfile(await provisioner.internalLaunchProfile());
      const auth = getAuth();
      if (!auth || typeof auth.minecraftSession !== 'function' || typeof auth.silentRefresh !== 'function') {
        throw new Error('Minecraft authentication is unavailable.');
      }
      let session;
      try { session = auth.minecraftSession(); }
      catch (error) {
        if (error?.code !== 'MINECRAFT_SESSION_REFRESH_REQUIRED') throw error;
        await auth.silentRefresh();
        session = auth.minecraftSession();
      }
      let credentialFrame;
      try {
        credentialFrame = encodeMinecraftCredentialFrame(session);
        const javaArguments = [
          ...profile.jvmArguments,
          '-cp', profile.classpath.join(path.delimiter),
          profile.mainClass,
          ...profile.bootstrapArguments,
        ];
        const argumentFile = await prepareJavaArgumentFile(profile, javaArguments);
        const command = Object.freeze({
          executable: profile.javaExecutable,
          cwd: profile.clientDirectory,
          args: Object.freeze([`@${argumentFile.file}`]),
          env: Object.freeze({ MASTERMIND_FAMILY_CLIENT_PROFILE: 'family-ai-client' }),
        });
        const manifest = Object.freeze({ ...profile.versionManifest });
        assertSecretFreeLaunch(command, manifest, session);
        return { familyServerInstanceId, command, manifest, credentialFrame };
      } catch (error) {
        credentialFrame?.fill(0);
        throw error;
      }
    },
  });
}

export const __test = Object.freeze({ javaArgumentFileText, prepareJavaArgumentFile });
