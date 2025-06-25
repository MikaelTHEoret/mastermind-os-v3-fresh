import { NextResponse } from 'next/server';
import { sourcesConfigService } from '@/lib/services/sourcesConfigService';

export async function GET() {
  try {
    // Test the service state
    const serviceState = {
      hasService: !!sourcesConfigService,
      databaseUrl: !!process.env.DATABASE_URL,
      neonDatabaseUrl: !!process.env.NEON_DATABASE_URL,
      encryptionSecret: !!process.env.ENCRYPTION_SECRET,
      isServer: typeof window === 'undefined',
      timestamp: new Date().toISOString()
    };
    
    console.log('🔍 Service state check:', serviceState);
    
    return NextResponse.json({
      status: 'success',
      serviceState,
      message: 'Sources config service state checked'
    });
    
  } catch (error) {
    console.error('❌ Service state check failed:', error);
    return NextResponse.json({
      error: 'Service state check failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}