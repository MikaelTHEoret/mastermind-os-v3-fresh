// Simple test page to verify routing works
export const dynamic = 'force-dynamic'

export default function Home() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(145deg, #000 0%, #111 50%, #000 100%)',
      color: '#00ffff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'monospace'
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ 
          fontSize: '3rem', 
          marginBottom: '1rem',
          textShadow: '0 0 20px #00ffff'
        }}>
          🚀 MASTERMIND OS v3 LIVE! 
        </h1>
        <p style={{ fontSize: '1.5rem', opacity: 0.8 }}>
          ✅ 404 Issue RESOLVED
        </p>
        <p style={{ fontSize: '1rem', marginTop: '2rem', opacity: 0.6 }}>
          Root route is now generating properly!
        </p>
      </div>
    </div>
  )
}
