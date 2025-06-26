'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

interface RawLog {
  id: string;
  timestamp: Date;
  source: string;
  type: 'session' | 'error' | 'system' | 'agent' | 'tool';
  raw_content: string;
  processed: boolean;
  metadata?: any;
}

interface ProcessedMemory {
  id: string;
  original_log_id: string;
  addressing: string;
  semantic_content: string;
  extracted_insights: string[];
  storage_collection: string;
  processing_status: 'pending' | 'stored' | 'failed';
}

export default function LogProcessor() {
  const [rawLogs, setRawLogs] = useState<RawLog[]>([]);
  const [processedMemories, setProcessedMemories] = useState<ProcessedMemory[]>([]);
  const [selectedLogType, setSelectedLogType] = useState('all');
  const [autoProcessing, setAutoProcessing] = useState(true);
  const [processingStats, setProcessingStats] = useState({
    total_logs: 0,
    processed: 0,
    pending: 0,
    failed: 0
  });

  // Mock data for demonstration
  useEffect(() => {
    const mockLogs: RawLog[] = [
      {
        id: '1',
        timestamp: new Date(),
        source: 'mastermind-terminal',
        type: 'session',
        raw_content: 'User initiated AutoGPT agent creation for authentication system development',
        processed: true,
        metadata: { session_id: 'sess_123' }
      },
      {
        id: '2',
        timestamp: new Date(Date.now() - 300000),
        source: 'agent-execution',
        type: 'agent',
        raw_content: 'Agent deployment completed successfully - cost: $1.23, duration: 8m 34s',
        processed: false,
        metadata: { agent_id: 'agent_456' }
      }
    ];

    const mockMemories: ProcessedMemory[] = [
      {
        id: 'mem_1',
        original_log_id: '1',
        addressing: 'ΞΨΞ|consciousness|development|authentication',
        semantic_content: 'User successfully created AutoGPT agent for authentication system enhancement',
        extracted_insights: ['Agent creation workflow functional', 'Authentication focus area identified'],
        storage_collection: 'hugging_dynamic_memory',
        processing_status: 'stored'
      }
    ];

    setRawLogs(mockLogs);
    setProcessedMemories(mockMemories);
    setProcessingStats({
      total_logs: mockLogs.length,
      processed: mockLogs.filter(log => log.processed).length,
      pending: mockLogs.filter(log => !log.processed).length,
      failed: 0
    });
  }, []);

  const getLogTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      'session': 'rgba(0, 191, 255, 0.2)',
      'error': 'rgba(255, 69, 58, 0.2)',
      'system': 'rgba(50, 215, 75, 0.2)',
      'agent': 'rgba(191, 90, 242, 0.2)',
      'tool': 'rgba(255, 159, 10, 0.2)'
    };
    return colors[type] || 'rgba(128, 128, 128, 0.2)';
  };

  const getLogTypeTextColor = (type: string) => {
    const colors: Record<string, string> = {
      'session': '#00BFFF',
      'error': '#FF453A',
      'system': '#32D74B',
      'agent': '#BF5AF2',
      'tool': '#FF9F0A'
    };
    return colors[type] || '#888888';
  };

  const filteredLogs = selectedLogType === 'all' 
    ? rawLogs 
    : rawLogs.filter(log => log.type === selectedLogType);

  return (
    <div className="h-full flex flex-col" style={{
      background: 'rgba(0, 0, 0, 0.6)',
      color: '#ffffff',
      fontFamily: 'Courier New, monospace'
    }}>
      {/* Header Controls */}
      <div style={{
        borderBottom: '1px solid rgba(0, 255, 255, 0.2)',
        padding: '16px',
        background: 'rgba(0, 255, 255, 0.02)'
      }}>
        <div className="flex items-center justify-between mb-4">
          <h2 style={{
            fontSize: '16px',
            color: '#00ffff',
            fontFamily: 'Courier New, monospace',
            margin: 0
          }}>
            📊 Memory Log Processor
          </h2>
          
          <div className="flex items-center gap-4">
            <select
              value={selectedLogType}
              onChange={(e) => setSelectedLogType(e.target.value)}
              style={{
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(0, 255, 255, 0.3)',
                color: '#ffffff',
                fontFamily: 'Courier New, monospace',
                fontSize: '12px',
                padding: '4px 8px',
                borderRadius: '4px'
              }}
            >
              <option value="all">All Logs</option>
              <option value="session">Session</option>
              <option value="error">Errors</option>
              <option value="system">System</option>
              <option value="agent">Agent</option>
              <option value="tool">Tools</option>
            </select>

            <Button
              onClick={() => setAutoProcessing(!autoProcessing)}
              style={{
                background: autoProcessing ? 'rgba(0, 255, 255, 0.4)' : 'rgba(0, 255, 255, 0.2)',
                border: '1px solid rgba(0, 255, 255, 0.5)',
                color: '#ffffff',
                fontFamily: 'Courier New, monospace',
                fontSize: '11px',
                padding: '4px 12px'
              }}
            >
              {autoProcessing ? '⚡ Auto ON' : '⏸️ Auto OFF'}
            </Button>

            <Button
              disabled={processingStats.pending === 0}
              style={{
                background: processingStats.pending === 0 ? 'rgba(128, 128, 128, 0.2)' : 'rgba(0, 255, 255, 0.4)',
                border: '1px solid rgba(0, 255, 255, 0.5)',
                color: processingStats.pending === 0 ? '#666666' : '#ffffff',
                fontFamily: 'Courier New, monospace',
                fontSize: '11px',
                padding: '4px 12px'
              }}
            >
              🔄 Process Pending ({processingStats.pending})
            </Button>
          </div>
        </div>

        {/* Processing Statistics */}
        <div className="flex items-center gap-4" style={{ fontSize: '12px' }}>
          <span style={{ color: '#888888' }}>
            📊 Total: <span style={{ color: '#00ffff' }}>{processingStats.total_logs}</span>
          </span>
          <span style={{ color: '#888888' }}>
            ✅ Processed: <span style={{ color: '#32D74B' }}>{processingStats.processed}</span>
          </span>
          <span style={{ color: '#888888' }}>
            ⏳ Pending: <span style={{ color: '#FF9F0A' }}>{processingStats.pending}</span>
          </span>
          {processingStats.failed > 0 && (
            <span style={{ color: '#888888' }}>
              ❌ Failed: <span style={{ color: '#FF453A' }}>{processingStats.failed}</span>
            </span>
          )}
        </div>
      </div>

      {/* Split Panel Content */}
      <div className="flex flex-1">
        {/* Raw Logs Panel */}
        <div className="w-1/2" style={{ borderRight: '1px solid rgba(0, 255, 255, 0.2)' }}>
          <div style={{
            padding: '12px',
            borderBottom: '1px solid rgba(0, 255, 255, 0.1)',
            background: 'rgba(0, 0, 0, 0.3)',
            color: '#00ffff',
            fontSize: '14px',
            fontFamily: 'Courier New, monospace'
          }}>
            🗂️ Raw Logs
          </div>
          
          <div className="h-full overflow-y-auto p-4 space-y-3">
            {filteredLogs.map((log) => (
              <div
                key={log.id}
                style={{
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(0, 255, 255, 0.1)',
                  borderRadius: '6px',
                  padding: '12px',
                  opacity: log.processed ? 0.6 : 1
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      style={{
                        background: getLogTypeColor(log.type),
                        color: getLogTypeTextColor(log.type),
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontSize: '10px',
                        fontFamily: 'Courier New, monospace',
                        border: `1px solid ${getLogTypeTextColor(log.type)}30`
                      }}
                    >
                      {log.type.toUpperCase()}
                    </span>
                    <span style={{ color: '#888888', fontSize: '11px' }}>{log.source}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {log.processed ? (
                      <span style={{
                        background: 'rgba(50, 215, 75, 0.2)',
                        color: '#32D74B',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontSize: '10px',
                        fontFamily: 'Courier New, monospace',
                        border: '1px solid #32D74B30'
                      }}>
                        ✅ PROCESSED
                      </span>
                    ) : (
                      <Button
                        style={{
                          background: 'rgba(0, 255, 255, 0.2)',
                          border: '1px solid rgba(0, 255, 255, 0.5)',
                          color: '#00ffff',
                          fontFamily: 'Courier New, monospace',
                          fontSize: '10px',
                          padding: '2px 8px'
                        }}
                      >
                        🔄 PROCESS
                      </Button>
                    )}
                    <span style={{ color: '#666666', fontSize: '10px' }}>
                      {log.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                </div>
                
                <div style={{
                  background: 'rgba(0, 0, 0, 0.3)',
                  padding: '8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontFamily: 'Courier New, monospace',
                  color: '#ffffff',
                  border: '1px solid rgba(0, 255, 255, 0.1)'
                }}>
                  {log.raw_content.substring(0, 200)}
                  {log.raw_content.length > 200 && <span style={{ color: '#888888' }}>...</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Processed Memories Panel */}
        <div className="w-1/2">
          <div style={{
            padding: '12px',
            borderBottom: '1px solid rgba(0, 255, 255, 0.1)',
            background: 'rgba(0, 0, 0, 0.3)',
            color: '#00ffff',
            fontSize: '14px',
            fontFamily: 'Courier New, monospace'
          }}>
            🧠 Processed Memories
          </div>
          
          <div className="h-full overflow-y-auto p-4 space-y-3">
            {processedMemories.map((memory) => (
              <div
                key={memory.id}
                style={{
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(0, 255, 255, 0.1)',
                  borderRadius: '6px',
                  padding: '12px'
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span style={{
                    background: 'rgba(191, 90, 242, 0.2)',
                    color: '#BF5AF2',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    fontSize: '10px',
                    fontFamily: 'Courier New, monospace',
                    border: '1px solid #BF5AF230'
                  }}>
                    {memory.storage_collection}
                  </span>
                  <span style={{
                    background: memory.processing_status === 'stored' ? 'rgba(50, 215, 75, 0.2)' : 
                              memory.processing_status === 'failed' ? 'rgba(255, 69, 58, 0.2)' : 
                              'rgba(255, 159, 10, 0.2)',
                    color: memory.processing_status === 'stored' ? '#32D74B' : 
                           memory.processing_status === 'failed' ? '#FF453A' : 
                           '#FF9F0A',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    fontSize: '10px',
                    fontFamily: 'Courier New, monospace',
                    border: `1px solid ${
                      memory.processing_status === 'stored' ? '#32D74B30' : 
                      memory.processing_status === 'failed' ? '#FF453A30' : 
                      '#FF9F0A30'
                    }`
                  }}>
                    {memory.processing_status.toUpperCase()}
                  </span>
                </div>
                
                <div style={{ fontSize: '11px', marginBottom: '8px' }}>
                  <span style={{ color: '#00ffff', fontFamily: 'Courier New, monospace' }}>Address:</span>
                  <span style={{ color: '#ffffff', marginLeft: '8px', fontFamily: 'Courier New, monospace' }}>
                    {memory.addressing}
                  </span>
                </div>
                
                <div style={{ fontSize: '11px', marginBottom: '8px' }}>
                  <span style={{ color: '#00ffff', fontFamily: 'Courier New, monospace' }}>Content:</span>
                  <div style={{
                    color: '#ffffff',
                    marginTop: '4px',
                    fontFamily: 'Courier New, monospace',
                    background: 'rgba(0, 0, 0, 0.3)',
                    padding: '6px',
                    borderRadius: '3px',
                    border: '1px solid rgba(0, 255, 255, 0.1)'
                  }}>
                    {memory.semantic_content.substring(0, 150)}
                    {memory.semantic_content.length > 150 && <span style={{ color: '#888888' }}>...</span>}
                  </div>
                </div>
                
                {memory.extracted_insights.length > 0 && (
                  <div style={{ fontSize: '11px' }}>
                    <span style={{ color: '#00ffff', fontFamily: 'Courier New, monospace' }}>Insights:</span>
                    <div style={{ marginTop: '4px' }}>
                      {memory.extracted_insights.slice(0, 3).map((insight, idx) => (
                        <div key={idx} style={{
                          color: '#32D74B',
                          fontSize: '10px',
                          fontFamily: 'Courier New, monospace',
                          marginLeft: '8px'
                        }}>
                          • {insight}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}