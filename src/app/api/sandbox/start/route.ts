import { NextRequest, NextResponse } from 'next/server';
import { k8sClient } from '@/lib/kubernetes';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sandboxId } = body;

    if (!sandboxId) {
      return NextResponse.json({
        success: false,
        error: 'Missing sandboxId parameter'
      }, { status: 400 });
    }

    const result = await k8sClient.startSandbox(sandboxId);
    
    return NextResponse.json({
      success: true,
      message: 'Sandbox started successfully',
      sandboxId
    });
  } catch (error) {
    console.error('Failed to start sandbox:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to start sandbox: ' + (error as Error).message
    }, { status: 500 });
  }
}
