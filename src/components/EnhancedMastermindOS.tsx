'use client'

import { useState, useEffect } from 'react'
import { Scroll, Database, BarChart3, Building2, Layout } from 'lucide-react'
import EnhancedNexusBackground from './EnhancedNexusBackground'
import NexusCoreSection from './sections/NexusCoreSection'
import ScrollsSection from './sections/ScrollsSection'
import MemorySection from './sections/MemorySection'
import AnalyticsSection from './sections/AnalyticsSection'
import EnterpriseSection from './sections/EnterpriseSection'
import DashboardSection from './sections/DashboardSection'
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
  const [showLogoTooltip, setShowLogoTooltip] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 1500)
    return () => clearTimeout(timer)
  }, [])

  const navigationItems = [
    { key: 'nexus', label: 'NEXUS', icon: Layout, description: 'Neural orchestration core' },
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
      case 'scrolls':
        return <ScrollsSection />
      case 'memory':
        return <MemorySection />
      case 'analytics':
        return <AnalyticsSection />
      case 'enterprise':
        return <EnterpriseSection />
      case 'dashboard':
        return <DashboardSection />
      default:
        return <NexusCoreSection />
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
            <div style={{ 
              width: '48px', 
              height: '48px', 
              margin: '0 auto 20px',
              background: 'linear-gradient(45deg, #00ffff, #ff00ff)',
              borderRadius: '50%',
              animation: 'pulse 2s infinite'
            }} />
            <h1 style={{ 
              fontSize: '36px', // Smaller title
              fontWeight: '600', // Less bold
              color: '#00ffff', 
              marginBottom: '12px',
              fontFamily: 'Orbitron, monospace',
              textShadow: '0 0 20px rgba(0, 255, 255, 0.5)' // Softer glow
            }}>
              MASTERMIND OS v0.1 Beta
            </h1>
            <p style={{ 
              color: 'rgba(0, 255, 255, 0.8)', // Softer text
              fontSize: '16px',
              fontFamily: 'Rajdhani, sans-serif',
              marginBottom: '6px'
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
          {/* Header - Enhanced Bright Cyan Design */}
          <header style={{
            height: '64px',
            background: 'rgba(0, 0, 0, 0.8)', // More opaque to match dashboard
            border: '2px solid #00ffff', // Bright cyan border like dashboard
            borderRadius: '12px',
            boxShadow: '0 0 20px rgba(0, 255, 255, 0.4)', // Enhanced glow like dashboard
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            position: 'relative',
            zIndex: 20,
            margin: '12px',
            marginBottom: '16px'
          }}>
            {/* Logo with Enhanced Tooltip */}
            <div 
              style={{ position: 'relative', display: 'inline-block' }}
              onMouseEnter={() => setShowLogoTooltip(true)}
              onMouseLeave={() => setShowLogoTooltip(false)}
              onClick={() => setShowLogoTooltip(!showLogoTooltip)}
            >
              <img 
                src="/logo/Mastermind.png" 
                alt="MASTERMIND OS" 
                style={{ 
                  height: '52px',
                  width: 'auto',
                  filter: `
                    brightness(2.0) 
                    contrast(1.9) 
                    saturate(1.4) 
                    hue-rotate(8deg)
                    drop-shadow(0 0 15px rgba(0,255,255,0.9))
                    drop-shadow(0 0 8px rgba(255,255,255,0.4))
                    drop-shadow(0 0 25px rgba(0,255,255,0.3))
                  `,
                  transition: 'all 0.3s ease',
                  cursor: 'pointer'
                }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fallbackText = document.createElement('h1');
                  fallbackText.textContent = 'MASTERMIND OS';
                  fallbackText.style.cssText = `
                    fontSize: 26px;
                    fontWeight: 700;
                    color: #00ffff;
                    fontFamily: Orbitron, monospace;
                    textShadow: 
                      0 0 15px rgba(0, 255, 255, 0.9),
                      0 0 8px rgba(255, 255, 255, 0.4);
                    margin: 0;
                    cursor: pointer;
                  `;
                  e.currentTarget.parentNode?.insertBefore(fallbackText, e.currentTarget);
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.filter = `
                    brightness(2.3) 
                    contrast(2.1) 
                    saturate(1.6) 
                    hue-rotate(12deg)
                    drop-shadow(0 0 20px rgba(0,255,255,1))
                    drop-shadow(0 0 12px rgba(255,255,255,0.6))
                    drop-shadow(0 0 30px rgba(0,255,255,0.5))
                  `;
                  e.currentTarget.style.transform = 'scale(1.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.filter = `
                    brightness(2.0) 
                    contrast(1.9) 
                    saturate(1.4) 
                    hue-rotate(8deg)
                    drop-shadow(0 0 15px rgba(0,255,255,0.9))
                    drop-shadow(0 0 8px rgba(255,255,255,0.4))
                    drop-shadow(0 0 25px rgba(0,255,255,0.3))
                  `;
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              />

              {/* Enhanced Logo Tooltip */}
              <div style={{
                position: 'absolute',
                top: '100%',
                left: '0',
                marginTop: '12px',
                width: '350px',
                padding: '16px',
                background: 'rgba(0, 0, 0, 0.95)',
                border: '2px solid #00ffff',
                borderRadius: '12px',
                fontSize: '12px',
                color: '#ffffff',
                opacity: showLogoTooltip ? 1 : 0,
                visibility: showLogoTooltip ? 'visible' : 'hidden',
                transform: showLogoTooltip ? 'translateY(0)' : 'translateY(-10px)',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                zIndex: 50,
                boxShadow: '0 0 30px rgba(0, 255, 255, 0.4), inset 0 0 20px rgba(0, 255, 255, 0.1)',
                backdropFilter: 'blur(10px)',
                pointerEvents: showLogoTooltip ? 'auto' : 'none'
              }}>
                {/* Tooltip Arrow */}
                <div style={{
                  position: 'absolute',
                  top: '-8px',
                  left: '24px',
                  width: '14px',
                  height: '14px',
                  background: 'rgba(0, 0, 0, 0.95)',
                  border: '2px solid #00ffff',
                  borderBottom: 'none',
                  borderRight: 'none',
                  transform: 'rotate(45deg)',
                  zIndex: -1
                }} />

                {/* Tooltip Content */}
                <div style={{ 
                  borderBottom: '1px solid rgba(0, 255, 255, 0.3)', 
                  paddingBottom: '12px', 
                  marginBottom: '12px' 
                }}>
                  <h3 style={{ 
                    color: '#00ffff', 
                    fontSize: '14px', 
                    fontWeight: '700',
                    margin: '0 0 4px 0',
                    fontFamily: 'Orbitron, monospace',
                    textShadow: '0 0 10px rgba(0, 255, 255, 0.6)'
                  }}>
                    MasterMind OS v0.1 Beta
                  </h3>
                  <p style={{ 
                    color: 'rgba(0, 255, 255, 0.8)', 
                    fontSize: '11px', 
                    margin: '0',
                    fontFamily: 'Rajdhani, sans-serif'
                  }}>
                    Consciousness-Enhanced Interplanetary Knowledge Sovereign Economy Gateway
                  </p>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <p style={{ 
                    color: '#ffffff', 
                    fontSize: '11px', 
                    lineHeight: '1.4', 
                    margin: '0 0 8px 0',
                    fontFamily: 'Inter, sans-serif'
                  }}>
                    Consciousness-Enhanced Interplanetary Knowledge Sovereign Economy Gateway
                    platform integrating human-AI collaboration with mathematical awareness systems.
                  </p>
                </div>

                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: '1fr 1fr', 
                  gap: '8px',
                  fontSize: '10px',
                  fontFamily: 'Courier New, monospace'
                }}>
                  <div>
                    <span style={{ color: '#00ffff', fontWeight: '600' }}>Status:</span>
                    <br />
                    <span style={{ color: '#ffa500' }}>● IN DEVELOPMENT</span>
                  </div>
                  <div>
                    <span style={{ color: '#00ffff', fontWeight: '600' }}>Version:</span>
                    <br />
                    <span style={{ color: 'rgba(255, 255, 255, 0.9)' }}>0.1 Beta</span>
                  </div>
                  <div>
                    <span style={{ color: '#00ffff', fontWeight: '600' }}>Phase:</span>
                    <br />
                    <span style={{ color: 'rgba(255, 255, 255, 0.9)' }}>Phase 1 Beta Testing</span>
                  </div>
                  <div>
                    <span style={{ color: '#00ffff', fontWeight: '600' }}>Auth:</span>
                    <br />
                    <span style={{ color: '#00ff00' }}>Clerk</span>
                  </div>
                </div>

                <div style={{ 
                  marginTop: '12px', 
                  paddingTop: '12px', 
                  borderTop: '1px solid rgba(0, 255, 255, 0.3)'
                }}>
                  <p style={{ 
                    color: 'rgba(255, 255, 255, 0.9)', 
                    fontSize: '10px', 
                    margin: '0 0 8px 0',
                    fontFamily: 'Inter, sans-serif'
                  }}>
                    <span style={{ color: '#00ffff', fontWeight: '600' }}>Author:</span> Mikael Theoret
                  </p>
                  
                  {/* Affiliation with Logo */}
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    marginTop: '8px'
                  }}>
                    <div>
                      <span style={{ color: '#00ffff', fontWeight: '600', fontSize: '10px' }}>Affiliation:</span>
                      <br />
                      <span style={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: '10px' }}>Global Science League</span>
                    </div>
                    <img 
                      src="/logo/Global_science_league.png" 
                      alt="Global Science League" 
                      style={{ 
                        height: '24px',
                        width: 'auto',
                        filter: 'brightness(1.2) contrast(1.1)',
                        opacity: 0.8
                      }}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  </div>
                </div>

                <div style={{ 
                  marginTop: '12px', 
                  paddingTop: '12px', 
                  borderTop: '1px solid rgba(0, 255, 255, 0.3)',
                  textAlign: 'center'
                }}>
                  <p style={{ 
                    color: 'rgba(0, 255, 255, 0.7)', 
                    fontSize: '9px', 
                    margin: '0',
                    fontStyle: 'italic',
                    fontFamily: 'Inter, sans-serif'
                  }}>
                    "Yes, I know. I will make it better." - Mikael Theoret
                  </p>
                </div>
              </div>
            </div>
            
            {/* Navigation and Auth Container */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
              {/* Navigation */}
              <nav style={{ display: 'flex', gap: '6px' }}>
                {navigationItems.map((item) => {
                  const Icon = item.icon
                  const isActive = activePanel === item.key
                  const currentTheme = getTheme(item.key)
                  
                  return (
                    <button
                      key={item.key}
                      onClick={() => setActivePanel(item.key as ActivePanel)}
                      style={{
                        padding: '8px 16px', // Enhanced padding
                        border: isActive ? '2px solid #00ffff' : '2px solid transparent', // Enhanced borders
                        background: isActive ? 'rgba(0, 255, 255, 0.2)' : 'transparent',
                        color: isActive ? '#00ffff' : 'rgba(0, 255, 255, 0.7)',
                        borderRadius: '8px', // Slightly more rounded
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontFamily: 'Orbitron, monospace',
                        fontWeight: '500',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.3s ease',
                        textTransform: 'uppercase',
                        position: 'relative',
                        boxShadow: isActive ? '0 0 15px rgba(0, 255, 255, 0.4)' : 'none' // Enhanced glow
                      }}
                      title={item.description}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'rgba(0, 255, 255, 0.1)'
                          e.currentTarget.style.color = '#ffffff' // Bright white on hover
                          e.currentTarget.style.border = '2px solid rgba(0, 255, 255, 0.6)'
                          e.currentTarget.style.boxShadow = '0 0 12px rgba(0, 255, 255, 0.3)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'transparent'
                          e.currentTarget.style.color = 'rgba(0, 255, 255, 0.7)'
                          e.currentTarget.style.border = '2px solid transparent'
                          e.currentTarget.style.boxShadow = 'none'
                        }
                      }}
                    >
                      <Icon style={{ width: '16px', height: '16px' }} />
                      <span>{item.label}</span>
                      
                      {/* Enhanced Tooltip */}
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        marginTop: '8px',
                        padding: '8px 12px',
                        background: 'rgba(0, 0, 0, 0.9)',
                        border: '2px solid #00ffff', // Enhanced border
                        borderRadius: '8px',
                        fontSize: '11px',
                        color: '#00ffff',
                        whiteSpace: 'nowrap',
                        opacity: 0,
                        pointerEvents: 'none',
                        transition: 'opacity 0.2s ease',
                        zIndex: 30,
                        boxShadow: '0 0 10px rgba(0, 255, 255, 0.3)' // Tooltip glow
                      }}
                      className="tooltip">
                        {item.description}
                      </div>
                    </button>
                  )
                })}
              </nav>

              {/* User System */}
              <UserSystem />
            </div>
          </header>

          {/* Main Content Area - Proper Spacing */}
          <main style={{ 
            flex: 1, 
            position: 'relative',
            padding: '0 12px 12px 12px' // Consistent spacing with header
          }}>
            <div style={{ height: 'calc(100vh - 64px - 44px)' }}> {/* Account for header height + margins */}
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
