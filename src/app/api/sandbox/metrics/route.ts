import { NextRequest, NextResponse } from 'next/server';
import { k8sClient } from '@/lib/kubernetes';

export async function GET(request: NextRequest) {
  try {
    const metrics = await k8sClient.getClusterMetrics();
    
    return NextResponse.json({
      success: true,
      metrics: metrics || mockMetrics
    });
  } catch (error) {
    console.error('Failed to get cluster metrics:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to connect to Kubernetes cluster',
      metrics: mockMetrics
    });
  }
}

const mockMetrics = {
  totalNodes: 12,
  runningPods: 47,
  activeSandboxes: 15,
  totalUsers: 8,
  resourceUtilization: {
    cpu: 68,
    memory: 72,
    storage: 45
  },
  tierDistribution: {
    ADEPT: 6,
    KEEPER: 5,
    SOVEREIGN: 4
  }
};
