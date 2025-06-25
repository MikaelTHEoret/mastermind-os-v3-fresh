import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { userSecrets, sessions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { simpleEncrypt, simpleDecrypt } from '@/lib/encryption';
import crypto from 'crypto';

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

    // Get user secrets (without decrypted values for security)
    const secrets = await db
      .select({
        id: userSecrets.id,
        serviceName: userSecrets.serviceName,
        secretType: userSecrets.secretType,
        description: userSecrets.description,
        isActive: userSecrets.isActive,
        expiresAt: userSecrets.expiresAt,
        createdAt: userSecrets.createdAt
      })
      .from(userSecrets)
      .where(eq(userSecrets.userId, userId))
      .orderBy(userSecrets.createdAt);

    return NextResponse.json(secrets);
  } catch (error) {
    console.error('Secrets get error:', error);
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
    const { userId, serviceName, secretType, value, description, expiresAt } = await request.json();

    if (!userId || userId !== session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!serviceName || !secretType || !value) {
      return NextResponse.json({ 
        error: 'Missing required fields: serviceName, secretType, value' 
      }, { status: 400 });
    }

    // Generate IV for encryption
    const iv = crypto.randomBytes(16);
    
    // Encrypt the secret value
    const encryptedValue = simpleEncrypt(value);

    // Insert new secret
    const newSecret = await db
      .insert(userSecrets)
      .values({
        userId,
        serviceName,
        secretType,
        encryptedValue,
        encryptedIv: iv.toString('hex'),
        description: description || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        isActive: true
      })
      .returning({
        id: userSecrets.id,
        serviceName: userSecrets.serviceName,
        secretType: userSecrets.secretType,
        description: userSecrets.description,
        isActive: userSecrets.isActive,
        expiresAt: userSecrets.expiresAt,
        createdAt: userSecrets.createdAt
      });

    return NextResponse.json(newSecret[0]);
  } catch (error) {
    console.error('Secret creation error:', error);
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