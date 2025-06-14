// Stack Auth Configuration
// Enhanced Nexus Core Protocol v3.0 Integration

let stackServerApp: any = null;

// Check if Stack Auth is enabled via environment variables
export function isStackAuthEnabled(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_STACK_PROJECT_ID && 
    process.env.STACK_SECRET_SERVER_KEY
  );
}

export async function getStackServerApp() {
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

export default getStackServerApp;