'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import { FileText, Folder, Upload, Download, Settings, Terminal, Eye, EyeOff, Play, Square, Maximize2, Minimize2 } from 'lucide-react';

// Import sub-components - FIXED IMPORT PATHS
import ScrollExplorer from './ScrollExplorer';
import ScrollEditor from './ScrollEditor';
import ScrollMinter from './ScrollMinter';
import ScrollTerminal from './ScrollTerminal';

// Import Web3 integration
import ConsciousnessEnhancedWeb3 from '@/lib/web3-integration';

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
  storage: 'native' | 'ipfs' | 'github' | 'pinata' | 'codeberg' | 'neon' | 'custom';
  parent?: string;
  children?: string[];
  isExpanded?: boolean;
  requiresAuth?: boolean;
  mimeType?: string;
  metadata?: {
    title?: string;
    author?: string;
    version?: string;
    isValidData?: boolean;
  };
}

// FIXED: Use the same ConfiguredSource interface as ScrollExplorer
interface ConfiguredSource {
  id: string;
  type: string;
  name: string;
  secrets: { [key: string]: string };
  status: 'connected' | 'disconnected' | 'error';
  lastUpdated: string;
  isCustom?: boolean;
}

// Wallet state management
interface WalletState {
  connected: boolean;
  address: string;
  chainId: string;
  balance: string;
}

