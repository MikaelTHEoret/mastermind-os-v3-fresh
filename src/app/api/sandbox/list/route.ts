import { NextRequest, NextResponse } from 'next/server';
import { k8sClient } from '@/lib/kubernetes';

// Sandbox API Routes for Kubernetes Management

export async function GET(request: NextRequest) {
  try {
    const sandboxes = await k8sClient.listSandboxes();
    
    return NextResponse.json({
      success: true,
      sandboxes: sandboxes || []
    });
  } catch (error) {
    console.error('Failed to list sandboxes:', error);
    
    // Return mock data for development
    return NextResponse.json({
      success: false,
      error: 'Failed to connect to Kubernetes cluster',
      sandboxes: mockSandboxes
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, tier, userId, features } = body;

    if (!name || !tier || !userId) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: name, tier, userId'
      }, { status: 400 });
    }

    // Validate tier
    if (!['ADEPT', 'KEEPER', 'SOVEREIGN'].includes(tier)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid tier. Must be ADEPT, KEEPER, or SOVEREIGN'
      }, { status: 400 });
    }

    // Create namespace and sandbox resources
    const sandbox = await k8sClient.createSandbox({
      name,
      tier,
      userId,
      features: features || []
    });

    return NextResponse.json({
      success: true,
      message: 'Sandbox created successfully',
      sandbox
    });
  } catch (error) {
    console.error('Failed to create sandbox:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to create sandbox: ' + (error as Error).message
    }, { status: 500 });
  }
}

const mockSandboxes = [
  {
    id: 'sb-001',
    name: 'ai-research-lab',
    tier: 'SOVEREIGN',
    status: 'running',
    userId: 'user-123',
    namespace: 'sandbox-user-123-001',
    createdAt: '2024-06-06T10:30:00Z',
    resources: {
      cpu: '4 cores',
      memory: '8GB',
      storage: '100GB',
      pods: 5,
      services: 3
    },
    usage: {
      cpuPercent: 65,
      memoryPercent: 78,
      storagePercent: 45
    },
    endpoints: {
      primary: 'https://ai-research-lab.sovereign.mastermind-os.dev',
      terminal: 'wss://terminal.ai-research-lab.sovereign.mastermind-os.dev',
      monitoring: 'https://monitoring.ai-research-lab.sovereign.mastermind-os.dev'
    },
    features: ['AI Models', 'Jupyter Lab', 'GPU Access', 'Custom Domain', 'Hardware Security']
  },
  {
    id: 'sb-002',
    name: 'crypto-trading-bot',
    tier: 'KEEPER',
    status: 'running',
    userId: 'user-456',
    namespace: 'sandbox-user-456-002',
    createdAt: '2024-06-06T09:15:00Z',
    resources: {
      cpu: '2 cores',
      memory: '4GB',
      storage: '50GB',
      pods: 3,
      services: 2
    },
    usage: {
      cpuPercent: 42,
      memoryPercent: 56,
      storagePercent: 33
    },
    endpoints: {
      primary: 'https://crypto-trading-bot.keeper.mastermind-os.dev',
      terminal: 'wss://terminal.crypto-trading-bot.keeper.mastermind-os.dev',
      monitoring: 'https://monitoring.crypto-trading-bot.keeper.mastermind-os.dev'
    },
    features: ['Trading APIs', 'Real-time Data', 'Secure Vault', 'Custom Domain']
  }
];
