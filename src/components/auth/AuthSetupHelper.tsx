// src/components/auth/AuthSetupHelper.tsx
'use client';

import React, { useState } from 'react';
import { AlertCircle, Check, Copy, Settings, Eye, EyeOff } from 'lucide-react';

interface AuthSetupHelperProps {
  onSetupComplete?: () => void;
}

export function AuthSetupHelper({ onSetupComplete }: AuthSetupHelperProps) {
  const [showKeys, setShowKeys] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [setupStep, setSetupStep] = useState(0);

  const envVars = {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_cHJpbWFyeS1rYW5nYXJvby01MS5jbGVyay5hY2NvdW50cy5kZXYk',
    CLERK_SECRET_KEY: 'sk_test_tMkstZauUBT7doefmbAhuYhrrCr6VjIjNeGThb7dCS'
  };

  const setupSteps = [
    {
      title: 'Understanding Authentication',
      content: 'MasterMind OS uses Clerk for secure authentication. You need to configure environment variables to enable sign-in functionality.',
      action: 'Got it!'
    },
    {
      title: 'Local Development (.env.local)',
      content: 'For local development, create a .env.local file in your project root with the provided environment variables.',
      action: 'Copy Variables'
    },
    {
      title: 'Production Deployment',
      content: 'For Vercel deployment, add these environment variables in your Vercel project dashboard under Settings → Environment Variables.',
      action: 'Deployment Guide'
    },
    {
      title: 'Verification',
      content: 'After configuration, the SIGN IN button will become active and authentication flows will work properly.',
      action: 'Complete Setup'
    }
  ];

  const copyToClipboard = async (text: string, keyName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(keyName);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const copyAllEnvVars = async () => {
    const envContent = Object.entries(envVars)
      .map(([key, value]) => `${key}="${value}"`)
      .join('\n');
    
    await copyToClipboard(envContent, 'all');
  };

  const handleNext = () => {
    if (setupStep < setupSteps.length - 1) {
      setSetupStep(setupStep + 1);
    } else {
      onSetupComplete?.();
    }
  };

  const currentStep = setupSteps[setupStep];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-indigo-950 via-purple-900 to-purple-950 border-2 border-cyan-400 rounded-xl shadow-2xl shadow-cyan-500/30 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-cyan-500/30">
          <div className="flex items-center gap-3 mb-2">
            <Settings className="w-6 h-6 text-cyan-400" />
            <h2 className="text-2xl font-orbitron font-bold text-cyan-400">
              Authentication Setup
            </h2>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <span>Step {setupStep + 1} of {setupSteps.length}</span>
            <div className="flex gap-1">
              {setupSteps.map((_, index) => (
                <div
                  key={index}
                  className={`w-2 h-2 rounded-full ${
                    index <= setupStep ? 'bg-cyan-400' : 'bg-gray-600'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <h3 className="text-xl font-orbitron font-bold text-white mb-4">
            {currentStep.title}
          </h3>
          
          <p className="text-gray-300 font-rajdhani text-lg leading-relaxed mb-6">
            {currentStep.content}
          </p>

          {/* Environment Variables Display */}
          {setupStep >= 1 && (
            <div className="bg-black/30 border border-cyan-500/30 rounded-lg p-4 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-lg font-orbitron font-bold text-cyan-400">
                  Environment Variables
                </h4>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowKeys(!showKeys)}
                    className="flex items-center gap-2 px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-md text-sm text-white transition-colors"
                  >
                    {showKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    {showKeys ? 'Hide' : 'Show'}
                  </button>
                  <button
                    onClick={copyAllEnvVars}
                    className="flex items-center gap-2 px-3 py-1 bg-cyan-600 hover:bg-cyan-500 rounded-md text-sm text-white transition-colors"
                  >
                    <Copy className="w-4 h-4" />
                    {copiedKey === 'all' ? 'Copied!' : 'Copy All'}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {Object.entries(envVars).map(([key, value]) => (
                  <div key={key} className="bg-black/50 rounded-md p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-sm text-cyan-300">{key}</span>
                      <button
                        onClick={() => copyToClipboard(`${key}="${value}"`, key)}
                        className="text-xs text-gray-400 hover:text-cyan-400 transition-colors"
                      >
                        {copiedKey === key ? (
                          <Check className="w-4 h-4 text-green-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <code className="font-mono text-sm text-white break-all">
                      {showKeys ? value : '••••••••••••••••••••••••••••••••'}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Deployment Instructions */}
          {setupStep === 2 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h5 className="font-bold text-amber-400 mb-2">Vercel Deployment Steps:</h5>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-gray-300">
                    <li>Go to your Vercel dashboard</li>
                    <li>Select your mastermind-os project</li>
                    <li>Navigate to Settings → Environment Variables</li>
                    <li>Add each environment variable with its value</li>
                    <li>Set the environment to "Production"</li>
                    <li>Redeploy your application</li>
                  </ol>
                </div>
              </div>
            </div>
          )}

          {/* Local Development Instructions */}
          {setupStep === 1 && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h5 className="font-bold text-blue-400 mb-2">Local Development Steps:</h5>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-gray-300">
                    <li>Create a <code className="bg-black/50 px-1 rounded">.env.local</code> file in your project root</li>
                    <li>Copy the environment variables above into the file</li>
                    <li>Restart your development server (<code className="bg-black/50 px-1 rounded">npm run dev</code>)</li>
                    <li>Authentication will now be fully functional</li>
                  </ol>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-cyan-500/30 flex justify-between items-center">
          <button
            onClick={() => setSetupStep(Math.max(0, setupStep - 1))}
            disabled={setupStep === 0}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-rajdhani"
          >
            Previous
          </button>
          
          <div className="text-sm text-gray-400 font-rajdhani">
            {setupStep === setupSteps.length - 1 ? 'Ready to use authentication!' : 'Follow the steps to enable authentication'}
          </div>
          
          <button
            onClick={handleNext}
            className="px-6 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white rounded-lg transition-all font-orbitron font-bold uppercase tracking-wider shadow-lg shadow-cyan-500/30"
          >
            {currentStep.action}
          </button>
        </div>
      </div>
    </div>
  );
}
