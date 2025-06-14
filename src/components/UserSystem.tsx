"use client"

import { useState, useEffect } from 'react'
import { useUser, UserButton } from '@stackframe/stack'
import { ErrorBoundary } from 'react-error-boundary'

interface User {
  id: string
  username: string
  email: string
  role: 'admin' | 'developer' | 'user'
  avatar?: string
  joinDate: string
  lastActive: string
  scrollsMinted: number
  organizationId?: string
}

interface UserSystemProps {
  onUserChange?: (user: User | null) => void
}

// Error fallback component for UserButton
function UserButtonErrorFallback() {
  return (
    <div style={{
      background: 'rgba(255, 68, 68, 0.15)',
      border: '1px solid rgba(255, 68, 68, 0.4)',
      borderRadius: '15px',
      padding: '6px 12px',
      color: '#ff4444',
      fontSize: '11px',
      fontWeight: '600',
      fontFamily: 'Rajdhani, sans-serif'
    }}>
      ⚠️ Auth Error
    </div>
  )
}

export default function UserSystem({ onUserChange }: UserSystemProps) {
  const stackUser = useUser()
  const [showUserDashboard, setShowUserDashboard] = useState(false)

  // Convert Stack Auth user to our User interface
  const user: User | null = stackUser ? {
    id: stackUser.id,
    username: stackUser.displayName || 'User',
    email: stackUser.primaryEmail || '',
    role: 'user', // Default role, could be enhanced with custom user metadata
    avatar: '👤',
    joinDate: new Date().toISOString(), // Could be enhanced with actual join date
    lastActive: new Date().toISOString(),
    scrollsMinted: 0, // Could be enhanced with actual data
    organizationId: undefined
  } : null

  useEffect(() => {
    onUserChange?.(user)
  }, [user, onUserChange])

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin': return '#ff00ff'
      case 'developer': return '#00ffff'
      case 'user': return '#00ffaa'
      default: return '#888'
    }
  }

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin': return '👑'
      case 'developer': return '🔧'
      case 'user': return '👤'
      default: return '❓'
    }
  }

  return (
    <>
      {/* User Authentication - Use Stack Auth UserButton */}
      <div style={{ position: 'relative' }}>
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* User Dashboard Button */}
            <button
              onClick={() => setShowUserDashboard(true)}
              style={{
                padding: '6px 12px',
                background: 'rgba(0, 255, 255, 0.15)',
                border: '1px solid rgba(0, 255, 255, 0.4)',
                borderRadius: '15px',
                color: '#00ffff',
                fontSize: '11px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                backdropFilter: 'blur(10px)',
                fontFamily: 'Rajdhani, sans-serif'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(0, 255, 255, 0.25)'
                e.currentTarget.style.boxShadow = '0 0 12px rgba(0, 255, 255, 0.4)'
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(0, 255, 255, 0.15)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              📊 DASHBOARD
            </button>

            {/* Stack Auth UserButton with ErrorBoundary Protection */}
            <div style={{
              background: 'rgba(0, 255, 255, 0.15)',
              border: '2px solid rgba(0, 255, 255, 0.4)',
              borderRadius: '25px',
              padding: '4px',
              backdropFilter: 'blur(10px)'
            }}>
              <ErrorBoundary fallback={<UserButtonErrorFallback />}>
                <UserButton />
              </ErrorBoundary>
            </div>
          </div>
        ) : (
          // Sign In Button - Stack Auth will handle the routing
          <a
            href="/handler/sign-in"
            style={{
              display: 'inline-block',
              padding: '8px 16px',
              background: 'linear-gradient(45deg, rgba(255, 0, 255, 0.2), rgba(255, 215, 0, 0.2))',
              border: '2px solid rgba(255, 0, 255, 0.5)',
              borderRadius: '25px',
              color: '#ff00ff',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              backdropFilter: 'blur(10px)',
              fontFamily: 'Orbitron, monospace',
              textDecoration: 'none'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'linear-gradient(45deg, rgba(255, 0, 255, 0.4), rgba(255, 215, 0, 0.4))'
              e.currentTarget.style.boxShadow = '0 0 20px rgba(255, 0, 255, 0.5)'
              e.currentTarget.style.transform = 'translateY(-2px)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'linear-gradient(45deg, rgba(255, 0, 255, 0.2), rgba(255, 215, 0, 0.2))'
              e.currentTarget.style.boxShadow = 'none'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            🔐 LOGIN / REGISTER
          </a>
        )}
      </div>

      {/* User Dashboard Modal */}
      {showUserDashboard && user && (
        <UserDashboard 
          user={user}
          onClose={() => setShowUserDashboard(false)}
        />
      )}
    </>
  )
}

