'use client';

import React, { useState, useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  FolderOpen, 
  File, 
  Plus,
  Search,
  Cloud,
  Database,
  Github,
  Key,
  Settings,
  RefreshCw,
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';

interface FileSystemSource {
  id: string;
  name: string;
  type: 'local' | 'github' | 'codeberg' | 'pinata' | 'custom';
  status: 'connected' | 'disconnected' | 'error';
  icon: React.ComponentType<any>;
  color: string;
  files?: FileSystemItem[];
  loading?: boolean;
}

interface FileSystemItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  path: string;
  size?: number;
  lastModified?: string;
  children?: FileSystemItem[];
  expanded?: boolean;
}

const DEFAULT_SOURCES: FileSystemSource[] = [
  {
    id: 'local',
    name: '💾 Local Storage',
    type: 'local',
    status: 'connected',
    icon: Database,
    color: 'text-blue-400',
    files: [
      {
        id: 'local-1',
        name: 'Documents',
        type: 'folder',
        path: '/documents',
        children: [
          { id: 'local-1-1', name: 'scroll-draft.md', type: 'file', path: '/documents/scroll-draft.md', size: 1024 },
          { id: 'local-1-2', name: 'notes.txt', type: 'file', path: '/documents/notes.txt', size: 512 }
        ]
      },
      {
        id: 'local-2',
        name: 'Templates',
        type: 'folder',
        path: '/templates',
        children: [
          { id: 'local-2-1', name: 'scroll-template.json', type: 'file', path: '/templates/scroll-template.json', size: 2048 }
        ]
      }
    ]
  }
];

interface EnhancedFileExplorerProps {
  onFileSelect?: (file: FileSystemItem) => void;
  selectedFile?: FileSystemItem | null;
  className?: string;
}

