import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { sourcesConfigService } from '@/lib/services/sourcesConfigService';

// 🌀 MASTERMIND SOURCES CONFIGURATION API
// Enhanced Nexus Core Protocol v6.0 - Encrypted Database Integration

export async function GET() {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log(`📋 Loading sources for user ${userId}`);

    // Get configured sources from encrypted database
    const sources = await sourcesConfigService.getConfiguredSources(userId);

    return NextResponse.json({
      success: true,
      sources,
      count: sources.length
    });

  } catch (error) {
    console.error('Sources config fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sources configuration' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('🔥 POST /api/mastermind/config/sources - Starting request processing...');
    
    const { userId } = await auth();
    console.log('👤 User ID:', userId);
    
    if (!userId) {
      console.log('❌ No user ID found - returning 401');
      return NextResponse.json(
        { error: 'Unauthorized - No user session found' },
        { status: 401 }
      );
    }

    console.log('📥 Parsing request body...');
    let body;
    try {
      body = await request.json();
      console.log('📄 Request body:', JSON.stringify(body, null, 2));
    } catch (parseError) {
      console.error('❌ Failed to parse request body:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON in request body', details: parseError instanceof Error ? parseError.message : 'Unknown parse error' },
        { status: 400 }
      );
    }
    
    const { source } = body;
    
    if (!source || !source.type || !source.name) {
      console.log('❌ Invalid source configuration:', { hasSource: !!source, type: source?.type, name: source?.name });
      return NextResponse.json(
        { error: 'Invalid source configuration - missing type or name', received: source },
        { status: 400 }
      );
    }

    console.log(`💾 Saving source config for user ${userId}:`, {
      id: source.id,
      type: source.type,
      name: source.name,
      secretsCount: Object.keys(source.secrets || {}).length,
      hasSecrets: !!source.secrets,
      secretKeys: Object.keys(source.secrets || {})
    });

    console.log('🔄 Calling sourcesConfigService.saveSourceConfig...');
    
    try {
      // Save source configuration to encrypted database
      await sourcesConfigService.saveSourceConfig(userId, source);
      console.log('✅ Source config saved to database');
    } catch (saveError) {
      console.error('❌ Failed to save source config:', saveError);
      return NextResponse.json(
        { 
          error: 'Failed to save source configuration to database',
          details: saveError instanceof Error ? saveError.message : 'Unknown save error',
          stack: saveError instanceof Error ? saveError.stack : undefined
        },
        { status: 500 }
      );
    }

    // Test connection directly with the source data (don't wait for DB lookup)
    console.log('🧪 Testing connection...');
    
    let testResult = { success: false, error: 'Unknown error' };
    
    try {
      // Test connection based on source type
      if (source.type === 'deepseek') {
        const response = await fetch(`${source.secrets.base_url || 'https://api.deepseek.com'}/v1/models`, {
          headers: {
            'Authorization': `Bearer ${source.secrets.api_key}`,
            'Content-Type': 'application/json'
          }
        });
        testResult = { success: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` };
      } else if (source.type === 'groq') {
        const response = await fetch('https://api.groq.com/openai/v1/models', {
          headers: {
            'Authorization': `Bearer ${source.secrets.api_key}`,
            'Content-Type': 'application/json'
          }
        });
        testResult = { success: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` };
      } else if (source.type === 'openai') {
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: {
            'Authorization': `Bearer ${source.secrets.api_key}`
          }
        });
        testResult = { success: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` };
      } else if (source.type === 'anthropic') {
        // For Anthropic, just check if we have an API key (no public models endpoint)
        testResult = { success: !!source.secrets.api_key, error: !source.secrets.api_key ? 'No API key provided' : undefined };
      } else {
        testResult = { success: !!source.secrets.api_key, error: !source.secrets.api_key ? 'No API key provided' : undefined };
      }
    } catch (error) {
      testResult = { success: false, error: error instanceof Error ? error.message : 'Connection test failed' };
    }
    
    console.log('🔬 Test result:', testResult);

    // Update status based on test result
    const updatedSource = {
      ...source,
      status: testResult.success ? 'connected' : 'error',
      lastUpdated: new Date().toISOString()
    };

    const response = {
      success: true,
      message: 'Source configuration saved successfully',
      source: updatedSource,
      test_result: testResult
    };

    console.log('📤 Sending response:', response);

    return NextResponse.json(response);

  } catch (error) {
    console.error('❌ CRITICAL: Sources config save error:', error);
    console.error('❌ Error type:', typeof error);
    console.error('❌ Error constructor:', error?.constructor?.name);
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    const errorResponse = { 
      error: 'Failed to save source configuration - Critical error in API handler',
      details: error instanceof Error ? error.message : 'Unknown error type',
      errorType: error?.constructor?.name || typeof error,
      timestamp: new Date().toISOString()
    };
    
    console.error('❌ Sending error response:', errorResponse);
    
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get('id');

    if (!sourceId) {
      return NextResponse.json(
        { error: 'Source ID is required' },
        { status: 400 }
      );
    }

    // Delete source configuration
    await sourcesConfigService.deleteSourceConfig(userId, sourceId);

    return NextResponse.json({
      success: true,
      message: 'Source configuration deleted successfully'
    });

  } catch (error) {
    console.error('Sources config delete error:', error);
    return NextResponse.json(
      { error: 'Failed to delete source configuration' },
      { status: 500 }
    );
  }
}