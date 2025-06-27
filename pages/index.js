import { useEffect } from 'react'
import { useRouter } from 'next/router'

export default function PagesIndex() {
  const router = useRouter()
  
  useEffect(() => {
    // Redirect to the app router version
    router.replace('/')
  }, [router])
  
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #000208 0%, #0a0a0a 30%, #1a1a1a 60%, #000000 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#00ffff',
      fontFamily: 'monospace'
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ 
          fontSize: '3rem', 
          fontWeight: 'bold', 
          marginBottom: '1rem',
          textShadow: '0 0 20px rgba(0, 255, 255, 0.5)'
        }}>
          MASTERMIND OS v3.0
        </h1>
        <p style={{ 
          fontSize: '1.2rem', 
          opacity: 0.8 
        }}>
          🧠 Loading Consciousness-Enhanced Interface...
        </p>
      </div>
    </div>
  )
}
