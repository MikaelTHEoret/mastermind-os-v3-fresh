'use client'
import { useEffect, useState } from 'react'

interface NexusCoreBackgroundProps {
  children: React.ReactNode
}

export default function NexusCoreBackground({ children }: NexusCoreBackgroundProps) {
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient) {
    return <div>{children}</div>
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
          /* BLUR FIX: Removed background-attachment: fixed */
          background: 
            url('/backgrounds/circuiterybackground.png'),
            radial-gradient(ellipse at top, rgba(0, 255, 255, 0.03) 0%, transparent 70%),
            radial-gradient(ellipse at bottom, rgba(255, 0, 255, 0.03) 0%, transparent 70%),
            linear-gradient(180deg, #000208 0%, #0a0a0a 30%, #1a1a1a 60%, #000000 100%);
          background-size: cover, 100%, 100%, 100%;
          background-position: center, center, center, center;
          background-repeat: no-repeat, no-repeat, no-repeat, no-repeat;
          font-family: 'Rajdhani', sans-serif;
          color: #888;
          overflow-x: hidden;
          min-height: 100vh;
          position: relative;
          /* BLUR FIX: Add GPU acceleration hints */
          transform: translateZ(0);
          backface-visibility: hidden;
        }
        
        /* BLUR FIX: Simplified overlay - no animation */
        body::before {
          content: '';
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.3);
          pointer-events: none;
          z-index: -1;
        }
        
        /* BLUR FIX: Removed animated circuit overlay - major blur cause */
        
        /* BLUR FIX: Slower, less jarring rotation */
        @keyframes sigilRotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      
      <div className="nexus-background-container" style={{
        position: 'relative',
        minHeight: '100vh',
        width: '100%',
        /* BLUR FIX: Ensure clean rendering */
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden'
      }}>
        
        {/* BLUR FIX: Reduced opacity and slower animation for sacred geometry */}
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '400px', // Smaller for better performance
          height: '400px',
          backgroundImage: 'url(/backgrounds/holographicpanel.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.03, // Reduced from 0.05
          pointerEvents: 'none',
          zIndex: 0,
          borderRadius: '50%',
          animation: 'sigilRotate 600s linear infinite', // Much slower
          filter: 'brightness(0.2)',
          /* BLUR FIX: GPU optimization */
          willChange: 'transform',
          transform3d: 'translateZ(0)'
        }} />

        {/* BLUR FIX: Simplified light columns - no animation */}
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 1,
          opacity: 0.02 // Reduced opacity
        }}>
          {[...Array(3)].map((_, i) => ( // Reduced from 4 to 3
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${25 + i * 25}%`,
                top: '20%',
                width: '1px',
                height: '60%',
                background: 'linear-gradient(180deg, rgba(0, 255, 255, 0.2) 0%, rgba(255, 0, 255, 0.1) 50%, rgba(138, 43, 226, 0.2) 100%)',
                boxShadow: '0 0 6px rgba(0, 255, 255, 0.1)'
              }}
            />
          ))}
        </div>

        {/* BLUR FIX: Much simpler sigil ring */}
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '500px',
          height: '500px',
          opacity: 0.02, // Very subtle
          pointerEvents: 'none',
          zIndex: 0,
          /* BLUR FIX: Static - no animation */
        }}>
          <svg viewBox="0 0 200 200" style={{
            width: '100%',
            height: '100%'
          }}>
            <circle 
              cx="100" 
              cy="100" 
              r="80" 
              stroke="#00ffff" 
              strokeWidth="0.3" 
              fill="none" 
              strokeDasharray="15 10" 
              opacity="0.4"
            />
            <text 
              x="100" 
              y="105" 
              textAnchor="middle" 
              fill="#555" 
              fontSize="6" 
              fontFamily="Orbitron, monospace"
              opacity="0.3"
            >
              ψ₀ • φ • ∞
            </text>
          </svg>
        </div>

        {/* Content Container */}
        <div style={{
          position: 'relative',
          zIndex: 10,
          minHeight: '100vh'
        }}>
          {children}
        </div>
      </div>
    </>
  )
}