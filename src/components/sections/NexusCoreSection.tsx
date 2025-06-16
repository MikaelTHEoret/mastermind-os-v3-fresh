'use client'
import { useState, useEffect } from 'react'
import { getTheme, getStatusColor, animations, commonStyles } from '@/lib/theme-config'

export default function NexusCoreSection() {
  const [coreEnergy, setCoreEnergy] = useState(87)
  const [connectionNodes, setConnectionNodes] = useState(12)
  const [activeAgents, setActiveAgents] = useState(8)
  const [coreActive, setCoreActive] = useState(true)
  
  // Get theme configuration for this panel
  const theme = getTheme('nexus')

  useEffect(() => {
    const interval = setInterval(() => {
      setCoreEnergy(prev => {
        const variation = (Math.random() - 0.5) * 5
        return Math.max(75, Math.min(95, prev + variation))
      })
      setConnectionNodes(prev => Math.max(8, Math.min(16, prev + Math.floor((Math.random() - 0.5) * 2))))
      setActiveAgents(prev => Math.max(6, Math.min(12, prev + Math.floor((Math.random() - 0.5) * 1))))
    }, 3000)

    return () => clearInterval(interval)
  }, [])

  return (
    <>
      <style jsx>{`
        ${animations.energyPulse}
        ${animations.coreRotate}
        ${animations.pulse}
        
        @keyframes corePulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          50% { transform: translate(-50%, -50%) scale(1.2); opacity: 0.8; }
        }
        
        @keyframes nodePulse {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.3); opacity: 1; }
        }
      `}</style>
      
      <div style={{
        height: '100%',
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
        padding: '0',
        paddingTop: '0',
        marginTop: '-30px',
        marginLeft: '15px'
      }}>
        {/* Energy Field Background */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: `
            radial-gradient(ellipse at 30% 40%, ${theme.primaryColor}20 0%, transparent 50%),
            radial-gradient(ellipse at 70% 60%, ${theme.secondaryColor}20 0%, transparent 50%),
            radial-gradient(ellipse at 50% 50%, ${theme.accentColor}10 0%, transparent 70%)
          `,
          animation: 'energyPulse 6s ease-in-out infinite'
        }} />

        {/* Main Nexus Core */}
        <div style={{
          width: '530px',
          height: '530px',
          borderRadius: '50%',
          background: `
            radial-gradient(circle at center,
              ${theme.primaryColor}60 0%,
              ${theme.secondaryColor}50 30%,
              ${theme.accentColor}40 60%,
              transparent 80%
            )
          `,
          border: `3px solid ${theme.primaryColor}`,
          position: 'relative',
          animation: `coreRotate 20s linear infinite`,
          boxShadow: `
            0 0 80px ${theme.primaryColor}${Math.floor(coreEnergy).toString(16).padStart(2, '0')},
            inset 0 0 50px ${theme.secondaryColor}50
          `,
          cursor: 'pointer',
          flexShrink: 0,
          transform: 'translateY(-40px)'
        }}
        onClick={() => setCoreActive(!coreActive)}
        >
          {/* Inner Core */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -65%)',
            width: '120px',
            height: '120px',
            borderRadius: '50%',
            background: `
              radial-gradient(circle,
                rgba(255, 255, 255, 0.9) 0%,
                ${theme.primaryColor}80 30%,
                ${theme.secondaryColor}60 70%,
                ${theme.accentColor}40 100%
              )
            `,
            animation: `coreRotate 15s linear infinite reverse`,
            boxShadow: `0 0 40px rgba(255, 255, 255, ${coreActive ? 0.8 : 0.4})`
          }}>
            {/* Core Center */}
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: '#ffffff',
              boxShadow: '0 0 20px rgba(255, 255, 255, 1)',
              animation: 'corePulse 2s ease-in-out infinite'
            }} />
          </div>

          {/* Connection Nodes */}
          {[...Array(connectionNodes)].map((_, i) => {
            const angle = (360 / connectionNodes) * i
            const radius = 245
            const x = Math.cos((angle * Math.PI) / 180) * radius
            const y = Math.sin((angle * Math.PI) / 180) * radius
            
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: `translate(${x}px, ${y}px)`,
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: `${theme.primaryColor}${Math.floor(60 + (Math.sin(Date.now() * 0.001 + i) * 40)).toString(16).padStart(2, '0')}`,
                  boxShadow: `0 0 15px ${theme.primaryColor}`,
                  animation: `nodePulse ${2 + (i * 0.2)}s ease-in-out infinite`
                }}
              />
            )
          })}

          {/* Energy Connections */}
          {[...Array(connectionNodes)].map((_, i) => {
            const angle = (360 / connectionNodes) * i
            
            return (
              <div
                key={`connection-${i}`}
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  width: '1px',
                  height: '245px',
                  background: `linear-gradient(transparent, ${theme.primaryColor}50, transparent)`,
                  transformOrigin: 'top center',
                  transform: `rotate(${angle}deg)`,
                  opacity: coreActive ? 0.6 : 0.2,
                  transition: 'opacity 0.5s ease'
                }}
              />
            )
          })}
        </div>

        {/* Development Status Message */}
        <div style={{
          position: 'fixed',
          bottom: '80px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 2,
          textAlign: 'center'
        }}>
          <div style={{
            background: 'rgba(0, 0, 0, 0.85)',
            border: `2px solid ${theme.primaryColor}`,
            borderRadius: '12px',
            padding: '20px 40px',
            boxShadow: `
              0 0 25px ${theme.primaryColor}60,
              inset 0 0 15px rgba(0, 0, 0, 0.7)
            `,
            backdropFilter: 'blur(10px)'
          }}>
            <div style={{
              fontSize: '18px',
              fontWeight: '600',
              color: theme.primaryColor,
              fontFamily: 'Orbitron, monospace',
              textShadow: `0 0 10px ${theme.primaryColor}80`,
              letterSpacing: '1px'
            }}>
              Nexus Core : Inter Planetary Knowledge System Gateway
            </div>
            <div style={{
              fontSize: '14px',
              color: theme.secondaryColor,
              marginTop: '8px',
              fontFamily: 'Rajdhani, sans-serif',
              fontStyle: 'italic',
              opacity: 0.9
            }}>
              ( in development )
            </div>
          </div>
        </div>
      </div>
    </>
  )
}