import './globals.css'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { ClerkProvider } from '@clerk/nextjs'
import { clerkAppearance } from '@/lib/clerk-config'

export const metadata = {
  title: 'Mastermind Core',
  description: 'A living, navigable knowledge base over an evolving research archive — concepts, resonant links, and the work behind them.',
}

// Clerk is CONDITIONAL: without a publishable key (current state) the provider is
// skipped entirely and the site behaves exactly as before. With keys set, sessions
// exist and the owner gate (src/lib/trading/auth.ts) can verify the owner.
const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const body = (
    <body>
      {children}
      <Analytics />
      <SpeedInsights />
    </body>
  )
  return (
    <html lang="en">
      {clerkEnabled ? <ClerkProvider appearance={clerkAppearance as any}>{body}</ClerkProvider> : body}
    </html>
  )
}
