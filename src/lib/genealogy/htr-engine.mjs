import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export function resolveBrittanyHtrPaths(environment = process.env) {
  const workspace = path.resolve(environment.MASTERMIND_BRITTANY_HTR_ROOT || path.join(process.cwd(), 'services', 'brittany-htr', 'workspace'));
  const python = path.resolve(environment.MASTERMIND_BRITTANY_HTR_PYTHON || path.join(process.cwd(), 'services', 'brittany-htr', '.venv', 'Scripts', 'python.exe'));
  const entrypoint = path.resolve(process.cwd(), 'services', 'brittany-htr', 'brittany_htr.py');
  return { workspace, python, entrypoint };
}

export async function runBrittanyHtr(argumentsList, options = {}) {
  if (!Array.isArray(argumentsList) || argumentsList.some((value) => typeof value !== 'string')) {
    throw new TypeError('Brittany HTR arguments must be strings');
  }
  const paths = resolveBrittanyHtrPaths(options.environment);
  await mkdir(paths.workspace, { recursive: true });
  const timeoutMs = Math.max(1_000, Math.min(Number(options.timeoutMs) || 600_000, 3_600_000));
  return new Promise((resolve, reject) => {
    const child = spawn(paths.python, [paths.entrypoint, ...argumentsList], {
      cwd: process.cwd(),
      env: { ...process.env, MASTERMIND_BRITTANY_HTR_ROOT: paths.workspace },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const collect = (target, chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(() => reject(Object.assign(new Error('Brittany HTR returned too much output'), { code: 'HTR_OUTPUT_LIMIT' })));
        return target;
      }
      return target + chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk) => { stdout = collect(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = collect(stderr, chunk); });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (code) => finish(() => {
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
      let payload;
      try { payload = line ? JSON.parse(line) : null; } catch { payload = null; }
      if (code !== 0 || !payload?.ok) {
        reject(Object.assign(new Error(payload?.error || stderr.trim() || `Brittany HTR exited with code ${code}`), { code: 'HTR_FAILED', details: payload }));
        return;
      }
      resolve(payload);
    }));
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(Object.assign(new Error('Brittany HTR timed out'), { code: 'HTR_TIMEOUT' })));
    }, timeoutMs);
  });
}

export function getBrittanyHtrHealth(options) {
  return runBrittanyHtr(['health'], { ...options, timeoutMs: 60_000 });
}

