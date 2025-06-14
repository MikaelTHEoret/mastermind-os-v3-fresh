// Stack Auth configuration with proper client/server separation

let stackServerApp: any = null;

export async function getStackServerApp() {
  // Only create server app on server-side with secret key
  if (typeof window !== 'undefined') {
    console.log('getStackServerApp: Client-side detected, Stack Server App not available');
    return null;
  }

  if (!process.env.STACK_SECRET_SERVER_KEY) {
    console.log('getStackServerApp: No secret server key configured');
    return null;
  }

  if (!stackServerApp) {
    try {
      const { StackServerApp } = await import('@stackframe/stack');
      stackServerApp = new StackServerApp({
        tokenStore: 'nextjs-cookie',
      });
      console.log('getStackServerApp: Server app created successfully');
    } catch (error) {
      console.error('getStackServerApp: Error creating server app:', error);
      return null;
    }
  }

  return stackServerApp;
}

// Get Stack Auth configuration for client-side components
export function getStackAuthConfig() {
  const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID;
  const publishableClientKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY;

  if (!projectId || !publishableClientKey) {
    console.log('getStackAuthConfig: Environment variables not configured');
    return null;
  }

  return {
    projectId,
    publishableClientKey,
  };
}

// Check if Stack Auth is enabled (client-side safe)
export function isStackAuthEnabled() {
  const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID;
  const publishableKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY;
  
  return Boolean(projectId && publishableKey);
}

// Client-safe environment variable checking
export function isStackAuthEnabledClient() {
  if (typeof window === 'undefined') {
    return false; // Server-side, return false for safety
  }
  
  const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID;
  const publishableKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY;
  
  return Boolean(projectId && publishableKey);
}