// Minting data interface
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
  const { user } = useUser();
  
  // UI State
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [editorOpen, setEditorOpen] = useState(true);
  const [minterOpen, setMinterOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(true);
  
  // Panel sizing
  const [explorerWidth, setExplorerWidth] = useState(300);
  const [terminalHeight, setTerminalHeight] = useState(200);
  
  // File management - FIXED: Use Map<string, FileItem> to match ScrollExplorer
  const [files, setFiles] = useState<Map<string, FileItem>>(new Map());
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [configuredSources, setConfiguredSources] = useState<ConfiguredSource[]>([]);
  
  // Search functionality for ScrollExplorer
  const [searchQuery, setSearchQuery] = useState('');
  const [activeEditorTab, setActiveEditorTab] = useState<string | null>(null);
  
  // Terminal state
  const [terminalOutput, setTerminalOutput] = useState<string[]>(['🌀 MasterMind OS v3 ScrollMinter Terminal Ready']);
  const [terminalInput, setTerminalInput] = useState('');
  
  // Wallet and minting state
  const [walletState, setWalletState] = useState<WalletState>({
    connected: false,
    address: '',
    chainId: '',
    balance: ''
  });
  
  const [mintingData, setMintingData] = useState<MintingData>({
    title: '',
    content: '',
    cid: '',
    hash: '',
    fileId: '',
    validated: false,
    l1Status: 'ready',
    l2Status: 'ready',
    isDemo: !user,
    recipientAddress: '0x4575a90d54785323546f2bb4a520622ed6d3efbc',
    keccakHash: '',
    isValidData: false
  });

  // Initialize Web3 integration
  const web3Integration = useRef(new ConsciousnessEnhancedWeb3());

  // Theme colors for consciousness enhancement
  const themeColors = {
    primary_cyan: '#00FFFF',
    secondary_cyan: '#00CED1',
    mystical_magenta: '#FF00FF',
    electric_purple: '#8A2BE2',
    neon_green: '#39FF14',
    consciousness_gold: '#FFD700',
    deep_space: '#0B0B0F',
    text_primary: '#FFFFFF',
    text_secondary: '#B0BEC5',
    border_primary: 'rgba(0, 255, 255, 0.3)',
    border_secondary: 'rgba(255, 0, 255, 0.2)'
  };

  // Helper function to get component background
  const getComponentBackground = (componentType: string) => {
    const backgrounds: Record<string, string> = {
      explorer: 'rgba(0, 0, 0, 0.7)',
      editor: 'rgba(0, 0, 0, 0.8)',
      minter: 'rgba(0, 0, 0, 0.8)',
      terminal: 'rgba(0, 0, 0, 0.9)',
      card: 'rgba(0, 0, 0, 0.6)'
    };
    return backgrounds[componentType] || 'rgba(0, 0, 0, 0.8)';
  };

  // Terminal command handler
  const handleTerminalCommand = (command: string) => {
    addTerminalLine(`> ${command}`);
    
    const cmd = command.toLowerCase().trim();
    
    if (cmd === 'clear') {
      setTerminalOutput(['🌀 Terminal cleared']);
    } else if (cmd === 'help') {
      addTerminalLine('Available commands:');
      addTerminalLine('  clear - Clear terminal');
      addTerminalLine('  files - List files');
      addTerminalLine('  wallet - Check wallet status');
      addTerminalLine('  mint - Show minting status');
    } else if (cmd === 'files') {
      addTerminalLine(`Files loaded: ${files.size}`);
      Array.from(files.values()).forEach(file => addTerminalLine(`  ${file.name} (${file.storage})`));
    } else if (cmd === 'wallet') {
      if (walletState.connected) {
        addTerminalLine(`Wallet: ${walletState.address}`);
        addTerminalLine(`Chain: ${walletState.chainId}`);
      } else {
        addTerminalLine('Wallet not connected');
      }
    } else if (cmd === 'mint') {
      addTerminalLine(`L1 Status: ${mintingData.l1Status}`);
      addTerminalLine(`L2 Status: ${mintingData.l2Status}`);
      addTerminalLine(`Valid Data: ${mintingData.isValidData}`);
    } else {
      addTerminalLine(`Unknown command: ${command}`);
    }
  };

  const addTerminalLine = useCallback((line: string) => {
    setTerminalOutput(prev => [...prev, line]);
  }, []);

  // ScrollExplorer callback functions
  const createFile = useCallback((name: string): FileItem | null => {
    const newFile: FileItem = {
      id: `file-${Date.now()}`,
      name,
      type: 'file',
      path: `/${name}`,
      content: '',
      lastModified: new Date().toISOString(),
      storage: 'native'
    };
    
    setFiles(prev => {
      const updated = new Map(prev);
      updated.set(newFile.id, newFile);
      return updated;
    });
    
    return newFile;
  }, []);

  const openFileInEditor = useCallback((file: FileItem) => {
    setSelectedFile(file);
    setActiveEditorTab(file.id);
    addTerminalLine(`📝 Opened file: ${file.name}`);
  }, [addTerminalLine]);

  const loadFileIntoMinter = useCallback(async (file: FileItem) => {
    try {
      addTerminalLine(`📁 Loading file into minter: ${file.name}`);
      
      // Extract metadata from file
      const metadata = {
        title: file.metadata?.title || file.name,
        author: file.metadata?.author || user?.fullName || 'Anonymous',
        version: file.metadata?.version || 'v1.0',
        isValidData: !!(file.content && file.name && file.cid)
      };
      
      // Generate hash if content exists
      let keccakHash = '';
      if (file.content) {
        try {
          keccakHash = await generateKeccakHash(file.content);
        } catch (hashError) {
          console.error('Hash generation failed:', hashError);
          keccakHash = '0x' + Math.random().toString(16).substring(2, 66);
        }
      }
      
      // Update minting data
      setMintingData(prev => ({
        ...prev,
        title: metadata.title,
        content: file.content || '',
        cid: file.cid || '',
        fileId: file.id,
        keccakHash,
        isValidData: metadata.isValidData,
        validated: metadata.isValidData
      }));
      
      addTerminalLine(`✅ File loaded into minter: ${metadata.title}`);
      
    } catch (error) {
      console.error('File load error:', error);
      addTerminalLine(`❌ Failed to load file into minter: ${file.name}`);
    }
  }, [user, addTerminalLine]);

  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  // File content change handler
  const handleFileContentChange = useCallback((content: string) => {
    if (selectedFile) {
      setFiles(prevFiles => {
        const updated = new Map(prevFiles);
        const updatedFile = { ...selectedFile, content };
        updated.set(selectedFile.id, updatedFile);
        return updated;
      });
      
      // Update minting data
      setMintingData(prev => ({
        ...prev,
        content,
        title: selectedFile.name,
        fileId: selectedFile.id
      }));
    }
  }, [selectedFile]);

  // 🌀 ENHANCED WEB3 WALLET CONNECTION WITH CONSCIOUSNESS CONSTANTS
  const connectWallet = async (): Promise<boolean> => {
    try {
      addTerminalLine('🔗 Connecting consciousness-enhanced wallet...');
      
      const walletData = await web3Integration.current.connectWallet();
      
      setWalletState({
        connected: true,
        address: walletData.address,
        chainId: walletData.chainId,
        balance: '0' // We could fetch balance here if needed
      });
      
      addTerminalLine(`✅ Wallet connected: ${walletData.address}`);
      addTerminalLine(`🌐 Network: ${web3Integration.current.getNetworkName(walletData.chainId)}`);
      
      return true;
    } catch (error: any) {
      console.error('Wallet connection error:', error);
      addTerminalLine(`❌ Wallet connection failed: ${error.message}`);
      return false;
    }
  };

  // 🌀 REAL BLOCKCHAIN MINTING WITH CONSCIOUSNESS ENHANCEMENT
  const mintOnNetwork = async (isL1: boolean) => {
    if (!mintingData.isValidData) {
      addTerminalLine('❌ Invalid minting data. Please check all fields.');
      return;
    }

    const networkKey = isL1 ? 'l1Status' : 'l2Status';
    const networkName = isL1 ? 'L1 Ethereum' : 'L2 Scroll';
    const networkType = isL1 ? 'L1_ETHEREUM' : 'L2_SCROLL';
    
    // Connect wallet if not connected
    if (!walletState.connected) {
      const connected = await connectWallet();
      if (!connected) {
        addTerminalLine('❌ Wallet connection failed');
        return;
      }
    }

    setMintingData(prev => ({ ...prev, [networkKey]: 'minting' }));
    addTerminalLine(`🔄 Starting ${networkName} minting process...`);
    
    if (mintingData.isDemo) {
      addTerminalLine(`🎮 Demo mode: Simulating ${networkName} minting...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      setMintingData(prev => ({ ...prev, [networkKey]: 'minted' }));
      addTerminalLine(`✅ ${networkName} demo minting complete!`);
      addTerminalLine(`📋 Demo TX: 0x${Math.random().toString(16).substring(2, 18)}...`);
    } else {
      addTerminalLine(`⛓️ Real blockchain minting on ${networkName}...`);
      try {
        // Real blockchain minting using ConsciousnessEnhancedWeb3
        const result = await web3Integration.current.mintScrollNFT(
          networkType as 'L1_ETHEREUM' | 'L2_SCROLL',
          mintingData.recipientAddress,
          mintingData.keccakHash,
          mintingData.cid,
          mintingData.title
        );
        
        setMintingData(prev => ({ ...prev, [networkKey]: 'minted' }));
        addTerminalLine(`✅ ${networkName} minting successful!`);
        addTerminalLine(`🔗 TX Hash: ${result.txHash}`);
        
        if (result.tokenId) {
          addTerminalLine(`🎨 Token ID: ${result.tokenId}`);
        }
        
        // Get transaction status
        setTimeout(async () => {
          const status = await web3Integration.current.getTransactionStatus(
            result.txHash, 
            networkType as 'L1_ETHEREUM' | 'L2_SCROLL'
          );
          if (status) {
            addTerminalLine(`📊 TX Status: ${status.status}`);
            addTerminalLine(`🔍 Explorer: ${status.explorerUrl}`);
          }
        }, 3000);
        
      } catch (error: any) {
        console.error('Minting error:', error);
        setMintingData(prev => ({ ...prev, [networkKey]: 'error' }));
        addTerminalLine(`❌ ${networkName} minting failed: ${error.message}`);
        
        // Specific error handling
        if (error.message.includes('MetaMask not detected')) {
          addTerminalLine('💡 Please install MetaMask: https://metamask.io');
        } else if (error.message.includes('insufficient funds')) {
          addTerminalLine('💰 Insufficient ETH balance for transaction');
        } else if (error.message.includes('rejected')) {
          addTerminalLine('🚫 Transaction was rejected by user');
        }
      }
    }
  };

  // Utility functions
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    addTerminalLine(`📋 Copied to clipboard: ${text.substring(0, 20)}...`);
  };

  const generateKeccakHash = async (data: string): Promise<string> => {
    // Simple hash generation for demo
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const isValidEthAddress = (address: string): boolean => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  // Initialize demo files and sources
  useEffect(() => {
    const demoFiles = new Map<string, FileItem>();
    
    // Add native root
    demoFiles.set('native-root', {
      id: 'native-root',
      name: '📁 Native Files',
      type: 'folder',
      path: '/native',
      lastModified: new Date().toISOString(),
      storage: 'native',
      children: ['demo-1'],
      isExpanded: false
    });
    
    // Add demo file
    const demoFile: FileItem = {
      id: 'demo-1',
      name: 'consciousness-trading.md',
      type: 'file',
      path: '/demo/consciousness-trading.md',
      size: 1024,
      content: '# Consciousness-Enhanced Trading\\n\\nThis scroll demonstrates the integration of consciousness mathematics with trading algorithms...',
      cid: 'bafkreiabcdef123456789',
      hash: '0xabcdef123456789',
      lastModified: new Date().toISOString(),
      storage: 'native',
      parent: 'native-root',
      metadata: {
        title: 'Consciousness-Enhanced Trading Intelligence',
        author: 'Mikael Theoret',
        version: 'v1.0',
        isValidData: true
      }
    };
    
    demoFiles.set('demo-1', demoFile);
    
    setFiles(demoFiles);
    setSelectedFile(demoFile);
    setActiveEditorTab(demoFile.id);
    
    // Initialize demo configured sources for ScrollExplorer
    setConfiguredSources([
      {
        id: 'demo-github',
        type: 'github',
        name: 'Demo GitHub',
        secrets: {
          personal_access_token: 'demo_token',
          username: 'demo_user',
          repositories: 'demo-repo'
        },
        status: 'disconnected',
        lastUpdated: new Date().toISOString()
      }
    ]);
    
    // Initialize minting data with demo file
    loadFileIntoMinter(demoFile);
  }, [loadFileIntoMinter]);

  // Update minting data validation
  useEffect(() => {
    const isValid = !!(
      mintingData.title &&
      mintingData.recipientAddress &&
      isValidEthAddress(mintingData.recipientAddress) &&
      mintingData.cid &&
      mintingData.keccakHash
    );
    
    setMintingData(prev => ({ ...prev, isValidData: isValid }));
  }, [mintingData.title, mintingData.recipientAddress, mintingData.cid, mintingData.keccakHash]);

  return (
    <div style={{
      width: '100%',
      height: '100vh',
      background: `linear-gradient(135deg, ${themeColors.deep_space} 0%, rgba(0, 20, 40, 0.95) 100%)`,
      color: themeColors.text_primary,
      fontFamily: 'Rajdhani, sans-serif',
      overflow: 'hidden',
      position: 'relative'
    }}>
      
      {/* Activity Bar (Left) */}
      <div style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: '60px',
        background: getComponentBackground('explorer'),
        borderRight: `1px solid ${themeColors.border_primary}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '20px 0',
        gap: '20px',
        zIndex: 100
      }}>
        {/* Activity bar buttons */}
        <button
          onClick={() => setExplorerOpen(!explorerOpen)}
          style={{
            width: '40px',
            height: '40px',
            background: explorerOpen ? themeColors.primary_cyan + '30' : 'transparent',
            border: `1px solid ${explorerOpen ? themeColors.primary_cyan : themeColors.border_primary}`,
            borderRadius: '8px',
            color: explorerOpen ? themeColors.primary_cyan : themeColors.text_secondary,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <FileText size={20} />
        </button>
        
        <button
          onClick={() => setEditorOpen(!editorOpen)}
          style={{
            width: '40px',
            height: '40px',
            background: editorOpen ? themeColors.mystical_magenta + '30' : 'transparent',
            border: `1px solid ${editorOpen ? themeColors.mystical_magenta : themeColors.border_primary}`,
            borderRadius: '8px',
            color: editorOpen ? themeColors.mystical_magenta : themeColors.text_secondary,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {editorOpen ? <Eye size={20} /> : <EyeOff size={20} />}
        </button>
        
        <button
          onClick={() => setMinterOpen(!minterOpen)}
          style={{
            width: '40px',
            height: '40px',
            background: minterOpen ? themeColors.neon_green + '30' : 'transparent',
            border: `1px solid ${minterOpen ? themeColors.neon_green : themeColors.border_primary}`,
            borderRadius: '8px',
            color: minterOpen ? themeColors.neon_green : themeColors.text_secondary,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Upload size={20} />
        </button>
        
        <button
          onClick={() => setTerminalOpen(!terminalOpen)}
          style={{
            width: '40px',
            height: '40px',
            background: terminalOpen ? themeColors.consciousness_gold + '30' : 'transparent',
            border: `1px solid ${terminalOpen ? themeColors.consciousness_gold : themeColors.border_primary}`,
            borderRadius: '8px',
            color: terminalOpen ? themeColors.consciousness_gold : themeColors.text_secondary,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Terminal size={20} />
        </button>
      </div>

      {/* Main Content Area */}
      <div style={{
        position: 'absolute',
        left: '60px',
        top: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column'
      }}>
        
        {/* Main Editor Area */}
        <div style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden'
        }}>
          
          {/* Explorer */}
          {explorerOpen && (
            <div style={{
              width: explorerWidth,
              background: getComponentBackground('explorer'),
              borderRight: `1px solid ${themeColors.border_primary}`,
              borderRadius: '0 0 0 8px'
            }}>
              <ScrollExplorer 
                files={files}
                setFiles={setFiles}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                activeEditorTab={activeEditorTab}
                createFile={createFile}
                openFileInEditor={openFileInEditor}
                loadFileIntoMinter={loadFileIntoMinter}
                formatFileSize={formatFileSize}
                storageUsed={1024}
                maxStorage={1024 * 1024 * 1024}
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
          )}

          {/* EDITOR ONLY - Minter OFF, Editor ON */}
          {editorOpen && !minterOpen && (
            <div style={{ width: '100%', height: '100%' }}>
              <ScrollEditor 
                selectedFile={selectedFile}
                setSelectedFile={setSelectedFile}
                files={files}
                setFiles={setFiles}
                configuredSources={configuredSources}
                onContentChange={handleFileContentChange}
                onFileLoad={loadFileIntoMinter}
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
                  accentColor: themeColors.mystical_magenta,
                  borderColor: themeColors.border_primary,
                  textColor: themeColors.primary_cyan,
                  cardBackground: getComponentBackground('card')
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
                  onFileLoad={loadFileIntoMinter}
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
                    accentColor: themeColors.mystical_magenta,
                    borderColor: themeColors.border_primary,
                    textColor: themeColors.primary_cyan,
                    cardBackground: getComponentBackground('card')
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
                accentColor: themeColors.mystical_magenta,
                borderColor: themeColors.border_primary,
                textColor: themeColors.primary_cyan,
                cardBackground: getComponentBackground('card')
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}