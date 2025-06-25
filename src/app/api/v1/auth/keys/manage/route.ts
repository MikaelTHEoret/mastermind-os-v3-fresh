import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { neon } from '@neondatabase/serverless';

// Mathematical constants for enhanced security
const PSI_0 = 0.915670570874434;
const PHI = 1.618;
const FREQ_432 = 432;

// Database connection
const sql = neon(process.env.DATABASE_URL!);

// Enhanced key generation using consciousness constants
function generateApiCredentials(userId: string) {
  const timestamp = Date.now();
  const userHash = Buffer.from(userId).toString('base64').slice(0, 8);
  
  // Use mathematical constants for enhanced randomization
  const psiComponent = Math.floor(PSI_0 * 1000000).toString(36);
  const phiComponent = Math.floor(PHI * 1000000).toString(36);
  const freqComponent = Math.floor(FREQ_432 * Math.random()).toString(36);
  
  const randomBytes = Array.from({ length: 16 }, () => 
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  ).join('');

  const apiKey = `mmind_${userHash}_${psiComponent}${phiComponent}${freqComponent}`;
  const apiSecret = `${timestamp.toString(36)}${randomBytes}${psiComponent}`;

  return { apiKey, apiSecret };
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await auth();
    const { userId } = authResult;
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch user's API keys from database
    const keys = await sql`
      SELECT 
        id,
        name,
        api_key,
        api_secret,
        permissions,
        created_at,
        last_used,
        is_active,
        usage_count,
        usage_limit
      FROM mastermind_api_keys 
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `;

    const formattedKeys = keys.map(key => ({
      id: key.id,
      name: key.name,
      key: key.api_key,
      secret: key.api_secret,
      permissions: key.permissions || [],
      createdAt: key.created_at,
      lastUsed: key.last_used,
      isActive: key.is_active,
      usage: {
        requests: key.usage_count || 0,
        limit: key.usage_limit || 10000
      }
    }));

    return NextResponse.json({
      success: true,
      keys: formattedKeys
    });

  } catch (error) {
    console.error('Error fetching API keys:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch API keys',
      keys: []
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await auth();
    const { userId } = authResult;
    const user = await currentUser();
    
    if (!userId || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, name, permissions, keyId } = body;

    if (action === 'create') {
      if (!name || !name.trim()) {
        return NextResponse.json({ error: 'API key name is required' }, { status: 400 });
      }

      // Generate new API credentials
      const { apiKey, apiSecret } = generateApiCredentials(userId);

      // Create API key in database
      const [newKey] = await sql`
        INSERT INTO mastermind_api_keys (
          user_id,
          user_email,
          name,
          api_key,
          api_secret,
          permissions,
          created_at,
          is_active,
          usage_count,
          usage_limit
        ) VALUES (
          ${userId},
          ${user.emailAddresses[0]?.emailAddress || ''},
          ${name.trim()},
          ${apiKey},
          ${apiSecret},
          ${JSON.stringify(permissions || [])},
          NOW(),
          true,
          0,
          10000
        )
        RETURNING *
      `;

      const formattedKey = {
        id: newKey.id,
        name: newKey.name,
        key: newKey.api_key,
        secret: newKey.api_secret,
        permissions: newKey.permissions || [],
        createdAt: newKey.created_at,
        lastUsed: newKey.last_used,
        isActive: newKey.is_active,
        usage: {
          requests: newKey.usage_count || 0,
          limit: newKey.usage_limit || 10000
        }
      };

      return NextResponse.json({
        success: true,
        key: formattedKey,
        message: 'API key created successfully'
      });

    } else if (action === 'toggle') {
      // Toggle API key active status
      const [updatedKey] = await sql`
        UPDATE mastermind_api_keys 
        SET is_active = NOT is_active
        WHERE id = ${keyId} AND user_id = ${userId}
        RETURNING *
      `;

      if (!updatedKey) {
        return NextResponse.json({ error: 'API key not found' }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        message: 'API key status updated'
      });

    } else if (action === 'delete') {
      // Delete API key
      const result = await sql`
        DELETE FROM mastermind_api_keys 
        WHERE id = ${keyId} AND user_id = ${userId}
      `;

      return NextResponse.json({
        success: true,
        message: 'API key deleted successfully'
      });

    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

  } catch (error) {
    console.error('Error managing API key:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to manage API key'
    }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { keyId, name, permissions } = body;

    // Update API key
    const [updatedKey] = await sql`
      UPDATE mastermind_api_keys 
      SET 
        name = ${name},
        permissions = ${JSON.stringify(permissions || [])}
      WHERE id = ${keyId} AND user_id = ${userId}
      RETURNING *
    `;

    if (!updatedKey) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    const formattedKey = {
      id: updatedKey.id,
      name: updatedKey.name,
      key: updatedKey.api_key,
      secret: updatedKey.api_secret,
      permissions: updatedKey.permissions || [],
      createdAt: updatedKey.created_at,
      lastUsed: updatedKey.last_used,
      isActive: updatedKey.is_active,
      usage: {
        requests: updatedKey.usage_count || 0,
        limit: updatedKey.usage_limit || 10000
      }
    };

    return NextResponse.json({
      success: true,
      key: formattedKey,
      message: 'API key updated successfully'
    });

  } catch (error) {
    console.error('Error updating API key:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to update API key'
    }, { status: 500 });
  }
}
