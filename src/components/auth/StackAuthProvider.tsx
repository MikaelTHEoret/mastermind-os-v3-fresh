'use client';

import React, { ReactNode, useState, useEffect } from 'react';

interface StackAuthProviderProps {
  children: ReactNode;
}

interface StackAuthComponents {
  StackProvider: React.ComponentType<any>;
  StackTheme: React.ComponentType<any>;
}

export function StackAuthProvider({ children }: StackAuthProviderProps) {
  const [stackComponents, setStackComponents] = useState<StackAuthComponents | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasValidConfig, setHasValidConfig] = useState(false);

  useEffect(() => {
    async function initializeStackAuth() {
      try {
        // Check if we have the required environment variables
        const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID;
        const publishableKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY;

        console.log('StackAuthProvider: Checking environment variables...');
        console.log('Project ID:', projectId ? 'SET' : 'NOT_SET');
        console.log('Publishable Key:', publishableKey ? 'SET' : 'NOT_SET');

        if (!projectId || !publishableKey) {
          console.log('StackAuthProvider: Environment variables not configured, using guest mode');
          setHasValidConfig(false);
          setIsLoading(false);
          return;
        }

        // Try to dynamically import Stack Auth components
        console.log('StackAuthProvider: Loading Stack Auth components...');
        const { StackProvider, StackTheme } = await import('@stackframe/stack');

        // Use getStackAuthConfig() instead of getStackServerApp() - CLIENT-SAFE!
        const config = await import('@/stack').then(module => module.getStackAuthConfig());
        
        if (!config) {
          console.log('StackAuthProvider: Invalid config, falling back to guest mode');
          setHasValidConfig(false);
          setIsLoading(false);
          return;
        }

        console.log('StackAuthProvider: Stack Auth initialized successfully with config:', config);
        setStackComponents({ StackProvider, StackTheme });
        setHasValidConfig(true);
        
      } catch (error) {
        console.log('StackAuthProvider: Error loading Stack Auth, falling back to guest mode:', error);
        setHasValidConfig(false);
      } finally {
        setIsLoading(false);
      }
    }

    initializeStackAuth();
  }, []);

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-cyan-300 text-lg">Initializing authentication...</div>
      </div>
    );
  }

  // If Stack Auth is available and configured, use it
  if (hasValidConfig && stackComponents) {
    const { StackProvider, StackTheme } = stackComponents;
    
    return (
      <StackProvider
        app={{
          projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID!,
          publishableClientKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY!,
        }}
      >
        <StackTheme>
          {children}
        </StackTheme>
      </StackProvider>
    );
  }

  // Fallback to guest mode without any Stack Auth components
  console.log('StackAuthProvider: Running in guest mode');
  return <>{children}</>;
}
