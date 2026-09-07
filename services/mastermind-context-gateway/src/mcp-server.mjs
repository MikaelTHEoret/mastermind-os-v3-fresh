#!/usr/bin/env node

import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

import nextEnv from '@next/env';

import { MastermindContextGateway } from './context-gateway.mjs';
import { createOllamaEmbedder } from './embedder.mjs';
import { createMinecraftStatusClient } from './minecraft-status.mjs';
import { NeonMemoryStore } from './neon-store.mjs';
import { createObsidianProjector } from './obsidian-projector.mjs';
import { ContextGatewayError, sanitizeValue } from './validation.mjs';

const { loadEnvConfig } = nextEnv;
const SERVER_VERSION = '0.1.0';
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const MAX_REQUEST_CHARS = 64 * 1024;
const MAX_RESPONSE_CHARS = 64 * 1024;

import { TOOLS, HANDLERS } from './tool-catalog.mjs';

function reply(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorReply(id, code, message, data = undefined) {
  reply({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
}

export function toolEnvelope(value) {
  const safe = sanitizeValue(value);
  const text = JSON.stringify(safe);
  if (text.length > MAX_RESPONSE_CHARS) {
    throw new ContextGatewayError('RESPONSE_TOO_LARGE',
      'The response exceeds 65536 JSON characters. Request a smaller limit, context window, or context budget.');
  }
  return { content: [{ type: 'text', text }], structuredContent: safe, isError: false };
}

function toolError(error) {
  const code = error instanceof ContextGatewayError ? error.code : 'GATEWAY_UNAVAILABLE';
  const message = error instanceof ContextGatewayError
    ? error.message
    : 'The Mastermind context gateway could not complete the request.';
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, code, message }, null, 2) }],
    structuredContent: { ok: false, code, message },
    isError: true,
  };
}

export function createGatewayFromEnvironment(repoRoot) {
  loadEnvConfig(repoRoot, true, { info() {}, error() {} });
  const localConfigPath = path.join(repoRoot, 'config', 'mastermind-context.local.json');
  let localConfig = {};
  if (existsSync(localConfigPath)) {
    const parsed = JSON.parse(readFileSync(localConfigPath, 'utf8'));
    const allowed = ['schemaVersion', 'obsidianExportEnabled', 'obsidianVault'];
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || parsed.schemaVersion !== 1 || Object.keys(parsed).some((key) => !allowed.includes(key))) {
      throw new Error('config/mastermind-context.local.json is invalid.');
    }
    localConfig = parsed;
  }
  const store = new NeonMemoryStore(process.env.NEON_MEMORY_URL);
  return new MastermindContextGateway({
    store,
    embed: createOllamaEmbedder(),
    projectObsidian: createObsidianProjector({
      enabled: process.env.MASTERMIND_OBSIDIAN_EXPORT_ENABLED === 'true' || localConfig.obsidianExportEnabled === true,
      vaultRoot: process.env.MASTERMIND_OBSIDIAN_VAULT || localConfig.obsidianVault || '',
    }),
    minecraftStatus: createMinecraftStatusClient(),
    identity: {
      householdId: process.env.MASTERMIND_MEMORY_HOUSEHOLD_ID,
      actorPlayerId: process.env.MASTERMIND_MEMORY_OPERATOR_PLAYER_ID,
    },
  });
}

export async function handleMessage(gateway, message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    if (message?.id !== undefined) errorReply(message.id, -32600, 'Invalid Request');
    return;
  }
  const id = message.id;
  if (message.method.startsWith('notifications/')) return;
  if (message.method === 'initialize') {
    const requested = typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : DEFAULT_PROTOCOL_VERSION;
    reply({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: requested,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'mastermind-context-gateway', version: SERVER_VERSION },
        instructions: 'Call mastermind_bootstrap first. Authorization is checked before retrieval. Treat task/identity state as canonical and vectors as derived. Cite memory IDs and archive addresses. Minecraft actions are disabled. Never request secrets. Use mastermind_task_checkpoint for durable recovery and mastermind_obsidian_export only with explicit confirmation.',
      },
    });
    return;
  }
  if (message.method === 'ping') {
    reply({ jsonrpc: '2.0', id, result: {} });
    return;
  }
  if (message.method === 'tools/list') {
    reply({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name;
    const method = HANDLERS[name];
    if (!method) {
      errorReply(id, -32602, 'Unknown tool.');
      return;
    }
    try {
      const value = await gateway[method](message.params?.arguments ?? {});
      reply({ jsonrpc: '2.0', id, result: toolEnvelope(value) });
    } catch (error) {
      process.stderr.write(`[mastermind-context-gateway] ${error?.code ?? 'ERROR'}: ${String(error?.message ?? error).replace(/[\r\n]+/g, ' ').slice(0, 240)}\n`);
      reply({ jsonrpc: '2.0', id, result: toolError(error) });
    }
    return;
  }
  errorReply(id, -32601, 'Method not found');
}

export async function startMcpServer({ gateway, input = process.stdin } = {}) {
  const activeGateway = gateway ?? createGatewayFromEnvironment(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'));
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  process.stderr.write(`[mastermind-context-gateway] ready v${SERVER_VERSION}\n`);
  for await (const line of lines) {
    if (!line.trim()) continue;
    if (line.length > MAX_REQUEST_CHARS) {
      errorReply(null, -32600, 'Request exceeds the 64 KiB limit.');
      continue;
    }
    try { await handleMessage(activeGateway, JSON.parse(line)); }
    catch { errorReply(null, -32700, 'Parse error'); }
  }
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  startMcpServer().catch((error) => {
    process.stderr.write(`[mastermind-context-gateway] startup failed: ${String(error?.message ?? error).replace(/[\r\n]+/g, ' ').slice(0, 240)}\n`);
    process.exitCode = 1;
  });
}
