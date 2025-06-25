'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Key, Trash2, Eye, EyeOff, Edit, Shield, AlertTriangle, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

interface Secret {
  id: string;
  serviceName: string;
  secretType: string;
  description?: string;
  isActive: boolean;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  encryptionStatus?: string;
}

interface SecretFormData {
  serviceName: string;
  secretType: 'api_key' | 'oauth_token' | 'password' | 'custom';
  value: string;
  description: string;
  expiresAt: string;
}

export function UserSecretsManager() {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [encryptionAvailable, setEncryptionAvailable] = useState(true);
  const [systemWarning, setSystemWarning] = useState('');
  const [formData, setFormData] = useState<SecretFormData>({
    serviceName: '',
    secretType: 'api_key',
    value: '',
    description: '',
    expiresAt: ''
  });
  const [showValue, setShowValue] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const commonServices = [
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic (Claude)' },
    { value: 'github', label: 'GitHub' },
    { value: 'google', label: 'Google' },
    { value: 'aws', label: 'AWS' },
    { value: 'azure', label: 'Azure' },
    { value: 'pinata', label: 'Pinata IPFS' },
    { value: 'neon', label: 'Neon Database' },
    { value: 'vercel', label: 'Vercel' },
    { value: 'custom', label: 'Custom Service' }
  ];
  
  useEffect(() => {
    fetchSecrets();
  }, []);
  
  const fetchSecrets = async () => {
    try {
      const response = await fetch('/api/user/secrets');
      if (response.ok) {
        const data = await response.json();
        setSecrets(data.secrets || []);
        setEncryptionAvailable(data.encryptionAvailable !== false);
        
        // Show warning if encryption is not available
        if (data.encryptionAvailable === false) {
          setSystemWarning('Encryption is not fully available in development mode. Secrets are stored with fallback encoding.');
        }
      } else {
        console.warn('Secrets API not available, running in offline mode');
        setSystemWarning('Secrets management is not available in offline mode. This feature requires a backend connection.');
      }
    } catch (error) {
      console.error('Failed to fetch secrets:', error);
      setSystemWarning('Unable to connect to secrets service. Running in offline mode.');
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const response = await fetch('/api/user/secrets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          expiresAt: formData.expiresAt || undefined
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast.success(data.message || 'Secret stored successfully!');
        
        // Show encryption status
        if (data.encryptionUsed === false) {
          toast.warning('Secret stored with fallback encoding (development mode)');
        }
        
        setShowAddDialog(false);
        setFormData({
          serviceName: '',
          secretType: 'api_key',
          value: '',
          description: '',
          expiresAt: ''
        });
        fetchSecrets();
      } else {
        toast.error(data.error || 'Failed to store secret');
      }
    } catch (error) {
      toast.error('Network error. Please try again.');
      console.error('Secret storage error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleDelete = async (secretId: string) => {
    try {
      const response = await fetch(`/api/user/secrets?id=${secretId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        toast.success('Secret deleted successfully');
        fetchSecrets();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to delete secret');
      }
    } catch (error) {
      toast.error('Network error. Please try again.');
    }
  };
  
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };
  
  const getSecretTypeIcon = (type: string) => {
    switch (type) {
      case 'api_key': return <Key className="h-4 w-4" />;
      case 'oauth_token': return <Shield className="h-4 w-4" />;
      default: return <Key className="h-4 w-4" />;
    }
  };
  
  const getServiceDisplayName = (serviceName: string) => {
    const service = commonServices.find(s => s.value === serviceName);
    return service ? service.label : serviceName;
  };
  
  if (isLoading) {
    return (
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-6">
          <div className="text-center text-zinc-400">Loading secrets...</div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              API Keys & Secrets
              {!encryptionAvailable && (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
              {encryptionAvailable && (
                <CheckCircle className="h-4 w-4 text-green-500" />
              )}
            </CardTitle>
            <CardDescription className="text-zinc-400">
              Securely store your API keys and authentication tokens
            </CardDescription>
          </div>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" />
                Add Secret
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
              <DialogHeader>
                <DialogTitle>Add New Secret</DialogTitle>
                <DialogDescription className="text-zinc-400">
                  Store an API key or authentication token
                  {!encryptionAvailable && (
                    <span className="block mt-2 text-yellow-400 text-sm">
                      ⚠️ Development mode: Using fallback encoding
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>
              
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="serviceName">Service</Label>
                  <Select
                    value={formData.serviceName}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, serviceName: value }))}
                  >
                    <SelectTrigger className="bg-zinc-800 border-zinc-700">
                      <SelectValue placeholder="Select a service" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700">
                      {commonServices.map(service => (
                        <SelectItem key={service.value} value={service.value}>
                          {service.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {formData.serviceName === 'custom' && (
                    <Input
                      placeholder="Enter custom service name"
                      value={formData.serviceName === 'custom' ? '' : formData.serviceName}
                      onChange={(e) => setFormData(prev => ({ ...prev, serviceName: e.target.value }))}
                      className="bg-zinc-800 border-zinc-700 text-white"
                    />
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="secretType">Type</Label>
                  <Select
                    value={formData.secretType}
                    onValueChange={(value: any) => setFormData(prev => ({ ...prev, secretType: value }))}
                  >
                    <SelectTrigger className="bg-zinc-800 border-zinc-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700">
                      <SelectItem value="api_key">API Key</SelectItem>
                      <SelectItem value="oauth_token">OAuth Token</SelectItem>
                      <SelectItem value="password">Password</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="value">Secret Value</Label>
                  <div className="relative">
                    <Input
                      id="value"
                      type={showValue ? 'text' : 'password'}
                      placeholder="Enter your secret key/token"
                      value={formData.value}
                      onChange={(e) => setFormData(prev => ({ ...prev, value: e.target.value }))}
                      required
                      className="bg-zinc-800 border-zinc-700 text-white pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowValue(!showValue)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                    >
                      {showValue ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="description">Description (Optional)</Label>
                  <Input
                    id="description"
                    placeholder="Brief description of this secret"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    className="bg-zinc-800 border-zinc-700 text-white"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="expiresAt">Expires At (Optional)</Label>
                  <Input
                    id="expiresAt"
                    type="datetime-local"
                    value={formData.expiresAt}
                    onChange={(e) => setFormData(prev => ({ ...prev, expiresAt: e.target.value }))}
                    className="bg-zinc-800 border-zinc-700 text-white"
                  />
                </div>
                
                <div className="flex gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowAddDialog(false)}
                    className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 bg-blue-600 hover:bg-blue-700"
                  >
                    {isSubmitting ? 'Storing...' : 'Store Secret'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      
      <CardContent>
        {/* System Warning */}
        {systemWarning && (
          <Alert className="mb-4 bg-yellow-900/20 border-yellow-600/50">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-yellow-200">
              {systemWarning}
            </AlertDescription>
          </Alert>
        )}
        
        {secrets.length === 0 ? (
          <div className="text-center py-8 text-zinc-400">
            <Key className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No secrets stored yet</p>
            <p className="text-sm">Add your first API key or authentication token</p>
            {systemWarning && (
              <p className="text-xs text-yellow-400 mt-2">
                Note: Secrets management requires backend connection
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {secrets.map((secret) => (
              <div
                key={secret.id}
                className="flex items-center justify-between p-4 bg-zinc-800 rounded-lg border border-zinc-700"
              >
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-2">
                    {getSecretTypeIcon(secret.secretType)}
                    <div>
                      <p className="font-medium text-white flex items-center gap-2">
                        {getServiceDisplayName(secret.serviceName)}
                        {secret.encryptionStatus === 'fallback' && (
                          <span className="text-xs px-2 py-1 bg-yellow-900 text-yellow-200 rounded">
                            FALLBACK
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-zinc-400">
                        {secret.secretType.replace('_', ' ')} • Created {formatDate(secret.createdAt)}
                      </p>
                      {secret.description && (
                        <p className="text-xs text-zinc-500 mt-1">{secret.description}</p>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  {secret.expiresAt && (
                    <span className="text-xs px-2 py-1 bg-yellow-900 text-yellow-200 rounded">
                      Expires {formatDate(secret.expiresAt)}
                    </span>
                  )}
                  <span className={`text-xs px-2 py-1 rounded ${
                    secret.isActive 
                      ? 'bg-green-900 text-green-200' 
                      : 'bg-red-900 text-red-200'
                  }`}>
                    {secret.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-zinc-600 text-zinc-300 hover:bg-zinc-700"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(secret.id)}
                    className="border-red-600 text-red-400 hover:bg-red-900"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}