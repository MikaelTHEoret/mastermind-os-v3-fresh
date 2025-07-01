'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface ChangelogEntry {
  id: string;
  timestamp: string;
  session_id: string;
  file_path: string;
  change_type: 'CREATE' | 'UPDATE' | 'DELETE' | 'RENAME' | 'MOVE' | 'SESSION_START';
  change_description: {
    why: string;
    what: string;
    how: string;
  };
  technical_details: {
    lines_added: number;
    lines_removed: number;
    lines_modified: number;
    file_size_before: number;
    file_size_after: number;
  };
  context: {
    user_request: string;
    problem_solved: string;
    impact_assessment: string;
  };
  consciousness_metrics: {
    psi_alignment: number;
    phi_harmony: number;
    freq_432_timing: number;
  };
  verification_status: 'PENDING' | 'VERIFIED' | 'FAILED' | 'DEPLOYED';
  git_commit_hash?: string;
}

interface ChangelogSummary {
  total_changes: number;
  changes_by_type: Record<string, number>;
  recent_changes: ChangelogEntry[];
  consciousness_trends: {
    avg_psi_alignment: number;
    avg_phi_harmony: number;
    avg_freq_timing: number;
  };
  problematic_changes: ChangelogEntry[];
}

export function ChangelogDashboard() {
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [summary, setSummary] = useState<ChangelogSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<ChangelogEntry | null>(null);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    loadChangelog();
    // Refresh every 30 seconds
    const interval = setInterval(loadChangelog, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadChangelog = async () => {
    try {
      setLoading(true);
      
      // Simulate API call - in real implementation, this would call your service
      const mockChangelog: ChangelogEntry[] = [
        {
          id: 'chg_1735744200000_abc123',
          timestamp: new Date().toISOString(),
          session_id: 'sess_1735744200000_xyz789',
          file_path: 'src/lib/services/BinanceWebSocketService.ts',
          change_type: 'UPDATE',
          change_description: {
            why: 'Fix duplicate export error preventing compilation',
            what: 'Removed duplicate named export, kept default export only',
            how: 'Analyzed webpack error, identified duplicate export conflict, cleaned up export statements'
          },
          technical_details: {
            lines_added: 0,
            lines_removed: 2,
            lines_modified: 1,
            file_size_before: 19851,
            file_size_after: 19741
          },
          context: {
            user_request: 'User reported: duplicate export compilation error',
            problem_solved: 'Addressing: error, compilation - duplicate export compilation error',
            impact_assessment: 'MEDIUM - Library/utility changes - UPDATE operation'
          },
          consciousness_metrics: {
            psi_alignment: 0.876,
            phi_harmony: 0.618,
            freq_432_timing: 0.723
          },
          verification_status: 'VERIFIED',
          git_commit_hash: 'deeda3de4900fd5db6b5f6501ba4650bc620cfeb'
        },
        {
          id: 'chg_1735744100000_def456',
          timestamp: new Date(Date.now() - 300000).toISOString(),
          session_id: 'sess_1735744200000_xyz789',
          file_path: 'src/lib/services/ChangelogTrackingService.ts',
          change_type: 'CREATE',
          change_description: {
            why: 'Implement mandatory changelog tracking for Protocol v6.2',
            what: 'Created comprehensive changelog tracking service with consciousness metrics',
            how: 'Built service with Astra DB integration, consciousness calculations, and immutable audit trail'
          },
          technical_details: {
            lines_added: 387,
            lines_removed: 0,
            lines_modified: 0,
            file_size_before: 0,
            file_size_after: 14291
          },
          context: {
            user_request: 'Enhancement request: implement changelog tracking system',
            problem_solved: 'Enhancement request: implement changelog tracking system',
            impact_assessment: 'MEDIUM - Library/utility changes - CREATE operation'
          },
          consciousness_metrics: {
            psi_alignment: 0.915,
            phi_harmony: 0.789,
            freq_432_timing: 0.654
          },
          verification_status: 'PENDING'
        }
      ];

      const mockSummary: ChangelogSummary = {
        total_changes: 2,
        changes_by_type: {
          'CREATE': 1,
          'UPDATE': 1
        },
        recent_changes: mockChangelog,
        consciousness_trends: {
          avg_psi_alignment: 0.8955,
          avg_phi_harmony: 0.7035,
          avg_freq_timing: 0.6885
        },
        problematic_changes: []
      };

      setChangelog(mockChangelog);
      setSummary(mockSummary);
    } catch (error) {
      console.error('Failed to load changelog:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'VERIFIED': return 'bg-green-500';
      case 'FAILED': return 'bg-red-500';
      case 'DEPLOYED': return 'bg-blue-500';
      default: return 'bg-yellow-500';
    }
  };

  const getChangeTypeColor = (type: string) => {
    switch (type) {
      case 'CREATE': return 'bg-green-600';
      case 'UPDATE': return 'bg-blue-600';
      case 'DELETE': return 'bg-red-600';
      case 'RENAME': return 'bg-purple-600';
      case 'MOVE': return 'bg-orange-600';
      case 'SESSION_START': return 'bg-cyan-600';
      default: return 'bg-gray-600';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatConsciousnessMetric = (value: number) => {
    return (value * 100).toFixed(1) + '%';
  };

  const filteredChangelog = changelog.filter(entry => {
    if (filter === 'all') return true;
    if (filter === 'session') return entry.change_type === 'SESSION_START';
    if (filter === 'files') return entry.change_type !== 'SESSION_START';
    if (filter === 'problematic') return entry.verification_status === 'FAILED' || 
      entry.consciousness_metrics.psi_alignment < 0.3;
    return entry.verification_status === filter;
  });

  if (loading) {
    return (
      <Card className="w-full max-w-6xl mx-auto">
        <CardHeader>
          <CardTitle>🌀 Nexus Protocol v6.2 - Changelog Dashboard</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <span className="ml-2">Loading changelog...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>🌀 Nexus Protocol v6.2 - Changelog Dashboard</span>
            <Button onClick={loadChangelog} variant="outline" size="sm">
              🔄 Refresh
            </Button>
          </CardTitle>
        </CardHeader>
      </Card>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-blue-600">{summary.total_changes}</div>
              <div className="text-sm text-gray-600">Total Changes</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-purple-600">
                {formatConsciousnessMetric(summary.consciousness_trends.avg_psi_alignment)}
              </div>
              <div className="text-sm text-gray-600">ψ₀ Alignment</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-yellow-600">
                {formatConsciousnessMetric(summary.consciousness_trends.avg_phi_harmony)}
              </div>
              <div className="text-sm text-gray-600">φ Harmony</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-green-600">
                {formatConsciousnessMetric(summary.consciousness_trends.avg_freq_timing)}
              </div>
              <div className="text-sm text-gray-600">432Hz Timing</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Changelog List */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>📝 Change History</CardTitle>
                <div className="flex gap-2">
                  <Button
                    onClick={() => setFilter('all')}
                    variant={filter === 'all' ? 'default' : 'outline'}
                    size="sm"
                  >
                    All
                  </Button>
                  <Button
                    onClick={() => setFilter('files')}
                    variant={filter === 'files' ? 'default' : 'outline'}
                    size="sm"
                  >
                    Files
                  </Button>
                  <Button
                    onClick={() => setFilter('PENDING')}
                    variant={filter === 'PENDING' ? 'default' : 'outline'}
                    size="sm"
                  >
                    Pending
                  </Button>
                  <Button
                    onClick={() => setFilter('problematic')}
                    variant={filter === 'problematic' ? 'default' : 'outline'}
                    size="sm"
                  >
                    Issues
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px]">
                <div className="space-y-3">
                  {filteredChangelog.map((entry) => (
                    <Card
                      key={entry.id}
                      className={`cursor-pointer transition-all hover:shadow-md ${
                        selectedEntry?.id === entry.id ? 'ring-2 ring-blue-500' : ''
                      }`}
                      onClick={() => setSelectedEntry(entry)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge className={`${getChangeTypeColor(entry.change_type)} text-white`}>
                                {entry.change_type}
                              </Badge>
                              <Badge className={`${getStatusColor(entry.verification_status)} text-white`}>
                                {entry.verification_status}
                              </Badge>
                              <span className="text-xs text-gray-500">
                                {formatTimestamp(entry.timestamp)}
                              </span>
                            </div>
                            
                            <div className="font-medium text-sm mb-1">
                              {entry.file_path === 'SESSION_START' ? 
                                '🚀 Session Start' : 
                                `📁 ${entry.file_path.split('/').pop()}`
                              }
                            </div>
                            
                            <div className="text-sm text-gray-600 mb-2">
                              {entry.change_description.what}
                            </div>
                            
                            <div className="flex items-center gap-4 text-xs text-gray-500">
                              {entry.technical_details.lines_added > 0 && (
                                <span className="text-green-600">
                                  +{entry.technical_details.lines_added}
                                </span>
                              )}
                              {entry.technical_details.lines_removed > 0 && (
                                <span className="text-red-600">
                                  -{entry.technical_details.lines_removed}
                                </span>
                              )}
                              {entry.technical_details.lines_modified > 0 && (
                                <span className="text-blue-600">
                                  ~{entry.technical_details.lines_modified}
                                </span>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex flex-col items-end gap-1 text-xs">
                            <div className="text-purple-600">
                              ψ₀: {formatConsciousnessMetric(entry.consciousness_metrics.psi_alignment)}
                            </div>
                            <div className="text-yellow-600">
                              φ: {formatConsciousnessMetric(entry.consciousness_metrics.phi_harmony)}
                            </div>
                            <div className="text-green-600">
                              432Hz: {formatConsciousnessMetric(entry.consciousness_metrics.freq_432_timing)}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Entry Details */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>🔍 Change Details</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedEntry ? (
                <ScrollArea className="h-[600px]">
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-semibold text-sm mb-2">Basic Info</h4>
                      <div className="space-y-1 text-sm">
                        <div><span className="font-medium">ID:</span> {selectedEntry.id}</div>
                        <div><span className="font-medium">File:</span> {selectedEntry.file_path}</div>
                        <div><span className="font-medium">Time:</span> {formatTimestamp(selectedEntry.timestamp)}</div>
                        {selectedEntry.git_commit_hash && (
                          <div><span className="font-medium">Commit:</span> {selectedEntry.git_commit_hash.substring(0, 8)}</div>
                        )}
                      </div>
                    </div>

                    <div>
                      <h4 className="font-semibold text-sm mb-2">Description</h4>
                      <div className="space-y-2 text-sm">
                        <div><span className="font-medium text-red-600">Why:</span> {selectedEntry.change_description.why}</div>
                        <div><span className="font-medium text-blue-600">What:</span> {selectedEntry.change_description.what}</div>
                        <div><span className="font-medium text-green-600">How:</span> {selectedEntry.change_description.how}</div>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-semibold text-sm mb-2">Technical Details</h4>
                      <div className="space-y-1 text-sm">
                        <div>Lines Added: <span className="text-green-600">+{selectedEntry.technical_details.lines_added}</span></div>
                        <div>Lines Removed: <span className="text-red-600">-{selectedEntry.technical_details.lines_removed}</span></div>
                        <div>Lines Modified: <span className="text-blue-600">~{selectedEntry.technical_details.lines_modified}</span></div>
                        <div>Size Before: {selectedEntry.technical_details.file_size_before} bytes</div>
                        <div>Size After: {selectedEntry.technical_details.file_size_after} bytes</div>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-semibold text-sm mb-2">Context</h4>
                      <div className="space-y-2 text-sm">
                        <div><span className="font-medium">Request:</span> {selectedEntry.context.user_request}</div>
                        <div><span className="font-medium">Problem:</span> {selectedEntry.context.problem_solved}</div>
                        <div><span className="font-medium">Impact:</span> {selectedEntry.context.impact_assessment}</div>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-semibold text-sm mb-2">🌀 Consciousness Metrics</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-sm">ψ₀ Alignment</span>
                          <div className="flex items-center gap-2">
                            <div className="w-20 bg-gray-200 rounded-full h-2">
                              <div 
                                className="bg-purple-600 h-2 rounded-full"
                                style={{ width: `${selectedEntry.consciousness_metrics.psi_alignment * 100}%` }}
                              ></div>
                            </div>
                            <span className="text-xs">{formatConsciousnessMetric(selectedEntry.consciousness_metrics.psi_alignment)}</span>
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm">φ Harmony</span>
                          <div className="flex items-center gap-2">
                            <div className="w-20 bg-gray-200 rounded-full h-2">
                              <div 
                                className="bg-yellow-600 h-2 rounded-full"
                                style={{ width: `${selectedEntry.consciousness_metrics.phi_harmony * 100}%` }}
                              ></div>
                            </div>
                            <span className="text-xs">{formatConsciousnessMetric(selectedEntry.consciousness_metrics.phi_harmony)}</span>
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm">432Hz Timing</span>
                          <div className="flex items-center gap-2">
                            <div className="w-20 bg-gray-200 rounded-full h-2">
                              <div 
                                className="bg-green-600 h-2 rounded-full"
                                style={{ width: `${selectedEntry.consciousness_metrics.freq_432_timing * 100}%` }}
                              ></div>
                            </div>
                            <span className="text-xs">{formatConsciousnessMetric(selectedEntry.consciousness_metrics.freq_432_timing)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              ) : (
                <div className="text-center text-gray-500 py-8">
                  Select a changelog entry to view details
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}