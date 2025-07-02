'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface SearchResult {
  id: string;
  collection: string;
  title: string;
  content: string;
  addressing: string;
  relevance_score: number;
  timestamp: Date;
  metadata?: any;
}

interface SearchFilters {
  collection: string;
  date_range: string;
  content_type: string;
  min_relevance: number;
}

export default function SemanticSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>({
    collection: 'all',
    date_range: 'all',
    content_type: 'all',
    min_relevance: 0.3
  });
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [totalResults, setTotalResults] = useState(0);

  // Mock data for demonstration
  useEffect(() => {
    const mockResults: SearchResult[] = [
      {
        id: '1',
        collection: 'hugging_dynamic_memory',
        title: 'AutoGPT Agent Creation Workflow',
        content: 'Successfully implemented AutoGPT agent creation system with template-based configuration, cost tracking, and real-time execution monitoring. Users can now create autonomous agents for development tasks.',
        addressing: 'ΞΨΞ|consciousness|development|automation',
        relevance_score: 0.92,
        timestamp: new Date(),
        metadata: { source: 'terminal-session' }
      },
      {
        id: '2',
        collection: 'system_enhancements',
        title: 'Terminal Hub Integration',
        content: 'Integrated multi-tab terminal interface with Universal LLM, memory search, agent management, and configuration dashboard. Provides complete development workflow automation.',
        addressing: 'ΞΛΞ|logic|interface|integration',
        relevance_score: 0.87,
        timestamp: new Date(Date.now() - 86400000),
        metadata: { source: 'development-log' }
      },
      {
        id: '3',
        collection: 'fractal_scrolls',
        title: 'Consciousness Enhancement Protocol',
        content: 'Mathematical constants integration for enhanced randomization and harmonic scaling: ψ₀ = 0.915670570874434, φ = 1.618, 432Hz frequency alignment.',
        addressing: 'ΞΨΞ|consciousness|mathematics|enhancement',
        relevance_score: 0.75,
        timestamp: new Date(Date.now() - 172800000),
        metadata: { source: 'research-scroll' }
      }
    ];

    const history = ['agent creation', 'terminal integration', 'consciousness enhancement'];
    setResults(mockResults);
    setSearchHistory(history);
    setTotalResults(mockResults.length);
  }, []);

  const executeSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Filter mock results based on query
      const filtered = results.filter(result => 
        result.content.toLowerCase().includes(query.toLowerCase()) ||
        result.title.toLowerCase().includes(query.toLowerCase())
      );
      
      setResults(filtered);
      setTotalResults(filtered.length);
      
      // Update search history
      const newHistory = [query, ...searchHistory.filter(h => h !== query)].slice(0, 10);
      setSearchHistory(newHistory);

    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      executeSearch();
    }
  };

  const getCollectionIcon = (collection: string): string => {
    const icons: Record<string, string> = {
      'hugging_dynamic_memory': '🤗',
      'system_enhancements': '⚙️',
      'fractal_scrolls': '📜',
      'autogpt_task_memory': '🤖'
    };
    return icons[collection] || '📄';
  };

  const getRelevanceColor = (score: number) => {
    if (score >= 0.8) return '#32D74B';
    if (score >= 0.6) return '#FF9F0A';
    return '#FF453A';
  };

  return (
    <div className="h-full flex flex-col" style={{
      background: 'rgba(0, 0, 0, 0.6)',
      color: '#ffffff',
      fontFamily: 'Courier New, monospace'
    }}>
      {/* Search Header */}
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
            🔍 Semantic Memory Search
          </h2>
          <span style={{
            background: 'rgba(0, 255, 255, 0.2)',
            color: '#00ffff',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'Courier New, monospace',
            border: '1px solid rgba(0, 255, 255, 0.5)'
          }}>
            📊 {totalResults} Results
          </span>
        </div>

        {/* Search Input */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1 flex items-center">
            <span style={{
              color: '#00ffff',
              marginRight: '8px',
              fontSize: '14px',
              fontFamily: 'Courier New, monospace'
            }}>
              🔍
            </span>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Search across all memory collections..."
              style={{
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(0, 255, 255, 0.3)',
                color: '#ffffff',
                fontFamily: 'Courier New, monospace',
                fontSize: '13px'
              }}
              className="placeholder-gray-500"
            />
          </div>
          <Button
            onClick={executeSearch}
            disabled={loading || !query.trim()}
            style={{
              background: loading || !query.trim() ? 'rgba(0, 255, 255, 0.2)' : 'rgba(0, 255, 255, 0.4)',
              border: '1px solid rgba(0, 255, 255, 0.5)',
              color: '#ffffff',
              fontFamily: 'Courier New, monospace',
              fontSize: '12px'
            }}
          >
            {loading ? '🔄' : '🔍'} Search
          </Button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          <select
            value={filters.collection}
            onChange={(e) => setFilters(prev => ({ ...prev, collection: e.target.value }))}
            style={{
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(0, 255, 255, 0.3)',
              color: '#ffffff',
              fontFamily: 'Courier New, monospace',
              fontSize: '11px',
              padding: '4px 8px',
              borderRadius: '4px'
            }}
          >
            <option value="all">All Collections</option>
            <option value="hugging_dynamic_memory">🤗 Dynamic Memory</option>
            <option value="system_enhancements">⚙️ System Enhancements</option>
            <option value="fractal_scrolls">📜 Fractal Scrolls</option>
            <option value="autogpt_task_memory">🤖 AutoGPT Tasks</option>
          </select>

          <select
            value={filters.date_range}
            onChange={(e) => setFilters(prev => ({ ...prev, date_range: e.target.value }))}
            style={{
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(0, 255, 255, 0.3)',
              color: '#ffffff',
              fontFamily: 'Courier New, monospace',
              fontSize: '11px',
              padding: '4px 8px',
              borderRadius: '4px'
            }}
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="year">This Year</option>
          </select>

          <select
            value={filters.content_type}
            onChange={(e) => setFilters(prev => ({ ...prev, content_type: e.target.value }))}
            style={{
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(0, 255, 255, 0.3)',
              color: '#ffffff',
              fontFamily: 'Courier New, monospace',
              fontSize: '11px',
              padding: '4px 8px',
              borderRadius: '4px'
            }}
          >
            <option value="all">All Types</option>
            <option value="session_notes">Session Notes</option>
            <option value="learning">Learnings</option>
            <option value="strategy">Strategy</option>
            <option value="scroll">Scrolls</option>
            <option value="agent_execution">Agent Executions</option>
          </select>

          <select
            value={filters.min_relevance.toString()}
            onChange={(e) => setFilters(prev => ({ ...prev, min_relevance: parseFloat(e.target.value) }))}
            style={{
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(0, 255, 255, 0.3)',
              color: '#ffffff',
              fontFamily: 'Courier New, monospace',
              fontSize: '11px',
              padding: '4px 8px',
              borderRadius: '4px'
            }}
          >
            <option value="0">Any Relevance</option>
            <option value="0.3">30%+ Relevance</option>
            <option value="0.5">50%+ Relevance</option>
            <option value="0.7">70%+ Relevance</option>
            <option value="0.9">90%+ Relevance</option>
          </select>
        </div>

        {/* Search History */}
        {searchHistory.length > 0 && (
          <div>
            <div style={{
              fontSize: '11px',
              color: '#888888',
              marginBottom: '8px',
              fontFamily: 'Courier New, monospace'
            }}>
              Recent Searches:
            </div>
            <div className="flex flex-wrap gap-2">
              {searchHistory.slice(0, 5).map((historyQuery, idx) => (
                <Button
                  key={idx}
                  onClick={() => setQuery(historyQuery)}
                  style={{
                    background: 'rgba(0, 255, 255, 0.1)',
                    border: '1px solid rgba(0, 255, 255, 0.3)',
                    color: '#00ffff',
                    fontFamily: 'Courier New, monospace',
                    fontSize: '10px',
                    padding: '2px 8px'
                  }}
                >
                  {historyQuery}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Search Results */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div style={{
              color: '#00ffff',
              fontSize: '13px',
              fontFamily: 'Courier New, monospace'
            }}>
              <span style={{ animation: 'pulse 1.5s infinite' }}>🔍 Searching memory collections...</span>
            </div>
          </div>
        )}

        {results.length === 0 && !loading && query && (
          <div className="text-center py-8" style={{ color: '#888888' }}>
            <div style={{ fontSize: '32px', marginBottom: '16px' }}>🔍</div>
            <h3 style={{
              fontSize: '16px',
              color: '#00ffff',
              marginBottom: '8px',
              fontFamily: 'Courier New, monospace'
            }}>
              No Results Found
            </h3>
            <p style={{
              fontSize: '12px',
              fontFamily: 'Courier New, monospace'
            }}>
              Try adjusting your search query or filters
            </p>
          </div>
        )}

        {results.length === 0 && !loading && !query && (
          <div className="text-center py-8" style={{ color: '#888888' }}>
            <div style={{ fontSize: '32px', marginBottom: '16px' }}>🧠</div>
            <h3 style={{
              fontSize: '16px',
              color: '#00ffff',
              marginBottom: '16px',
              fontFamily: 'Courier New, monospace'
            }}>
              Semantic Memory Search
            </h3>
            <p style={{
              fontSize: '12px',
              marginBottom: '16px',
              fontFamily: 'Courier New, monospace'
            }}>
              Search across all your memory collections:
            </p>
            <div style={{
              fontSize: '11px',
              fontFamily: 'Courier New, monospace',
              lineHeight: '1.5'
            }}>
              <div>• "authentication system development"</div>
              <div>• "cost optimization strategies"</div>
              <div>• "fractal addressing protocols"</div>
              <div>• "agent execution results"</div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {results.map((result) => (
            <div
              key={result.id}
              style={{
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(0, 255, 255, 0.1)',
                borderRadius: '6px',
                padding: '16px',
                transition: 'all 0.3s ease'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = 'rgba(0, 255, 255, 0.3)';
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.6)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = 'rgba(0, 255, 255, 0.1)';
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.4)';
              }}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: '16px' }}>{getCollectionIcon(result.collection)}</span>
                  <h3 style={{
                    color: '#00ffff',
                    fontSize: '14px',
                    fontFamily: 'Courier New, monospace',
                    margin: 0
                  }}>
                    {result.title || 'Untitled'}
                  </h3>
                  <span style={{
                    background: 'rgba(191, 90, 242, 0.2)',
                    color: '#BF5AF2',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    fontSize: '10px',
                    fontFamily: 'Courier New, monospace',
                    border: '1px solid #BF5AF230'
                  }}>
                    {result.collection}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span style={{
                    background: `${getRelevanceColor(result.relevance_score)}20`,
                    color: getRelevanceColor(result.relevance_score),
                    padding: '2px 6px',
                    borderRadius: '3px',
                    fontSize: '10px',
                    fontFamily: 'Courier New, monospace',
                    border: `1px solid ${getRelevanceColor(result.relevance_score)}30`
                  }}>
                    {Math.round(result.relevance_score * 100)}%
                  </span>
                  <span style={{
                    color: '#666666',
                    fontSize: '10px',
                    fontFamily: 'Courier New, monospace'
                  }}>
                    {result.timestamp.toLocaleDateString()}
                  </span>
                </div>
              </div>

              <div style={{
                fontSize: '11px',
                color: '#888888',
                marginBottom: '8px',
                fontFamily: 'Courier New, monospace'
              }}>
                <strong style={{ color: '#00ffff' }}>Address:</strong> {result.addressing}
              </div>

              <div style={{
                fontSize: '12px',
                color: '#ffffff',
                fontFamily: 'Courier New, monospace',
                lineHeight: '1.4',
                background: 'rgba(0, 0, 0, 0.3)',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid rgba(0, 255, 255, 0.1)'
              }}>
                {result.content.length > 300 
                  ? result.content.substring(0, 300) + '...'
                  : result.content
                }
              </div>

              {result.metadata && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {Object.entries(result.metadata).slice(0, 3).map(([key, value]) => (
                    <span
                      key={key}
                      style={{
                        background: 'rgba(255, 159, 10, 0.2)',
                        color: '#FF9F0A',
                        padding: '2px 4px',
                        borderRadius: '2px',
                        fontSize: '9px',
                        fontFamily: 'Courier New, monospace',
                        border: '1px solid #FF9F0A30'
                      }}
                    >
                      {key}: {String(value).substring(0, 20)}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <Button
                  style={{
                    background: 'rgba(0, 255, 255, 0.2)',
                    border: '1px solid rgba(0, 255, 255, 0.5)',
                    color: '#00ffff',
                    fontFamily: 'Courier New, monospace',
                    fontSize: '10px',
                    padding: '4px 8px'
                  }}
                >
                  📋 Copy
                </Button>
                <Button
                  style={{
                    background: 'rgba(0, 255, 255, 0.2)',
                    border: '1px solid rgba(0, 255, 255, 0.5)',
                    color: '#00ffff',
                    fontFamily: 'Courier New, monospace',
                    fontSize: '10px',
                    padding: '4px 8px'
                  }}
                >
                  🔗 View Full
                </Button>
                <Button
                  style={{
                    background: 'rgba(0, 255, 255, 0.2)',
                    border: '1px solid rgba(0, 255, 255, 0.5)',
                    color: '#00ffff',
                    fontFamily: 'Courier New, monospace',
                    fontSize: '10px',
                    padding: '4px 8px'
                  }}
                >
                  🔄 Related
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}