import React, { Suspense } from 'react';

export default function Loading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f0f23] flex items-center justify-center">
      <div className="relative">
        {/* Cyberpunk Loading Animation */}
        <div className="w-16 h-16 border-4 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin"></div>
        <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-b-magenta-400/50 rounded-full animate-pulse"></div>
        
        {/* Loading Text */}
        <div className="mt-8 text-center">
          <div className="text-xl font-mono text-cyan-400 animate-pulse">
            ⚡ Initializing Stack Auth...
          </div>
          <div className="text-sm text-gray-400 mt-2">
            Securing authentication protocols
          </div>
        </div>
        
        {/* Cyber Grid Effect */}
        <div className="absolute -inset-20 opacity-20">
          <div className="w-full h-full bg-[linear-gradient(90deg,transparent_49%,cyan_49%,cyan_51%,transparent_51%),linear-gradient(180deg,transparent_49%,cyan_49%,cyan_51%,transparent_51%)] bg-[length:20px_20px] animate-pulse"></div>
        </div>
      </div>
    </div>
  );
}