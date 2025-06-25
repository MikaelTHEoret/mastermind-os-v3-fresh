import React from 'react';

const Header = ({ activeSection, setActiveSection, isAuthenticated, user }) => {
  if (!isAuthenticated) return null;

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
    { id: 'scrolls', label: 'Scrolls', icon: '📜' },
    { id: 'memory', label: 'Memory', icon: '🧠' },
    { id: 'enterprise', label: 'Enterprise', icon: '🏢' }
  ];

  return (
    <header className="header">
      <div className="header-content">
        <div className="header-brand">
          <span className="brand-icon">🧠</span>
          <span className="brand-text">MasterMind OS</span>
        </div>
        
        <nav className="header-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`nav-item ${activeSection === item.id ? 'nav-item-active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
        
        <div className="header-user">
          <div className="user-info">
            <span className="user-name">{user?.email || 'User'}</span>
            <span className="user-status">Connected</span>
          </div>
          <div className="user-avatar">
            {user?.email?.[0]?.toUpperCase() || 'U'}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;