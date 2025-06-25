"use client"

import { useState, useEffect } from 'react'

interface AgentInstance {
  id: string
  name: string
  type: 'executor' | 'coordinator' | 'specialist' | 'monitor'
  status: 'active' | 'idle' | 'scaling' | 'terminating' | 'starting'
  cpu: number
  memory: number
  load: number
  tasksInQueue: number
  tasksCompleted: number
  efficiency: number
  uptime: string
  model: string
  region: string
  cost_per_hour: number
  auto_scale: boolean
}

interface ScalingPolicy {
  id: string
  name: string
  type: 'cpu_based' | 'queue_based' | 'time_based' | 'predictive'
  enabled: boolean
  trigger_threshold: number
  scale_up_instances: number
  scale_down_threshold: number
  cooldown_minutes: number
  max_instances: number
  min_instances: number
}

interface ScalingEvent {
  id: string
  timestamp: string
  type: 'scale_up' | 'scale_down' | 'replace' | 'rebalance'
  trigger: string
  instances_changed: number
  reason: string
  success: boolean
}

export default function AutonomousAgentScaling() {
  const [agents, setAgents] = useState<AgentInstance[]>([])
  const [scalingPolicies, setScalingPolicies] = useState<ScalingPolicy[]>([])
  const [scalingEvents, setScalingEvents] = useState<ScalingEvent[]>([])
  const [activeTab, setActiveTab] = useState<'agents' | 'policies' | 'events' | 'predictions'>('agents')
  const [autoScalingEnabled, setAutoScalingEnabled] = useState(true)

  // Initialize data
  useEffect(() => {
    const initializeData = () => {
      const initialAgents: AgentInstance[] = [
        {
          id: 'agent_exec_001',
          name: 'TaskExecutor-Alpha',
          type: 'executor',
          status: 'active',
          cpu: 76,
          memory: 84,
          load: 89,
          tasksInQueue: 23,
          tasksCompleted: 847,
          efficiency: 94.2,
          uptime: '72h 15m',
          model: 'GPT-4-Turbo',
          region: 'us-east-1',
          cost_per_hour: 4.23,
          auto_scale: true
        },
        {
          id: 'agent_coord_001',
          name: 'Coordinator-Beta',
          type: 'coordinator',
          status: 'active',
          cpu: 45,
          memory: 67,
          load: 67,
          tasksInQueue: 12,
          tasksCompleted: 423,
          efficiency: 88.7,
          uptime: '68h 42m',
          model: 'Claude-Sonnet',
          region: 'us-west-2',
          cost_per_hour: 3.14,
          auto_scale: true
        },
        {
          id: 'agent_spec_001',
          name: 'DataSpecialist-Gamma',
          type: 'specialist',
          status: 'scaling',
          cpu: 23,
          memory: 34,
          load: 45,
          tasksInQueue: 8,
          tasksCompleted: 234,
          efficiency: 92.1,
          uptime: '71h 03m',
          model: 'Mixtral-8x7B',
          region: 'eu-west-1',
          cost_per_hour: 2.87,
          auto_scale: true
        },
        {
          id: 'agent_mon_001',
          name: 'SystemMonitor-Delta',
          type: 'monitor',
          status: 'idle',
          cpu: 12,
          memory: 28,
          load: 15,
          tasksInQueue: 2,
          tasksCompleted: 156,
          efficiency: 79.4,
          uptime: '69h 28m',
          model: 'Llama2-70B',
          region: 'ap-southeast-1',
          cost_per_hour: 1.95,
          auto_scale: false
        }
      ]

      const initialPolicies: ScalingPolicy[] = [
        {
          id: 'policy_cpu',
          name: 'CPU-Based Auto Scaling',
          type: 'cpu_based',
          enabled: true,
          trigger_threshold: 80,
          scale_up_instances: 2,
          scale_down_threshold: 30,
          cooldown_minutes: 5,
          max_instances: 20,
          min_instances: 2
        },
        {
          id: 'policy_queue',
          name: 'Queue-Based Scaling',
          type: 'queue_based',
          enabled: true,
          trigger_threshold: 20,
          scale_up_instances: 1,
          scale_down_threshold: 5,
          cooldown_minutes: 3,
          max_instances: 15,
          min_instances: 1
        },
        {
          id: 'policy_predictive',
          name: 'AI Predictive Scaling',
          type: 'predictive',
          enabled: true,
          trigger_threshold: 85,
          scale_up_instances: 3,
          scale_down_threshold: 40,
          cooldown_minutes: 10,
          max_instances: 50,
          min_instances: 5
        }
      ]

      const initialEvents: ScalingEvent[] = [
        {
          id: 'event_001',
          timestamp: new Date(Date.now() - 300000).toISOString(),
          type: 'scale_up',
          trigger: 'CPU threshold exceeded (85%)',
          instances_changed: 2,
          reason: 'High CPU usage detected across executor agents',
          success: true
        },
        {
          id: 'event_002',
          timestamp: new Date(Date.now() - 1200000).toISOString(),
          type: 'rebalance',
          trigger: 'Regional load imbalance',
          instances_changed: 0,
          reason: 'Redistributed tasks from us-east-1 to us-west-2',
          success: true
        },
        {
          id: 'event_003',
          timestamp: new Date(Date.now() - 2400000).toISOString(),
          type: 'scale_down',
          trigger: 'Low queue depth (< 5 tasks)',
          instances_changed: -1,
          reason: 'Terminated idle agent in ap-southeast-1',
          success: true
        }
      ]

      setAgents(initialAgents)
      setScalingPolicies(initialPolicies)
      setScalingEvents(initialEvents)
    }

    initializeData()
  }, [])

  // Simulate real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      setAgents(prev => prev.map(agent => ({
        ...agent,
        cpu: Math.max(10, Math.min(95, agent.cpu + (Math.random() - 0.5) * 15)),
        memory: Math.max(20, Math.min(90, agent.memory + (Math.random() - 0.5) * 10)),
        load: Math.max(5, Math.min(100, agent.load + (Math.random() - 0.5) * 20)),
        tasksInQueue: Math.max(0, agent.tasksInQueue + Math.floor((Math.random() - 0.5) * 6)),
        tasksCompleted: agent.tasksCompleted + Math.floor(Math.random() * 3),
        efficiency: Math.max(70, Math.min(98, agent.efficiency + (Math.random() - 0.5) * 5))
      })))
    }, 3000)

    return () => clearInterval(interval)
  }, [])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '#00ffaa'
      case 'idle': return '#ffaa00'
      case 'scaling': return '#00d4ff'
      case 'terminating': return '#ff4444'
      case 'starting': return '#ff00ff'
      default: return '#888'
    }
  }

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'executor': return '#00ffaa'
      case 'coordinator': return '#00d4ff'
      case 'specialist': return '#ff00ff'
      case 'monitor': return '#ffd700'
      default: return '#888'
    }
  }

  const triggerManualScale = (action: 'up' | 'down') => {
    const newEvent: ScalingEvent = {
      id: `event_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: action === 'up' ? 'scale_up' : 'scale_down',
      trigger: 'Manual intervention',
      instances_changed: action === 'up' ? 1 : -1,
      reason: `Manual ${action === 'up' ? 'scale up' : 'scale down'} triggered by user`,
      success: true
    }

    setScalingEvents(prev => [newEvent, ...prev.slice(0, 9)])

    if (action === 'up') {
      const newAgent: AgentInstance = {
        id: `agent_manual_${Date.now()}`,
        name: `ManualAgent-${Date.now().toString().slice(-4)}`,
        type: 'executor',
        status: 'starting',
        cpu: 15,
        memory: 25,
        load: 10,
        tasksInQueue: 0,
        tasksCompleted: 0,
        efficiency: 85,
        uptime: '0m',
        model: 'GPT-4-Turbo',
        region: 'us-east-1',
        cost_per_hour: 4.23,
        auto_scale: true
      }
      setAgents(prev => [...prev, newAgent])
    }
  }

  return (
    <div style={{
      padding: '30px',
      background: 'linear-gradient(145deg, rgba(0, 50, 25, 0.95) 0%, rgba(0, 25, 50, 0.9) 100%)',
      color: '#e6e6fa',
      height: '100%',
      overflowY: 'auto'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '30px',
        paddingBottom: '20px',
        borderBottom: '2px solid rgba(0, 255, 170, 0.3)'
      }}>
        <h1 style={{
          fontFamily: 'Orbitron, monospace',
          fontSize: '28px',
          fontWeight: '900',
          background: 'linear-gradient(45deg, #00ffaa, #00d4ff, #ff00ff)',
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          margin: 0
        }}>
          🤖 AUTONOMOUS AGENT SCALING
        </h1>

        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 15px',
            background: autoScalingEnabled ? 'rgba(0, 255, 170, 0.2)' : 'rgba(255, 68, 68, 0.2)',
            border: `1px solid ${autoScalingEnabled ? 'rgba(0, 255, 170, 0.5)' : 'rgba(255, 68, 68, 0.5)'}`,
            borderRadius: '8px',
            color: autoScalingEnabled ? '#00ffaa' : '#ff4444',
            fontSize: '12px',
            fontWeight: '600'
          }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: autoScalingEnabled ? '#00ffaa' : '#ff4444',
              boxShadow: `0 0 10px ${autoScalingEnabled ? '#00ffaa' : '#ff4444'}`,
              animation: autoScalingEnabled ? 'pulse 2s ease-in-out infinite' : 'none'
            }} />
            AUTO-SCALING {autoScalingEnabled ? 'ENABLED' : 'DISABLED'}
          </div>

          <button
            onClick={() => setAutoScalingEnabled(!autoScalingEnabled)}
            style={{
              padding: '8px 15px',
              background: 'rgba(0, 255, 170, 0.2)',
              border: '1px solid rgba(0, 255, 170, 0.5)',
              borderRadius: '8px',
              color: '#00ffaa',
              fontSize: '12px',
              cursor: 'pointer',
              fontFamily: 'Orbitron, monospace'
            }}
          >
            TOGGLE
          </button>
        </div>
      </div>

      {/* Control Panel */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '20px',
        marginBottom: '30px'
      }}>
        <div style={{
          background: 'rgba(0, 0, 0, 0.6)',
          border: '1px solid rgba(0, 255, 170, 0.3)',
          borderRadius: '10px',
          padding: '20px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '24px', color: '#00ffaa', fontWeight: 'bold', marginBottom: '5px' }}>
            {agents.length}
          </div>
          <div style={{ fontSize: '12px', color: '#888' }}>
            Active Agents
          </div>
        </div>

        <div style={{
          background: 'rgba(0, 0, 0, 0.6)',
          border: '1px solid rgba(0, 212, 255, 0.3)',
          borderRadius: '10px',
          padding: '20px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '24px', color: '#00d4ff', fontWeight: 'bold', marginBottom: '5px' }}>
            {agents.filter(a => a.status === 'scaling').length}
          </div>
          <div style={{ fontSize: '12px', color: '#888' }}>
            Scaling Operations
          </div>
        </div>

        <div style={{
          background: 'rgba(0, 0, 0, 0.6)',
          border: '1px solid rgba(255, 215, 0, 0.3)',
          borderRadius: '10px',
          padding: '20px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '24px', color: '#ffd700', fontWeight: 'bold', marginBottom: '5px' }}>
            ${agents.reduce((sum, a) => sum + a.cost_per_hour, 0).toFixed(2)}
          </div>
          <div style={{ fontSize: '12px', color: '#888' }}>
            Cost per Hour
          </div>
        </div>

        <div style={{
          background: 'rgba(0, 0, 0, 0.6)',
          border: '1px solid rgba(255, 0, 255, 0.3)',
          borderRadius: '10px',
          padding: '20px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '24px', color: '#ff00ff', fontWeight: 'bold', marginBottom: '5px' }}>
            {Math.round(agents.reduce((sum, a) => sum + a.efficiency, 0) / agents.length)}%
          </div>
          <div style={{ fontSize: '12px', color: '#888' }}>
            Avg Efficiency
          </div>
        </div>
      </div>

      {/* Manual Scaling Controls */}
      <div style={{
        display: 'flex',
        gap: '15px',
        marginBottom: '30px',
        justifyContent: 'center'
      }}>
        <button
          onClick={() => triggerManualScale('up')}
          style={{
            padding: '12px 25px',
            background: 'linear-gradient(45deg, rgba(0, 255, 170, 0.3), rgba(0, 212, 255, 0.3))',
            border: '1px solid rgba(0, 255, 170, 0.5)',
            borderRadius: '8px',
            color: '#00ffaa',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            fontFamily: 'Orbitron, monospace',
            transition: 'all 0.3s ease'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'linear-gradient(45deg, rgba(0, 255, 170, 0.5), rgba(0, 212, 255, 0.5))'
            e.currentTarget.style.transform = 'translateY(-2px)'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'linear-gradient(45deg, rgba(0, 255, 170, 0.3), rgba(0, 212, 255, 0.3))'
            e.currentTarget.style.transform = 'translateY(0)'
          }}
        >
          ⬆️ SCALE UP
        </button>

        <button
          onClick={() => triggerManualScale('down')}
          style={{
            padding: '12px 25px',
            background: 'linear-gradient(45deg, rgba(255, 165, 0, 0.3), rgba(255, 68, 68, 0.3))',
            border: '1px solid rgba(255, 165, 0, 0.5)',
            borderRadius: '8px',
            color: '#ffaa00',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            fontFamily: 'Orbitron, monospace',
            transition: 'all 0.3s ease'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'linear-gradient(45deg, rgba(255, 165, 0, 0.5), rgba(255, 68, 68, 0.5))'
            e.currentTarget.style.transform = 'translateY(-2px)'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'linear-gradient(45deg, rgba(255, 165, 0, 0.3), rgba(255, 68, 68, 0.3))'
            e.currentTarget.style.transform = 'translateY(0)'
          }}
        >
          ⬇️ SCALE DOWN
        </button>
      </div>

      {/* Tab Navigation */}
      <div style={{
        display: 'flex',
        gap: '10px',
        marginBottom: '25px'
      }}>
        {[
          { id: 'agents', label: '🤖 Agents', color: '#00ffaa' },
          { id: 'policies', label: '📋 Policies', color: '#00d4ff' },
          { id: 'events', label: '📊 Events', color: '#ff00ff' },
          { id: 'predictions', label: '🔮 Predictions', color: '#ffd700' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              padding: '10px 20px',
              background: activeTab === tab.id 
                ? `rgba(${tab.color === '#00ffaa' ? '0, 255, 170' : tab.color === '#00d4ff' ? '0, 212, 255' : tab.color === '#ff00ff' ? '255, 0, 255' : '255, 215, 0'}, 0.3)` 
                : 'rgba(0, 0, 0, 0.6)',
              border: `1px solid ${activeTab === tab.id ? tab.color : '#666'}`,
              borderRadius: '8px',
              color: activeTab === tab.id ? tab.color : '#888',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              fontFamily: 'Orbitron, monospace'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'agents' && (
        <div style={{
          background: 'rgba(0, 0, 0, 0.4)',
          border: '2px solid rgba(0, 255, 170, 0.3)',
          borderRadius: '15px',
          padding: '25px'
        }}>
          <h3 style={{
            color: '#00ffaa',
            fontFamily: 'Orbitron, monospace',
            fontSize: '18px',
            marginBottom: '20px'
          }}>
            🤖 AGENT INSTANCES
          </h3>

          <div style={{ display: 'grid', gap: '15px' }}>
            {agents.map((agent) => (
              <div key={agent.id} style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr',
                gap: '15px',
                padding: '20px',
                background: 'rgba(0, 0, 0, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '10px',
                alignItems: 'center',
                fontSize: '12px'
              }}>
                <div>
                  <div style={{ 
                    fontWeight: 'bold',
                    color: '#e6e6fa',
                    marginBottom: '5px'
                  }}>
                    {agent.name}
                  </div>
                  <div style={{
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'center'
                  }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '8px',
                      fontSize: '10px',
                      fontWeight: '600',
                      background: `${getTypeColor(agent.type)}30`,
                      color: getTypeColor(agent.type),
                      border: `1px solid ${getTypeColor(agent.type)}50`
                    }}>
                      {agent.type.toUpperCase()}
                    </span>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '8px',
                      fontSize: '10px',
                      fontWeight: '600',
                      background: `${getStatusColor(agent.status)}30`,
                      color: getStatusColor(agent.status),
                      border: `1px solid ${getStatusColor(agent.status)}50`
                    }}>
                      {agent.status.toUpperCase()}
                    </span>
                  </div>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: agent.cpu > 80 ? '#ff4444' : '#00ffaa', fontWeight: 'bold' }}>
                    {agent.cpu.toFixed(0)}%
                  </div>
                  <div style={{ color: '#888', fontSize: '10px' }}>CPU</div>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: agent.memory > 80 ? '#ff4444' : '#00d4ff', fontWeight: 'bold' }}>
                    {agent.memory.toFixed(0)}%
                  </div>
                  <div style={{ color: '#888', fontSize: '10px' }}>Memory</div>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: agent.load > 80 ? '#ff4444' : '#ffaa00', fontWeight: 'bold' }}>
                    {agent.load.toFixed(0)}%
                  </div>
                  <div style={{ color: '#888', fontSize: '10px' }}>Load</div>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#ff00ff', fontWeight: 'bold' }}>
                    {agent.tasksInQueue}
                  </div>
                  <div style={{ color: '#888', fontSize: '10px' }}>Queue</div>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#00ffff', fontWeight: 'bold' }}>
                    {agent.efficiency.toFixed(1)}%
                  </div>
                  <div style={{ color: '#888', fontSize: '10px' }}>Efficiency</div>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#ffd700', fontWeight: 'bold' }}>
                    ${agent.cost_per_hour.toFixed(2)}
                  </div>
                  <div style={{ color: '#888', fontSize: '10px' }}>Cost/h</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'policies' && (
        <div style={{
          background: 'rgba(0, 0, 0, 0.4)',
          border: '2px solid rgba(0, 212, 255, 0.3)',
          borderRadius: '15px',
          padding: '25px'
        }}>
          <h3 style={{
            color: '#00d4ff',
            fontFamily: 'Orbitron, monospace',
            fontSize: '18px',
            marginBottom: '20px'
          }}>
            📋 SCALING POLICIES
          </h3>

          <div style={{ display: 'grid', gap: '15px' }}>
            {scalingPolicies.map((policy) => (
              <div key={policy.id} style={{
                padding: '20px',
                background: 'rgba(0, 0, 0, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '10px'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '15px'
                }}>
                  <div style={{
                    fontWeight: 'bold',
                    color: '#e6e6fa',
                    fontSize: '14px'
                  }}>
                    {policy.name}
                  </div>
                  <div style={{
                    padding: '4px 12px',
                    borderRadius: '8px',
                    fontSize: '11px',
                    fontWeight: '600',
                    background: policy.enabled ? 'rgba(0, 255, 170, 0.3)' : 'rgba(255, 68, 68, 0.3)',
                    color: policy.enabled ? '#00ffaa' : '#ff4444',
                    border: `1px solid ${policy.enabled ? '#00ffaa50' : '#ff444450'}`
                  }}>
                    {policy.enabled ? 'ENABLED' : 'DISABLED'}
                  </div>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: '10px',
                  fontSize: '11px',
                  color: '#888'
                }}>
                  <div>
                    <span>Trigger: </span>
                    <span style={{ color: '#00d4ff' }}>{policy.trigger_threshold}%</span>
                  </div>
                  <div>
                    <span>Scale Up: </span>
                    <span style={{ color: '#00ffaa' }}>+{policy.scale_up_instances}</span>
                  </div>
                  <div>
                    <span>Scale Down: </span>
                    <span style={{ color: '#ffaa00' }}>{policy.scale_down_threshold}%</span>
                  </div>
                  <div>
                    <span>Cooldown: </span>
                    <span style={{ color: '#ff00ff' }}>{policy.cooldown_minutes}min</span>
                  </div>
                  <div>
                    <span>Range: </span>
                    <span style={{ color: '#ffd700' }}>{policy.min_instances}-{policy.max_instances}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'events' && (
        <div style={{
          background: 'rgba(0, 0, 0, 0.4)',
          border: '2px solid rgba(255, 0, 255, 0.3)',
          borderRadius: '15px',
          padding: '25px'
        }}>
          <h3 style={{
            color: '#ff00ff',
            fontFamily: 'Orbitron, monospace',
            fontSize: '18px',
            marginBottom: '20px'
          }}>
            📊 SCALING EVENTS
          </h3>

          <div style={{ display: 'grid', gap: '12px' }}>
            {scalingEvents.map((event) => (
              <div key={event.id} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '15px',
                background: 'rgba(0, 0, 0, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                fontSize: '12px'
              }}>
                <div>
                  <div style={{ color: '#e6e6fa', fontWeight: 'bold', marginBottom: '5px' }}>
                    {event.trigger}
                  </div>
                  <div style={{ color: '#888' }}>
                    {event.reason}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    padding: '4px 8px',
                    borderRadius: '8px',
                    fontSize: '10px',
                    fontWeight: '600',
                    background: event.success ? 'rgba(0, 255, 170, 0.3)' : 'rgba(255, 68, 68, 0.3)',
                    color: event.success ? '#00ffaa' : '#ff4444',
                    marginBottom: '5px'
                  }}>
                    {event.type.toUpperCase()} ({event.instances_changed > 0 ? '+' : ''}{event.instances_changed})
                  </div>
                  <div style={{ color: '#666', fontSize: '10px' }}>
                    {new Date(event.timestamp).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'predictions' && (
        <div style={{
          background: 'rgba(0, 0, 0, 0.4)',
          border: '2px solid rgba(255, 215, 0, 0.3)',
          borderRadius: '15px',
          padding: '25px'
        }}>
          <h3 style={{
            color: '#ffd700',
            fontFamily: 'Orbitron, monospace',
            fontSize: '18px',
            marginBottom: '20px'
          }}>
            🔮 PREDICTIVE ANALYSIS
          </h3>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '20px'
          }}>
            <div style={{
              background: 'rgba(0, 0, 0, 0.6)',
              borderRadius: '10px',
              padding: '20px'
            }}>
              <h4 style={{ color: '#ffd700', marginBottom: '15px', fontSize: '14px' }}>
                📈 LOAD PREDICTION (Next 4 Hours)
              </h4>
              <div style={{ fontSize: '12px', lineHeight: '1.8' }}>
                <div style={{ marginBottom: '10px' }}>
                  <span style={{ color: '#888' }}>Current Load:</span>
                  <span style={{ color: '#ffaa00', marginLeft: '10px', fontWeight: 'bold' }}>
                    {Math.round(agents.reduce((sum, a) => sum + a.load, 0) / agents.length)}%
                  </span>
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <span style={{ color: '#888' }}>Predicted Peak:</span>
                  <span style={{ color: '#ff4444', marginLeft: '10px', fontWeight: 'bold' }}>89%</span>
                  <span style={{ color: '#666', marginLeft: '5px' }}>(in 2.3h)</span>
                </div>
                <div style={{ marginBottom: '15px' }}>
                  <span style={{ color: '#888' }}>Recommended Action:</span>
                  <span style={{ color: '#00ffaa', marginLeft: '10px', fontWeight: 'bold' }}>Scale +3 agents</span>
                </div>
                <div style={{ 
                  padding: '10px',
                  background: 'rgba(255, 215, 0, 0.2)',
                  borderRadius: '8px',
                  color: '#ffd700',
                  fontSize: '11px'
                }}>
                  🤖 AI Analysis: Traffic pattern suggests surge from EU region. Pre-scale recommended.
                </div>
              </div>
            </div>

            <div style={{
              background: 'rgba(0, 0, 0, 0.6)',
              borderRadius: '10px',
              padding: '20px'
            }}>
              <h4 style={{ color: '#00d4ff', marginBottom: '15px', fontSize: '14px' }}>
                💰 COST OPTIMIZATION
              </h4>
              <div style={{ fontSize: '12px', lineHeight: '1.8' }}>
                <div style={{ marginBottom: '10px' }}>
                  <span style={{ color: '#888' }}>Current Cost:</span>
                  <span style={{ color: '#ffd700', marginLeft: '10px', fontWeight: 'bold' }}>
                    ${agents.reduce((sum, a) => sum + a.cost_per_hour, 0).toFixed(2)}/h
                  </span>
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <span style={{ color: '#888' }}>Optimized Cost:</span>
                  <span style={{ color: '#00ffaa', marginLeft: '10px', fontWeight: 'bold' }}>
                    ${(agents.reduce((sum, a) => sum + a.cost_per_hour, 0) * 0.85).toFixed(2)}/h
                  </span>
                </div>
                <div style={{ marginBottom: '15px' }}>
                  <span style={{ color: '#888' }}>Potential Savings:</span>
                  <span style={{ color: '#00ffaa', marginLeft: '10px', fontWeight: 'bold' }}>15%</span>
                  <span style={{ color: '#666', marginLeft: '5px' }}>($127/day)</span>
                </div>
                <div style={{ 
                  padding: '10px',
                  background: 'rgba(0, 212, 255, 0.2)',
                  borderRadius: '8px',
                  color: '#00d4ff',
                  fontSize: '11px'
                }}>
                  💡 Suggestion: Migrate 2 agents from us-east-1 to ap-southeast-1 for cost reduction
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.2); }
        }
      `}</style>
    </div>
  )
}