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
          colorPrimary: '#00ffff',
          colorDanger: '#ff4444', 
          colorSuccess: '#00ffaa',
          colorWarning: '#ffd700',
          colorNeutral: '#888888',
          borderRadius: '15px',
          fontFamily: '"Rajdhani", sans-serif',
          fontFamilyButtons: '"Orbitron", monospace'
        },
        elements: {
          modalContent: {
            background: 'linear-gradient(145deg, rgba(10, 5, 30, 0.98) 0%, rgba(20, 10, 40, 0.98) 100%)',
            border: '2px solid rgba(0, 255, 255, 0.4)',
            borderRadius: '20px',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 0 50px rgba(0, 255, 255, 0.3)'
          },
          formButtonPrimary: {
            background: 'linear-gradient(45deg, rgba(0, 255, 255, 0.3), rgba(255, 0, 255, 0.3))',
            border: '2px solid rgba(0, 255, 255, 0.5)',
            borderRadius: '25px',
            color: '#00ffff',
            fontFamily: '"Orbitron", monospace',
            textTransform: 'uppercase',
            '&:hover': {
              background: 'linear-gradient(45deg, rgba(0, 255, 255, 0.5), rgba(255, 0, 255, 0.5))',
              boxShadow: '0 0 20px rgba(0, 255, 255, 0.5)'
            }
          },
          formFieldInput: {
            background: 'rgba(0, 255, 255, 0.1)',
            border: '1px solid rgba(0, 255, 255, 0.3)',
            borderRadius: '12px',
            color: '#00ffff',
            '&:focus': {
              borderColor: 'rgba(0, 255, 255, 0.6)',
              boxShadow: '0 0 12px rgba(0, 255, 255, 0.3)'
            }
          },
          headerTitle: {
            color: '#00ffff',
            fontFamily: '"Orbitron", monospace'
          },
          text: {
            color: '#00ffff'
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