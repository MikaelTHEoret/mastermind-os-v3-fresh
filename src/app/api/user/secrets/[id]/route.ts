import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { userSecrets, sessions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { cookies } from 'next/headers';

// Helper function to verify session
async function verifySession() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;

  if (!sessionToken) {
    throw new Error('No session found');
  }

  const sessionResult = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionToken),
        eq(sessions.isActive, true)
      )
    )
    .limit(1);

  if (sessionResult.length === 0) {
    throw new Error('Invalid session');
  }

  const session = sessionResult[0];

  if (new Date() > session.expiresAt) {
    await db
      .update(sessions)
      .set({ isActive: false })
      .where(eq(sessions.id, sessionToken));
    throw new Error('Session expired');
  }

  return session;
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await verifySession();
    const { id } = params;

    if (!id) {
      return NextResponse.json({ error: 'Secret ID required' }, { status: 400 });
    }

    // Verify the secret belongs to the authenticated user
    const secret = await db
      .select()
      .from(userSecrets)
      .where(eq(userSecrets.id, id))
      .limit(1);

    if (secret.length === 0) {
      return NextResponse.json({ error: 'Secret not found' }, { status: 404 });
    }

    if (secret[0].userId !== session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Delete the secret
    await db
      .delete(userSecrets)
      .where(eq(userSecrets.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Secret deletion error:', error);
    // Type guard to check if error is an Error object
    if (error instanceof Error && (error.message.includes('session') || error.message.includes('Unauthorized'))) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}