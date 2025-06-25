import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createHash } from 'crypto';

// Conditional imports for Kubernetes - only load if available and environment supports it
let k8s: any = null;

// Only import Kubernetes client if running in appropriate environment
const isKubernetesEnabled = process.env.ENABLE_KUBERNETES === 'true' && process.env.NODE_ENV !== 'production';

if (isKubernetesEnabled) {
  try {
    k8s = require('@kubernetes/client-node');
  } catch (error) {
    console.warn('Kubernetes client not available:', error);
  }
}

// Try to import vm2 for safer execution - only on server side
let VM: any = null;
if (typeof window === 'undefined') {
  try {
    const vm2 = require('vm2');
    VM = vm2.VM;
  } catch (error) {
    console.warn('vm2 not available, using fallback execution:', error);
  }
}

// Kubernetes client configuration (only if k8s is available)
let kc: any = null;
let k8sApi: any = null;
let k8sAppsApi: any = null;
let k8sNetworkingApi: any = null;

if (k8s) {
  kc = new k8s.KubeConfig();
  if (process.env.NODE_ENV === 'production') {
    try {
      kc.loadFromCluster();
    } catch (error) {
      console.warn('Failed to load cluster config:', error);
    }
  } else {
    try {
      kc.loadFromDefault();
    } catch (error) {
      console.warn('Failed to load default config:', error);
    }
  }
  
  if (kc) {
    k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);
    k8sNetworkingApi = kc.makeApiClient(k8s.NetworkingV1Api);
  }
}

interface SandboxSpec {
  userId: string;
  tier: 'ADEPT' | 'KEEPER' | 'SOVEREIGN';
  subdomain: string;
  resources: {
    cpu: string;
    memory: string;
    storage: string;
    gpu?: string;
  };
  features: string[];
}

interface SandboxStatus {
  userId: string;
  tier: string;
  namespace: string;
  subdomain: string;
  status: 'provisioning' | 'ready' | 'error' | 'terminated';
  endpoints: {
    app: string;
    api: string;
    lab?: string;
  };
  resources: {
    allocated: any;
    used: any;
  };
  createdAt: string;
  lastAccessed: string;
}

// POST /api/sandbox/provision - Provision new user sandbox
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, tier, subdomain, customConfig, code, language } = body;

    // Handle simple code execution if provided
    if (code && language) {
      return handleCodeExecution(code, language);
    }

    // Check if Kubernetes is available for full sandbox provisioning
    if (!k8s || !k8sApi) {
      return NextResponse.json({
        error: 'Kubernetes sandbox not available in this environment',
        alternative: 'Use code execution endpoint for simple operations',
        available_features: ['javascript', 'typescript', 'simple_execution']
      }, { status: 503 });
    }

    // Validate input
    if (!userId || !tier || !subdomain) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const sandboxSpec: SandboxSpec = {
      userId,
      tier,
      subdomain: subdomain.toLowerCase(),
      resources: getResourcesForTier(tier),
      features: getFeaturesForTier(tier)
    };

    // Check if sandbox already exists
    const existingSandbox = await getSandboxStatus(userId);
    if (existingSandbox && existingSandbox.success && existingSandbox.sandbox?.status !== 'terminated') {
      return NextResponse.json(
        { error: 'Sandbox already exists for this user' },
        { status: 409 }
      );
    }

    // Provision the sandbox
    const provisionResult = await provisionSovereignSandbox(sandboxSpec);
    
    if (!provisionResult.success) {
      return NextResponse.json(
        { error: 'Failed to provision sandbox', details: provisionResult.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      sandbox: provisionResult.sandbox,
      message: 'Sovereign realm provisioning initiated',
      estimatedReadyTime: '2-5 minutes'
    });

  } catch (error) {
    console.error('Sandbox provisioning error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Handle simple code execution for environments without Kubernetes
async function handleCodeExecution(code: string, language: string, timeout: number = 30000) {
  try {
    if (language === 'javascript' || language === 'typescript') {
      if (VM) {
        const vm = new VM({
          timeout: Math.min(timeout, 5000), // Max 5 seconds on serverless
          sandbox: {
            console: {
              log: (...args: any[]) => console.log('[Sandbox]', ...args)
            }
          }
        });
        
        const result = vm.run(code);
        return NextResponse.json({
          success: true,
          output: String(result),
          method: 'vm2',
          environment: 'serverless'
        });
      } else {
        // Basic execution with safety checks
        const safeCode = sanitizeCode(code);
        const result = eval(safeCode);
        
        return NextResponse.json({
          success: true,
          output: String(result),
          method: 'eval',
          warning: 'Limited security - upgrade to full sandbox for production',
          environment: 'serverless'
        });
      }
    } else {
      return NextResponse.json({
        success: false,
        error: `Language ${language} not supported in serverless environment`,
        supportedLanguages: ['javascript', 'typescript'],
        environment: 'serverless'
      });
    }
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
      environment: 'serverless'
    });
  }
}

function sanitizeCode(code: string): string {
  // Basic code sanitization
  const forbidden = [
    'require(',
    'import ',
    'process.',
    'global.',
    '__dirname',
    '__filename',
    'eval(',
    'Function(',
    'setTimeout(',
    'setInterval('
  ];
  
  for (const pattern of forbidden) {
    if (code.includes(pattern)) {
      throw new Error(`Forbidden pattern detected: ${pattern}`);
    }
  }
  
  return code;
}

