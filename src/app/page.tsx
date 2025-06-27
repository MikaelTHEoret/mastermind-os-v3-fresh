export const metadata = {
  title: 'MASTERMIND OS v3 - Enhanced AI Agent Orchestration Platform',
  description: 'Advanced AI Agent Orchestration Platform with Sovereign Scroll integration, Astra DB memory core, and distributed computing capabilities with beautiful cyberpunk aesthetic',
}

// Force dynamic rendering to fix 404 issue
export const dynamic = 'force-dynamic'

export default function Home() {
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
          opacity: 0.8,
          marginBottom: '2rem'
        }}>
          🧠 Enhanced Nexus Core Protocol v6.0
        </p>
        <div style={{
          padding: '1rem 2rem',
          border: '2px solid #00ffff',
          borderRadius: '10px',
          background: 'rgba(0, 255, 255, 0.1)',
          maxWidth: '600px'
        }}>
          <p style={{ margin: 0, fontSize: '1rem' }}>
            ✅ Application Successfully Deployed
          </p>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', opacity: 0.7 }}>
            All systems operational • Clerk authentication active • Ready for development
          </p>
        </div>
      </div>
    </div>
  )
}
