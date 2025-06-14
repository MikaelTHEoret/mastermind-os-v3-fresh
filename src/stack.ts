// Check if Stack Auth environment variables are configured
// Note: This runs at build time and runtime safely
export const isStackAuthEnabled = !!(  
  process.env.NEXT_PUBLIC_STACK_PROJECT_ID && 
  process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY
);

// Runtime check for Stack Auth configuration
export function checkStackAuthEnabled() {
  return !!( 
    process.env.NEXT_PUBLIC_STACK_PROJECT_ID && 
    process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY
  )
}

// Conditional Stack Server App creation - only import and create when needed
export async function getStackServerApp() {
  if (!isStackAuthEnabled) {
    return null;
  }

  try {
    // Dynamic import to prevent build-time inclusion when not needed
    const { StackServerApp } = await import("@stackframe/stack");
    
    return new StackServerApp({
      tokenStore: "nextjs-cookie",
      projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID || "",
      publishableClientKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY || "",
      secretServerKey: process.env.STACK_SECRET_SERVER_KEY || "",
      urls: {
        handler: "/handler",
        signIn: "/handler/sign-in",
        signUp: "/handler/sign-up",
        afterSignIn: "/",
        afterSignUp: "/",
        afterSignOut: "/",
      },
    });
  } catch (error) {
    console.log('Stack Auth server app creation failed (safe mode):', error);
    return null;
  }
}

// Legacy compatibility - create instance only if enabled
let _stackServerApp: any = null;

export const stackServerApp = new Proxy({} as any, {
  get(target, prop) {
    if (!isStackAuthEnabled) {
      console.log('Stack Auth not enabled - stackServerApp proxy returning null');
      return null;
    }
    
    // Lazy initialization
    if (!_stackServerApp) {
      // This will be null if Stack Auth is disabled, preventing any Stack Auth calls
      return null;
    }
    
    return _stackServerApp[prop];
  }
});

// Initialize only if enabled
if (isStackAuthEnabled) {
  getStackServerApp().then(app => {
    _stackServerApp = app;
  }).catch(error => {
    console.log('Stack Auth server initialization failed (safe mode):', error);
  });
}