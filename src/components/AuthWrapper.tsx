'use client';

import { useUser } from '@stackframe/stack';
import { SignIn } from '@stackframe/stack';
import EnhancedMastermindOS from '@/components/EnhancedMastermindOS';

export default function AuthWrapper() {
  const user = useUser();

  // Show sign-in page if not authenticated
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-purple-900 to-violet-900 flex items-center justify-center">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500 bg-clip-text text-transparent mb-2">
              🧠 MASTERMIND OS v3
            </h1>
            <p className="text-zinc-400">Advanced AI Agent Orchestration Platform</p>
          </div>
          
          <div className="bg-zinc-900/50 backdrop-blur-sm border border-cyan-500/30 rounded-lg p-6">
            <SignIn />
          </div>
          
          <div className="text-center mt-6 text-sm text-zinc-400">
            Sign in to access your sovereign scroll development environment
          </div>
        </div>
      </div>
    );
  }

  // Show main app if authenticated
  return <EnhancedMastermindOS />;
}
