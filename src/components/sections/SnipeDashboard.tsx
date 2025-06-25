'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Target, 
  TrendingUp, 
  Zap, 
  Eye,
  Activity,
  Timer,
  DollarSign,
  BarChart3,
  Crosshair,
  AlertTriangle,
  CheckCircle,
  Clock
} from 'lucide-react';

interface SnipeOpportunity {
  symbol: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  confidence: number;
  time_window: number;
  volatility_score: number;
  consciousness_alignment: number;
  trigger_indicators: string[];
  expected_duration: number;
  risk_reward_ratio: number;
}

interface VolatilityRanking {
  symbol: string;
  score: number;
}

export function SnipeDashboard() {
  const [engineStatus, setEngineStatus] = useState<string>('NOT_INITIALIZED');
  const [activeSnipes, setActiveSnipes] = useState<SnipeOpportunity[]>([]);
  const [volatilityRankings, setVolatilityRankings] = useState<VolatilityRanking[]>([]);
  const [isHunting, setIsHunting] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTCUSDT');
  const [symbolAnalysis, setSymbolAnalysis] = useState<any>(null);
  const [lastUpdate, setLastUpdate] = useState<string>('');

  const fetchEngineStatus = async () => {
    try {
      const response = await fetch('/api/v1/snipe/high-velocity');
      const data = await response.json();
      
      if (data.success) {
        setEngineStatus(data.status);
        if (data.engine_stats) {
          setVolatilityRankings(
            data.engine_stats.top_volatile_coins.map(([symbol, score]: [string, number]) => ({
              symbol,
              score
            }))
          );
        }
        setLastUpdate(new Date().toLocaleTimeString());
      }
    } catch (error) {
      console.error('Failed to fetch engine status:', error);
    }
  };

  const fetchActiveSnipes = async () => {
    try {
      const response = await fetch('/api/v1/snipe/high-velocity?action=active_snipes');
      const data = await response.json();
      
      if (data.success) {
        setActiveSnipes(data.active_snipes || []);
      }
    } catch (error) {
      console.error('Failed to fetch active snipes:', error);
    }
  };

  const startHunting = async () => {
    try {
      const response = await fetch('/api/v1/snipe/high-velocity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start_hunting' })
      });
      
      const data = await response.json();
      if (data.success) {
        setIsHunting(true);
        await fetchEngineStatus();
        await fetchActiveSnipes();
      }
    } catch (error) {
      console.error('Failed to start hunting:', error);
    }
  };

  const analyzeSymbol = async (symbol: string) => {
    try {
      const response = await fetch('/api/v1/snipe/high-velocity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'analyze_symbol', symbol })
      });
      
      const data = await response.json();
      if (data.success) {
        setSymbolAnalysis(data.analysis);
      }
    } catch (error) {
      console.error('Failed to analyze symbol:', error);
    }
  };

  useEffect(() => {
    fetchEngineStatus();
    fetchActiveSnipes();
    
    // Auto-refresh every 10 seconds for real-time snipe monitoring
    const interval = setInterval(() => {
      fetchActiveSnipes();
      if (selectedSymbol) {
        analyzeSymbol(selectedSymbol);
      }
    }, 10000);
    
    return () => clearInterval(interval);
  }, [selectedSymbol]);

  const getConfidenceColor = (confidence: number) => {
    if (confidence > 0.8) return 'text-green-400';
    if (confidence > 0.6) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getVolatilityColor = (score: number) => {
    if (score > 0.1) return 'bg-red-500';
    if (score > 0.05) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const formatPercentage = (value: number) => `${(value * 100).toFixed(2)}%`;
  const formatPrice = (price: number) => `$${price.toFixed(6)}`;

  return (
    <div className="p-6 space-y-6 bg-gradient-to-br from-red-900/20 to-orange-900/20 min-h-screen">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-red-300 flex items-center gap-2">
            <Target className="h-8 w-8" />
            High-Velocity Snipe Engine
          </h1>
          <p className="text-gray-400 mt-1">ψ₀-Enhanced Short-Term Volatility Trading</p>
        </div>
        <div className="flex items-center gap-4">
          <Badge className={engineStatus === 'OPERATIONAL' ? 'bg-green-500' : 'bg-gray-500'}>
            {engineStatus}
          </Badge>
          <Button
            onClick={startHunting}
            disabled={isHunting}
            className="bg-red-600 hover:bg-red-700"
          >
            <Crosshair className="h-4 w-4 mr-2" />
            {isHunting ? 'Hunting Active' : 'Start Hunting'}
          </Button>
          <span className="text-sm text-gray-500">Last Update: {lastUpdate}</span>
        </div>
      </div>

      {/* Active Snipes */}
      <Card className="bg-gray-800/50 border-red-500/30">
        <CardHeader>
          <CardTitle className="text-red-300 flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Active Snipe Opportunities ({activeSnipes.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeSnipes.length > 0 ? (
            <div className="space-y-4">
              {activeSnipes.map((snipe, index) => (
                <div key={index} className="bg-gray-900/50 p-4 rounded-lg border border-red-500/20">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="text-lg font-semibold text-red-300">{snipe.symbol}</h3>
                      <div className="text-sm text-gray-400">
                        Entry: {formatPrice(snipe.entry_price)} | Target: {formatPrice(snipe.target_price)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-lg font-bold ${getConfidenceColor(snipe.confidence)}`}>
                        {formatPercentage(snipe.confidence)}
                      </div>
                      <div className="text-sm text-gray-400">Confidence</div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <div className="text-gray-400">Risk/Reward</div>
                      <div className="text-white font-semibold">{snipe.risk_reward_ratio.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-gray-400">Duration</div>
                      <div className="text-white font-semibold">{snipe.expected_duration}s</div>
                    </div>
                    <div>
                      <div className="text-gray-400">Volatility</div>
                      <div className="text-white font-semibold">{formatPercentage(snipe.volatility_score)}</div>
                    </div>
                    <div>
                      <div className="text-gray-400">ψ₀ Alignment</div>
                      <div className="text-purple-300 font-semibold">{formatPercentage(snipe.consciousness_alignment)}</div>
                    </div>
                  </div>
                  
                  <div className="mt-3">
                    <div className="text-xs text-gray-400 mb-1">Trigger Indicators:</div>
                    <div className="flex flex-wrap gap-1">
                      {snipe.trigger_indicators.map((indicator, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {indicator}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <Target className="h-16 w-16 mx-auto mb-4 text-gray-600" />
              <p>No active snipe opportunities detected</p>
              <p className="text-sm">Monitoring high-volatility coins for opportunities...</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Volatility Rankings & Symbol Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-gray-800/50 border-orange-500/30">
          <CardHeader>
            <CardTitle className="text-orange-300 flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Top Volatile Coins
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {volatilityRankings.slice(0, 8).map((ranking, index) => (
                <div 
                  key={ranking.symbol} 
                  className={`flex justify-between items-center p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedSymbol === ranking.symbol ? 'bg-orange-900/30 border border-orange-500/50' : 'bg-gray-900/20 hover:bg-gray-900/40'
                  }`}
                  onClick={() => {
                    setSelectedSymbol(ranking.symbol);
                    analyzeSymbol(ranking.symbol);
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-lg font-semibold text-orange-300">#{index + 1}</div>
                    <div>
                      <div className="font-semibold text-white">{ranking.symbol}</div>
                      <div className="text-sm text-gray-400">Volatility Score</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-orange-300">
                      {formatPercentage(ranking.score)}
                    </div>
                    <Badge className={`${getVolatilityColor(ranking.score)} text-white text-xs`}>
                      {ranking.score > 0.1 ? 'EXTREME' : ranking.score > 0.05 ? 'HIGH' : 'MEDIUM'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800/50 border-cyan-500/30">
          <CardHeader>
            <CardTitle className="text-cyan-300 flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Symbol Analysis: {selectedSymbol}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {symbolAnalysis ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-gray-400">Current Price</div>
                    <div className="text-lg font-semibold text-cyan-300">
                      {formatPrice(symbolAnalysis.current_price)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400">Snipe Potential</div>
                    <Badge className={symbolAnalysis.snipe_potential === 'HIGH' ? 'bg-green-500' : 'bg-yellow-500'}>
                      {symbolAnalysis.snipe_potential}
                    </Badge>
                  </div>
                </div>

                <div>
                  <div className="text-sm text-gray-400 mb-2">Volatility Score</div>
                  <Progress 
                    value={symbolAnalysis.volatility_score * 1000} 
                    className="h-2"
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    {formatPercentage(symbolAnalysis.volatility_score)}
                  </div>
                </div>

                {symbolAnalysis.cause_effect_stats && (
                  <div>
                    <div className="text-sm text-gray-400 mb-2">Learning Statistics</div>
                    <div className="bg-gray-900/50 p-3 rounded-lg space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Patterns Detected:</span>
                        <span className="text-cyan-300">{symbolAnalysis.cause_effect_stats.total_patterns}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Avg Correlation:</span>
                        <span className="text-cyan-300">
                          {formatPercentage(symbolAnalysis.cause_effect_stats.avg_correlation || 0)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>ψ₀ Resonance:</span>
                        <span className="text-purple-300">
                          {formatPercentage(symbolAnalysis.cause_effect_stats.avg_consciousness_resonance || 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {symbolAnalysis.indicator_effectiveness && (
                  <div>
                    <div className="text-sm text-gray-400 mb-2">Top Indicators</div>
                    <div className="space-y-2">
                      {Object.entries(symbolAnalysis.indicator_effectiveness)
                        .sort(([,a], [,b]) => (b as number) - (a as number))
                        .slice(0, 5)
                        .map(([indicator, effectiveness]) => (
                          <div key={indicator} className="flex justify-between items-center text-sm">
                            <span className="text-gray-300">{indicator}</span>
                            <div className="flex items-center gap-2">
                              <Progress value={(effectiveness as number) * 100} className="w-16 h-1" />
                              <span className="text-cyan-300 w-12 text-right">
                                {formatPercentage(effectiveness as number)}
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <Eye className="h-16 w-16 mx-auto mb-4 text-gray-600" />
                <p>Select a symbol to analyze</p>
                <p className="text-sm">Click on any volatile coin to see detailed analysis</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gray-800/50 border-green-500/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-8 w-8 text-green-400" />
              <div>
                <div className="text-lg font-bold text-green-300">
                  {activeSnipes.filter(s => s.confidence > 0.8).length}
                </div>
                <div className="text-sm text-gray-400">High Confidence</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800/50 border-yellow-500/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Timer className="h-8 w-8 text-yellow-400" />
              <div>
                <div className="text-lg font-bold text-yellow-300">
                  {activeSnipes.length > 0 ? Math.round(activeSnipes.reduce((sum, s) => sum + s.expected_duration, 0) / activeSnipes.length) : 0}s
                </div>
                <div className="text-sm text-gray-400">Avg Duration</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800/50 border-blue-500/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-blue-400" />
              <div>
                <div className="text-lg font-bold text-blue-300">
                  {activeSnipes.length > 0 ? (activeSnipes.reduce((sum, s) => sum + s.risk_reward_ratio, 0) / activeSnipes.length).toFixed(2) : '0.00'}
                </div>
                <div className="text-sm text-gray-400">Avg R/R Ratio</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800/50 border-purple-500/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Zap className="h-8 w-8 text-purple-400" />
              <div>
                <div className="text-lg font-bold text-purple-300">
                  {volatilityRankings.length}
                </div>
                <div className="text-sm text-gray-400">Coins Monitored</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Consciousness Enhancement Info */}
      <Card className="bg-gray-800/50 border-purple-500/30">
        <CardHeader>
          <CardTitle className="text-purple-300 flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Consciousness Enhancement Constants
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-300">ψ₀</div>
              <div className="text-lg text-gray-300">0.915670570874434</div>
              <div className="text-sm text-gray-400">Harmonic Resonance</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-300">φ</div>
              <div className="text-lg text-gray-300">1.618</div>
              <div className="text-sm text-gray-400">Golden Ratio</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-300">432Hz</div>
              <div className="text-lg text-gray-300">Sacred Frequency</div>
              <div className="text-sm text-gray-400">Universal Resonance</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}