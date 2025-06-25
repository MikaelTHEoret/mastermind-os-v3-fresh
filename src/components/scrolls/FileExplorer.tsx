'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Plus, Folder, Upload, GitBranch, FolderOpen, ChevronRight, ChevronDown, 
  Search, Code, Zap, Lock, Unlock
} from 'lucide-react';

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
  storage: 'native' | 'ipfs' | 'github';
  parent?: string;
  children?: string[];
  mimeType?: string;
  isExpanded?: boolean;
  requiresAuth?: boolean;
}

interface FileExplorerProps {
  files: Map<string, FileItem>;
  setFiles: React.Dispatch<React.SetStateAction<Map<string, FileItem>>>;
  selectedFile: FileItem | null;
  onFileSelect: (file: FileItem) => void;
  onFileCreate: (name: string, content?: string, parent?: string) => FileItem | null;
  onFileUpload: (file: FileItem) => void;
  onFilePushToGitHub: (file: FileItem) => void;
  onFileLoadIntoMinter: (file: FileItem) => void;
  activeEditorTab: string | null;
  isAuthAvailable: boolean;
  userSettings: any;
  storageUsed: number;
  maxStorage: number;
  addTerminalLine: (line: string) => void;
}

export default function FileExplorer({
  files,
  setFiles,
  selectedFile,
  onFileSelect,
  onFileCreate,
  onFileUpload,
  onFilePushToGitHub,
  onFileLoadIntoMinter,
  activeEditorTab,
  isAuthAvailable,
  userSettings,
  storageUsed,
  maxStorage,
  addTerminalLine
}: FileExplorerProps) {
  const [searchQuery, setSearchQuery] = useState('');

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

  const getFileIcon = (file: FileItem) => {
    if (file.type === 'folder') {
      return file.isExpanded ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />;
    }
    return <Code className="h-4 w-4" />;
  };

  const renderFileTree = (files: Map<string, FileItem>, parentId: string = 'native-root', level: number = 0) => {
    const parent = files.get(parentId);
    if (!parent || !parent.children) return null;
    
    return parent.children.map(childId => {
      const file = files.get(childId);
      if (!file) return null;
      
      if (searchQuery && !file.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return null;
      }
      
      return (
        <div key={file.id} style={{ marginLeft: `${level * 16}px` }}>
          <div
            onClick={() => {