import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { userSecrets } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getIronSession } from 'iron-session';
import CryptoJS from 'crypto-js';

// Define session data interface
interface SessionData {
  userId?: string;
  username?: string;
  email?: string;
}

const sessionOptions = {
  password: process.env.SECRET_KEY!,
  cookieName: 'mastermind-session',
  ttl: 60 * 60 * 24 * 7, // 7 days
};

async function getUserSecret(userId: string, serviceName: string): Promise<string | null> {
  try {
    const secret = await db
      .select()
      .from(userSecrets)
      .where(and(
        eq(userSecrets.userId, userId),
        eq(userSecrets.serviceName, serviceName),
        eq(userSecrets.isActive, true)
      ))
      .limit(1);

    if (secret.length === 0) {
      return null;
    }

    // Decrypt the secret
    const encryptionKey = process.env.ENCRYPTION_KEY!;
    const iv = CryptoJS.enc.Hex.parse(secret[0].encryptedIv);
    const decrypted = CryptoJS.AES.decrypt(secret[0].encryptedValue, encryptionKey, { iv });
    
    return decrypted.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error('Error decrypting secret:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getIronSession<SessionData>(request, new Response(), sessionOptions);
    
    if (!session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const metadata = formData.get('metadata') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Get user's Pinata API keys
    const apiKey = await getUserSecret(session.userId, 'pinata_api_key');
    const secretKey = await getUserSecret(session.userId, 'pinata_secret_key');

    if (!apiKey || !secretKey) {
      return NextResponse.json(
        { error: 'Pinata API keys not configured. Please add them in Settings.' },
        { status: 400 }
      );
    }

    // Prepare Pinata upload
    const pinataFormData = new FormData();
    pinataFormData.append('file', file);
    
    if (metadata) {
      pinataFormData.append('pinataMetadata', metadata);
    }

    // Additional metadata to track user and source
    const enhancedMetadata = JSON.stringify({
      ...JSON.parse(metadata || '{}'),
      source: 'mastermind_os',
      user_id: session.userId,
      uploaded_at: new Date().toISOString()
    });
    pinataFormData.append('pinataMetadata', enhancedMetadata);

    // Upload to Pinata
    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'pinata_api_key': apiKey,
        'pinata_secret_api_key': secretKey,
      },
      body: pinataFormData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pinata upload failed: ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();

    // Log the upload for the user
    await logUserActivity(session.userId, 'pinata_upload', {
      ipfs_hash: result.IpfsHash,
      file_name: file.name,
      file_size: file.size,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      ipfsHash: result.IpfsHash,
      pinSize: result.PinSize,
      timestamp: result.Timestamp,
      message: 'File uploaded to IPFS successfully'
    });

  } catch (error) {
    console.error('Pinata upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getIronSession<SessionData>(request, new Response(), sessionOptions);
    
    if (!session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's Pinata API keys
    const apiKey = await getUserSecret(session.userId, 'pinata_api_key');
    const secretKey = await getUserSecret(session.userId, 'pinata_secret_key');

    if (!apiKey || !secretKey) {
      return NextResponse.json(
        { error: 'Pinata API keys not configured' },
        { status: 400 }
      );
    }

    // Get user's pinned files
    const response = await fetch('https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=100', {
      method: 'GET',
      headers: {
        'pinata_api_key': apiKey,
        'pinata_secret_api_key': secretKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch pinned files: ${response.statusText}`);
    }

    const result = await response.json();

    // Filter files uploaded from this system
    const userFiles = result.rows.filter((pin: any) => 
      pin.metadata?.keyvalues?.source === 'mastermind_os'
    );

    return NextResponse.json({
      success: true,
      files: userFiles,
      count: userFiles.length
    });

  } catch (error) {
    console.error('Error fetching Pinata files:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch files' },
      { status: 500 }
    );
  }
}

async function logUserActivity(userId: string, action: string, details: any) {
  try {
    // This would integrate with your audit log system
    // For now, just console log for development
    console.log(`User Activity: ${userId} - ${action}`, details);
  } catch (error) {
    console.error('Error logging user activity:', error);
  }
}
