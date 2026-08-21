import fs from 'node:fs/promises';
import path from 'node:path';
import { validateInstanceId } from './config.mjs';

export class LogStore {
  constructor(dataRoot) {
    this.logsRoot = path.join(path.resolve(dataRoot), 'logs');
  }

  async append(instanceId, stream, line) {
    if (!validateInstanceId(instanceId)) throw new TypeError('Invalid instance id');
    await fs.mkdir(this.logsRoot, { recursive: true });
    const record = JSON.stringify({ at: new Date().toISOString(), stream, line: String(line).slice(0, 16_384) });
    await fs.appendFile(path.join(this.logsRoot, `${instanceId}.jsonl`), `${record}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  async tail(instanceId, limit = 200) {
    if (!validateInstanceId(instanceId)) throw new TypeError('Invalid instance id');
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new TypeError('limit must be 1-1000');
    try {
      const text = await fs.readFile(path.join(this.logsRoot, `${instanceId}.jsonl`), 'utf8');
      return text.trim().split(/\r?\n/).filter(Boolean).slice(-limit).map((line) => {
        try { return JSON.parse(line); }
        catch { return { at: '', stream: 'system', line: '[unreadable log entry]' }; }
      });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }
}
