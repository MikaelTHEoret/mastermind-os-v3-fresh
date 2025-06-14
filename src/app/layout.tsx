import './globals.css'
import { ClerkProvider } from '@clerk/nextjs'
import { clerkAppearance } from '@/lib/clerk-config'

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
    <ClerkProvider appearance={clerkAppearance}>
      <html lang="en">
        <body>
          {children}
        </body>
      </html>
    </ClerkProvider>
  )
}