'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Plus, Folder, Code, Search, Lock, Unlock, 
  FolderOpen, ChevronRight, ChevronDown, Zap,
  Github, Cloud, Database, Key, FileText,
  CheckCircle, AlertCircle, RefreshCw, Settings
} from 'lucide-react';
import { getStatusColor } from '@/lib/theme-config';

interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  path: string;
  size?: number;
  content?: string;
  cid?: string;
  hash?: string;
  lastModified: string;
  storage: 'native' | 'ipfs' | 'github' | 'pinata' | 'codeberg' | 'custom' | 'neon';
  parent?: string;
  children?: string[];
  mimeType?: string;
  isExpanded?: boolean;
  requiresAuth?: boolean;
}

interface ConfiguredSource {
  id: string;
  type: string;
  name: string;
  secrets: { [key: string]: string };
  status: 'connected' | 'disconnected' | 'error';
  lastUpdated: string;
  isCustom?: boolean;
}

interface ScrollExplorerProps {
  files: Map<string, FileItem>;
  setFiles: (files: Map<string, FileItem> | ((prev: Map<string, FileItem>) => Map<string, FileItem>)) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  activeEditorTab: string | null;
  createFile: (name: string) => FileItem | null;
  openFileInEditor: (file: FileItem) => void;
  loadFileIntoMinter: (file: FileItem) => void;
  formatFileSize: (bytes: number) => string;
  storageUsed: number;
  maxStorage: number;
  configuredSources?: ConfiguredSource[];
  theme: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    borderColor: string;
    textColor: string;
    cardBackground: string;
  };
}

