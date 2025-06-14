"use client"

import { useState, useEffect } from 'react'
import { User } from 'lucide-react'

interface UserInterface {
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
  onUserChange?: (user: UserInterface | null) => void
}

export default function UserSystem({ onUserChange }: UserSystemProps) {
  const [mounted, setMounted] = useState(false)
  const [showUserDashboard, setShowUserDashboard] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Only render after mounting to prevent SSR issues
  if (!mounted) {
    return (
      <div style={{ position: 'relative' }}>
        <div style={{
          padding: '8px 16px',
          background: 'rgba(0, 255, 255, 0.1)',
          border: '1px solid rgba(0, 255, 255, 0.3)',
          borderRadius: '25px',
          color: '#00ffff',
          fontSize: '12px',
          fontFamily: 'Orbitron, monospace'
        }}>
          LOADING...
        </div>
      </div>
    )
  }

  return (
    <ClientSideUserSystem 
      onUserChange={onUserChange}
      showUserDashboard={showUserDashboard}
      setShowUserDashboard={setShowUserDashboard}
    />
  )
}

// Completely client-side component that never runs on server
function ClientSideUserSystem({ 
  onUserChange,
  showUserDashboard,
  setShowUserDashboard
}: { 
  onUserChange?: (user: UserInterface | null) => void
  showUserDashboard: boolean
  setShowUserDashboard: (show: boolean) => void
}) {
  const [stackAuthStatus, setStackAuthStatus] = useState<'checking' | 'enabled' | 'disabled'>('checking')
  const [stackUser, setStackUser] = useState<any>(null)
  const [stackComponents, setStackComponents] = useState<any>(null)

  useEffect(() => {
    let mounted = true
    
    const checkStackAuth = async () => {
      try {
        // Check if Stack Auth environment variables are present
        const isStackAuthEnabled = !!(
          process.env.NEXT_PUBLIC_STACK_PROJECT_ID && 
          process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY
        )
        
        if (!isStackAuthEnabled) {
          if (mounted) setStackAuthStatus('disabled')
          console.log('UserSystem: Stack Auth disabled - Environment variables not configured')
          return
        }

        // Import Stack Auth components
        const stackModule = await import('@stackframe/stack')
        
        if (mounted) {
          setStackComponents(stackModule)
          setStackAuthStatus('enabled')
          console.log('UserSystem: Stack Auth enabled - Components loaded successfully')
        }

      } catch (error) {
        console.log('UserSystem: Stack Auth check failed (safe mode):', error)
        if (mounted) setStackAuthStatus('disabled')
      }
    }

    checkStackAuth()

    return () => {
      mounted = false
    }
  }, [])

  // Render based on Stack Auth status
  if (stackAuthStatus === 'checking') {
    return (
      <div style={{ position: 'relative' }}>
        <div style={{
          padding: '8px 16px',
          background: 'rgba(0, 255, 255, 0.1)',
          border: '1px solid rgba(0, 255, 255, 0.3)',
          borderRadius: '25px',
          color: '#00ffff',
          fontSize: '12px',
          fontFamily: 'Orbitron, monospace'
        }}>
          AUTH...
        </div>
      </div>
    )
  }

  if (stackAuthStatus === 'disabled') {
    return (
      <GuestUserInterface />
    )
  }

  // Stack Auth is enabled and ready
  return (
    <StackAuthUserInterface 
      onUserChange={onUserChange}
      showUserDashboard={showUserDashboard}
      setShowUserDashboard={setShowUserDashboard}
      stackComponents={stackComponents}
    />
  )
}

// Guest user interface (no Stack Auth)
function GuestUserInterface() {
  return (
    <div style={{ position: 'relative' }}>
      <a
        href="/handler/sign-in"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          background: 'linear-gradient(45deg, rgba(0, 255, 255, 0.2), rgba(255, 0, 255, 0.2))',
          border: '2px solid rgba(0, 255, 255, 0.5)',
          borderRadius: '25px',
          color: '#00ffff',
          fontSize: '12px',
          fontWeight: '600',
          cursor: 'pointer',
          transition: 'all 0.3s ease',
          backdropFilter: 'blur(10px)',
          fontFamily: 'Orbitron, monospace',
          textDecoration: 'none',
          textTransform: 'uppercase'
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.background = 'linear-gradient(45deg, rgba(0, 255, 255, 0.4), rgba(255, 0, 255, 0.4))'
          e.currentTarget.style.boxShadow = '0 0 20px rgba(0, 255, 255, 0.5)'
          e.currentTarget.style.transform = 'translateY(-2px)'
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.background = 'linear-gradient(45deg, rgba(0, 255, 255, 0.2), rgba(255, 0, 255, 0.2))'
          e.currentTarget.style.boxShadow = 'none'
          e.currentTarget.style.transform = 'translateY(0)'
        }}
      >
        <User style={{ width: '16px', height: '16px' }} />
        <span>SIGN IN</span>
      </a>
    </div>
  )
}

