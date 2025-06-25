import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/auth';
import { cookies } from 'next/headers';
import { z } from 'zod';

const preferencesSchema = z.object({
  preferences: z.object({
    theme: z.string().optional(),
    language: z.string().optional(),
    timezone: z.string().optional(),
    bio: z.string().optional(),
    notifications: z.object({
      email: z.boolean().optional(),
      browser: z.boolean().optional(),
      security: z.boolean().optional()
    }).optional(),
    privacy: z.object({
      showEmail: z.boolean().optional(),
      showProfile: z.boolean().optional()
    }).optional()
  })
});

async function getUserFromRequest(request: NextRequest) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get('session_id')?.value;
  
  if (!sessionId) {
    return null;
  }
  
  const session = await authService.validateSession(sessionId);
  return session;
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getUserFromRequest(request);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const validatedData = preferencesSchema.parse(body);
    
    const success = await authService.updatePreferences(
      session.userId, 
      validatedData.preferences
    );
    
    if (!success) {
      return NextResponse.json(
        { error: 'Failed to update preferences' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: 'Preferences updated successfully'
    });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input data', details: error.errors },
        { status: 400 }
      );
    }
    
    console.error('Update preferences API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}