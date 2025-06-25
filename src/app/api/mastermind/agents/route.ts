import { NextRequest, NextResponse } from 'next/server';

// Mock data store - replace with actual database
let agents: any[] = [
  {
    id: '1',
    name: 'Mastermind Auth Developer',
    description: 'Automates authentication system development',
    objective: 'Complete the Clerk authentication integration for Mastermind OS with proper error handling and user flow',
    status: 'idle',
    tools: ['serena', 'github', 'vercel'],
    llm_provider: 'deepseek',
    cost_budget: 15.0,
    cost_used: 2.34,
    created_at: new Date('2024-12-10'),
    last_execution: new Date('2024-12-10T14:30:00'),
    execution_count: 3,
    success_rate: 0.85
  }
];

export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      agents: agents,
      total_count: agents.length
    });
  } catch (error) {
    console.error('Failed to fetch agents:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, objective, tools, llm_provider, cost_budget } = body;

    // Validate required fields
    if (!name || !objective) {
      return NextResponse.json(
        { success: false, error: 'Name and objective are required' },
        { status: 400 }
      );
    }

    // Create new agent
    const newAgent = {
      id: Date.now().toString(),
      name,
      description: description || '',
      objective,
      status: 'idle',
      tools: tools || [],
      llm_provider: llm_provider || 'deepseek',
      cost_budget: cost_budget || 10.0,
      cost_used: 0,
      created_at: new Date(),
      last_execution: null,
      execution_count: 0,
      success_rate: 0
    };

    // Add to mock store (replace with actual database operation)
    agents.push(newAgent);

    // Store in Astra DB for persistence
    try {
      // TODO: Implement actual Astra DB storage
      // await astraDB.collection('autogpt_agents').insertOne(newAgent);
    } catch (dbError) {
      console.warn('Failed to store in database:', dbError);
    }

    return NextResponse.json({
      success: true,
      agent: newAgent,
      message: 'Agent created successfully'
    });

  } catch (error) {
    console.error('Failed to create agent:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create agent' },
      { status: 500 }
    );
  }
}