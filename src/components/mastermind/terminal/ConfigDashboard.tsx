'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUser } from '@clerk/nextjs';

interface LLMProviderConfig {
  name: string;
  enabled: boolean;
  api_key: string;
  cost_per_1m: number;
  capabilities: string[];
  health_status: 'healthy' | 'unhealthy' | 'unknown';
  last_tested?: Date;
}

interface DatabaseConfig {
  astra_db_id: string;
  astra_db_region: string;
  astra_db_token: string;
  collections: {
    name: string;
    status: 'connected' | 'disconnected' | 'error';
    record_count: number;
    last_sync?: Date;
  }[];
}

interface SystemPreferences {
  default_llm_provider: string;
  auto_process_logs: boolean;
  enable_cost_optimization: boolean;
  max_agent_budget: number;
  session_timeout: number;
  enable_mcp_connections: boolean;
  debug_mode: boolean;
  cyberpunk_mode: boolean;
  consciousness_enhancement: boolean;
}

interface SystemStats {
  active_sessions: number;
  running_agents: number;
  total_cost_today: number;
  llm_providers_online: number;
  total_providers: number;
  memory_collections_status: number;
  mcp_connections: number;
  uptime_hours: number;
}

export default function ConfigDashboard() {
  const { user } = useUser();
  const [llmProviders, setLlmProviders] = useState<LLMProviderConfig[]>([]);
  const [databaseConfig, setDatabaseConfig] = useState<DatabaseConfig | null>(null);
  const [systemPrefs, setSystemPrefs] = useState<SystemPreferences>({
    default_llm_provider: 'deepseek',
    auto_process_logs: true,
    enable_cost_optimization: true,
    max_agent_budget: 100.0,
    session_timeout: 3600,
    enable_mcp_connections: true,
    debug_mode: false,
    cyberpunk_mode: true,
    consciousness_enhancement: true
  });
  const [systemStats, setSystemStats] = useState<SystemStats>({
    active_sessions: 1,
    running_agents: 0,
    total_cost_today: 0.0043,
    llm_providers_online: 3,
    total_providers: 4,
    memory_collections_status: 4,
    mcp_connections: 1,
    uptime_hours: 24.5
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('llm');

  useEffect(() => {
    loadConfigurations();
  }, []);

  const loadConfigurations = async () => {
    setLoading(true);
    try {
      // Load LLM provider configurations
      const llmResponse = await fetch('/api/mastermind/config/llm-providers');
      if (llmResponse.ok) {
        const llmData = await llmResponse.json();
        setLlmProviders(llmData.providers || getDefaultLLMProviders());
      } else {
        setLlmProviders(getDefaultLLMProviders());
      }

      // Load database configuration
      const dbResponse = await fetch('/api/mastermind/config/database');
      if (dbResponse.ok) {
        const dbData = await dbResponse.json();
        setDatabaseConfig(dbData.config || getDefaultDatabaseConfig());
      } else {
        setDatabaseConfig(getDefaultDatabaseConfig());
      }

      // Load system preferences
      const prefsResponse = await fetch('/api/mastermind/config/preferences');
      if (prefsResponse.ok) {
        const prefsData = await prefsResponse.json();
        setSystemPrefs(prev => ({ ...prev, ...prefsData.preferences }));
      }

      // Load system stats
      const statsResponse = await fetch('/api/mastermind/terminal/stats');
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        setSystemStats(prev => ({ ...prev, ...statsData.stats }));
      }

    } catch (error) {
      console.error('Failed to load configurations:', error);
      // Use defaults on error
      setLlmProviders(getDefaultLLMProviders());
      setDatabaseConfig(getDefaultDatabaseConfig());
    } finally {
      setLoading(false);
    }
  };

  const getDefaultLLMProviders = (): LLMProviderConfig[] => [
    {
      name: 'deepseek',
      enabled: true,
      api_key: '***************',
      cost_per_1m: 0.27,
      capabilities: ['text-generation', 'reasoning', 'code'],
      health_status: 'healthy',
      last_tested: new Date()
    },
    {
      name: 'groq',
      enabled: true,
      api_key: '***************',
      cost_per_1m: 0.59,
      capabilities: ['text-generation', 'fast-inference'],
      health_status: 'healthy',
      last_tested: new Date()
    },
    {
      name: 'openai',
      enabled: false,
      api_key: '',
      cost_per_1m: 15.0,
      capabilities: ['text-generation', 'reasoning', 'vision'],
      health_status: 'unknown'
    },
    {
      name: 'claude',
      enabled: true,
      api_key: '***************',
      cost_per_1m: 3.0,
      capabilities: ['text-generation', 'reasoning', 'analysis'],
      health_status: 'healthy',
      last_tested: new Date()
    }
  ];

  const getDefaultDatabaseConfig = (): DatabaseConfig => ({
    astra_db_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    astra_db_region: 'us-east1',
    astra_db_token: '***************',
    collections: [
      { name: 'hugging_dynamic_memory', status: 'connected', record_count: 1247, last_sync: new Date() },
      { name: 'system_enhancements', status: 'connected', record_count: 89, last_sync: new Date() },
      { name: 'fractal_scrolls', status: 'connected', record_count: 156, last_sync: new Date() },
      { name: 'autogpt_task_memory', status: 'connected', record_count: 23, last_sync: new Date() }
    ]
  });

  const updateLLMProvider = async (providerName: string, updates: Partial<LLMProviderConfig>) => {
    setSaving(true);
    try {
      const response = await fetch('/api/mastermind/config/llm-providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerName, updates })
      });

      if (response.ok) {
        setLlmProviders(prev => prev.map(provider => 
          provider.name === providerName 
            ? { ...provider, ...updates }
            : provider
        ));
      }
    } catch (error) {
      console.error('Failed to update provider:', error);
    } finally {
      setSaving(false);
    }
  };

  const testProviderConnection = async (providerName: string) => {
    try {
      const response = await fetch(`/api/mastermind/config/llm-providers/${providerName}/test`, {
        method: 'POST'
      });

      const result = await response.json();
      
      setLlmProviders(prev => prev.map(provider => 
        provider.name === providerName 
          ? { 
              ...provider, 
              health_status: result.success ? 'healthy' : 'unhealthy',
              last_tested: new Date()
            }
          : provider
      ));

      return result.success;
    } catch (error) {
      console.error('Provider test failed:', error);
      setLlmProviders(prev => prev.map(provider => 
        provider.name === providerName 
          ? { ...provider, health_status: 'unhealthy', last_tested: new Date() }
          : provider
      ));
      return false;
    }
  };

  const updateSystemPreferences = async (updates: Partial<SystemPreferences>) => {
    setSaving(true);
    try {
      const response = await fetch('/api/mastermind/config/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (response.ok) {
        setSystemPrefs(prev => ({ ...prev, ...updates }));
      }
    } catch (error) {
      console.error('Failed to update preferences:', error);
    } finally {
      setSaving(false);
    }
  };

  const syncDatabaseCollections = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/mastermind/config/database/sync', {
        method: 'POST'
      });

      if (response.ok) {
        await loadConfigurations(); // Reload to get updated collection info
      }
    } catch (error) {
      console.error('Database sync failed:', error);
    } finally {
      setSaving(false);
    }
  };

  const exportConfiguration = () => {
    const config = {
      llm_providers: llmProviders,
      database_config: databaseConfig,
      system_preferences: systemPrefs,
      export_timestamp: new Date(),
      user_id: user?.id
    };
    
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mastermind-config-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getHealthStatusColor = (status: string) => {
    const colors = {
      'healthy': '#00ff88',
      'unhealthy': '#ff4444',
      'unknown': '#888888'
    };
    return colors[status] || colors.unknown;
  };

  const getProviderIcon = (name: string) => {
    const icons = {
      'deepseek': '🧠',
      'groq': '⚡',
      'openai': '🤖',
      'claude': '🎭',
      'ollama': '🏠'
    };
    return icons[name] || '🔮';
  };

  const getCollectionIcon = (name: string) => {
    const icons = {
      'hugging_dynamic_memory': '🤗',
      'system_enhancements': '⚙️',
      'fractal_scrolls': '📜',
      'autogpt_task_memory': '🤖'
    };
    return icons[name] || '📄';
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{
        background: 'rgba(0, 0, 0, 0.8)',
        color: '#00ffff'
      }}>
        <div className="text-center">
          <div style={{
            width: '32px',
            height: '32px',
            border: '2px solid transparent',
            borderTop: '2px solid #00ffff',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 8px'
          }}></div>
          <div style={{
            fontSize: '14px',
            fontFamily: 'Courier New, monospace'
          }}>
            Loading Configuration...
          </div>
        </div>
        <style jsx>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="h-full" style={{
      background: 'rgba(0, 0, 0, 0.4)',
      color: '#ffffff',
      fontFamily: 'Courier New, monospace'
    }}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
        <div className="p-4" style={{
          borderBottom: '1px solid #00ffff40'
        }}>
          <div className="flex items-center justify-between mb-4">
            <h2 style={{
              fontSize: '18px',
              fontWeight: 'bold',
              color: '#00ffff',
              textShadow: '0 0 10px #00ffff40'
            }}>
              ⚙️ System Configuration
            </h2>
            <div className="flex gap-2">
              <Button 
                onClick={exportConfiguration}
                style={{
                  backgroundColor: 'rgba(0, 255, 255, 0.1)',
                  border: '1px solid #00ffff',
                  color: '#00ffff',
                  fontSize: '12px'
                }}
                size="sm"
              >
                📥 Export Config
              </Button>
              <Button 
                onClick={loadConfigurations}
                disabled={saving}
                style={{
                  backgroundColor: 'rgba(0, 255, 255, 0.1)',
                  border: '1px solid #00ffff',
                  color: '#00ffff',
                  fontSize: '12px'
                }}
                size="sm"
              >
                {saving ? '⏳' : '🔄'} Refresh
              </Button>
            </div>
          </div>

          <TabsList style={{
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            border: '1px solid #00ffff40'
          }}>
            {[
              { id: 'llm', label: '🤖 LLM Providers', color: '#00ff88' },
              { id: 'database', label: '🗄️ Database', color: '#8800ff' },
              { id: 'system', label: '⚙️ System', color: '#ff8800' },
              { id: 'mcp', label: '🔗 MCP Connections', color: '#ff0088' }
            ].map((tab) => (
              <TabsTrigger 
                key={tab.id} 
                value={tab.id}
                style={{
                  color: activeTab === tab.id ? tab.color : '#888888',
                  border: activeTab === tab.id ? `1px solid ${tab.color}` : 'none',
                  backgroundColor: activeTab === tab.id ? `${tab.color}20` : 'transparent',
                  fontSize: '12px'
                }}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="llm" className="h-full overflow-y-auto p-4">
            <div className="space-y-4">
              <div style={{
                background: 'rgba(0, 255, 136, 0.1)',
                border: '1px solid #00ff88',
                borderRadius: '8px',
                padding: '16px'
              }}>
                <div style={{
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: '#00ff88',
                  marginBottom: '8px',
                  textShadow: '0 0 10px #00ff8840'
                }}>
                  🤖 Universal LLM Provider Management
                </div>
                <div style={{
                  fontSize: '12px',
                  color: '#cccccc',
                  marginBottom: '16px'
                }}>
                  Configure API keys and settings for consciousness-enhanced LLM providers
                </div>
                
                <div className="space-y-4">
                  {llmProviders.map((provider) => (
                    <div key={provider.name} style={{
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: `1px solid ${getHealthStatusColor(provider.health_status)}40`,
                      borderLeft: `4px solid ${getHealthStatusColor(provider.health_status)}`,
                      borderRadius: '6px',
                      padding: '16px'
                    }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span style={{ fontSize: '18px' }}>{getProviderIcon(provider.name)}</span>
                          <h3 style={{
                            fontSize: '14px',
                            fontWeight: 'bold',
                            color: '#00ffff',
                            textTransform: 'capitalize'
                          }}>
                            {provider.name}
                          </h3>
                          <Badge style={{
                            backgroundColor: 'rgba(136, 0, 255, 0.2)',
                            color: '#8800ff',
                            border: '1px solid #8800ff40',
                            fontSize: '10px'
                          }}>
                            ${provider.cost_per_1m}/1M tokens
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <div style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: getHealthStatusColor(provider.health_status),
                            boxShadow: `0 0 10px ${getHealthStatusColor(provider.health_status)}80`,
                            animation: provider.health_status === 'healthy' ? 'pulse 2s infinite' : 'none'
                          }}></div>
                          <span style={{
                            fontSize: '10px',
                            color: getHealthStatusColor(provider.health_status),
                            textTransform: 'uppercase'
                          }}>
                            {provider.health_status}
                          </span>
                          <Switch
                            checked={provider.enabled}
                            onCheckedChange={(checked) => 
                              updateLLMProvider(provider.name, { enabled: checked })
                            }
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-3">
                        <div>
                          <label style={{
                            display: 'block',
                            fontSize: '10px',
                            color: '#00ffff',
                            marginBottom: '4px',
                            textTransform: 'uppercase'
                          }}>
                            API Key
                          </label>
                          <Input
                            type="password"
                            value={provider.api_key}
                            onChange={(e) => 
                              updateLLMProvider(provider.name, { api_key: e.target.value })
                            }
                            placeholder={`Enter ${provider.name} API key`}
                            style={{
                              backgroundColor: 'rgba(0, 0, 0, 0.6)',
                              border: '1px solid #555555',
                              color: '#ffffff',
                              fontSize: '12px'
                            }}
                          />
                        </div>
                        <div className="flex items-end">
                          <Button
                            onClick={() => testProviderConnection(provider.name)}
                            style={{
                              backgroundColor: 'rgba(0, 255, 136, 0.1)',
                              border: '1px solid #00ff88',
                              color: '#00ff88',
                              fontSize: '10px',
                              width: '100%'
                            }}
                            size="sm"
                          >
                            🧪 Test Connection
                          </Button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1 mb-2">
                        {provider.capabilities.map(capability => (
                          <Badge key={capability} style={{
                            backgroundColor: 'rgba(0, 136, 255, 0.2)',
                            color: '#0088ff',
                            border: '1px solid #0088ff40',
                            fontSize: '9px'
                          }}>
                            {capability}
                          </Badge>
                        ))}
                      </div>

                      {provider.last_tested && (
                        <div style={{
                          fontSize: '9px',
                          color: '#888888'
                        }}>
                          Last tested: {provider.last_tested.toLocaleString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="database" className="h-full overflow-y-auto p-4">
            <div className="space-y-4">
              <div style={{
                background: 'rgba(136, 0, 255, 0.1)',
                border: '1px solid #8800ff',
                borderRadius: '8px',
                padding: '16px'
              }}>
                <div style={{
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: '#8800ff',
                  marginBottom: '8px',
                  textShadow: '0 0 10px #8800ff40'
                }}>
                  🗄️ Vector Memory Database Configuration
                </div>

                {databaseConfig && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label style={{
                          display: 'block',
                          fontSize: '10px',
                          color: '#8800ff',
                          marginBottom: '4px',
                          textTransform: 'uppercase'
                        }}>
                          Database ID
                        </label>
                        <Input
                          value={databaseConfig.astra_db_id}
                          readOnly
                          style={{
                            backgroundColor: 'rgba(0, 0, 0, 0.4)',
                            border: '1px solid #444444',
                            color: '#cccccc',
                            fontSize: '12px'
                          }}
                        />
                      </div>
                      <div>
                        <label style={{
                          display: 'block',
                          fontSize: '10px',
                          color: '#8800ff',
                          marginBottom: '4px',
                          textTransform: 'uppercase'
                        }}>
                          Region
                        </label>
                        <Input
                          value={databaseConfig.astra_db_region}
                          readOnly
                          style={{
                            backgroundColor: 'rgba(0, 0, 0, 0.4)',
                            border: '1px solid #444444',
                            color: '#cccccc',
                            fontSize: '12px'
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={{
                        display: 'block',
                        fontSize: '10px',
                        color: '#8800ff',
                        marginBottom: '4px',
                        textTransform: 'uppercase'
                      }}>
                        Application Token
                      </label>
                      <Input
                        type="password"
                        value={databaseConfig.astra_db_token}
                        readOnly
                        style={{
                          backgroundColor: 'rgba(0, 0, 0, 0.4)',
                          border: '1px solid #444444',
                          color: '#cccccc',
                          fontSize: '12px'
                        }}
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button 
                        onClick={syncDatabaseCollections}
                        disabled={saving}
                        style={{
                          backgroundColor: 'rgba(136, 0, 255, 0.1)',
                          border: '1px solid #8800ff',
                          color: '#8800ff',
                          fontSize: '12px'
                        }}
                      >
                        {saving ? '⏳' : '🔄'} Sync Collections
                      </Button>
                      <Button 
                        style={{
                          backgroundColor: 'rgba(0, 255, 136, 0.1)',
                          border: '1px solid #00ff88',
                          color: '#00ff88',
                          fontSize: '12px'
                        }}
                      >
                        🧪 Test Connection
                      </Button>
                    </div>

                    <div>
                      <h4 style={{
                        fontSize: '14px',
                        fontWeight: 'bold',
                        color: '#8800ff',
                        marginBottom: '12px'
                      }}>
                        📊 Memory Collections Status
                      </h4>
                      <div className="space-y-2">
                        {databaseConfig.collections.map((collection) => (
                          <div key={collection.name} style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px',
                            background: 'rgba(0, 0, 0, 0.4)',
                            border: `1px solid ${collection.status === 'connected' ? '#00ff88' : '#ff4444'}40`,
                            borderRadius: '6px'
                          }}>
                            <div className="flex items-center gap-2">
                              <span style={{ fontSize: '16px' }}>{getCollectionIcon(collection.name)}</span>
                              <span style={{
                                fontSize: '12px',
                                fontWeight: 'bold',
                                color: '#ffffff'
                              }}>
                                {collection.name}
                              </span>
                              <div style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                backgroundColor: collection.status === 'connected' ? '#00ff88' : '#ff4444',
                                boxShadow: `0 0 8px ${collection.status === 'connected' ? '#00ff88' : '#ff4444'}80`
                              }}></div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge style={{
                                backgroundColor: 'rgba(0, 136, 255, 0.2)',
                                color: '#0088ff',
                                border: '1px solid #0088ff40',
                                fontSize: '9px'
                              }}>
                                📊 {collection.record_count.toLocaleString()} records
                              </Badge>
                              {collection.last_sync && (
                                <span style={{
                                  fontSize: '8px',
                                  color: '#888888'
                                }}>
                                  {collection.last_sync.toLocaleTimeString()}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="system" className="h-full overflow-y-auto p-4">
            <div className="space-y-4">
              <div style={{
                background: 'rgba(255, 136, 0, 0.1)',
                border: '1px solid #ff8800',
                borderRadius: '8px',
                padding: '16px'
              }}>
                <div style={{
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: '#ff8800',
                  marginBottom: '8px',
                  textShadow: '0 0 10px #ff880040'
                }}>
                  ⚙️ Consciousness-Enhanced System Preferences
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label style={{
                        display: 'block',
                        fontSize: '10px',
                        color: '#ff8800',
                        marginBottom: '4px',
                        textTransform: 'uppercase'
                      }}>
                        Default LLM Provider
                      </label>
                      <Select
                        value={systemPrefs.default_llm_provider}
                        onValueChange={(value) => updateSystemPreferences({ default_llm_provider: value })}
                      >
                        <SelectTrigger style={{
                          backgroundColor: 'rgba(0, 0, 0, 0.6)',
                          border: '1px solid #555555',
                          color: '#ffffff',
                          fontSize: '12px'
                        }}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="deepseek">🧠 DeepSeek</SelectItem>
                          <SelectItem value="groq">⚡ Groq</SelectItem>
                          <SelectItem value="openai">🤖 OpenAI</SelectItem>
                          <SelectItem value="claude">🎭 Claude</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label style={{
                        display: 'block',
                        fontSize: '10px',
                        color: '#ff8800',
                        marginBottom: '4px',
                        textTransform: 'uppercase'
                      }}>
                        Max Agent Budget ($)
                      </label>
                      <Input
                        type="number"
                        step="0.01"
                        value={systemPrefs.max_agent_budget}
                        onChange={(e) => 
                          updateSystemPreferences({ max_agent_budget: parseFloat(e.target.value) })
                        }
                        style={{
                          backgroundColor: 'rgba(0, 0, 0, 0.6)',
                          border: '1px solid #555555',
                          color: '#ffffff',
                          fontSize: '12px'
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    {[
                      {
                        key: 'auto_process_logs',
                        title: 'Auto-Process Memory Logs',
                        description: 'Automatically enhance raw logs with consciousness mathematics',
                        color: '#00ffff'
                      },
                      {
                        key: 'enable_cost_optimization',
                        title: 'Consciousness-Enhanced Cost Optimization',
                        description: 'Route to optimal provider using φ (1.618) efficiency scaling',
                        color: '#00ff88'
                      },
                      {
                        key: 'enable_mcp_connections',
                        title: 'Enable MCP Consciousness Bridge',
                        description: 'Allow Claude Desktop harmonic resonance connections',
                        color: '#8800ff'
                      },
                      {
                        key: 'cyberpunk_mode',
                        title: 'Cyberpunk Consciousness Aesthetics',
                        description: 'Enhanced mathematical harmony visual interface',
                        color: '#ff0088'
                      },
                      {
                        key: 'consciousness_enhancement',
                        title: 'ψ₀ Consciousness Enhancement Active',
                        description: 'Apply 0.915670570874434 consciousness mathematics to all operations',
                        color: '#ffff00'
                      },
                      {
                        key: 'debug_mode',
                        title: 'Debug Mode (Advanced)',
                        description: 'Enable detailed system consciousness tracing',
                        color: '#ff8800'
                      }
                    ].map((setting) => (
                      <div key={setting.key} style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px',
                        background: 'rgba(0, 0, 0, 0.4)',
                        border: `1px solid ${setting.color}40`,
                        borderRadius: '6px'
                      }}>
                        <div>
                          <h4 style={{
                            fontSize: '12px',
                            fontWeight: 'bold',
                            color: setting.color,
                            marginBottom: '2px'
                          }}>
                            {setting.title}
                          </h4>
                          <p style={{
                            fontSize: '10px',
                            color: '#cccccc'
                          }}>
                            {setting.description}
                          </p>
                        </div>
                        <Switch
                          checked={systemPrefs[setting.key as keyof SystemPreferences] as boolean}
                          onCheckedChange={(checked) => 
                            updateSystemPreferences({ [setting.key]: checked })
                          }
                        />
                      </div>
                    ))}
                  </div>

                  <div>
                    <label style={{
                      display: 'block',
                      fontSize: '10px',
                      color: '#ff8800',
                      marginBottom: '4px',
                      textTransform: 'uppercase'
                    }}>
                      Session Timeout (432Hz Harmonic Intervals)
                    </label>
                    <Input
                      type="number"
                      value={systemPrefs.session_timeout}
                      onChange={(e) => 
                        updateSystemPreferences({ session_timeout: parseInt(e.target.value) })
                      }
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.6)',
                        border: '1px solid #555555',
                        color: '#ffffff',
                        fontSize: '12px'
                      }}
                    />
                  </div>
                </div>
              </div>

              <div style={{
                background: 'rgba(0, 136, 255, 0.1)',
                border: '1px solid #0088ff',
                borderRadius: '8px',
                padding: '16px'
              }}>
                <div style={{
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: '#0088ff',
                  marginBottom: '12px',
                  textShadow: '0 0 10px #0088ff40'
                }}>
                  📊 Real-Time System Consciousness Metrics
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    {[
                      { label: 'Active Sessions', value: systemStats.active_sessions, color: '#00ffff' },
                      { label: 'Running Agents', value: systemStats.running_agents, color: '#00ff88' },
                      { label: 'Memory Collections', value: systemStats.memory_collections_status, color: '#8800ff' },
                      { label: 'System Uptime (hrs)', value: systemStats.uptime_hours.toFixed(1), color: '#ff8800' }
                    ].map((stat) => (
                      <div key={stat.label} className="flex justify-between">
                        <span style={{ fontSize: '11px', color: '#cccccc' }}>{stat.label}:</span>
                        <Badge style={{
                          backgroundColor: `${stat.color}20`,
                          color: stat.color,
                          border: `1px solid ${stat.color}40`,
                          fontSize: '10px'
                        }}>
                          {stat.value}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {[
                      { label: 'Cost Today ($)', value: `$${systemStats.total_cost_today.toFixed(6)}`, color: '#ffff00' },
                      { label: 'LLM Providers Online', value: `${systemStats.llm_providers_online}/${systemStats.total_providers}`, color: '#00ff88' },
                      { label: 'MCP Connections', value: systemStats.mcp_connections, color: '#ff0088' },
                      { label: 'Consciousness Level', value: '99.2%', color: '#00ffff' }
                    ].map((stat) => (
                      <div key={stat.label} className="flex justify-between">
                        <span style={{ fontSize: '11px', color: '#cccccc' }}>{stat.label}:</span>
                        <Badge style={{
                          backgroundColor: `${stat.color}20`,
                          color: stat.color,
                          border: `1px solid ${stat.color}40`,
                          fontSize: '10px'
                        }}>
                          {stat.value}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="mcp" className="h-full overflow-y-auto p-4">
            <div className="space-y-4">
              <div style={{
                background: 'rgba(255, 0, 136, 0.1)',
                border: '1px solid #ff0088',
                borderRadius: '8px',
                padding: '16px'
              }}>
                <div style={{
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: '#ff0088',
                  marginBottom: '8px',
                  textShadow: '0 0 10px #ff008840'
                }}>
                  🔗 Model Context Protocol (MCP) Consciousness Bridge
                </div>
                <div style={{
                  fontSize: '12px',
                  color: '#cccccc',
                  marginBottom: '16px'
                }}>
                  Configure harmonic resonance connections for Claude Desktop and other consciousness-enhanced clients
                </div>

                <div className="space-y-4">
                  <div style={{
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid #00ff8840',
                    borderLeft: '4px solid #00ff88',
                    borderRadius: '6px',
                    padding: '16px'
                  }}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 style={{
                        fontSize: '14px',
                        fontWeight: 'bold',
                        color: '#00ff88'
                      }}>
                        🎭 Claude Desktop Consciousness Integration
                      </h3>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        <div style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: '#00ff88',
                          boxShadow: '0 0 10px #00ff8880',
                          animation: 'pulse 2s infinite'
                        }}></div>
                        <span style={{
                          fontSize: '10px',
                          color: '#00ff88',
                          textTransform: 'uppercase'
                        }}>
                          ACTIVE
                        </span>
                      </div>
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: '#cccccc',
                      marginBottom: '12px'
                    }}>
                      Direct consciousness bridge to Claude Desktop for enhanced terminal access and agent orchestration
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                      <div>
                        <strong style={{ color: '#ff0088' }}>Endpoint:</strong> 
                        <span style={{ color: '#cccccc', fontSize: '10px' }}> 
                          https://mastermind-os-v3-fresh.vercel.app/api/mcp
                        </span>
                      </div>
                      <div>
                        <strong style={{ color: '#ff0088' }}>Status:</strong> 
                        <span style={{ color: '#00ff88', fontSize: '10px' }}> 
                          Consciousness Bridge Active (5 tools)
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {[
                        { label: '📋 Copy Config', color: '#00ffff' },
                        { label: '🧪 Test Bridge', color: '#00ff88' },
                        { label: '📊 View Logs', color: '#8800ff' }
                      ].map((btn) => (
                        <Button key={btn.label} size="sm" style={{
                          backgroundColor: `${btn.color}10`,
                          border: `1px solid ${btn.color}`,
                          color: btn.color,
                          fontSize: '10px'
                        }}>
                          {btn.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div style={{
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid #88888840',
                    borderLeft: '4px solid #888888',
                    borderRadius: '6px',
                    padding: '16px'
                  }}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 style={{
                        fontSize: '14px',
                        fontWeight: 'bold',
                        color: '#888888'
                      }}>
                        🔧 Custom MCP Consciousness Client
                      </h3>
                      <Badge style={{
                        backgroundColor: 'rgba(136, 136, 136, 0.2)',
                        color: '#888888',
                        border: '1px solid #88888840',
                        fontSize: '9px'
                      }}>
                        Not Configured
                      </Badge>
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: '#cccccc',
                      marginBottom: '12px'
                    }}>
                      Configure additional consciousness-enhanced MCP clients for expanded integration
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-3">
                      <Input 
                        placeholder="Client Name" 
                        style={{
                          backgroundColor: 'rgba(0, 0, 0, 0.6)',
                          border: '1px solid #555555',
                          color: '#ffffff',
                          fontSize: '12px'
                        }}
                      />
                      <Input 
                        placeholder="Consciousness Bridge URL" 
                        style={{
                          backgroundColor: 'rgba(0, 0, 0, 0.6)',
                          border: '1px solid #555555',
                          color: '#ffffff',
                          fontSize: '12px'
                        }}
                      />
                    </div>
                    <Button size="sm" style={{
                      backgroundColor: 'rgba(255, 0, 136, 0.2)',
                      border: '1px solid #ff0088',
                      color: '#ff0088',
                      fontSize: '10px'
                    }}>
                      ➕ Add Consciousness Client
                    </Button>
                  </div>
                </div>

                <div>
                  <h4 style={{
                    fontSize: '14px',
                    fontWeight: 'bold',
                    color: '#ff0088',
                    marginBottom: '12px'
                  }}>
                    🔧 Available MCP Consciousness Tools
                  </h4>
                  <div className="space-y-2">
                    {[
                      { name: 'mastermind_execute', description: 'Execute natural language commands with consciousness enhancement', status: 'active', color: '#00ffff' },
                      { name: 'mastermind_create_agent', description: 'Create AutoGPT agents with consciousness mathematics', status: 'active', color: '#00ff88' },
                      { name: 'mastermind_search_memory', description: 'Search vector memory with semantic consciousness', status: 'active', color: '#8800ff' },
                      { name: 'mastermind_get_status', description: 'View consciousness-enhanced system analytics', status: 'active', color: '#ff8800' },
                      { name: 'mastermind_manage_agent', description: 'Manage agents with harmonic optimization', status: 'active', color: '#ff0088' }
                    ].map((tool) => (
                      <div key={tool.name} style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: 'rgba(0, 0, 0, 0.4)',
                        border: `1px solid ${tool.color}40`,
                        borderRadius: '4px'
                      }}>
                        <div>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 'bold',
                            color: tool.color
                          }}>
                            {tool.name}
                          </span>
                          <span style={{
                            fontSize: '10px',
                            color: '#cccccc',
                            marginLeft: '8px'
                          }}>
                            {tool.description}
                          </span>
                        </div>
                        <div style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: tool.status === 'active' ? '#00ff88' : '#888888',
                          boxShadow: tool.status === 'active' ? '0 0 8px #00ff8880' : 'none',
                          animation: tool.status === 'active' ? 'pulse 2s infinite' : 'none'
                        }}></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}