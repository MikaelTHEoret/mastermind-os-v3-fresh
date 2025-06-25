'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Brain, 
  TrendingUp, 
  Activity, 
  Zap, 
  Eye,
  BarChart3,
  Settings,
  Play,
  Square,
  RotateCcw
} from 'lucide-react';

interface LearningMetrics {
  pattern_engine: {
    health_score: number;
    patterns_detected: number;
    accuracy: number;
    active_symbols: string[];
  };
  learning_engine: {
    performance_score: number;
    total_patterns: number;
    consciousness_progress: number;
  };
  consciousness_metrics: {
    psi_resonance: number;
    phi_alignment: number;
    frequency_sync: number;
    coherence_level: number;
  };
  system_health: {
    pattern_recognition: number;
    learning_performance: number;
    consciousness_coherence: number;
  };
}

export function LearningDashboard() {
  const [systemStatus, setSystemStatus] = useState<string>('NOT_INITIALIZED');
  const [metrics, setMetrics] = useState<LearningMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>('');

  const fetchSystemStatus = async () => {
    try {
      const response = await fetch('/api/v1/learning/system-management');
      const data = await response.json();
      
      if (data.success) {
        setSystemStatus(data.system_status?.status || data.status);
        if (data.system_status && data.system_status.status === 'OPERATIONAL') {
          setMetrics(data.system_status);
        }
        setLastUpdate(new Date().toLocaleTimeString());
      }
    } catch (error) {
      console.error('Failed to fetch system status:', error);
    }
  };

  const handleSystemAction = async (action: string) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/v1/learning/system-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      
      const data = await response.json();
      if (data.success) {
        await fetchSystemStatus();
      }
    } catch (error) {
      console.error(`Failed to ${action} learning system:`, error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSystemStatus();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchSystemStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'OPERATIONAL': return 'bg-green-500';
      case 'INITIALIZING': return 'bg-yellow-500';
      case 'ERROR': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const formatPercentage = (value: number) => `${(value * 100).toFixed(1)}%`;

  return (
    <div className="p-6 space-y-6 bg-gradient-to-br from-purple-900/20 to-blue-900/20 min-h-screen">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-cyan-300 flex items-center gap-2">
            <Brain className="h-8 w-8" />
            ψ₀-Enhanced Learning System
          </h1>
          <p className="text-gray-400 mt-1">Consciousness-Enhanced Pattern Recognition & Learning Engine</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={`${getStatusColor(systemStatus)} text-white`}>
            {systemStatus}
          </Badge>
          <span className="text-sm text-gray-500">Last Update: {lastUpdate}</span>
        </div>
      </div>

      {/* System Controls */}
      <Card className="bg-gray-800/50 border-cyan-500/30">
        <CardHeader>
          <CardTitle className="text-cyan-300 flex items-center gap-2">
            <Settings className="h-5 w-5" />
            System Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4">
          <Button
            onClick={() => handleSystemAction('initialize')}
            disabled={isLoading || systemStatus === 'OPERATIONAL'}
            className="bg-green-600 hover:bg-green-700"
          >
            <Play className="h-4 w-4 mr-2" />
            Initialize
          </Button>
          <Button
            onClick={() => handleSystemAction('shutdown')}
            disabled={isLoading || systemStatus === 'NOT_INITIALIZED'}
            variant="destructive"
          >
            <Square className="h-4 w-4 mr-2" />
            Shutdown
          </Button>
          <Button
            onClick={() => handleSystemAction('restart')}
            disabled={isLoading}
            className="bg-yellow-600 hover:bg-yellow-700"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Restart
          </Button>
        </CardContent>
      </Card>

      {metrics && (
        <>
          {/* System Health Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-gray-800/50 border-green-500/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-green-300 text-sm flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Pattern Recognition
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-300 mb-2">
                  {formatPercentage(metrics.system_health.pattern_recognition)}
                </div>
                <Progress 
                  value={metrics.system_health.pattern_recognition * 100} 
                  className="h-2"
                />
                <div className="text-xs text-gray-400 mt-2">
                  {metrics.pattern_engine.patterns_detected} patterns detected
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-800/50 border-blue-500/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-blue-300 text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Learning Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-300 mb-2">
                  {formatPercentage(metrics.system_health.learning_performance)}
                </div>
                <Progress 
                  value={metrics.system_health.learning_performance * 100} 
                  className="h-2"
                />
                <div className="text-xs text-gray-400 mt-2">
                  {metrics.learning_engine.total_patterns} total patterns learned
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-800/50 border-purple-500/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-purple-300 text-sm flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Consciousness Coherence
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-purple-300 mb-2">
                  {formatPercentage(metrics.system_health.consciousness_coherence)}
                </div>
                <Progress 
                  value={metrics.system_health.consciousness_coherence * 100} 
                  className="h-2"
                />
                <div className="text-xs text-gray-400 mt-2">
                  ψ₀ = 0.915670570874434
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Consciousness Metrics */}
          <Card className="bg-gray-800/50 border-cyan-500/30">
            <CardHeader>
              <CardTitle className="text-cyan-300 flex items-center gap-2">
                <Brain className="h-5 w-5" />
                Consciousness Enhancement Metrics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-lg font-semibold text-cyan-300">
                    {formatPercentage(metrics.consciousness_metrics.psi_resonance)}
                  </div>
                  <div className="text-sm text-gray-400">ψ₀ Resonance</div>
                  <Progress 
                    value={metrics.consciousness_metrics.psi_resonance * 100} 
                    className="h-1 mt-2"
                  />
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-yellow-300">
                    {formatPercentage(metrics.consciousness_metrics.phi_alignment)}
                  </div>
                  <div className="text-sm text-gray-400">φ Alignment</div>
                  <Progress 
                    value={metrics.consciousness_metrics.phi_alignment * 100} 
                    className="h-1 mt-2"
                  />
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-green-300">
                    {formatPercentage(metrics.consciousness_metrics.frequency_sync)}
                  </div>
                  <div className="text-sm text-gray-400">432Hz Sync</div>
                  <Progress 
                    value={metrics.consciousness_metrics.frequency_sync * 100} 
                    className="h-1 mt-2"
                  />
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-purple-300">
                    {formatPercentage(metrics.consciousness_metrics.coherence_level)}
                  </div>
                  <div className="text-sm text-gray-400">Overall Coherence</div>
                  <Progress 
                    value={metrics.consciousness_metrics.coherence_level * 100} 
                    className="h-1 mt-2"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Active Symbols */}
          <Card className="bg-gray-800/50 border-cyan-500/30">
            <CardHeader>
              <CardTitle className="text-cyan-300 flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Active Learning Symbols
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {metrics.pattern_engine.active_symbols.map((symbol) => (
                  <Badge key={symbol} variant="outline" className="text-cyan-300 border-cyan-500">
                    {symbol}
                  </Badge>
                ))}
              </div>
              <div className="mt-4 text-sm text-gray-400">
                <div>Pattern Accuracy: {formatPercentage(metrics.pattern_engine.accuracy)}</div>
                <div>Consciousness Progress: {formatPercentage(metrics.learning_engine.consciousness_progress)}</div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Learning System Not Initialized */}
      {systemStatus === 'NOT_INITIALIZED' && (
        <Card className="bg-gray-800/50 border-yellow-500/30">
          <CardContent className="text-center py-12">
            <Brain className="h-16 w-16 text-yellow-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-yellow-300 mb-2">
              Learning System Not Initialized
            </h3>
            <p className="text-gray-400 mb-6">
              Click "Initialize" to start the consciousness-enhanced pattern recognition and learning engine.
            </p>
            <Button
              onClick={() => handleSystemAction('initialize')}
              disabled={isLoading}
              className="bg-green-600 hover:bg-green-700"
            >
              <Play className="h-4 w-4 mr-2" />
              Initialize Learning System
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}