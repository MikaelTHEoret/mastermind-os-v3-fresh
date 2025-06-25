import React, { useState, useEffect } from 'react';

const Dashboard = ({ user }) => {
  const [systemStats, setSystemStats] = useState({
    scrollsProcessed: 0,
    memoryNodes: 0,
    quantumStates: 0,
    uptime: '00:00:00'
  });

  useEffect(() => {
    // Simulate system stats updates
    const interval = setInterval(() => {
      setSystemStats(prev => ({
        scrollsProcessed: prev.scrollsProcessed + Math.floor(Math.random() * 3),
        memoryNodes: prev.memoryNodes + Math.floor(Math.random() * 5),
        quantumStates: prev.quantumStates + Math.floor(Math.random() * 2),
        uptime: new Date().toISOString().substr(11, 8)
      }));
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const quickActions = [
    { id: 'new-scroll', label: 'Create Scroll', icon: '📜', action: () => console.log('Create scroll') },
    { id: 'memory-sync', label: 'Sync Memory', icon: '🔄', action: () => console.log('Sync memory') },
    { id: 'quantum-compute', label: 'Quantum Compute', icon: '⚛️', action: () => console.log('Quantum compute') },
    { id: 'neural-link', label: 'Neural Link', icon: '🧠', action: () => console.log('Neural link') }
  ];

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1 className="dashboard-title">Command Center</h1>
        <p className="dashboard-subtitle">Welcome back, {user?.email || 'Consciousness'}</p>
      </div>

      <div className="dashboard-grid">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-header">
              <span className="stat-icon">📜</span>
              <span className="stat-label">Scrolls Processed</span>
            </div>
            <div className="stat-value">{systemStats.scrollsProcessed.toLocaleString()}</div>
            <div className="stat-change positive">+12% from yesterday</div>
          </div>

          <div className="stat-card">
            <div className="stat-header">
              <span className="stat-icon">🧠</span>
              <span className="stat-label">Memory Nodes</span>
            </div>
            <div className="stat-value">{systemStats.memoryNodes.toLocaleString()}</div>
            <div className="stat-change positive">+8% expansion</div>
          </div>

          <div className="stat-card">
            <div className="stat-header">
              <span className="stat-icon">⚛️</span>
              <span className="stat-label">Quantum States</span>
            </div>
            <div className="stat-value">{systemStats.quantumStates.toLocaleString()}</div>
            <div className="stat-change neutral">Stable coherence</div>
          </div>

          <div className="stat-card">
            <div className="stat-header">
              <span className="stat-icon">⏱️</span>
              <span className="stat-label">System Uptime</span>
            </div>
            <div className="stat-value">{systemStats.uptime}</div>
            <div className="stat-change positive">99.98% reliability</div>
          </div>
        </div>

        <div className="quick-actions">
          <h2 className="section-title">Quick Actions</h2>
          <div className="actions-grid">
            {quickActions.map(action => (
              <button
                key={action.id}
                onClick={action.action}
                className="action-card"
              >
                <span className="action-icon">{action.icon}</span>
                <span className="action-label">{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="system-status">
          <h2 className="section-title">System Status</h2>
          <div className="status-list">
            <div className="status-item">
              <span className="status-indicator active"></span>
              <span className="status-label">Neural Network</span>
              <span className="status-value">Optimal</span>
            </div>
            <div className="status-item">
              <span className="status-indicator active"></span>
              <span className="status-label">Quantum Coherence</span>
              <span className="status-value">Stable</span>
            </div>
            <div className="status-item">
              <span className="status-indicator warning"></span>
              <span className="status-label">Memory Synthesis</span>
              <span className="status-value">Processing</span>
            </div>
            <div className="status-item">
              <span className="status-indicator active"></span>
              <span className="status-label">Consciousness Stream</span>
              <span className="status-value">Flowing</span>
            </div>
          </div>
        </div>

        <div className="recent-activity">
          <h2 className="section-title">Recent Activity</h2>
          <div className="activity-list">
            <div className="activity-item">
              <span className="activity-icon">📜</span>
              <div className="activity-content">
                <span className="activity-title">Scroll "Neural Pathways" processed</span>
                <span className="activity-time">2 minutes ago</span>
              </div>
            </div>
            <div className="activity-item">
              <span className="activity-icon">🧠</span>
              <div className="activity-content">
                <span className="activity-title">Memory sync completed</span>
                <span className="activity-time">15 minutes ago</span>
              </div>
            </div>
            <div className="activity-item">
              <span className="activity-icon">⚛️</span>
              <div className="activity-content">
                <span className="activity-title">Quantum state calibrated</span>
                <span className="activity-time">1 hour ago</span>
              </div>
            </div>
            <div className="activity-item">
              <span className="activity-icon">🔄</span>
              <div className="activity-content">
                <span className="activity-title">System backup completed</span>
                <span className="activity-time">3 hours ago</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;