export default function EnhancedFileExplorer({ onFileSelect, selectedFile, className = '' }: EnhancedFileExplorerProps) {
  const { user } = useUser();
  const [sources, setSources] = useState<FileSystemSource[]>(DEFAULT_SOURCES);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set(['local']));
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  // Load configured sources from the Sources Configuration Dashboard
  useEffect(() => {
    if (user) {
      loadConfiguredSources();
    }
  }, [user]);

  const loadConfiguredSources = async () => {
    try {
      setLoading(true);
      
      // Load from localStorage (TODO: replace with Neon database)
      const savedSources = localStorage.getItem(`sources_config_${user?.id}`);
      if (savedSources) {
        const configuredSources = JSON.parse(savedSources);
        
        // Convert configured sources to file system sources
        const additionalSources: FileSystemSource[] = configuredSources.map((source: any) => ({
          id: source.id,
          name: getSourceDisplayName(source.type, source.name),
          type: source.type,
          status: source.status,
          icon: getSourceIcon(source.type),
          color: getSourceColor(source.type),
          files: [],
          loading: false
        }));

        setSources([...DEFAULT_SOURCES, ...additionalSources]);
      }
    } catch (error) {
      console.error('Error loading configured sources:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSourceDisplayName = (type: string, name: string) => {
    const icons = {
      github: '🐙',
      codeberg: '🏔️',
      pinata: '🍍',
      web3_storage: '🌐',
      infura: '🔗',
      custom: '⚙️'
    };
    return `${icons[type as keyof typeof icons] || '📁'} ${name}`;
  };

  const getSourceIcon = (type: string) => {
    switch (type) {
      case 'github': return Github;
      case 'codeberg': return Cloud;
      case 'pinata': return Database;
      default: return Folder;
    }
  };

  const getSourceColor = (type: string) => {
    switch (type) {
      case 'github': return 'text-purple-400';
      case 'codeberg': return 'text-blue-400';
      case 'pinata': return 'text-green-400';
      case 'custom': return 'text-yellow-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected': return <CheckCircle className="w-3 h-3 text-green-400" />;
      case 'error': return <AlertCircle className="w-3 h-3 text-red-400" />;
      default: return <AlertCircle className="w-3 h-3 text-yellow-400" />;
    }
  };

  const toggleSource = async (sourceId: string) => {
    if (expandedSources.has(sourceId)) {
      setExpandedSources(prev => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    } else {
      setExpandedSources(prev => new Set(prev).add(sourceId));
      
      // Load files for this source if not already loaded
      const source = sources.find(s => s.id === sourceId);
      if (source && (!source.files || source.files.length === 0) && source.type !== 'local') {
        await loadSourceFiles(sourceId);
      }
    }
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const loadSourceFiles = async (sourceId: string) => {
    try {
      // Set loading state for this source
      setSources(prev => prev.map(source => 
        source.id === sourceId 
          ? { ...source, loading: true }
          : source
      ));

      const source = sources.find(s => s.id === sourceId);
      if (!source) return;

      // Load configured source credentials
      const savedSources = localStorage.getItem(`sources_config_${user?.id}`);
      const configuredSources = savedSources ? JSON.parse(savedSources) : [];
      const sourceConfig = configuredSources.find((s: any) => s.id === sourceId);

      if (!sourceConfig || sourceConfig.status !== 'connected') {
        throw new Error('Source not properly configured');
      }

      let files: FileSystemItem[] = [];

      switch (source.type) {
        case 'github':
          files = await loadGitHubFiles(sourceConfig);
          break;
        case 'pinata':
          files = await loadPinataFiles(sourceConfig);
          break;
        case 'codeberg':
          files = await loadCodebergFiles(sourceConfig);
          break;
        default:
          files = [];
      }

      setSources(prev => prev.map(s => 
        s.id === sourceId 
          ? { ...s, files, loading: false, status: 'connected' }
          : s
      ));
    } catch (error) {
      console.error(`Error loading files for source ${sourceId}:`, error);
      setSources(prev => prev.map(source => 
        source.id === sourceId 
          ? { ...source, loading: false, status: 'error' }
          : source
      ));
    }
  };

  const loadGitHubFiles = async (sourceConfig: any): Promise<FileSystemItem[]> => {
    const { personal_access_token, username, repositories } = sourceConfig.secrets;
    
    if (!repositories) {
      throw new Error('No repositories configured');
    }

    const repoList = repositories.split(',').map((repo: string) => repo.trim());
    const files: FileSystemItem[] = [];

    for (const repo of repoList) {
      try {
        // Determine full repo path
        const repoPath = repo.includes('/') ? repo : `${username}/${repo}`;
        
        // Fetch repository contents
        const response = await fetch(`https://api.github.com/repos/${repoPath}/contents`, {
          headers: {
            'Authorization': `token ${personal_access_token}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });

        if (!response.ok) {
          console.error(`Failed to fetch ${repoPath}: ${response.statusText}`);
          continue;
        }

        const contents = await response.json();
        
        // Create repository folder
        const repoFolder: FileSystemItem = {
          id: `github-${repoPath.replace('/', '-')}`,
          name: `📁 ${repo}`,
          type: 'folder',
          path: `/${repoPath}`,
          children: contents.map((item: any) => ({
            id: `github-${repoPath.replace('/', '-')}-${item.name}`,
            name: item.name,
            type: item.type === 'dir' ? 'folder' : 'file',
            path: `/${repoPath}/${item.name}`,
            size: item.size || 0,
            lastModified: new Date().toISOString()
          }))
        };

        files.push(repoFolder);
      } catch (error) {
        console.error(`Error loading repository ${repo}:`, error);
      }
    }

    return files;
  };

  const loadPinataFiles = async (sourceConfig: any): Promise<FileSystemItem[]> => {
    const { api_key, api_secret, jwt } = sourceConfig.secrets;
    
    try {
      // Use JWT if available, otherwise use API key/secret
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (jwt) {
        headers['Authorization'] = `Bearer ${jwt}`;
      } else if (api_key && api_secret) {
        headers['pinata_api_key'] = api_key;
        headers['pinata_secret_api_key'] = api_secret;
      } else {
        throw new Error('No valid Pinata credentials found');
      }

      // Fetch pinned files from Pinata
      const response = await fetch('https://api.pinata.cloud/data/pinList?status=pinned', {
        headers
      });

      if (!response.ok) {
        throw new Error(`Pinata API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Group files by type/folder structure
      const folders: { [key: string]: FileSystemItem[] } = {
        'Images': [],
        'Documents': [],
        'JSON': [],
        'Other': []
      };

      data.rows.forEach((item: any) => {
        const fileExtension = item.metadata?.name?.split('.').pop()?.toLowerCase() || '';
        let folderName = 'Other';

        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(fileExtension)) {
          folderName = 'Images';
        } else if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(fileExtension)) {
          folderName = 'Documents';
        } else if (fileExtension === 'json') {
          folderName = 'JSON';
        }

        const file: FileSystemItem = {
          id: `pinata-${item.ipfs_pin_hash}`,
          name: item.metadata?.name || `File-${item.ipfs_pin_hash.substring(0, 8)}`,
          type: 'file',
          path: `/ipfs/${item.ipfs_pin_hash}`,
          size: item.size,
          lastModified: item.date_pinned
        };

        folders[folderName].push(file);
      });

      // Convert folders to FileSystemItem format
      const files: FileSystemItem[] = Object.entries(folders)
        .filter(([_, items]) => items.length > 0)
        .map(([folderName, items]) => ({
          id: `pinata-folder-${folderName.toLowerCase()}`,
          name: `📁 ${folderName} (${items.length})`,
          type: 'folder',
          path: `/${folderName.toLowerCase()}`,
          children: items
        }));

      return files;
    } catch (error) {
      console.error('Error loading Pinata files:', error);
      throw error;
    }
  };

  const loadCodebergFiles = async (sourceConfig: any): Promise<FileSystemItem[]> => {
    const { access_token, username, repositories } = sourceConfig.secrets;
    
    if (!repositories) {
      throw new Error('No repositories configured');
    }

    const repoList = repositories.split(',').map((repo: string) => repo.trim());
    const files: FileSystemItem[] = [];

    for (const repo of repoList) {
      try {
        // Determine full repo path
        const repoPath = repo.includes('/') ? repo : `${username}/${repo}`;
        
        // Fetch repository contents from Codeberg
        const response = await fetch(`https://codeberg.org/api/v1/repos/${repoPath}/contents`, {
          headers: {
            'Authorization': `token ${access_token}`,
            'Accept': 'application/json'
          }
        });

        if (!response.ok) {
          console.error(`Failed to fetch ${repoPath}: ${response.statusText}`);
          continue;
        }

        const contents = await response.json();
        
        // Create repository folder
        const repoFolder: FileSystemItem = {
          id: `codeberg-${repoPath.replace('/', '-')}`,
          name: `📁 ${repo}`,
          type: 'folder',
          path: `/${repoPath}`,
          children: contents.map((item: any) => ({
            id: `codeberg-${repoPath.replace('/', '-')}-${item.name}`,
            name: item.name,
            type: item.type === 'dir' ? 'folder' : 'file',
            path: `/${repoPath}/${item.name}`,
            size: item.size || 0,
            lastModified: new Date().toISOString()
          }))
        };

        files.push(repoFolder);
      } catch (error) {
        console.error(`Error loading repository ${repo}:`, error);
      }
    }

    return files;
  };

  const handleFileSelect = (file: FileSystemItem) => {
    if (file.type === 'file' && onFileSelect) {
      onFileSelect(file);
    }
  };

  const renderFileSystemItem = (item: FileSystemItem, level: number = 0) => {
    const isExpanded = expandedFolders.has(item.id);
    const isSelected = selectedFile?.id === item.id;
    
    return (
      <div key={item.id}>
        <div
          className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-white/5 ${
            isSelected ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-300 hover:text-white'
          }`}
          style={{ paddingLeft: `${(level + 1) * 16}px` }}
          onClick={() => {
            if (item.type === 'folder') {
              toggleFolder(item.id);
            } else {
              handleFileSelect(item);
            }
          }}
        >
          {item.type === 'folder' && (
            <button className="p-0 text-inherit">
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          )}
          
          {item.type === 'folder' ? (
            isExpanded ? (
              <FolderOpen className="w-4 h-4" />
            ) : (
              <Folder className="w-4 h-4" />
            )
          ) : (
            <File className="w-4 h-4" />
          )}
          
          <span className="flex-1 text-sm">{item.name}</span>
          
          {item.size && (
            <span className="text-xs text-gray-400">
              {(item.size / 1024).toFixed(1)}KB
            </span>
          )}
        </div>
        
        {item.type === 'folder' && isExpanded && item.children && (
          <div>
            {item.children.map(child => renderFileSystemItem(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderSource = (source: FileSystemSource) => {
    const isExpanded = expandedSources.has(source.id);
    const Icon = source.icon;
    
    return (
      <div key={source.id} className="mb-2">
        <div
          className="flex items-center gap-2 py-2 px-2 rounded cursor-pointer hover:bg-white/5 text-gray-300 hover:text-white"
          onClick={() => toggleSource(source.id)}
        >
          <button className="p-0 text-inherit">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          
          <Icon className={`w-4 h-4 ${source.color}`} />
          
          <span className="flex-1 text-sm font-medium">{source.name}</span>
          
          {source.loading ? (
            <RefreshCw className="w-3 h-3 animate-spin text-gray-400" />
          ) : (
            getStatusIcon(source.status)
          )}
        </div>
        
        {isExpanded && source.files && (
          <div className="ml-2">
            {source.files.map(file => renderFileSystemItem(file, 0))}
          </div>
        )}

        {isExpanded && source.status === 'disconnected' && (
          <div className="ml-6 py-2">
            <p className="text-xs text-gray-400 mb-2">
              Source not configured. Set up API credentials in Dashboard → API Configuration
            </p>
            <Button
              variant="outline"
              size="sm"
              className="text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/10"
              onClick={(e) => {
                e.stopPropagation();
                // TODO: Navigate to sources configuration
                window.location.href = '/dashboard?tab=sources';
              }}
            >
              <Settings className="w-3 h-3 mr-1" />
              Configure
            </Button>
          </div>
        )}

        {isExpanded && source.status === 'error' && (
          <div className="ml-6 py-2">
            <p className="text-xs text-red-400 mb-2">
              Failed to load files. Check your API credentials.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/10"
                onClick={(e) => {
                  e.stopPropagation();
                  loadSourceFiles(source.id);
                }}
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Retry
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10"
                onClick={(e) => {
                  e.stopPropagation();
                  window.location.href = '/dashboard?tab=sources';
                }}
              >
                <Settings className="w-3 h-3 mr-1" />
                Fix Config
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Filter sources and files based on search query
  const filteredSources = sources.filter(source => 
    source.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (source.files && source.files.some(file => 
      file.name.toLowerCase().includes(searchQuery.toLowerCase())
    ))
  );

  return (
    <div className={`bg-black/30 backdrop-blur-sm border-r border-cyan-500/30 flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-cyan-500/20">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-medium text-sm">EXPLORER</h3>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadConfiguredSources()}
              className="p-1 text-gray-400 hover:text-white"
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="p-1 text-gray-400 hover:text-white"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-black/40 border-cyan-500/30 text-white placeholder-gray-400 text-sm"
          />
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-auto p-2">
        {filteredSources.length === 0 ? (
          <div className="text-center py-8">
            <Cloud className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">No sources found</p>
            <p className="text-gray-500 text-xs mt-1">
              Configure API sources in Dashboard
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredSources.map(renderSource)}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-cyan-500/20">
        <div className="text-xs text-gray-400">
          {filteredSources.length} source{filteredSources.length !== 1 ? 's' : ''} configured
        </div>
      </div>
    </div>
  );
}