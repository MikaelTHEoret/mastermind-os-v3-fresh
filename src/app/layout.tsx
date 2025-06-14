import './globals.css'
import StackAuthProvider from '../components/auth/StackAuthProvider'

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
    <html lang="en">
      <body>
        <StackAuthProvider>
          {children}
        </StackAuthProvider>
      </body>
    </html>
  )
}