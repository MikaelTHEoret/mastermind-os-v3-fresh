// src/app/api/embodiment/self-test/route.ts — preview-only, content-free acceptance probe for the shared gateway.
import { NextResponse } from 'next/server';
import { createEmbodimentSession } from '@/lib/mastermind-context/gateway';
import {
  GatewayPrincipal,
  internalGatewayScopes,
  safeError,
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

function warningMessages(value: unknown): string[] {
  return list(value).map((item) => safeError(item)).filter(Boolean).slice(0, 12);
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

  try {
    const session = await createEmbodimentSession(principal, {
      project: process.env.MASTERMIND_DEFAULT_PROJECT || 'mastermind',
      intent: 'Validate the Mastermind embodiment gateway across identity, continuity, memory, archive, and safety boundaries.',
      scopes: internalGatewayScopes(),
      budget: 6_000,
    });

    const identity = record(session.identity);
    const context = record(session.contextPack);
    const status = record(session.status);
    const database = record(status.database);
    const retrieval = record(status.retrieval);
    const safety = record(status.safety);
    const sections = record(context.sections);
    const continuity = record(context.continuity);
    const capabilities = list(session.capabilities).map(record);
    const warnings = warningMessages(context.warnings);

    const counts = {
      identityToolbox: list(sections.L0_identity_toolbox_and_principles).length,
      projectContext: list(sections.L1_project_context).length,
      tasks: list(sections.L2_active_tasks_and_checkpoints).length,
      memories: list(sections.L3_relevant_curated_memories).length,
      archiveEvidence: list(sections.L4_archive_evidence).length,
      sourceReferences: list(context.sourceRefs).length,
      warnings: warnings.length,
    };

    const consequentialAvailable = capabilities.some((capability) =>
      capability.available === true &&
      (capability.risk === 'write' || capability.risk === 'consequential'),
    );

    const checks = {
      canonicalOwnerConfigured: true,
      canonicalIdentity: identity.canonicalName === 'Mastermind',
      providerIndependentIdentity: identity.providerIndependent === true,
      databaseConnected: database.connected === true,
      contextPackBuilt: context.ok === true,
      identityContextRecovered: counts.identityToolbox > 0,
      projectContextRecovered: counts.projectContext > 0,
      memoryRetrievalReturned: counts.memories > 0,
      archiveRetrievalReturned: counts.archiveEvidence > 0,
      stableSourceReferencesReturned: counts.sourceReferences > 0,
      continuityEnvelopePresent: Object.keys(continuity).length > 0,
      lexicalRetrievalAvailable: retrieval.lexicalAvailable === true,
      noRawSqlTool: safety.rawSqlExposed === false,
      noShellTool: safety.shellExposed === false,
      noArbitraryUrlTool: safety.arbitraryUrlExposed === false,
      noConsequentialCapabilityEnabled: consequentialAvailable === false,
    };

    const critical = [
      checks.canonicalIdentity,
      checks.providerIndependentIdentity,
      checks.databaseConnected,
      checks.contextPackBuilt,
      checks.identityContextRecovered,
      checks.projectContextRecovered,
      checks.memoryRetrievalReturned,
      checks.archiveRetrievalReturned,
      checks.stableSourceReferencesReturned,
      checks.lexicalRetrievalAvailable,
      checks.noRawSqlTool,
      checks.noShellTool,
      checks.noArbitraryUrlTool,
      checks.noConsequentialCapabilityEnabled,
    ].every(Boolean);

    return NextResponse.json(
      {
        ok: critical,
        phase: 'shared-gateway-data-plane',
        checks,
        counts,
        continuity: {
          activeTaskRecovered: Boolean(continuity.activeTaskId),
          currentRevision: typeof continuity.currentRevision === 'number'
            ? continuity.currentRevision
            : null,
          checkpointRecovered: Boolean(continuity.latestCheckpoint),
        },
        retrieval: {
          lexicalAvailable: retrieval.lexicalAvailable === true,
          denseConfigured: retrieval.denseConfigured === true,
          fusion: retrieval.fusion || null,
        },
        warnings,
      },
      {
        status: critical ? 200 : 503,
        headers: { 'cache-control': 'no-store' },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        phase: 'shared-gateway-data-plane',
        error: safeError(error),
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
