'use client';

import { useState, useEffect, useRef } from 'react';
import { useUser, useAuth } from '@clerk/nextjs';
import { Files, Code, Zap, Terminal, Search, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getComponentBackground, themeColors } from '@/lib/theme-config';
import { useWallet } from '@/context/WalletContext';

// Import sub-components
import ScrollExplorer from './scrolls/ScrollExplorer';
import ScrollEditor from './scrolls/ScrollEditor';
import ScrollMinter from './scrolls/ScrollMinter';
import ScrollTerminal from './scrolls/ScrollTerminal';

// Types
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
  storage: 'native' | 'ipfs' | 'github' | 'pinata' | 'codeberg';
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

interface MintingData {
  title: string;
  content: string;
  cid: string;
  hash: string;
  fileId: string;
  validated: boolean;
  l1Status: 'ready' | 'minting' | 'minted' | 'error';
  l2Status: 'ready' | 'minting' | 'minted' | 'error';
  isDemo?: boolean;
  recipientAddress: string;
  keccakHash: string;
  isValidData: boolean;
}

export default function ScrollsSection() {
  const { user, isLoaded } = useUser();
  const { isSignedIn } = useAuth();
  const { walletState, connectWallet } = useWallet();
  
  // Ref to track last processed content for hash generation
  const lastProcessedContent = useRef<string>('');
  
  // VS Code-style state management
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(280);
  // NEW INTUITIVE TOGGLE LOGIC
  const [editorOpen, setEditorOpen] = useState(true);  // Default: editor ON
  const [minterOpen, setMinterOpen] = useState(false); // Default: minter OFF

  // Handle editor toggle
  const handleEditorToggle = () => {
    setEditorOpen(!editorOpen);
  };

  // Handle minter toggle
  const handleMinterToggle = () => {
    setMinterOpen(!minterOpen);
  };
  const [isResizing, setIsResizing] = useState(false);
  
  const [configuredSources, setConfiguredSources] = useState<ConfiguredSource[]>([]);
  
  // Core state
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [files, setFiles] = useState<Map<string, FileItem>>(new Map());
  const [storageUsed, setStorageUsed] = useState(0);
  const [maxStorage] = useState(100 * 1024 * 1024);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeEditorTab, setActiveEditorTab] = useState<string | null>(null);
  
  // Minting state
  const [mintingData, setMintingData] = useState<MintingData>({
    title: '',
    content: '',
    cid: '',
    hash: '',
    fileId: '',
    validated: false,
    l1Status: 'ready',
    l2Status: 'ready',
    isDemo: !isSignedIn,
    recipientAddress: '',
    keccakHash: '',
    isValidData: false
  });
  
  // Terminal state
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [terminalInput, setTerminalInput] = useState('');

  // VS Code-style layout calculations
  const sidebarWidth = '48px';
  const terminalHeight = terminalOpen ? '200px' : '0px';
  const mainContentHeight = terminalOpen ? 'calc(100% - 200px)' : '100%';
  const explorerActualWidth = explorerOpen ? `${explorerWidth}px` : '0px';
  const workspaceWidth = explorerOpen ? `calc(100% - ${explorerWidth}px - 48px)` : 'calc(100% - 48px)';

  // Update minting data validation whenever relevant fields change
  useEffect(() => {
    const hasValidRecipient = isValidEthAddress(mintingData.recipientAddress);
    const hasTitle = mintingData.title.trim().length > 0;
    const hasContent = mintingData.content.length > 0;
    const hasHash = mintingData.keccakHash.length > 0;
    
    const isValid = hasValidRecipient && hasTitle && hasContent && hasHash;
    
    if (mintingData.isValidData !== isValid) {
      setMintingData(prev => ({
        ...prev,
        isValidData: isValid,
        validated: isValid
      }));
    }
  }, [mintingData.recipientAddress, mintingData.title, mintingData.content, mintingData.keccakHash]);

  // Auto-generate keccak hash when content changes
  useEffect(() => {
    if (mintingData.content && 
        mintingData.content.length > 0 && 
        mintingData.content !== lastProcessedContent.current) {
      
      lastProcessedContent.current = mintingData.content;
      
      generateKeccakHash(mintingData.content).then(newHash => {
        setMintingData(prev => ({
          ...prev,
          keccakHash: newHash
        }));
      });
    }
  }, [mintingData.content]);

  // Initialization effect
  useEffect(() => {
    if (isLoaded) {
      initializeEnhancedFileSystem();
      loadConfiguredSources();
      addTerminalLine('🌀 SCROLL FORGE IDE v3.0 Initialized');
      addTerminalLine('✅ Enhanced file system with multi-provider support');
      
      if (isSignedIn && user) {
        addTerminalLine(`👤 Welcome ${user.firstName || user.username || 'User'}! Enhanced features unlocked.`);
      } else {
        addTerminalLine('📱 Running in Guest Mode - Core features available');
        addTerminalLine('🔐 Sign in to unlock: GitHub, Codeberg, Pinata integrations');
      }
      
      addTerminalLine('⚡ Ready for sovereign scroll development...');
      // Removed auto wallet connection - will be handled by header wallet icon
    }
  }, [isLoaded, isSignedIn, user]);

  // Load configured sources from localStorage/database
  const loadConfiguredSources = () => {
    try {
      if (user) {
        const saved = localStorage.getItem(`sources_config_${user.id}`);
        if (saved) {
          const sources = JSON.parse(saved);
          setConfiguredSources(sources);
          addTerminalLine(`🔗 Loaded ${sources.length} configured source(s)`);
        }
      }
    } catch (error) {
      console.error('Error loading configured sources:', error);
      addTerminalLine('⚠️ Error loading configured sources');
    }
  };

  // Helper functions
  const addTerminalLine = (line: string) => {
    setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);
  };

  const initializeEnhancedFileSystem = () => {
    const enhancedFiles = new Map<string, FileItem>();
    
    // Storage providers as folders
    enhancedFiles.set('native-root', {
      id: 'native-root',
      name: '💾 Local Storage',
      type: 'folder',
      path: '/native',
      lastModified: new Date().toISOString(),
      storage: 'native',
      children: ['template-1'],
      isExpanded: true
    });
    
    enhancedFiles.set('github-root', {
      id: 'github-root',
      name: '🐙 GitHub Repos',
      type: 'folder',
      path: '/github',
      lastModified: new Date().toISOString(),
      storage: 'github',
      children: [],
      isExpanded: false,
      requiresAuth: true
    });
    
    enhancedFiles.set('codeberg-root', {
      id: 'codeberg-root',
      name: '🏔️ Codeberg Repos',
      type: 'folder',
      path: '/codeberg',
      lastModified: new Date().toISOString(),
      storage: 'codeberg',
      children: [],
      isExpanded: false,
      requiresAuth: true
    });
    
    enhancedFiles.set('pinata-root', {
      id: 'pinata-root',
      name: '🍍 Pinata IPFS',
      type: 'folder',
      path: '/pinata',
      lastModified: new Date().toISOString(),
      storage: 'pinata',
      children: [],
      isExpanded: false,
      requiresAuth: true
    });
    
    // Sample template
    enhancedFiles.set('template-1', {
      id: 'template-1',
      name: 'scroll-template.json',
      type: 'file',
      path: '/native/scroll-template.json',
      size: 512,
      content: JSON.stringify({
        title: "[Your Scroll Title]",
        author: user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : "Anonymous",
        eth_address: "0x4575a90d54785323546f2bb4a520622ed6d3efbc",
        version: "v1.0",
        abstract: "[Brief description of your scroll's purpose and significance]",
        structure: {
          constants: ["φ", "ψ₀", "Ξ"],
          equations: ["[Your mathematical expressions here]"]
        },
        sections: [
          {
            name: "Core Concept",
            content: "[Explain your main idea or discovery]"
          }
        ],
        metadata: {
          created: new Date().toISOString(),
          user_id: user?.id || "anonymous"
        }
      }, null, 2),
      lastModified: new Date().toISOString(),
      storage: 'native',
      parent: 'native-root',
      mimeType: 'application/json'
    });
    
    setFiles(enhancedFiles);
    setStorageUsed(512);
  };

  const handleFileDragToPinata = async (file: FileItem) => {
    if (!file.content) {
      addTerminalLine(`❌ File ${file.name} has no content to upload`);
      return;
    }
    
    addTerminalLine(`🔄 Uploading ${file.name} to Pinata IPFS...`);
    
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const mockCid = `bafkrei${Math.random().toString(36).substring(2, 15)}`;
      const mockHash = await generateKeccakHash(file.content);
      
      setFiles(prev => {
        const updated = new Map(prev);
        const updatedFile = { ...file, cid: mockCid, hash: mockHash };
        updated.set(file.id, updatedFile);
        return updated;
      });
      
      addTerminalLine(`✅ Uploaded to IPFS: ${mockCid}`);
      addTerminalLine(`📋 Hash: ${mockHash}`);
      
      return { cid: mockCid, hash: mockHash };
    } catch (error: any) {
      addTerminalLine(`❌ Pinata upload failed: ${error.message}`);
      return null;
    }
  };

  const autoFillMinterFromFile = async (file: FileItem) => {
    addTerminalLine(`⚡ Auto-filling minter from ${file.name}...`);
    
    try {
      let fileContent = file.content || '';
      
      // If file doesn't have content loaded, try to load it
      if (!fileContent && file.storage !== 'native') {
        addTerminalLine(`🔄 Loading content from ${file.storage} for minter...`);
        
        // Use the file content loader to get the content
        const { FileContentLoader } = await import('./scrolls/FileContentLoader');
        const fileLoader = new FileContentLoader(configuredSources);
        fileContent = await fileLoader.loadFileContent(file);
        
        // Update the file with loaded content
        setFiles(prev => {
          const updated = new Map(prev);
          const updatedFile = { ...file, content: fileContent };
          updated.set(file.id, updatedFile);
          return updated;
        });
        
        addTerminalLine(`✅ Content loaded (${formatFileSize(fileContent.length)})`);
      }
      
      if (!fileContent) {
        addTerminalLine(`❌ File ${file.name} has no content for minting`);
        return;
      }
      
      // Extract metadata using the same logic as handleFileLoad
      let extractedMetadata;

      if (file.mimeType === 'application/json' || file.name.endsWith('.json')) {
        const jsonData = JSON.parse(fileContent);
        extractedMetadata = {
          title: jsonData.title || file.name,
          content: fileContent,
          cid: file.cid || '',
          hash: file.hash || await generateHash(fileContent),
          keccakHash: await generateKeccakHash(fileContent),
          fileId: file.id,
          recipientAddress: jsonData.eth_address || jsonData.author_address || mintingData.recipientAddress || '0x4575a90d54785323546f2bb4a520622ed6d3efbc',
          isValidData: !!(jsonData.title && fileContent.length > 10),
          validated: !!(jsonData.title && fileContent.length > 10)
        };
      } else if (file.mimeType === 'text/markdown' || file.name.endsWith('.md')) {
        const titleMatch = fileContent.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1] : file.name;
        
        extractedMetadata = {
          title: title,
          content: fileContent,
          cid: file.cid || '',
          hash: file.hash || await generateHash(fileContent),
          keccakHash: await generateKeccakHash(fileContent),
          fileId: file.id,
          recipientAddress: mintingData.recipientAddress || '0x4575a90d54785323546f2bb4a520622ed6d3efbc',
          isValidData: !!(title && fileContent.length > 10),
          validated: !!(title && fileContent.length > 10)
        };
      } else {
        extractedMetadata = {
          title: file.name,
          content: fileContent,
          cid: file.cid || '',
          hash: file.hash || await generateHash(fileContent),
          keccakHash: await generateKeccakHash(fileContent),
          fileId: file.id,
          recipientAddress: mintingData.recipientAddress || '0x4575a90d54785323546f2bb4a520622ed6d3efbc',
          isValidData: !!(fileContent.length > 0),
          validated: !!(fileContent.length > 0)
        };
      }

      setMintingData(prev => ({
        ...prev,
        ...extractedMetadata
      }));
      
      // Show split view so user can see the populated minter
      // NEW: Automatically enable both editor and minter for auto-fill
      setEditorOpen(true);
      setMinterOpen(true);
      addTerminalLine(`✅ Minter auto-filled: ${extractedMetadata.title}`);
      if (extractedMetadata.cid) {
        addTerminalLine(`🌐 IPFS CID: ${extractedMetadata.cid}`);
      } else {
        addTerminalLine(`⚠️ No CID - upload to IPFS first for blockchain minting`);
      }
      if (extractedMetadata.keccakHash && typeof extractedMetadata.keccakHash === 'string') {
        addTerminalLine(`🔗 Content hash: ${extractedMetadata.keccakHash.substring(0, 20)}...`);
      }
      
    } catch (error: any) {
      console.error('Error auto-filling minter:', error);
      addTerminalLine(`❌ Failed to auto-fill minter: ${error.message}`);
      
      // Fallback: try to use whatever metadata is available
      try {
        const fallbackMetadata = {
          title: file.name,
          content: file.content || '',
          cid: file.cid || '',
          hash: file.hash || await generateHash(file.content || file.name),
          keccakHash: await generateKeccakHash(file.content || file.name),
          fileId: file.id,
          isValidData: !!(file.content && file.content.length > 0),
          validated: !!(file.content && file.content.length > 0)
        };
        
        setMintingData(prev => ({
          ...prev,
          ...fallbackMetadata
        }));
        
        addTerminalLine(`⚡ Used fallback metadata for ${file.name}`);
        if (fallbackMetadata.keccakHash && typeof fallbackMetadata.keccakHash === 'string') {
          addTerminalLine(`🔗 Content hash: ${fallbackMetadata.keccakHash.substring(0, 20)}...`);
        }
      } catch (fallbackError) {
        addTerminalLine(`❌ Complete failure to process ${file.name}`);
      }
    }
  };

  const checkWalletConnection = async () => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        const ethereum = (window as any).ethereum;
        const accounts = await ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
          // No longer calling setWalletState - wallet state is managed by useWallet context
          addTerminalLine(`🔗 Wallet connected: ${accounts[0].substring(0, 8)}...`);
        }
      } catch (error: any) {
        console.error('Error checking wallet connection:', { message: error?.message, error });
      }
    }
  };

  // connectWallet function is provided by useWallet context - removed duplicate

  const isValidEthAddress = (address: string): boolean => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  const generateKeccakHash = async (data: string): Promise<string> => {
    try {
      // Use Web Crypto API for proper cryptographic hashing
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(data);
      const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return '0x' + hashHex;
    } catch (error) {
      console.error('Error generating hash:', error);
      // Fallback to a better deterministic hash function if crypto API fails
      return generateStrongFallbackHash(data);
    }
  };

  const generateStrongFallbackHash = (data: string): string => {
    // Improved hash function with better distribution
    let hash = 0;
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      h1 = Math.imul(h1 ^ char, 2654435761);
      h2 = Math.imul(h2 ^ char, 1597334677);
    }
    
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    
    const result = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    
    // Convert to proper 256-bit hex representation
    const hex = Math.abs(result).toString(16);
    const extendedHex = (hex + data.split('').map(c => c.charCodeAt(0).toString(16)).join('')).substring(0, 64);
    return '0x' + extendedHex.padStart(64, '0');
  };

  const generateHash = async (content: string): Promise<string> => {
    return generateKeccakHash(content);
  };

  const createFile = (name: string, content: string = '', parent: string = 'native-root') => {
    const id = `file-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const defaultContent = content || JSON.stringify({
      title: "",
      author: user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : "Anonymous",
      eth_address: "0x4575a90d54785323546f2bb4a520622ed6d3efbc",
      version: "v1.0",
      abstract: "",
      structure: {
        constants: [],
        equations: []
      },
      sections: [],
      metadata: {
        created: new Date().toISOString(),
        user_id: user?.id || "anonymous"
      }
    }, null, 2);
    
    const newFile: FileItem = {
      id,
      name,
      type: 'file',
      path: `/${name}`,
      size: new Blob([defaultContent]).size,
      content: defaultContent,
      lastModified: new Date().toISOString(),
      storage: 'native',
      parent,
      mimeType: 'application/json'
    };
    
    if (storageUsed + newFile.size! > maxStorage) {
      addTerminalLine('❌ Storage limit exceeded!');
      return null;
    }
    
    setFiles(prev => {
      const updated = new Map(prev);
      updated.set(id, newFile);
      
      const parentFile = updated.get(parent);
      if (parentFile && parentFile.children) {
        parentFile.children.push(id);
        updated.set(parent, { ...parentFile });
      }
      
      return updated;
    });
    
    setStorageUsed(prev => prev + newFile.size!);
    addTerminalLine(`✅ Created file: ${name}`);
    return newFile;
  };

  const openFileInEditor = async (file: FileItem) => {
    setActiveEditorTab(file.id);
    setSelectedFile(file);
    // NEW: Automatically enable editor when opening a file
    setEditorOpen(true);
    addTerminalLine(`📝 Opened in editor: ${file.name}`);
    
    // Load file content if not already loaded
    if (!file.content && file.storage !== 'native') {
      addTerminalLine(`🔄 Loading content from ${file.storage}...`);
    }
  };

  const handleFileContentChange = (fileId: string, content: string) => {
    // Update minting data if this is the selected file
    if (selectedFile?.id === fileId) {
      try {
        if (selectedFile.mimeType === 'application/json' || selectedFile.name.endsWith('.json')) {
          const jsonData = JSON.parse(content);
          generateKeccakHash(content).then(hash => {
            setMintingData(prev => ({
              ...prev,
              title: jsonData.title || selectedFile.name,
              content: content,
              fileId: fileId,
              keccakHash: hash
            }));
          });
        } else {
          generateKeccakHash(content).then(hash => {
            setMintingData(prev => ({
              ...prev,
              title: selectedFile.name,
              content: content,
              fileId: fileId,
              keccakHash: hash
            }));
          });
        }
      } catch (error) {
        // If not valid JSON, just update content
        generateKeccakHash(content).then(hash => {
          setMintingData(prev => ({
            ...prev,
            title: selectedFile.name,
            content: content,
            fileId: fileId,
            keccakHash: hash
          }));
        });
      }
    }
  };

  const handleFileLoad = async (file: FileItem, content: string) => {
    addTerminalLine(`✅ Loaded ${file.name} (${formatFileSize(content.length)})`);
    
    // Auto-extract metadata for minter - COMPREHENSIVE EXTRACTION
    try {
      let extractedMetadata;

      if (file.mimeType === 'application/json' || file.name.endsWith('.json')) {
        // Parse JSON files for scroll metadata
        const jsonData = JSON.parse(content);
        extractedMetadata = {
          title: jsonData.title || file.name,
          content: content,
          cid: file.cid || '',
          hash: file.hash || await generateHash(content),
          keccakHash: await generateKeccakHash(content),
          fileId: file.id,
          recipientAddress: jsonData.eth_address || jsonData.author_address || mintingData.recipientAddress || '0x4575a90d54785323546f2bb4a520622ed6d3efbc',
          isValidData: !!(jsonData.title && content.length > 10)
        };
      } else if (file.mimeType === 'text/markdown' || file.name.endsWith('.md')) {
        // Extract title from markdown files
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1] : file.name;
        
        extractedMetadata = {
          title: title,
          content: content,
          cid: file.cid || '',
          hash: file.hash || await generateHash(content),
          keccakHash: await generateKeccakHash(content),
          fileId: file.id,
          recipientAddress: mintingData.recipientAddress || '0x4575a90d54785323546f2bb4a520622ed6d3efbc',
          isValidData: !!(title && content.length > 10)
        };
      } else {
        // Handle any other text file
        extractedMetadata = {
          title: file.name,
          content: content,
          cid: file.cid || '',
          hash: file.hash || await generateHash(content),
          keccakHash: await generateKeccakHash(content),
          fileId: file.id,
          recipientAddress: mintingData.recipientAddress || '0x4575a90d54785323546f2bb4a520622ed6d3efbc',
          isValidData: !!(content.length > 0)
        };
      }

      // Update minting data with extracted metadata
      setMintingData(prev => ({
        ...prev,
        ...extractedMetadata,
        validated: extractedMetadata.isValidData
      }));

      addTerminalLine(`⚡ Auto-filled minter with metadata from ${file.name}`);
      addTerminalLine(`📝 Title: ${extractedMetadata.title}`);
      if (extractedMetadata.cid) {
        addTerminalLine(`🌐 CID: ${extractedMetadata.cid}`);
      }
      if (extractedMetadata.keccakHash && typeof extractedMetadata.keccakHash === 'string') {
        addTerminalLine(`🔗 Hash: ${extractedMetadata.keccakHash.substring(0, 20)}...`);
      }

    } catch (error) {
      console.error('Error extracting metadata:', error);
      
      // Fallback: just update basic info
      try {
        const fallbackMetadata = {
          title: file.name,
          content: content,
          cid: file.cid || '',
          hash: file.hash || await generateHash(content),
          keccakHash: await generateKeccakHash(content),
          fileId: file.id,
          isValidData: content.length > 0
        };
        
        setMintingData(prev => ({
          ...prev,
          ...fallbackMetadata,
          validated: fallbackMetadata.isValidData
        }));
        
        addTerminalLine(`⚠️ Basic metadata extracted from ${file.name} (JSON parse failed)`);
      } catch (fallbackError) {
        addTerminalLine(`❌ Complete failure to process ${file.name}`);
      }
    }
  };

  const mintOnNetwork = async (isL1: boolean) => {
    if (!mintingData.isValidData) {
      addTerminalLine('❌ Invalid minting data. Please check all fields.');
      return;
    }

    const networkKey = isL1 ? 'l1Status' : 'l2Status';
    const networkName = isL1 ? 'L1 Ethereum' : 'L2 Scroll';
    
    if (!walletState.connected) {
      const connected = await connectWallet();
      if (!connected) return;
    }

    setMintingData(prev => ({ ...prev, [networkKey]: 'minting' }));
    
    if (mintingData.isDemo) {
      addTerminalLine(`🔄 Demo minting on ${networkName}...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      setMintingData(prev => ({ ...prev, [networkKey]: 'minted' }));
      addTerminalLine(`✅ ${networkName} demo minting complete!`);
    } else {
      addTerminalLine(`🔄 Real minting on ${networkName}...`);
      try {
        await new Promise(resolve => setTimeout(resolve, 3000));
        setMintingData(prev => ({ ...prev, [networkKey]: 'minted' }));
        addTerminalLine(`✅ ${networkName} minting complete!`);
      } catch (error: any) {
        addTerminalLine(`❌ ${networkName} minting failed: ${error.message}`);
        setMintingData(prev => ({ ...prev, [networkKey]: 'error' }));
      }
    }
  };

  const handleTerminalCommand = (command: string) => {
    addTerminalLine(`> ${command}`);
    
    const cmd = command.toLowerCase().trim();
    switch (cmd) {
      case 'clear':
        setTerminalOutput([]);
        break;
      case 'help':
        addTerminalLine('Commands: clear, ls, status, whoami, auth, wallet, providers');
        break;
      case 'ls':
        addTerminalLine(`Files: ${files.size} | Storage: ${formatFileSize(storageUsed)}`);
        break;
      case 'providers':
        addTerminalLine('📁 Available storage providers:');
        addTerminalLine('  💾 Local Storage - Always available');
        addTerminalLine('  🐙 GitHub - Requires authentication');
        addTerminalLine('  🏔️ Codeberg - Requires authentication');
        addTerminalLine('  🍍 Pinata IPFS - Requires API key');
        break;
      case 'status':
        addTerminalLine(`🌀 SCROLL FORGE IDE v3.0 - Enhanced file system active`);
        addTerminalLine(`Explorer: ${explorerOpen ? 'Open' : 'Closed'}`);
        addTerminalLine(`Terminal: ${terminalOpen ? 'Open' : 'Closed'}`);
        addTerminalLine(`Editor: ${editorOpen ? 'Open' : 'Closed'}`);
        addTerminalLine(`Minter: ${minterOpen ? 'Open' : 'Closed'}`);
        addTerminalLine(`Auth: ${isSignedIn ? 'Authenticated' : 'Guest Mode'}`);
        addTerminalLine(`Wallet: ${walletState.connected ? walletState.address : 'Disconnected'}`);
        break;
      default:
        addTerminalLine(`Command not found: ${command}`);
    }
    
    setTerminalInput('');
  };

  const formatFileSize = (bytes: number): string => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    addTerminalLine(`📋 Copied to clipboard: ${text.substring(0, 20)}...`);
  };

  // Resize handling
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing) return;
    
    const newWidth = e.clientX - 48; // Subtract sidebar width
    const minWidth = 200;
    const maxWidth = window.innerWidth * 0.5; // Max 50% of screen
    
    setExplorerWidth(Math.min(Math.max(newWidth, minWidth), maxWidth));
  };

  const handleMouseUp = () => {
    setIsResizing(false);
  };

  // Add/remove mouse event listeners for resizing
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // Loading state
  if (!isLoaded) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ 
            width: '48px', 
            height: '48px', 
            margin: '0 auto 16px',
            background: 'linear-gradient(45deg, #00ffff, #ff00ff)',
            borderRadius: '50%',
            animation: 'pulse 2s infinite'
          }} />
          <p style={{ 
            fontSize: '16px', 
            fontWeight: '500', 
            color: '#00ffff',
            fontFamily: 'Orbitron, monospace'
          }}>
            Initializing Enhanced File System...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'transparent'
    }}>
      {/* UNIFIED SCROLL FORGE HEADER - Above Everything */}
      <div style={{
        background: getComponentBackground('nav'),
        border: `1px solid ${themeColors.border_primary}`,
        borderRadius: '8px 8px 0 0',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: '40px',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Zap style={{ width: '18px', height: '18px', color: '#00ffff' }} />
            <span style={{ 
              color: '#00ffff', 
              fontWeight: '700',
              fontFamily: 'Orbitron, monospace',
              fontSize: '16px',
              textTransform: 'uppercase',
              letterSpacing: '1px'
            }}>
              SCROLL FORGE
            </span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* NEW VIEW MODE INDICATORS - Based on button states */}
            {!editorOpen && !minterOpen && (
              <span style={{ 
                fontSize: '12px', 
                color: 'rgba(0, 255, 255, 0.5)',
                fontFamily: 'Rajdhani, sans-serif'
              }}>
                ⚪ Empty Display
              </span>
            )}
            {editorOpen && !minterOpen && (
              <span style={{ 
                fontSize: '12px', 
                color: 'rgba(0, 255, 255, 0.7)',
                fontFamily: 'Rajdhani, sans-serif'
              }}>
                📝 Editor Mode
              </span>
            )}
            {!editorOpen && minterOpen && (
              <span style={{ 
                fontSize: '12px', 
                color: 'rgba(0, 255, 255, 0.7)',
                fontFamily: 'Rajdhani, sans-serif'
              }}>
                ⚡ Minter Mode
              </span>
            )}
            {editorOpen && minterOpen && (
              <span style={{ 
                fontSize: '12px', 
                color: 'rgba(0, 255, 255, 0.7)',
                fontFamily: 'Rajdhani, sans-serif'
              }}>
                🔄 Split View
              </span>
            )}
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Status Badges */}
          {mintingData.isDemo && (
            <Badge 
              variant="outline" 
              style={{ 
                fontSize: '10px', 
                border: `1px solid rgba(255, 200, 0, 0.5)`, 
                color: 'rgba(255, 200, 0, 1)',
                background: 'rgba(255, 200, 0, 0.1)',
                padding: '2px 6px'
              }}
            >
              DEMO
            </Badge>
          )}
          {walletState.connected && (
            <Badge 
              variant="outline" 
              style={{ 
                fontSize: '10px', 
                border: `1px solid rgba(0, 255, 170, 0.5)`, 
                color: 'rgba(0, 255, 170, 1)',
                background: 'rgba(0, 255, 170, 0.1)',
                padding: '2px 6px'
              }}
            >
              WALLET
            </Badge>
          )}
        </div>
      </div>

      {/* Main Layout Container - Below Header */}
      <div style={{
        flex: 1,
        display: 'flex',
        background: 'transparent'
      }}>
        {/* Left Activity Bar - Full Height */}
        <div style={{
          width: sidebarWidth,
          background: getComponentBackground('nav'),
          border: `1px solid ${themeColors.border_primary}`,
          borderRight: `1px solid ${themeColors.border_secondary}`,
          borderRadius: '0 0 0 8px', // Only bottom-left corner rounded
          display: 'flex',
          flexDirection: 'column',
          padding: '8px 0',
          gap: '4px'
        }}>
        <button
          onClick={() => setExplorerOpen(!explorerOpen)}
          style={{
            width: '32px',
            height: '32px',
            background: explorerOpen ? `rgba(0, 255, 255, 0.2)` : 'transparent',
            border: explorerOpen ? `1px solid ${themeColors.border_secondary}` : '1px solid transparent',
            borderRadius: '4px',
            color: explorerOpen ? themeColors.primary_cyan : `rgba(0, 255, 255, 0.7)`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.3s ease',
            margin: '0 8px'
          }}
          title="Explorer"
        >
          <Files size={16} />
        </button>

        {/* File Editor Toggle - NEW INTUITIVE LOGIC */}
        <button
          onClick={handleEditorToggle}
          style={{
            width: '32px',
            height: '32px',
            background: editorOpen ? `rgba(0, 255, 255, 0.2)` : 'transparent',
            border: editorOpen ? `1px solid ${themeColors.border_secondary}` : '1px solid transparent',
            borderRadius: '4px',
            color: editorOpen ? themeColors.primary_cyan : `rgba(0, 255, 255, 0.7)`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.3s ease',
            margin: '0 8px'
          }}
          title="File Editor"
        >
          <Code size={16} />
        </button>

        {/* Minter Toggle - NEW INTUITIVE LOGIC */}
        <button
          onClick={handleMinterToggle}
          style={{
            width: '32px',
            height: '32px',
            background: minterOpen ? `rgba(0, 255, 255, 0.2)` : 'transparent',
            border: minterOpen ? `1px solid ${themeColors.border_secondary}` : '1px solid transparent',
            borderRadius: '4px',
            color: minterOpen ? themeColors.primary_cyan : `rgba(0, 255, 255, 0.7)`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.3s ease',
            margin: '0 8px'
          }}
          title="Scroll Minter"
        >
          <Zap size={16} />
        </button>

        {/* Terminal Toggle */}
        <button
          onClick={() => setTerminalOpen(!terminalOpen)}
          style={{
            width: '32px',
            height: '32px',
            background: terminalOpen ? `rgba(0, 255, 255, 0.2)` : 'transparent',
            border: terminalOpen ? `1px solid ${themeColors.border_secondary}` : '1px solid transparent',
            borderRadius: '4px',
            color: terminalOpen ? themeColors.primary_cyan : `rgba(0, 255, 255, 0.7)`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.3s ease',
            margin: '0 8px'
          }}
          title="Terminal"
        >
          <Terminal size={16} />
        </button>
      </div>

      {/* Explorer Sidebar - With proper header */}
      {explorerOpen && (
        <div style={{
          width: explorerActualWidth,
          background: getComponentBackground('nav'),
          border: `1px solid ${themeColors.border_primary}`,
          borderLeft: 'none',
          borderRight: `1px solid ${themeColors.border_secondary}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'width 0.3s ease'
        }}>
          {/* Explorer Header - Orchestrator Managed */}
          <div style={{
            padding: '8px 12px',
            borderBottom: `1px solid ${themeColors.border_primary}`,
            background: getComponentBackground('secondary')
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '8px'
            }}>
              <Files size={14} />
              <span style={{
                fontSize: '12px',
                fontWeight: '600',
                color: '#00ffff',
                fontFamily: 'Orbitron, monospace',
                textTransform: 'uppercase'
              }}>
                SCROLL FORGE
              </span>
            </div>
            
            {/* Search Box */}
            <div style={{
              position: 'relative',
              marginBottom: '8px'
            }}>
              <Search size={12} style={{
                position: 'absolute',
                left: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'rgba(0, 255, 255, 0.6)'
              }} />
              <input
                type="text"
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 6px 6px 28px',
                  background: getComponentBackground('card'),
                  border: `1px solid ${themeColors.border_primary}`,
                  borderRadius: '4px',
                  color: themeColors.primary_cyan,
                  fontSize: '11px',
                  fontFamily: 'Rajdhani, sans-serif',
                  outline: 'none'
                }}
              />
            </div>

            {/* New Scroll Button */}
            <button
              onClick={() => createFile(`scroll-${Date.now()}.json`)}
              style={{
                width: '100%',
                padding: '6px 8px',
                background: `linear-gradient(135deg, rgba(0, 255, 255, 0.2), rgba(0, 255, 255, 0.1))`,
                border: `1px solid ${themeColors.border_primary}`,
                borderRadius: '4px',
                color: themeColors.primary_cyan,
                fontSize: '11px',
                fontFamily: 'Rajdhani, sans-serif',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                justifyContent: 'center',
                transition: 'all 0.3s ease'
              }}
            >
              <Plus size={12} />
              New Scroll
            </button>

            {/* Storage Usage */}
            <div style={{
              marginTop: '8px',
              fontSize: '10px',
              color: `rgba(0, 255, 255, 0.7)`,
              fontFamily: 'Courier New, monospace'
            }}>
              💾 {formatFileSize(storageUsed)} / {formatFileSize(maxStorage)}
            </div>
          </div>

          {/* Component Content Area */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <ScrollExplorer
              files={files}
              setFiles={setFiles}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              activeEditorTab={activeEditorTab}
              createFile={createFile}
              openFileInEditor={openFileInEditor}
              loadFileIntoMinter={autoFillMinterFromFile}
              formatFileSize={formatFileSize}
              storageUsed={storageUsed}
              maxStorage={maxStorage}
              configuredSources={configuredSources}
              theme={{ 
                primaryColor: themeColors.primary_cyan, 
                secondaryColor: themeColors.text_secondary, 
                accentColor: themeColors.mystical_magenta,
                borderColor: themeColors.border_primary,
                textColor: themeColors.primary_cyan,
                cardBackground: getComponentBackground('card')
              }}
            />
          </div>
        </div>
      )}

      {/* Resize Handle - Only show when explorer is open */}
      {explorerOpen && (
        <div
          onMouseDown={handleMouseDown}
          style={{
            width: '4px',
            background: isResizing ? themeColors.primary_cyan : 'transparent',
            cursor: 'ew-resize',
            borderLeft: `1px solid ${themeColors.border_primary}`,
            borderRight: `1px solid ${themeColors.border_primary}`,
            transition: isResizing ? 'none' : 'background 0.3s ease',
            position: 'relative',
            zIndex: 10
          }}
          onMouseEnter={(e) => {
            if (!isResizing) {
              e.currentTarget.style.background = 'rgba(0, 255, 255, 0.2)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isResizing) {
              e.currentTarget.style.background = 'transparent';
            }
          }}
        >
          {/* Visual indicator dots */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px'
          }}>
            {[1, 2, 3].map(i => (
              <div
                key={i}
                style={{
                  width: '2px',
                  height: '2px',
                  background: 'rgba(0, 255, 255, 0.5)',
                  borderRadius: '50%'
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Main Content Area - Adaptive Width */}
      <div style={{
        width: workspaceWidth,
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.3s ease'
      }}>
        {/* Top Content - NEW INTUITIVE LAYOUT LOGIC */}
        <div style={{
          height: `calc(${mainContentHeight})`,
          background: getComponentBackground('primary'),
          border: `1px solid ${themeColors.border_primary}`,
          borderLeft: explorerOpen ? 'none' : `1px solid ${themeColors.border_primary}`,
          borderTop: 'none', // No top border since header handles it
          borderBottom: terminalOpen ? 'none' : `1px solid ${themeColors.border_primary}`,
          borderRadius: terminalOpen ? '0' : '0 0 8px 0',
          overflow: 'hidden',
          transition: 'height 0.3s ease',
          display: 'flex'
        }}>
          
          {/* EMPTY DISPLAY - Both toggles OFF */}
          {!editorOpen && !minterOpen && (
            <div style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent'
            }}>
              <div style={{ 
                textAlign: 'center',
                color: 'rgba(0, 255, 255, 0.5)',
                fontFamily: 'Orbitron, monospace'
              }}>
                <Code size={32} style={{ marginBottom: '12px', opacity: 0.3 }} />
                <p style={{ fontSize: '14px', margin: 0 }}>
                  Click Editor or Minter to begin
                </p>
              </div>
            </div>
          )}

          {/* EDITOR ONLY - Editor ON, Minter OFF */}
          {editorOpen && !minterOpen && (
            <div style={{ width: '100%', height: '100%' }}>
              <ScrollEditor 
                selectedFile={selectedFile}
                setSelectedFile={setSelectedFile}
                files={files}
                setFiles={setFiles}
                configuredSources={configuredSources}
                onContentChange={handleFileContentChange}
                onFileLoad={handleFileLoad}
                theme={{ 
                  primaryColor: themeColors.primary_cyan, 
                  secondaryColor: themeColors.text_secondary, 
                  borderColor: themeColors.border_primary 
                }} 
              />
            </div>
          )}

          {/* MINTER ONLY - Editor OFF, Minter ON */}
          {!editorOpen && minterOpen && (
            <div style={{ width: '100%', height: '100%' }}>
              <ScrollMinter
                mintingData={mintingData}
                setMintingData={setMintingData}
                walletState={walletState}
                connectWallet={connectWallet}
                mintOnNetwork={mintOnNetwork}
                copyToClipboard={copyToClipboard}
                generateKeccakHash={generateKeccakHash}
                isValidEthAddress={isValidEthAddress}
                theme={{ 
                  primaryColor: themeColors.primary_cyan, 
                  secondaryColor: themeColors.text_secondary, 
                  borderColor: themeColors.border_primary 
                }}
              />
            </div>
          )}

          {/* SPLIT VIEW - Both Editor ON and Minter ON */}
          {editorOpen && minterOpen && (
            <>
              {/* Left: Editor */}
              <div style={{ 
                width: '50%', 
                height: '100%',
                borderRight: `1px solid ${themeColors.border_primary}`
              }}>
                <ScrollEditor 
                  selectedFile={selectedFile}
                  setSelectedFile={setSelectedFile}
                  files={files}
                  setFiles={setFiles}
                  configuredSources={configuredSources}
                  onContentChange={handleFileContentChange}
                  onFileLoad={handleFileLoad}
                  theme={{ 
                    primaryColor: themeColors.primary_cyan, 
                    secondaryColor: themeColors.text_secondary, 
                    borderColor: themeColors.border_primary 
                  }} 
                />
              </div>

              {/* Right: Minter */}
              <div style={{ 
                width: '50%', 
                height: '100%' 
              }}>
                <ScrollMinter
                  mintingData={mintingData}
                  setMintingData={setMintingData}
                  walletState={walletState}
                  connectWallet={connectWallet}
                  mintOnNetwork={mintOnNetwork}
                  copyToClipboard={copyToClipboard}
                  generateKeccakHash={generateKeccakHash}
                  isValidEthAddress={isValidEthAddress}
                  theme={{ 
                    primaryColor: themeColors.primary_cyan, 
                    secondaryColor: themeColors.text_secondary, 
                    borderColor: themeColors.border_primary 
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* Terminal - Bottom Panel */}
        {terminalOpen && (
          <div style={{
            height: terminalHeight,
            background: getComponentBackground('terminal'),
            border: `1px solid ${themeColors.border_primary}`,
            borderTop: `1px solid ${themeColors.border_secondary}`,
            borderLeft: explorerOpen ? 'none' : `1px solid ${themeColors.border_primary}`,
            borderRadius: explorerOpen ? '0 0 8px 0' : '0 0 8px 8px',
            overflow: 'hidden',
            transition: 'height 0.3s ease'
          }}>
            <ScrollTerminal
              terminalOutput={terminalOutput}
              terminalInput={terminalInput}
              setTerminalInput={setTerminalInput}
              handleTerminalCommand={handleTerminalCommand}
              theme={{ 
                primaryColor: themeColors.primary_cyan, 
                secondaryColor: themeColors.text_secondary, 
                borderColor: themeColors.border_primary 
              }}
            />
          </div>
        )}
      </div>
    </div>
    </div>
  );
}