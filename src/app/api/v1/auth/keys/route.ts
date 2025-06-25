import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

// Database connection
const sql = neon(process.env.DATABASE_URL!);

// API key validation endpoint
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiKey, action, permissions } = body;

    if (!apiKey) {
      return NextResponse.json({ error: 'API key is required' }, { status: 400 });
    }

    // Validate API key
    const [keyRecord] = await sql`
      SELECT 
        id,
        user_id,
        name,
        permissions,
        is_active,
        usage_count,
        usage_limit,
        last_used
      FROM mastermind_api_keys 
      WHERE api_key = ${apiKey}
    `;

    if (!keyRecord) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    if (!keyRecord.is_active) {
      return NextResponse.json({ error: 'API key is disabled' }, { status: 403 });
    }

    // Check usage limits
    if (keyRecord.usage_count >= keyRecord.usage_limit) {
      return NextResponse.json({ error: 'API key usage limit exceeded' }, { status: 429 });
    }

    // Check permissions if required
    if (permissions && permissions.length > 0) {
      const keyPermissions = keyRecord.permissions || [];
      const hasPermission = permissions.every((perm: string) => 
        keyPermissions.includes(perm)
      );

      if (!hasPermission) {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
      }
    }

    // Update usage tracking
    await sql`
      UPDATE mastermind_api_keys 
      SET 
        usage_count = usage_count + 1,
        last_used = NOW()
      WHERE id = ${keyRecord.id}
    `;

    return NextResponse.json({
      success: true,
      valid: true,
      userId: keyRecord.user_id,
      keyName: keyRecord.name,
      permissions: keyRecord.permissions || [],
      usage: {
        current: keyRecord.usage_count + 1,
        limit: keyRecord.usage_limit
      }
    });

  } catch (error) {
    console.error('Error validating API key:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to validate API key'
    }, { status: 500 });
  }
}

// Get API key info (without incrementing usage)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const apiKey = searchParams.get('key');

    if (!apiKey) {
      return NextResponse.json({ error: 'API key parameter is required' }, { status: 400 });
    }

    // Get API key info
    const [keyRecord] = await sql`
      SELECT 
        id,
        user_id,
        name,
        permissions,
        is_active,
        usage_count,
        usage_limit,
        created_at,
        last_used
      FROM mastermind_api_keys 
      WHERE api_key = ${apiKey}
    `;

    if (!keyRecord) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      keyInfo: {
        id: keyRecord.id,
        name: keyRecord.name,
        permissions: keyRecord.permissions || [],
        isActive: keyRecord.is_active,
        usage: {
          current: keyRecord.usage_count,
          limit: keyRecord.usage_limit
        },
        createdAt: keyRecord.created_at,
        lastUsed: keyRecord.last_used
      }
    });

  } catch (error) {
    console.error('Error fetching API key info:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch API key info'
    }, { status: 500 });
  }
}
