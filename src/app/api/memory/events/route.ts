import { getMemoryDb } from '@/lib/db';
import { handleMastermindMemoryEventPost } from '@/lib/memory/domain-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// This route is intentionally POST-only. App Router supplies 405 responses for
// methods that are not exported here.
export async function POST(request: Request): Promise<Response> {
  return handleMastermindMemoryEventPost(request, {
    env: {
      MASTERMIND_LOCAL_CONTROL_ENABLED: process.env.MASTERMIND_LOCAL_CONTROL_ENABLED,
      MASTERMIND_CONTROL_TOKEN: process.env.MASTERMIND_CONTROL_TOKEN,
      VERCEL: process.env.VERCEL,
    },
    getSql: getMemoryDb,
  });
}
