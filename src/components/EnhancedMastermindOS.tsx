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

  // Inline styles as fallback for cyberpunk aesthetic
  const styles = {
    container: {
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      color: '#00ffff',
      fontFamily: 'Courier New, monospace',
      overflow: 'hidden'
    },
    header: {
      height: '64px',
      background: 'rgba(0, 0, 0, 0.8)',
      backdropFilter: 'blur(8px)',
      borderBottom: '1px solid rgba(0, 255, 255, 0.3)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px'
    },
    title: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    },
    navigation: {
      display: 'flex',
      gap: '4px'
    },
    navButton: {
      padding: '8px 16px',
      border: activePanel === 'nexus' ? '1px solid #00ffff' : '1px solid transparent',
      background: activePanel === 'nexus' ? 'rgba(0, 255, 255, 0.2)' : 'transparent',
      color: '#00ffff',
      borderRadius: '8px',
      cursor: 'pointer',
      fontSize: '14px',
      fontFamily: 'Courier New, monospace',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      transition: 'all 0.3s ease'
    },
    content: {
      padding: '32px'
    },
    card: {
      background: 'linear-gradient(135deg, rgba(0, 255, 255, 0.2) 0%, rgba(255, 0, 255, 0.2) 100%)',
      border: '1px solid rgba(0, 255, 255, 0.5)',
      borderRadius: '8px',
      padding: '24px',
      marginBottom: '16px'
    }
  }

  if (isLoading) {
    return (
      <div style={{
        ...styles.container,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ textAlign: 'center', zIndex: 10 }}>
          <Brain style={{ 
            width: '64px', 
            height: '64px', 
            margin: '0 auto 24px',
            color: '#00ffff',
            animation: 'pulse 2s infinite'
          }} />
          <h1 style={{ 
            fontSize: '36px', 
            fontWeight: 'bold', 
            color: '#00ffff', 
            marginBottom: '16px',
            fontFamily: 'Courier New, monospace'
          }}>
            MASTERMIND OS v3.0
          </h1>
          <p style={{ 
            color: '#00ffff', 
            fontSize: '18px',
            fontFamily: 'Courier New, monospace'
          }}>
            🧠 Enhanced Nexus Core Protocol v3.0 Active...
          </p>
          <p style={{ 
            color: 'rgba(0, 255, 255, 0.7)', 
            fontSize: '14px',
            marginTop: '16px',
            fontFamily: 'Courier New, monospace'
          }}>
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
          <div style={styles.content}>
            <h2 style={{ fontSize: '32px', color: '#00ffff', fontWeight: 'bold', marginBottom: '24px' }}>
              🧠 NEURAL ORCHESTRATION CORE
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '24px' }}>
              <div style={styles.card}>
                <h3 style={{ fontSize: '20px', color: '#00ffff', fontWeight: 'bold', marginBottom: '8px' }}>Core Energy</h3>
                <div style={{ fontSize: '32px', color: '#00ffff', fontFamily: 'Courier New, monospace' }}>87%</div>
                <p style={{ color: '#00ffff', fontSize: '14px' }}>Neural networks active</p>
              </div>
              <div style={styles.card}>
                <h3 style={{ fontSize: '20px', color: '#ff00ff', fontWeight: 'bold', marginBottom: '8px' }}>Active Nodes</h3>
                <div style={{ fontSize: '32px', color: '#ff00ff', fontFamily: 'Courier New, monospace' }}>12</div>
                <p style={{ color: '#ff00ff', fontSize: '14px' }}>Processing units online</p>
              </div>
              <div style={styles.card}>
                <h3 style={{ fontSize: '20px', color: '#ffff00', fontWeight: 'bold', marginBottom: '8px' }}>Agents</h3>
                <div style={{ fontSize: '32px', color: '#ffff00', fontFamily: 'Courier New, monospace' }}>8</div>
                <p style={{ color: '#ffff00', fontSize: '14px' }}>AI orchestration active</p>
              </div>
            </div>
          </div>
        )
      default:
        return (
          <div style={styles.content}>
            <h2 style={{ fontSize: '32px', color: '#00ffff', fontWeight: 'bold', marginBottom: '16px' }}>
              🚀 {navigationItems.find(item => item.key === activePanel)?.label}
            </h2>
            <p style={{ color: '#00ffff', fontSize: '18px', marginBottom: '32px' }}>
              Enhanced Nexus Core Protocol v3.0 - {navigationItems.find(item => item.key === activePanel)?.description}
            </p>
            <div style={styles.card}>
              <p style={{ color: '#00ffff' }}>🧠 Vector database intelligence active - Component ready for full migration</p>
            </div>
          </div>
        )
    }
  }

  return (
    <div style={styles.container}>
      {/* Main Interface */}
      <div style={{ position: 'relative', zIndex: 10, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <header style={styles.header}>
          <div style={styles.title}>
            <Brain style={{ width: '32px', height: '32px', color: '#00ffff' }} />
            <h1 style={{ 
              fontSize: '24px', 
              fontWeight: 'bold', 
              color: '#00ffff',
              fontFamily: 'Courier New, monospace'
            }}>
              MASTERMIND OS
            </h1>
            <span style={{ color: 'rgba(0, 255, 255, 0.7)', fontSize: '14px', fontFamily: 'Courier New, monospace' }}>
              v3.0
            </span>
          </div>
          
          {/* Navigation */}
          <nav style={styles.navigation}>
            {navigationItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  onClick={() => setActivePanel(item.key as ActivePanel)}
                  style={{
                    ...styles.navButton,
                    border: activePanel === item.key ? '1px solid #00ffff' : '1px solid transparent',
                    background: activePanel === item.key ? 'rgba(0, 255, 255, 0.2)' : 'transparent'
                  }}
                  title={item.description}
                >
                  <Icon style={{ width: '16px', height: '16px' }} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>

          <div style={{ color: '#00ffff', fontSize: '14px', fontFamily: 'Courier New, monospace' }}>
            🧠 ENHANCED NEXUS ACTIVE
          </div>
        </header>

        {/* Main Content Area */}
        <main style={{ flex: 1, position: 'relative' }}>
          {renderActiveSection()}
        </main>
      </div>
    </div>
  )
}