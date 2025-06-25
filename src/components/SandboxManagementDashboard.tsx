'use client';

import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  Square, 
  Terminal, 
  Activity, 
  Users, 
  Server, 
  Cpu, 
  HardDrive, 
  Network,
  Shield,
  Globe,
  Settings,
  Monitor,
  Zap,
  Crown,
  Key,
  AlertTriangle
} from 'lucide-react';

interface SandboxInstance {
  id: string;
  name: string;
  tier: 'ADEPT' | 'KEEPER' | 'SOVEREIGN';
  status: 'running' | 'stopped' | 'pending' | 'failed';
  userId: string;
  namespace: string;
  createdAt: string;
  resources: {
    cpu: string;
    memory: string;
    storage: string;
    pods: number;
    services: number;
  };
  usage: {
    cpuPercent: number;
    memoryPercent: number;
    storagePercent: number;
  };
  endpoints: {
    primary: string;
    terminal: string;
    monitoring: string;
  };
  features: string[];
}

interface ClusterMetrics {
  totalNodes: number;
  runningPods: number;
  activeSandboxes: number;
  totalUsers: number;
  resourceUtilization: {
    cpu: number;
    memory: number;
    storage: number;
  };
  tierDistribution: {
    ADEPT: number;
    KEEPER: number;
    SOVEREIGN: number;
  };
}

