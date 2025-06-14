import './globals.css'
import { ClerkProvider } from '@clerk/nextjs'

export const metadata = {
  title: 'MasterMind OS v3.0 - Enhanced Nexus Core Protocol',
  description: 'Advanced AI Agent Orchestration Platform with consciousness-enhanced development',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          // Core colors - Cyberpunk theme
          colorPrimary: '#00ffff',
          colorDanger: '#ff4444', 
          colorSuccess: '#00ffaa',
          colorWarning: '#ffd700',
          colorNeutral: '#888888',
          colorText: '#00ffff',
          colorTextOnPrimaryBackground: '#000000',
          colorTextSecondary: '#888888',
          
          // Background colors - Dark cyberpunk
          colorBackground: '#0a051e',
          colorInputBackground: 'rgba(0, 255, 255, 0.1)',
          colorInputText: '#00ffff',
          
          // Border and effects
          borderRadius: '15px',
          spacingUnit: '1rem',
          
          // Typography - Cyberpunk fonts
          fontFamily: '"Rajdhani", sans-serif',
          fontFamilyButtons: '"Orbitron", monospace',
          fontSize: '14px',
          fontWeight: {
            normal: 400,
            medium: 600,
            bold: 700,
          }
        },
        elements: {
          // Root container
          rootBox: {
            backgroundColor: 'transparent'
          },
          
          // Card containers
          card: {
            background: 'linear-gradient(145deg, rgba(10, 5, 30, 0.98) 0%, rgba(20, 10, 40, 0.98) 100%)',
            border: '2px solid rgba(0, 255, 255, 0.4)',
            borderRadius: '20px',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 0 50px rgba(0, 255, 255, 0.3), inset 0 0 20px rgba(0, 255, 255, 0.1)',
            color: '#00ffff'
          },
          
          // Modal styling
          modalContent: {
            background: 'linear-gradient(145deg, rgba(10, 5, 30, 0.98) 0%, rgba(20, 10, 40, 0.98) 100%)',
            border: '2px solid rgba(0, 255, 255, 0.4)',
            borderRadius: '20px',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 0 50px rgba(0, 255, 255, 0.3), inset 0 0 20px rgba(0, 255, 255, 0.1)',
            color: '#00ffff'
          },
          modalCloseButton: {
            color: '#ff4444',
            background: 'rgba(255, 68, 68, 0.2)',
            border: '1px solid rgba(255, 68, 68, 0.3)',
            borderRadius: '50%',
            '&:hover': {
              background: 'rgba(255, 68, 68, 0.4)',
              boxShadow: '0 0 12px rgba(255, 68, 68, 0.5)'
            }
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
          
          // Form elements
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
            },
            '&:focus': {
              outline: 'none',
              boxShadow: '0 0 20px rgba(0, 255, 255, 0.7)'
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
          
          // Text elements
          text: {
            color: '#00ffff',
            fontFamily: '"Rajdhani", sans-serif'
          },
          
          // Links
          link: {
            color: '#00ffff',
            textDecoration: 'none',
            '&:hover': {
              color: '#00ffaa',
              textShadow: '0 0 8px rgba(0, 255, 170, 0.5)'
            }
          },
          
          // Footer
          footer: {
            background: 'rgba(0, 0, 0, 0.3)',
            borderTop: '1px solid rgba(0, 255, 255, 0.2)',
            color: '#888',
            padding: '15px'
          },
          footerActionText: {
            color: '#888'
          },
          footerActionLink: {
            color: '#00ffff',
            '&:hover': {
              color: '#00ffaa'
            }
          },
          
          // Dividers
          dividerLine: {
            background: 'rgba(0, 255, 255, 0.3)',
            height: '1px'
          },
          dividerText: {
            color: '#888',
            fontSize: '12px'
          },
          
          // Social buttons (OAuth)
          socialButtonsBlockButton: {
            background: 'rgba(0, 255, 255, 0.1)',
            border: '1px solid rgba(0, 255, 255, 0.3)',
            borderRadius: '12px',
            color: '#00ffff',
            fontFamily: '"Rajdhani", sans-serif',
            '&:hover': {
              background: 'rgba(0, 255, 255, 0.2)',
              boxShadow: '0 0 12px rgba(0, 255, 255, 0.4)'
            }
          },
          socialButtonsBlockButtonText: {
            color: '#00ffff',
            fontFamily: '"Rajdhani", sans-serif'
          },
          
          // Form field success/error
          formFieldSuccessText: {
            color: '#00ffaa'
          },
          formFieldErrorText: {
            color: '#ff4444'
          },
          formFieldWarningText: {
            color: '#ffd700'
          },
          
          // Alert messages
          alertText: {
            color: '#ff4444',
            fontSize: '13px',
            fontFamily: '"Rajdhani", sans-serif'
          },
          
          // Loading states
          spinner: {
            color: '#00ffff',
            width: '20px',
            height: '20px'
          },
          
          // Form validation
          formFieldInputShowPasswordButton: {
            color: '#888',
            '&:hover': {
              color: '#00ffff'
            }
          }
        }
      }}
    >
      <html lang="en">
        <body>
          {children}
        </body>
      </html>
    </ClerkProvider>
  )
}