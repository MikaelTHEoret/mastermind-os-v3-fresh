import { NextRequest, NextResponse } from 'next/server';
import { LearningSystemInitializer } from '@/lib/engines/LearningSystemInitializer';

// Global learning system instance
let learningSystem: LearningSystemInitializer | null = null;

export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json();

    if (action === 'initialize') {
      if (learningSystem && await learningSystem.getLearningSystemStatus().then(s => s.status === 'OPERATIONAL')) {
        return NextResponse.json({
          success: true,
          message: 'Learning system already initialized',
          status: 'ALREADY_RUNNING'
        });
      }

      learningSystem = new LearningSystemInitializer();
      const initialized = await learningSystem.initializeLearningSystem();

      if (initialized) {
        return NextResponse.json({
          success: true,
          message: '🌀 ψ₀-Enhanced Learning System initialized successfully',
          status: 'INITIALIZED',
          timestamp: new Date().toISOString()
        });
      } else {
        return NextResponse.json({
          success: false,
          error: 'Failed to initialize learning system'
        }, { status: 500 });
      }
    } else if (action === 'shutdown') {
      if (!learningSystem) {
        return NextResponse.json({
          success: true,
          message: 'Learning system not running',
          status: 'NOT_RUNNING'
        });
      }

      await learningSystem.shutdown();
      learningSystem = null;

      return NextResponse.json({
        success: true,
        message: 'Learning system shutdown complete',
        status: 'SHUTDOWN',
        timestamp: new Date().toISOString()
      });
    } else if (action === 'restart') {
      // Shutdown existing system
      if (learningSystem) {
        await learningSystem.shutdown();
        learningSystem = null;
      }

      // Initialize new system
      learningSystem = new LearningSystemInitializer();
      const initialized = await learningSystem.initializeLearningSystem();

      return NextResponse.json({
        success: initialized,
        message: initialized ? 'Learning system restarted successfully' : 'Failed to restart learning system',
        status: initialized ? 'RESTARTED' : 'RESTART_FAILED',
        timestamp: new Date().toISOString()
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Invalid action. Use: initialize, shutdown, or restart'
    }, { status: 400 });

  } catch (error) {
    console.error('Learning system management error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to manage learning system',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!learningSystem) {
      return NextResponse.json({
        success: true,
        status: 'NOT_INITIALIZED',
        message: 'Learning system not initialized',
        timestamp: new Date().toISOString()
      });
    }

    const systemStatus = await learningSystem.getLearningSystemStatus();

    return NextResponse.json({
      success: true,
      system_status: systemStatus,
      timestamp: new Date().toISOString(),
      consciousness_enhancement: {
        psi_0: 0.915670570874434,
        phi: 1.618,
        freq_432: 432
      }
    });

  } catch (error) {
    console.error('Learning system status error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve learning system status',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}