export default function SandboxManagementDashboard() {
  const [sandboxes, setSandboxes] = useState<SandboxInstance[]>([]);
  const [clusterMetrics, setClusterMetrics] = useState<ClusterMetrics | null>(null);
  const [selectedSandbox, setSelectedSandbox] = useState<SandboxInstance | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newSandboxConfig, setNewSandboxConfig] = useState({
    name: '',
    tier: 'ADEPT' as 'ADEPT' | 'KEEPER' | 'SOVEREIGN',
    userId: '',
    features: [] as string[]
  });
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<'overview' | 'sandboxes' | 'monitoring' | 'settings'>('overview');

  useEffect(() => {
    fetchSandboxes();
    fetchClusterMetrics();
    const interval = setInterval(() => {
      fetchSandboxes();
      fetchClusterMetrics();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchSandboxes = async () => {
    try {
      const response = await fetch('/api/sandbox/list');
      if (response.ok) {
        const data = await response.json();
        setSandboxes(data.sandboxes || mockSandboxes);
      } else {
        setSandboxes(mockSandboxes);
      }
    } catch (error) {
      console.error('Failed to fetch sandboxes:', error);
      setSandboxes(mockSandboxes);
    }
  };

  const fetchClusterMetrics = async () => {
    try {
      const response = await fetch('/api/sandbox/metrics');
      if (response.ok) {
        const data = await response.json();
        setClusterMetrics(data.metrics || mockClusterMetrics);
      } else {
        setClusterMetrics(mockClusterMetrics);
      }
    } catch (error) {
      console.error('Failed to fetch cluster metrics:', error);
      setClusterMetrics(mockClusterMetrics);
    }
  };

  const createSandbox = async () => {
    if (!newSandboxConfig.name || !newSandboxConfig.userId) return;
    
    setIsCreating(true);
    try {
      const response = await fetch('/api/sandbox/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSandboxConfig)
      });
      
      if (response.ok) {
        const result = await response.json();
        addTerminalLine(`✅ Sandbox "${newSandboxConfig.name}" created successfully`);
        addTerminalLine(`🌐 Namespace: ${result.namespace}`);
        addTerminalLine(`🔗 Endpoint: ${result.endpoint}`);
        setNewSandboxConfig({ name: '', tier: 'ADEPT', userId: '', features: [] });
        fetchSandboxes();
      } else {
        const error = await response.json();
        addTerminalLine(`❌ Failed to create sandbox: ${error.message}`);
      }
    } catch (error) {
      addTerminalLine(`❌ Error creating sandbox: ${error}`);
    } finally {
      setIsCreating(false);
    }
  };

  const manageSandbox = async (action: 'start' | 'stop' | 'restart' | 'delete', sandbox: SandboxInstance) => {
    try {
      const response = await fetch(`/api/sandbox/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sandboxId: sandbox.id })
      });
      
      if (response.ok) {
        addTerminalLine(`✅ Sandbox "${sandbox.name}" ${action}ed successfully`);
        fetchSandboxes();
      } else {
        const error = await response.json();
        addTerminalLine(`❌ Failed to ${action} sandbox: ${error.message}`);
      }
    } catch (error) {
      addTerminalLine(`❌ Error ${action}ing sandbox: ${error}`);
    }
  };

  const addTerminalLine = (line: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setTerminalOutput(prev => [...prev.slice(-19), `[${timestamp}] ${line}`]);
  };

  const getTierIcon = (tier: string) => {
    switch (tier) {
      case 'ADEPT': return <Zap className="text-blue-400" size={16} />;
      case 'KEEPER': return <Shield className="text-purple-400" size={16} />;
      case 'SOVEREIGN': return <Crown className="text-yellow-400" size={16} />;
      default: return <Server className="text-gray-400" size={16} />;
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'ADEPT': return 'border-blue-500 bg-blue-500/10';
      case 'KEEPER': return 'border-purple-500 bg-purple-500/10';
      case 'SOVEREIGN': return 'border-yellow-500 bg-yellow-500/10';
      default: return 'border-gray-500 bg-gray-500/10';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'text-green-400';
      case 'stopped': return 'text-red-400';
      case 'pending': return 'text-yellow-400';
      case 'failed': return 'text-red-600';
      default: return 'text-gray-400';
    }
  };

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Cluster Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gray-800/50 border border-cyan-500/30 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-2">
            <Server className="text-cyan-400" size={20} />
            <h3 className="text-cyan-400 font-semibold">Cluster Nodes</h3>
          </div>
          <p className="text-2xl font-mono text-white">{clusterMetrics?.totalNodes || 0}</p>
          <p className="text-xs text-gray-400">Active nodes</p>
        </div>
        
        <div className="bg-gray-800/50 border border-green-500/30 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-2">
            <Activity className="text-green-400" size={20} />
            <h3 className="text-green-400 font-semibold">Active Sandboxes</h3>
          </div>
          <p className="text-2xl font-mono text-white">{clusterMetrics?.activeSandboxes || 0}</p>
          <p className="text-xs text-gray-400">Running instances</p>
        </div>
        
        <div className="bg-gray-800/50 border border-purple-500/30 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-2">
            <Users className="text-purple-400" size={20} />
            <h3 className="text-purple-400 font-semibold">Total Users</h3>
          </div>
          <p className="text-2xl font-mono text-white">{clusterMetrics?.totalUsers || 0}</p>
          <p className="text-xs text-gray-400">Registered users</p>
        </div>
        
        <div className="bg-gray-800/50 border border-yellow-500/30 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-2">
            <Monitor className="text-yellow-400" size={20} />
            <h3 className="text-yellow-400 font-semibold">Running Pods</h3>
          </div>
          <p className="text-2xl font-mono text-white">{clusterMetrics?.runningPods || 0}</p>
          <p className="text-xs text-gray-400">Total pods</p>
        </div>
      </div>

      {/* Resource Utilization */}
      <div className="bg-gray-800/50 border border-cyan-500/30 rounded-lg p-6">
        <h3 className="text-cyan-400 font-semibold mb-4 flex items-center">
          <Cpu className="mr-2" size={20} />
          Cluster Resource Utilization
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-sm text-gray-300">CPU</span>
              <span className="text-sm text-gray-300">{clusterMetrics?.resourceUtilization.cpu || 0}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div 
                className="bg-blue-500 h-2 rounded-full transition-all duration-300" 
                style={{ width: `${clusterMetrics?.resourceUtilization.cpu || 0}%` }}
              />
            </div>
          </div>
          
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-sm text-gray-300">Memory</span>
              <span className="text-sm text-gray-300">{clusterMetrics?.resourceUtilization.memory || 0}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div 
                className="bg-green-500 h-2 rounded-full transition-all duration-300" 
                style={{ width: `${clusterMetrics?.resourceUtilization.memory || 0}%` }}
              />
            </div>
          </div>
          
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-sm text-gray-300">Storage</span>
              <span className="text-sm text-gray-300">{clusterMetrics?.resourceUtilization.storage || 0}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div 
                className="bg-purple-500 h-2 rounded-full transition-all duration-300" 
                style={{ width: `${clusterMetrics?.resourceUtilization.storage || 0}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tier Distribution */}
      <div className="bg-gray-800/50 border border-cyan-500/30 rounded-lg p-6">
        <h3 className="text-cyan-400 font-semibold mb-4 flex items-center">
          <Crown className="mr-2" size={20} />
          Sandbox Tier Distribution
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl font-mono text-blue-400 mb-1">
              {clusterMetrics?.tierDistribution.ADEPT || 0}
            </div>
            <div className="flex items-center justify-center space-x-1">
              <Zap className="text-blue-400" size={16} />
              <span className="text-blue-400 text-sm">ADEPT</span>
            </div>
          </div>
          
          <div className="text-center">
            <div className="text-2xl font-mono text-purple-400 mb-1">
              {clusterMetrics?.tierDistribution.KEEPER || 0}
            </div>
            <div className="flex items-center justify-center space-x-1">
              <Shield className="text-purple-400" size={16} />
              <span className="text-purple-400 text-sm">KEEPER</span>
            </div>
          </div>
          
          <div className="text-center">
            <div className="text-2xl font-mono text-yellow-400 mb-1">
              {clusterMetrics?.tierDistribution.SOVEREIGN || 0}
            </div>
            <div className="flex items-center justify-center space-x-1">
              <Crown className="text-yellow-400" size={16} />
              <span className="text-yellow-400 text-sm">SOVEREIGN</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderSandboxes = () => (
    <div className="space-y-6">
      {/* Sandbox Creation */}
      <div className="bg-gray-800/50 border border-cyan-500/30 rounded-lg p-6">
        <h3 className="text-cyan-400 font-semibold mb-4 flex items-center">
          <Settings className="mr-2" size={20} />
          Create New Sandbox
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <input
            type="text"
            placeholder="Sandbox name"
            value={newSandboxConfig.name}
            onChange={(e) => setNewSandboxConfig(prev => ({ ...prev, name: e.target.value }))}
            className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-400 focus:border-cyan-500 focus:outline-none"
          />
          
          <input
            type="text"
            placeholder="User ID"
            value={newSandboxConfig.userId}
            onChange={(e) => setNewSandboxConfig(prev => ({ ...prev, userId: e.target.value }))}
            className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-400 focus:border-cyan-500 focus:outline-none"
          />
          
          <select
            value={newSandboxConfig.tier}
            onChange={(e) => setNewSandboxConfig(prev => ({ ...prev, tier: e.target.value as any }))}
            className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
          >
            <option value="ADEPT">ADEPT (Basic)</option>
            <option value="KEEPER">KEEPER (Advanced)</option>
            <option value="SOVEREIGN">SOVEREIGN (Ultimate)</option>
          </select>
          
          <button
            onClick={createSandbox}
            disabled={isCreating || !newSandboxConfig.name || !newSandboxConfig.userId}
            className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600 text-white px-4 py-2 rounded transition-colors flex items-center justify-center"
          >
            {isCreating ? <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : 'Create'}
          </button>
        </div>
      </div>

      {/* Sandbox List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sandboxes.map((sandbox) => (
          <div
            key={sandbox.id}
            className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
              selectedSandbox?.id === sandbox.id 
                ? getTierColor(sandbox.tier) + ' shadow-lg' 
                : 'border-gray-600 bg-gray-800/30 hover:border-gray-500'
            }`}
            onClick={() => setSelectedSandbox(selectedSandbox?.id === sandbox.id ? null : sandbox)}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                {getTierIcon(sandbox.tier)}
                <h4 className="text-white font-semibold">{sandbox.name}</h4>
              </div>
              <div className="flex items-center space-x-2">
                <span className={`text-sm ${getStatusColor(sandbox.status)}`}>
                  {sandbox.status.toUpperCase()}
                </span>
                <div className="flex space-x-1">
                  {sandbox.status === 'running' ? (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); manageSandbox('stop', sandbox); }}
                        className="p-1 hover:bg-red-500/20 rounded"
                      >
                        <Pause size={14} className="text-red-400" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); manageSandbox('restart', sandbox); }}
                        className="p-1 hover:bg-yellow-500/20 rounded"
                      >
                        <Square size={14} className="text-yellow-400" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); manageSandbox('start', sandbox); }}
                      className="p-1 hover:bg-green-500/20 rounded"
                    >
                      <Play size={14} className="text-green-400" />
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); manageSandbox('delete', sandbox); }}
                    className="p-1 hover:bg-red-500/20 rounded"
                  >
                    <Square size={14} className="text-red-400" />
                  </button>
                </div>
              </div>
            </div>
            
            <div className="text-sm text-gray-300 space-y-1">
              <div className="flex justify-between">
                <span>Namespace:</span>
                <span className="font-mono text-gray-400">{sandbox.namespace}</span>
              </div>
              <div className="flex justify-between">
                <span>User:</span>
                <span className="font-mono text-gray-400">{sandbox.userId}</span>
              </div>
              <div className="flex justify-between">
                <span>Resources:</span>
                <span className="text-xs text-gray-400">
                  {sandbox.resources.cpu} CPU | {sandbox.resources.memory} RAM | {sandbox.resources.storage} Storage
                </span>
              </div>
            </div>

            {selectedSandbox?.id === sandbox.id && (
              <div className="mt-4 pt-4 border-t border-gray-600">
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="text-center">
                    <div className="text-sm text-gray-400">CPU Usage</div>
                    <div className="text-lg font-mono text-blue-400">{sandbox.usage.cpuPercent}%</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm text-gray-400">Memory Usage</div>
                    <div className="text-lg font-mono text-green-400">{sandbox.usage.memoryPercent}%</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm text-gray-400">Storage Usage</div>
                    <div className="text-lg font-mono text-purple-400">{sandbox.usage.storagePercent}%</div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Primary Endpoint:</span>
                    <a 
                      href={sandbox.endpoints.primary} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 font-mono text-xs"
                    >
                      {sandbox.endpoints.primary}
                    </a>
                  </div>
                  
                  <div className="flex flex-wrap gap-1 mt-2">
                    {sandbox.features.map((feature, idx) => (
                      <span 
                        key={idx}
                        className="px-2 py-1 bg-gray-700 text-xs text-gray-300 rounded"
                      >
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const renderTerminal = () => (
    <div className="bg-black/90 border border-cyan-500/30 rounded-lg p-4 h-80 overflow-y-auto">
      <div className="flex items-center space-x-2 mb-3">
        <Terminal className="text-cyan-400" size={16} />
        <span className="text-cyan-400 text-sm font-semibold">Sandbox Management Terminal</span>
      </div>
      <div className="font-mono text-sm space-y-1">
        {terminalOutput.length === 0 ? (
          <div className="text-gray-500">Waiting for operations...</div>
        ) : (
          terminalOutput.map((line, idx) => (
            <div key={idx} className="text-gray-300">{line}</div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-blue-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent mb-2">
            🏗️ Sovereign Sandbox Infrastructure
          </h1>
          <p className="text-gray-300">
            Phase 2 - Container Orchestration & User Isolation Management
          </p>
        </div>

        {/* Navigation */}
        <div className="flex space-x-4 mb-6">
          {[
            { key: 'overview', label: 'Overview', icon: Activity },
            { key: 'sandboxes', label: 'Sandboxes', icon: Server },
            { key: 'monitoring', label: 'Monitoring', icon: Monitor },
            { key: 'settings', label: 'Settings', icon: Settings }
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveView(key as any)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                activeView === key
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                  : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/50'
              }`}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2">
            {activeView === 'overview' && renderOverview()}
            {activeView === 'sandboxes' && renderSandboxes()}
            {activeView === 'monitoring' && (
              <div className="space-y-6">
                <div className="bg-gray-800/50 border border-cyan-500/30 rounded-lg p-6">
                  <h3 className="text-cyan-400 font-semibold mb-4">Real-time Monitoring</h3>
                  <p className="text-gray-300">Advanced monitoring dashboard coming in Phase 3...</p>
                </div>
              </div>
            )}
            {activeView === 'settings' && (
              <div className="space-y-6">
                <div className="bg-gray-800/50 border border-cyan-500/30 rounded-lg p-6">
                  <h3 className="text-cyan-400 font-semibold mb-4">Sandbox Configuration</h3>
                  <p className="text-gray-300">Advanced settings panel coming in Phase 3...</p>
                </div>
              </div>
            )}
          </div>

          {/* Terminal Sidebar */}
          <div className="space-y-6">
            {renderTerminal()}
            
            {/* Quick Stats */}
            <div className="bg-gray-800/50 border border-cyan-500/30 rounded-lg p-4">
              <h4 className="text-cyan-400 font-semibold mb-3 flex items-center">
                <AlertTriangle className="mr-2" size={16} />
                System Status
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-300">Cluster Health:</span>
                  <span className="text-green-400">●   Healthy</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">API Status:</span>
                  <span className="text-green-400">●   Online</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">K8s Connection:</span>
                  <span className="text-green-400">●   Connected</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Storage:</span>
                  <span className="text-green-400">●   Available</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Mock data for development/testing
const mockSandboxes: SandboxInstance[] = [
  {
    id: 'sb-001',
    name: 'ai-research-lab',
    tier: 'SOVEREIGN',
    status: 'running',
    userId: 'user-123',
    namespace: 'sandbox-user-123-001',
    createdAt: '2024-06-06T10:30:00Z',
    resources: {
      cpu: '4 cores',
      memory: '8GB',
      storage: '100GB',
      pods: 5,
      services: 3
    },
    usage: {
      cpuPercent: 65,
      memoryPercent: 78,
      storagePercent: 45
    },
    endpoints: {
      primary: 'https://ai-research-lab.sovereign.mastermind-os.dev',
      terminal: 'wss://terminal.ai-research-lab.sovereign.mastermind-os.dev',
      monitoring: 'https://monitoring.ai-research-lab.sovereign.mastermind-os.dev'
    },
    features: ['AI Models', 'Jupyter Lab', 'GPU Access', 'Custom Domain', 'Hardware Security']
  },
  {
    id: 'sb-002',
    name: 'crypto-trading-bot',
    tier: 'KEEPER',
    status: 'running',
    userId: 'user-456',
    namespace: 'sandbox-user-456-002',
    createdAt: '2024-06-06T09:15:00Z',
    resources: {
      cpu: '2 cores',
      memory: '4GB',
      storage: '50GB',
      pods: 3,
      services: 2
    },
    usage: {
      cpuPercent: 42,
      memoryPercent: 56,
      storagePercent: 33
    },
    endpoints: {
      primary: 'https://crypto-trading-bot.keeper.mastermind-os.dev',
      terminal: 'wss://terminal.crypto-trading-bot.keeper.mastermind-os.dev',
      monitoring: 'https://monitoring.crypto-trading-bot.keeper.mastermind-os.dev'
    },
    features: ['Trading APIs', 'Real-time Data', 'Secure Vault', 'Custom Domain']
  },
  {
    id: 'sb-003',
    name: 'learning-playground',
    tier: 'ADEPT',
    status: 'stopped',
    userId: 'user-789',
    namespace: 'sandbox-user-789-003',
    createdAt: '2024-06-06T08:00:00Z',
    resources: {
      cpu: '1 core',
      memory: '2GB',
      storage: '20GB',
      pods: 2,
      services: 1
    },
    usage: {
      cpuPercent: 0,
      memoryPercent: 0,
      storagePercent: 15
    },
    endpoints: {
      primary: 'https://learning-playground.adept.mastermind-os.dev',
      terminal: 'wss://terminal.learning-playground.adept.mastermind-os.dev',
      monitoring: 'https://monitoring.learning-playground.adept.mastermind-os.dev'
    },
    features: ['Code Playground', 'Basic Tools', 'Learning Resources']
  }
];

const mockClusterMetrics: ClusterMetrics = {
  totalNodes: 12,
  runningPods: 47,
  activeSandboxes: 15,
  totalUsers: 8,
  resourceUtilization: {
    cpu: 68,
    memory: 72,
    storage: 45
  },
  tierDistribution: {
    ADEPT: 6,
    KEEPER: 5,
    SOVEREIGN: 4
  }
};
