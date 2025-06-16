'use client'
import { useState } from 'react'
import NexusCoreSection from './NexusCoreSection'

interface EnhancedNexusCoreSectionProps {
  children?: React.ReactNode
}

export default function EnhancedNexusCoreSection({ children }: EnhancedNexusCoreSectionProps) {
  const [coreEnergy, setCoreEnergy] = useState(84)
  const [connectionNodes, setConnectionNodes] = useState(8)
  const [activeAgents, setActiveAgents] = useState(6)

  // Simulate dynamic data changes
  const handleCoreBoost = () => {
    setCoreEnergy(Math.min(100, coreEnergy + Math.random() * 10))
  }

  const handleNodeSync = () => {
    setConnectionNodes(Math.floor(Math.random() * 12) + 4)
  }

  const handleAgentActivation = () => {
    setActiveAgents(Math.floor(Math.random() * 8) + 3)
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      {/* Enhanced Circuit Flow Section */}
      <NexusCoreSection 
        coreEnergy={coreEnergy}
        connectionNodes={connectionNodes}
        activeAgents={activeAgents}
      />
      
      {/* Optional: Add control panel for testing */}
      <div style={{
        position: 'fixed',
        top: 20,
        right: 20,
        background: 'rgba(0, 0, 0, 0.8)',
        border: '1px solid #00ffff',
        borderRadius: '8px',
        padding: '16px',
        color: '#00ffff',
        fontFamily: 'Orbitron, monospace',
        fontSize: '12px',
        zIndex: 100
      }}>
        <div>Core Energy: {Math.round(coreEnergy)}%</div>
        <div>Connection Nodes: {connectionNodes}</div>
        <div>Active Agents: {activeAgents}</div>
        
        <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexDirection: 'column' }}>
          <button onClick={handleCoreBoost} style={{
            background: 'transparent',
            border: '1px solid #00ffff',
            color: '#00ffff',
            padding: '4px 8px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '10px'
          }}>
            Boost Core
          </button>
          <button onClick={handleNodeSync} style={{
            background: 'transparent',
            border: '1px solid #ff00ff',
            color: '#ff00ff',
            padding: '4px 8px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '10px'
          }}>
            Sync Nodes
          </button>
          <button onClick={handleAgentActivation} style={{
            background: 'transparent',
            border: '1px solid #ffff00',
            color: '#ffff00',
            padding: '4px 8px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '10px'
          }}>
            Activate Agents
          </button>
        </div>
      </div>

      {children}
    </div>
  )
}