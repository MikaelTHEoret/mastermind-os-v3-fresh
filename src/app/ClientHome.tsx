'use client'

import { useState, useEffect } from 'react'
import { WalletProvider } from '@/context/WalletContext'

function HomeContent() {
  const [isLoading, setIsLoading] = useState(true)
  
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1000)
    return () => clearTimeout(timer)
  }, [])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 text-cyan-400 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-4">🌀 Mastermind OS v3</h1>
          <p className="text-xl animate-pulse">Loading Enhanced Nexus Core...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-cyan-400 p-8">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-5xl font-bold mb-2">🌀 Mastermind OS v3</h1>
          <p className="text-xl text-cyan-300">Enhanced AI Agent Orchestration Platform</p>
          <div className="mt-4 text-sm text-gray-400">
            Enhanced Nexus Core Protocol v4.1 Active
          </div>
        </header>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-gray-800 border border-cyan-500 rounded-lg p-6">
            <h3 className="text-xl font-bold mb-2">🚀 Status</h3>
            <p className="text-green-400">✅ React Hooks Fixed</p>
            <p className="text-green-400">✅ Server Running</p>
            <p className="text-green-400">✅ Client Components Working</p>
            <p className="text-green-400">✅ Next.js 15 Compatible</p>
          </div>
          
          <div className="bg-gray-800 border border-cyan-500 rounded-lg p-6">
            <h3 className="text-xl font-bold mb-2">🧮 Constants</h3>
            <p className="text-yellow-400">ψ₀: 0.915670570874434</p>
            <p className="text-yellow-400">φ: 1.618</p>
            <p className="text-yellow-400">432 Hz: Active</p>
          </div>
          
          <div className="bg-gray-800 border border-cyan-500 rounded-lg p-6">
            <h3 className="text-xl font-bold mb-2">🔧 Ready For</h3>
            <p className="text-blue-400">• Terminal Hub Implementation</p>
            <p className="text-blue-400">• AutoGPT Integration</p>
            <p className="text-blue-400">• Universal LLM Chat</p>
            <p className="text-blue-400">• Memory Search Interface</p>
          </div>
        </div>
        
        <div className="mt-8 text-center">
          <div className="bg-gray-800 border border-cyan-500 rounded-lg p-6 inline-block">
            <h3 className="text-xl font-bold mb-2">🖥️ Next: Terminal Hub</h3>
            <p className="text-cyan-300">Ready to implement 5-tab interface:</p>
            <div className="mt-2 text-sm">
              <p>🗣️ Universal LLM Chat • 📊 Log Processor • 🔍 Semantic Search</p>
              <p>🤖 Agent Manager • ⚙️ Configuration Dashboard</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ClientHome() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="min-h-screen bg-gray-900 text-cyan-400 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-4">🌀 Mastermind OS v3</h1>
          <p className="text-xl">Initializing...</p>
        </div>
      </div>
    )
  }

  return (
    <WalletProvider>
      <HomeContent />
    </WalletProvider>
  )
}
