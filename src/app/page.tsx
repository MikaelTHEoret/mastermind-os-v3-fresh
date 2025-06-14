import EnhancedMastermindOS from '../components/EnhancedMastermindOS'
import OptionalAuthWrapper from '../components/auth/OptionalAuthWrapper'

export const metadata = {
  title: 'MASTERMIND OS v3 - Enhanced AI Agent Orchestration Platform',
  description: 'Advanced AI Agent Orchestration Platform with Sovereign Scroll integration, Astra DB memory core, and distributed computing capabilities with beautiful cyberpunk aesthetic',
}

// Force dynamic rendering for Stack Auth
export const dynamic = 'force-dynamic'

export default function Home() {
  return (
    <OptionalAuthWrapper>
      <EnhancedMastermindOS />
    </OptionalAuthWrapper>
  )
}