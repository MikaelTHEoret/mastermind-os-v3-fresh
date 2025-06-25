import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import ScrollsSection from './components/sections/ScrollsSection';
import MemorySection from './components/sections/MemorySection';
import EnterpriseSection from './components/sections/EnterpriseSection';
import SmartAuthButton from './components/SmartAuthButton';
import './styles/globals.css';

function App() {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);

  const handleAuthChange = (authStatus, userData) => {
    setIsAuthenticated(authStatus);
    setUser(userData);
  };

  // Force background styling on page load
  useEffect(() => {
    // Force black background with 50% opacity on document body
    document.body.style.background = 'rgba(0, 0, 0, 0.5)';
    document.body.style.backdropFilter = 'none';
    
    // Also set on document element
    document.documentElement.style.background = 'rgba(0, 0, 0, 0.5)';
    document.documentElement.style.backdropFilter = 'none';
    
    // Set on any existing root elements
    const root = document.getElementById('root');
    if (root) {
      root.style.background = 'rgba(0, 0, 0, 0.5)';
      root.style.backdropFilter = 'none';
    }
  }, []);

  // Force black background with 50% opacity, no blur
  const appStyle = {
    minHeight: '100vh',
    width: '100%',
    background: 'rgba(0, 0, 0, 0.5)',
    backdropFilter: 'none',
    position: 'relative'
  };

  const mainContentStyle = {
    flex: 1,
    padding: '20px',
    background: 'rgba(0, 0, 0, 0.5)',
    backdropFilter: 'none'
  };

  return (
    <div className="app" style={appStyle}>
      <Header 
        activeSection={activeSection} 
        setActiveSection={setActiveSection}
        isAuthenticated={isAuthenticated}
        user={user}
      />
      
      <main className="main-content" style={mainContentStyle}>
        {!isAuthenticated ? (
          <div className="auth-container">
            <div className="auth-card">
              <div className="auth-header">
                <h1 className="auth-title">MasterMind OS</h1>
                <p className="auth-subtitle">Advanced Consciousness Computing Platform</p>
              </div>
              
              <div className="auth-features">
                <div className="feature-item">
                  <span className="feature-icon">🧠</span>
                  <span>Neural-Enhanced Processing</span>
                </div>
                <div className="feature-item">
                  <span className="feature-icon">📜</span>
                  <span>Sovereign Scroll Integration</span>
                </div>
                <div className="feature-item">
                  <span className="feature-icon">🔮</span>
                  <span>Quantum Memory Architecture</span>
                </div>
              </div>
              
              <SmartAuthButton onAuthChange={handleAuthChange} />
              
              <div className="auth-footer">
                <p>Experience the next evolution of human-AI collaboration</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {activeSection === 'dashboard' && <Dashboard user={user} />}
            {activeSection === 'scrolls' && <ScrollsSection />}
            {activeSection === 'memory' && <MemorySection />}
            {activeSection === 'enterprise' && <EnterpriseSection />}
          </>
        )}
      </main>
    </div>
  );
}

export default App;