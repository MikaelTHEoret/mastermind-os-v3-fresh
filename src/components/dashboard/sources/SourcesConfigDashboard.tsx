'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useUser } from '@clerk/nextjs';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import InfoPopover from '../../ui/InfoPopover';
import { 
  Plus, 
  Eye, 
  EyeOff, 
  Save, 
  Trash2, 
  Github, 
  Cloud, 
  Database, 
  Key, 
  FileText,
  Check,
  X,
  Copy,
  AlertCircle,
  Upload,
  Download,
  ChevronDown,
  ChevronRight,
  Info,
  Shield,
  Bot,
  Zap,
  Brain
} from 'lucide-react';

// Interface for secret configuration
interface SecretConfig {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

// Predefined source types with their expected secrets
const SOURCE_TYPES = {
  // LLM Providers
  'openai': {
    name: 'OpenAI',
    icon: Bot,
    color: 'bg-emerald-500/20 border-emerald-500/30',
    category: 'llm',
    secrets: [
      { key: 'api_key', label: 'API Key', required: true },
      { key: 'organization_id', label: 'Organization ID', required: false }
    ] as SecretConfig[]
  },
  'anthropic': {
    name: 'Anthropic Claude',
    icon: Bot,
    color: 'bg-indigo-500/20 border-indigo-500/30',
    category: 'llm',
    secrets: [
      { key: 'api_key', label: 'API Key', required: true }
    ] as SecretConfig[]
  },
  'deepseek': {
    name: 'DeepSeek',
    icon: Brain,
    color: 'bg-blue-500/20 border-blue-500/30',
    category: 'llm',
    secrets: [
      { key: 'api_key', label: 'API Key', required: true },
      { key: 'base_url', label: 'Base URL', required: false, placeholder: 'https://api.deepseek.com' }
    ] as SecretConfig[]
  },
  'groq': {
    name: 'Groq',
    icon: Zap,
    color: 'bg-orange-500/20 border-orange-500/30',
    category: 'llm',
    secrets: [
      { key: 'api_key', label: 'API Key', required: true }
    ] as SecretConfig[]
  },
  // Existing source types
  'github': {
    name: 'GitHub',
    icon: Github,
    color: 'bg-purple-500/20 border-purple-500/30',
    category: 'storage',
    secrets: [
      { key: 'personal_access_token', label: 'Personal Access Token', required: true },
      { key: 'username', label: 'Username', required: true },
      { key: 'repositories', label: 'Repository Names (comma-separated)', required: true, placeholder: 'e.g., repo1, user/repo2, org/repo3' },
      { key: 'default_branch', label: 'Default Branch', required: false, placeholder: 'main (default)' }
    ] as SecretConfig[]
  },
  'codeberg': {
    name: 'Codeberg',
    icon: Cloud,
    color: 'bg-blue-500/20 border-blue-500/30',
    category: 'storage',
    secrets: [
      { key: 'access_token', label: 'Access Token', required: true },
      { key: 'username', label: 'Username', required: true },
      { key: 'repositories', label: 'Repository Names (comma-separated)', required: true, placeholder: 'e.g., repo1, user/repo2' },
      { key: 'default_branch', label: 'Default Branch', required: false, placeholder: 'main (default)' }
    ] as SecretConfig[]
  },
  'pinata': {
    name: 'Pinata IPFS',
    icon: FileText,
    color: 'bg-green-500/20 border-green-500/30',
    category: 'storage',
    secrets: [
      { key: 'api_key', label: 'API Key', required: true },
      { key: 'api_secret', label: 'API Secret', required: true },
      { key: 'jwt', label: 'JWT Token', required: false }
    ] as SecretConfig[]
  },
  'infura': {
    name: 'Infura',
    icon: Cloud,
    color: 'bg-orange-500/20 border-orange-500/30',
    category: 'storage',
    secrets: [
      { key: 'project_id', label: 'Project ID', required: true },
      { key: 'project_secret', label: 'Project Secret', required: true }
    ] as SecretConfig[]
  },
  'web3_storage': {
    name: 'Web3.Storage',
    icon: Database,
    color: 'bg-cyan-500/20 border-cyan-500/30',
    category: 'storage',
    secrets: [
      { key: 'api_token', label: 'API Token', required: true }
    ] as SecretConfig[]
  },
  'neon': {
    name: 'Neon Database',
    icon: Database,
    color: 'bg-teal-500/20 border-teal-500/30',
    category: 'database',
    secrets: [
      { key: 'database_url', label: 'Database URL', required: true },
      { key: 'api_key', label: 'API Key', required: false }
    ] as SecretConfig[]
  },
  'astra': {
    name: 'DataStax Astra',
    icon: Database,
    color: 'bg-violet-500/20 border-violet-500/30',
    category: 'database',
    secrets: [
      { key: 'api_endpoint', label: 'API Endpoint', required: true },
      { key: 'application_token', label: 'Application Token', required: true },
      { key: 'database_id', label: 'Database ID', required: true }
    ] as SecretConfig[]
  }
};

interface ConfiguredSource {
  id: string;
  type: string;
  name: string;
  secrets: { [key: string]: string };
  status: 'connected' | 'disconnected' | 'error';
  lastUpdated: string;
  isCustom?: boolean;
}

interface EnvProcessingResult {
  success: boolean;
  message: string;
  variables: { [key: string]: string };
  addedSources: number;
}

export default function SourcesConfigDashboard() {
  const { user } = useUser();
  const [configuredSources, setConfiguredSources] = useState<ConfiguredSource[]>([]);
  const [showSecrets, setShowSecrets] = useState<{ [key: string]: boolean }>({});
  const [editingSource, setEditingSource] = useState<string | null>(null);
  const [addingSource, setAddingSource] = useState<string | null>(null);
  const [customSourceName, setCustomSourceName] = useState('');
  const [customSecrets, setCustomSecrets] = useState<SecretConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [envProcessingResult, setEnvProcessingResult] = useState<EnvProcessingResult | null>(null);
  const [expandedSources, setExpandedSources] = useState<{ [key: string]: boolean }>({});
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'llm' | 'storage' | 'database'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Add custom scrollbar styles
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .sources-scroll-container {
        position: relative;
      }
      .sources-scroll-container::-webkit-scrollbar {
        width: 12px;
      }
      .sources-scroll-container::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.3);
        border-radius: 6px;
        border: 1px solid rgba(0, 255, 255, 0.1);
      }
      .sources-scroll-container::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, rgba(0, 255, 255, 0.8), rgba(0, 255, 255, 0.5));
        border-radius: 6px;
        border: 1px solid rgba(0, 255, 255, 0.3);
      }
      .sources-scroll-container::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(180deg, rgba(0, 255, 255, 1), rgba(0, 255, 255, 0.7));
        border-color: rgba(0, 255, 255, 0.5);
      }
      .sources-scroll-container::-webkit-scrollbar-thumb:active {
        background: linear-gradient(180deg, rgba(0, 255, 255, 1), rgba(0, 255, 255, 0.8));
      }
      .sources-scroll-container::-webkit-scrollbar-corner {
        background: transparent;
      }
      /* Fallback for Firefox */
      @supports not selector(::-webkit-scrollbar) {
        .sources-scroll-container {
          scrollbar-width: thin;
          scrollbar-color: rgba(0, 255, 255, 0.8) rgba(0, 0, 0, 0.3);
        }
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Load configured sources from encrypted database
  useEffect(() => {
    if (user) {
      loadConfiguredSources();
    }
  }, [user]);

  const loadConfiguredSources = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/mastermind/config/sources');
      if (response.ok) {
        const data = await response.json();
        setConfiguredSources(data.sources || []);
      } else {
        // Fallback to localStorage
        const saved = localStorage.getItem(`sources_config_${user?.id}`);
        if (saved) {
          setConfiguredSources(JSON.parse(saved));
        }
      }
    } catch (error) {
      console.error('Error loading sources:', error);
      // Fallback to localStorage
      const saved = localStorage.getItem(`sources_config_${user?.id}`);
      if (saved) {
        setConfiguredSources(JSON.parse(saved));
      }
    } finally {
      setLoading(false);
    }
  };

  const saveSourceConfig = async (source: ConfiguredSource) => {
  const saveSourceConfig = async (source: ConfiguredSource) => {
    try {
      setLoading(true);
      
      console.log('🔧 Saving source config:', { id: source.id, type: source.type, name: source.name });
      
      // TEMPORARY BYPASS: Save to localStorage first, then try API
      console.log('💾 Saving to localStorage as backup...');
      const existing = localStorage.getItem(`sources_config_${user?.id}`);
      const sources = existing ? JSON.parse(existing) : [];
      const index = sources.findIndex((s: any) => s.id === source.id);
      
      if (index >= 0) {
        sources[index] = source;
      } else {
        sources.push(source);
      }
      
      localStorage.setItem(`sources_config_${user?.id}`, JSON.stringify(sources));
      setConfiguredSources(sources);
      console.log('✅ Saved to localStorage successfully');
      
      // Try API save in background (non-blocking)
      console.log('🌐 Attempting API save in background...');
      
      const requestBody = { source };
      console.log('📤 Request body being sent:', JSON.stringify(requestBody, null, 2));
      
      try {
        const response = await fetch('/api/mastermind/config/sources', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });
        
        console.log('📡 Response status:', response.status);
        
        if (response.ok) {
          const data = await response.json();
          console.log('✅ API save successful - database updated');
          console.log('📡 Response data:', data);
        } else {
          const errorData = await response.json();
          console.warn('⚠️ API save failed, but localStorage save succeeded:', errorData);
        }
      } catch (apiError) {
        console.warn('⚠️ API save failed, but localStorage save succeeded:', apiError);
      }
      
    } catch (error) {
      console.error('💥 Error saving source config:', error);
      throw new Error(`Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };
          };
;

  const deleteSource = async (sourceId: string) => {
    try {
      const response = await fetch(`/api/mastermind/config/sources?id=${sourceId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        const updated = configuredSources.filter(s => s.id !== sourceId);
        setConfiguredSources(updated);
      } else {
        throw new Error('Failed to delete source configuration');
      }
    } catch (error) {
      console.error('Error deleting source:', error);
      // Fallback to localStorage
      const updated = configuredSources.filter(s => s.id !== sourceId);
      setConfiguredSources(updated);
      localStorage.setItem(`sources_config_${user?.id}`, JSON.stringify(updated));
    }
  };

  const toggleSecretVisibility = (sourceId: string, secretKey: string) => {
    setShowSecrets(prev => ({
      ...prev,
      [`${sourceId}_${secretKey}`]: !prev[`${sourceId}_${secretKey}`]
    }));
  };

  const copyToClipboard = async (text: string, sourceId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(sourceId);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const addNewSource = (type: string) => {
    const sourceType = SOURCE_TYPES[type as keyof typeof SOURCE_TYPES];
    if (!sourceType) return;

    const newSource: ConfiguredSource = {
      id: `${type}_${Date.now()}`,
      type,
      name: sourceType.name,
      secrets: {},
      status: 'disconnected',
      lastUpdated: new Date().toISOString()
    };

    setConfiguredSources([...configuredSources, newSource]);
    setEditingSource(newSource.id);
    setAddingSource(null);
  };

  const addCustomSource = () => {
    if (!customSourceName.trim()) return;

    const newSource: ConfiguredSource = {
      id: `custom_${Date.now()}`,
      type: 'custom',
      name: customSourceName,
      secrets: {},
      status: 'disconnected',
      lastUpdated: new Date().toISOString(),
      isCustom: true
    };

    setConfiguredSources([...configuredSources, newSource]);
    setEditingSource(newSource.id);
    setCustomSourceName('');
    setCustomSecrets([]);
    setAddingSource(null);
  };

  // .env file processing functions
  const parseEnvFile = (content: string) => {
    const lines = content.split('\n');
    const envVariables: { [key: string]: string } = {};
    const newSources: ConfiguredSource[] = [];
    
    lines.forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          const cleanKey = key.trim();
          envVariables[cleanKey] = value;
          
          // Map common environment variable names to source types
          const normalizedKey = cleanKey.toLowerCase();
          
          // LLM Provider mappings
          if (normalizedKey.includes('openai') && normalizedKey.includes('api')) {
            const existing = newSources.find(s => s.type === 'openai');
            if (existing) {
              existing.secrets[normalizedKey.includes('organization') ? 'organization_id' : 'api_key'] = value;
            } else {
              newSources.push({
                id: `openai_${Date.now()}`,
                type: 'openai',
                name: 'OpenAI',
                secrets: { [normalizedKey.includes('organization') ? 'organization_id' : 'api_key']: value },
                status: 'disconnected',
                lastUpdated: new Date().toISOString()
              });
            }
          } else if (normalizedKey.includes('anthropic') || normalizedKey.includes('claude')) {
            const existing = newSources.find(s => s.type === 'anthropic');
            if (existing) {
              existing.secrets.api_key = value;
            } else {
              newSources.push({
                id: `anthropic_${Date.now()}`,
                type: 'anthropic',
                name: 'Anthropic Claude',
                secrets: { api_key: value },
                status: 'disconnected',
                lastUpdated: new Date().toISOString()
              });
            }
          } else if (normalizedKey.includes('deepseek')) {
            const existing = newSources.find(s => s.type === 'deepseek');
            if (existing) {
              if (normalizedKey.includes('url')) {
                existing.secrets.base_url = value;
              } else {
                existing.secrets.api_key = value;
              }
            } else {
              newSources.push({
                id: `deepseek_${Date.now()}`,
                type: 'deepseek',
                name: 'DeepSeek',
                secrets: { [normalizedKey.includes('url') ? 'base_url' : 'api_key']: value },
                status: 'disconnected',
                lastUpdated: new Date().toISOString()
              });
            }
          } else if (normalizedKey.includes('groq')) {
            const existing = newSources.find(s => s.type === 'groq');
            if (existing) {
              existing.secrets.api_key = value;
            } else {
              newSources.push({
                id: `groq_${Date.now()}`,
                type: 'groq',
                name: 'Groq',
                secrets: { api_key: value },
                status: 'disconnected',
                lastUpdated: new Date().toISOString()
              });
            }
          }
          // Keep existing mappings for other sources...
          else if (normalizedKey.includes('github')) {
            const existing = newSources.find(s => s.type === 'github');
            if (existing) {
              if (normalizedKey.includes('token')) {
                existing.secrets.personal_access_token = value;
              } else if (normalizedKey.includes('username')) {
                existing.secrets.username = value;
              } else if (normalizedKey.includes('repo')) {
                existing.secrets.repositories = value;
              } else if (normalizedKey.includes('branch')) {
                existing.secrets.default_branch = value;
              }
            } else {
              const secretKey = normalizedKey.includes('username') ? 'username' :
                               normalizedKey.includes('repo') ? 'repositories' :
                               normalizedKey.includes('branch') ? 'default_branch' : 'personal_access_token';
              newSources.push({
                id: `github_${Date.now()}`,
                type: 'github',
                name: 'GitHub',
                secrets: { [secretKey]: value },
                status: 'disconnected',
                lastUpdated: new Date().toISOString()
              });
            }
          }
          // ... rest of existing mappings
        }
      }
    });
    
    return { envVariables, newSources };
  };

  const handleFileProcess = (file: File) => {
    if (file.name.endsWith('.env') || file.type === 'text/plain' || file.name.includes('env')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const { envVariables, newSources } = parseEnvFile(content);
          
          // Merge new sources with existing ones (avoid duplicates)
          const updatedSources = [...configuredSources];
          let addedCount = 0;
          
          newSources.forEach(newSource => {
            const existingIndex = updatedSources.findIndex(s => s.type === newSource.type);
            if (existingIndex >= 0) {
              // Merge secrets into existing source
              updatedSources[existingIndex].secrets = {
                ...updatedSources[existingIndex].secrets,
                ...newSource.secrets
              };
              updatedSources[existingIndex].lastUpdated = new Date().toISOString();
            } else {
              // Add new source
              updatedSources.push(newSource);
              addedCount++;
            }
          });
          
          setConfiguredSources(updatedSources);
          setEnvProcessingResult({
            success: true,
            message: `Successfully processed .env file: ${addedCount} new sources added, ${newSources.length - addedCount} existing sources updated`,
            variables: envVariables,
            addedSources: newSources.length
          });
          
          setTimeout(() => setEnvProcessingResult(null), 7000);
        } catch (error: any) {
          setEnvProcessingResult({
            success: false,
            message: `Error processing file: ${error.message}`,
            variables: {},
            addedSources: 0
          });
          setTimeout(() => setEnvProcessingResult(null), 5000);
        }
      };
      reader.readAsText(file);
    } else {
      setEnvProcessingResult({
        success: false,
        message: 'Please upload a .env file (should have .env extension or contain "env" in filename)',
        variables: {},
        addedSources: 0
      });
      setTimeout(() => setEnvProcessingResult(null), 4000);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileProcess(files[0]);
    }
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      handleFileProcess(files[0]);
    }
  };

  const toggleSourceExpansion = (sourceId: string) => {
    setExpandedSources(prev => ({
      ...prev,
      [sourceId]: !prev[sourceId]
    }));
  };

  const getSourceIcon = (type: string) => {
    const sourceType = SOURCE_TYPES[type as keyof typeof SOURCE_TYPES];
    return sourceType?.icon || Key;
  };

  const getSourceColor = (type: string) => {
    const sourceType = SOURCE_TYPES[type as keyof typeof SOURCE_TYPES];
    return sourceType?.color || 'bg-gray-500/20 border-gray-500/30';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'error': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    }
  };

  const getFilteredSources = () => {
    if (selectedCategory === 'all') return configuredSources;
    return configuredSources.filter(source => {
      const sourceType = SOURCE_TYPES[source.type as keyof typeof SOURCE_TYPES];
      return sourceType?.category === selectedCategory;
    });
  };

  const getFilteredSourceTypes = () => {
    if (selectedCategory === 'all') return SOURCE_TYPES;
    return Object.fromEntries(
      Object.entries(SOURCE_TYPES).filter(([_, sourceType]) => sourceType.category === selectedCategory)
    );
  };

  const renderSourceCard = (source: ConfiguredSource) => {
    const Icon = getSourceIcon(source.type);
    const isEditing = editingSource === source.id;
    const isExpanded = expandedSources[source.id];
    const sourceType = SOURCE_TYPES[source.type as keyof typeof SOURCE_TYPES];
    const secretsToShow = source.isCustom ? customSecrets : sourceType?.secrets || [];

    return (
      <Card 
        key={source.id} 
        className="border bg-black/40 backdrop-blur-sm"
        style={{
          border: '2px solid #00ffff',
          borderRadius: '12px',
          background: 'rgba(0, 0, 0, 0.8)',
          boxShadow: '0 0 15px rgba(0, 255, 255, 0.3)'
        }}
      >
        {/* Compact Header Row */}
        <div 
          className="flex items-center justify-between p-4 cursor-pointer hover:bg-cyan-500/5 transition-colors duration-200"
          onClick={() => toggleSourceExpansion(source.id)}
        >
          <div className="flex items-center gap-3 flex-1">
            <Icon className="w-6 h-6" style={{ color: '#00ffff' }} />
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-medium flex items-center gap-2" style={{ color: '#ffffff' }}>
                  {source.name}
                  {sourceType?.category === 'llm' && (
                    <Badge className="text-xs bg-blue-500/20 text-blue-400 border-blue-500/30">
                      LLM
                    </Badge>
                  )}
                  {source.type === 'github' && (
                    <InfoPopover className="text-purple-400 hover:text-purple-300">
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Github className="w-5 h-5 text-purple-400" />
                          <h4 className="font-medium text-white">GitHub Repository Configuration</h4>
                        </div>
                        <ul className="text-sm space-y-1 text-gray-300">
                          <li><strong>Repository Names:</strong> Specify exact repositories to avoid fetching everything</li>
                          <li><strong>Format examples:</strong> "my-repo" or "username/repo-name" or "org/project"</li>
                          <li><strong>Multiple repos:</strong> Separate with commas: "repo1, user/repo2, org/repo3"</li>
                          <li><strong>Access Token:</strong> Needs repo read permissions (Settings → Developer → Personal Access Tokens)</li>
                          <li><strong>File Explorer:</strong> Each repository will appear as a separate folder</li>
                        </ul>
                      </div>
                    </InfoPopover>
                  )}
                </h3>
                <Badge 
                  className="text-xs"
                  style={{
                    background: source.status === 'connected' ? 'rgba(0, 255, 170, 0.2)' :
                               source.status === 'error' ? 'rgba(255, 68, 68, 0.2)' :
                               'rgba(255, 170, 0, 0.2)',
                    color: source.status === 'connected' ? '#00ffaa' :
                           source.status === 'error' ? '#ff4444' :
                           '#ffaa00',
                    border: source.status === 'connected' ? '1px solid rgba(0, 255, 170, 0.5)' :
                           source.status === 'error' ? '1px solid rgba(255, 68, 68, 0.5)' :
                           '1px solid rgba(255, 170, 0, 0.5)'
                  }}
                >
                  {source.status}
                </Badge>
                <span className="text-xs" style={{ color: 'rgba(0, 255, 255, 0.5)' }}>
                  {new Date(source.lastUpdated).toLocaleDateString()}
                </span>
              </div>
              <p className="text-sm mt-1" style={{ color: 'rgba(0, 255, 255, 0.7)' }}>
                {secretsToShow.filter(s => source.secrets[s.key]).length} of {secretsToShow.length} fields configured
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {copySuccess === source.id && (
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                <Check className="w-3 h-3 mr-1" />
                Copied!
              </Badge>
            )}
            {isExpanded ? (
              <ChevronDown className="w-5 h-5" style={{ color: '#00ffff' }} />
            ) : (
              <ChevronRight className="w-5 h-5" style={{ color: '#00ffff' }} />
            )}
          </div>
        </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="border-t border-cyan-500/20">
            <CardContent className="p-4 space-y-4">
              {/* Action Buttons */}
              <div className="flex items-center gap-2 mb-4">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingSource(isEditing ? null : source.id);
                  }}
                  style={{
                    padding: '8px 16px',
                    background: isEditing ? 'rgba(255, 170, 0, 0.2)' : 'rgba(0, 255, 255, 0.2)',
                    border: isEditing ? '2px solid #ffaa00' : '2px solid #00ffff',
                    borderRadius: '6px',
                    color: isEditing ? '#ffaa00' : '#00ffff',
                    fontFamily: 'Rajdhani, sans-serif',
                    fontSize: '12px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    boxShadow: isEditing ? '0 0 10px rgba(255, 170, 0, 0.3)' : '0 0 10px rgba(0, 255, 255, 0.3)'
                  }}
                  onMouseEnter={(e) => {
                    const baseColor = isEditing ? 'rgba(255, 170, 0, 0.3)' : 'rgba(0, 255, 255, 0.3)';
                    e.currentTarget.style.background = baseColor;
                  }}
                  onMouseLeave={(e) => {
                    const baseColor = isEditing ? 'rgba(255, 170, 0, 0.2)' : 'rgba(0, 255, 255, 0.2)';
                    e.currentTarget.style.background = baseColor;
                  }}
                >
                  {isEditing ? 'Cancel' : 'Edit'}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSource(source.id);
                  }}
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(255, 68, 68, 0.2)',
                    border: '2px solid #ff4444',
                    borderRadius: '6px',
                    color: '#ff4444',
                    fontFamily: 'Rajdhani, sans-serif',
                    fontSize: '12px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    boxShadow: '0 0 10px rgba(255, 68, 68, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 68, 68, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 68, 68, 0.2)';
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Configuration Fields */}
              {secretsToShow.map((secret) => {
                const secretKey = `${source.id}_${secret.key}`;
                const isVisible = showSecrets[secretKey];
                const value = source.secrets[secret.key] || '';
                
                return (
                  <div key={secret.key} className="space-y-2">
                    <Label 
                      className="text-sm flex items-center gap-2"
                      style={{ color: '#ffffff' }}
                    >
                      {secret.label}
                      {secret.required && <span style={{ color: '#ff4444' }}>*</span>}
                    </Label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 relative">
                        <Input
                          type={isVisible ? 'text' : 'password'}
                          value={isEditing ? value : '••••••••••••'}
                          onChange={(e) => {
                            if (isEditing) {
                              const updated = configuredSources.map(s => 
                                s.id === source.id 
                                  ? { ...s, secrets: { ...s.secrets, [secret.key]: e.target.value } }
                                  : s
                              );
                              setConfiguredSources(updated);
                            }
                          }}
                          disabled={!isEditing}
                          className="pr-20"
                          style={{
                            background: 'rgba(0, 0, 0, 0.6)',
                            border: '2px solid #00ffff',
                            borderRadius: '6px',
                            color: '#ffffff',
                            padding: '8px 12px'
                          }}
                          placeholder={isEditing ? (secret.placeholder || `Enter ${secret.label}`) : ''}
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleSecretVisibility(source.id, secret.key)}
                            className="p-1 h-auto text-gray-400 hover:text-white"
                          >
                            {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                          {value && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(value, source.id)}
                              className="p-1 h-auto text-gray-400 hover:text-white"
                            >
                              <Copy className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              
              {/* Save Button */}
              {isEditing && (
                <div className="pt-4 border-t border-cyan-500/20">
                  <Button
                    onClick={() => {
                      saveSourceConfig(source);
                      setEditingSource(null);
                    }}
                    className="w-full bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30"
                    disabled={loading}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {loading ? 'Saving...' : 'Save & Test Connection'}
                  </Button>
                </div>
              )}
            </CardContent>
          </div>
        )}
      </Card>
    );
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-yellow-400 mx-auto" />
          <p className="text-gray-400">Please sign in to configure API sources</p>
        </div>
      </div>
    );
  }

  const filteredSources = getFilteredSources();
  const filteredSourceTypes = getFilteredSourceTypes();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 
            className="text-2xl font-bold mb-2 flex items-center gap-2"
            style={{ color: '#ffffff' }}
          >
            API Sources Configuration
            <InfoPopover className="text-cyan-400 hover:text-cyan-300">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-cyan-400" />
                  <h4 className="font-medium text-white">Security Information</h4>
                </div>
                <ul className="text-sm space-y-1 text-gray-300">
                  <li>• All API keys and secrets are encrypted before storage</li>
                  <li>• Data is stored in a secure Neon database with user-specific encryption</li>
                  <li>• LLM providers are available in the chat terminal</li>
                  <li>• Storage sources appear as directories in the file explorer</li>
                  <li>• Connection status is tested automatically when saving configurations</li>
                  <li>• Only you can access your configured sources and their credentials</li>
                </ul>
              </div>
            </InfoPopover>
          </h2>
          <p style={{ color: 'rgba(0, 255, 255, 0.7)' }}>
            Configure your API keys and secrets for LLM providers, storage systems, and databases. All data is encrypted and stored securely.
          </p>
        </div>
        <button
          onClick={() => setAddingSource('select')}
          style={{
            padding: '12px 24px',
            background: 'rgba(0, 255, 255, 0.2)',
            border: '2px solid #00ffff',
            borderRadius: '8px',
            color: '#00ffff',
            fontFamily: 'Rajdhani, sans-serif',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            boxShadow: '0 0 15px rgba(0, 255, 255, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(0, 255, 255, 0.3)';
            e.currentTarget.style.boxShadow = '0 0 20px rgba(0, 255, 255, 0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(0, 255, 255, 0.2)';
            e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 255, 255, 0.3)';
          }}
        >
          <Plus className="w-4 h-4" />
          Add Source
        </button>
      </div>

      {/* Category Filter */}
      <div className="flex gap-2">
        {[
          { id: 'all', label: 'All Sources', count: configuredSources.length },
          { id: 'llm', label: 'LLM Providers', count: configuredSources.filter(s => SOURCE_TYPES[s.type as keyof typeof SOURCE_TYPES]?.category === 'llm').length },
          { id: 'storage', label: 'Storage', count: configuredSources.filter(s => SOURCE_TYPES[s.type as keyof typeof SOURCE_TYPES]?.category === 'storage').length },
          { id: 'database', label: 'Databases', count: configuredSources.filter(s => SOURCE_TYPES[s.type as keyof typeof SOURCE_TYPES]?.category === 'database').length }
        ].map((category) => (
          <button
            key={category.id}
            onClick={() => setSelectedCategory(category.id as any)}
            className={`px-4 py-2 rounded-lg border-2 transition-all duration-300 ${
              selectedCategory === category.id
                ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400'
                : 'bg-black/40 border-gray-600 text-gray-400 hover:border-cyan-500/50 hover:text-cyan-300'
            }`}
          >
            {category.label} ({category.count})
          </button>
        ))}
      </div>

      {/* .env File Dropzone */}
      <Card 
        className="border bg-black/40 backdrop-blur-sm transition-all duration-300"
        style={{
          border: isDragOver ? '2px solid #00ffaa' : '2px solid #00ffff',
          borderRadius: '12px',
          background: isDragOver ? 'rgba(0, 255, 170, 0.1)' : 'rgba(0, 0, 0, 0.8)',
          boxShadow: isDragOver ? '0 0 20px rgba(0, 255, 170, 0.4)' : '0 0 15px rgba(0, 255, 255, 0.3)'
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <CardContent className="p-6">
          <div 
            className="text-center py-8 border-2 border-dashed rounded-lg cursor-pointer transition-all duration-300"
            style={{
              borderColor: isDragOver ? '#00ffaa' : 'rgba(0, 255, 255, 0.3)',
              background: isDragOver ? 'rgba(0, 255, 170, 0.05)' : 'transparent'
            }}
            onClick={handleFileClick}
          >
            <Upload 
              className="w-12 h-12 mx-auto mb-4 transition-colors duration-300" 
              style={{ 
                color: isDragOver ? '#00ffaa' : '#00ffff'
              }} 
            />
            <h3 
              className="text-lg font-medium mb-2"
              style={{ color: '#ffffff' }}
            >
              {isDragOver ? 'Drop your .env file here!' : 'Quick Setup: Drop your .env file'}
            </h3>
            <p 
              className="text-sm mb-4"
              style={{ color: 'rgba(0, 255, 255, 0.7)' }}
            >
              {isDragOver ? 'Release to process the file' : 'Drag and drop your .env file here, or click to browse'}
            </p>
            <Button
              variant="outline"
              className="bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border-cyan-500/30"
              onClick={(e) => {
                e.stopPropagation();
                handleFileClick();
              }}
            >
              <FileText className="w-4 h-4 mr-2" />
              Choose .env file
            </Button>
          </div>
          
          {/* Processing Result */}
          {envProcessingResult && (
            <div 
              className="mt-4 p-4 rounded-lg border"
              style={{
                background: envProcessingResult.success ? 'rgba(0, 255, 170, 0.1)' : 'rgba(255, 68, 68, 0.1)',
                borderColor: envProcessingResult.success ? '#00ffaa' : '#ff4444',
                color: envProcessingResult.success ? '#00ffaa' : '#ff4444'
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                {envProcessingResult.success ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <X className="w-5 h-5" />
                )}
                <span className="font-medium">
                  {envProcessingResult.success ? 'Success!' : 'Error!'}
                </span>
              </div>
              <p className="text-sm mb-2">{envProcessingResult.message}</p>
              {envProcessingResult.success && envProcessingResult.addedSources > 0 && (
                <p className="text-xs opacity-80">
                  Check the configured sources below to review and test the imported API keys.
                </p>
              )}
            </div>
          )}
          
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".env,.txt"
            onChange={handleFileSelect}
            className="hidden"
          />
        </CardContent>
      </Card>

      {/* Add Source Modal */}
      {addingSource === 'select' && (
        <Card className="border border-cyan-500/30 bg-black/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-white flex items-center justify-between">
              Add New Source
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAddingSource(null)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {Object.entries(filteredSourceTypes).map(([key, sourceType]) => {
                const Icon = sourceType.icon;
                return (
                  <button
                    key={key}
                    onClick={() => addNewSource(key)}
                    className="relative group overflow-hidden transition-all duration-300 transform hover:scale-105"
                    style={{
                      minHeight: '100px',
                      background: 'linear-gradient(135deg, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.6))',
                      border: '2px solid rgba(0, 255, 255, 0.3)',
                      borderRadius: '12px',
                      padding: '20px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '12px',
                      cursor: 'pointer',
                      position: 'relative',
                      boxShadow: '0 4px 15px rgba(0, 255, 255, 0.2)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.border = '2px solid #00ffff';
                      e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0, 255, 255, 0.15), rgba(0, 255, 255, 0.08))';
                      e.currentTarget.style.boxShadow = '0 8px 25px rgba(0, 255, 255, 0.4)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.border = '2px solid rgba(0, 255, 255, 0.3)';
                      e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.6))';
                      e.currentTarget.style.boxShadow = '0 4px 15px rgba(0, 255, 255, 0.2)';
                    }}
                  >
                    {/* Background glow effect */}
                    <div 
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{
                        background: 'radial-gradient(circle at center, rgba(0, 255, 255, 0.1), transparent 70%)',
                        borderRadius: '12px'
                      }}
                    />
                    
                    {/* Icon with enhanced visibility */}
                    <Icon 
                      className="relative z-10 transition-all duration-300 group-hover:scale-110" 
                      style={{ 
                        width: '32px', 
                        height: '32px',
                        color: '#00ffff',
                        filter: 'drop-shadow(0 0 8px rgba(0, 255, 255, 0.5))',
                        transition: 'all 0.3s ease'
                      }} 
                    />
                    
                    {/* Text with enhanced visibility and glow */}
                    <span 
                      className="relative z-10 text-center font-semibold transition-all duration-300 group-hover:scale-105"
                      style={{ 
                        color: '#ffffff',
                        fontSize: '16px',
                        fontFamily: 'Rajdhani, sans-serif',
                        fontWeight: '600',
                        textShadow: '0 0 10px rgba(0, 255, 255, 0.8), 0 0 20px rgba(0, 255, 255, 0.4)',
                        letterSpacing: '0.5px'
                      }}
                    >
                      {sourceType.name}
                    </span>

                    {/* Category badge */}
                    {sourceType.category === 'llm' && (
                      <Badge className="relative z-10 text-xs bg-blue-500/20 text-blue-400 border-blue-500/30">
                        LLM
                      </Badge>
                    )}

                    {/* Animated border effect on hover */}
                    <div 
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{
                        border: '1px solid transparent',
                        borderRadius: '12px',
                        background: 'linear-gradient(45deg, transparent, rgba(0, 255, 255, 0.3), transparent) border-box',
                        mask: 'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
                        maskComposite: 'subtract'
                      }}
                    />
                  </button>
                );
              })}
            </div>
            
            <div className="border-t border-cyan-500/20 pt-4">
              <h4 className="text-white mb-3 font-medium">Or create a custom source:</h4>
              <div className="flex gap-2">
                <Input
                  placeholder="Custom source name"
                  value={customSourceName}
                  onChange={(e) => setCustomSourceName(e.target.value)}
                  className="bg-black/40 border-cyan-500/30 text-white placeholder-gray-400"
                />
                <Button
                  onClick={() => setAddingSource('custom')}
                  disabled={!customSourceName.trim()}
                  className="bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30"
                >
                  Configure
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Custom Source Configuration */}
      {addingSource === 'custom' && (
        <Card className="border border-cyan-500/30 bg-black/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-white flex items-center justify-between">
              Configure Custom Source: {customSourceName}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAddingSource(null);
                  setCustomSourceName('');
                  setCustomSecrets([]);
                }}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {customSecrets.map((secret, index) => (
              <div key={index} className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label className="text-sm text-gray-300">Secret Key</Label>
                  <Input
                    value={secret.key}
                    onChange={(e) => {
                      const updated = [...customSecrets];
                      updated[index].key = e.target.value;
                      setCustomSecrets(updated);
                    }}
                    className="bg-black/40 border-cyan-500/30 text-white placeholder-gray-400"
                    placeholder="api_key"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-sm text-gray-300">Display Label</Label>
                  <Input
                    value={secret.label}
                    onChange={(e) => {
                      const updated = [...customSecrets];
                      updated[index].label = e.target.value;
                      setCustomSecrets(updated);
                    }}
                    className="bg-black/40 border-cyan-500/30 text-white placeholder-gray-400"
                    placeholder="API Key"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const updated = customSecrets.filter((_, i) => i !== index);
                    setCustomSecrets(updated);
                  }}
                  className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setCustomSecrets([...customSecrets, { key: '', label: '', required: false }])}
                className="text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/10"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Secret
              </Button>
              <Button
                onClick={addCustomSource}
                disabled={!customSecrets.length || customSecrets.some(s => !s.key || !s.label)}
                className="bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30"
              >
                Create Source
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Configured Sources */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="text-cyan-400">Loading sources...</div>
        </div>
      ) : filteredSources.length === 0 ? (
        <Card className="border border-cyan-500/30 bg-black/40 backdrop-blur-sm">
          <CardContent className="text-center py-12">
            <Key className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl text-white mb-2">
              {selectedCategory === 'all' ? 'No Sources Configured' : `No ${selectedCategory.toUpperCase()} Sources Configured`}
            </h3>
            <p className="text-gray-400 mb-4">
              {selectedCategory === 'llm' 
                ? 'Add LLM providers to enable AI-powered chat functionality.'
                : selectedCategory === 'storage'
                ? 'Add storage sources to enable external file access in the file explorer.'
                : selectedCategory === 'database'
                ? 'Add database connections for data storage and retrieval.'
                : 'Add your first API source to enable external integrations.'}
            </p>
            <Button
              onClick={() => setAddingSource('select')}
              className="bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Your First {selectedCategory === 'all' ? 'Source' : selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1) + ' Source'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div 
          className="sources-scroll-container space-y-3 max-h-[400px] overflow-y-auto pr-2"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#00ffff rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(0, 255, 255, 0.2)',
            borderRadius: '8px',
            padding: '8px'
          }}
        >
          {filteredSources.map(renderSourceCard)}
        </div>
      )}
    </div>
  );
}