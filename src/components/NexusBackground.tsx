'use client'
import { useEffect, useState } from 'react'

export default function NexusBackground() {
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient) {
    return null
  }

  return (
    <div className="fixed inset-0 pointer-events-none">
      {/* Base cyberpunk gradient background */}
      <div 
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)'
        }}
      />
      
      {/* Circuit pattern overlay */}
      <div 
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `
            repeating-linear-gradient(
              45deg,
              transparent,
              transparent 4px,
              rgba(0, 255, 255, 0.1) 4px,
              rgba(0, 255, 255, 0.1) 6px
            )
          `,
          animation: 'circuitFlow 50s linear infinite'
        }}
      />
      
      {/* Sacred geometry center */}
      <div 
        className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 opacity-5"
        style={{
          background: 'radial-gradient(circle, rgba(0, 255, 255, 0.1) 0%, transparent 70%)',
          borderRadius: '50%',
          animation: 'rotate 300s linear infinite'
        }}
      />
      
      {/* Cyberpunk light columns */}
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="absolute top-1/4 h-1/2 w-px opacity-10"
          style={{
            left: `${25 + i * 25}%`,
            background: 'linear-gradient(180deg, rgba(0, 255, 255, 0.3) 0%, rgba(255, 0, 255, 0.2) 50%, rgba(255, 255, 0, 0.3) 100%)',
            boxShadow: '0 0 10px rgba(0, 255, 255, 0.2)'
          }}
        />
      ))}

      <style jsx>{`
        @keyframes circuitFlow {
          0% { transform: translateX(0) translateY(0); }
          100% { transform: translateX(30px) translateY(30px); }
        }
        
        @keyframes rotate {
          0% { transform: translate(-50%, -50%) rotate(0deg); }
          100% { transform: translate(-50%, -50%) rotate(360deg); }
        }
      `}</style>
    </div>
  )
}