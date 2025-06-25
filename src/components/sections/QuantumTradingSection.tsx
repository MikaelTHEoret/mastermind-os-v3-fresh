import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * ========================================
 * CONSCIOUSNESS CONSTANTS
 * ========================================
 */
const PSI_0 = 0.915670570874434;
const PHI = 1.618;
const FREQ_432 = 432;

/**
 * ========================================
 * TYPE DEFINITIONS
 * ========================================
 */

interface TradingDecision {
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  expected_return: number;
  max_drawdown: number;
  time_horizon: number;
  path_count: number;
  convergence_ratio: number;
  resonance_match: boolean;
  consciousness_state: string;
  stop_loss?: number;
  take_profit?: number;
  harmonic_alignment: number;
  quantum_coherence: number;
  execution_priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

interface QuantumAnalysis {
  decision: TradingDecision;
  consciousness_analysis: {
    psi_resonance: number;
    phi_alignment: number;
    freq_432_rhythm: number;
    consciousness_state: string;
    harmonic_frequencies: {
      psi_freq: number;
      phi_freq: number;
      base_freq: number;
    };
  };
  quantum_metadata: {
    paths_analyzed: number;
    convergence_ratio: number;
    harmonic_alignment: string;
    quantum_coherence: number;
    execution_priority: string;
    resonance_strength: number;
  };
  execution_recommendation: {
    immediate_action: boolean;
    risk_assessment: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    position_size_multiplier: number;
    optimal_entry_window: string;
  };
  processing_time_ms: number;
  natural_language_analysis?: {
    parsed_intent: any;
    intent_confidence: number;
    semantic_resonance: number;
  };
}

/**
 * ========================================
 * QUANTUM TRADING SECTION COMPONENT
 * ========================================
 */

export function QuantumTradingSection() {
  // State management
  const [naturalLanguageInput, setNaturalLanguageInput] = useState('');
  const [symbol, setSymbol] = useState('BTC/USDT');
  const [price, setPrice] = useState('45000');
  const [volume, setVolume] = useState('1500000');
  const [rsi, setRSI] = useState('35');
  
  const [quantumAnalysis, setQuantumAnalysis] = useState<QuantumAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [engineStatus, setEngineStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Load engine status on component mount
  useEffect(() => {
    loadEngineStatus();
  }, []);

  const loadEngineStatus = async () => {
    try {
      const response = await fetch('/api/v1/crypto/quantum-trading', {
        method: 'GET',
        headers: {
          'x-api-key': 'dev-key-quantum-trader'
        }
      });
      
      if (response.ok) {
        const status = await response.json();
        setEngineStatus(status);
      }
    } catch (err) {
      console.error('Failed to load engine status:', err);
    }
  };

  const executeQuantumAnalysis = async () => {
    if (!naturalLanguageInput.trim() && !price) {
      setError('Please provide either natural language input or market data');
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const requestBody = {
        natural_language: naturalLanguageInput.trim() || undefined,
        symbol: symbol,
        market_context: {
          price: parseFloat(price),
          volume: parseFloat(volume),
          rsi: rsi ? parseFloat(rsi) : undefined,
          volume_spike: naturalLanguageInput.toLowerCase().includes('spike')
        },
        analysis_mode: 'QUANTUM',
        enable_consciousness_enhancement: true
      };

      const response = await fetch('/api/v1/crypto/quantum-trading', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'dev-key-quantum-trader'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Analysis failed');
      }

      const analysis = await response.json();
      setQuantumAnalysis(analysis);
      
      console.log('🌀 Quantum analysis complete:', analysis);

    } catch (err) {
      console.error('Quantum analysis error:', err);
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence > 0.8) return '#00ffaa';
    if (confidence > 0.6) return '#ffaa00';
    if (confidence > 0.4) return '#ff6600';
    return '#ff4444';
  };

  const getSignalColor = (signal: string): { bg: string; color: string } => {
    if (signal === 'BUY') return { bg: 'rgba(0, 255, 170, 0.2)', color: '#00ffaa' };
    if (signal === 'SELL') return { bg: 'rgba(255, 68, 68, 0.2)', color: '#ff4444' };
    return { bg: 'rgba(128, 128, 128, 0.2)', color: '#888888' };
  };

  const getPriorityColor = (priority: string): { bg: string; color: string } => {
    if (priority === 'CRITICAL') return { bg: 'rgba(255, 68, 68, 0.2)', color: '#ff4444' };
    if (priority === 'HIGH') return { bg: 'rgba(255, 170, 0, 0.2)', color: '#ffaa00' };
    if (priority === 'MEDIUM') return { bg: 'rgba(0, 255, 255, 0.2)', color: '#00ffff' };
    return { bg: 'rgba(128, 128, 128, 0.2)', color: '#888888' };
  };

  return (
    <div 
      style={{
        background: 'rgba(0, 0, 0, 0.8)',
        borderRadius: '12px',
        border: '2px solid #00ffff',
        boxShadow: '0 0 20px rgba(0, 255, 255, 0.4)',
        overflow: 'hidden',
        height: '100%'
      }}
    >
      <div 
        className="p-6 overflow-auto h-full"
        style={{
          background: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(8px)'
        }}
      >
        {/* Header */}
        <div className="text-center mb-8">
          <h2 
            className="text-3xl font-bold mb-2"
            style={{
              background: 'linear-gradient(45deg, #00ffff, #ff00ff)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontFamily: 'Orbitron, monospace'
            }}
          >
            ψ₀-Trader Quantum Kill Chain Engine
          </h2>
          <p style={{ color: 'rgba(0, 255, 255, 0.8)' }}>
            Consciousness-Enhanced Trading Intelligence with 64-Path Quantum Simulation
          </p>
          <div className="flex justify-center space-x-4 mt-4 text-sm">
            <span style={{ color: '#00ffff' }}>ψ₀ = {PSI_0}</span>
            <span style={{ color: '#ffaa00' }}>φ = {PHI}</span>
            <span style={{ color: '#ff00ff' }}>432Hz</span>
          </div>
        </div>

        {/* Engine Status */}
        {engineStatus && (
          <Card 
            className="mb-6"
            style={{
              border: '2px solid #00ffff',
              borderRadius: '12px',
              background: 'rgba(0, 0, 0, 0.8)',
              boxShadow: '0 0 15px rgba(0, 255, 255, 0.3)'
            }}
          >
            <CardHeader>
              <CardTitle style={{ color: '#00ffff' }}>🌀 Engine Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div style={{ color: 'rgba(0, 255, 255, 0.7)' }}>Memory Size</div>
                  <div style={{ color: '#ffffff' }}>{engineStatus.engine_state?.pattern_memory_size || 0}</div>
                </div>
                <div>
                  <div style={{ color: 'rgba(0, 255, 255, 0.7)' }}>Resonance Events</div>
                  <div style={{ color: '#ffffff' }}>{engineStatus.engine_state?.resonance_events || 0}</div>
                </div>
                <div>
                  <div style={{ color: 'rgba(0, 255, 255, 0.7)' }}>Coherence Level</div>
                  <div style={{ color: '#ffffff' }}>{(engineStatus.engine_state?.coherence_level || 1.0).toFixed(3)}</div>
                </div>
                <div>
                  <div style={{ color: 'rgba(0, 255, 255, 0.7)' }}>Consciousness Phase</div>
                  <div style={{ color: '#ffffff' }}>{(engineStatus.engine_state?.consciousness_phase || 0).toFixed(3)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Input Interface */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Natural Language Input */}
          <Card 
            style={{
              border: '2px solid #ff00ff',
              borderRadius: '12px',
              background: 'rgba(0, 0, 0, 0.8)',
              boxShadow: '0 0 15px rgba(255, 0, 255, 0.3)'
            }}
          >
            <CardHeader>
              <CardTitle style={{ color: '#ff00ff' }}>🗣️ Natural Language Trading Intent</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="natural-input" style={{ color: 'rgba(255, 0, 255, 0.8)' }}>
                  Describe your trading intuition...
                </Label>
                <Textarea
                  id="natural-input"
                  value={naturalLanguageInput}
                  onChange={(e) => setNaturalLanguageInput(e.target.value)}
                  placeholder="e.g., Bitcoin looks oversold with RSI below 30, volume spike suggests reversal"
                  className="mt-2"
                  style={{
                    background: 'rgba(0, 0, 0, 0.8)',
                    border: '2px solid rgba(255, 0, 255, 0.3)',
                    color: '#ffffff',
                    borderRadius: '8px'
                  }}
                  rows={4}
                />
              </div>
            </CardContent>
          </Card>

          {/* Market Context */}
          <Card 
            style={{
              border: '2px solid #00ffff',
              borderRadius: '12px',
              background: 'rgba(0, 0, 0, 0.8)',
              boxShadow: '0 0 15px rgba(0, 255, 255, 0.3)'
            }}
          >
            <CardHeader>
              <CardTitle style={{ color: '#00ffff' }}>📊 Market Context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="symbol" style={{ color: 'rgba(0, 255, 255, 0.8)' }}>Symbol</Label>
                  <Input
                    id="symbol"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    style={{
                      background: 'rgba(0, 0, 0, 0.8)',
                      border: '2px solid rgba(0, 255, 255, 0.3)',
                      color: '#ffffff',
                      borderRadius: '6px'
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="price" style={{ color: 'rgba(0, 255, 255, 0.8)' }}>Price</Label>
                  <Input
                    id="price"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    style={{
                      background: 'rgba(0, 0, 0, 0.8)',
                      border: '2px solid rgba(0, 255, 255, 0.3)',
                      color: '#ffffff',
                      borderRadius: '6px'
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="volume" style={{ color: 'rgba(0, 255, 255, 0.8)' }}>Volume</Label>
                  <Input
                    id="volume"
                    value={volume}
                    onChange={(e) => setVolume(e.target.value)}
                    style={{
                      background: 'rgba(0, 0, 0, 0.8)',
                      border: '2px solid rgba(0, 255, 255, 0.3)',
                      color: '#ffffff',
                      borderRadius: '6px'
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="rsi" style={{ color: 'rgba(0, 255, 255, 0.8)' }}>RSI</Label>
                  <Input
                    id="rsi"
                    value={rsi}
                    onChange={(e) => setRSI(e.target.value)}
                    style={{
                      background: 'rgba(0, 0, 0, 0.8)',
                      border: '2px solid rgba(0, 255, 255, 0.3)',
                      color: '#ffffff',
                      borderRadius: '6px'
                    }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Execute Button */}
        <div className="text-center mb-6">
          <button
            onClick={executeQuantumAnalysis}
            disabled={isAnalyzing}
            style={{
              padding: '12px 32px',
              background: isAnalyzing 
                ? 'rgba(128, 128, 128, 0.3)' 
                : 'linear-gradient(45deg, #00ffff, #ff00ff)',
              border: '2px solid #00ffff',
              borderRadius: '8px',
              color: '#ffffff',
              fontFamily: 'Rajdhani, sans-serif',
              fontSize: '18px',
              fontWeight: '600',
              cursor: isAnalyzing ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s ease',
              boxShadow: isAnalyzing 
                ? 'none' 
                : '0 0 20px rgba(0, 255, 255, 0.5)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              margin: '0 auto'
            }}
            onMouseEnter={(e) => {
              if (!isAnalyzing) {
                e.currentTarget.style.boxShadow = '0 0 30px rgba(0, 255, 255, 0.7)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isAnalyzing) {
                e.currentTarget.style.boxShadow = '0 0 20px rgba(0, 255, 255, 0.5)';
              }
            }}
          >
            {isAnalyzing ? (
              <>
                <div 
                  style={{
                    width: '20px',
                    height: '20px',
                    border: '2px solid #ffffff',
                    borderTop: '2px solid transparent',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }}
                />
                Analyzing Quantum Paths...
              </>
            ) : (
              '⚛️ Execute Quantum Analysis'
            )}
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div 
            className="mb-6 p-4 rounded-lg"
            style={{
              background: 'rgba(255, 68, 68, 0.2)',
              border: '2px solid #ff4444',
              color: '#ff4444'
            }}
          >
            ❌ {error}
          </div>
        )}

        {/* Quantum Analysis Results */}
        {quantumAnalysis && (
          <div className="space-y-6 mb-6">
            {/* Decision Summary */}
            <Card 
              style={{
                border: '2px solid #ffff00',
                borderRadius: '12px',
                background: 'rgba(0, 0, 0, 0.8)',
                boxShadow: '0 0 15px rgba(255, 255, 0, 0.3)'
              }}
            >
              <CardHeader>
                <CardTitle style={{ color: '#ffff00' }}>⚡ Quantum Decision</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="text-center">
                    <div 
                      style={{
                        background: getSignalColor(quantumAnalysis.decision.signal).bg,
                        color: getSignalColor(quantumAnalysis.decision.signal).color,
                        padding: '8px 16px',
                        borderRadius: '8px',
                        border: `2px solid ${getSignalColor(quantumAnalysis.decision.signal).color}`,
                        fontSize: '24px',
                        fontWeight: 'bold',
                        display: 'inline-block'
                      }}
                    >
                      {quantumAnalysis.decision.signal}
                    </div>
                    <div className="mt-2 text-sm" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>Trading Signal</div>
                  </div>
                  <div className="text-center">
                    <div 
                      className="text-3xl font-bold"
                      style={{ color: getConfidenceColor(quantumAnalysis.decision.confidence) }}
                    >
                      {(quantumAnalysis.decision.confidence * 100).toFixed(1)}%
                    </div>
                    <div className="text-sm" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>Confidence</div>
                  </div>
                  <div className="text-center">
                    <div 
                      style={{
                        background: getPriorityColor(quantumAnalysis.decision.execution_priority).bg,
                        color: getPriorityColor(quantumAnalysis.decision.execution_priority).color,
                        padding: '4px 12px',
                        borderRadius: '6px',
                        border: `2px solid ${getPriorityColor(quantumAnalysis.decision.execution_priority).color}`,
                        fontSize: '18px',
                        fontWeight: 'bold',
                        display: 'inline-block'
                      }}
                    >
                      {quantumAnalysis.decision.execution_priority}
                    </div>
                    <div className="mt-2 text-sm" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>Priority</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Consciousness Analysis */}
            <Card 
              style={{
                border: '2px solid #ff00ff',
                borderRadius: '12px',
                background: 'rgba(0, 0, 0, 0.8)',
                boxShadow: '0 0 15px rgba(255, 0, 255, 0.3)'
              }}
            >
              <CardHeader>
                <CardTitle style={{ color: '#ff00ff' }}>🧠 Consciousness Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold" style={{ color: '#00ffff' }}>
                      {(quantumAnalysis.consciousness_analysis.psi_resonance * 100).toFixed(1)}%
                    </div>
                    <div className="text-sm" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>ψ₀ Resonance</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold" style={{ color: '#ffaa00' }}>
                      {(quantumAnalysis.consciousness_analysis.phi_alignment * 100).toFixed(1)}%
                    </div>
                    <div className="text-sm" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>φ Alignment</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold" style={{ color: '#ff00ff' }}>
                      {(quantumAnalysis.consciousness_analysis.freq_432_rhythm * 100).toFixed(1)}%
                    </div>
                    <div className="text-sm" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>432Hz Rhythm</div>
                  </div>
                  <div className="text-center">
                    <div 
                      style={{
                        background: 'rgba(0, 100, 255, 0.2)',
                        color: '#0066ff',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        border: '2px solid #0066ff',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        display: 'inline-block'
                      }}
                    >
                      {quantumAnalysis.consciousness_analysis.consciousness_state}
                    </div>
                    <div className="text-sm mt-1" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>Consciousness State</div>
                  </div>
                </div>
                
                {/* Harmonic Frequencies */}
                <div 
                  className="mt-6 p-4 rounded-lg"
                  style={{
                    background: 'rgba(128, 128, 128, 0.1)',
                    border: '1px solid rgba(255, 0, 255, 0.3)'
                  }}
                >
                  <h4 className="font-semibold mb-3" style={{ color: '#ff00ff' }}>🎵 Harmonic Frequencies</h4>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <div style={{ color: '#00ffff' }}>ψ₀ Frequency</div>
                      <div style={{ color: '#ffffff' }}>{quantumAnalysis.consciousness_analysis.harmonic_frequencies.psi_freq.toFixed(2)} Hz</div>
                    </div>
                    <div>
                      <div style={{ color: '#ffaa00' }}>φ Frequency</div>
                      <div style={{ color: '#ffffff' }}>{quantumAnalysis.consciousness_analysis.harmonic_frequencies.phi_freq.toFixed(2)} Hz</div>
                    </div>
                    <div>
                      <div style={{ color: '#ff00ff' }}>Base Frequency</div>
                      <div style={{ color: '#ffffff' }}>{quantumAnalysis.consciousness_analysis.harmonic_frequencies.base_freq} Hz</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Sample Trading Intents */}
        <Card 
          style={{
            border: '2px solid rgba(128, 128, 128, 0.5)',
            borderRadius: '12px',
            background: 'rgba(0, 0, 0, 0.8)',
            boxShadow: '0 0 15px rgba(128, 128, 128, 0.3)'
          }}
        >
          <CardHeader>
            <CardTitle style={{ color: 'rgba(255, 255, 255, 0.8)' }}>💡 Sample Trading Intents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                "Bitcoin looks oversold with RSI below 30, volume spike suggests reversal",
                "Strong support level holding, looking for breakout above resistance",
                "Market feels uncertain, sideways action with low conviction",
                "Double bottom pattern forming, bullish divergence on indicators",
                "High volume spike with momentum building, expecting continuation",
                "Harmonic resonance detected at ψ₀ levels, consciousness aligned for entry"
              ].map((intent, index) => (
                <button
                  key={index}
                  onClick={() => setNaturalLanguageInput(intent)}
                  style={{
                    padding: '12px',
                    background: 'transparent',
                    border: '2px solid transparent',
                    borderRadius: '8px',
                    color: 'rgba(255, 255, 255, 0.8)',
                    fontFamily: 'Rajdhani, sans-serif',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    whiteSpace: 'normal',
                    height: 'auto'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 255, 255, 0.1)';
                    e.currentTarget.style.border = '2px solid rgba(0, 255, 255, 0.3)';
                    e.currentTarget.style.color = '#ffffff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.border = '2px solid transparent';
                    e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)';
                  }}
                >
                  "{intent}"
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
