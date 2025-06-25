'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface SandboxStatus {
  userId: string;
  tier: string;
  namespace: string;
  subdomain: string;
  status: 'provisioning' | 'ready' | 'error' | 'terminated';
  endpoints: {
    app: string;
    api: string;
    lab?: string;
  };
  resources: {
    allocated: {
      cpu: string;
      memory: string;
      storage: string;
    };
    used: {
      cpu: string;
      memory: string;
      storage: string;
      network?: {
        ingress: string;
        egress: string;
      };
    };
  };
  createdAt: string;
  lastAccessed: string;
}

interface SandboxMetrics {
  cpu: { usage: string; limit: string };
  memory: { usage: string; limit: string };
  storage: { usage: string; limit: string };
  network: { ingress: string; egress: string };
}

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const statusColors = {
    provisioning: 'bg-yellow-500',
    ready: 'bg-green-500',
    error: 'bg-red-500',
    terminated: 'bg-gray-500'
  };

  const statusIcons = {
    provisioning: '⏳',
    ready: '✅',
    error: '❌',
    terminated: '🛑'
  };

  return (
    <Badge className={`${statusColors[status as keyof typeof statusColors]} text-white`}>
      {statusIcons[status as keyof typeof statusIcons]} {status.toUpperCase()}
    </Badge>
  );
};

