import './globals.css'
import { ClerkProvider } from '@clerk/nextjs'
import { WalletProvider } from '@/context/WalletContext'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'

export const metadata = {
  title: 'MasterMind OS v3.0 - Enhanced Nexus Core Protocol',
  description: 'Advanced AI Agent Orchestration Platform with consciousness-enhanced development',
}

// Force the entire app to be dynamic
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider
      appearance={{
        layout: {
          socialButtonsVariant: 'iconButton',
          socialButtonsPlacement: 'bottom'
        },
        variables: {
          colorPrimary: '#00ffff',
          colorDanger: '#ff4444', 
          colorSuccess: '#00ffaa',
          colorWarning: '#ffd700',
          colorNeutral: '#888888',
          colorBackground: '#0a051e',
          colorInputBackground: 'rgba(0, 255, 255, 0.1)',
          colorInputText: '#00ffff',
          colorText: '#00ffff',
          colorTextSecondary: 'rgba(0, 255, 255, 0.7)',
          borderRadius: '15px',
          fontFamily: '"Rajdhani", sans-serif',
          fontFamilyButtons: '"Orbitron", monospace'
        },
        elements: {
          // Global card styling for all modals
          card: {
            background: 'linear-gradient(145deg, rgba(10, 5, 30, 0.98) 0%, rgba(20, 10, 40, 0.98) 100%) !important',
            border: '2px solid rgba(0, 255, 255, 0.4) !important',
            borderRadius: '20px !important',
            backdropFilter: 'blur(20px) !important',
            boxShadow: '0 0 50px rgba(0, 255, 255, 0.3) !important'
          },
          // Modal background overlay
          modalBackdrop: {
            backgroundColor: 'rgba(0, 0, 0, 0.8) !important'
          },
          // Main modal content
          modalContent: {
            background: 'linear-gradient(145deg, rgba(10, 5, 30, 0.98) 0%, rgba(20, 10, 40, 0.98) 100%) !important',
            border: '2px solid rgba(0, 255, 255, 0.4) !important',
            borderRadius: '20px !important',
            backdropFilter: 'blur(20px) !important',
            boxShadow: '0 0 50px rgba(0, 255, 255, 0.3) !important'
          },
          // Header styling
          headerTitle: {
            color: '#00ffff !important',
            fontFamily: '"Orbitron", monospace !important'
          },
          headerSubtitle: {
            color: 'rgba(0, 255, 255, 0.7) !important'
          },
          // Form elements
          formButtonPrimary: {
            background: 'linear-gradient(45deg, rgba(0, 255, 255, 0.3), rgba(255, 0, 255, 0.3)) !important',
            border: '2px solid rgba(0, 255, 255, 0.5) !important',
            borderRadius: '25px !important',
            color: '#00ffff !important',
            fontFamily: '"Orbitron", monospace !important',
            textTransform: 'uppercase !important',
            '&:hover': {
              background: 'linear-gradient(45deg, rgba(0, 255, 255, 0.5), rgba(255, 0, 255, 0.5)) !important',
              boxShadow: '0 0 20px rgba(0, 255, 255, 0.5) !important'
            }
          },
          formFieldInput: {
            background: 'rgba(0, 255, 255, 0.1) !important',
            border: '1px solid rgba(0, 255, 255, 0.3) !important',
            borderRadius: '12px !important',
            color: '#00ffff !important',
            '&:focus': {
              borderColor: 'rgba(0, 255, 255, 0.6) !important',
              boxShadow: '0 0 12px rgba(0, 255, 255, 0.3) !important'
            }
          },
          formFieldLabel: {
            color: '#00ffff !important'
          },
          // Text elements
          text: {
            color: '#00ffff !important'
          },
          // Social buttons
          socialButtonsBlockButton: {
            background: 'rgba(0, 255, 255, 0.1) !important',
            border: '1px solid rgba(0, 255, 255, 0.3) !important',
            color: '#00ffff !important'
          },
          // Footer
          footer: {
            background: 'transparent !important'
          },
          footerActionText: {
            color: 'rgba(0, 255, 255, 0.7) !important'
          },
          footerActionLink: {
            color: '#00ffff !important'
          },
          // Internal card (profile page)
          userProfile: {
            background: 'linear-gradient(145deg, rgba(10, 5, 30, 0.98) 0%, rgba(20, 10, 40, 0.98) 100%) !important'
          }
        }
      }}
    >
      <html lang="en">
        <body>
          <WalletProvider>
            {children}
          </WalletProvider>
          {/* Silent analytics tracking - no UI */}
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  )
}
