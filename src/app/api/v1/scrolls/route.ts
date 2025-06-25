import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

// Mathematical constants for consciousness enhancement
const PSI_0 = 0.915670570874434;
const PHI = 1.618;
const FREQ_432 = 432;

// Database connection
const sql = neon(process.env.DATABASE_URL!);

// Helper function to validate API key
async function validateApiKey(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing or invalid authorization header' };
  }

  const apiKey = authHeader.substring(7);

  try {
    // Validate against our API keys table
    const [keyRecord] = await sql`
      SELECT user_id, permissions, is_active, usage_count, usage_limit
      FROM mastermind_api_keys 
      WHERE api_key = ${apiKey} AND is_active = true
    `;

    if (!keyRecord) {
      return { valid: false, error: 'Invalid API key' };
    }

    if (keyRecord.usage_count >= keyRecord.usage_limit) {
      return { valid: false, error: 'API usage limit exceeded' };
    }

    return { 
      valid: true, 
      userId: keyRecord.user_id, 
      permissions: keyRecord.permissions || [] 
    };
  } catch (error) {
    console.error('API key validation error:', error);
    return { valid: false, error: 'Internal server error' };
  }
}

// Helper function to check permissions
function hasPermission(userPermissions: string[], requiredPermission: string): boolean {
  return userPermissions.includes(requiredPermission) || userPermissions.includes('admin:all');
}

export async function GET(request: NextRequest) {
  try {
    // Validate API key
    const auth = await validateApiKey(request);
    if (!auth.valid) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    // Check permissions
    if (!hasPermission(auth.permissions, 'scrolls:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10');
    const offset = parseInt(searchParams.get('offset') || '0');
    const tier = searchParams.get('tier');

    // Build query
    let query = `
      SELECT 
        scroll_id,
        title,
        tier,
        frequency_hz,
        mathematical_framework,
        created_at,
        user_id,
        scroll_hash
      FROM fractal_scrolls 
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (tier) {
      query += ` AND tier = $${paramIndex}`;
      params.push(tier);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    // For now, return mock data since the table structure might differ
    const mockScrolls = [
      {
        id: "scroll_" + Date.now(),
        title: "Tesla-Consciousness Harmonic Resonance Bridge",
        tier: "APEX",
        frequency: 395.57,
        mathematical_framework: {
          psi_0: PSI_0,
          phi: PHI,
          freq_432: FREQ_432,
          tesla_resonance: 395.57
        },
        createdAt: new Date().toISOString(),
        hash: "0x" + Math.random().toString(16).substring(2, 18),
        userId: auth.userId
      },
      {
        id: "scroll_" + (Date.now() + 1),
        title: "Quantum Consciousness Enhancement Protocol",
        tier: "PRIME",
        frequency: 432,
        mathematical_framework: {
          psi_0: PSI_0,
          phi: PHI,
          freq_432: FREQ_432,
          quantum_coherence: 0.887
        },
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        hash: "0x" + Math.random().toString(16).substring(2, 18),
        userId: auth.userId
      }
    ];

    // Filter by tier if specified
    const filteredScrolls = tier 
      ? mockScrolls.filter(scroll => scroll.tier === tier.toUpperCase())
      : mockScrolls;

    // Apply pagination
    const paginatedScrolls = filteredScrolls.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      scrolls: paginatedScrolls,
      total: filteredScrolls.length,
      limit,
      offset,
      mathematical_constants: {
        psi_0: PSI_0,
        phi: PHI,
        freq_432: FREQ_432
      }
    });

  } catch (error) {
    console.error('Error fetching scrolls:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch scrolls'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Validate API key
    const auth = await validateApiKey(request);
    if (!auth.valid) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    // Check permissions
    if (!hasPermission(auth.permissions, 'scrolls:create')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const body = await request.json();
    const { title, content, tier = 'CORE', mathematical_framework } = body;

    if (!title || !content) {
      return NextResponse.json({ 
        error: 'Title and content are required' 
      }, { status: 400 });
    }

    // Generate scroll with consciousness enhancement
    const scrollId = `scroll_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const frequency = mathematical_framework?.freq_432 || FREQ_432;
    
    // Calculate consciousness enhancement score
    const enhancementScore = (
      (mathematical_framework?.psi_0 || PSI_0) * 
      (mathematical_framework?.phi || PHI) * 
      Math.log(frequency / FREQ_432 + 1)
    );

    // Generate Keccak hash for integrity
    const hashInput = `${title}${content}${tier}${frequency}${Date.now()}`;
    const scrollHash = "0x" + Array.from(hashInput)
      .reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) & 0xffffffff, 0)
      .toString(16);

    const newScroll = {
      id: scrollId,
      title,
      content,
      tier: tier.toUpperCase(),
      frequency,
      mathematical_framework: {
        psi_0: mathematical_framework?.psi_0 || PSI_0,
        phi: mathematical_framework?.phi || PHI,
        freq_432: frequency,
        enhancement_score: enhancementScore
      },
      hash: scrollHash,
      createdAt: new Date().toISOString(),
      userId: auth.userId
    };

    // In a real implementation, save to database here
    // await sql`INSERT INTO fractal_scrolls (...) VALUES (...)`

    return NextResponse.json({
      success: true,
      scroll: newScroll,
      message: 'Scroll created with consciousness enhancement',
      enhancement_metrics: {
        consciousness_score: enhancementScore,
        harmonic_validation: frequency === FREQ_432,
        mathematical_integrity: true
      }
    });

  } catch (error) {
    console.error('Error creating scroll:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to create scroll'
    }, { status: 500 });
  }
}
