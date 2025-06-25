import { NextRequest, NextResponse } from 'next/server';

// Mock executions store - replace with actual database
let executions: any[] = [
  {
    id: '1',
    agent_id: '1',
    start_time: new Date('2024-12-10T14:30:00'),
    end_time: new Date('2024-12-10T14:45:00'),
    status: 'completed',
    steps_completed: 8,
    total_steps: 8,
    cost: 1.23,
    logs: [
      '🚀 Agent deployment initiated...',
      '📋 Analyzing current authentication state...',
      '🔧 Generated improved error handling code',
      '📝 Updated user flow components',
      '🚀 Deployed changes to staging',
      '✅ Verified authentication functionality',
      '📊 Generated performance report',
      '🏁 Execution completed successfully'
    ],
    results: {
      summary: 'Successfully improved authentication system',
      files_modified: [
        'src/components/auth/AuthFlow.tsx',
        'src/lib/auth.ts',
        'src/middleware.ts'
      ],
      tests_passed: 15,
      cost_efficiency: 0.92,
      performance_improvement: '23%'
    }
  }
];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');

    let filteredExecutions = executions;

    // Filter by agent ID if provided
    if (agentId) {
      filteredExecutions = filteredExecutions.filter(e => e.agent_id === agentId);
    }

    // Filter by status if provided
    if (status) {
      filteredExecutions = filteredExecutions.filter(e => e.status === status);
    }

    // Apply limit
    filteredExecutions = filteredExecutions.slice(0, limit);

    // Sort by start time (most recent first)
    filteredExecutions.sort((a, b) => 
      new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
    );

    return NextResponse.json({
      success: true,
      executions: filteredExecutions,
      total_count: executions.length,
      filtered_count: filteredExecutions.length
    });

  } catch (error) {
    console.error('Failed to fetch executions:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch executions' },
      { status: 500 }
    );
  }
}