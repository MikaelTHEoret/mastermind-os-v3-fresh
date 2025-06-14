export default function Home() {
  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#000', 
      color: '#00ffff', 
      padding: '2rem',
      fontFamily: 'monospace'
    }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>
        🧠 MASTERMIND OS v3 - FRESH START!
      </h1>
      <p style={{ fontSize: '1.5rem', color: '#00ff00' }}>
        ✅ SUCCESS! This Next.js app is WORKING!
      </p>
      <p style={{ marginTop: '1rem', color: '#ffff00' }}>
        Fresh repository, clean deployment, no more 404 madness!
      </p>
      <button 
        style={{ 
          marginTop: '2rem',
          padding: '1rem 2rem',
          background: '#00ffff',
          color: '#000',
          border: 'none',
          borderRadius: '8px',
          fontSize: '1rem',
          cursor: 'pointer'
        }}
      >
        Test Button - WORKING!
      </button>
    </div>
  )
}