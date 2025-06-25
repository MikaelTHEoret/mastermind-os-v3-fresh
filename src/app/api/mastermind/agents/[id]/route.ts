import { NextRequest, NextResponse } from 'next/server';

// Mock agent store - replace with actual database
const agents: any[] = [];

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    
    // Find agent by ID (replace with database query)
    const agent = agents.find(a => a.id === id);
    
    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      agent: agent
    });

  } catch (error) {
    console.error('Failed to fetch agent:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch agent' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const updates = await request.json();
    
    // Find and update agent (replace with database operation)
    const agentIndex = agents.findIndex(a => a.id === id);
    
    if (agentIndex === -1) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    agents[agentIndex] = { ...agents[agentIndex], ...updates };

    return NextResponse.json({
      success: true,
      agent: agents[agentIndex],
      message: 'Agent updated successfully'
    });

  } catch (error) {
    console.error('Failed to update agent:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update agent' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    
    // Find and delete agent (replace with database operation)
    const agentIndex = agents.findIndex(a => a.id === id);
    
    if (agentIndex === -1) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    agents.splice(agentIndex, 1);

    return NextResponse.json({
      success: true,
      message: 'Agent deleted successfully'
    });

  } catch (error) {
    console.error('Failed to delete agent:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete agent' },
      { status: 500 }
    );
  }
}