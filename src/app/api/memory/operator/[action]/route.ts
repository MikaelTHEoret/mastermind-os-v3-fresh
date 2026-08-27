import { getMemoryDb } from '@/lib/db';
import {
  MemoryOperatorSessionRegistry,
  MemoryOperatorUnlockCoordinator,
  MemoryOperatorUnlockLimiter,
} from '@/lib/memory/operator-auth';
import { handleMemoryOperatorPost } from '@/lib/memory/operator';
import { requireOwner } from '@/lib/trading/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const limiter = new MemoryOperatorUnlockLimiter();
const sessions = new MemoryOperatorSessionRegistry();
const unlocks = new MemoryOperatorUnlockCoordinator();

export async function POST(
  request: Request,
  context: Readonly<{ params: Promise<{ action: string }> }>,
): Promise<Response> {
  const { action } = await context.params;
  return handleMemoryOperatorPost(request, action, {
    env: {
      MASTERMIND_LOCAL_CONTROL_ENABLED: process.env.MASTERMIND_LOCAL_CONTROL_ENABLED,
      MASTERMIND_CONTROL_TOKEN: process.env.MASTERMIND_CONTROL_TOKEN,
      MASTERMIND_LOCAL_SUPERVISOR_ID: process.env.MASTERMIND_LOCAL_SUPERVISOR_ID,
      MASTERMIND_MEMORY_OPERATOR_PIN_SCRYPT: process.env.MASTERMIND_MEMORY_OPERATOR_PIN_SCRYPT,
      MASTERMIND_MEMORY_OPERATOR_PLAYER_ID: process.env.MASTERMIND_MEMORY_OPERATOR_PLAYER_ID,
      MASTERMIND_MEMORY_HOUSEHOLD_ID: process.env.MASTERMIND_MEMORY_HOUSEHOLD_ID,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
      OWNER_CLERK_USER_ID: process.env.OWNER_CLERK_USER_ID,
      VERCEL: process.env.VERCEL,
    },
    getSql: getMemoryDb,
    limiter,
    sessions,
    unlocks,
    requireOwner,
  });
}
