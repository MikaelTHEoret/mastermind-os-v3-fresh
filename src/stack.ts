// Stack Auth Configuration
// Enhanced Nexus Core Protocol v3.0 Integration

let stackServerApp: any = null;

export async function getStackServerApp() {
  if (stackServerApp) {
    return stackServerApp;
  }

  try {
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