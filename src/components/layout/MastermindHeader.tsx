'use client'
import { useState, useEffect } from 'react'

interface MastermindHeaderProps {
  activePanel: string
  onPanelChange: (panel: string) => void
  user: any
  onShowLogin: () => void
  onSignOut: () => void
}

export default function MastermindHeader({ 
  activePanel, 
  onPanelChange, 
  user, 
  onShowLogin, 
  onSignOut 
}: MastermindHeaderProps) {
  const navigationTabs = [
    { id: 'nexus', label: 'NEXUS CORE', color: '#00ffff', icon: '⚡' },
    { id: 'scrolls', label: 'SCROLLS', color: '#00ffff', icon: '⧉' },
    { id: 'memory', label: 'MEMORY', color: '#00ffff', icon: '💾' },
    { id: 'analytics', label: 'ANALYTICS', color: '#00ffff', icon: '📊' },
    { id: 'enterprise', label: 'ENTERPRISE', color: '#00ffff', icon: '🏢' },
    { id: 'dashboard', label: 'DASHBOARD', color: '#00ffff', icon: '👤' }
  ]

  return (
    <header style={{
      background: 'rgba(0, 0, 0, 0.8)', // Black semi-transparent
      border: '1px solid rgba(6, 182, 212, 0.3)', // Cyan border
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 24px',
      backdropFilter: 'blur(10px)',
      borderRadius: '0',
      height: '50px'
    }}>
      {/* Left - Logo */}
      <div style={{
        fontFamily: 'Orbitron, monospace',
        fontSize: '24px',
        fontWeight: '700',
        color: '#00ffff',
        textShadow: '0 0 10px rgba(6, 182, 212, 0.5)'
      }}>
        MASTERMIND OS
      </div>

      {/* Center - Navigation Tabs */}
      <div style={{ 
        display: 'flex', 
        gap: '4px'
      }}>
        {navigationTabs.map((nav) => (
          <button
            key={nav.id}
            onClick={() => onPanelChange(nav.id)}
            style={{
              padding: '8px 16px',
              background: activePanel === nav.id 
                ? 'rgba(6, 182, 212, 0.3)'
                : 'rgba(0, 0, 0, 0.4)',
              border: `1px solid ${activePanel === nav.id ? '#00ffff' : 'rgba(6, 182, 212, 0.2)'}`,
              borderRadius: '6px',
              color: activePanel === nav.id ? '#00ffff' : '#9ca3af',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontFamily: 'Orbitron, monospace',
              textAlign: 'center',
              minWidth: '80px'
            }}
            onMouseOver={(e) => {
              if (activePanel !== nav.id) {
                e.currentTarget.style.color = '#00ffff'
                e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.4)'
                e.currentTarget.style.background = 'rgba(6, 182, 212, 0.1)'
              }
            }}
            onMouseOut={(e) => {
              if (activePanel !== nav.id) {
                e.currentTarget.style.color = '#9ca3af'
                e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.2)'
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.4)'
              }
            }}
          >
            <span style={{ marginRight: '4px' }}>{nav.icon}</span>
            {nav.label}
          </button>
        ))}
      </div>

      {/* Right - Sign In Button */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {user ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            background: 'rgba(6, 182, 212, 0.2)',
            border: '1px solid rgba(6, 182, 212, 0.3)',
            borderRadius: '6px',
            color: '#00ffff'
          }}>
            <span>👤</span>
            <span style={{ fontSize: '14px' }}>{user.displayName || user.username || 'User'}</span>
            <button
              onClick={onSignOut}
              style={{
                marginLeft: '8px',
                padding: '4px 8px',
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '4px',
                color: '#ef4444',
                fontSize: '10px',
                cursor: 'pointer'
              }}
            >
              SIGN OUT
            </button>
          </div>
        ) : (
          <button
            onClick={onShowLogin}
            style={{
              padding: '8px 16px',
              background: 'rgba(6, 182, 212, 0.2)',
              border: '1px solid rgba(6, 182, 212, 0.3)',
              borderRadius: '6px',
              color: '#00ffff',
              fontSize: '14px',
              fontFamily: 'Orbitron, monospace',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(6, 182, 212, 0.3)'
              e.currentTarget.style.borderColor = '#00ffff'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(6, 182, 212, 0.2)'
              e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.3)'
            }}
          >
            SIGN IN
          </button>
        )}
      </div>
    </header>
  )
}