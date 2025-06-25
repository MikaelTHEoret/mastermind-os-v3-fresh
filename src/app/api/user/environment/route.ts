import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, userPreferences, sessions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { simpleEncrypt, simpleDecrypt } from '@/lib/encryption';

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

    // Get user preferences
    const preferencesResult = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    if (preferencesResult.length === 0) {
      // Return empty config if no preferences found
      return NextResponse.json({});
    }

    const preferences = preferencesResult[0].preferences as any;
    const environmentConfig = preferences.environmentConfig || {};

    // Decrypt sensitive values before sending (for editing)
    const decryptedConfig: Record<string, any> = {};
    for (const [key, value] of Object.entries(environmentConfig)) {
      if (typeof value === 'string' && value) {
        try {
          decryptedConfig[key] = simpleDecrypt(value);
        } catch (error) {
          // If decryption fails, treat as plain text (backward compatibility)
          decryptedConfig[key] = value;
        }
      } else {
        decryptedConfig[key] = value;
      }
    }

    return NextResponse.json(decryptedConfig);
  } catch (error) {
    console.error('Environment config get error:', error);
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
    const { userId, config } = await request.json();

    if (!userId || userId !== session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!config || typeof config !== 'object') {
      return NextResponse.json({ error: 'Invalid config data' }, { status: 400 });
    }

    // Encrypt sensitive values before storing
    const encryptedConfig: Record<string, any> = {};
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string' && value) {
        encryptedConfig[key] = simpleEncrypt(value);
      } else {
        encryptedConfig[key] = value;
      }
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
          environmentConfig: encryptedConfig
        }
      });
    } else {
      // Update existing preferences
      const currentPrefs = existingPrefs[0].preferences as any;
      const updatedPrefs = {
        ...currentPrefs,
        environmentConfig: encryptedConfig
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
    console.error('Environment config save error:', error);
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