export default function ScrollExplorer({
  files,
  setFiles,
  searchQuery,
  setSearchQuery,
  activeEditorTab,
  createFile,
  openFileInEditor,
  loadFileIntoMinter,
  formatFileSize,
  storageUsed,
  maxStorage,
  theme
}: ScrollExplorerProps) {
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const [configuredSources, setConfiguredSources] = useState<ConfiguredSource[]>([]);
  const [loadingSources, setLoadingSources] = useState<Set<string>>(new Set());
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [hoveredFileId, setHoveredFileId] = useState<string | null>(null);
  const [flatFileList, setFlatFileList] = useState<FileItem[]>([]);
  const [keyboardMode, setKeyboardMode] = useState(false);
  const explorerRef = useRef<HTMLDivElement>(null);

  // Load configured sources from Sources Configuration Dashboard
  useEffect(() => {
    if (user) {
      loadConfiguredSources();
    }
  }, [user]);

  // Also refresh sources when component mounts or when returning to the component
  useEffect(() => {
    const refreshSources = () => {
      if (user) {
        loadConfiguredSources();
      }
    };

    // Refresh on focus
    window.addEventListener('focus', refreshSources);
    
    // Refresh immediately
    refreshSources();

    return () => {
      window.removeEventListener('focus', refreshSources);
    };
  }, [user]);

  // Update flat file list for keyboard navigation
  useEffect(() => {
    const updateFlatList = () => {
      const flatList: FileItem[] = [];
      
      const addToFlatList = (parentId?: string) => {
        const filesToShow = Array.from(files.values()).filter(file => {
          if (parentId) {
            return file.parent === parentId;
          } else {
            return file.id === 'native-root' || file.id.startsWith('source-');
          }
        });

        filesToShow.forEach(file => {
          if (searchQuery && !file.name.toLowerCase().includes(searchQuery.toLowerCase())) {
            return;
          }
          
          flatList.push(file);
          
          if (file.type === 'folder' && file.isExpanded && file.children && file.children.length > 0) {
            addToFlatList(file.id);
          }
        });
      };

      addToFlatList();
      setFlatFileList(flatList);
    };

    updateFlatList();
  }, [files, searchQuery]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!explorerRef.current?.contains(document.activeElement)) return;

      const currentIndex = selectedFileId ? flatFileList.findIndex(f => f.id === selectedFileId) : -1;
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setKeyboardMode(true);
          if (currentIndex < flatFileList.length - 1) {
            const nextFile = flatFileList[currentIndex + 1];
            setSelectedFileId(nextFile.id);
            scrollToFile(nextFile.id);
          } else if (currentIndex === -1 && flatFileList.length > 0) {
            setSelectedFileId(flatFileList[0].id);
            scrollToFile(flatFileList[0].id);
          }
          break;
          
        case 'ArrowUp':
          e.preventDefault();
          setKeyboardMode(true);
          if (currentIndex > 0) {
            const prevFile = flatFileList[currentIndex - 1];
            setSelectedFileId(prevFile.id);
            scrollToFile(prevFile.id);
          } else if (currentIndex === -1 && flatFileList.length > 0) {
            setSelectedFileId(flatFileList[0].id);
            scrollToFile(flatFileList[0].id);
          }
          break;
          
        case 'ArrowRight':
          e.preventDefault();
          setKeyboardMode(true);
          if (selectedFileId) {
            const selectedFile = files.get(selectedFileId);
            if (selectedFile?.type === 'folder' && !selectedFile.isExpanded) {
              handleFileClick(selectedFile);
            }
          }
          break;
          
        case 'ArrowLeft':
          e.preventDefault();
          setKeyboardMode(true);
          if (selectedFileId) {
            const selectedFile = files.get(selectedFileId);
            if (selectedFile?.type === 'folder' && selectedFile.isExpanded) {
              handleFileClick(selectedFile);
            }
          }
          break;
          
        case 'Enter':
          e.preventDefault();
          setKeyboardMode(true);
          if (selectedFileId) {
            const selectedFile = files.get(selectedFileId);
            if (selectedFile) {
              handleFileClick(selectedFile);
            }
          }
          break;
      }
    };

    const handleMouseMove = () => {
      // Switch to mouse mode when mouse moves
      setKeyboardMode(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousemove', handleMouseMove);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [selectedFileId, flatFileList, files]);

  const scrollToFile = (fileId: string) => {
    const element = document.getElementById(`file-${fileId}`);
    if (element && explorerRef.current) {
      element.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'nearest',
        inline: 'nearest'
      });
    }
  };

  const loadConfiguredSources = async () => {
    try {
      // Load from localStorage (TODO: replace with Neon database)
      const saved = localStorage.getItem(`sources_config_${user?.id}`);
      if (saved) {
        const sources = JSON.parse(saved);
        console.log('Loading configured sources:', sources); // Debug log
        setConfiguredSources(sources);
        
        // Add configured sources as root folders to file system
        addConfiguredSourcesToFileSystem(sources);
      } else {
        console.log('No configured sources found'); // Debug log
        setConfiguredSources([]);
      }
    } catch (error) {
      console.error('Error loading configured sources:', error);
      setConfiguredSources([]);
    }
  };

  const addConfiguredSourcesToFileSystem = (sources: ConfiguredSource[]) => {
    console.log('Adding sources to file system:', sources); // Debug log
    
    setFiles(prev => {
      const updated = new Map(prev);
      
      // Remove any existing error folders first
      const keysToRemove = [];
      for (const [key, file] of updated.entries()) {
        if (key.includes('-error-') || key.startsWith('source-') && key.includes('-error-')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => updated.delete(key));
      
      sources.forEach(source => {
        const sourceId = `source-${source.id}`;
        const displayName = getSourceDisplayName(source.type, source.name);
        
        console.log(`Adding source: ${sourceId} - ${displayName}`); // Debug log
        
        // Always update/add the source (don't skip if exists)
        updated.set(sourceId, {
          id: sourceId,
          name: displayName,
          type: 'folder',
          path: `/${source.type}`,
          lastModified: source.lastUpdated,
          storage: source.type as any,
          children: [],
          isExpanded: false,
          requiresAuth: source.status !== 'connected'
        });
      });
      
      console.log('Updated file system:', Array.from(updated.keys())); // Debug log
      return updated;
    });
  };

  const getSourceDisplayName = (type: string, name: string) => {
    const icons = {
      github: '🐙',
      codeberg: '🏔️',
      pinata: '🍍',
      web3_storage: '🌐',
      infura: '🔗',
      custom: '⚙️',
      neon: '🐘'
    };
    return `${icons[type as keyof typeof icons] || '📁'} ${name}`;
  };

  const getSourceIcon = (storage: string) => {
    switch (storage) {
      case 'github': return Github;
      case 'codeberg': return Cloud;
      case 'pinata': return Database;
      case 'ipfs': return FileText;
      case 'custom': return Key;
      case 'neon': return Database;
      default: return Folder;
    }
  };

  const getSourceColor = (storage: string) => {
    switch (storage) {
      case 'github': return 'text-purple-400';
      case 'codeberg': return 'text-blue-400';
      case 'pinata': return 'text-green-400';
      case 'ipfs': return 'text-cyan-400';
      case 'custom': return 'text-yellow-400';
      case 'neon': return 'text-indigo-400';
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

  const loadSourceFiles = async (sourceId: string) => {
    const isLoading = loadingSources.has(sourceId);
    if (isLoading) return;

    setLoadingSources(prev => new Set(prev).add(sourceId));

    try {
      // Find the configured source
      const sourceFile = files.get(sourceId);
      if (!sourceFile) {
        throw new Error(`Source file not found: ${sourceId}`);
      }

      console.log('Looking for source config:', sourceId);
      console.log('Available configured sources:', configuredSources.map(s => ({ id: s.id, sourceId: `source-${s.id}`, status: s.status })));

      // Get the actual source configuration
      const sourceConfig = configuredSources.find(s => `source-${s.id}` === sourceId);
      
      if (!sourceConfig) {
        console.error(`Source configuration not found for ${sourceId}`);
        console.log('Available source IDs:', configuredSources.map(s => s.id));
        throw new Error(`Source configuration not found for ${sourceId}`);
      }

      console.log('Found source config:', { id: sourceConfig.id, status: sourceConfig.status, type: sourceConfig.type });

      // Allow loading even if status is 'disconnected' or 'error' - we'll try anyway
      // Don't block loading for sources in error state - attempt to reconnect
      console.log(`Attempting to load source in ${sourceConfig.status} state: ${sourceConfig.id}`);

      let newFiles: FileItem[] = [];

      switch (sourceFile.storage) {
        case 'github':
          newFiles = await loadGitHubFiles(sourceConfig, sourceId);
          break;
        case 'pinata':
          newFiles = await loadPinataFiles(sourceConfig, sourceId);
          break;
        case 'codeberg':
          newFiles = await loadCodebergFiles(sourceConfig, sourceId);
          break;
        case 'neon':
          newFiles = await loadNeonFiles(sourceConfig, sourceId);
          break;
        default:
          throw new Error(`Unsupported source type: ${sourceFile.storage}`);
      }

      // Update source status to connected if successful
      const updatedSources = configuredSources.map(s => 
        s.id === sourceConfig.id 
          ? { ...s, status: 'connected' as const }
          : s
      );
      setConfiguredSources(updatedSources);

      // Also update localStorage
      if (user) {
        localStorage.setItem(`sources_config_${user.id}`, JSON.stringify(updatedSources));
      }

      setFiles(prev => {
        const updated = new Map(prev);
        
        // Add new files
        newFiles.forEach(file => {
          updated.set(file.id, file);
        });
        
        // Update source folder with children
        const updatedSource = {
          ...sourceFile,
          children: newFiles.filter(f => !f.parent || f.parent === sourceId).map(f => f.id),
          requiresAuth: false
        };
        updated.set(sourceId, updatedSource);
        
        return updated;
      });

    } catch (error) {
      console.error(`Error loading files for source ${sourceId}:`, error);
      
      // Update source status to error
      const sourceConfig = configuredSources.find(s => `source-${s.id}` === sourceId);
      if (sourceConfig) {
        const updatedSources = configuredSources.map(s => 
          s.id === sourceConfig.id 
            ? { ...s, status: 'error' as const }
            : s
        );
        setConfiguredSources(updatedSources);

        // Also update localStorage
        if (user) {
          localStorage.setItem(`sources_config_${user.id}`, JSON.stringify(updatedSources));
        }
      }
      
      // Show error in the UI
      setFiles(prev => {
        const updated = new Map(prev);
        const sourceFile = updated.get(sourceId);
        if (sourceFile) {
          updated.set(sourceId, { ...sourceFile, requiresAuth: true });
        }
        return updated;
      });
    } finally {
      setLoadingSources(prev => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    }
  };

  const loadGitHubFiles = async (sourceConfig: ConfiguredSource, sourceId: string): Promise<FileItem[]> => {
    const { personal_access_token, username, repositories } = sourceConfig.secrets;
    
    if (!repositories) {
      throw new Error('No repositories configured');
    }

    const repoList = repositories.split(',').map((repo: string) => repo.trim());
    const files: FileItem[] = [];

    for (const repo of repoList) {
      try {
        // Clean the repository name - remove any GitHub URL parts
        let cleanRepo = repo;
        if (repo.includes('github.com/')) {
          // Extract repo path from full URL: https://github.com/user/repo -> user/repo
          cleanRepo = repo.split('github.com/')[1];
          if (cleanRepo.endsWith('.git')) {
            cleanRepo = cleanRepo.slice(0, -4); // Remove .git suffix
          }
        }
        
        // Determine full repo path
        const repoPath = cleanRepo.includes('/') ? cleanRepo : `${username}/${cleanRepo}`;
        
        console.log(`Original repo config: "${repo}"`); // Debug log
        console.log(`Cleaned repo: "${cleanRepo}"`); // Debug log
        console.log(`Final repo path: "${repoPath}"`); // Debug log
        
        // Fetch repository contents using correct GitHub API endpoint
        const apiUrl = `https://api.github.com/repos/${repoPath}/contents`;
        console.log(`API URL: ${apiUrl}`); // Debug log
        
        const response = await fetch(apiUrl, {
          headers: {
            'Authorization': `Bearer ${personal_access_token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'MastermindOS-FileExplorer'
          }
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`GitHub API Error for ${repoPath}:`, {
            status: response.status,
            statusText: response.statusText,
            error: errorText,
            originalRepo: repo,
            cleanedRepo: cleanRepo,
            finalPath: repoPath
          });
          
          // Create an error folder to show the issue (non-expandable)
          const errorFolderId = `${sourceId}-error-${repoPath.replace(/[\/\:\.]/g, '-')}`;
          files.push({
            id: errorFolderId,
            name: `❌ ${cleanRepo} (Error: ${response.status})`,
            type: 'folder',
            path: `/${repoPath}`,
            lastModified: new Date().toISOString(),
            storage: 'github',
            parent: sourceId,
            children: [{
              id: `${errorFolderId}-msg`,
              name: `Error: ${response.statusText}`,
              type: 'file',
              path: `/${repoPath}/error.txt`,
              lastModified: new Date().toISOString(),
              storage: 'github',
              parent: errorFolderId,
              content: `GitHub API Error: ${response.status} ${response.statusText}\n\nPlease check:\n- Repository exists and is accessible\n- Personal access token has correct permissions\n- Repository name is correct in configuration`,
              size: 200
            }]
          });
          continue;
        }

        const contents = await response.json();
        console.log(`GitHub contents for ${repoPath}:`, contents.length, 'items'); // Debug log
        
        // Create repository folder
        const repoFolderId = `${sourceId}-repo-${repoPath.replace('/', '-')}`;
        const repoFolder: FileItem = {
          id: repoFolderId,
          name: `📁 ${cleanRepo}`,
          type: 'folder',
          path: `/${repoPath}`,
          lastModified: new Date().toISOString(),
          storage: 'github',
          parent: sourceId,
          children: contents.map((item: any) => `${repoFolderId}-${item.name}`)
        };

        files.push(repoFolder);

        // Add repository contents
        contents.forEach((item: any) => {
          files.push({
            id: `${repoFolderId}-${item.name}`,
            name: item.name,
            type: item.type === 'dir' ? 'folder' : 'file',
            path: `/${repoPath}/${item.name}`,
            size: item.size || 0,
            lastModified: new Date().toISOString(),
            storage: 'github',
            parent: repoFolderId,
            mimeType: item.type === 'file' ? getFileType(item.name) : undefined
          });
        });

      } catch (error) {
        console.error(`Error loading repository ${repo}:`, error);
        
        // Create an error folder to show the issue
        files.push({
          id: `${sourceId}-error-${repo.replace(/[\/\:\.]/g, '-')}`,
          name: `❌ ${repo} (Connection Error)`,
          type: 'folder',
          path: `/${repo}`,
          lastModified: new Date().toISOString(),
          storage: 'github',
          parent: sourceId,
          children: [],
          requiresAuth: true
        });
      }
    }

    return files;
  };

  const getFileType = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'md': return 'text/markdown';
      case 'json': return 'application/json';
      case 'js': case 'jsx': return 'text/javascript';
      case 'ts': case 'tsx': return 'text/typescript';
      case 'html': return 'text/html';
      case 'css': return 'text/css';
      case 'txt': return 'text/plain';
      case 'yml': case 'yaml': return 'text/yaml';
      default: return 'text/plain';
    }
  };

  const loadPinataFiles = async (sourceConfig: ConfiguredSource, sourceId: string): Promise<FileItem[]> => {
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
      const folders: { [key: string]: FileItem[] } = {
        'Images': [],
        'Documents': [],
        'JSON': [],
        'Other': []
      };

      data.rows.forEach((item: any, index: number) => {
        const fileExtension = item.metadata?.name?.split('.').pop()?.toLowerCase() || '';
        let folderName = 'Other';

        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(fileExtension)) {
          folderName = 'Images';
        } else if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(fileExtension)) {
          folderName = 'Documents';
        } else if (fileExtension === 'json') {
          folderName = 'JSON';
        }

        const file: FileItem = {
          id: `${sourceId}-file-${item.ipfs_pin_hash}`,
          name: item.metadata?.name || `File-${item.ipfs_pin_hash.substring(0, 8)}`,
          type: 'file',
          path: `/ipfs/${item.ipfs_pin_hash}`,
          size: item.size,
          lastModified: item.date_pinned,
          storage: 'pinata',
          parent: `${sourceId}-folder-${folderName.toLowerCase()}`,
          cid: item.ipfs_pin_hash
        };

        folders[folderName].push(file);
      });

      // Convert folders to FileSystemItem format
      const files: FileItem[] = [];
      Object.entries(folders)
        .filter(([_, items]) => items.length > 0)
        .forEach(([folderName, items]) => {
          const folderId = `${sourceId}-folder-${folderName.toLowerCase()}`;
          
          // Add folder
          files.push({
            id: folderId,
            name: `📁 ${folderName} (${items.length})`,
            type: 'folder',
            path: `/${folderName.toLowerCase()}`,
            lastModified: new Date().toISOString(),
            storage: 'pinata',
            parent: sourceId,
            children: items.map(item => item.id)
          });
          
          // Add files
          files.push(...items);
        });

      return files;
    } catch (error) {
      console.error('Error loading Pinata files:', error);
      throw error;
    }
  };

  const loadCodebergFiles = async (sourceConfig: ConfiguredSource, sourceId: string): Promise<FileItem[]> => {
    const { access_token, username, repositories } = sourceConfig.secrets;
    
    if (!repositories) {
      throw new Error('No repositories configured');
    }

    const repoList = repositories.split(',').map((repo: string) => repo.trim());
    const files: FileItem[] = [];

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
        const repoFolderId = `${sourceId}-repo-${repoPath.replace('/', '-')}`;
        const repoFolder: FileItem = {
          id: repoFolderId,
          name: `📁 ${repo}`,
          type: 'folder',
          path: `/${repoPath}`,
          lastModified: new Date().toISOString(),
          storage: 'codeberg',
          parent: sourceId,
          children: contents.map((item: any) => `${repoFolderId}-${item.name}`)
        };

        files.push(repoFolder);

        // Add repository contents
        contents.forEach((item: any) => {
          files.push({
            id: `${repoFolderId}-${item.name}`,
            name: item.name,
            type: item.type === 'dir' ? 'folder' : 'file',
            path: `/${repoPath}/${item.name}`,
            size: item.size || 0,
            lastModified: new Date().toISOString(),
            storage: 'codeberg',
            parent: repoFolderId,
            mimeType: item.type === 'file' ? 'text/plain' : undefined
          });
        });

      } catch (error) {
        console.error(`Error loading repository ${repo}:`, error);
      }
    }

    return files;
  };

  const loadNeonFiles = async (sourceConfig: ConfiguredSource, sourceId: string): Promise<FileItem[]> => {
    const { database_url, schema_name = 'public', table_name = 'files' } = sourceConfig.secrets;
    
    if (!database_url) {
      throw new Error('No database URL configured');
    }

    try {
      // For now, return a mock structure for Neon database
      // TODO: Implement actual Neon database connection
      const files: FileItem[] = [];
      
      // Create a schema folder
      const schemaFolderId = `${sourceId}-schema-${schema_name}`;
      const schemaFolder: FileItem = {
        id: schemaFolderId,
        name: `🗄️ Schema: ${schema_name}`,
        type: 'folder',
        path: `/${schema_name}`,
        lastModified: new Date().toISOString(),
        storage: 'neon',
        parent: sourceId,
        children: [`${schemaFolderId}-table-${table_name}`]
      };

      files.push(schemaFolder);

      // Create a table representation
      const tableFileId = `${schemaFolderId}-table-${table_name}`;
      const tableFile: FileItem = {
        id: tableFileId,
        name: `📊 ${table_name}.sql`,
        type: 'file',
        path: `/${schema_name}/${table_name}.sql`,
        size: 1024,
        lastModified: new Date().toISOString(),
        storage: 'neon',
        parent: schemaFolderId,
        mimeType: 'application/sql',
        content: `-- Neon Database Table: ${table_name}\n-- Schema: ${schema_name}\n-- Connection placeholder for database integration`
      };

      files.push(tableFile);

      return files;
    } catch (error) {
      console.error('Error loading Neon files:', error);
      throw error;
    }
  };

  const getFileIcon = (file: FileItem) => {
    if (file.type === 'folder') {
      // Check if this is a source root folder
      if (file.id.startsWith('source-') || ['native-root', 'github-root', 'codeberg-root', 'pinata-root'].includes(file.id)) {
        const Icon = getSourceIcon(file.storage);
        return <Icon className={`h-4 w-4 ${getSourceColor(file.storage)}`} />;
      }
      return file.isExpanded ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />;
    }
    return <Code className="h-4 w-4" />;
  };

  const handleFileClick = async (file: FileItem) => {
    if (file.type === 'folder') {
      // Don't expand error folders - they're just for display
      if (file.id.includes('-error-')) {
        console.log('Clicked on error folder, not expanding:', file.id);
        return;
      }

      const wasExpanded = file.isExpanded;
      
      setFiles(prev => {
        const updated = new Map(prev);
        updated.set(file.id, { ...file, isExpanded: !file.isExpanded });
        return updated;
      });

      // Only load source files for ROOT source folders (not repo sub-folders)
      // Root source folders have format: source-{sourceId} (no additional suffixes)
      // Repo folders have format: source-{sourceId}-repo-{repoName}
      const isRootSourceFolder = file.id.startsWith('source-') && 
                                !file.id.includes('-repo-') && 
                                !file.id.includes('-folder-') && 
                                !file.id.includes('-schema-');
      
      if (!wasExpanded && isRootSourceFolder && (!file.children || file.children.length === 0)) {
        console.log('Loading source files for root source folder:', file.id);
        await loadSourceFiles(file.id);
      } else if (!wasExpanded && file.id.startsWith('source-') && !isRootSourceFolder) {
        console.log('Skipping loadSourceFiles for sub-folder:', file.id);
        // This is a repository/sub-folder, not a root source - just expand normally
      }
    } else {
      // File clicked - open in editor AND auto-populate minter
      openFileInEditor(file);
      
      // Also immediately attempt to load the file into the minter with available metadata
      if (file.content || file.storage === 'native') {
        // File already has content, immediately populate minter
        loadFileIntoMinter(file);
      } else {
        // File needs content to be loaded, minter will be populated via handleFileLoad callback
        console.log(`File ${file.name} content will be loaded from ${file.storage}, minter will auto-populate after load`);
      }
    }
  };

  const renderFileTree = (parentId?: string, level: number = 0): React.ReactNode[] => {
    const items: React.ReactNode[] = [];
    
    // Get all files that should be shown at this level
    const filesToShow = Array.from(files.values()).filter(file => {
      if (parentId) {
        return file.parent === parentId;
      } else {
        // Root level: show native-root and all source- prefixed folders
        return file.id === 'native-root' || file.id.startsWith('source-');
      }
    });

    filesToShow.forEach(file => {
      if (searchQuery && !file.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return;
      }

      const isLoading = loadingSources.has(file.id);
      const source = configuredSources.find(s => `source-${s.id}` === file.id);
      
      items.push(
        <div key={file.id} style={{ marginLeft: `${level * 16}px` }}>
          <div
            id={`file-${file.id}`}
            onClick={() => {
              setKeyboardMode(false);
              setSelectedFileId(file.id);
              handleFileClick(file);
            }}
            onMouseEnter={() => {
              if (!keyboardMode) {
                setHoveredFileId(file.id);
              }
            }}
            onMouseLeave={() => {
              if (!keyboardMode) {
                setHoveredFileId(null);
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px',
              cursor: 'pointer',
              borderRadius: '8px',
              transition: 'all 0.3s ease',
              background: (() => {
                // Priority: keyboard selection > active editor > mouse hover > default
                if (keyboardMode && selectedFileId === file.id) {
                  return 'rgba(0, 255, 255, 0.4)'; // Bright cyan for keyboard selection
                } else if (activeEditorTab === file.id) {
                  return 'rgba(0, 255, 255, 0.3)'; // Medium cyan for active editor
                } else if (!keyboardMode && hoveredFileId === file.id) {
                  return 'rgba(0, 255, 255, 0.15)'; // Light cyan for mouse hover
                } else {
                  return 'transparent';
                }
              })(),
              borderLeft: (() => {
                if ((keyboardMode && selectedFileId === file.id) || activeEditorTab === file.id) {
                  return `3px solid ${theme.primaryColor}`;
                } else {
                  return 'none';
                }
              })(),
              boxShadow: (() => {
                if (keyboardMode && selectedFileId === file.id) {
                  return `0 0 20px ${theme.primaryColor}60`; // Stronger glow for keyboard
                } else if (activeEditorTab === file.id) {
                  return `0 0 15px ${theme.primaryColor}40`;
                } else {
                  return 'none';
                }
              })()
            }}
            className="group"
          >
            {file.type === 'folder' && (
              <div style={{ width: '12px', display: 'flex', justifyContent: 'center' }}>
                {isLoading ? (
                  <RefreshCw className="w-3 h-3 animate-spin text-cyan-400" />
                ) : file.isExpanded ? (
                  <ChevronDown style={{ width: '12px', height: '12px', color: theme.primaryColor }} />
                ) : (
                  <ChevronRight style={{ width: '12px', height: '12px', color: theme.primaryColor }} />
                )}
              </div>
            )}
            
            {getFileIcon(file)}
            
            <span style={{ 
              fontSize: '14px', 
              color: theme.textColor, 
              flex: 1,
              fontFamily: 'Rajdhani, sans-serif'
            }}>
              {file.name}
            </span>
            
            {/* File size */}
            {file.size && (
              <span style={{ 
                fontSize: '12px', 
                color: theme.secondaryColor,
                fontFamily: 'Courier New, monospace'
              }}>
                {formatFileSize(file.size)}
              </span>
            )}
            
            {/* Source status indicator */}
            {source && (
              <div className="flex items-center gap-1">
                {getStatusIcon(source.status)}
              </div>
            )}
            
            {/* IPFS badge */}
            {file.cid && (
              <Badge 
                variant="outline" 
                style={{ 
                  fontSize: '10px', 
                  height: '16px', 
                  border: `1px solid ${theme.primaryColor}`, 
                  color: theme.primaryColor,
                  background: 'transparent'
                }}
              >
                IPFS
              </Badge>
            )}
            
            {/* Action buttons */}
            <div style={{ 
              display: 'flex', 
              gap: '4px', 
              opacity: 0, 
              transition: 'opacity 0.3s ease'
            }} className="group-hover:opacity-100">
              {file.type === 'file' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    loadFileIntoMinter(file);
                  }}
                  style={{
                    width: '24px',
                    height: '24px',
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    color: theme.primaryColor
                  }}
                  title="Load into minter"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 255, 255, 0.2)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <Zap style={{ width: '12px', height: '12px' }} />
                </Button>
              )}
            </div>
          </div>
          
          {/* Auth required message */}
          {file.requiresAuth && file.isExpanded && (
            <div style={{ 
              marginLeft: `${(level + 2) * 16}px`,
              padding: '8px',
              fontSize: '12px',
              color: 'rgba(255, 200, 0, 0.8)',
              fontStyle: 'italic'
            }}>
              <div className="flex items-center gap-2 mb-2">
                <Lock className="w-3 h-3" />
                <span>Authentication required</span>
              </div>
              <p className="text-xs text-gray-400 mb-2">
                Configure this source in Dashboard → API Sources
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  // TODO: Navigate to sources configuration
                  console.log('Navigate to sources config');
                }}
                className="text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/10 h-6 px-2 text-xs"
              >
                <Settings className="w-3 h-3 mr-1" />
                Configure
              </Button>
            </div>
          )}
          
          {/* Render children */}
          {file.type === 'folder' && file.isExpanded && file.children && file.children.length > 0 && (
            <div>
              {renderFileTree(file.id, level + 1)}
            </div>
          )}
        </div>
      );
    });

    return items;
  };

  return (
    <div 
      ref={explorerRef}
      tabIndex={0}
      style={{
        height: '100%',
        background: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        outline: 'none'
      }}
      onFocus={() => {
        if (!selectedFileId && flatFileList.length > 0) {
          setSelectedFileId(flatFileList[0].id);
        }
      }}
    >
      {/* Debug info and refresh button */}
      <div style={{
        padding: '4px 8px',
        borderBottom: `1px solid ${theme.borderColor}`,
        fontSize: '10px',
        color: theme.secondaryColor,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '8px'
      }}>
        <span>Sources: {configuredSources.length}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={loadConfiguredSources}
          style={{
            padding: '2px 6px',
            height: '20px',
            fontSize: '10px',
            color: theme.primaryColor
          }}
          title="Refresh sources"
        >
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>

      {/* File Tree - Full Height with Enhanced Scrollbar */}
      <div 
        style={{ 
          flex: 1, 
          overflowY: 'auto', 
          overflowX: 'hidden',
          padding: '8px',
          scrollBehavior: 'smooth',
          maxHeight: 'calc(100vh - 200px)', // Force a maximum height
          minHeight: '300px' // Ensure minimum height for scrolling
        }}
        className="file-explorer-scroll"
        onWheel={(e) => {
          // Allow normal mouse wheel scrolling
          e.stopPropagation();
        }}
      >
        <style jsx global>{`
          .file-explorer-scroll {
            scrollbar-width: thick !important;
            scrollbar-color: rgba(0, 255, 255, 0.8) rgba(0, 0, 0, 0.5) !important;
          }
          
          .file-explorer-scroll::-webkit-scrollbar {
            width: 14px !important;
            background: rgba(0, 0, 0, 0.3);
          }
          
          .file-explorer-scroll::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.5) !important;
            border-radius: 8px !important;
            border: 2px solid rgba(0, 255, 255, 0.2) !important;
            margin: 4px !important;
          }
          
          .file-explorer-scroll::-webkit-scrollbar-thumb {
            background: linear-gradient(180deg, rgba(0, 255, 255, 0.9), rgba(0, 255, 255, 0.6)) !important;
            border-radius: 8px !important;
            border: 2px solid rgba(0, 255, 255, 0.4) !important;
            box-shadow: 0 0 10px rgba(0, 255, 255, 0.5) !important;
          }
          
          .file-explorer-scroll::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(180deg, rgba(0, 255, 255, 1), rgba(0, 255, 255, 0.8)) !important;
            border-color: rgba(0, 255, 255, 0.6) !important;
            box-shadow: 0 0 15px rgba(0, 255, 255, 0.7) !important;
          }
          
          .file-explorer-scroll::-webkit-scrollbar-thumb:active {
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(0, 255, 255, 0.9)) !important;
            box-shadow: 0 0 20px rgba(0, 255, 255, 0.9) !important;
          }
          
          .file-explorer-scroll::-webkit-scrollbar-corner {
            background: rgba(0, 0, 0, 0.3);
          }
          
          /* Force visibility test - this creates extra content if needed */
          .file-explorer-scroll::after {
            content: '';
            display: block;
            height: 1px;
            margin-top: 20px;
          }
        `}</style>
        {renderFileTree()}
      </div>
      
      {/* Footer with source count and keyboard hints */}
      <div style={{
        padding: '8px',
        borderTop: `1px solid ${theme.borderColor}`,
        fontSize: '11px',
        color: theme.secondaryColor,
        fontFamily: 'Courier New, monospace'
      }}>
        <div>
          {configuredSources.length + 1} source{configuredSources.length !== 0 ? 's' : ''} configured
        </div>
        {configuredSources.length === 0 && (
          <div style={{ fontSize: '10px', marginTop: '4px', color: 'rgba(255, 200, 0, 0.8)' }}>
            Configure sources in Dashboard → API Sources
          </div>
        )}
        <div style={{ fontSize: '9px', marginTop: '4px', color: 'rgba(0, 255, 255, 0.5)' }}>
          ↑↓ Navigate • ←→ Expand/Collapse • Enter Open
        </div>
      </div>
    </div>
  );
}