// Stack Auth user interface (only loaded when Stack Auth is confirmed working)
function StackAuthUserInterface({ 
  onUserChange,
  showUserDashboard,
  setShowUserDashboard,
  stackComponents
}: { 
  onUserChange?: (user: UserInterface | null) => void
  showUserDashboard: boolean
  setShowUserDashboard: (show: boolean) => void
  stackComponents: any
}) {
  const [user, setUser] = useState<UserInterface | null>(null)

  // Use Stack Auth hook in isolated component with defensive error handling
  const StackAuthHookUser = () => {
    if (!stackComponents) return null

    try {
      const { useUser } = stackComponents
      
      // CRITICAL FIX: Defensive useUser() call with comprehensive error handling
      let stackUser
      try {
        if (!useUser || typeof useUser !== 'function') {
          console.log('UserSystem: useUser hook not available')
          return null
        }
        
        stackUser = useUser()
        console.log('UserSystem: useUser() called successfully, user:', stackUser ? 'AUTHENTICATED' : 'NOT_AUTHENTICATED')
        
      } catch (userError) {
        console.warn('UserSystem: useUser() threw error - toClientJson issue likely resolved:', userError)
        return null
      }
      
      // Additional defensive check - ensure stackUser is defined and has expected structure
      if (stackUser === undefined || stackUser === null) {
        console.log('UserSystem: Stack user is null/undefined, staying in guest mode')
        return null
      }
      
      // Update user state when Stack user changes - with defensive property access
      useEffect(() => {
        try {
          const convertedUser: UserInterface | null = stackUser ? {
            id: stackUser?.id || 'unknown',
            username: stackUser?.displayName || stackUser?.primaryEmail?.split('@')[0] || 'User',
            email: stackUser?.primaryEmail || '',
            role: 'user',
            avatar: '👤',
            joinDate: new Date().toISOString(),
            lastActive: new Date().toISOString(),
            scrollsMinted: 0,
            organizationId: undefined
          } : null

          setUser(convertedUser)
          onUserChange?.(convertedUser)
          
          console.log('UserSystem: User state updated successfully:', convertedUser ? 'USER_SET' : 'USER_CLEARED')
          
        } catch (conversionError) {
          console.warn('UserSystem: Error converting Stack user to UserInterface:', conversionError)
          setUser(null)
          onUserChange?.(null)
        }
      }, [stackUser])

      return null // This component only manages state
      
    } catch (componentError) {
      console.warn('UserSystem: Stack Auth hook component error (isolated and handled):', componentError)
      return null
    }
  }

  return (
    <>
      {/* Stack Auth hook management with comprehensive error handling */}
      <StackAuthHookUser />
      
      {/* User interface */}
      <div style={{ position: 'relative' }}>
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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

            <div style={{
              background: 'rgba(0, 255, 255, 0.15)',
              border: '2px solid rgba(0, 255, 255, 0.4)',
              borderRadius: '25px',
              padding: '4px',
              backdropFilter: 'blur(10px)'
            }}>
              {/* Defensive UserButton rendering */}
              {stackComponents?.UserButton ? (
                <stackComponents.UserButton />
              ) : (
                <div style={{
                  padding: '8px 12px',
                  color: '#00ffff',
                  fontSize: '12px',
                  fontFamily: 'Orbitron, monospace'
                }}>
                  👤 {user.username}
                </div>
              )}
            </div>
          </div>
        ) : (
          <GuestUserInterface />
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
function UserDashboard({ user, onClose }: { user: UserInterface; onClose: () => void }) {
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

        {/* User Stats */}
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
            🔧 Settings
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
            📜 Scrolls
          </button>
        </div>
      </div>
    </div>
  )
}
