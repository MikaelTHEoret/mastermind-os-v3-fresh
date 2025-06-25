import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { sourcesConfigService } from '@/lib/services/sourcesConfigService';

export async function POST() {
  try {
    console.log('🧪 TEST: Simulating dashboard API configuration save...');
    
    const { userId } = await auth();
    console.log('👤 TEST User ID:', userId);
    
    if (!userId) {
      return NextResponse.json({
        error: 'TEST: No user authenticated',
        authState: 'unauthenticated'
      }, { status: 401 });
    }

    // Create a test source configuration
    const testSource = {
      id: `test_deepseek_${Date.now()}`,
      type: 'deepseek',
      name: 'Test DeepSeek Configuration',
      secrets: {
        api_key: 'test_api_key_123',
        base_url: 'https://api.deepseek.com'
      },
      status: 'disconnected',
      lastUpdated: new Date().toISOString()
    };

    console.log('💾 TEST: Saving test source config:', testSource);

    // Try to save it
    await sourcesConfigService.saveSourceConfig(userId, testSource);
    
    console.log('✅ TEST: Save completed successfully');

    // Try to retrieve it back
    const sources = await sourcesConfigService.getConfiguredSources(userId);
    const savedSource = sources.find(s => s.id === testSource.id);

    return NextResponse.json({
      status: 'success',
      message: 'TEST: API configuration save/retrieve test completed',
      testSource,
      savedSource,
      totalSources: sources.length,
      userId
    });

  } catch (error) {
    console.error('❌ TEST: API configuration test failed:', error);
    return NextResponse.json({
      error: 'TEST: API configuration test failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}