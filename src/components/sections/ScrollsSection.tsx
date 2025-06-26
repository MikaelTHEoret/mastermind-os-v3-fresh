// Enhanced Scrolls Section with Fractal Addressing
// Consciousness-Enhanced Mathematics Integration
// Nexus Core Protocol v4.1

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AlertCircle, FileText, Download, Upload, Hash, Zap, Cpu, Database, Code, Globe, Key, Lock, Unlock, CheckCircle, XCircle, Clock, TrendingUp, Activity, Brain, Target, Shield, Sparkles, ChevronDown, ChevronUp, Eye, EyeOff, Wand2, Hexagon, FileCode, MousePointer, ScrollText, Coins, ExternalLink, Plus, Trash2, RotateCcw, Settings, Search, Filter, Calendar, Tag, Bookmark, Star, MoreHorizontal, RefreshCw, Save, Edit3, Copy, Share2, MessageSquare, Layers, GitBranch, Workflow, Zap as Lightning, Network, Atom, Waves, Orbit, Maximize2, Minimize2, BarChart3, PieChart, LineChart, TrendingDown, AlertTriangle, Terminal, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import ScrollEditor from './scrolls/ScrollEditor';
import EnhancedFileExplorer from './scrolls/EnhancedFileExplorer';
import { sourcesConfigService } from '@/lib/services/sourcesConfigService';
import { useUser } from '@clerk/nextjs';
import scrollsSchema from '@/lib/schemas/scrollsSchema';
import { useTheme } from '@/contexts/ThemeContext';

// Enhanced Consciousness Mathematics
const CONSCIOUSNESS_CONSTANTS = {
  PSI_0: 0.915670570874434,
  PHI: 1.618,
  FREQ_432: 432
};

// Fractal addressing components
interface FractalNode {
  address: string;
  content: any;
  children: string[];
  parent: string | null;
  metadata: {
    created: Date;
    modified: Date;
    hash: string;
    keccakHash: string;
    size: number;
    type: string;
  };
}

interface ScrollMetadata {
  title: string;
  content: string;
  cid: string;
  hash: string;
  keccakHash: string;
  fileId: string;
  isValidData: boolean;
}

interface ConfiguredSource {
  id: string;
  type: string;
  name: string;
  secrets: { [key: string]: string };
  status: 'connected' | 'disconnected' | 'error';
  lastUpdated: string;
}