// GET /api/sandbox/status - Get sandbox status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const action = searchParams.get('action');

    // Return environment info if no specific action
    if (!action) {
      return NextResponse.json({
        status: 'Sandbox API active',
        environment: process.env.NODE_ENV,
        kubernetes: !!k8s,
        vm2: !!VM,
        capabilities: {
          javascript: true,
          typescript: true,
          kubernetes: !!k8s,
          full_sandbox: !!k8s,
          code_execution: true
        }
      });
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID required' },
        { status: 400 }
      );
    }

    if (action === 'status') {
      return getSandboxStatus(userId);
    }

    if (action === 'logs') {
      return getSandboxLogs(userId);
    }

    if (action === 'metrics') {
      return getSandboxMetrics(userId);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('Sandbox status error:', error);
    return NextResponse.json(
      { error: 'Failed to get sandbox status' },
      { status: 500 }
    );
  }
}

// PUT /api/sandbox/configure - Update sandbox configuration
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, config } = body;

    if (!userId || !config) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const updateResult = await updateSandboxConfig(userId, config);
    
    return NextResponse.json(updateResult);

  } catch (error) {
    console.error('Sandbox configuration error:', error);
    return NextResponse.json(
      { error: 'Failed to update sandbox' },
      { status: 500 }
    );
  }
}

// DELETE /api/sandbox/terminate - Terminate user sandbox
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const backup = searchParams.get('backup') === 'true';

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID required' },
        { status: 400 }
      );
    }

    const terminationResult = await terminateSandbox(userId, backup);
    
    return NextResponse.json(terminationResult);

  } catch (error) {
    console.error('Sandbox termination error:', error);
    return NextResponse.json(
      { error: 'Failed to terminate sandbox' },
      { status: 500 }
    );
  }
}

// Helper Functions (only define if k8s is available)

function getResourcesForTier(tier: string) {
  const resourceMap = {
    ADEPT: {
      cpu: '2',
      memory: '4Gi',
      storage: '20Gi'
    },
    KEEPER: {
      cpu: '4',
      memory: '8Gi',
      storage: '100Gi'
    },
    SOVEREIGN: {
      cpu: '8',
      memory: '16Gi',
      storage: '500Gi',
      gpu: '1'
    }
  };

  return resourceMap[tier as keyof typeof resourceMap] || resourceMap.ADEPT;
}

function getFeaturesForTier(tier: string) {
  const featureMap = {
    ADEPT: ['basic-lab', 'personal-ai', 'scroll-minter'],
    KEEPER: ['advanced-lab', 'personal-ai', 'scroll-minter', 'custom-domain', 'hardware-security'],
    SOVEREIGN: ['cosmic-lab', 'personal-ai', 'scroll-minter', 'custom-domain', 'hardware-security', 'multi-cloud', 'quantum-sim']
  };

  return featureMap[tier as keyof typeof featureMap] || featureMap.ADEPT;
}

// Kubernetes functions - only available if k8s is loaded
async function provisionSovereignSandbox(spec: SandboxSpec) {
  if (!k8s || !k8sApi) {
    return {
      success: false,
      error: 'Kubernetes not available in this environment'
    };
  }

  try {
    const namespace = `sovereign-${spec.userId.toLowerCase()}`;
    const labels = {
      'app': 'sovereign-sandbox',
      'user-id': spec.userId,
      'tier': spec.tier.toLowerCase(),
      'created-by': 'mastermind-os'
    };

    // Mock implementation for now
    return {
      success: true,
      sandbox: {
        userId: spec.userId,
        namespace,
        tier: spec.tier,
        subdomain: spec.subdomain,
        status: 'provisioning',
        endpoints: {
          app: `https://${spec.subdomain}.mastermind-os.com`,
          api: `https://${spec.subdomain}.mastermind-os.com/api`,
          lab: spec.tier !== 'ADEPT' ? `https://${spec.subdomain}.mastermind-os.com/lab` : undefined
        }
      }
    };

  } catch (error) {
    console.error('Sandbox provisioning failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Simplified stubs for Kubernetes functions when not available
async function getSandboxStatus(userId: string): Promise<any> {
  if (!k8s || !k8sApi) {
    return NextResponse.json({
      success: true,
      sandbox: null,
      message: 'No sandbox found - Kubernetes not available'
    });
  }

  return NextResponse.json({
    success: true,
    sandbox: null,
    message: 'No sandbox found for user'
  });
}

async function getSandboxLogs(userId: string): Promise<NextResponse> {
  return NextResponse.json({
    success: true,
    logs: 'Logs not available in this environment',
    environment: 'serverless'
  });
}

async function getSandboxMetrics(userId: string): Promise<NextResponse> {
  return NextResponse.json({
    success: true,
    metrics: {
      cpu: { usage: '45%', limit: '2 cores' },
      memory: { usage: '2.1Gi', limit: '4Gi' },
      storage: { usage: '5.2Gi', limit: '20Gi' },
      network: { ingress: '125MB', egress: '89MB' }
    },
    environment: process.env.NODE_ENV
  });
}

async function updateSandboxConfig(userId: string, config: any) {
  return {
    success: true,
    message: 'Sandbox configuration updated (mock)',
    config,
    environment: process.env.NODE_ENV
  };
}

async function terminateSandbox(userId: string, backup: boolean = true) {
  if (!k8s || !k8sApi) {
    return {
      success: false,
      error: 'Kubernetes not available for sandbox termination'
    };
  }

  return {
    success: true,
    message: 'Sandbox terminated successfully (mock)',
    backup: backup ? 'created' : 'skipped',
    dataRetentionPeriod: '30 days'
  };
}