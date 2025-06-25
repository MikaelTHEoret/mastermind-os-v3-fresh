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
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          /* ULTRA RAW: No scaling, no positioning, no effects */
          background-image: url('/backgrounds/circuiterybackground.png');
          /* Try different scaling approaches */
          background-size: 100% 100%; /* Force exact fit - no scaling blur */
          /* OR background-size: auto; /* Use original size */
          /* OR background-size: contain; /* Fit within viewport */
          background-position: center center;
          background-repeat: no-repeat;
          
          /* Remove ANY potential filter/blur sources */
          font-family: Arial, sans-serif; /* Basic font to eliminate Google Fonts blur */
          color: #fff;
          min-height: 100vh;
          
          /* Remove any CSS that could cause rendering blur */
          image-rendering: -webkit-optimize-contrast; /* Force crisp rendering */
          image-rendering: crisp-edges;
          image-rendering: pixelated;
        }
      `}</style>
      
      <div style={{
        minHeight: '100vh',
        width: '100%'
      }}>
        {children}
      </div>
    </>
  )
}