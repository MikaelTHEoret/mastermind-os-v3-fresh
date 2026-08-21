import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { neon } from '@neondatabase/serverless';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;

const MIGRATIONS = Object.freeze([
  Object.freeze({
    file: 'memory-system/migrations/001_mastermind_domain_events_v1.sql',
    sha256: 'f79582781e74c1dcd80a7683eab241385c2ae925d528f94f5b6e62962c13a3ee',
  }),
  Object.freeze({
    file: 'memory-system/migrations/002_mastermind_family_identity_v1.sql',
    sha256: '17eaac479fa5ada03a30ad9c4b9441d1e939e239d2e8b083100b41544509884f',
  }),
  Object.freeze({
    file: 'memory-system/migrations/003_mastermind_memory_operator_v1.sql',
    sha256: 'fbd6d53bcad3aeb4a9a91180c4b6385e81773a76fb400fb22d028d679adeaf29',
  }),
  Object.freeze({
    file: 'memory-system/migrations/004_mastermind_node_exchange_v1.sql',
    sha256: '8285f5e60c5a4fc380256bdb7df5262da5fc998e412b7220d69f8f305631a8ca',
  }),
  Object.freeze({
    file: 'memory-system/migrations/005_mastermind_node_exchange_lease_presence_v1.sql',
    sha256: 'bbdee72be9d05c7520edf39de63be5fe036bca21a6023e4a77f9c014aa822811',
  }),
  Object.freeze({
    file: 'memory-system/migrations/006_mastermind_node_exchange_start_window_v1.sql',
    sha256: 'b6a97f79350668ef88ee5c7b9aed3f97ca8979ba486aa3feb010254ed9704676',
  }),
  Object.freeze({
    file: 'memory-system/migrations/007_mastermind_context_gateway_v1.sql',
    sha256: '5fba5d9f8af5c9dc68a36b3179632197759e90a377df39439de476041cf6394d',
  }),
]);

let activeMigration = null;

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function splitSqlStatements(source) {
  const statements = [];
  let start = 0;
  let index = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockCommentDepth = 0;
  let dollarQuote = null;

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === '\n') lineComment = false;
      index += 1;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (current === '/' && next === '*') {
        blockCommentDepth += 1;
        index += 2;
      } else if (current === '*' && next === '/') {
        blockCommentDepth -= 1;
        index += 2;
      } else index += 1;
      continue;
    }
    if (dollarQuote !== null) {
      if (source.startsWith(dollarQuote, index)) {
        index += dollarQuote.length;
        dollarQuote = null;
      } else index += 1;
      continue;
    }
    if (singleQuoted) {
      if (current === "'" && next === "'") index += 2;
      else {
        if (current === "'") singleQuoted = false;
        index += 1;
      }
      continue;
    }
    if (doubleQuoted) {
      if (current === '"' && next === '"') index += 2;
      else {
        if (current === '"') doubleQuoted = false;
        index += 1;
      }
      continue;
    }
    if (current === '-' && next === '-') {
      lineComment = true;
      index += 2;
      continue;
    }
    if (current === '/' && next === '*') {
      blockCommentDepth = 1;
      index += 2;
      continue;
    }
    if (current === "'") {
      singleQuoted = true;
      index += 1;
      continue;
    }
    if (current === '"') {
      doubleQuoted = true;
      index += 1;
      continue;
    }
    if (current === '$') {
      const match = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) {
        dollarQuote = match[0];
        index += dollarQuote.length;
        continue;
      }
    }
    if (current === ';') {
      const statement = source.slice(start, index).trim();
      if (statement.length > 0) statements.push(statement);
      start = index + 1;
    }
    index += 1;
  }

  if (singleQuoted || doubleQuoted || blockCommentDepth > 0 || dollarQuote !== null) {
    throw Object.assign(new Error('A memory migration contains unterminated SQL syntax.'), {
      code: 'MEMORY_MIGRATION_INVALID',
    });
  }
  const remainder = source.slice(start).trim();
  if (remainder.length > 0) statements.push(remainder);
  if (statements.at(0)?.toUpperCase() !== 'BEGIN' || statements.at(-1)?.toUpperCase() !== 'COMMIT') {
    throw Object.assign(new Error('A memory migration lost its transaction boundary.'), {
      code: 'MEMORY_MIGRATION_INVALID',
    });
  }
  return statements.slice(1, -1);
}

async function main() {
  loadEnvConfig(process.cwd(), true);
  const url = process.env.NEON_MEMORY_URL;
  if (typeof url !== 'string' || url.length === 0) {
    throw Object.assign(new Error('The memory database is not configured.'), {
      code: 'MEMORY_DB_NOT_CONFIGURED',
    });
  }

  const sql = neon(url);
  for (const migration of MIGRATIONS) {
    activeMigration = migration.file.split('/').at(-1);
    const source = await readFile(migration.file, 'utf8');
    if (digest(source) !== migration.sha256) {
      throw Object.assign(new Error('A memory migration changed after review.'), {
        code: 'MEMORY_MIGRATION_CHANGED',
      });
    }
    const statements = splitSqlStatements(source);
    await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));
    console.log(`[memory:migrate] ${activeMigration} applied`);
    activeMigration = null;
  }

  const [status] = await sql`
    SELECT
      to_regclass('public.mastermind_domain_event_receipts_v1') IS NOT NULL AS events,
      to_regclass('public.mastermind_players_v1') IS NOT NULL AS players,
      to_regclass('public.mastermind_memory_lifecycle_v1') IS NOT NULL AS lifecycle,
      to_regclass('public.mastermind_nodes_v1') IS NOT NULL AS nodes,
      to_regclass('public.mastermind_node_jobs_v1') IS NOT NULL AS node_jobs,
      to_regclass('public.mastermind_context_tasks_v1') IS NOT NULL AS context_tasks
  `;
  const ready = status?.events === true && status?.players === true && status?.lifecycle === true
    && status?.nodes === true && status?.node_jobs === true && status?.context_tasks === true;
  console.log(`[memory:migrate] schema ready: ${ready}`);
  if (!ready) process.exitCode = 2;
}

main().catch((error) => {
  const code = typeof error?.code === 'string' ? error.code : 'MEMORY_MIGRATION_FAILED';
  const position = typeof error?.position === 'string' && /^\d+$/.test(error.position)
    ? ` at SQL byte ${error.position}`
    : '';
  const detail = typeof error?.message === 'string'
    ? ` (${error.message.replace(/[\r\n]+/g, ' ').slice(0, 240)})`
    : '';
  console.error(`[memory:migrate] ${activeMigration ?? 'verification'} failed: ${code}${position}${detail}`);
  process.exitCode = 1;
});
