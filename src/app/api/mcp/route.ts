// src/app/api/mcp/route.ts — OAuth-first Streamable HTTP MCP embodiment adapter.
import type { AuthInfo } from '@modelcontextprotocol/server';
import { auth } from '@clerk/nextjs/server';
import { verifyClerkToken } from '@clerk/mcp-tools/next';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import {
  buildContextPack,
  createEmbodimentSession,
  fetchArchive,
  projectState,
  searchArchive,
  searchMemory,
  systemStatus,
} from '@/lib/mastermind-context/gateway';
import {
  boundPayload,
  canonicalClerkOwnerId,
  canonicalOwnerId,
  GatewayPrincipal,
  inferMcpHost,
  internalGatewayScopes,
  isValidStaticMcpToken,
  safeError,
  safeHost,
} from '@/lib/mastermind-context/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_REQUEST_BYTES = 65_536;
const MAX_TOOL_PAYLOAD_BYTES = 24_000;

type ToolContext = { http?: { authInfo?: AuthInfo } };

function result(value: unknown) {
  // MCP sends both structuredContent and a text compatibility copy. Bound the
  // logical payload below half the transport cap so the combined result remains safe.
  const payload = boundPayload(value, MAX_TOOL_PAYLOAD_BYTES);
  return {
    structuredContent: payload,
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

function failure(error: unknown) {
  const payload = boundPayload(
    { ok: false, error: { code: 'MASTERMIND_TOOL_ERROR', message: safeError(error) } },
    MAX_TOOL_PAYLOAD_BYTES,
  );
  return {
    isError: true,
    structuredContent: payload,
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

function principalFromContext(context: ToolContext): GatewayPrincipal {
  const authInfo = context.http?.authInfo;
  const ownerId = canonicalOwnerId();
  const actorId = typeof authInfo?.extra?.userId === 'string' ? authInfo.extra.userId : '';
  if (!ownerId || !authInfo || actorId !== ownerId) {
    throw new Error('The MCP identity is not the canonical Mastermind owner.');
  }
  const authMode = authInfo.extra?.authMode === 'bearer' ? 'bearer' : 'clerk-oauth';
  return {
    actorId,
    host: safeHost(typeof authInfo.extra?.host === 'string' ? authInfo.extra.host : undefined),
    authMode,
    roles: ['owner', 'operator'],
    scopes: internalGatewayScopes(),
  };
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const handler = createMcpHandler((server) => {
  server.registerTool('mastermind_system_status', {
    title: 'Mastermind System Status',
    description: 'Inspect the authenticated embodiment gateway, existing Neon corpus, retrieval modes, and bounded capabilities.',
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  }, async (_input, context) => {
    try { return result(await systemStatus(principalFromContext(context))); }
    catch (error) { return failure(error); }
  });

  server.registerTool('mastermind_bootstrap', {
    title: 'Embodiment Bootstrap',
    description: 'Call first. Reconstruct Mastermind identity, project continuity, bounded context, provenance, and available faculties for this host.',
    inputSchema: z.object({
      project: z.string().min(1).max(120).default('mastermind'),
      intent: z.string().min(1).max(4_000),
      requestedScopes: z.array(z.enum(['identity', 'toolbox', 'project', 'task', 'memory', 'archive', 'minecraft-status'])).max(7).default(['identity', 'toolbox', 'project', 'task', 'memory', 'archive']),
      budget: z.number().int().min(1_000).max(12_000).default(6_000),
    }),
    annotations: READ_ONLY,
  }, async ({ project, intent, requestedScopes, budget }, context) => {
    try {
      return result(await createEmbodimentSession(principalFromContext(context), {
        project,
        intent,
        scopes: requestedScopes,
        budget,
      }));
    } catch (error) { return failure(error); }
  });

  server.registerTool('mastermind_context_pack', {
    title: 'Mastermind Context Pack',
    description: 'Build a bounded, source-addressed working-memory packet from canonical state, curated memory, tasks, and archive evidence.',
    inputSchema: z.object({
      project: z.string().min(1).max(120).default('mastermind'),
      intent: z.string().min(1).max(4_000),
      scopes: z.array(z.enum(['identity', 'toolbox', 'project', 'task', 'memory', 'archive', 'minecraft-status'])).max(7).default(['identity', 'toolbox', 'project', 'task', 'memory', 'archive']),
      budget: z.number().int().min(1_000).max(12_000).default(6_000),
    }),
    annotations: READ_ONLY,
  }, async (input, context) => {
    try { return result(await buildContextPack(principalFromContext(context), input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool('mastermind_memory_search', {
    title: 'Search Curated Mastermind Memory',
    description: 'Search harmonic memories after owner authorization. Uses hybrid vector/lexical fusion when the matching embedder is reachable.',
    inputSchema: z.object({
      query: z.string().min(1).max(4_000),
      project: z.string().min(1).max(120).default('mastermind'),
      layer: z.enum(['identity', 'toolbox', 'project', 'session']).nullable().default(null),
      limit: z.number().int().min(1).max(20).default(8),
    }),
    annotations: READ_ONLY,
  }, async (input, context) => {
    try { return result(await searchMemory(principalFromContext(context), input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool('mastermind_archive_search', {
    title: 'Search Mastermind Archive',
    description: 'Search the addressable transcript/document/code archive and return stable source addresses with diverse evidence.',
    inputSchema: z.object({
      query: z.string().min(1).max(4_000),
      sourceType: z.enum(['transcript', 'document', 'code', 'data', 'datasheet']).nullable().default(null),
      limit: z.number().int().min(1).max(20).default(8),
    }),
    annotations: READ_ONLY,
  }, async (input, context) => {
    try { return result(await searchArchive(principalFromContext(context), input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool('mastermind_archive_fetch', {
    title: 'Fetch Exact Archive Evidence',
    description: 'Fetch one exact stable archive address and bounded neighboring chunks from its source document.',
    inputSchema: z.object({
      address: z.string().min(1).max(512),
      contextWindow: z.number().int().min(0).max(5).default(2),
    }),
    annotations: READ_ONLY,
  }, async (input, context) => {
    try { return result(await fetchArchive(principalFromContext(context), input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool('mastermind_project_state', {
    title: 'Recover Persistent Project State',
    description: 'Read provider-independent tasks, immutable checkpoints, blockers, and recovery instructions for the owner-authorized project.',
    inputSchema: z.object({
      project: z.string().min(1).max(120).default('mastermind'),
      taskId: z.string().max(120).optional(),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    annotations: READ_ONLY,
  }, async (input, context) => {
    try { return result(await projectState(principalFromContext(context), input)); }
    catch (error) { return failure(error); }
  });
}, {
  serverInfo: { name: 'mastermind-embodiment-gateway', version: '0.1.0' },
  instructions: [
    'Call mastermind_bootstrap before assuming identity, project state, or unfinished work.',
    'Search before asserting remembered facts and preserve every returned memory ID or archive address.',
    'Treat canonical state, retrieved evidence, and model inference as distinct.',
    'Never request secrets. No shell, raw SQL, arbitrary URL, filesystem, or Minecraft action capability exists.',
  ].join(' '),
  maxSubscriptions: 0,
});

const verifyToken = async (request: Request, token?: string): Promise<AuthInfo | undefined> => {
  const ownerId = canonicalOwnerId();
  if (!ownerId || !token) return undefined;

  if (isValidStaticMcpToken(token)) {
    return {
      token,
      clientId: 'mastermind-owner-token',
      scopes: ['mastermind:read'],
      extra: {
        userId: ownerId,
        host: inferMcpHost(request, 'codex'),
        authMode: 'bearer',
      },
    };
  }

  const clerkOwnerId = canonicalClerkOwnerId();
  if (!clerkOwnerId || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
    return undefined;
  }
  const clerkAuth = await auth({ acceptsToken: 'oauth_token' });
  const verified = verifyClerkToken(clerkAuth, token) as unknown as AuthInfo | undefined;
  const clerkUserId = typeof verified?.extra?.userId === 'string' ? verified.extra.userId : '';
  if (!verified || clerkUserId !== clerkOwnerId) return undefined;
  return {
    token: verified.token,
    clientId: verified.clientId,
    scopes: verified.scopes,
    extra: {
      ...verified.extra,
      userId: ownerId,
      clerkUserId,
      host: inferMcpHost(request, verified.clientId),
      authMode: 'clerk-oauth',
    },
  };
};

const authenticatedHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
});

function requestTooLarge() {
  return new Response(JSON.stringify({
    ok: false,
    error: { code: 'REQUEST_TOO_LARGE', message: 'Request exceeds 64 KiB.' },
  }), {
    status: 413,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function guardedHandler(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) return requestTooLarge();
  if (request.method !== 'POST' || !request.body) return authenticatedHandler(request);

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_REQUEST_BYTES) return requestTooLarge();
  const checkedRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    signal: request.signal,
  });
  return authenticatedHandler(checkedRequest);
}

export { guardedHandler as GET, guardedHandler as POST };
