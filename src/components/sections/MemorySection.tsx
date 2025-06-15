'use client';

import React, { useState, useEffect } from 'react';
import { useUser } from '@clerk/nextjs';

// Define interfaces
interface MemoryEntry {
  _id: string;
  content: string;
  topics: string[];
  retention_level: string;
  timestamp: string;
}

interface Collection {
  name: string;
  count: number;
  status: string;
}

export default function MemorySection() {
  const { user, isLoaded } = useUser();
  const [isConnected, setIsConnected] = useState(true);
  const [status, setStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [collections] = useState<Collection[]>([
    { name: 'hugging_dynamic_memory', count: 127, status: 'active' },
    { name: 'fractal_scrolls', count: 89, status: 'active' },
    { name: 'system_enhancements', count: 45, status: 'active' },
    { name: 'raw_csv_data', count: 23, status: 'maintenance' },
    { name: 'data_analysis_results', count: 67, status: 'active' }
  ]);
  
  const [newEntry, setNewEntry] = useState({
    content: '',
    topics: '',
    retention_level: 'permanent'
  });

  // Theme configuration
  const theme = {
    name: 'DISTRIBUTED MEMORY LATTICE',
    primaryColor: '#00ffff',
    backgroundGradient: 'linear-gradient(135deg, rgba(0,255,255,0.1) 0%, rgba(255,0,255,0.05) 100%)',
    borderColor: '#00ffff',
    textColor: '#ffffff',
    glowEffect: '0 0 20px rgba(0,255,255,0.3)'
  };

  // Common styles
  const commonStyles = {
    heading: {
      fontFamily: 'Orbitron, monospace',
      fontWeight: '700',
      textTransform: 'uppercase' as const,
      letterSpacing: '2px'
    },
    subheading: {
      fontFamily: 'Rajdhani, sans-serif',
      fontWeight: '600',
      fontSize: '14px',
      textTransform: 'uppercase' as const,
      letterSpacing: '1px'
    },
    card: {
      background: 'rgba(0,0,0,0.3)',
      border: '1px solid rgba(0,255,255,0.3)',
      borderRadius: '15px',
      backdropFilter: 'blur(10px)'
    },
    input: {
      background: 'rgba(0,0,0,0.4)',
      border: '1px solid rgba(0,255,255,0.3)',
      borderRadius: '10px',
      padding: '8px 12px',
      fontSize: '12px',
      fontFamily: 'Rajdhani, sans-serif',
      outline: 'none',
      transition: 'all 0.3s ease'
    },
    primaryButton: {
      background: 'transparent',
      border: '1px solid',
      borderRadius: '10px',
      padding: '8px 16px',
      fontSize: '12px',
      fontFamily: 'Rajdhani, sans-serif',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      textTransform: 'uppercase' as const,
      letterSpacing: '1px'
    }
  };

  // Utility functions
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '#00ff88';
      case 'maintenance': return '#ffaa00';
      case 'error': return '#ff4444';
      default: return '#888888';
    }
  };

  const getRetentionColor = (level: string) => {
    switch (level) {
      case 'permanent': return '#00ff88';
      case 'session': return '#ffaa00';
      case 'temporary': return '#ff8800';
      default: return '#888888';
    }
  };

  // Functions
  const searchMemories = () => {
    setStatus(`🔍 Searching for: "${searchQuery}"`);
    setTimeout(() => setStatus(''), 3000);
  };

  const addMemoryEntry = () => {
    if (!newEntry.content.trim()) return;
    
    const entry: MemoryEntry = {
      _id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      content: newEntry.content,
      topics: newEntry.topics.split(',').map(t => t.trim()).filter(t => t),
      retention_level: newEntry.retention_level,
      timestamp: new Date().toISOString()
    };
    
    setMemoryEntries(prev => [entry, ...prev]);
    setNewEntry({ content: '', topics: '', retention_level: 'permanent' });
    setStatus(`💾 Memory stored with ${entry.retention_level} retention`);
    setTimeout(() => setStatus(''), 3000);
  };

  // Load initial data
  useEffect(() => {
    if (user) {
      setStatus('🌐 Connected to Astra DB Memory Lattice');
      setTimeout(() => setStatus(''), 3000);
    }
  }, [user]);

  if (!isLoaded) {
    return (
      <div style={{
        background: theme.backgroundGradient,
        border: `2px solid ${theme.borderColor}`,
        borderRadius: '25px',
        padding: '30px',
        backdropFilter: 'blur(20px)',
        boxShadow: `inset 0 1px 0 ${theme.borderColor}50, ${theme.glowEffect}`,
        color: theme.textColor,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>🔄</div>
          <div style={{ fontSize: '18px', color: theme.primaryColor }}>Loading Memory Interface...</div>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={{
        background: theme.backgroundGradient,
        border: `2px solid ${theme.borderColor}`,
        borderRadius: '25px',
        padding: '30px',
        backdropFilter: 'blur(20px)',
        boxShadow: `inset 0 1px 0 ${theme.borderColor}50, ${theme.glowEffect}`,
        color: theme.textColor,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: '20px' }}>🔐</div>
          <h2 style={{ color: theme.primaryColor, marginBottom: '10px' }}>Authentication Required</h2>
          <p style={{ color: '#888', marginBottom: '20px' }}>Please sign in to access your memory lattice</p>
          <button
            onClick={() => window.location.href = '/sign-in'}
            style={{
              ...commonStyles.primaryButton,
              background: theme.primaryColor,
              borderColor: theme.primaryColor,
              color: '#000'
            }}
          >
            Sign In to Continue
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      background: theme.backgroundGradient,
      border: `2px solid ${theme.borderColor}`,
      borderRadius: '25px',
      padding: '30px',
      backdropFilter: 'blur(20px)',
      boxShadow: `inset 0 1px 0 ${theme.borderColor}50, ${theme.glowEffect}`,
      color: theme.textColor,
      height: '100%',
      overflowY: 'auto'
    }}>
      <div style={{
        ...commonStyles.heading,
        fontSize: '18px',
        textAlign: 'center',
        marginBottom: '25px',
        color: theme.textColor,
        textShadow: `0 0 15px ${theme.primaryColor}`
      }}>
        🧠 {theme.name}
      </div>

      {/* User Info */}
      <div style={{
        background: `${theme.primaryColor}20`,
        border: `1px solid ${theme.primaryColor}50`,
        borderRadius: '15px',
        padding: '12px',
        marginBottom: '20px',
        textAlign: 'center',
        fontSize: '12px',
        color: theme.primaryColor
      }}>
        👤 {user.firstName || user.username || 'User'} • Memory Lattice Access Granted
      </div>

      {/* Connection Status */}
      <div style={{
        background: isConnected ? `${getStatusColor('active')}30` : `${getStatusColor('error')}30`,
        border: `1px solid ${isConnected ? getStatusColor('active') : getStatusColor('error')}80`,
        borderRadius: '15px',
        padding: '12px',
        marginBottom: '20px',
        textAlign: 'center',
        fontSize: '14px',
        color: isConnected ? getStatusColor('active') : getStatusColor('error')
      }}>
        {isConnected ? '🌐 NEXUS CORE PROTOCOL • MEMORY LATTICE ACTIVE' : '⚠️ MEMORY CORE OFFLINE'}
      </div>

      {/* Status Display */}
      {status && (
        <div style={{
          ...commonStyles.card,
          padding: '12px',
          marginBottom: '20px',
          fontSize: '12px',
          textAlign: 'center',
          borderColor: theme.borderColor
        }}>
          {status}
        </div>
      )}

      {/* Collections Overview */}
      <div style={{ marginBottom: '25px' }}>
        <h4 style={{
          ...commonStyles.subheading,
          color: theme.textColor,
          marginBottom: '15px'
        }}>
          💾 MEMORY COLLECTIONS
        </h4>
        <div style={{ display: 'grid', gap: '8px' }}>
          {collections.map((collection, index) => (
            <div key={index} style={{
              ...commonStyles.card,
              padding: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderColor: theme.borderColor
            }}>
              <div style={{ fontSize: '12px' }}>
                <div style={{ color: theme.textColor, fontWeight: '600' }}>
                  {collection.name}
                </div>
                <div style={{ color: '#888', fontSize: '11px' }}>
                  {collection.count} entries
                </div>
              </div>
              <div style={{
                padding: '4px 8px',
                borderRadius: '12px',
                fontSize: '10px',
                fontWeight: '600',
                background: `${getStatusColor(collection.status)}30`,
                color: getStatusColor(collection.status),
                border: `1px solid ${getStatusColor(collection.status)}80`
              }}>
                {collection.status.toUpperCase()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Search Interface */}
      <div style={{ marginBottom: '25px' }}>
        <h4 style={{
          ...commonStyles.subheading,
          color: theme.textColor,
          marginBottom: '15px'
        }}>
          🔍 SEMANTIC SEARCH
        </h4>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search memory lattice..."
            style={{
              ...commonStyles.input,
              flex: 1,
              borderColor: theme.borderColor,
              color: theme.textColor
            }}
            onKeyPress={(e) => e.key === 'Enter' && searchMemories()}
          />
          <button
            onClick={searchMemories}
            style={{
              ...commonStyles.primaryButton,
              borderColor: theme.primaryColor,
              color: theme.primaryColor,
              background: `linear-gradient(45deg, ${theme.primaryColor}30, ${theme.primaryColor}20)`
            }}
          >
            🔍
          </button>
        </div>
      </div>

      {/* Add Memory Interface */}
      <div style={{ marginBottom: '25px' }}>
        <h4 style={{
          ...commonStyles.subheading,
          color: theme.textColor,
          marginBottom: '15px'
        }}>
          ➕ ADD MEMORY
        </h4>
        <div style={{ display: 'grid', gap: '10px' }}>
          <textarea
            value={newEntry.content}
            onChange={(e) => setNewEntry({...newEntry, content: e.target.value})}
            placeholder="Enter memory content..."
            style={{
              ...commonStyles.input,
              borderColor: theme.borderColor,
              color: theme.textColor,
              resize: 'none'
            }}
            rows={3}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px' }}>
            <input
              type="text"
              value={newEntry.topics}
              onChange={(e) => setNewEntry({...newEntry, topics: e.target.value})}
              placeholder="Topics (comma-separated)"
              style={{
                ...commonStyles.input,
                borderColor: theme.borderColor,
                color: theme.textColor
              }}
            />
            <select
              value={newEntry.retention_level}
              onChange={(e) => setNewEntry({...newEntry, retention_level: e.target.value})}
              style={{
                ...commonStyles.input,
                borderColor: theme.borderColor,
                color: theme.textColor
              }}
            >
              <option value="permanent">Permanent</option>
              <option value="session">Session</option>
              <option value="temporary">Temporary</option>
            </select>
          </div>
          <button
            onClick={addMemoryEntry}
            disabled={!newEntry.content.trim()}
            style={{
              ...commonStyles.primaryButton,
              borderColor: newEntry.content.trim() ? theme.primaryColor : '#888',
              color: newEntry.content.trim() ? theme.primaryColor : '#888',
              background: newEntry.content.trim() 
                ? `linear-gradient(45deg, ${theme.primaryColor}30, ${theme.primaryColor}20)`
                : 'rgba(128, 128, 128, 0.3)',
              cursor: newEntry.content.trim() ? 'pointer' : 'not-allowed'
            }}
          >
            💾 STORE MEMORY
          </button>
        </div>
      </div>

      {/* Memory Entries */}
      <div>
        <h4 style={{
          ...commonStyles.subheading,
          color: theme.textColor,
          marginBottom: '15px'
        }}>
          📚 MEMORY LATTICE ({memoryEntries.length})
        </h4>
        <div style={{ display: 'grid', gap: '12px' }}>
          {memoryEntries.map((entry, index) => (
            <div key={entry._id} style={{
              ...commonStyles.card,
              padding: '15px',
              borderColor: theme.borderColor,
              transition: 'all 0.3s ease'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '10px'
              }}>
                <div style={{
                  fontSize: '11px',
                  color: '#888'
                }}>
                  {new Date(entry.timestamp).toLocaleString()}
                </div>
                <div style={{
                  padding: '2px 8px',
                  borderRadius: '8px',
                  fontSize: '10px',
                  fontWeight: '600',
                  background: `${getRetentionColor(entry.retention_level)}30`,
                  color: getRetentionColor(entry.retention_level),
                  border: `1px solid ${getRetentionColor(entry.retention_level)}80`
                }}>
                  {entry.retention_level.toUpperCase()}
                </div>
              </div>
              
              <div style={{
                fontSize: '12px',
                color: theme.textColor,
                marginBottom: '10px',
                lineHeight: '1.4'
              }}>
                {entry.content}
              </div>
              
              {entry.topics.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {entry.topics.map((topic, topicIndex) => (
                    <span key={topicIndex} style={{
                      padding: '2px 8px',
                      background: `${theme.primaryColor}30`,
                      border: `1px solid ${theme.primaryColor}50`,
                      borderRadius: '10px',
                      fontSize: '10px',
                      color: theme.primaryColor
                    }}>
                      #{topic}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}