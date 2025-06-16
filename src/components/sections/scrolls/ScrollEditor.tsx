'use client';

import { useState, useEffect } from 'react';
import { Code, X, Plus, Save, FileText, Loader } from 'lucide-react';
import { FileContentLoader } from './FileContentLoader';

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

interface ScrollEditorProps {
  selectedFile?: FileItem | null;
  setSelectedFile?: (file: FileItem | null) => void;
  files?: Map<string, FileItem>;
  setFiles?: (files: Map<string, FileItem>) => void;
  configuredSources?: ConfiguredSource[];
  onContentChange?: (fileId: string, content: string) => void;
  onFileLoad?: (file: FileItem, content: string) => void;
  theme: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    borderColor: string;
    textColor: string;
    cardBackground: string;
  };
}

export default function ScrollEditor({ 
  selectedFile, 
  setSelectedFile, 
  files, 
  setFiles,
  configuredSources = [],
  onContentChange,
  onFileLoad,
  theme 
}: ScrollEditorProps) {
  const [editorContent, setEditorContent] = useState('');
  const [openTabs, setOpenTabs] = useState<FileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [fileContentLoader] = useState(() => new FileContentLoader(configuredSources));

  // Update file loader when sources change
  useEffect(() => {
    fileContentLoader['configuredSources'] = configuredSources;
  }, [configuredSources, fileContentLoader]);

  // Load content when selectedFile changes
  useEffect(() => {
    if (selectedFile && selectedFile.id) {
      loadFileContent(selectedFile);
    }
  }, [selectedFile?.id]);

  // Track content changes
  useEffect(() => {
    if (selectedFile && editorContent !== selectedFile.content) {
      setHasUnsavedChanges(true);
      onContentChange?.(selectedFile.id, editorContent);
    } else {
      setHasUnsavedChanges(false);
    }
  }, [editorContent, selectedFile, onContentChange]);

  const loadFileContent = async (file: FileItem) => {
    if (!file || file.type !== 'file') return;

    setIsLoading(true);
    try {
      let content = file.content || '';
      
      // If file doesn't have content loaded, load it from source
      if (!file.content && file.storage !== 'native') {
        console.log(`Loading content for ${file.name} from ${file.storage}...`);
        content = await fileContentLoader.loadFileContent(file);
        
        // Update the file in the files map with loaded content
        if (setFiles && files) {
          const updatedFiles = new Map(files);
          const updatedFile = { ...file, content };
          updatedFiles.set(file.id, updatedFile);
          setFiles(updatedFiles);
          
          // Update selectedFile reference
          if (setSelectedFile) {
            setSelectedFile(updatedFile);
          }
        }
      }

      setEditorContent(content);
      setHasUnsavedChanges(false);

      // Add to tabs if not already open
      if (!openTabs.find(tab => tab.id === file.id)) {
        setOpenTabs(prev => [...prev, file]);
      }

      // Notify parent component about file load
      onFileLoad?.(file, content);

    } catch (error) {
      console.error(`Failed to load content for ${file.name}:`, error);
      setEditorContent(`// Error loading file content: ${error.message}\n// File: ${file.name}\n// Storage: ${file.storage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedFile || !setFiles || !files) {
      console.error('Cannot save: missing file or setFiles function');
      return;
    }

    setIsSaving(true);
    try {
      console.log(`Saving ${selectedFile.name} to ${selectedFile.storage}...`);
      
      // Save content using the file content loader
      const updatedFile = await fileContentLoader.saveFileContent(selectedFile, editorContent);
      
      // Update the files map
      const updatedFiles = new Map(files);
      updatedFiles.set(selectedFile.id, updatedFile);
      setFiles(updatedFiles);
      
      // Update selectedFile reference
      if (setSelectedFile) {
        setSelectedFile(updatedFile);
      }

      // Update tab reference
      setOpenTabs(prev => prev.map(tab => 
        tab.id === selectedFile.id ? updatedFile : tab
      ));

      setHasUnsavedChanges(false);
      console.log(`✅ Saved ${selectedFile.name} successfully`);

    } catch (error) {
      console.error(`Failed to save ${selectedFile.name}:`, error);
      alert(`Failed to save file: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const closeTab = (fileToClose: FileItem) => {
    const newTabs = openTabs.filter(tab => tab.id !== fileToClose.id);
    setOpenTabs(newTabs);
    
    if (selectedFile?.id === fileToClose.id) {
      const nextFile = newTabs.length > 0 ? newTabs[0] : null;
      if (setSelectedFile) setSelectedFile(nextFile);
      setEditorContent(nextFile?.content || '');
      setHasUnsavedChanges(false);
    }
  };

  const selectTab = (file: FileItem) => {
    if (setSelectedFile) setSelectedFile(file);
    loadFileContent(file);
  };

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(0, 0, 0, 0.4)',
      overflow: 'hidden'
    }}>
      {/* Tab Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(0, 0, 0, 0.6)',
        borderBottom: `1px solid ${theme.borderColor}`,
        minHeight: '32px',
        overflow: 'hidden'
      }}>
        {openTabs.map((tab) => (
          <div
            key={tab.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '4px 8px',
              background: selectedFile?.id === tab.id ? 'rgba(0, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.3)',
              border: `1px solid ${theme.borderColor}`,
              borderBottom: 'none',
              cursor: 'pointer',
              fontSize: '12px',
              color: selectedFile?.id === tab.id ? theme.primaryColor : 'rgba(0, 255, 255, 0.7)',
              fontFamily: 'Courier New, monospace',
              maxWidth: '150px',
              borderRadius: '4px 4px 0 0',
              position: 'relative'
            }}
            onClick={() => selectTab(tab)}
          >
            <Code size={12} style={{ marginRight: '4px' }} />
            <span style={{ 
              overflow: 'hidden', 
              textOverflow: 'ellipsis', 
              whiteSpace: 'nowrap',
              flex: 1
            }}>
              {tab.name}
            </span>
            
            {/* Unsaved changes indicator */}
            {selectedFile?.id === tab.id && hasUnsavedChanges && (
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#ff6b6b',
                marginLeft: '4px',
                marginRight: '2px'
              }} />
            )}
            
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab);
              }}
              style={{
                marginLeft: '4px',
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: '0',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>

      {/* Editor Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {selectedFile ? (
          <>
            {/* Editor Toolbar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              background: 'rgba(0, 0, 0, 0.5)',
              borderBottom: `1px solid ${theme.borderColor}`,
              fontSize: '12px',
              color: theme.primaryColor,
              fontFamily: 'Rajdhani, sans-serif'
            }}>
              {/* File info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={14} />
                <span style={{ fontSize: '11px', color: theme.secondaryColor }}>
                  {selectedFile.storage.toUpperCase()} • {selectedFile.mimeType || 'text/plain'}
                </span>
                {hasUnsavedChanges && (
                  <span style={{ fontSize: '11px', color: '#ff6b6b' }}>
                    • Unsaved changes
                  </span>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '8px' }}>
                {/* Auto-save indicator */}
                {selectedFile.storage === 'native' && (
                  <span style={{ fontSize: '10px', color: 'rgba(0, 255, 255, 0.6)' }}>
                    Auto-save enabled
                  </span>
                )}

                {/* Save button */}
                <button
                  onClick={handleSave}
                  disabled={isSaving || !hasUnsavedChanges}
                  style={{
                    padding: '6px 12px',
                    background: hasUnsavedChanges 
                      ? 'linear-gradient(135deg, rgba(0, 255, 255, 0.2), rgba(0, 255, 255, 0.1))' 
                      : 'rgba(0, 0, 0, 0.3)',
                    border: `1px solid ${hasUnsavedChanges ? theme.borderColor : 'rgba(128, 128, 128, 0.3)'}`,
                    borderRadius: '4px',
                    color: hasUnsavedChanges ? theme.primaryColor : 'rgba(128, 128, 128, 0.7)',
                    fontSize: '11px',
                    cursor: hasUnsavedChanges ? 'pointer' : 'not-allowed',
                    fontFamily: 'Rajdhani, sans-serif',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    opacity: isSaving ? 0.6 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (hasUnsavedChanges && !isSaving) {
                      e.currentTarget.style.background = 'rgba(0, 255, 255, 0.3)'
                      e.currentTarget.style.boxShadow = `0 0 10px ${theme.primaryColor}40`
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (hasUnsavedChanges) {
                      e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0, 255, 255, 0.2), rgba(0, 255, 255, 0.1))'
                      e.currentTarget.style.boxShadow = 'none'
                    }
                  }}
                >
                  {isSaving ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>

            {/* Text Editor */}
            {isLoading ? (
              <div style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0, 0, 0, 0.8)'
              }}>
                <div style={{ textAlign: 'center' }}>
                  <Loader size={32} className="animate-spin" style={{ color: theme.primaryColor, marginBottom: '12px' }} />
                  <p style={{ color: theme.primaryColor, fontSize: '14px' }}>
                    Loading {selectedFile.name}...
                  </p>
                </div>
              </div>
            ) : (
              <textarea
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                style={{
                  flex: 1,
                  width: '100%',
                  padding: '16px',
                  background: 'rgba(0, 0, 0, 0.8)',
                  border: 'none',
                  outline: 'none',
                  color: '#00ffff',
                  fontSize: '14px',
                  fontFamily: 'Courier New, monospace',
                  lineHeight: '1.4',
                  resize: 'none',
                  overflow: 'auto'
                }}
                placeholder={`Edit ${selectedFile.name}...`}
              />
            )}
          </>
        ) : (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.8)'
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '48px', color: `rgba(0, 255, 255, 0.3)`, marginBottom: '16px' }}>📝</div>
              <h3 style={{ 
                fontSize: '18px', 
                color: theme.primaryColor, 
                marginBottom: '8px',
                fontFamily: 'Orbitron, monospace'
              }}>
                Select a scroll file to start editing
              </h3>
              <p style={{ 
                color: theme.secondaryColor, 
                fontSize: '14px',
                fontFamily: 'Rajdhani, sans-serif',
                opacity: 0.7
              }}>
                Create new files or click on existing scrolls in the explorer
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
