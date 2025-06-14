// Stack Auth Configuration
// Enhanced Nexus Core Protocol v3.0 Integration

let stackServerApp: any = null;

// Check if Stack Auth is enabled via environment variables
export function isStackAuthEnabled(): boolean {
  // Check both client-side and server-side environment variables
  const hasProjectId = !!(
    (typeof window !== 'undefined' ? process.env.NEXT_PUBLIC_STACK_PROJECT_ID : process.env.NEXT_PUBLIC_STACK_PROJECT_ID) ||
    (typeof window === 'undefined' ? process.env.STACK_SECRET_SERVER_KEY : false)
  );
  
  const hasPublishableKey = !!process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY;
  
  return hasProjectId && hasPublishableKey;
}

// Client-side specific check
export function isStackAuthEnabledClient(): boolean {
  if (typeof window === 'undefined') return false;
  
  return !!(
    process.env.NEXT_PUBLIC_STACK_PROJECT_ID && 
    process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY
  );
}

export async function getStackServerApp() {
  // Only create server app on server-side or with full configuration
  if (typeof window !== 'undefined') {
    console.log('getStackServerApp: Client-side detected, returning null');
    return null;
  }

  if (stackServerApp) {
    return stackServerApp;
  }

  try {
    // Only try to load Stack Auth if properly configured
    if (!isStackAuthEnabled()) {
      console.warn('Stack Auth environment variables not configured');
      return null;
    }

    // Dynamic import to prevent build-time inclusion
    const { StackServerApp } = await import('@stackframe/stack');
    
    stackServerApp = new StackServerApp({
      tokenStore: "nextjs-cookie",
    });
    
    return stackServerApp;
  } catch (error) {
    console.warn('Stack Auth not available:', error);
    return null;
  }
}

// Enhanced server-side user retrieval with graceful fallback
export async function getUser() {
  try {
    const app = await getStackServerApp();
    if (!app) return null;
    
    return await app.getUser();
  } catch (error) {
    console.warn('Failed to get user:', error);
    return null;
  }
}

// Client-side Stack Auth app creation
export async function createClientStackApp() {
  if (typeof window === 'undefined') {
    console.log('createClientStackApp: Server-side detected, returning null');
    return null;
  }

  try {
    if (!isStackAuthEnabledClient()) {
      console.log('createClientStackApp: Environment variables not configured');
      return null;
    }

    const { StackApp } = await import('@stackframe/stack');
    
    if (!StackApp) {
      console.log('createClientStackApp: StackApp not available, using StackProvider directly');
      return null;
    }

    const clientApp = new StackApp({
      projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID!,
      publishableClientKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY!,
    });

    console.log('createClientStackApp: Client app created successfully');
    return clientApp;
  } catch (error) {
    console.log('createClientStackApp: Failed to create client app:', error);
    return null;
  }
}

export default getStackServerApp;