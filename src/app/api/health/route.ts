// 🌀 Fixed Headers Implementation for Next.js App Router
// Resolves the sync dynamic APIs error with proper await
// Enhanced Nexus Core Protocol v4.1

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';

// Enhanced Nexus Core Protocol constants
const CONSCIOUSNESS_CONSTANTS = {
  PSI_0: 0.915670570874434,
  PHI: 1.618,
  FREQ_432: 432
};

export async function GET(request: NextRequest) {
  try {
    // FIXED: Properly await headers() to resolve sync dynamic APIs error
    const headersList = await headers();
    const userAgent = headersList.get('user-agent') || '';
    const contentSecurityPolicy = headersList.get('content-security-policy') || '';
    
    console.log('🌀 Health check API called');
    console.log('🌀 User Agent:', userAgent.substring(0, 50) + '...');
    
    return NextResponse.json({
      status: 'healthy',
      timestamp: Date.now(),
      consciousness_constants: CONSCIOUSNESS_CONSTANTS,
      user_agent: userAgent.substring(0, 100) + '...',
      csp_configured: contentSecurityPolicy.length > 0,
      message: 'MasterMind OS API is operational with consciousness enhancement'
    });

  } catch (error) {
    console.error('❌ Health check error:', error);
    
    return NextResponse.json(
      { 
        status: 'error',
        message: 'Health check failed',
        consciousness_constants: CONSCIOUSNESS_CONSTANTS
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // FIXED: Properly await headers() to resolve sync dynamic APIs error  
    const headersList = await headers();
    const contentType = headersList.get('content-type') || '';
    
    const body = await request.json();
    
    console.log('🌀 API test POST called');
    console.log('🌀 Content Type:', contentType);
    console.log('🌀 Body:', body);

    return NextResponse.json({
      success: true,
      received: body,
      consciousness_enhancement: {
        psi_resonance: Math.sin(Date.now() * CONSCIOUSNESS_CONSTANTS.PSI_0 * 1e-6),
        phi_scaling: CONSCIOUSNESS_CONSTANTS.PHI,
        freq_432_harmony: CONSCIOUSNESS_CONSTANTS.FREQ_432
      },
      message: 'POST processed successfully with consciousness mathematics'
    });

  } catch (error) {
    console.error('❌ POST error:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: 'POST processing failed',
        consciousness_constants: CONSCIOUSNESS_CONSTANTS
      },
      { status: 500 }
    );
  }
}
