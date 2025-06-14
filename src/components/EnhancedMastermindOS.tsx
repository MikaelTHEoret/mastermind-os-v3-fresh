'use client'

import { useState, useEffect } from 'react'
import { Brain, Scroll, Database, BarChart3, Building2, Layout } from 'lucide-react'
import EnhancedNexusBackground from './EnhancedNexusBackground'
import NexusCoreSection from './sections/NexusCoreSection'
import UserSystem from './UserSystem'
import { getTheme } from '../lib/theme-config'

type ActivePanel = 'nexus' | 'scrolls' | 'memory' | 'analytics' | 'enterprise' | 'dashboard'

interface User {
  id: string
  username: string
  email: string
  role: 'admin' | 'developer' | 'user'
  avatar?: string
  joinDate: string
  lastActive: string
  scrollsMinted: number
  organizationId?: string
}

export default function EnhancedMastermindOS() {
  const [activePanel, setActivePanel] = useState<ActivePanel>('nexus')
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 1500)
    return () => clearTimeout(timer)
  }, [])

  const handleUserChange = (newUser: User | null) => {
    setUser(newUser)
  }

  const navigationItems = [
    { key: 'nexus', label: 'NEXUS', icon: Brain, description: 'Neural orchestration core' },
    { key: 'scrolls', label: 'SCROLLS', icon: Scroll, description: 'Sovereign scroll development' },
    { key: 'memory', label: 'MEMORY', icon: Database, description: 'Distributed knowledge lattice' },
    { key: 'analytics', label: 'ANALYTICS', icon: BarChart3, description: 'Intelligence analysis hub' },
    { key: 'enterprise', label: 'ENTERPRISE', icon: Building2, description: 'Management orchestration' },
    { key: 'dashboard', label: 'DASHBOARD', icon: Layout, description: 'User control center' }
  ]

  const renderActiveSection = () => {
    const currentTheme = getTheme(activePanel)
    
    switch (activePanel) {
      case 'nexus':
        return <NexusCoreSection />
      default:
        return (
          <div style={{
            padding: '32px',
            height: '100%',
            background: currentTheme.backgroundGradient,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <h2 style={{ 
              fontSize: '48px', 
              color: currentTheme.primaryColor, 
              fontWeight: 'bold', 
              marginBottom: '16px',
              fontFamily: 'Orbitron, monospace',
              textAlign: 'center',
              textShadow: `0 0 30px ${currentTheme.primaryColor}50`
            }}>
              🚀 {currentTheme.name}
            </h2>
            <p style={{ 
              color: currentTheme.textColor, 
              fontSize: '18px', 
              marginBottom: '32px',
              textAlign: 'center',
              fontFamily: 'Rajdhani, sans-serif'
            }}>
              Enhanced Nexus Core Protocol v3.0 - {currentTheme.description}
            </p>
            <div style={{
              background: currentTheme.cardBackground,
              border: `1px solid ${currentTheme.borderColor}`,
              borderRadius: '12px',
              padding: '24px',
              backdropFilter: 'blur(10px)',
              textAlign: 'center',
              boxShadow: currentTheme.glowEffect
            }}>
              <p style={{ color: currentTheme.primaryColor, fontSize: '16px' }}>
                🧠 Stack Auth integration active - {user ? `Welcome ${user.username}!` : 'Sign in to unlock features'}
              </p>
              <p style={{ color: '#888', fontSize: '14px', marginTop: '8px' }}>
                Enhanced user management • Authentication system • Dashboard access
              </p>
            </div>
          </div>
        )
    }
  }

  if (isLoading) {
    return (
      <EnhancedNexusBackground>
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative'
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
              fontSize: '48px', 
              fontWeight: 'bold', 
              color: '#00ffff', 
              marginBottom: '16px',
              fontFamily: 'Orbitron, monospace',
              textShadow: '0 0 30px rgba(0, 255, 255, 0.8)'
            }}>
              MASTERMIND OS v3.0
            </h1>
            <p style={{ 
              color: '#00ffff', 
              fontSize: '18px',
              fontFamily: 'Rajdhani, sans-serif',
              marginBottom: '8px'
            }}>
              🧠 Enhanced Nexus Core Protocol v3.0 Initializing...
            </p>
            <div style={{
              marginTop: '24px',
              display: 'flex',
              justifyContent: 'center'
            }}>
              <div style={{
                width: '256px',
                height: '4px',
                background: 'rgba(0, 255, 255, 0.2)',
                borderRadius: '2px',
                overflow: 'hidden'
              }}>
                <div style={{
                  height: '100%',
                  background: 'linear-gradient(90deg, #00ffff, #ff00ff)',
                  borderRadius: '2px',
                  animation: 'pulse 2s infinite',
                  width: '90%'
                }} />
              </div>
            </div>
            <p style={{ 
              color: 'rgba(0, 255, 255, 0.7)', 
              fontSize: '14px',
              marginTop: '16px',
              fontFamily: 'Courier New, monospace'
            }}>
              Stack Auth integration • User management • Enhanced authentication
            </p>
          </div>
        </div>
      </EnhancedNexusBackground>
    )
  }

  return (
    <EnhancedNexusBackground>
      <div style={{
        minHeight: '100vh',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Main Interface */}
        <div style={{ 
          position: 'relative', 
          zIndex: 10, 
          minHeight: '100vh', 
          display: 'flex', 
          flexDirection: 'column' 
        }}>
          {/* Header */}
          <header style={{
            height: '64px',
            background: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(8px)',
            borderBottom: '1px solid rgba(0, 255, 255, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            position: 'relative',
            zIndex: 20
          }}>
            {/* Logo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Brain style={{ width: '32px', height: '32px', color: '#00ffff' }} />
              <h1 style={{ 
                fontSize: '24px', 
                fontWeight: 'bold', 
                color: '#00ffff',
                fontFamily: 'Orbitron, monospace'
              }}>
                MASTERMIND OS
              </h1>
              <span style={{ 
                color: 'rgba(0, 255, 255, 0.7)', 
                fontSize: '14px', 
                fontFamily: 'Courier New, monospace' 
              }}>
                v3.0
              </span>
            </div>
            
            {/* Navigation and Auth Container */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
              {/* Navigation */}
              <nav style={{ display: 'flex', gap: '4px' }}>
                {navigationItems.map((item) => {
                  const Icon = item.icon
                  const isActive = activePanel === item.key
                  const currentTheme = getTheme(item.key)
                  
                  return (
                    <button
                      key={item.key}
                      onClick={() => setActivePanel(item.key as ActivePanel)}
                      style={{
                        padding: '8px 16px',
                        border: isActive ? `1px solid ${currentTheme.primaryColor}` : '1px solid transparent',
                        background: isActive ? `rgba(${currentTheme.primaryColor.slice(1).match(/.{2}/g)?.map(hex => parseInt(hex, 16)).join(', ')}, 0.2)` : 'transparent',
                        color: isActive ? currentTheme.primaryColor : '#00ffff',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontFamily: 'Orbitron, monospace',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'all 0.3s ease',
                        textTransform: 'uppercase',
                        position: 'relative'
                      }}
                      title={item.description}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.background = `rgba(${currentTheme.primaryColor.slice(1).match(/.{2}/g)?.map(hex => parseInt(hex, 16)).join(', ')}, 0.1)`
                          e.currentTarget.style.color = currentTheme.primaryColor
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'transparent'
                          e.currentTarget.style.color = '#00ffff'
                        }
                      }}
                    >
                      <Icon style={{ width: '16px', height: '16px' }} />
                      <span>{item.label}</span>
                      
                      {/* Tooltip */}
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        marginTop: '8px',
                        padding: '8px 12px',
                        background: 'rgba(0, 0, 0, 0.9)',
                        border: `1px solid ${currentTheme.primaryColor}30`,
                        borderRadius: '6px',
                        fontSize: '11px',
                        color: currentTheme.primaryColor,
                        whiteSpace: 'nowrap',
                        opacity: 0,
                        pointerEvents: 'none',
                        transition: 'opacity 0.2s ease',
                        zIndex: 30
                      }}
                      className="tooltip">
                        {item.description}
                      </div>
                    </button>
                  )
                })}
              </nav>

              {/* User System */}
              <UserSystem onUserChange={handleUserChange} />
            </div>
          </header>

          {/* Main Content Area */}
          <main style={{ flex: 1, position: 'relative' }}>
            <div style={{ height: 'calc(100vh - 64px)' }}>
              {renderActiveSection()}
            </div>
          </main>
        </div>

        <style jsx>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.6; transform: scale(1.1); }
          }
          
          button:hover .tooltip {
            opacity: 1 !important;
          }
        `}</style>
      </div>
    </EnhancedNexusBackground>
  )
}