// User Dashboard Component
function UserDashboard({ user, onClose }: { user: User; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2000,
      backdropFilter: 'blur(10px)'
    }}>
      <div style={{
        background: 'linear-gradient(145deg, rgba(10, 5, 30, 0.95) 0%, rgba(20, 10, 40, 0.95) 100%)',
        border: '2px solid rgba(0, 255, 255, 0.4)',
        borderRadius: '20px',
        padding: '30px',
        maxWidth: '600px',
        width: '90%',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 0 50px rgba(0, 255, 255, 0.3)',
        maxHeight: '80vh',
        overflowY: 'auto'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '25px',
          borderBottom: '1px solid rgba(0, 255, 255, 0.3)',
          paddingBottom: '15px'
        }}>
          <div style={{
            fontFamily: 'Orbitron, monospace',
            fontSize: '18px',
            fontWeight: '700',
            color: '#00ffff'
          }}>
            📊 User Dashboard
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 68, 68, 0.2)',
              border: '1px solid rgba(255, 68, 68, 0.3)',
              borderRadius: '50%',
              width: '30px',
              height: '30px',
              color: '#ff4444',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            ❌
          </button>
        </div>

        {/* User Info */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '15px',
          marginBottom: '25px',
          padding: '20px',
          background: 'rgba(0, 255, 255, 0.1)',
          border: '1px solid rgba(0, 255, 255, 0.3)',
          borderRadius: '15px'
        }}>
          <span style={{ fontSize: '32px' }}>{user.avatar}</span>
          <div>
            <div style={{
              fontSize: '20px',
              fontWeight: '700',
              color: '#00ffff',
              fontFamily: 'Orbitron, monospace'
            }}>
              {user.username}
            </div>
            <div style={{
              fontSize: '14px',
              color: '#888',
              fontFamily: 'Rajdhani, sans-serif'
            }}>
              {user.email}
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '8px',
              padding: '4px 8px',
              background: 'rgba(0, 255, 170, 0.2)',
              border: '1px solid #00ffaa',
              borderRadius: '10px',
              fontSize: '12px',
              width: 'fit-content'
            }}>
              <span>👤</span>
              <span style={{ color: '#00ffaa', fontWeight: '600' }}>
                {user.role.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* User Stats Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '15px',
          marginBottom: '25px'
        }}>
          <div style={{
            background: 'rgba(255, 215, 0, 0.1)',
            border: '1px solid rgba(255, 215, 0, 0.3)',
            borderRadius: '10px',
            padding: '15px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#ffd700' }}>
              {user.scrollsMinted}
            </div>
            <div style={{ fontSize: '12px', color: '#888' }}>Scrolls Minted</div>
          </div>

          <div style={{
            background: 'rgba(0, 255, 170, 0.1)',
            border: '1px solid rgba(0, 255, 170, 0.3)',
            borderRadius: '10px',
            padding: '15px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#00ffaa' }}>
              {Math.floor(Math.random() * 50 + 10)}
            </div>
            <div style={{ fontSize: '12px', color: '#888' }}>KBT Tokens</div>
          </div>

          <div style={{
            background: 'rgba(255, 0, 255, 0.1)',
            border: '1px solid rgba(255, 0, 255, 0.3)',
            borderRadius: '10px',
            padding: '15px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#ff00ff' }}>
              {Math.floor(Math.random() * 100 + 50)}
            </div>
            <div style={{ fontSize: '12px', color: '#888' }}>Reputation</div>
          </div>

          <div style={{
            background: 'rgba(0, 255, 255, 0.1)',
            border: '1px solid rgba(0, 255, 255, 0.3)',
            borderRadius: '10px',
            padding: '15px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#00ffff' }}>
              {Math.floor((Date.now() - new Date(user.joinDate).getTime()) / (1000 * 60 * 60 * 24))}
            </div>
            <div style={{ fontSize: '12px', color: '#888' }}>Days Active</div>
          </div>
        </div>

        {/* Recent Activity */}
        <div style={{
          background: 'rgba(0, 0, 0, 0.3)',
          border: '1px solid rgba(0, 255, 255, 0.2)',
          borderRadius: '10px',
          padding: '20px'
        }}>
          <h4 style={{ color: '#00ffff', marginBottom: '15px', fontSize: '14px' }}>
            📈 Recent Activity
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[
              { action: 'Logged In', item: 'MasterMind OS v3', time: 'Just now' },
              { action: 'Account Created', item: 'Welcome to the platform!', time: 'Today' },
              { action: 'Ready to Mint', item: 'Start creating scrolls', time: 'Today' },
            ].map((activity, index) => (
              <div key={index} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                background: 'rgba(0, 255, 255, 0.05)',
                borderRadius: '6px',
                fontSize: '12px'
              }}>
                <div>
                  <span style={{ color: '#00ffff', fontWeight: '600' }}>{activity.action}</span>
                  <span style={{ color: '#888', marginLeft: '8px' }}>{activity.item}</span>
                </div>
                <span style={{ color: '#888', fontSize: '10px' }}>{activity.time}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{
          display: 'flex',
          gap: '10px',
          marginTop: '20px'
        }}>
          <button style={{
            flex: 1,
            padding: '12px',
            background: 'rgba(0, 255, 255, 0.2)',
            border: '1px solid rgba(0, 255, 255, 0.4)',
            borderRadius: '8px',
            color: '#00ffff',
            fontSize: '12px',
            fontWeight: '600',
            cursor: 'pointer',
            fontFamily: 'Rajdhani, sans-serif'
          }}>
            🔧 Account Settings
          </button>
          
          <button style={{
            flex: 1,
            padding: '12px',
            background: 'rgba(255, 215, 0, 0.2)',
            border: '1px solid rgba(255, 215, 0, 0.4)',
            borderRadius: '8px',
            color: '#ffd700',
            fontSize: '12px',
            fontWeight: '600',
            cursor: 'pointer',
            fontFamily: 'Rajdhani, sans-serif'
          }}>
            📜 View Scrolls
          </button>
        </div>
      </div>
    </div>
  )
}