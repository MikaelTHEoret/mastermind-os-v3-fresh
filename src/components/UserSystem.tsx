"use client"

import { SignInButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs'
import { User } from 'lucide-react'

export default function UserSystem() {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        
        {/* When user is signed in - Only Clerk's UserButton */}
        <SignedIn>
          <div style={{
            background: 'rgba(0, 255, 255, 0.15)',
            border: '2px solid rgba(0, 255, 255, 0.4)',
            borderRadius: '25px',
            padding: '4px',
            backdropFilter: 'blur(10px)',
            transition: 'all 0.3s ease'
          }}>
            <UserButton 
              afterSignOutUrl="/"
              userProfileMode="modal"
              appearance={{
                elements: {
                  userButtonBox: {
                    width: '36px',
                    height: '36px'
                  },
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
                    boxShadow: '0 0 30px rgba(0, 255, 255, 0.3)',
                    padding: '15px',
                    minWidth: '200px'
                  },
                  userButtonPopoverActionButton: {
                    color: '#00ffff',
                    background: 'rgba(0, 255, 255, 0.1)',
                    border: '1px solid rgba(0, 255, 255, 0.3)',
                    borderRadius: '10px',
                    padding: '10px 15px',
                    fontSize: '13px',
                    fontFamily: '"Rajdhani", sans-serif',
                    margin: '3px 0',
                    width: '100%',
                    textAlign: 'left',
                    '&:hover': {
                      background: 'rgba(0, 255, 255, 0.2)',
                      boxShadow: '0 0 12px rgba(0, 255, 255, 0.4)',
                      transform: 'translateX(3px)'
                    }
                  },
                  userButtonPopoverActionButtonText: {
                    color: '#00ffff',
                    fontFamily: '"Rajdhani", sans-serif'
                  },
                  userButtonPopoverActionButtonIcon: {
                    color: '#00ffff'
                  }
                }
              }}
              userProfileProps={{
                appearance: {
                  elements: {
                    // Main modal container
                    modalContent: {
                      background: 'linear-gradient(145deg, rgba(10, 5, 30, 0.98) 0%, rgba(20, 10, 40, 0.98) 100%)',
                      border: '2px solid rgba(0, 255, 255, 0.4)',
                      borderRadius: '20px',
                      backdropFilter: 'blur(20px)',
                      boxShadow: '0 0 50px rgba(0, 255, 255, 0.3), inset 0 0 20px rgba(0, 255, 255, 0.1)',
                      color: '#00ffff',
                      maxWidth: '800px',
                      width: '90vw',
                      maxHeight: '90vh'
                    },
                    modalCloseButton: {
                      color: '#ff4444',
                      background: 'rgba(255, 68, 68, 0.2)',
                      border: '1px solid rgba(255, 68, 68, 0.3)',
                      borderRadius: '50%',
                      width: '32px',
                      height: '32px',
                      '&:hover': {
                        background: 'rgba(255, 68, 68, 0.4)',
                        boxShadow: '0 0 12px rgba(255, 68, 68, 0.5)'
                      }
                    },
                    
                    // Page layout
                    page: {
                      background: 'transparent',
                      color: '#00ffff'
                    },
                    pageScrollBox: {
                      background: 'transparent'
                    },
                    
                    // Headers and titles
                    headerTitle: {
                      color: '#00ffff',
                      fontFamily: '"Orbitron", monospace',
                      fontSize: '24px',
                      fontWeight: '700',
                      textAlign: 'center',
                      marginBottom: '20px',
                      textShadow: '0 0 10px rgba(0, 255, 255, 0.5)'
                    },
                    headerSubtitle: {
                      color: '#888',
                      fontFamily: '"Rajdhani", sans-serif',
                      fontSize: '16px',
                      textAlign: 'center'
                    },
                    
                    // Navbar
                    navbar: {
                      background: 'rgba(0, 255, 255, 0.1)',
                      border: '1px solid rgba(0, 255, 255, 0.3)',
                      borderRadius: '15px',
                      padding: '10px',
                      marginBottom: '20px'
                    },
                    navbarButton: {
                      color: '#888',
                      background: 'transparent',
                      border: 'none',
                      padding: '8px 15px',
                      borderRadius: '10px',
                      fontFamily: '"Rajdhani", sans-serif',
                      '&:hover': {
                        color: '#00ffff',
                        background: 'rgba(0, 255, 255, 0.1)'
                      },
                      '&[data-active="true"]': {
                        color: '#00ffff',
                        background: 'rgba(0, 255, 255, 0.2)',
                        borderBottom: '2px solid #00ffff'
                      }
                    },
                    
                    // Form elements
                    card: {
                      background: 'rgba(0, 255, 255, 0.05)',
                      border: '1px solid rgba(0, 255, 255, 0.2)',
                      borderRadius: '15px',
                      padding: '20px',
                      margin: '10px 0',
                      backdropFilter: 'blur(10px)'
                    },
                    formFieldInput: {
                      background: 'rgba(0, 255, 255, 0.1)',
                      border: '1px solid rgba(0, 255, 255, 0.3)',
                      borderRadius: '12px',
                      color: '#00ffff',
                      padding: '12px 16px',
                      fontSize: '14px',
                      fontFamily: '"Rajdhani", sans-serif',
                      '&:focus': {
                        borderColor: 'rgba(0, 255, 255, 0.6)',
                        boxShadow: '0 0 12px rgba(0, 255, 255, 0.3)',
                        outline: 'none'
                      },
                      '&::placeholder': {
                        color: 'rgba(0, 255, 255, 0.5)'
                      }
                    },
                    formFieldLabel: {
                      color: '#00ffff',
                      fontFamily: '"Rajdhani", sans-serif',
                      fontSize: '14px',
                      fontWeight: '600',
                      marginBottom: '8px'
                    },
                    
                    // Buttons
                    formButtonPrimary: {
                      background: 'linear-gradient(45deg, rgba(0, 255, 255, 0.3), rgba(255, 0, 255, 0.3))',
                      border: '2px solid rgba(0, 255, 255, 0.5)',
                      borderRadius: '25px',
                      color: '#00ffff',
                      fontSize: '14px',
                      fontWeight: '600',
                      fontFamily: '"Orbitron", monospace',
                      padding: '12px 24px',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        background: 'linear-gradient(45deg, rgba(0, 255, 255, 0.5), rgba(255, 0, 255, 0.5))',
                        boxShadow: '0 0 20px rgba(0, 255, 255, 0.5)',
                        transform: 'translateY(-2px)'
                      }
                    },
                    formButtonSecondary: {
                      background: 'rgba(136, 136, 136, 0.2)',
                      border: '1px solid rgba(136, 136, 136, 0.4)',
                      borderRadius: '15px',
                      color: '#888',
                      fontSize: '14px',
                      fontFamily: '"Rajdhani", sans-serif',
                      padding: '10px 20px',
                      '&:hover': {
                        background: 'rgba(136, 136, 136, 0.3)',
                        color: '#aaa'
                      }
                    },
                    
                    // Profile sections
                    profileSection: {
                      background: 'rgba(0, 255, 255, 0.05)',
                      border: '1px solid rgba(0, 255, 255, 0.2)',
                      borderRadius: '15px',
                      padding: '20px',
                      margin: '15px 0'
                    },
                    profileSectionTitle: {
                      color: '#00ffff',
                      fontFamily: '"Orbitron", monospace',
                      fontSize: '18px',
                      fontWeight: '700',
                      borderBottom: '1px solid rgba(0, 255, 255, 0.3)',
                      paddingBottom: '10px',
                      marginBottom: '15px'
                    },
                    profileSectionContent: {
                      color: '#00ffff',
                      fontFamily: '"Rajdhani", sans-serif'
                    },
                    
                    // Avatar and images
                    avatarBox: {
                      border: '3px solid rgba(0, 255, 255, 0.4)',
                      borderRadius: '50%',
                      boxShadow: '0 0 20px rgba(0, 255, 255, 0.3)'
                    },
                    
                    // Lists and tables
                    table: {
                      background: 'rgba(0, 255, 255, 0.05)',
                      border: '1px solid rgba(0, 255, 255, 0.2)',
                      borderRadius: '10px'
                    },
                    tableHead: {
                      background: 'rgba(0, 255, 255, 0.1)',
                      color: '#00ffff',
                      fontFamily: '"Orbitron", monospace'
                    },
                    tableBody: {
                      color: '#00ffff',
                      fontFamily: '"Rajdhani", sans-serif'
                    },
                    
                    // Text elements
                    text: {
                      color: '#00ffff',
                      fontFamily: '"Rajdhani", sans-serif'
                    },
                    link: {
                      color: '#00ffff',
                      textDecoration: 'none',
                      '&:hover': {
                        color: '#00ffaa',
                        textShadow: '0 0 8px rgba(0, 255, 170, 0.5)'
                      }
                    },
                    
                    // Alert and feedback
                    alertText: {
                      color: '#ff4444',
                      fontSize: '13px',
                      fontFamily: '"Rajdhani", sans-serif'
                    },
                    formFieldSuccessText: {
                      color: '#00ffaa'
                    },
                    formFieldErrorText: {
                      color: '#ff4444'
                    },
                    
                    // Breadcrumbs and navigation
                    breadcrumbs: {
                      color: '#888',
                      fontFamily: '"Rajdhani", sans-serif'
                    },
                    breadcrumbsLink: {
                      color: '#00ffff',
                      '&:hover': {
                        color: '#00ffaa'
                      }
                    }
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