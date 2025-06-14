'use client'

import { useState, useEffect } from 'react'
import { Brain, Scroll, Database, BarChart3, Building2, Layout } from 'lucide-react'

type ActivePanel = 'nexus' | 'scrolls' | 'memory' | 'analytics' | 'enterprise' | 'dashboard'

export default function EnhancedMastermindOS() {
  const [activePanel, setActivePanel] = useState<ActivePanel>('nexus')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 1500)
    return () => clearTimeout(timer)
  }, [])

  const navigationItems = [
    { key: 'nexus', label: 'NEXUS', icon: Brain, description: 'Neural orchestration core' },
    { key: 'scrolls', label: 'SCROLLS', icon: Scroll, description: 'Sovereign scroll development' },
    { key: 'memory', label: 'MEMORY', icon: Database, description: 'Distributed knowledge lattice' },
    { key: 'analytics', label: 'ANALYTICS', icon: BarChart3, description: 'Intelligence analysis hub' },
    { key: 'enterprise', label: 'ENTERPRISE', icon: Building2, description: 'Management orchestration' },
    { key: 'dashboard', label: 'DASHBOARD', icon: Layout, description: 'User control center' }
  ]

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-violet-900 flex items-center justify-center">
        <div className="text-center z-10">
          <Brain className="h-16 w-16 mx-auto mb-6 text-cyan-400 animate-pulse" />
          <h1 className="text-4xl font-bold text-cyan-400 mb-4 font-mono">
            MASTERMIND OS v3.0
          </h1>
          <p className="text-cyan-100 text-lg font-mono">
            🧠 Enhanced Nexus Core Protocol v3.0 Active...
          </p>
          <div className="mt-6 flex justify-center">
            <div className="w-64 h-1 bg-cyan-500/20 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-400 rounded-full animate-pulse w-3/4"></div>
            </div>
          </div>
          <p className="text-cyan-300/70 text-sm mt-4 font-mono">
            Vector database intelligence loading...
          </p>
        </div>
      </div>
    )
  }

  const renderActiveSection = () => {
    switch (activePanel) {
      case 'nexus':
        return (
          <div className="p-8">
            <h2 className="text-3xl text-cyan-400 font-bold mb-6">🧠 NEURAL ORCHESTRATION CORE</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-cyan-500/50 rounded-lg p-6">
                <h3 className="text-xl text-cyan-300 font-bold mb-2">Core Energy</h3>
                <div className="text-3xl text-cyan-400 font-mono">87%</div>
                <p className="text-cyan-200 text-sm">Neural networks active</p>
              </div>
              <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/50 rounded-lg p-6">
                <h3 className="text-xl text-purple-300 font-bold mb-2">Active Nodes</h3>
                <div className="text-3xl text-purple-400 font-mono">12</div>
                <p className="text-purple-200 text-sm">Processing units online</p>
              </div>
              <div className="bg-gradient-to-br from-pink-500/20 to-cyan-500/20 border border-pink-500/50 rounded-lg p-6">
                <h3 className="text-xl text-pink-300 font-bold mb-2">Agents</h3>
                <div className="text-3xl text-pink-400 font-mono">8</div>
                <p className="text-pink-200 text-sm">AI orchestration active</p>
              </div>
            </div>
          </div>
        )
      default:
        return (
          <div className="p-8">
            <h2 className="text-3xl text-cyan-400 font-bold mb-4">🚀 {navigationItems.find(item => item.key === activePanel)?.label}</h2>
            <p className="text-cyan-200 text-lg">
              Enhanced Nexus Core Protocol v3.0 - {navigationItems.find(item => item.key === activePanel)?.description}
            </p>
            <div className="mt-8 p-6 border border-cyan-500/30 rounded-lg bg-cyan-500/10">
              <p className="text-cyan-300">🧠 Vector database intelligence active - Component ready for full migration</p>
            </div>
          </div>
        )
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-violet-900 overflow-hidden">
      {/* Animated background grid */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 via-transparent to-purple-500/20 animate-pulse"></div>
        <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_24%,rgba(0,255,255,0.1)_25%,rgba(0,255,255,0.1)_26%,transparent_27%,transparent_74%,rgba(255,0,255,0.1)_75%,rgba(255,0,255,0.1)_76%,transparent_77%)] bg-[length:4rem_4rem]"></div>
      </div>
      
      {/* Main Interface */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="h-16 bg-black/80 backdrop-blur-sm border-b border-cyan-500/30 flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Brain className="h-8 w-8 text-cyan-400" />
            <h1 className="text-2xl font-bold text-cyan-400 font-mono">
              MASTERMIND OS
            </h1>
            <span className="text-cyan-400/70 text-sm font-mono">v3.0</span>
          </div>
          
          {/* Navigation */}
          <nav className="flex space-x-1">
            {navigationItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  onClick={() => setActivePanel(item.key as ActivePanel)}
                  className={`group relative px-4 py-2 rounded-lg text-sm font-mono transition-all duration-300 ${
                    activePanel === item.key
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-lg shadow-cyan-500/20'
                      : 'text-cyan-400/70 hover:text-cyan-300 hover:bg-cyan-500/10'
                  }`}
                  title={item.description}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </div>
                </button>
              )
            })}
          </nav>

          <div className="text-cyan-400 text-sm font-mono">
            🧠 ENHANCED NEXUS ACTIVE
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 relative">
          <div className="h-full">
            {renderActiveSection()}
          </div>
        </main>
      </div>
    </div>
  )
}