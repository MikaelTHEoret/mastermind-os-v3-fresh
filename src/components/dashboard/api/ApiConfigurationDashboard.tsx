'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Key, 
  Eye, 
  EyeOff, 
  Copy, 
  RefreshCw, 
  Save, 
  Trash2,
  Plus,
  ExternalLink,
  Shield,
  Code,
  Check,
  AlertCircle,
  Database,
  Globe,
  Play,
  Pause
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import SourcesConfigDashboard from '../sources/SourcesConfigDashboard';

// Mathematical constants for enhanced functionality
const PSI_0 = 0.915670570874434;
const PHI = 1.618;
const FREQ_432 = 432;

// Available permissions for API keys
const AVAILABLE_PERMISSIONS = [
  'scrolls:create',
  'scrolls:read',
  'scrolls:update',
  'scrolls:delete',
  'memory:read',
  'memory:write',
  'analytics:read',
  'consciousness:enhance',
  'admin:users'
];

interface MasterMindApiKey {
  id: string;
  name: string;
  key: string;
  secret: string;
  permissions: string[];
  createdAt: string;
  lastUsed?: string;
  isActive: boolean;
  usage: {
    requests: number;
    limit: number;
  };
}

// Removed ExternalApiConfig since it's handled by SourcesConfigDashboard

const PERMISSION_OPTIONS = [
  { id: 'scroll.create', label: 'Create Scrolls', description: 'Generate and mint new scrolls' },
  { id: 'scroll.read', label: 'Read Scrolls', description: 'Access existing scroll data' },
  { id: 'memory.access', label: 'Memory Access', description: 'Query dynamic memory system' },
  { id: 'analytics.read', label: 'Analytics', description: 'View analytics and insights' },
  { id: 'wallet.connect', label: 'Wallet Integration', description: 'Connect to user wallets' },
  { id: 'admin.access', label: 'Admin Functions', description: 'Administrative operations' }
];

