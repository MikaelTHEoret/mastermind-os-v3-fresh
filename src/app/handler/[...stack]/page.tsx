'use client';

import React from 'react';

// Handler for Stack Auth authentication pages - TEMPORARILY DISABLED
export default function StackAuthHandler({ params }: { params: Promise<{ stack: string[] }> }) {
  
  // TEMPORARY DISABLE: Skip all Stack Auth to eliminate toClientJson errors
  console.log('Stack Auth Handler: TEMPORARILY DISABLED - Redirecting to main app');
  console.log('Stack Auth Handler: Authentication will be re-enabled after internal errors are resolved');

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center max-w-md mx-auto p-8">
        <div className="text-cyan-300 text-2xl mb-6 animate-pulse">🔐 Authentication Temporarily Unavailable</div>
        
        <div className="text-slate-400 mb-8 leading-relaxed">
          Authentication is temporarily disabled while we resolve Stack Auth internal issues.
          <br /><br />
          You can still explore the full MasterMind OS in guest mode!
        </div>
        
        <div className="space-y-4">
          <a 
            href="/" 
            className="inline-block w-full px-6 py-3 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-700 hover:to-purple-700 text-white rounded-lg transition-all duration-300 transform hover:scale-105 font-semibold"
          >
            🚀 Explore MasterMind OS
          </a>
          
          <div className="text-xs text-slate-500 mt-4">
            Authentication will be restored in a future update
          </div>
        </div>
      </div>
    </div>
  );

  /* ORIGINAL CODE - RE-ENABLE AFTER STACK AUTH FIXES:
  
  const [StackComponents, setStackComponents] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvedParams, setResolvedParams] = useState<{ stack: string[] } | null>(null);

  useEffect(() => {
    async function loadStackAuth() {
      try {
        console.log('Stack Auth Handler: Loading authentication components...');

        // Await params for Next.js 15 compatibility
        const awaitedParams = await params;
        setResolvedParams(awaitedParams);

        // Check environment variables
        const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID;
        const publishableKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY;

        if (!projectId || !publishableKey) {
          throw new Error('Stack Auth environment variables not configured');
        }

        // Dynamic import Stack Auth components
        const { StackProvider, StackTheme, StackHandler } = await import('@stackframe/stack');

        console.log('Stack Auth Handler: Components loaded successfully');
        
        setStackComponents({
          StackProvider,
          StackTheme,
          StackHandler,
          config: { projectId, publishableKey }
        });
      } catch (err) {
        console.error('Stack Auth Handler: Error loading components:', err);
        setError('Authentication system not available');
      } finally {
        setIsLoading(false);
      }
    }

    loadStackAuth();
  }, [params]);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-cyan-300 text-lg animate-pulse">Loading authentication...</div>
      </div>
    );
  }

  // Error state
  if (error || !StackComponents || !resolvedParams) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-xl mb-4">Authentication Unavailable</div>
          <div className="text-slate-400 mb-6">{error || 'Failed to load authentication system'}</div>
          <a 
            href="/" 
            className="inline-block px-6 py-3 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition-colors"
          >
            Return to Main App
          </a>
        </div>
      </div>
    );
  }

  // Render Stack Auth handler with proper configuration
  const { StackProvider, StackTheme, StackHandler, config } = StackComponents;

  return (
    <StackProvider
      app={{
        projectId: config.projectId,
        publishableClientKey: config.publishableKey,
      }}
    >
      <StackTheme>
        <div className="min-h-screen bg-slate-950">
          <StackHandler routeProps={{ params: resolvedParams }} />
        </div>
      </StackTheme>
    </StackProvider>
  );
  
  */
}
