import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { userSecrets, sessions, userPreferences } from '@/lib/db/schema';
import { eq, and, count } from 'drizzle-orm';
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

export async function GET(request: NextRequest) {
  try {
    const session = await verifySession();
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId || userId !== session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get count of stored secrets
    const secretsCount = await db
      .select({ count: count() })
      .from(userSecrets)
      .where(
        and(
          eq(userSecrets.userId, userId),
          eq(userSecrets.isActive, true)
        )
      );

    // Get user preferences to calculate other stats
    const preferencesResult = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    let scrollsCreated = 0;
    let scrollsMinted = 0;
    let storageUsed = 0;
    let projectsActive = 0;

    if (preferencesResult.length > 0) {
      const preferences = preferencesResult[0].preferences as any;
      const stats = preferences.userStats || {};
      
      scrollsCreated = stats.scrollsCreated || 0;
      scrollsMinted = stats.scrollsMinted || 0;
      storageUsed = stats.storageUsed || 0;
      projectsActive = stats.projectsActive || 0;
    }

    // Calculate success rate
    const mintingSuccess = scrollsCreated > 0 ? Math.round((scrollsMinted / scrollsCreated) * 100) : 0;

    const userStats = {
      scrollsCreated,
      scrollsMinted,
      storageUsed,
      projectsActive,
      mintingSuccess,
      secretsStored: secretsCount[0].count
    };

    return NextResponse.json(userStats);
  } catch (error) {
    console.error('Stats get error:', error);
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

export async function POST(request: NextRequest) {
  try {
    const session = await verifySession();
    const { userId, stats } = await request.json();

    if (!userId || userId !== session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!stats || typeof stats !== 'object') {
      return NextResponse.json({ error: 'Invalid stats data' }, { status: 400 });
    }

    // Check if user preferences exist
    const existingPrefs = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    if (existingPrefs.length === 0) {
      // Create new preferences record
      await db.insert(userPreferences).values({
        userId,
        preferences: {
          userStats: stats
        }
      });
    } else {
      // Update existing preferences
      const currentPrefs = existingPrefs[0].preferences as any;
      const updatedPrefs = {
        ...currentPrefs,
        userStats: stats
      };

      await db
        .update(userPreferences)
        .set({ 
          preferences: updatedPrefs,
          updatedAt: new Date()
        })
        .where(eq(userPreferences.userId, userId));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Stats update error:', error);
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