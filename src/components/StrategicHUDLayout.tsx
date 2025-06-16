import React from 'react'

interface HUDLayoutProps {
  leftSidebar?: React.ReactNode
  mainContent: React.ReactNode
  rightSidebar?: React.ReactNode
  statusBar?: React.ReactNode
  topBar?: React.ReactNode
}

export default function StrategicHUDLayout({
  leftSidebar,
  mainContent,
  rightSidebar,
  statusBar,
  topBar
}: HUDLayoutProps) {
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'transparent', // Let NexusBackground show through
      position: 'relative'
    }}>
      {/* Top Status Bar */}
      {topBar && (
        <div style={{
          padding: '8px 16px',
          background: 'rgba(0, 0, 0, 0.4)',
          border: '1px solid rgba(0, 255, 255, 0.2)',
          borderRadius: '8px',
          margin: '12px',
          marginBottom: '8px',
          backdropFilter: 'blur(8px)'
        }}>
          {topBar}
        </div>
      )}

      {/* Main Content Grid */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: leftSidebar && rightSidebar 
          ? '280px 1fr 280px' 
          : leftSidebar 
          ? '280px 1fr' 
          : rightSidebar 
          ? '1fr 280px' 
          : '1fr',
        gap: '12px',
        padding: '0 16px',
        overflow: 'hidden'
      }}>
        {/* Left Sidebar */}
        {leftSidebar && (
          <div style={{
            background: 'rgba(0, 20, 40, 0.6)',
            border: '1px solid rgba(0, 255, 255, 0.25)',
            borderRadius: '8px',
            padding: '16px',
            backdropFilter: 'blur(8px)',
            overflowY: 'auto'
          }}>
            {leftSidebar}
          </div>
        )}

        {/* Main Content Area */}
        <div style={{
          background: 'rgba(0, 0, 0, 0.4)',
          border: '1px solid rgba(0, 255, 255, 0.3)',
          borderRadius: '8px',
          padding: '20px',
          backdropFilter: 'blur(12px)',
          overflowY: 'auto',
          position: 'relative'
        }}>
          {mainContent}
        </div>

        {/* Right Sidebar */}
        {rightSidebar && (
          <div style={{
            background: 'rgba(0, 20, 40, 0.6)',
            border: '1px solid rgba(0, 255, 255, 0.25)',
            borderRadius: '8px',
            padding: '16px',
            backdropFilter: 'blur(8px)',
            overflowY: 'auto'
          }}>
            {rightSidebar}
          </div>
        )}
      </div>

      {/* Bottom Status Bar */}
      {statusBar && (
        <div style={{
          padding: '8px 16px',
          background: 'rgba(0, 0, 0, 0.5)',
          border: '1px solid rgba(0, 255, 255, 0.2)',
          borderRadius: '20px',
          margin: '12px',
          marginTop: '8px',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          justifyContent: 'center'
        }}>
          {statusBar}
        </div>
      )}
    </div>
  )
}

// Component for professional metric displays
export function MetricCard({ 
  value, 
  label, 
  color = '#00ffff',
  trend
}: { 
  value: string | number
  label: string
  color?: string
  trend?: 'up' | 'down' | 'stable'
}) {
  const trendColors = {
    up: '#00ff88',
    down: '#ff4444',
    stable: '#ffaa00'
  }

  return (
    <div style={{
      background: 'rgba(0, 20, 40, 0.6)',
      border: '1px solid rgba(0, 255, 255, 0.25)',
      borderRadius: '8px',
      padding: '12px',
      textAlign: 'center',
      minWidth: '120px'
    }}>
      <div style={{
        fontSize: '24px',
        fontWeight: '600',
        color: color,
        fontFamily: 'Orbitron, monospace',
        marginBottom: '4px'
      }}>
        {value}
      </div>
      <div style={{
        fontSize: '11px',
        color: 'rgba(255, 255, 255, 0.7)',
        textTransform: 'uppercase',
        fontFamily: 'Rajdhani, sans-serif'
      }}>
        {label}
      </div>
      {trend && (
        <div style={{
          fontSize: '10px',
          color: trendColors[trend],
          marginTop: '2px'
        }}>
          {trend === 'up' ? '↗' : trend === 'down' ? '↘' : '→'} {trend}
        </div>
      )}
    </div>
  )
}

// Professional status indicator
export function StatusIndicator({ 
  status, 
  label 
}: { 
  status: 'online' | 'offline' | 'warning' | 'error'
  label: string 
}) {
  const statusColors = {
    online: '#00ff88',
    offline: '#666666',
    warning: '#ffaa00',
    error: '#ff4444'
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 8px',
      background: 'rgba(0, 0, 0, 0.3)',
      borderRadius: '12px',
      fontSize: '11px',
      fontFamily: 'Rajdhani, sans-serif'
    }}>
      <div style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: statusColors[status],
        boxShadow: `0 0 6px ${statusColors[status]}`
      }} />
      <span style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
        {label}
      </span>
    </div>
  )
}

// Progress bar component
export function ProgressBar({ 
  progress, 
  label,
  color = '#00ffff'
}: { 
  progress: number
  label?: string
  color?: string
}) {
  return (
    <div style={{ marginBottom: '8px' }}>
      {label && (
        <div style={{
          fontSize: '11px',
          color: 'rgba(255, 255, 255, 0.7)',
          marginBottom: '4px',
          fontFamily: 'Rajdhani, sans-serif'
        }}>
          {label}
        </div>
      )}
      <div style={{
        background: 'rgba(0, 0, 0, 0.6)',
        borderRadius: '10px',
        height: '6px',
        overflow: 'hidden'
      }}>
        <div style={{
          background: `linear-gradient(90deg, ${color}, ${color}80)`,
          height: '100%',
          borderRadius: '10px',
          width: `${Math.min(100, Math.max(0, progress))}%`,
          transition: 'width 0.5s ease'
        }} />
      </div>
    </div>
  )
}
