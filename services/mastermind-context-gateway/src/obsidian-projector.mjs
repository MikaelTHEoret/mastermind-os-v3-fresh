import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, realpath, rename, writeFile } from 'node:fs/promises';

import { boundedText, redactText } from './validation.mjs';

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'item';
}

function yaml(value) {
  return JSON.stringify(value ?? null);
}

function hash(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

async function atomicWrite(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temporary, target);
}

async function resolveProjectionRoot(vaultRoot) {
  if (typeof vaultRoot !== 'string' || !path.isAbsolute(vaultRoot)) throw new Error('MASTERMIND_OBSIDIAN_VAULT must be an absolute path.');
  const resolved = path.resolve(vaultRoot);
  if (resolved === path.parse(resolved).root) throw new Error('The Obsidian vault cannot be a drive root.');
  await mkdir(resolved, { recursive: true });
  const canonicalVault = await realpath(resolved);
  const generated = path.join(canonicalVault, 'Generated', 'Mastermind');
  const relative = path.relative(canonicalVault, generated);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('The projection path escaped the configured vault.');
  return { vault: canonicalVault, generated };
}

function memoryNote(project, memory, generatedAt) {
  const content = boundedText(memory.content, 16_000);
  const projectionHash = hash(JSON.stringify({ id: memory.id, project, content, updatedAt: memory.updatedAt }));
  return `---\nmastermind_id: ${yaml(`harmonic-memory/${memory.id}`)}\nrevision: 1\nscope: ${yaml(`project/${project}`)}\nauthority: ${yaml('mastermind-derived-projection')}\nsource_refs:\n  - ${yaml(`harmonic-memory/${memory.id}`)}\nupdated_at: ${yaml(memory.updatedAt ?? generatedAt)}\nprojection_hash: ${yaml(projectionHash)}\ntags: ${yaml(Array.isArray(memory.tags) ? memory.tags : [])}\n---\n\n# Memory ${memory.id}\n\n${content}\n`;
}

function taskNote(project, task, generatedAt) {
  const checkpoint = task.checkpoint ?? {};
  const projectionHash = hash(JSON.stringify({ taskId: task.taskId, revision: task.revision, checkpoint }));
  const list = (items) => (Array.isArray(items) && items.length > 0
    ? items.map((item) => `- ${redactText(String(item))}`).join('\n')
    : '- None');
  return `---\nmastermind_id: ${yaml(`task/${task.taskId}`)}\nrevision: ${Number(task.revision ?? 0)}\nscope: ${yaml(`project/${project}`)}\nauthority: ${yaml('mastermind-canonical-projection')}\nsource_refs:\n  - ${yaml(`checkpoint/${checkpoint.checkpointId ?? 'none'}`)}\nupdated_at: ${yaml(task.updatedAt ?? generatedAt)}\nprojection_hash: ${yaml(projectionHash)}\nstate: ${yaml(task.state)}\n---\n\n# ${boundedText(task.intent, 240)}\n\n${boundedText(checkpoint.summary ?? 'No checkpoint has been recorded.', 8_000)}\n\n## Completed\n\n${list(checkpoint.completedItems)}\n\n## Open\n\n${list(checkpoint.openItems)}\n\n## Blockers\n\n${list(checkpoint.blockers)}\n`;
}

export function createObsidianProjector({ enabled = false, vaultRoot = '' } = {}) {
  return async function project({ project, memories, tasks }) {
    if (!enabled) return { enabled: false, written: 0, reason: 'OBSIDIAN_EXPORT_DISABLED' };
    const { vault, generated } = await resolveProjectionRoot(vaultRoot);
    const generatedAt = new Date().toISOString();
    const projectFolder = path.join(generated, 'Projects', slug(project));
    const files = [];
    for (const memory of memories.slice(0, 200)) {
      const target = path.join(projectFolder, 'Memories', `memory-${slug(memory.id)}.md`);
      await atomicWrite(target, memoryNote(project, memory, generatedAt));
      files.push(path.relative(vault, target).replaceAll('\\', '/'));
    }
    for (const task of tasks.slice(0, 100)) {
      const target = path.join(projectFolder, 'Tasks', `task-${slug(task.taskId)}.md`);
      await atomicWrite(target, taskNote(project, task, generatedAt));
      files.push(path.relative(vault, target).replaceAll('\\', '/'));
    }
    const overview = `---\nmastermind_id: ${yaml(`project/${project}`)}\nrevision: 1\nscope: ${yaml(`project/${project}`)}\nauthority: ${yaml('mastermind-canonical-projection')}\nupdated_at: ${yaml(generatedAt)}\n---\n\n# ${project}\n\nGenerated from Mastermind. Edits outside a future reviewed Inbox are overwritten or ignored.\n\n## Memories\n\n${memories.slice(0, 200).map((item) => `- [[Memories/memory-${slug(item.id)}|Memory ${item.id}]]`).join('\n') || '- None'}\n\n## Tasks\n\n${tasks.slice(0, 100).map((item) => `- [[Tasks/task-${slug(item.taskId)}|${boundedText(item.intent, 120)}]]`).join('\n') || '- None'}\n`;
    const overviewPath = path.join(projectFolder, 'Overview.md');
    await atomicWrite(overviewPath, overview);
    files.push(path.relative(vault, overviewPath).replaceAll('\\', '/'));
    const manifest = {
      schemaVersion: 1,
      generatedAt,
      project,
      authority: 'mastermind',
      generatedOnly: true,
      files: [...files].sort(),
    };
    const manifestPath = path.join(projectFolder, 'projection-manifest.json');
    await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    files.push(path.relative(vault, manifestPath).replaceAll('\\', '/'));
    return { enabled: true, written: files.length, project, files: files.sort() };
  };
}