export default function ApiConfigurationDashboard() {
  const { user } = useUser();
  const [masterMindKeys, setMasterMindKeys] = useState<MasterMindApiKey[]>([]);
  const [showSecrets, setShowSecrets] = useState<{ [key: string]: boolean }>({});
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  // Restore tab functionality
  const [activeTab, setActiveTab] = useState<'mastermind' | 'external'>('mastermind');

  // New API Key form state
  const [newKeyForm, setNewKeyForm] = useState({
    name: '',
    permissions: [] as string[],
    isVisible: false
  });

  const loadApiConfigurations = useCallback(async () => {
    setIsLoading(true);
    try {
      // Load MasterMind API keys from API endpoint
      const response = await fetch('/api/v1/auth/keys/manage', {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.keys) {
          setMasterMindKeys(data.keys);
        }
      } else {
        // Fallback to localStorage for development
        const savedKeys = localStorage.getItem(`mastermind_api_keys_${user?.id}`);
        if (savedKeys) {
          setMasterMindKeys(JSON.parse(savedKeys));
        }
      }
    } catch (error) {
      console.error('Error loading API configurations:', error);
      
      // Fallback to localStorage
      try {
        const savedKeys = localStorage.getItem(`mastermind_api_keys_${user?.id}`);
        if (savedKeys) {
          setMasterMindKeys(JSON.parse(savedKeys));
        }
      } catch (fallbackError) {
        console.error('Fallback loading failed:', fallbackError);
      }
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user) {
      loadApiConfigurations();
    }
  }, [user, loadApiConfigurations]);

  // Enhanced key generation using mathematical constants
  const generateApiCredentials = () => {
    const timestamp = Date.now();
    const userHash = user?.id ? btoa(user.id).slice(0, 8) : 'anon';
    
    // Use mathematical constants for enhanced randomization
    const psiComponent = Math.floor(PSI_0 * 1000000).toString(36);
    const phiComponent = Math.floor(PHI * 1000000).toString(36);
    const freqComponent = Math.floor(FREQ_432 * Math.random()).toString(36);
    
    const randomBytes = Array.from({ length: 16 }, () => 
      Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
    ).join('');

    const apiKey = `mmind_${userHash}_${psiComponent}${phiComponent}${freqComponent}`;
    const apiSecret = `${timestamp.toString(36)}${randomBytes}${psiComponent}`;

    return { apiKey, apiSecret };
  };

  const createNewApiKey = async () => {
    if (!newKeyForm.name.trim()) return;

    setIsGenerating(true);
    
    try {
      // Try to create via API endpoint
      const response = await fetch('/api/v1/auth/keys/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'create',
          name: newKeyForm.name,
          permissions: newKeyForm.permissions
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.key) {
          const updatedKeys = [...masterMindKeys, data.key];
          setMasterMindKeys(updatedKeys);
          
          // Also save to localStorage as backup
          localStorage.setItem(`mastermind_api_keys_${user?.id}`, JSON.stringify(updatedKeys));
        }
      } else {
        // Fallback to local generation
        const { apiKey, apiSecret } = generateApiCredentials();
        
        const newKey: MasterMindApiKey = {
          id: `key_${Date.now()}`,
          name: newKeyForm.name,
          key: apiKey,
          secret: apiSecret,
          permissions: newKeyForm.permissions,
          createdAt: new Date().toISOString(),
          isActive: true,
          usage: {
            requests: 0,
            limit: 10000
          }
        };

        const updatedKeys = [...masterMindKeys, newKey];
        setMasterMindKeys(updatedKeys);
        localStorage.setItem(`mastermind_api_keys_${user?.id}`, JSON.stringify(updatedKeys));
      }

      // Reset form
      setNewKeyForm({ name: '', permissions: [], isVisible: false });
    } catch (error) {
      console.error('Error creating API key:', error);
      
      // Fallback to local generation
      try {
        const { apiKey, apiSecret } = generateApiCredentials();
        
        const newKey: MasterMindApiKey = {
          id: `key_${Date.now()}`,
          name: newKeyForm.name,
          key: apiKey,
          secret: apiSecret,
          permissions: newKeyForm.permissions,
          createdAt: new Date().toISOString(),
          isActive: true,
          usage: {
            requests: 0,
            limit: 10000
          }
        };

        const updatedKeys = [...masterMindKeys, newKey];
        setMasterMindKeys(updatedKeys);
        localStorage.setItem(`mastermind_api_keys_${user?.id}`, JSON.stringify(updatedKeys));
        
        // Reset form
        setNewKeyForm({ name: '', permissions: [], isVisible: false });
      } catch (fallbackError) {
        console.error('Fallback key generation failed:', fallbackError);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleApiKeyStatus = (keyId: string) => {
    const updatedKeys = masterMindKeys.map(key =>
      key.id === keyId ? { ...key, isActive: !key.isActive } : key
    );
    setMasterMindKeys(updatedKeys);
    localStorage.setItem(`mastermind_api_keys_${user?.id}`, JSON.stringify(updatedKeys));
  };

  const deleteApiKey = (keyId: string) => {
    const updatedKeys = masterMindKeys.filter(key => key.id !== keyId);
    setMasterMindKeys(updatedKeys);
    localStorage.setItem(`mastermind_api_keys_${user?.id}`, JSON.stringify(updatedKeys));
  };

  const copyToClipboard = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(type);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const toggleSecretVisibility = (keyId: string, type: 'key' | 'secret') => {
    const toggleKey = `${keyId}_${type}`;
    setShowSecrets(prev => ({
      ...prev,
      [toggleKey]: !prev[toggleKey]
    }));
  };

  const togglePermission = (permission: string) => {
    setNewKeyForm(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter(p => p !== permission)
        : [...prev.permissions, permission]
    }));
  };

  const renderMasterMindApiTab = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-cyan-300">MasterMind OS API Keys</h3>
          <p className="text-gray-400 mt-1">
            Generate and manage API keys for MasterMind OS integration
          </p>
        </div>
        <Button
          onClick={() => setNewKeyForm(prev => ({ ...prev, isVisible: true }))}
          className="bg-cyan-600 hover:bg-cyan-700 text-white"
        >
          <Plus className="h-4 w-4 mr-2" />
          Generate New Key
        </Button>
      </div>

      {/* API Documentation */}
      <Card 
        className="border bg-black/40 backdrop-blur-sm"
        style={{
          border: '2px solid #00ffff',
          borderRadius: '12px',
          background: 'rgba(0, 0, 0, 0.8)',
          boxShadow: '0 0 15px rgba(0, 255, 255, 0.3)'
        }}
      >
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Code className="h-5 w-5 text-cyan-400" />
            <h4 className="text-lg font-semibold text-cyan-300">API Documentation</h4>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h5 className="text-sm font-medium text-cyan-300 mb-2">Base URL</h5>
              <div className="bg-black/50 border border-cyan-500/30 rounded-lg p-3 font-mono text-sm">
                <span className="text-cyan-400">https://mastermind-os-v3-fresh.vercel.app/api</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-2 h-6 w-6 p-0 hover:bg-cyan-500/20"
                  onClick={() => copyToClipboard('https://mastermind-os-v3-fresh.vercel.app/api', 'base_url')}
                >
                  {copySuccess === 'base_url' ? 
                    <Check className="h-3 w-3 text-green-400" /> : 
                    <Copy className="h-3 w-3" />
                  }
                </Button>
              </div>
            </div>
            
            <div>
              <h5 className="text-sm font-medium text-cyan-300 mb-2">Authentication</h5>
              <div className="bg-black/50 border border-cyan-500/30 rounded-lg p-3 font-mono text-sm">
                <span className="text-green-400">Authorization: Bearer YOUR_API_KEY</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-2 h-6 w-6 p-0 hover:bg-cyan-500/20"
                  onClick={() => copyToClipboard('Authorization: Bearer YOUR_API_KEY', 'auth_header')}
                >
                  {copySuccess === 'auth_header' ? 
                    <Check className="h-3 w-3 text-green-400" /> : 
                    <Copy className="h-3 w-3" />
                  }
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <Button
              variant="outline"
              className="border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
              onClick={() => window.open('/api/docs', '_blank')}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              View Full Documentation
            </Button>
          </div>
        </div>
      </Card>

      {/* New API Key Form */}
      {newKeyForm.isVisible && (
        <Card 
          className="border bg-black/40 backdrop-blur-sm"
          style={{
            border: '2px solid #00ffff',
            borderRadius: '12px',
            background: 'rgba(0, 0, 0, 0.8)',
            boxShadow: '0 0 15px rgba(0, 255, 255, 0.3)'
          }}
        >
          <div className="p-6">
            <h4 className="text-lg font-semibold text-cyan-300 mb-4">Generate New API Key</h4>
            
            <div className="space-y-4">
              <div>
                <Label htmlFor="key-name" className="text-cyan-300">Key Name</Label>
                <Input
                  id="key-name"
                  value={newKeyForm.name}
                  onChange={(e) => setNewKeyForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter a descriptive name for this API key"
                  className="mt-1 bg-black/50 border-cyan-500/30 text-white"
                />
              </div>

              <div>
                <Label className="text-cyan-300">Permissions</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                  {AVAILABLE_PERMISSIONS.map((permission) => (
                    <div key={permission} className="flex items-center space-x-2">
                      <Checkbox
                        id={permission}
                        checked={newKeyForm.permissions.includes(permission)}
                        onCheckedChange={() => togglePermission(permission)}
                        className="border-cyan-500/30"
                      />
                      <Label htmlFor={permission} className="text-sm text-gray-300 capitalize">
                        {permission.replace('_', ' ')}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex space-x-2 pt-2">
                <Button
                  onClick={createNewApiKey}
                  disabled={!newKeyForm.name.trim() || isGenerating}
                  className="bg-cyan-600 hover:bg-cyan-700 text-white"
                >
                  {isGenerating ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Generating...
                    </>
                  ) : (
                    <>
                      <Key className="h-4 w-4 mr-2" />
                      Generate API Key
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setNewKeyForm({ name: '', permissions: [], isVisible: false })}
                  className="border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* API Keys List */}
      <div className="space-y-4">
        {masterMindKeys.length === 0 ? (
          <Card 
            className="border bg-black/40 backdrop-blur-sm"
            style={{
              border: '2px solid #00ffff',
              borderRadius: '12px',
              background: 'rgba(0, 0, 0, 0.8)',
              boxShadow: '0 0 15px rgba(0, 255, 255, 0.3)'
            }}
          >
            <div className="p-8 text-center">
              <Key className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-300 mb-2">No API Keys Generated</h3>
              <p className="text-gray-400 mb-4">
                Create your first API key to start integrating with MasterMind OS
              </p>
              <Button
                onClick={() => setNewKeyForm(prev => ({ ...prev, isVisible: true }))}
                className="bg-cyan-600 hover:bg-cyan-700 text-white"
              >
                <Plus className="h-4 w-4 mr-2" />
                Generate New Key
              </Button>
            </div>
          </Card>
        ) : (
          masterMindKeys.map((apiKey) => (
            <Card 
              key={apiKey.id}
              className="border bg-black/40 backdrop-blur-sm"
              style={{
                border: '2px solid #00ffff',
                borderRadius: '12px',
                background: 'rgba(0, 0, 0, 0.8)',
                boxShadow: '0 0 15px rgba(0, 255, 255, 0.3)'
              }}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="text-lg font-semibold text-cyan-300">{apiKey.name}</h4>
                    <p className="text-xs text-gray-400">
                      Created: {new Date(apiKey.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge className={`text-xs ${apiKey.isActive ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
                      {apiKey.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleApiKeyStatus(apiKey.id)}
                      className="border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
                    >
                      {apiKey.isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteApiKey(apiKey.id)}
                      className="border-red-500/30 text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <Label className="text-cyan-300 text-sm">API Key</Label>
                    <div className="flex items-center space-x-2 mt-1">
                      <div className="flex-1 bg-black/50 border border-cyan-500/30 rounded-lg p-3 font-mono text-sm">
                        {showSecrets[`${apiKey.id}_key`] ? apiKey.key : '•'.repeat(40)}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 w-10 p-0 hover:bg-cyan-500/20"
                        onClick={() => toggleSecretVisibility(apiKey.id, 'key')}
                      >
                        {showSecrets[`${apiKey.id}_key`] ? 
                          <EyeOff className="h-4 w-4" /> : 
                          <Eye className="h-4 w-4" />
                        }
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 w-10 p-0 hover:bg-cyan-500/20"
                        onClick={() => copyToClipboard(apiKey.key, `${apiKey.id}_key`)}
                      >
                        {copySuccess === `${apiKey.id}_key` ? 
                          <Check className="h-4 w-4 text-green-400" /> : 
                          <Copy className="h-4 w-4" />
                        }
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Label className="text-cyan-300 text-sm">API Secret</Label>
                    <div className="flex items-center space-x-2 mt-1">
                      <div className="flex-1 bg-black/50 border border-cyan-500/30 rounded-lg p-3 font-mono text-sm">
                        {showSecrets[`${apiKey.id}_secret`] ? apiKey.secret : '•'.repeat(40)}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 w-10 p-0 hover:bg-cyan-500/20"
                        onClick={() => toggleSecretVisibility(apiKey.id, 'secret')}
                      >
                        {showSecrets[`${apiKey.id}_secret`] ? 
                          <EyeOff className="h-4 w-4" /> : 
                          <Eye className="h-4 w-4" />
                        }
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 w-10 p-0 hover:bg-cyan-500/20"
                        onClick={() => copyToClipboard(apiKey.secret, `${apiKey.id}_secret`)}
                      >
                        {copySuccess === `${apiKey.id}_secret` ? 
                          <Check className="h-4 w-4 text-green-400" /> : 
                          <Copy className="h-4 w-4" />
                        }
                      </Button>
                    </div>
                  </div>

                  {apiKey.permissions.length > 0 && (
                    <div>
                      <Label className="text-cyan-300 text-sm">Permissions</Label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {apiKey.permissions.map((permission) => (
                          <Badge 
                            key={permission} 
                            className="text-xs bg-blue-500/20 text-blue-400 border-blue-500/30"
                          >
                            {permission.replace('_', ' ')}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="text-xs text-gray-400">
                    Usage: {apiKey.usage.requests.toLocaleString()} / {apiKey.usage.limit.toLocaleString()} requests
                  </div>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex space-x-1 bg-black/30 p-1 rounded-lg border border-cyan-500/30">
        <Button
          variant={activeTab === 'mastermind' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('mastermind')}
          className={`flex-1 ${
            activeTab === 'mastermind'
              ? 'bg-cyan-600 text-white'
              : 'text-cyan-300 hover:bg-cyan-500/10'
          }`}
        >
          <Database className="h-4 w-4 mr-2" />
          MasterMind API
        </Button>
        <Button
          variant={activeTab === 'external' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('external')}
          className={`flex-1 ${
            activeTab === 'external'
              ? 'bg-cyan-600 text-white'
              : 'text-cyan-300 hover:bg-cyan-500/10'
          }`}
        >
          <Globe className="h-4 w-4 mr-2" />
          External APIs
        </Button>
      </div>

      {/* Tab Content */}
      {activeTab === 'mastermind' ? (
        renderMasterMindApiTab()
      ) : (
        <SourcesConfigDashboard />
      )}
    </div>
  );
}