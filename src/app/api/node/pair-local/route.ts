import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  describeLocalNodePairingError,
  describeLocalNodePairingDiagnostic,
  processLocalNodePairingRequest,
} from '@/lib/node-pairing/local-pairing.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

type LocalCredentialStore = {
  beginPairing(pairingCredential: string, displayName: string): unknown;
};

let credentialStore: Promise<LocalCredentialStore> | null = null;

function getCredentialStore() {
  credentialStore ??= import('@/lib/node-pairing/store-factory.mjs').then((module) => (
    module.createLocalNodePairingCredentialStore(process.env)
  ));
  return credentialStore;
}

export async function POST(request: NextRequest) {
  try {
    const response = await processLocalNodePairingRequest(request, {
      environment: process.env,
      createCredentialStore: getCredentialStore,
    });
    return NextResponse.json(response, { status: 200, headers: RESPONSE_HEADERS });
  } catch (error) {
    const failure = describeLocalNodePairingError(error);
    if (failure.status >= 500) {
      const diagnostic = describeLocalNodePairingDiagnostic(error);
      console.error(
        `[mastermind-node-pair-local] failure name=${diagnostic.name} code=${diagnostic.code ?? 'NONE'}`,
      );
    }
    return NextResponse.json(failure.body, { status: failure.status, headers: RESPONSE_HEADERS });
  }
}
