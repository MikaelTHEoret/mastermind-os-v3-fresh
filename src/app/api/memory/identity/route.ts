import { getMemoryDb } from '@/lib/db';
import { handleMastermindIdentityPost } from '@/lib/memory/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleMastermindIdentityPost(request, {
    env: {
      MASTERMIND_LOCAL_CONTROL_ENABLED: process.env.MASTERMIND_LOCAL_CONTROL_ENABLED,
      MASTERMIND_CONTROL_TOKEN: process.env.MASTERMIND_CONTROL_TOKEN,
      VERCEL: process.env.VERCEL,
    },
    getSql: getMemoryDb,
  });
}
