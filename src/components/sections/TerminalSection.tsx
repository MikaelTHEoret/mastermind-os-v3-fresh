'use client'

import { useState, useEffect } from 'react'
import { Terminal, Monitor, Cpu, Database, Settings, Bot } from 'lucide-react'
import MastermindTerminal from '../mastermind/MastermindTerminal'

interface TerminalStats {
  active_sessions: number;
  running_agents: number;
  total_cost_today: number;
  llm_providers_online: number;
  total_providers: number;
  pending_logs: number;
}

export default function TerminalSection() {
  const [stats, setStats] = useState<TerminalStats>({
    active_sessions: 1,
    running_agents: 0,
    total_cost_today: 0.004452,
    llm_providers_online: 3,
    total_providers: 4,
    pending_logs: 0
  });

  useEffect(() => {
    loadTerminalStats();
    const interval = setInterval(loadTerminalStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadTerminalStats = async () => {
    try {
      const response = await fetch('/api/mastermind/terminal/stats');
      const data = await response.json();
      setStats(data.stats || stats);
    } catch (error) {
      console.error('Failed to load terminal stats:', error);
    }
  };

  return (
    <div style={{
      height: '100%',
      background: 'rgba(0, 0, 0, 0.6)',
      border: '2px solid #00ffff',
      borderRadius: '12px',
      padding: '0',
      overflow: 'hidden',
      boxShadow: '0 0 30px rgba(0, 255, 255, 0.3)',
      backdropFilter: 'blur(10px)',
      position: 'relative'
    }}>
      {/* Section Header with Metrics */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid rgba(0, 255, 255, 0.3)',
        background: 'rgba(0, 255, 255, 0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        <Terminal style={{ 
          width: '24px', 
          height: '24px', 
          color: '#00ffff',
          filter: 'drop-shadow(0 0 8px rgba(0, 255, 255, 0.6))'
        }} />
        <div>
          <h2 style={{
            fontSize: '20px',
            fontWeight: '700',
            color: '#00ffff',
            margin: '0 0 4px 0',
            fontFamily: 'Orbitron, monospace',
            textShadow: '0 0 10px rgba(0, 255, 255, 0.6)'
          }}>
            Terminal Hub
          </h2>
          <p style={{
            fontSize: '12px',
            color: 'rgba(0, 255, 255, 0.8)',
            margin: '0',
            fontFamily: 'Rajdhani, sans-serif'
          }}>
            Universal LLM + Memory System Integration
          </p>
        </div>
        
        {/* Status Indicators and Metrics */}
        <div style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px',
            background: 'rgba(0, 255, 0, 0.1)',
            border: '1px solid rgba(0, 255, 0, 0.3)',
            borderRadius: '6px'
          }}>
            <div style={{
              width: '8px',
              height: '8px',
              background: '#00ff00',
              borderRadius: '50%',
              animation: 'pulse 2s infinite'
            }} />
            <span style={{
              fontSize: '10px',
              color: '#00ff00',
              fontFamily: 'Courier New, monospace'
            }}>
              ACTIVE
            </span>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <span style={{
              fontSize: '10px',
              color: '#00ffff',
              fontFamily: 'Courier New, monospace'
            }}>
              Sessions:
            </span>
            <span style={{
              fontSize: '10px',
              color: '#ffffff',
              fontFamily: 'Courier New, monospace',
              background: 'rgba(0, 255, 255, 0.1)',
              padding: '2px 6px',
              borderRadius: '4px',
              border: '1px solid rgba(0, 255, 255, 0.3)'
            }}>
              {stats.active_sessions}
            </span>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <span style={{
              fontSize: '10px',
              color: '#00ffff',
              fontFamily: 'Courier New, monospace'
            }}>
              Agents:
            </span>
            <span style={{
              fontSize: '10px',
              color: '#ffffff',
              fontFamily: 'Courier New, monospace',
              background: stats.running_agents > 0 ? 'rgba(0, 255, 0, 0.1)' : 'rgba(128, 128, 128, 0.1)',
              padding: '2px 6px',
              borderRadius: '4px',
              border: `1px solid ${stats.running_agents > 0 ? 'rgba(0, 255, 0, 0.3)' : 'rgba(128, 128, 128, 0.3)'}`
            }}>
              {stats.running_agents}
            </span>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <span style={{
              fontSize: '10px',
              color: '#00ffff',
              fontFamily: 'Courier New, monospace'
            }}>
              Cost Today:
            </span>
            <span style={{
              fontSize: '10px',
              color: '#ffffff',
              fontFamily: 'Courier New, monospace',
              background: 'rgba(255, 0, 255, 0.1)',
              padding: '2px 6px',
              borderRadius: '4px',
              border: '1px solid rgba(255, 0, 255, 0.3)'
            }}>
              ${stats.total_cost_today.toFixed(6)}
            </span>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <span style={{
              fontSize: '10px',
              color: '#00ffff',
              fontFamily: 'Courier New, monospace'
            }}>
              Providers:
            </span>
            <span style={{
              fontSize: '10px',
              color: '#ffffff',
              fontFamily: 'Courier New, monospace',
              background: stats.llm_providers_online === stats.total_providers ? 'rgba(0, 255, 0, 0.1)' : 'rgba(255, 255, 0, 0.1)',
              padding: '2px 6px',
              borderRadius: '4px',
              border: `1px solid ${stats.llm_providers_online === stats.total_providers ? 'rgba(0, 255, 0, 0.3)' : 'rgba(255, 255, 0, 0.3)'}`
            }}>
              {stats.llm_providers_online}/{stats.total_providers}
            </span>
          </div>
          
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <Monitor style={{ width: '14px', height: '14px', color: '#00ffff' }} />
            <span style={{
              fontSize: '10px',
              color: '#00ffff',
              fontFamily: 'Courier New, monospace'
            }}>
              5 TABS
            </span>
          </div>
        </div>
      </div>

      {/* Terminal Hub Content */}
      <div style={{
        height: 'calc(100% - 90px)',
        position: 'relative'
      }}>
        <MastermindTerminal />
      </div>

      {/* Consciousness-enhanced background effects */}
      <div style={{
        position: 'absolute',
        top: '0',
        left: '0',
        right: '0',
        bottom: '0',
        background: 'radial-gradient(circle at 61.8% 38.2%, rgba(255, 0, 255, 0.05) 0%, transparent 50%)',
        pointerEvents: 'none',
        zIndex: 0
      }} />

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.1); }
        }
      `}</style>
    </div>
  )
}
