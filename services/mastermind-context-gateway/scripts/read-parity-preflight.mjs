import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGatewayFromEnvironment, toolEnvelope } from '../src/mcp-server.mjs';
import { inspectCanonicalSchema } from '../src/schema-preflight.mjs';

// Read-only acceptance. Optional receipt destination is an explicit local output file.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const gateway = createGatewayFromEnvironment(root);
gateway.embed = async () => null; // No model load or paid inference for this preflight.
const receipt = { observedAt: new Date().toISOString(), mode: 'fresh process; read-only; lexical retrieval', migrationApplied: false };
try {
  await gateway.authorize();
  receipt.operatorAuthorized = true;
  receipt.schema = await inspectCanonicalSchema(gateway.store.sql);
  const [functions] = await gateway.store.sql.query(`SELECT
    to_regprocedure('public.append_mastermind_context_checkpoint_v2(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb,jsonb,bigint)') IS NOT NULL AS "revisionAppendReady"`, []);
  receipt.revisionAppendReady = functions.revisionAppendReady;
  receipt.memoryLifecycleCounts = await gateway.store.sql.query(`SELECT COALESCE(memory_status,'active') AS status,
    count(*)::text AS count FROM public.harmonic_memories GROUP BY COALESCE(memory_status,'active') ORDER BY status`, []);
  const state = await gateway.projectState({ project: 'mastermind', limit: 20 });
  receipt.tasks = state.tasks.map((task) => ({ taskId: task.taskId, revision: task.revision,
    state: task.state, updatedAt: task.updatedAt, checkpointId: task.checkpoint?.checkpointId }));
  receipt.contexts = [];
  receipt.bootstraps = [];
  for (const budget of [6000, 24000]) {
    const bootstrap = await gateway.bootstrap({ project: 'mastermind', intent: 'Reconstruct Mastermind from the original Claude and GPT instructions and finish the approved core implementation plan.', budget });
    const envelope = toolEnvelope(bootstrap);
    receipt.bootstraps.push({ budget, actualCharacters: JSON.stringify(bootstrap).length,
      envelopeBytes: Buffer.byteLength(JSON.stringify(envelope), 'utf8'),
      validStructuredContent: JSON.stringify(JSON.parse(envelope.content[0].text)) === JSON.stringify(envelope.structuredContent),
      hasInvalidPreview: Object.hasOwn(envelope.structuredContent, 'preview'),
      taskIds: bootstrap.projectState.tasks.map((row) => row.taskId),
      taskRevisions: bootstrap.projectState.tasks.map((row) => row.revision),
      pinnedMemoryIds: bootstrap.pinned.map((row) => row.id),
      pinnedLayers: [...new Set(bootstrap.pinned.map((row) => row.layer))],
      activePinsOnly: bootstrap.pinned.every((row) => row.memoryStatus === 'active'),
      timestampStrings: bootstrap.pinned.every((row) => row.updatedAt === null || typeof row.updatedAt === 'string'),
    });
    const context = await gateway.contextPack({ project: 'mastermind', intent: 'context hydration recovery', budget, memoryLimit: 3, archiveLimit: 3 });
    receipt.contexts.push({ budget, actualCharacters: JSON.stringify(context).length,
      withinBudget: JSON.stringify(context).length <= budget,
      pinnedLayers: [...new Set(context.pinned.map((row) => row.layer))],
      pinnedMemoryIds: context.pinned.map((row) => row.id),
      activePinsOnly: context.pinned.every((row) => row.memoryStatus === 'active'),
      activeSearchOnly: context.memories.every((row) => row.memoryStatus === 'active'),
      timestampStrings: context.pinned.every((row) => row.updatedAt === null || typeof row.updatedAt === 'string'),
      memoryCount: context.memories.length, archiveCount: context.archive.length,
      sourceReferenceDigest: crypto.createHash('sha256').update(JSON.stringify(context.archive.map((row) => row.address))).digest('hex'),
    });
  }
  receipt.ok = receipt.schema.ready && receipt.contexts.every((value) => value.withinBudget && value.activePinsOnly && value.activeSearchOnly && value.timestampStrings)
    && receipt.bootstraps.every((value) => value.actualCharacters <= value.budget && value.envelopeBytes < 65536
      && value.validStructuredContent && !value.hasInvalidPreview && value.activePinsOnly && value.timestampStrings
      && value.taskIds.includes('9f8231b1-29aa-444c-8047-c300110b6da8'));
} catch (error) {
  receipt.ok = false;
  receipt.error = { code: typeof error?.code === 'string' ? error.code : 'PREFLIGHT_UNAVAILABLE', type: error?.name };
  process.exitCode = 1;
}
if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(receipt, null, 2));
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
