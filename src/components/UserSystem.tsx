"use client"

import { SignInButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs'
import { User } from 'lucide-react'

export default function UserSystem() {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        
        {/* When user is signed in */}
        <SignedIn>
          <div style={{
            background: 'rgba(0, 255, 255, 0.15)',
            border: '2px solid rgba(0, 255, 255, 0.4)',
            borderRadius: '25px',
            padding: '4px',
            backdropFilter: 'blur(10px)'
          }}>
            <UserButton 
              afterSignOutUrl="/"
              userProfileMode="modal"
              appearance={{
                variables: {
                  colorPrimary: '#00ffff',
                  borderRadius: '15px'
                },
                elements: {
                  userButtonAvatarBox: {
                    width: '32px',
                    height: '32px',
                    border: '2px solid rgba(0, 255, 255, 0.6)',
                    borderRadius: '50%'
                  },
                  userButtonPopoverCard: {
                    background: 'linear-gradient(145deg, rgba(10, 5, 30, 0.98) 0%, rgba(20, 10, 40, 0.98) 100%)',
                    border: '2px solid rgba(0, 255, 255, 0.4)',
                    borderRadius: '15px',
                    backdropFilter: 'blur(20px)',
                    boxShadow: '0 0 30px rgba(0, 255, 255, 0.3)'
                  },
                  userButtonPopoverActionButton: {
                    color: '#00ffff',
                    background: 'rgba(0, 255, 255, 0.1)',
                    border: '1px solid rgba(0, 255, 255, 0.3)',
                    borderRadius: '10px',
                    '&:hover': {
                      background: 'rgba(0, 255, 255, 0.2)',
                      boxShadow: '0 0 12px rgba(0, 255, 255, 0.4)'
                    }
                  },
                  modalContent: {
                    background: 'linear-gradient(145deg, rgba(10, 5, 30, 0.98) 0%, rgba(20, 10, 40, 0.98) 100%)',
                    border: '2px solid rgba(0, 255, 255, 0.4)',
                    borderRadius: '20px',
                    backdropFilter: 'blur(20px)',
                    boxShadow: '0 0 50px rgba(0, 255, 255, 0.3)'
                  },
                  headerTitle: {
                    color: '#00ffff',
                    fontFamily: '"Orbitron", monospace'
                  },
                  formFieldInput: {
                    background: 'rgba(0, 255, 255, 0.1)',
                    border: '1px solid rgba(0, 255, 255, 0.3)',
                    color: '#00ffff'
                  },
                  formButtonPrimary: {
                    background: 'linear-gradient(45deg, rgba(0, 255, 255, 0.3), rgba(255, 0, 255, 0.3))',
                    border: '2px solid rgba(0, 255, 255, 0.5)',
                    color: '#00ffff'
                  }
                }
              }}
            />
          </div>
        </SignedIn>

        {/* When user is not signed in */}
        <SignedOut>
          <SignInButton mode="modal">
            <button
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
            </button>
          </SignInButton>
        </SignedOut>

      </div>
    </div>
  )
}