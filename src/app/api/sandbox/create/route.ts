import { NextRequest, NextResponse } from 'next/server';
import { k8sClient } from '@/lib/kubernetes';

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
      sandbox: {
        id: sandbox.id,
        name: sandbox.name,
        namespace: sandbox.namespace,
        endpoint: sandbox.endpoint,
        status: 'pending'
      }
    });
  } catch (error) {
    console.error('Failed to create sandbox:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to create sandbox: ' + (error as Error).message
    }, { status: 500 });
  }
}
