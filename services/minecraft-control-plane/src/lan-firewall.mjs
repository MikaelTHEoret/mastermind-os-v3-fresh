import { spawn } from 'node:child_process';
import path from 'node:path';

export const LAN_FIREWALL_ACTIONS = Object.freeze(['Enable', 'Status', 'Disable']);
export const GEYSER_BEDROCK_PORT = 19132;

const INSTANCE_ID = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const RESULT_PREFIX = 'MASTERMIND_LAN_RESULT:';
const MAX_OUTPUT_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 4 * 60 * 1000;

function validateRequest(instance, trustedScriptPath, action) {
  if (!LAN_FIREWALL_ACTIONS.includes(action)) {
    throw new TypeError('LAN firewall action must be Enable, Status, or Disable.');
  }
  if (!instance || typeof instance !== 'object' || Array.isArray(instance)) {
    throw new TypeError('A managed family-server instance is required.');
  }
  if (instance.projectId !== 'family-server' || typeof instance.id !== 'string' || !INSTANCE_ID.test(instance.id)) {
    throw new TypeError('A valid managed family-server instance is required.');
  }
  if (!Number.isInteger(instance.javaPort) || instance.javaPort < 1 || instance.javaPort > 65535) {
    throw new TypeError('The managed instance must have a valid Java port.');
  }
  if (instance.bedrockPort !== undefined && instance.bedrockPort !== GEYSER_BEDROCK_PORT) {
    throw new TypeError(`The family-server Bedrock port must be ${GEYSER_BEDROCK_PORT}.`);
  }
  if (
    typeof trustedScriptPath !== 'string'
    || trustedScriptPath.includes('\0')
    || !path.isAbsolute(trustedScriptPath)
    || path.basename(trustedScriptPath).toLowerCase() !== 'configure-family-server-lan.ps1'
  ) {
    throw new TypeError('The trusted family-server LAN script path is invalid.');
  }
}

function powershellExecutable() {
  const windowsRoot = typeof process.env.SystemRoot === 'string' && path.win32.isAbsolute(process.env.SystemRoot)
    ? process.env.SystemRoot
    : 'C:\\Windows';
  return path.win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function publicResult(action, status, javaPort, code) {
  return {
    action,
    status,
    javaPort,
    bedrockPort: GEYSER_BEDROCK_PORT,
    ...(code ? { code } : {}),
  };
}

function parseCompletion(stdout, exitCode) {
  const markers = stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(RESULT_PREFIX))
    .map((line) => line.slice(RESULT_PREFIX.length).trim().toUpperCase());
  const marker = markers.at(-1);
  if (exitCode === 0 && marker === 'COMPLETED') return { status: 'completed' };
  if (exitCode === 0 && marker === 'CANCELLED') return { status: 'cancelled' };
  return { status: 'error', code: marker === 'ERROR' ? 'SCRIPT_FAILED' : 'INVALID_SCRIPT_RESULT' };
}

/**
 * Run the one trusted LAN firewall script for one validated managed instance.
 * The browser cannot supply an executable, script path, Java port, or command.
 */
export async function runLanFirewallAction(instance, trustedScriptPath, action, options = {}) {
  validateRequest(instance, trustedScriptPath, action);
  const spawnImpl = options.spawnImpl ?? spawn;
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const onState = typeof options.onState === 'function' ? options.onState : () => {};
  const javaPort = instance.javaPort;

  if (platform !== 'win32') {
    return publicResult(action, 'error', javaPort, 'WINDOWS_REQUIRED');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10 * 60 * 1000) {
    throw new TypeError('LAN firewall timeout is invalid.');
  }

  const requested = publicResult(action, 'requested', javaPort);
  onState(requested);

  const args = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    trustedScriptPath,
    '-Action',
    action,
    '-JavaPort',
    String(javaPort),
    '-BedrockPort',
    String(GEYSER_BEDROCK_PORT),
    ...(action === 'Status' ? [] : ['-AllowElevation']),
  ];

  return new Promise((resolve) => {
    let child;
    let settled = false;
    let stdout = '';
    let outputBytes = 0;

    const finish = (status, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = publicResult(action, status, javaPort, code);
      onState(result);
      resolve(result);
    };

    const timer = setTimeout(() => {
      if (action === 'Status') {
        child?.kill?.();
        finish('error', 'SCRIPT_TIMEOUT');
        return;
      }
      // The non-elevated wrapper may be waiting on a separately elevated
      // process. Killing it cannot prove that the privileged mutation stopped,
      // so report an indeterminate completion and leave the wrapper to observe
      // the real exit. A subsequent read-only LAN status refresh is authoritative.
      finish('pending', 'COMPLETION_UNKNOWN');
    }, timeoutMs);
    timer.unref?.();

    try {
      child = spawnImpl(powershellExecutable(), args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      finish('error', 'LAUNCH_FAILED');
      return;
    }

    if (!child || typeof child.once !== 'function') {
      finish('error', 'LAUNCH_FAILED');
      return;
    }

    child.once('error', () => finish('error', 'LAUNCH_FAILED'));
    child.stdout?.on?.('data', (chunk) => {
      if (settled) return;
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_OUTPUT_BYTES) {
        if (action === 'Status') {
          child.kill?.();
          finish('error', 'SCRIPT_OUTPUT_LIMIT');
        } else {
          finish('pending', 'COMPLETION_UNKNOWN');
        }
        return;
      }
      stdout += chunk.toString('utf8');
    });
    child.once('close', (exitCode) => {
      const completion = parseCompletion(stdout, exitCode);
      finish(completion.status, completion.code);
    });
  });
}
