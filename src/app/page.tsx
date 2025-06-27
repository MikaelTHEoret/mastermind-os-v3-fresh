import EnhancedMastermindOS from '@/components/EnhancedMastermindOS'

export const metadata = {
  title: 'MASTERMIND OS v3 - Enhanced AI Agent Orchestration Platform',
  description: 'Advanced AI Agent Orchestration Platform with Sovereign Scroll integration, Astra DB memory core, and distributed computing capabilities with beautiful cyberpunk aesthetic',
}

// Force dynamic rendering - this is key for production
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function Home() {
  return <EnhancedMastermindOS />
}
