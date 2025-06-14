'use client';

import React, { useState, useEffect } from 'react';

// Handler for Stack Auth authentication pages
export default function StackAuthHandler({ params }: { params: { stack: string[] } }) {
  const [StackComponents, setStackComponents] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStackAuth() {
      try {
        console.log('Stack Auth Handler: Loading authentication components...');

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
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-cyan-300 text-lg animate-pulse">Loading authentication...</div>
      </div>
    );
  }

  // Error state
  if (error || !StackComponents) {
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
          <StackHandler routeProps={{ params }} />
        </div>
      </StackTheme>
    </StackProvider>
  );
}
