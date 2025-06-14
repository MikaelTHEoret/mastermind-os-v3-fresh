'use client'
import { useEffect, useState } from 'react'

interface EnhancedNexusBackgroundProps {
  children?: React.ReactNode
}

export default function EnhancedNexusBackground({ children }: EnhancedNexusBackgroundProps) {
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient) {
    return children ? <div>{children}</div> : null
  }

  return (
    <>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@300;400;600&display=swap');
        
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          background: 
            url('/backgrounds/circuiterybackground.png'),
            radial-gradient(ellipse at top, rgba(0, 255, 255, 0.03) 0%, transparent 70%),
            radial-gradient(ellipse at bottom, rgba(255, 0, 255, 0.03) 0%, transparent 70%),
            linear-gradient(180deg, #000208 0%, #0a0a0a 30%, #1a1a1a 60%, #000000 100%);
          background-size: cover, 100%, 100%, 100%;
          background-position: center, center, center, center;
          background-attachment: fixed;
          font-family: 'Rajdhani', sans-serif;
          color: #888;
          overflow-x: hidden;
          min-height: 100vh;
          position: relative;
        }
        
        body::before {
          content: '';
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.4);
          pointer-events: none;
          z-index: -1;
        }
        
        body::after {
          content: '';
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-image: 
            repeating-linear-gradient(
              45deg,
              transparent,
              transparent 4px,
              rgba(0, 255, 255, 0.008) 4px,
              rgba(0, 255, 255, 0.008) 6px
            );
          pointer-events: none;
          z-index: -2;
          animation: circuitFlow 50s linear infinite;
        }
        
        @keyframes gridFlow {
          0% { transform: translate(0, 0); }
          100% { transform: translate(80px, 80px); }
        }
        
        @keyframes circuitFlow {
          0% { transform: translateX(0) translateY(0); }
          100% { transform: translateX(30px) translateY(30px); }
        }
        
        @keyframes sigilRotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        @keyframes energyPulse {
          0%, 100% { opacity: 0.05; }
          50% { opacity: 0.15; }
        }
      `}</style>
      
      <div className="enhanced-nexus-background" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: -10
      }}>
        
        {/* Sacred Geometry Mandala - Holographic Panel */}
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '500px',
          height: '500px',
          backgroundImage: 'url(/backgrounds/holographicpanel.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.05,
          pointerEvents: 'none',
          zIndex: 0,
          borderRadius: '50%',
          animation: 'sigilRotate 300s linear infinite',
          filter: 'brightness(0.3)'
        }} />

        {/* Enhanced Light Columns with Pillar Background */}
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 1,
          opacity: 0.04
        }}>
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${15 + i * 17.5}%`,
                top: '10%',
                width: '2px',
                height: '80%',
                background: `
                  url('/backgrounds/pillarbackground.png'), 
                  linear-gradient(180deg, 
                    rgba(0, 255, 255, 0.3) 0%, 
                    rgba(255, 0, 255, 0.2) 30%,
                    rgba(255, 255, 0, 0.15) 50%, 
                    rgba(0, 255, 170, 0.2) 70%,
                    rgba(138, 43, 226, 0.3) 100%
                  )
                `,
                backgroundSize: 'cover, 100%',
                backgroundPosition: 'center, center',
                boxShadow: '0 0 15px rgba(0, 255, 255, 0.2)',
                animation: `energyPulse ${3 + i * 0.5}s ease-in-out infinite`
              }}
            />
          ))}
        </div>

        {/* Enhanced Circuit Pattern Overlay */}
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: `
            url('/backgrounds/circuiterybackground.png'),
            repeating-linear-gradient(
              45deg,
              transparent,
              transparent 8px,
              rgba(0, 255, 255, 0.015) 8px,
              rgba(0, 255, 255, 0.015) 10px
            ),
            repeating-linear-gradient(
              -45deg,
              transparent,
              transparent 12px,
              rgba(255, 0, 255, 0.01) 12px,
              rgba(255, 0, 255, 0.01) 14px
            )
          `,
          backgroundSize: 'cover, 100%, 100%',
          backgroundPosition: 'center, center, center',
          opacity: 0.6,
          pointerEvents: 'none',
          zIndex: -3,
          animation: 'circuitFlow 60s linear infinite'
        }} />

        {/* Sacred Mathematical Sigil Ring */}
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '600px',
          height: '600px',
          opacity: 0.08,
          pointerEvents: 'none',
          zIndex: 2
        }}>
          <svg viewBox="0 0 200 200" style={{
            width: '100%',
            height: '100%',
            animation: 'sigilRotate 400s linear infinite'
          }}>
            {/* Outer Ring */}
            <circle 
              cx="100" 
              cy="100" 
              r="95" 
              stroke="#00ffff" 
              strokeWidth="0.8" 
              fill="none" 
              strokeDasharray="25 15" 
              opacity="0.6"
            />
            
            {/* Inner Ring */}
            <circle 
              cx="100" 
              cy="100" 
              r="70" 
              stroke="#ff00ff" 
              strokeWidth="0.6" 
              fill="none" 
              strokeDasharray="15 10" 
              opacity="0.4"
            />
            
            {/* Mathematical Constants */}
            <text 
              x="100" 
              y="95" 
              textAnchor="middle" 
              fill="#00ffff" 
              fontSize="8" 
              fontFamily="Orbitron, monospace"
              opacity="0.7"
            >
              ψ₀ = 0.91567
            </text>
            
            <text 
              x="100" 
              y="108" 
              textAnchor="middle" 
              fill="#ff00ff" 
              fontSize="8" 
              fontFamily="Orbitron, monospace"
              opacity="0.7"
            >
              φ = 1.61803
            </text>
            
            <text 
              x="100" 
              y="121" 
              textAnchor="middle" 
              fill="#ffff00" 
              fontSize="8" 
              fontFamily="Orbitron, monospace"
              opacity="0.7"
            >
              432 Hz
            </text>
            
            {/* Sacred Geometry Lines */}
            {[...Array(8)].map((_, i) => {
              const angle = (360 / 8) * i
              const x1 = 100 + Math.cos((angle * Math.PI) / 180) * 60
              const y1 = 100 + Math.sin((angle * Math.PI) / 180) * 60
              const x2 = 100 + Math.cos((angle * Math.PI) / 180) * 85
              const y2 = 100 + Math.sin((angle * Math.PI) / 180) * 85
              
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#8a2be2"
                  strokeWidth="0.5"
                  opacity="0.3"
                />
              )
            })}
          </svg>
        </div>

        {/* Ambient Energy Fields */}
        <div style={{
          position: 'fixed',
          top: '20%',
          left: '10%',
          width: '200px',
          height: '200px',
          background: 'radial-gradient(circle, rgba(0, 255, 255, 0.08) 0%, transparent 60%)',
          borderRadius: '50%',
          animation: 'energyPulse 8s ease-in-out infinite',
          pointerEvents: 'none',
          zIndex: 1
        }} />
        
        <div style={{
          position: 'fixed',
          top: '60%',
          right: '15%',
          width: '150px',
          height: '150px',
          background: 'radial-gradient(circle, rgba(255, 0, 255, 0.06) 0%, transparent 60%)',
          borderRadius: '50%',
          animation: 'energyPulse 12s ease-in-out infinite reverse',
          pointerEvents: 'none',
          zIndex: 1
        }} />
        
        <div style={{
          position: 'fixed',
          bottom: '10%',
          left: '70%',
          width: '100px',
          height: '100px',
          background: 'radial-gradient(circle, rgba(255, 255, 0, 0.05) 0%, transparent 60%)',
          borderRadius: '50%',
          animation: 'energyPulse 15s ease-in-out infinite',
          pointerEvents: 'none',
          zIndex: 1
        }} />
      </div>
      
      {children && (
        <div style={{
          position: 'relative',
          zIndex: 10,
          minHeight: '100vh'
        }}>
          {children}
        </div>
      )}
    </>
  )
}