const ResourceMeter: React.FC<{
  label: string;
  usage: string;
  limit: string;
  icon: string;
}> = ({ label, usage, limit, icon }) => {
  const getUsagePercentage = () => {
    if (!usage || !limit) return 0;
    
    // Parse usage and limit (handle different units)
    const parseValue = (value: string) => {
      const num = parseFloat(value);
      if (value.includes('Gi')) return num * 1024;
      if (value.includes('Mi')) return num;
      if (value.includes('%')) return num;
      return num;
    };

    const usageValue = parseValue(usage);
    const limitValue = parseValue(limit);
    
    return Math.min((usageValue / limitValue) * 100, 100);
  };

  const percentage = getUsagePercentage();
  const getColor = () => {
    if (percentage > 90) return 'bg-red-500';
    if (percentage > 75) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium flex items-center gap-1">
          <span>{icon}</span>
          {label}
        </span>
        <span className="text-xs text-gray-400">
          {usage} / {limit}
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full ${getColor()}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

const SandboxLogs: React.FC<{ userId: string }> = ({ userId }) => {
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/sandbox?action=logs&userId=${userId}`);
      const data = await response.json();
      if (data.success) {
        setLogs(data.logs);
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>🔍 Sandbox Logs</span>
          <Button onClick={fetchLogs} disabled={loading} size="sm">
            {loading ? '⏳ Loading...' : '🔄 Refresh'}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="bg-black text-green-400 font-mono text-xs p-4 rounded-lg max-h-96 overflow-y-auto">
          {logs || 'No logs available. Click refresh to load recent logs.'}
        </div>
      </CardContent>
    </Card>
  );
};

export default function SandboxDashboard({ userId }: { userId: string }) {
  const [sandbox, setSandbox] = useState<SandboxStatus | null>(null);
  const [metrics, setMetrics] = useState<SandboxMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [activeTab, setActiveTab] = useState('logs'); // Added state for tabs

  const fetchSandboxStatus = async () => {
    try {
      const response = await fetch(`/api/sandbox?action=status&userId=${userId}`);
      const data = await response.json();
      if (data.success && data.sandbox) {
        setSandbox(data.sandbox);
      } else {
        setSandbox(null);
      }
    } catch (error) {
      console.error('Failed to fetch sandbox status:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMetrics = async () => {
    if (!sandbox) return;
    
    try {
      const response = await fetch(`/api/sandbox?action=metrics&userId=${userId}`);
      const data = await response.json();
      if (data.success) {
        setMetrics(data.metrics);
      }
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    }
  };

  const provisionSandbox = async (tier: string, subdomain: string) => {
    setProvisioning(true);
    try {
      const response = await fetch('/api/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, tier, subdomain })
      });
      
      const data = await response.json();
      if (data.success) {
        setSandbox(data.sandbox);
        // Poll for status updates
        const pollStatus = setInterval(async () => {
          await fetchSandboxStatus();
          if (sandbox?.status === 'ready') {
            clearInterval(pollStatus);
          }
        }, 10000); // Poll every 10 seconds
      }
    } catch (error) {
      console.error('Failed to provision sandbox:', error);
    } finally {
      setProvisioning(false);
    }
  };

  const terminateSandbox = async () => {
    if (!confirm('Are you sure you want to terminate your sovereign realm? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/sandbox?userId=${userId}&backup=true`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      if (data.success) {
        setSandbox(null);
        setMetrics(null);
      }
    } catch (error) {
      console.error('Failed to terminate sandbox:', error);
    }
  };

  useEffect(() => {
    fetchSandboxStatus();
  }, []);

  useEffect(() => {
    if (sandbox?.status === 'ready') {
      fetchMetrics();
      // Set up periodic metrics refresh
      const interval = setInterval(fetchMetrics, 30000); // Every 30 seconds
      return () => clearInterval(interval);
    }
  }, [sandbox]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-4xl mb-4">⏳</div>
          <div>Loading your sovereign realm status...</div>
        </div>
      </div>
    );
  }

  if (!sandbox) {
    // No sandbox exists - show provisioning interface
    return (
      <div className="space-y-6">
        <Card className="bg-gradient-to-r from-purple-900/30 to-indigo-900/30 border-purple-500/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-3xl">🏰</span>
              Your Sovereign Realm Awaits
            </CardTitle>
            <CardDescription>
              Provision your isolated digital kingdom with complete sovereignty over your domain.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertDescription>
                Your sandbox will be provisioned based on your current subscription tier. 
                Higher tiers receive more resources and advanced features.
              </AlertDescription>
            </Alert>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {['ADEPT', 'KEEPER', 'SOVEREIGN'].map((tier) => (
                <Card key={tier} className="cursor-pointer hover:shadow-lg transition-all">
                  <CardHeader className="text-center">
                    <CardTitle className="text-lg">
                      {tier === 'ADEPT' && '⚗️ ADEPT'}
                      {tier === 'KEEPER' && '🗝️ KEEPER'}
                      {tier === 'SOVEREIGN' && '👑 SOVEREIGN'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      {tier === 'ADEPT' && (
                        <>
                          <div>• 2 CPU cores</div>
                          <div>• 4GB RAM</div>
                          <div>• 20GB storage</div>
                          <div>• Basic lab</div>
                        </>
                      )}
                      {tier === 'KEEPER' && (
                        <>
                          <div>• 4 CPU cores</div>
                          <div>• 8GB RAM</div>
                          <div>• 100GB storage</div>
                          <div>• Advanced lab</div>
                          <div>• Custom domain</div>
                        </>
                      )}
                      {tier === 'SOVEREIGN' && (
                        <>
                          <div>• 8 CPU cores</div>
                          <div>• 16GB RAM</div>
                          <div>• 500GB storage</div>
                          <div>• 1 GPU</div>
                          <div>• Cosmic lab</div>
                          <div>• Multi-cloud</div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex gap-4">
              <input
                type="text"
                placeholder="Choose your realm subdomain (e.g. 'mystic-realm')"
                className="flex-1 px-3 py-2 border rounded-lg bg-gray-800 text-white"
                id="subdomain"
              />
              <Button
                onClick={() => {
                  const subdomainInput = document.getElementById('subdomain') as HTMLInputElement;
                  const subdomain = subdomainInput?.value || `realm-${userId.slice(0, 8)}`;
                  provisionSandbox('KEEPER', subdomain); // Default to KEEPER tier
                }}
                disabled={provisioning}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {provisioning ? '⏳ Provisioning...' : '🚀 Create Sovereign Realm'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Sandbox exists - show management interface
  return (
    <div className="space-y-6">
      {/* Status Overview */}
      <Card className="bg-gradient-to-r from-indigo-900/30 to-purple-900/30 border-indigo-500/50">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="text-3xl">
                {sandbox.tier === 'ADEPT' && '⚗️'}
                {sandbox.tier === 'KEEPER' && '🗝️'}
                {sandbox.tier === 'SOVEREIGN' && '👑'}
              </span>
              Your {sandbox.tier} Realm
            </span>
            <StatusBadge status={sandbox.status} />
          </CardTitle>
          <CardDescription>
            Namespace: {sandbox.namespace} • Created: {new Date(sandbox.createdAt).toLocaleDateString()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Endpoints */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="font-semibold mb-2">🌐 Realm Access Points</h4>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>Main App:</span>
                  <a href={sandbox.endpoints.app} target="_blank" rel="noopener noreferrer" 
                     className="text-blue-400 hover:underline">
                    {sandbox.endpoints.app}
                  </a>
                </div>
                <div className="flex justify-between">
                  <span>API:</span>
                  <span className="text-gray-400">{sandbox.endpoints.api}</span>
                </div>
                {sandbox.endpoints.lab && (
                  <div className="flex justify-between">
                    <span>Research Lab:</span>
                    <a href={sandbox.endpoints.lab} target="_blank" rel="noopener noreferrer"
                       className="text-blue-400 hover:underline">
                      {sandbox.endpoints.lab}
                    </a>
                  </div>
                )}
              </div>
            </div>
            
            <div>
              <h4 className="font-semibold mb-2">⚙️ Quick Actions</h4>
              <div className="space-y-2">
                <Button size="sm" className="w-full" onClick={() => window.open(sandbox.endpoints.app, '_blank')}>
                  🚀 Enter Realm
                </Button>
                <Button size="sm" variant="outline" className="w-full" onClick={fetchSandboxStatus}>
                  🔄 Refresh Status
                </Button>
                <Button size="sm" variant="destructive" className="w-full" onClick={terminateSandbox}>
                  🛑 Terminate Realm
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resource Monitoring */}
      {metrics && (
        <Card>
          <CardHeader>
            <CardTitle>📊 Resource Utilization</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <ResourceMeter
                label="CPU"
                usage={metrics.cpu.usage}
                limit={metrics.cpu.limit}
                icon="🖥️"
              />
              <ResourceMeter
                label="Memory"
                usage={metrics.memory.usage}
                limit={metrics.memory.limit}
                icon="🧠"
              />
              <ResourceMeter
                label="Storage"
                usage={metrics.storage.usage}
                limit={metrics.storage.limit}
                icon="💾"
              />
              <div className="space-y-2">
                <div className="text-sm font-medium flex items-center gap-1">
                  <span>🌐</span>
                  Network
                </div>
                <div className="text-xs text-gray-400">
                  ↑ {metrics.network.egress} / ↓ {metrics.network.ingress}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detailed Management */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="logs">🔍 Logs</TabsTrigger>
          <TabsTrigger value="config">⚙️ Configuration</TabsTrigger>
          <TabsTrigger value="security">🔒 Security</TabsTrigger>
        </TabsList>
        
        <TabsContent value="logs">
          <SandboxLogs userId={userId} />
        </TabsContent>
        
        <TabsContent value="config">
          <Card>
            <CardHeader>
              <CardTitle>⚙️ Realm Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Auto-scaling</label>
                    <select className="w-full p-2 border rounded bg-gray-800">
                      <option>Enabled</option>
                      <option>Disabled</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Backup Schedule</label>
                    <select className="w-full p-2 border rounded bg-gray-800">
                      <option>Daily</option>
                      <option>Weekly</option>
                      <option>Manual only</option>
                    </select>
                  </div>
                </div>
                <Button className="w-full">💾 Save Configuration</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>🔒 Security Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span>Network Isolation</span>
                  <Badge className="bg-green-500">✅ Active</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Data Encryption</span>
                  <Badge className="bg-green-500">✅ AES-256</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Access Logging</span>
                  <Badge className="bg-green-500">✅ Enabled</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Two-Factor Auth</span>
                  <Badge className="bg-yellow-500">⚠️ Configure</Badge>
                </div>
                <Button className="w-full">🔧 Configure Advanced Security</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}