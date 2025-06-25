'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface AutoGPTAgent {
  id: string;
  name: string;
  description: string;
  objective: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  tools: string[];
  llm_provider: string;
  cost_budget: number;
  cost_used: number;
  created_at: Date;
  last_execution: Date | null;
  execution_count: number;
  success_rate: number;
}

interface AgentExecution {
  id: string;
  agent_id: string;
  start_time: Date;
  end_time: Date | null;
  status: 'running' | 'completed' | 'failed';
  steps_completed: number;
  total_steps: number;
  cost: number;
  results?: any;
  logs: string[];
}

interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  objective_template: string;
  recommended_tools: string[];
  estimated_cost: number;
  category: string;
}

export default function AgentManager() {
  const [activeTab, setActiveTab] = useState('agents');
  const [agents, setAgents] = useState<AutoGPTAgent[]>([]);
  const [executions, setExecutions] = useState<AgentExecution[]>([]);
  const [newAgent, setNewAgent] = useState({
    name: '',
    description: '',
    objective: '',
    tools: [] as string[],
    llm_provider: 'deepseek',
    cost_budget: 10.0
  });
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const AVAILABLE_TOOLS = [
    { id: 'serena', name: 'Serena Code Assistant', category: 'development', description: 'Advanced code analysis and generation', icon: '🔥' },
    { id: 'github', name: 'GitHub Integration', category: 'repository', description: 'Repository management and version control', icon: '📁' },
    { id: 'universal_llm', name: 'Universal LLM', category: 'reasoning', description: 'Multi-provider LLM access for complex reasoning', icon: '🤖' },
    { id: 'vercel', name: 'Vercel Deployment', category: 'deployment', description: 'Automated deployment and hosting', icon: '▲' },
    { id: 'memory_search', name: 'Memory Search', category: 'knowledge', description: 'Semantic search across memory collections', icon: '🧠' },
    { id: 'file_operations', name: 'File Operations', category: 'system', description: 'File system read/write operations', icon: '📄' },
    { id: 'web_browser', name: 'Web Browser', category: 'research', description: 'Web browsing and data collection', icon: '🌐' },
    { id: 'database_ops', name: 'Database Operations', category: 'data', description: 'Astra DB operations and queries', icon: '🗄️' },
    { id: 'api_calls', name: 'API Integration', category: 'integration', description: 'External API calls and integrations', icon: '🔌' },
    { id: 'image_generation', name: 'Image Generation', category: 'creative', description: 'AI image generation and editing', icon: '🎨' }
  ];

  const AGENT_TEMPLATES: AgentTemplate[] = [
    {
      id: 'dev_assistant',
      name: 'Development Assistant',
      description: 'Complete development workflow automation',
      objective_template: 'Develop and implement the [FEATURE_NAME] for the Mastermind OS project, including code generation, testing, and deployment',
      recommended_tools: ['serena', 'github', 'vercel', 'file_operations'],
      estimated_cost: 5.0,
      category: 'development'
    },
    {
      id: 'research_agent',
      name: 'Research & Analysis Agent',
      description: 'Comprehensive research and documentation',
      objective_template: 'Research [TOPIC] thoroughly, analyze findings, and create comprehensive documentation with actionable insights',
      recommended_tools: ['web_browser', 'memory_search', 'universal_llm', 'file_operations'],
      estimated_cost: 3.0,
      category: 'research'
    },
    {
      id: 'deployment_manager',
      name: 'Deployment Manager',
      description: 'Automated deployment and monitoring',
      objective_template: 'Deploy [PROJECT_NAME] to production, monitor health, and handle any deployment issues',
      recommended_tools: ['vercel', 'github', 'api_calls', 'memory_search'],
      estimated_cost: 2.0,
      category: 'deployment'
    },
    {
      id: 'content_creator',
      name: 'Content Creation Agent',
      description: 'Automated content and visual generation',
      objective_template: 'Create [CONTENT_TYPE] for [PURPOSE], including text, images, and multimedia content',
      recommended_tools: ['universal_llm', 'image_generation', 'file_operations', 'memory_search'],
      estimated_cost: 4.0,
      category: 'creative'
    },
    {
      id: 'data_analyst',
      name: 'Data Analysis Agent',
      description: 'Data processing and insight generation',
      objective_template: 'Analyze [DATA_SOURCE] to extract insights about [ANALYSIS_GOAL] and provide actionable recommendations',
      recommended_tools: ['database_ops', 'memory_search', 'universal_llm', 'file_operations'],
      estimated_cost: 3.5,
      category: 'analytics'
    }
  ];

  useEffect(() => {
    loadAgents();
    loadExecutions();
    
    // Poll for execution updates every 10 seconds
    const interval = setInterval(() => {
      loadExecutions();
    }, 10000);
    
    return () => clearInterval(interval);
  }, []);

  const loadAgents = async () => {
    try {
      // Simulate loading from API - replace with actual API call
      const mockAgents: AutoGPTAgent[] = [
        {
          id: '1',
          name: 'Mastermind Auth Developer',
          description: 'Automates authentication system development',
          objective: 'Complete the Clerk authentication integration for Mastermind OS with proper error handling and user flow',
          status: 'idle',
          tools: ['serena', 'github', 'vercel'],
          llm_provider: 'deepseek',
          cost_budget: 15.0,
          cost_used: 2.34,
          created_at: new Date('2024-12-10'),
          last_execution: new Date('2024-12-10T14:30:00'),
          execution_count: 3,
          success_rate: 0.85
        }
      ];
      setAgents(mockAgents);
    } catch (error) {
      console.error('Failed to load agents:', error);
    }
  };

  const loadExecutions = async () => {
    try {
      // Simulate loading from API - replace with actual API call
      const mockExecutions: AgentExecution[] = [
        {
          id: '1',
          agent_id: '1',
          start_time: new Date('2024-12-10T14:30:00'),
          end_time: new Date('2024-12-10T14:45:00'),
          status: 'completed',
          steps_completed: 8,
          total_steps: 8,
          cost: 1.23,
          logs: [
            '🚀 Agent deployment initiated...',
            '📋 Analyzing current authentication state...',
            '🔧 Generated improved error handling code',
            '📝 Updated user flow components',
            '🚀 Deployed changes to staging',
            '✅ Verified authentication functionality',
            '📊 Generated performance report',
            '🏁 Execution completed successfully'
          ]
        }
      ];
      setExecutions(mockExecutions);
    } catch (error) {
      console.error('Failed to load executions:', error);
    }
  };

  const createAgent = async () => {
    if (!newAgent.name || !newAgent.objective) return;

    setLoading(true);
    try {
      // Simulate API call - replace with actual implementation
      const agentData = {
        ...newAgent,
        id: Date.now().toString(),
        status: 'idle' as const,
        cost_used: 0,
        created_at: new Date(),
        last_execution: null,
        execution_count: 0,
        success_rate: 0
      };

      setAgents(prev => [...prev, agentData]);
      
      // Reset form
      setNewAgent({
        name: '',
        description: '',
        objective: '',
        tools: [],
        llm_provider: 'deepseek',
        cost_budget: 10.0
      });
      setSelectedTemplate('');

    } catch (error) {
      console.error('Failed to create agent:', error);
    } finally {
      setLoading(false);
    }
  };

  const deployAgent = async (agentId: string) => {
    try {
      // Update agent status
      setAgents(prev => prev.map(agent => 
        agent.id === agentId 
          ? { ...agent, status: 'running', last_execution: new Date() }
          : agent
      ));

      // Create new execution record
      const newExecution: AgentExecution = {
        id: Date.now().toString(),
        agent_id: agentId,
        start_time: new Date(),
        end_time: null,
        status: 'running',
        steps_completed: 0,
        total_steps: 10,
        cost: 0,
        logs: ['🚀 Agent deployment initiated...', '📋 Loading agent configuration...', '🔧 Initializing tools...']
      };

      setExecutions(prev => [...prev, newExecution]);

    } catch (error) {
      console.error('Failed to deploy agent:', error);
    }
  };

  const stopAgent = async (agentId: string) => {
    try {
      setAgents(prev => prev.map(agent => 
        agent.id === agentId ? { ...agent, status: 'paused' } : agent
      ));
    } catch (error) {
      console.error('Failed to stop agent:', error);
    }
  };

  const applyTemplate = (template: AgentTemplate) => {
    setNewAgent(prev => ({
      ...prev,
      name: template.name,
      description: template.description,
      objective: template.objective_template,
      tools: template.recommended_tools,
      cost_budget: template.estimated_cost
    }));
  };

  const getStatusColor = (status: string): string => {
    const colors: Record<string, string> = {
      'idle': '#888888',
      'running': '#00ff00',
      'paused': '#ffff00',
      'completed': '#00ffff',
      'failed': '#ff0000'
    };
    return colors[status] || colors.idle;
  };

  const getProviderIcon = (provider: string): string => {
    const icons: Record<string, string> = {
      'deepseek': '🧠',
      'groq': '⚡',
      'openai': '🤖',
      'claude': '🎭'
    };
    return icons[provider] || '🔮';
  };

  const getCategoryIcon = (category: string): string => {
    const icons: Record<string, string> = {
      'development': '⚡',
      'research': '🔍',
      'deployment': '🚀',
      'creative': '🎨',
      'analytics': '📊'
    };
    return icons[category] || '🔧';
  };

  const tabStyle = (isActive: boolean) => ({
    padding: '8px 16px',
    background: isActive ? 'rgba(0, 255, 255, 0.2)' : 'rgba(0, 255, 255, 0.05)',
    color: isActive ? '#00ffff' : '#888888',
    border: `1px solid ${isActive ? 'rgba(0, 255, 255, 0.5)' : 'rgba(0, 255, 255, 0.2)'}`,
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: 'Courier New, monospace',
    transition: 'all 0.3s ease',
    marginRight: '8px'
  });

  return (
    <div className="h-full flex flex-col" style={{
      background: 'rgba(0, 0, 0, 0.6)',
      color: '#ffffff',
      fontFamily: 'Courier New, monospace'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid rgba(0, 255, 255, 0.2)',
        background: 'rgba(0, 255, 255, 0.05)'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px'
        }}>
          <h2 style={{
            fontSize: '18px',
            fontWeight: 'bold',
            color: '#00ffff',
            margin: 0
          }}>
            🤖 AutoGPT Agent Manager
          </h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <span style={{
              fontSize: '11px',
              color: '#888888',
              background: 'rgba(0, 255, 255, 0.1)',
              padding: '4px 8px',
              borderRadius: '4px',
              border: '1px solid rgba(0, 255, 255, 0.3)'
            }}>
              📊 {agents.length} Agents
            </span>
            <span style={{
              fontSize: '11px',
              color: '#888888',
              background: 'rgba(0, 255, 0, 0.1)',
              padding: '4px 8px',
              borderRadius: '4px',
              border: '1px solid rgba(0, 255, 0, 0.3)'
            }}>
              🔄 {executions.filter(e => e.status === 'running').length} Running
            </span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex' }}>
          {[
            { id: 'agents', label: '🤖 Agents', icon: '🤖' },
            { id: 'create', label: '➕ Create Agent', icon: '➕' },
            { id: 'executions', label: '📊 Executions', icon: '📊' },
            { id: 'monitoring', label: '📈 Monitoring', icon: '📈' }
          ].map((tab) => (
            <div
              key={tab.id}
              style={tabStyle(activeTab === tab.id)}
              onClick={() => setActiveTab(tab.id)}
              onMouseOver={(e) => {
                if (activeTab !== tab.id) {
                  (e.target as HTMLElement).style.background = 'rgba(0, 255, 255, 0.1)';
                  (e.target as HTMLElement).style.color = '#00ffff';
                }
              }}
              onMouseOut={(e) => {
                if (activeTab !== tab.id) {
                  (e.target as HTMLElement).style.background = 'rgba(0, 255, 255, 0.05)';
                  (e.target as HTMLElement).style.color = '#888888';
                }
              }}
            >
              {tab.label}
            </div>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto">
        {/* Agents Tab */}
        {activeTab === 'agents' && (
          <div style={{ padding: '16px' }}>
            {agents.length === 0 && (
              <div style={{
                textAlign: 'center',
                color: '#888888',
                padding: '64px 0',
                fontSize: '14px'
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🤖</div>
                <h3 style={{ color: '#00ffff', marginBottom: '8px' }}>No Agents Created</h3>
                <p>Create your first AutoGPT agent to automate your workflow</p>
              </div>
            )}

            {agents.map((agent) => (
              <div key={agent.id} style={{
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(0, 255, 255, 0.3)',
                borderRadius: '4px',
                padding: '16px',
                marginBottom: '16px'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '12px'
                }}>
                  <div>
                    <h3 style={{
                      color: '#00ffff',
                      fontSize: '16px',
                      fontWeight: 'bold',
                      margin: '0 0 4px 0'
                    }}>
                      {agent.name}
                    </h3>
                    <p style={{
                      color: '#888888',
                      fontSize: '12px',
                      margin: 0
                    }}>
                      {agent.description}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <span style={{
                      fontSize: '10px',
                      color: getStatusColor(agent.status),
                      background: `${getStatusColor(agent.status)}20`,
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: `1px solid ${getStatusColor(agent.status)}50`,
                      textTransform: 'uppercase'
                    }}>
                      {agent.status}
                    </span>
                    <span style={{
                      fontSize: '10px',
                      color: '#00ffff',
                      background: 'rgba(0, 255, 255, 0.1)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: '1px solid rgba(0, 255, 255, 0.3)'
                    }}>
                      {getProviderIcon(agent.llm_provider)} {agent.llm_provider}
                    </span>
                  </div>
                </div>

                <div style={{
                  color: '#cccccc',
                  fontSize: '12px',
                  marginBottom: '12px'
                }}>
                  <strong style={{ color: '#00ffff' }}>Objective:</strong> {agent.objective}
                </div>

                <div style={{
                  display: 'flex',
                  gap: '16px',
                  fontSize: '11px',
                  color: '#888888',
                  marginBottom: '12px'
                }}>
                  <span>💰 Budget: <span style={{ color: '#00ff00' }}>${agent.cost_budget.toFixed(2)}</span></span>
                  <span>💸 Used: <span style={{ color: '#ffff00' }}>${agent.cost_used.toFixed(6)}</span></span>
                  <span>🔄 Runs: <span style={{ color: '#00ffff' }}>{agent.execution_count}</span></span>
                  <span>✅ Success: <span style={{ color: '#00ff00' }}>{Math.round(agent.success_rate * 100)}%</span></span>
                </div>

                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '4px',
                  marginBottom: '12px'
                }}>
                  {agent.tools.map(tool => {
                    const toolInfo = AVAILABLE_TOOLS.find(t => t.id === tool);
                    return (
                      <span key={tool} style={{
                        fontSize: '10px',
                        color: '#00ffff',
                        background: 'rgba(0, 255, 255, 0.1)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        border: '1px solid rgba(0, 255, 255, 0.3)'
                      }}>
                        {toolInfo?.icon} {tool}
                      </span>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  {agent.status === 'idle' || agent.status === 'paused' ? (
                    <Button
                      onClick={() => deployAgent(agent.id)}
                      style={{
                        background: 'rgba(0, 255, 0, 0.4)',
                        border: '1px solid rgba(0, 255, 0, 0.5)',
                        color: '#ffffff',
                        fontSize: '11px',
                        padding: '6px 12px'
                      }}
                    >
                      🚀 Deploy
                    </Button>
                  ) : agent.status === 'running' ? (
                    <Button
                      onClick={() => stopAgent(agent.id)}
                      style={{
                        background: 'rgba(255, 255, 0, 0.4)',
                        border: '1px solid rgba(255, 255, 0, 0.5)',
                        color: '#000000',
                        fontSize: '11px',
                        padding: '6px 12px'
                      }}
                    >
                      ⏸️ Pause
                    </Button>
                  ) : null}
                  
                  <Button
                    style={{
                      background: 'rgba(0, 255, 255, 0.2)',
                      border: '1px solid rgba(0, 255, 255, 0.5)',
                      color: '#00ffff',
                      fontSize: '11px',
                      padding: '6px 12px'
                    }}
                  >
                    📊 View Logs
                  </Button>
                  <Button
                    style={{
                      background: 'rgba(0, 255, 255, 0.2)',
                      border: '1px solid rgba(0, 255, 255, 0.5)',
                      color: '#00ffff',
                      fontSize: '11px',
                      padding: '6px 12px'
                    }}
                  >
                    ⚙️ Configure
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create Agent Tab */}
        {activeTab === 'create' && (
          <div style={{ padding: '16px' }}>
            {/* Agent Templates */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(0, 255, 255, 0.3)',
              borderRadius: '4px',
              padding: '16px',
              marginBottom: '16px'
            }}>
              <h3 style={{
                color: '#00ffff',
                fontSize: '14px',
                margin: '0 0 12px 0'
              }}>
                📋 Agent Templates
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '8px'
              }}>
                {AGENT_TEMPLATES.map((template) => (
                  <div
                    key={template.id}
                    style={{
                      background: selectedTemplate === template.id ? 'rgba(0, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.6)',
                      border: `1px solid ${selectedTemplate === template.id ? 'rgba(0, 255, 255, 0.6)' : 'rgba(0, 255, 255, 0.3)'}`,
                      borderRadius: '4px',
                      padding: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease'
                    }}
                    onClick={() => {
                      setSelectedTemplate(template.id);
                      applyTemplate(template);
                    }}
                    onMouseOver={(e) => {
                      if (selectedTemplate !== template.id) {
                        (e.target as HTMLElement).style.background = 'rgba(0, 255, 255, 0.1)';
                      }
                    }}
                    onMouseOut={(e) => {
                      if (selectedTemplate !== template.id) {
                        (e.target as HTMLElement).style.background = 'rgba(0, 0, 0, 0.6)';
                      }
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginBottom: '4px'
                    }}>
                      <span style={{ fontSize: '12px' }}>{getCategoryIcon(template.category)}</span>
                      <h4 style={{
                        color: '#00ffff',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        margin: 0
                      }}>
                        {template.name}
                      </h4>
                    </div>
                    <p style={{
                      color: '#888888',
                      fontSize: '10px',
                      margin: '0 0 8px 0'
                    }}>
                      {template.description}
                    </p>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span style={{
                        fontSize: '9px',
                        color: '#00ff00',
                        background: 'rgba(0, 255, 0, 0.1)',
                        padding: '2px 4px',
                        borderRadius: '4px'
                      }}>
                        ${template.estimated_cost}
                      </span>
                      <span style={{
                        fontSize: '9px',
                        color: '#00ffff',
                        background: 'rgba(0, 255, 255, 0.1)',
                        padding: '2px 4px',
                        borderRadius: '4px'
                      }}>
                        {template.recommended_tools.length} tools
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Agent Creation Form */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(0, 255, 255, 0.3)',
              borderRadius: '4px',
              padding: '16px'
            }}>
              <h3 style={{
                color: '#00ffff',
                fontSize: '14px',
                margin: '0 0 16px 0'
              }}>
                ➕ Create New AutoGPT Agent
              </h3>

              <div style={{ marginBottom: '12px' }}>
                <label style={{
                  display: 'block',
                  color: '#00ffff',
                  fontSize: '12px',
                  marginBottom: '4px'
                }}>
                  Agent Name
                </label>
                <Input
                  value={newAgent.name}
                  onChange={(e) => setNewAgent(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Mastermind Auth Developer"
                  style={{
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(0, 255, 255, 0.3)',
                    color: '#ffffff',
                    fontSize: '12px'
                  }}
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{
                  display: 'block',
                  color: '#00ffff',
                  fontSize: '12px',
                  marginBottom: '4px'
                }}>
                  Description
                </label>
                <Input
                  value={newAgent.description}
                  onChange={(e) => setNewAgent(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Brief description of what this agent does"
                  style={{
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(0, 255, 255, 0.3)',
                    color: '#ffffff',
                    fontSize: '12px'
                  }}
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{
                  display: 'block',
                  color: '#00ffff',
                  fontSize: '12px',
                  marginBottom: '4px'
                }}>
                  Objective
                </label>
                <Textarea
                  value={newAgent.objective}
                  onChange={(e) => setNewAgent(prev => ({ ...prev, objective: e.target.value }))}
                  placeholder="Clear, specific objective for the agent to accomplish"
                  rows={3}
                  style={{
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(0, 255, 255, 0.3)',
                    color: '#ffffff',
                    fontSize: '12px',
                    resize: 'vertical'
                  }}
                />
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                marginBottom: '12px'
              }}>
                <div>
                  <label style={{
                    display: 'block',
                    color: '#00ffff',
                    fontSize: '12px',
                    marginBottom: '4px'
                  }}>
                    LLM Provider
                  </label>
                  <select
                    value={newAgent.llm_provider}
                    onChange={(e) => setNewAgent(prev => ({ ...prev, llm_provider: e.target.value }))}
                    style={{
                      width: '100%',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(0, 255, 255, 0.3)',
                      color: '#ffffff',
                      fontSize: '12px',
                      padding: '8px',
                      borderRadius: '4px'
                    }}
                  >
                    <option value="deepseek">🧠 DeepSeek ($0.27/1M)</option>
                    <option value="groq">⚡ Groq ($0.59/1M)</option>
                    <option value="openai">🤖 OpenAI ($15/1M)</option>
                    <option value="claude">🎭 Claude ($3/1M)</option>
                  </select>
                </div>

                <div>
                  <label style={{
                    display: 'block',
                    color: '#00ffff',
                    fontSize: '12px',
                    marginBottom: '4px'
                  }}>
                    Cost Budget ($)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={newAgent.cost_budget}
                    onChange={(e) => setNewAgent(prev => ({ ...prev, cost_budget: parseFloat(e.target.value) }))}
                    placeholder="10.00"
                    style={{
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(0, 255, 255, 0.3)',
                      color: '#ffffff',
                      fontSize: '12px'
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  color: '#00ffff',
                  fontSize: '12px',
                  marginBottom: '8px'
                }}>
                  Available Tools
                </label>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px',
                  maxHeight: '200px',
                  overflowY: 'auto',
                  background: 'rgba(0, 0, 0, 0.3)',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid rgba(0, 255, 255, 0.2)'
                }}>
                  {AVAILABLE_TOOLS.map((tool) => (
                    <div key={tool.id} style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px'
                    }}>
                      <input
                        type="checkbox"
                        id={tool.id}
                        checked={newAgent.tools.includes(tool.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewAgent(prev => ({ 
                              ...prev, 
                              tools: [...prev.tools, tool.id] 
                            }));
                          } else {
                            setNewAgent(prev => ({ 
                              ...prev, 
                              tools: prev.tools.filter(t => t !== tool.id) 
                            }));
                          }
                        }}
                        style={{ marginTop: '2px' }}
                      />
                      <div>
                        <label htmlFor={tool.id} style={{
                          color: '#cccccc',
                          fontSize: '11px',
                          cursor: 'pointer',
                          display: 'block'
                        }}>
                          {tool.icon} {tool.name}
                        </label>
                        <p style={{
                          color: '#888888',
                          fontSize: '9px',
                          margin: 0
                        }}>
                          {tool.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Button
                onClick={createAgent}
                disabled={!newAgent.name || !newAgent.objective || loading}
                style={{
                  width: '100%',
                  background: (!newAgent.name || !newAgent.objective || loading) ? 'rgba(0, 255, 255, 0.2)' : 'rgba(0, 255, 255, 0.4)',
                  border: '1px solid rgba(0, 255, 255, 0.5)',
                  color: '#ffffff',
                  fontSize: '12px',
                  padding: '12px'
                }}
              >
                {loading ? '⏳ Creating...' : '🚀 Create Agent'}
              </Button>
            </div>
          </div>
        )}

        {/* Executions Tab */}
        {activeTab === 'executions' && (
          <div style={{ padding: '16px' }}>
            {executions.length === 0 && (
              <div style={{
                textAlign: 'center',
                color: '#888888',
                padding: '64px 0',
                fontSize: '14px'
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
                <h3 style={{ color: '#00ffff', marginBottom: '8px' }}>No Executions Yet</h3>
                <p>Deploy an agent to see execution history</p>
              </div>
            )}

            {executions.map((execution) => {
              const agent = agents.find(a => a.id === execution.agent_id);
              const duration = execution.end_time 
                ? execution.end_time.getTime() - execution.start_time.getTime()
                : Date.now() - execution.start_time.getTime();

              return (
                <div key={execution.id} style={{
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(0, 255, 255, 0.3)',
                  borderRadius: '4px',
                  padding: '16px',
                  marginBottom: '16px'
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px'
                  }}>
                    <h3 style={{
                      color: '#00ffff',
                      fontSize: '14px',
                      margin: 0
                    }}>
                      🤖 {agent?.name || 'Unknown Agent'}
                    </h3>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{
                        fontSize: '10px',
                        color: getStatusColor(execution.status),
                        background: `${getStatusColor(execution.status)}20`,
                        padding: '4px 8px',
                        borderRadius: '4px',
                        border: `1px solid ${getStatusColor(execution.status)}50`,
                        textTransform: 'uppercase'
                      }}>
                        {execution.status}
                      </span>
                      <span style={{
                        color: '#888888',
                        fontSize: '11px'
                      }}>
                        {execution.start_time.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div style={{
                    display: 'flex',
                    gap: '16px',
                    fontSize: '11px',
                    color: '#888888',
                    marginBottom: '8px'
                  }}>
                    <span>📊 Progress: <span style={{ color: '#00ffff' }}>{execution.steps_completed}/{execution.total_steps}</span></span>
                    <span>⏱️ Duration: <span style={{ color: '#00ffff' }}>{Math.round(duration / 1000)}s</span></span>
                    <span>💰 Cost: <span style={{ color: '#00ff00' }}>${execution.cost.toFixed(6)}</span></span>
                  </div>

                  {execution.status === 'running' && (
                    <div style={{
                      width: '100%',
                      height: '8px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      borderRadius: '4px',
                      overflow: 'hidden',
                      marginBottom: '12px'
                    }}>
                      <div
                        style={{
                          width: `${(execution.steps_completed / execution.total_steps) * 100}%`,
                          height: '100%',
                          background: 'linear-gradient(90deg, #00ffff, #0099ff)',
                          transition: 'width 0.3s ease'
                        }}
                      />
                    </div>
                  )}

                  {execution.logs.length > 0 && (
                    <div style={{
                      background: 'rgba(0, 0, 0, 0.6)',
                      border: '1px solid rgba(0, 255, 255, 0.2)',
                      borderRadius: '4px',
                      padding: '8px',
                      marginBottom: '12px'
                    }}>
                      <h4 style={{
                        color: '#00ffff',
                        fontSize: '12px',
                        margin: '0 0 8px 0'
                      }}>
                        Recent Logs:
                      </h4>
                      <div style={{
                        maxHeight: '120px',
                        overflowY: 'auto'
                      }}>
                        {execution.logs.slice(-5).map((log, idx) => (
                          <div key={idx} style={{
                            color: '#cccccc',
                            fontSize: '10px',
                            fontFamily: 'Courier New, monospace',
                            marginBottom: '2px'
                          }}>
                            {log}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                      style={{
                        background: 'rgba(0, 255, 255, 0.2)',
                        border: '1px solid rgba(0, 255, 255, 0.5)',
                        color: '#00ffff',
                        fontSize: '11px',
                        padding: '6px 12px'
                      }}
                    >
                      📋 View Details
                    </Button>
                    <Button
                      style={{
                        background: 'rgba(0, 255, 255, 0.2)',
                        border: '1px solid rgba(0, 255, 255, 0.5)',
                        color: '#00ffff',
                        fontSize: '11px',
                        padding: '6px 12px'
                      }}
                    >
                      📊 Analytics
                    </Button>
                    {execution.status === 'running' && (
                      <Button
                        style={{
                          background: 'rgba(255, 0, 0, 0.4)',
                          border: '1px solid rgba(255, 0, 0, 0.5)',
                          color: '#ffffff',
                          fontSize: '11px',
                          padding: '6px 12px'
                        }}
                      >
                        ⏸️ Stop
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Monitoring Tab */}
        {activeTab === 'monitoring' && (
          <div style={{ padding: '16px' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '16px'
            }}>
              {/* Agent Performance Metrics */}
              <div style={{
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(0, 255, 255, 0.3)',
                borderRadius: '4px',
                padding: '16px'
              }}>
                <h3 style={{
                  color: '#00ffff',
                  fontSize: '14px',
                  margin: '0 0 12px 0'
                }}>
                  📈 Agent Performance
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    { label: 'Total Agents', value: agents.length, color: '#00ffff' },
                    { label: 'Active Agents', value: agents.filter(a => a.status === 'running').length, color: '#00ff00' },
                    { label: 'Total Executions', value: executions.length, color: '#00ffff' },
                    { label: 'Success Rate', value: `${agents.length > 0 ? Math.round((agents.reduce((sum, a) => sum + a.success_rate, 0) / agents.length) * 100) : 0}%`, color: '#00ff00' }
                  ].map((metric, idx) => (
                    <div key={idx} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span style={{ color: '#cccccc', fontSize: '12px' }}>{metric.label}:</span>
                      <span style={{
                        color: metric.color,
                        fontSize: '12px',
                        background: `${metric.color}20`,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        border: `1px solid ${metric.color}50`
                      }}>
                        {metric.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cost Analytics */}
              <div style={{
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(0, 255, 255, 0.3)',
                borderRadius: '4px',
                padding: '16px'
              }}>
                <h3 style={{
                  color: '#00ffff',
                  fontSize: '14px',
                  margin: '0 0 12px 0'
                }}>
                  💰 Cost Analytics
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    { label: 'Total Budget', value: `$${agents.reduce((sum, a) => sum + a.cost_budget, 0).toFixed(2)}`, color: '#00ffff' },
                    { label: 'Total Spent', value: `$${agents.reduce((sum, a) => sum + a.cost_used, 0).toFixed(6)}`, color: '#ffff00' },
                    { label: 'Average Cost/Run', value: `$${executions.length > 0 ? (executions.reduce((sum, e) => sum + e.cost, 0) / executions.length).toFixed(6) : '0.000000'}`, color: '#00ffff' },
                    { label: 'Budget Remaining', value: `$${(agents.reduce((sum, a) => sum + a.cost_budget, 0) - agents.reduce((sum, a) => sum + a.cost_used, 0)).toFixed(2)}`, color: '#00ff00' }
                  ].map((metric, idx) => (
                    <div key={idx} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span style={{ color: '#cccccc', fontSize: '12px' }}>{metric.label}:</span>
                      <span style={{
                        color: metric.color,
                        fontSize: '12px',
                        background: `${metric.color}20`,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        border: `1px solid ${metric.color}50`
                      }}>
                        {metric.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Real-time Activity */}
              <div style={{
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(0, 255, 255, 0.3)',
                borderRadius: '4px',
                padding: '16px',
                gridColumn: 'span 2'
              }}>
                <h3 style={{
                  color: '#00ffff',
                  fontSize: '14px',
                  margin: '0 0 12px 0'
                }}>
                  🔄 Real-time Activity
                </h3>
                <div style={{
                  maxHeight: '200px',
                  overflowY: 'auto'
                }}>
                  {executions
                    .filter(e => e.status === 'running')
                    .map(execution => {
                      const agent = agents.find(a => a.id === execution.agent_id);
                      return (
                        <div key={execution.id} style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px',
                          background: 'rgba(0, 0, 0, 0.6)',
                          borderRadius: '4px',
                          marginBottom: '4px'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{
                              width: '8px',
                              height: '8px',
                              background: '#00ff00',
                              borderRadius: '50%',
                              animation: 'pulse 2s infinite'
                            }} />
                            <span style={{
                              color: '#cccccc',
                              fontSize: '12px'
                            }}>
                              {agent?.name}
                            </span>
                          </div>
                          <div style={{
                            display: 'flex',
                            gap: '12px',
                            fontSize: '10px',
                            color: '#888888'
                          }}>
                            <span>Step {execution.steps_completed}/{execution.total_steps}</span>
                            <span>${execution.cost.toFixed(6)}</span>
                          </div>
                        </div>
                      );
                    })}

                  {executions.filter(e => e.status === 'running').length === 0 && (
                    <div style={{
                      textAlign: 'center',
                      color: '#888888',
                      padding: '32px 0',
                      fontSize: '12px'
                    }}>
                      No active agents running
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}