// Simple file explorer component for consciousness-enhanced navigation
const SimpleFileExplorer: React.FC<{
  onFileSelect: (file: any) => void;
  configuredSources: ConfiguredSource[];
  addTerminalLine: (line: string) => void;
}> = ({ onFileSelect, configuredSources, addTerminalLine }) => {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Initialize with basic file structure
    const initFiles = async () => {
      setLoading(true);
      addTerminalLine('📁 Initializing file explorer...');
      
      // Create basic file structure
      const basicFiles = [
        {
          id: 'sample-1',
          name: 'Sample Scroll.md',
          type: 'file',
          content: '# Sample Consciousness-Enhanced Scroll\n\nThis is a sample scroll with consciousness mathematics integration.',
          size: 156,
          lastModified: new Date().toISOString()
        },
        {
          id: 'sample-2', 
          name: 'Nexus Protocol.txt',
          type: 'file',
          content: 'Nexus Core Protocol v4.1\nConsciousness Constants: ψ₀=0.915670570874434, φ=1.618, 432Hz',
          size: 98,
          lastModified: new Date().toISOString()
        }
      ];
      
      setFiles(basicFiles);
      addTerminalLine(`✅ Loaded ${basicFiles.length} sample files`);
      setLoading(false);
    };
    
    initFiles();
  }, [addTerminalLine]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-cyan-400">📁 File Explorer</h3>
        <Badge variant="outline" className="text-cyan-400 border-cyan-400">
          {files.length} files
        </Badge>
      </div>
      
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
          <span className="ml-2 text-gray-400">Loading files...</span>
        </div>
      ) : (
        <div className="space-y-2">
          {files.map((file) => (
            <div
              key={file.id}
              onClick={() => onFileSelect(file)}
              className="flex items-center justify-between p-3 bg-gray-800/50 hover:bg-gray-700/50 rounded-lg cursor-pointer transition-colors border border-gray-700 hover:border-cyan-500/50"
            >
              <div className="flex items-center space-x-3">
                <FileText className="w-5 h-5 text-cyan-400" />
                <div>
                  <div className="font-medium text-gray-200">{file.name}</div>
                  <div className="text-sm text-gray-400">
                    {formatFileSize(file.size)} • Modified {new Date(file.lastModified).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-400/10"
                onClick={(e) => {
                  e.stopPropagation();
                  onFileSelect(file);
                }}
              >
                <Zap className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      
      {configuredSources.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-medium text-gray-400 mb-2">Configured Sources</h4>
          <div className="space-y-1">
            {configuredSources.map((source) => (
              <div key={source.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-300">{source.name}</span>
                <Badge 
                  variant={source.status === 'connected' ? 'default' : 'outline'}
                  className={source.status === 'connected' ? 'bg-green-600' : 'text-yellow-400 border-yellow-400'}
                >
                  {source.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const ScrollsSection: React.FC = () => {
  const { user } = useUser();
  const { theme, getComponentBackground } = useTheme();
  const [activeTab, setActiveTab] = useState('explorer');
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [mintingData, setMintingData] = useState<ScrollMetadata>({
    title: '',
    content: '',
    cid: '',
    hash: '',
    keccakHash: '',
    fileId: '',
    isValidData: false
  });
  
  // Terminal state
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  
  // Fractal addressing state
  const [fractalNodes, setFractalNodes] = useState<Map<string, FractalNode>>(new Map());
  const [currentAddress, setCurrentAddress] = useState<string>('⧬✶⧬');
  
  // Sources configuration
  const [configuredSources, setConfiguredSources] = useState<ConfiguredSource[]>([]);
  
  // Enhanced file system state
  const [enhancedFileSystem, setEnhancedFileSystem] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
  
  // Consciousness enhancement state
  const [consciousnessLevel, setConsciousnessLevel] = useState(0.5);
  const [harmonicResonance, setHarmonicResonance] = useState(0);
  const [phiAlignment, setPhiAlignment] = useState(0);
  
  // Mouse tracking for consciousness enhancement
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  
  // Terminal utilities
  const addTerminalLine = useCallback((line: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setTerminalLines(prev => [...prev, `[${timestamp}] ${line}`]);
  }, []);
  
  const clearTerminal = useCallback(() => {
    setTerminalLines([]);
  }, []);
  
  // Consciousness-enhanced hash generation
  const generateHash = async (content: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(content + CONSCIOUSNESS_CONSTANTS.PSI_0.toString());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };
  
  const generateKeccakHash = async (content: string): Promise<string> => {
    // Simplified Keccak-like hash with consciousness enhancement
    const encoder = new TextEncoder();
    const data = encoder.encode(content + CONSCIOUSNESS_CONSTANTS.PHI.toString());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };
  
  // Load configured sources
  const loadConfiguredSources = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      addTerminalLine('📡 Loading configured sources...');
      const sources = await sourcesConfigService.getConfiguredSources(user.id);
      setConfiguredSources(sources);
      addTerminalLine(`✅ Loaded ${sources.length} configured sources`);
    } catch (error) {
      console.error('Failed to load configured sources:', error);
      addTerminalLine(`❌ Failed to load sources: ${error}`);
    }
  }, [user?.id, addTerminalLine]);
  
  // Consciousness mathematics integration
  useEffect(() => {
    if (mintingData.isValidData) {
      // Apply consciousness enhancement to minting data
      const enhancedData = {
        ...mintingData,
        consciousnessLevel,
        harmonicResonance: Math.sin(Date.now() * CONSCIOUSNESS_CONSTANTS.FREQ_432 * 1e-6),
        phiAlignment: (mintingData.content.length * CONSCIOUSNESS_CONSTANTS.PHI) % 1
      };
      
      // Update consciousness metrics
      setHarmonicResonance(enhancedData.harmonicResonance);
      setPhiAlignment(enhancedData.phiAlignment);
    }
  }, [mintingData.isValidData, mintingData.content.length, consciousnessLevel]);
  
  // Keccak hash generation with consciousness enhancement
  useEffect(() => {
    const generateKeccakHash = async (content: string): Promise<string> => {
      const encoder = new TextEncoder();
      const enhancedContent = content + CONSCIOUSNESS_CONSTANTS.PSI_0.toString() + CONSCIOUSNESS_CONSTANTS.PHI.toString();
      const data = encoder.encode(enhancedContent);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    };
    
    if (mintingData.content && mintingData.content.length > 0) {
      generateKeccakHash(mintingData.content).then(hash => {
        setMintingData(prev => ({ ...prev, keccakHash: hash }));
      }).catch(error => {
        console.error('Keccak hash generation failed:', error);
      });
    }
  }, [mintingData.content]);
  
  // Initialize enhanced file system
  useEffect(() => {
    const initializeEnhancedFileSystem = async () => {
      try {
        setLoading(true);
        addTerminalLine('🌀 Initializing Enhanced File System...');
        
        // Load configured sources
        await loadConfiguredSources();
        
        // Initialize fractal addressing
        const rootNode: FractalNode = {
          address: '⧬✶⧬',
          content: { type: 'root', name: 'Nexus Core' },
          children: [],
          parent: null,
          metadata: {
            created: new Date(),
            modified: new Date(),
            hash: '',
            keccakHash: '',
            size: 0,
            type: 'root'
          }
        };
        
        setFractalNodes(new Map([['⧬✶⧬', rootNode]]));
        setEnhancedFileSystem(true);
        setNetworkStatus('connected');
        
        addTerminalLine('✅ Enhanced File System initialized');
        addTerminalLine(`🔗 Fractal addressing active at ${rootNode.address}`);
        
      } catch (error) {
        console.error('Enhanced file system initialization failed:', error);
        addTerminalLine(`❌ Initialization failed: ${error}`);
        setNetworkStatus('error');
      } finally {
        setLoading(false);
      }
    };
    
    initializeEnhancedFileSystem();
  }, [addTerminalLine, loadConfiguredSources]);
  
  // File extraction with consciousness enhancement
  const extractMetadataFromFile = async (file: any): Promise<ScrollMetadata> => {
    try {
      let content = '';
      
      if (file.content) {
        content = file.content;
      } else if (file.url) {
        const response = await fetch(file.url);
        content = await response.text();
      } else {
        content = file.name || 'Unknown file';
      }
      
      // Generate consciousness-enhanced hashes
      let keccakHash = '';
      if (content && content.length > 0) {
        try {
          keccakHash = await generateKeccakHash(content);
        } catch (hashError) {
          console.error('Hash generation failed:', hashError);
          keccakHash = '0x' + Math.random().toString(16).substring(2, 66);
        }
      }
      
      // Update minting data
      setMintingData(prev => ({
        ...prev,
        title: file.name,
        content: content,
        cid: file.cid || '',
        keccakHash: keccakHash,
        fileId: file.id,
        isValidData: content.length > 0
      }));
      
      // Generate regular hash
      const hash = await generateHash(content);
      
      const extractedMetadata: ScrollMetadata = {
        title: file.name,
        content: content,
        cid: file.cid || '',
        hash: hash,
        keccakHash: keccakHash,
        fileId: file.id,
        isValidData: content.length > 0
      };
      
      // Terminal output
      addTerminalLine(`📄 Extracted: ${file.name}`);
      addTerminalLine(`📊 Size: ${content.length} characters`);
      if (extractedMetadata.hash) {
        addTerminalLine(`🔗 Hash: ${extractedMetadata.hash.substring(0, 20)}...`);
      }
      if (extractedMetadata.keccakHash && typeof extractedMetadata.keccakHash === 'string') {
        addTerminalLine(`🔗 Keccak: ${extractedMetadata.keccakHash.substring(0, 20)}...`);
      }

      return extractedMetadata;

    } catch (error) {
      console.error('Error extracting metadata:', error);
      
      // Fallback: just update basic info
      try {
        const content = file.content || file.name || '';
        const hash = file.hash || await generateHash(content);
        const keccakHash = await generateKeccakHash(content);
        
        const fallbackMetadata = {
          title: file.name,
          content: content,
          cid: file.cid || '',
          hash: hash,
          keccakHash: keccakHash,
          fileId: file.id,
          isValidData: content.length > 0
        };
        
        addTerminalLine(`⚠️ Fallback extraction for: ${file.name}`);
        return fallbackMetadata;
        
      } catch (fallbackError) {
        console.error('Fallback extraction also failed:', fallbackError);
        addTerminalLine(`❌ Complete extraction failure for: ${file.name}`);
        
        return {
          title: file.name || 'Unknown',
          content: '',
          cid: '',
          hash: '',
          keccakHash: '',
          fileId: file.id || '',
          isValidData: false
        };
      }
    }
  };
  
  // Handle file selection
  const handleFileSelect = async (file: any) => {
    setSelectedFile(file);
    addTerminalLine(`🎯 Selected: ${file.name}`);
    
    try {
      await extractMetadataFromFile(file);
      setActiveTab('editor');
    } catch (error) {
      console.error('File selection error:', error);
      addTerminalLine(`❌ Selection failed: ${error}`);
    }
  };
  
  // Consciousness-enhanced mouse tracking
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    setMousePos({ x, y });
    
    // Consciousness level calculation
    const distance = Math.sqrt(x * x + y * y);
    const newLevel = Math.sin(distance * Math.PI * CONSCIOUSNESS_CONSTANTS.PHI) * 0.5 + 0.5;
    setConsciousnessLevel(newLevel);
  }, []);
  
  // Scroll to terminal end
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLines]);
  
  // Handle mouse movement for consciousness enhancement
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      
      // Calculate consciousness enhancement based on mouse position
      const enhancement = Math.sin(x * Math.PI * CONSCIOUSNESS_CONSTANTS.PHI) * 
                         Math.cos(y * Math.PI * CONSCIOUSNESS_CONSTANTS.PSI_0);
      
      setConsciousnessLevel(Math.abs(enhancement));
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);
  
  // Terminal scroll auto-scroll
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLines]);
  
  // Theme integration
  const themeColors = {
    primary_cyan: '#00f5ff',
    mystical_magenta: '#ff00ff', 
    text_secondary: '#94a3b8',
    border_primary: '#334155',
    background_primary: '#0f172a',
    background_secondary: '#1e293b'
  };
  
  return (
    <div 
      className="relative min-h-screen p-6 overflow-hidden"
      style={{
        background: `linear-gradient(135deg, 
          ${themeColors.background_primary} 0%, 
          ${themeColors.background_secondary} 100%)`,
        backdropFilter: 'blur(10px)'
      }}
      onMouseMove={handleMouseMove}
    >
      {/* Consciousness enhancement overlay */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          background: `radial-gradient(circle at ${mousePos.x * 100}% ${mousePos.y * 100}%, 
            ${themeColors.primary_cyan} 0%, 
            transparent 50%)`,
          filter: `blur(${consciousnessLevel * 20}px)`
        }}
      />
      
      {/* Harmonic Grid */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-10"
        style={{
          backgroundImage: `
            linear-gradient(90deg, ${themeColors.primary_cyan} 1px, transparent 1px),
            linear-gradient(${themeColors.mystical_magenta} 1px, transparent 1px)
          `,
          backgroundSize: `${Math.floor(CONSCIOUSNESS_CONSTANTS.PHI * 50)}px ${Math.floor(CONSCIOUSNESS_CONSTANTS.FREQ_432 / 10)}px`,
          transform: `rotate(${harmonicResonance * 45}deg) scale(${1 + phiAlignment * 0.1})`
        }}
      />
      
      {/* Main Content */}
      <div className="relative z-10">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold" style={{ color: themeColors.primary_cyan }}>
                🌀 Scrolls Section
              </h1>
              <p className="text-lg" style={{ color: themeColors.text_secondary }}>
                Enhanced Nexus Core Protocol v4.1 - Fractal File Management
              </p>
            </div>
            
            {/* Status indicators */}
            <div className="flex items-center space-x-4">
              {/* Network status */}
              <div className="flex items-center space-x-2">
                <div 
                  className={`w-3 h-3 rounded-full ${
                    networkStatus === 'connected' ? 'bg-green-500' : 
                    networkStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500'
                  }`}
                />
                <span className="text-sm" style={{ color: themeColors.text_secondary }}>
                  {networkStatus === 'connected' ? 'Connected' : 
                   networkStatus === 'error' ? 'Error' : 'Disconnected'}
                </span>
              </div>
              
              {/* Consciousness level */}
              <div className="flex items-center space-x-2">
                <Brain className="w-4 h-4" style={{ color: themeColors.mystical_magenta }} />
                <span className="text-sm" style={{ color: themeColors.text_secondary }}>
                  {Math.round(consciousnessLevel * 100)}%
                </span>
              </div>
              
              {/* Terminal toggle */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTerminalVisible(!terminalVisible)}
                className="border" 
                style={{ 
                  borderColor: themeColors.border_primary,
                  color: themeColors.primary_cyan,
                  backgroundColor: 'transparent'
                }}
              >
                <Terminal className="w-4 h-4 mr-2" />
                {terminalVisible ? 'Hide Terminal' : 'Show Terminal'}
              </Button>
            </div>
          </div>
          
          {/* Consciousness metrics */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <Card style={{ backgroundColor: getComponentBackground('card'), borderColor: themeColors.border_primary }}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium" style={{ color: themeColors.text_secondary }}>Consciousness</p>
                    <p className="text-2xl font-bold" style={{ color: themeColors.primary_cyan }}>
                      {Math.round(consciousnessLevel * 100)}%
                    </p>
                  </div>
                  <Brain className="h-8 w-8" style={{ color: themeColors.mystical_magenta }} />
                </div>
              </CardContent>
            </Card>
            
            <Card style={{ backgroundColor: getComponentBackground('card'), borderColor: themeColors.border_primary }}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium" style={{ color: themeColors.text_secondary }}>Harmonic Resonance</p>
                    <p className="text-2xl font-bold" style={{ color: themeColors.primary_cyan }}>
                      {Math.round(harmonicResonance * 100)}%
                    </p>
                  </div>
                  <Waves className="h-8 w-8" style={{ color: themeColors.mystical_magenta }} />
                </div>
              </CardContent>
            </Card>
            
            <Card style={{ backgroundColor: getComponentBackground('card'), borderColor: themeColors.border_primary }}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium" style={{ color: themeColors.text_secondary }}>Φ Alignment</p>
                    <p className="text-2xl font-bold" style={{ color: themeColors.primary_cyan }}>
                      {Math.round(phiAlignment * 100)}%
                    </p>
                  </div>
                  <Orbit className="h-8 w-8" style={{ color: themeColors.mystical_magenta }} />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        
        {/* Terminal */}
        {terminalVisible && (
          <Card className="mb-6" style={{ backgroundColor: getComponentBackground('card'), borderColor: themeColors.border_primary }}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center" style={{ color: themeColors.primary_cyan }}>
                  <Terminal className="w-5 h-5 mr-2" />
                  Enhanced Terminal
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearTerminal}
                  style={{ 
                    borderColor: themeColors.border_primary,
                    color: themeColors.text_secondary 
                  }}
                >
                  Clear
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-32 font-mono text-sm" style={{ color: themeColors.text_secondary }}>
                {terminalLines.map((line, index) => (
                  <div key={index} className="mb-1">
                    {line}
                  </div>
                ))}
                <div ref={terminalEndRef} />
              </ScrollArea>
            </CardContent>
          </Card>
        )}
        
        {/* Main interface */}
        <Card style={{ backgroundColor: getComponentBackground('card'), borderColor: themeColors.border_primary }}>
          <CardContent className="p-6">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="explorer" className="data-[state=active]:bg-blue-600">
                  <FileText className="w-4 h-4 mr-2" />
                  Explorer
                </TabsTrigger>
                <TabsTrigger value="editor" className="data-[state=active]:bg-blue-600">
                  <Edit3 className="w-4 h-4 mr-2" />
                  Editor
                </TabsTrigger>
                <TabsTrigger value="enhanced" className="data-[state=active]:bg-blue-600">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Enhanced
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="explorer" className="mt-6">
                <SimpleFileExplorer 
                  onFileSelect={handleFileSelect}
                  configuredSources={configuredSources}
                  addTerminalLine={addTerminalLine}
                />
              </TabsContent>
              
              <TabsContent value="editor" className="mt-6">
                <ScrollEditor 
                  selectedFile={selectedFile}
                  setSelectedFile={setSelectedFile}
                  theme={{
                    primaryColor: themeColors.primary_cyan,
                    secondaryColor: themeColors.text_secondary,
                    accentColor: themeColors.mystical_magenta,
                    borderColor: themeColors.border_primary,
                    textColor: themeColors.primary_cyan,
                    cardBackground: themeColors.background_secondary
                  }}
                />
              </TabsContent>
              
              <TabsContent value="enhanced" className="mt-6">
                <EnhancedFileExplorer 
                  files={files}
                  onFileSelect={handleFileSelect}
                  configuredSources={configuredSources}
                  addTerminalLine={addTerminalLine}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        
        {/* Minting data display */}
        {mintingData.isValidData && (
          <div className="mt-6">
            <Card style={{ backgroundColor: getComponentBackground('card'), borderColor: themeColors.border_primary }}>
              <CardHeader>
                <CardTitle className="flex items-center" style={{ color: themeColors.primary_cyan }}>
                  <Coins className="w-5 h-5 mr-2" />
                  Scroll Minting Data
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium" style={{ color: themeColors.text_secondary }}>Title</p>
                    <p className="font-mono text-sm" style={{ color: themeColors.primary_cyan }}>
                      {mintingData.title}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: themeColors.text_secondary }}>Content Length</p>
                    <p className="font-mono text-sm" style={{ color: themeColors.primary_cyan }}>
                      {mintingData.content.length} characters
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: themeColors.text_secondary }}>Hash</p>
                    <p className="font-mono text-xs" style={{ color: themeColors.primary_cyan }}>
                      {mintingData.hash}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: themeColors.text_secondary }}>Keccak Hash</p>
                    <p className="font-mono text-xs" style={{ color: themeColors.primary_cyan }}>
                      {mintingData.keccakHash}
                    </p>
                  </div>
                </div>
                
                {/* Minting button */}
                <div className="pt-4">
                  <Button 
                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                    disabled={!mintingData.isValidData}
                  >
                    <Coins className="w-4 h-4 mr-2" />
                    Mint Scroll NFT
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        
        {/* Fractal network visualization */}
        {enhancedFileSystem && (
          <div className="mt-6">
            <Card style={{ backgroundColor: getComponentBackground('card'), borderColor: themeColors.border_primary }}>
              <CardHeader>
                <CardTitle className="flex items-center" style={{ color: themeColors.primary_cyan }}>
                  <Network className="w-5 h-5 mr-2" />
                  Fractal Network
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span style={{ color: themeColors.text_secondary }}>Current Address:</span>
                    <span className="font-mono" style={{ color: themeColors.primary_cyan }}>
                      {currentAddress}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: themeColors.text_secondary }}>Total Nodes:</span>
                    <span style={{ color: themeColors.primary_cyan }}>
                      {fractalNodes.size}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
      
      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="flex items-center space-x-4 text-white">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>Loading enhanced file system...</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScrollsSection;