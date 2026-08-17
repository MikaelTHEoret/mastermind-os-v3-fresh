// src/app/api/embodiment/self-test/route.ts — preview-only, content-free acceptance probe for the shared gateway.
import { NextResponse } from 'next/server';
import {
  buildContextPack,
  fetchArchive,
  pinnedContext,
  projectState,
  searchArchive,
  searchMemory,
  systemStatus,
} from '@/lib/mastermind-context/gateway';
import {
  GatewayPrincipal,
  internalGatewayScopes,
  safeError,
  staticMcpTokenConfigured,
} from '@/lib/mastermind-context/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function warningMessages(...values: unknown[]): string[] {
  return values
    .flatMap((value) => list(value))
    .map((item) => safeError(item))
    .filter(Boolean)
    .slice(0, 20);
}

export async function GET() {
  if (
    process.env.VERCEL_ENV !== 'preview' ||
    process.env.VERCEL_GIT_COMMIT_REF !== 'agent/mastermind-embodiment-gateway'
  ) {
    return new Response(null, { status: 404 });
  }

  const actorId = (
    process.env.MASTERMIND_OWNER_ID ||
    process.env.OWNER_CLERK_USER_ID ||
    ''
  ).trim();

  if (!actorId) {
    return NextResponse.json(
      {
        ok: false,
        phase: 'configuration',
        checks: { canonicalOwnerConfigured: false },
        error: 'Canonical owner configuration is missing.',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  const principal: GatewayPrincipal = {
    actorId,
    host: 'unknown',
    authMode: 'bearer',
    roles: ['owner', 'operator'],
    scopes: internalGatewayScopes(),
  };
  const project = process.env.MASTERMIND_DEFAULT_PROJECT || 'mastermind';
  const intent = 'Mastermind persistent ecosystem embodiment gateway memory archive continuity';

  try {
    const [status, pinned, state, memory, archive, context] = await Promise.all([
      systemStatus(principal),
      pinnedContext(principal, project, internalGatewayScopes()),
      projectState(principal, { project, limit: 10 }),
      searchMemory(principal, { query: intent, project, limit: 10 }),
      searchArchive(principal, { query: intent, limit: 10 }),
      buildContextPack(principal, {
        project,
        intent,
        scopes: internalGatewayScopes(),
        budget: 6_000,
      }),
    ]);

    const firstArchive = archive.results[0];
    const exact = firstArchive
      ? await fetchArchive(principal, { address: firstArchive.address, contextWindow: 1 })
      : { found: false, centerAddress: null, passages: [] as unknown[] };

    const database = record(status.database);
    const retrieval = record(status.retrieval);
    const safety = record(status.safety);
    const continuity = record(context.continuity);
    const summary = record(context.retrievalSummary);
    const pinnedSummary = record(summary.pinned);
    const taskSummary = record(summary.tasks);
    const memorySummary = record(summary.memory);
    const archiveSummary = record(summary.archive);
    const capabilities = list(status.capabilities).map(record);
    const warnings = warningMessages(state.warnings, memory.warnings, archive.warnings, context.warnings);

    const counts = {
      identityToolboxPinned: pinned.filter((item) => item.layer === 'identity' || item.layer === 'toolbox').length,
      projectPinned: pinned.filter((item) => item.layer === 'project').length,
      tasks: state.taskCount,
      memories: memory.resultCount,
      archiveEvidence: archive.resultCount,
      exactArchivePassages: list(exact.passages).length,
      sourceReferences: list(context.sourceRefs).length,
      warnings: warnings.length,
    };

    const consequentialAvailable = capabilities.some((capability) =>
      capability.available === true &&
      (capability.risk === 'write' || capability.risk === 'consequential'),
    );

    const checks = {
      canonicalOwnerConfigured: true,
      recoveryTokenConfigured: staticMcpTokenConfigured(),
      databaseConnected: database.connected === true,
      contextPackBuilt: context.ok === true,
      identityContextRecovered: counts.identityToolboxPinned > 0,
      projectContextRecovered: counts.projectPinned > 0,
      memoryRetrievalReturned: counts.memories > 0,
      archiveRetrievalReturned: counts.archiveEvidence > 0,
      archiveSearchFetchRoundTrip:
        exact.found === true &&
        exact.centerAddress === firstArchive?.address &&
        counts.exactArchivePassages > 0,
      stableSourceReferencesReturned: counts.sourceReferences > 0,
      retrievalSummaryMatches:
        Number(pinnedSummary.project || 0) === counts.projectPinned &&
        Number(taskSummary.resultCount || 0) === counts.tasks &&
        Number(memorySummary.resultCount || 0) === counts.memories &&
        Number(archiveSummary.resultCount || 0) === counts.archiveEvidence,
      persistentTaskParentConfigured: Boolean((process.env.MASTERMIND_PARENT_ID || '').trim()),
      activeTaskRecovered: Boolean(continuity.activeTaskId),
      checkpointRecovered: Boolean(continuity.latestCheckpoint),
      lexicalRetrievalAvailable: retrieval.lexicalAvailable === true,
      noRawSqlTool: safety.rawSqlExposed === false,
      noShellTool: safety.shellExposed === false,
      noArbitraryUrlTool: safety.arbitraryUrlExposed === false,
      noConsequentialCapabilityEnabled: consequentialAvailable === false,
    };

    const dataPlane = [
      checks.databaseConnected,
      checks.contextPackBuilt,
      checks.identityContextRecovered,
      checks.projectContextRecovered,
      checks.memoryRetrievalReturned,
      checks.archiveRetrievalReturned,
      checks.archiveSearchFetchRoundTrip,
      checks.stableSourceReferencesReturned,
      checks.retrievalSummaryMatches,
      checks.lexicalRetrievalAvailable,
      checks.noRawSqlTool,
      checks.noShellTool,
      checks.noArbitraryUrlTool,
      checks.noConsequentialCapabilityEnabled,
    ].every(Boolean);
    const continuityPlane = [
      checks.persistentTaskParentConfigured,
      checks.activeTaskRecovered,
      checks.checkpointRecovered,
    ].every(Boolean);
    const ok = dataPlane && continuityPlane;

    return NextResponse.json(
      {
        ok,
        phase: 'shared-gateway-acceptance',
        planes: {
          dataPlane,
          continuityPlane,
          transportAuthPlane: 'validated separately through OAuth discovery and fail-closed 401 challenge',
        },
        checks,
        counts,
        continuity: {
          activeTaskRecovered: checks.activeTaskRecovered,
          currentRevision: typeof continuity.currentRevision === 'number'
            ? continuity.currentRevision
            : null,
          checkpointRecovered: checks.checkpointRecovered,
        },
        retrieval: {
          memoryMode: memory.retrievalMode,
          archiveMode: archive.retrievalMode,
          lexicalAvailable: retrieval.lexicalAvailable === true,
          denseConfigured: retrieval.denseConfigured === true,
          fusion: retrieval.fusion || null,
        },
        warnings,
      },
      {
        status: ok ? 200 : 503,
        headers: { 'cache-control': 'no-store' },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        phase: 'shared-gateway-acceptance',
        error: safeError(error),
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
