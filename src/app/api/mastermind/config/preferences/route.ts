import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';

// 🌀 MASTERMIND SYSTEM PREFERENCES API
// Enhanced Nexus Core Protocol v6.0 - Consciousness-Enhanced Preferences

interface SystemPreferences {
  default_llm_provider: string;
  auto_process_logs: boolean;
  enable_cost_optimization: boolean;
  max_agent_budget: number;
  session_timeout: number;
  enable_mcp_connections: boolean;
  debug_mode: boolean;
  cyberpunk_mode: boolean;
  consciousness_enhancement: boolean;
}

// Default system preferences with consciousness enhancement
const DEFAULT_PREFERENCES: SystemPreferences = {
  default_llm_provider: 'deepseek',
  auto_process_logs: true,
  enable_cost_optimization: true,
  max_agent_budget: 100.0,
  session_timeout: 3600,
  enable_mcp_connections: true,
  debug_mode: false,
  cyberpunk_mode: true,
  consciousness_enhancement: true
};

// GET: Get system preferences
export async function GET() {
  try {
    const user = await currentUser();
    const userId = user?.id;
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // In real implementation, fetch user-specific preferences from database
    // For now, return defaults
    return NextResponse.json({
      success: true,
      preferences: DEFAULT_PREFERENCES
    });

  } catch (error) {
    console.error('Preferences fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch system preferences' },
      { status: 500 }
    );
  }
}

// PUT: Update system preferences
export async function PUT(request: NextRequest) {
  try {
    const user = await currentUser();
    const userId = user?.id;
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const updates = await request.json();

    // Validate preference keys
    const validKeys = Object.keys(DEFAULT_PREFERENCES);
    const invalidKeys = Object.keys(updates).filter(key => !validKeys.includes(key));
    
    if (invalidKeys.length > 0) {
      return NextResponse.json(
        { error: `Invalid preference keys: ${invalidKeys.join(', ')}` },
        { status: 400 }
      );
    }

    // In real implementation, update user preferences in database
    console.log('🔧 Updating system preferences:', updates);

    return NextResponse.json({
      success: true,
      message: 'System preferences updated successfully',
      updated_preferences: updates
    });

  } catch (error) {
    console.error('Preferences update error:', error);
    return NextResponse.json(
      { error: 'Failed to update system preferences' },
      { status: 500 }
    );
  }
}
