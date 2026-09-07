// Shared canonical tool declarations; each transport selects an explicit subset.
const objectSchema = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const TOOLS = Object.freeze([
  {
    name: 'mastermind_bootstrap',
    description: 'Start here. Load authorized identity, pinned memory, active project state, and relevant context for one project.',
    inputSchema: objectSchema({
      project: { type: 'string', description: 'Canonical project ID, for example mastermind or minecraft.' },
      intent: { type: 'string', maxLength: 1000, description: 'Current task or question used to retrieve relevant memory.' },
      budget: { type: 'integer', minimum: 4000, maximum: 48000, description: 'Maximum compact JSON characters, including context budget metadata. Defaults to 24000.' },
      requestedScopes: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 180 } },
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: 'mastermind_context_pack',
    description: 'Build a bounded, cited context packet for a specific intent using pinned, task, memory, and archive layers.',
    inputSchema: objectSchema({
      project: { type: 'string' },
      intent: { type: 'string', maxLength: 512 },
      budget: { type: 'integer', minimum: 4000, maximum: 48000 },
      memoryLimit: { type: 'integer', minimum: 1, maximum: 20 },
      archiveLimit: { type: 'integer', minimum: 1, maximum: 16 },
    }, ['intent']),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: 'mastermind_memory_search',
    description: 'Search active authorized curated Mastermind memories. Include inactive records only for an explicit historical review. Results retain stable IDs and supersession provenance.',
    inputSchema: objectSchema({
      query: { type: 'string', maxLength: 512 },
      project: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
      includeInactive: { type: 'boolean', default: false },
    }, ['query']),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: 'mastermind_archive_search',
    description: 'Search authorized transcript and document archives with lexical/vector fusion and document diversity.',
    inputSchema: objectSchema({
      query: { type: 'string', maxLength: 512 },
      sourceType: { type: 'string', enum: ['transcript', 'document', 'datasheet', 'code', 'data'] },
      limit: { type: 'integer', minimum: 1, maximum: 16 },
    }, ['query']),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: 'mastermind_archive_fetch',
    description: 'Fetch one exact stable archive address plus a small neighboring chunk window for evidence. exact.sourceTime reports validated conversation creation provenance when available; it never infers message chronology from legacy modified or import dates.',
    inputSchema: objectSchema({
      address: { type: 'string', maxLength: 512 },
      contextWindow: { type: 'integer', minimum: 0, maximum: 3 },
    }, ['address']),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: 'mastermind_project_state',
    description: 'Read active, blocked, and completed persistent tasks with their latest checkpoints.',
    inputSchema: objectSchema({
      project: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: 'mastermind_task_checkpoint',
    description: 'Append a recovery checkpoint. Safe retries require the same caller-supplied taskId, checkpointId, and payload; omitted IDs create new records. This cannot execute shell or Minecraft actions.',
    inputSchema: objectSchema({
      taskId: { type: 'string', format: 'uuid' },
      checkpointId: { type: 'string', format: 'uuid' },
      expectedRevision: { type: 'integer', minimum: 0, maximum: 9007199254740991, description: 'Optional compare-and-append guard. Requires the reviewed owner/replay migration; retain this value on uncertain retries.' },
      project: { type: 'string' },
      intent: { type: 'string', maxLength: 2000 },
      summary: { type: 'string', maxLength: 4096 },
      state: { type: 'string', enum: ['active', 'blocked', 'completed'] },
      completedItems: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 512 } },
      openItems: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 512 } },
      blockers: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 512 } },
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
  },
  {
    name: 'mastermind_minecraft_status',
    description: 'Read control-plane, server, and companion status. Minecraft actions are intentionally disabled.',
    inputSchema: objectSchema({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: 'mastermind_minecraft_memory_search',
    description: 'Search authorized, sanitized Minecraft companion session rollups. Raw per-tick snapshots are never returned.',
    inputSchema: objectSchema({
      query: { type: 'string', maxLength: 512 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    }, ['query']),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: 'mastermind_obsidian_export',
    description: 'Generate the configured one-way sanitized Obsidian project projection. Requires confirm=true and never imports edits.',
    inputSchema: objectSchema({
      project: { type: 'string' },
      confirm: { type: 'boolean', description: 'Must be true to write generated Markdown files.' },
    }, ['confirm']),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: 'mastermind_system_status',
    description: 'Read gateway, memory substrate, migration, and Minecraft connectivity status.',
    inputSchema: objectSchema({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
]);

export const HANDLERS = Object.freeze({
  mastermind_bootstrap: 'bootstrap',
  mastermind_context_pack: 'contextPack',
  mastermind_memory_search: 'searchMemories',
  mastermind_archive_search: 'searchArchive',
  mastermind_archive_fetch: 'fetchArchive',
  mastermind_project_state: 'projectState',
  mastermind_task_checkpoint: 'checkpoint',
  mastermind_minecraft_status: 'getMinecraftStatus',
  mastermind_minecraft_memory_search: 'searchMinecraftMemories',
  mastermind_obsidian_export: 'obsidianExport',
  mastermind_system_status: 'systemStatus',
});

