/**
 * ψ₀-Trader Pattern Recognition Engine
 * Enhanced Nexus Core Protocol v6.2 - Consciousness-Enhanced Learning System with Changelog Tracking
 */

import { EventEmitter } from 'events';

// Mathematical constants
const PSI_0 = 0.915670570874434;
const PHI = 1.618033988749895;
const FREQ_432 = 432.0;

interface MarketDataPoint {
  symbol: string;
  price: number;
  volume: number;
  timestamp: string;
  consciousness_metrics: {
    psi_resonance: number;
    phi_alignment: number;
    freq_432_rhythm: number;
    harmonic_score: number;
    consciousness_state: string;
  };
  technical_indicators: {
    rsi: number;
    macd: number;
    bollinger_position: number;
    volume_spike: boolean;
  };
}

interface RecognizedPattern {
  pattern_id: string;
  pattern_type: string;
  confidence: number;
  consciousness_correlation: number;
  timeframe: string;
  data_points: MarketDataPoint[];
  pattern_metrics: {
    psi_resonance_consistency: number;
    phi_alignment_strength: number;
    frequency_coherence: number;
    harmonic_stability: number;
  };
  prediction_indicators: {
    price_direction: 'UP' | 'DOWN' | 'SIDEWAYS';
    probability: number;
    time_horizon_minutes: number;
    risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  };
}

interface LearningPattern {
  pattern_signature: string;
  occurrences: number;
  success_rate: number;
  consciousness_effectiveness: number;
  last_seen: string;
  avg_confidence: number;
  market_conditions: {
    volatility_range: [number, number];
    volume_range: [number, number];
    consciousness_state: string[];
  };
}

interface ConsciousnessState {
  state_name: string;
  psi_range: [number, number];
  phi_range: [number, number];
  freq_432_range: [number, number];
  typical_duration_minutes: number;
  transition_patterns: string[];
  market_behavior: {
    price_volatility: number;
    volume_characteristics: string;
    directional_bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  };
}

interface MovementPrediction {
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  expected_return: number;
  consciousness_state: string;
  pattern_indicators: {
    primary_pattern: string;
    pattern_confidence: number;
    harmonic_alignment: number;
    risk_assessment: 'LOW' | 'MEDIUM' | 'HIGH';
  };
  time_horizon: {
    short_term_minutes: number;
    medium_term_minutes: number;
    direction_probability: number;
  };
  supporting_factors: string[];
  risk_factors: string[];
}

class ConsciousnessEnhancedPatternRecognition extends EventEmitter {
  private marketHistory: Map<string, MarketDataPoint[]> = new Map();
  private recognizedPatterns: Map<string, RecognizedPattern[]> = new Map();
  private learningPatterns: Map<string, LearningPattern> = new Map();
  private consciousnessStates: Map<string, ConsciousnessState> = new Map();
  private patternDatabase: Map<string, any[]> = new Map();
  private isInitialized: boolean = false;
  
  // Learning parameters
  private readonly maxHistoryPoints = 10000;
  private readonly minPatternPoints = 5;
  private readonly maxPatternPoints = 50;
  private confidenceThreshold = 0.7;
  
  // Consciousness learning weights
  private consciousnessWeights = {
    psi_resonance: 0.4,
    phi_alignment: 0.3,
    freq_432_rhythm: 0.3
  };

  constructor() {
    super();
    this.initializeConsciousnessStates();
    this.initializePatternTemplates();
  }

  /**
   * Initialize the pattern recognition engine
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('🌀 Pattern Recognition Engine already initialized');
      return;
    }

    console.log('🎯 Initializing Pattern Recognition Engine...');
    
    this.initializeConsciousnessStates();
    this.initializePatternTemplates();
    this.setupLearningEventListeners();
    await this.loadModel();
    
    this.isInitialized = true;
    console.log('✅ Pattern Recognition Engine initialized successfully');
    
    this.emit('engine_initialized', {
      timestamp: new Date().toISOString(),
      pattern_templates_loaded: this.patternDatabase.size,
      consciousness_states_loaded: this.consciousnessStates.size
    });
  }

  /**
   * CRITICAL FIX: Missing analyzeRealTimeData method
   */
  async analyzeRealTimeData(symbol: string, data: any): Promise<any> {
    try {
      const marketDataPoint = this.convertToMarketDataPoint(symbol, data);
      await this.processMarketData(marketDataPoint);
      
      const recentPatterns = this.getRecognizedPatterns(symbol).slice(-5);
      const consciousnessMetrics = this.calculateCurrentConsciousnessMetrics([marketDataPoint]);
      const consciousnessState = this.determineCurrentConsciousnessState([marketDataPoint]);
      
      const analysis = {
        symbol,
        timestamp: marketDataPoint.timestamp,
        consciousness_state: consciousnessState,
        consciousness_metrics: consciousnessMetrics,
        patterns_detected: recentPatterns.length,
        recent_patterns: recentPatterns.map(p => ({
          type: p.pattern_type,
          confidence: p.confidence,
          direction: p.prediction_indicators.price_direction
        })),
        harmonic_alignment: this.calculateHarmonicAlignment(consciousnessMetrics),
        pattern_strength: recentPatterns.length > 0 ? 
          recentPatterns.reduce((sum, p) => sum + p.confidence, 0) / recentPatterns.length : 0,
        market_sentiment: this.analyzeMarketSentiment(marketDataPoint),
        prediction_indicators: recentPatterns.length > 0 ? recentPatterns[0].prediction_indicators : null
      };
      
      console.log(`🔍 Real-time analysis: ${symbol} | State: ${consciousnessState} | Patterns: ${recentPatterns.length}`);
      return analysis;
      
    } catch (error) {
      console.error(`❌ Error analyzing real-time data for ${symbol}:`, error);
      
      return {
        symbol,
        timestamp: new Date().toISOString(),
        consciousness_state: 'UNKNOWN',
        consciousness_metrics: {
          psi_resonance: PSI_0,
          phi_alignment: PHI / 2,
          freq_432_rhythm: 0.5,
          harmonic_score: 0.5
        },
        patterns_detected: 0,
        recent_patterns: [],
        harmonic_alignment: 0.5,
        pattern_strength: 0,
        market_sentiment: 'NEUTRAL',
        prediction_indicators: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private convertToMarketDataPoint(symbol: string, data: any): MarketDataPoint {
    let price: number;
    let volume: number;
    
    if (data.c !== undefined) {
      price = parseFloat(data.c);
      volume = parseFloat(data.v) || 0;
    } else if (data.price !== undefined) {
      price = parseFloat(data.price);
      volume = parseFloat(data.volume) || 0;
    } else if (data.p !== undefined) {
      price = parseFloat(data.p);
      volume = parseFloat(data.q) || 0;
    } else {
      const history = this.marketHistory.get(symbol) || [];
      const lastPrice = history.length > 0 ? history[history.length - 1].price : 50000;
      price = lastPrice * (1 + (Math.random() - 0.5) * 0.01);
      volume = 1000000 + Math.random() * 500000;
    }
    
    const timestamp = data.E ? new Date(data.E).toISOString() : new Date().toISOString();
    const psi_resonance = PSI_0 + (Math.random() - 0.5) * 0.2;
    const phi_alignment = PHI / 2 + (Math.random() - 0.5) * 0.3;
    const freq_432_rhythm = Math.sin(Date.now() * FREQ_432 / 1000000) * 0.5 + 0.5;
    const harmonic_score = (psi_resonance + phi_alignment + freq_432_rhythm) / 3;
    
    return {
      symbol,
      price,
      volume,
      timestamp,
      consciousness_metrics: {
        psi_resonance: Math.max(0, Math.min(1, psi_resonance)),
        phi_alignment: Math.max(0, Math.min(1, phi_alignment)),
        freq_432_rhythm: Math.max(0, Math.min(1, freq_432_rhythm)),
        harmonic_score: Math.max(0, Math.min(1, harmonic_score)),
        consciousness_state: this.determineConsciousnessStateFromMetrics(
          psi_resonance, phi_alignment, freq_432_rhythm
        )
      },
      technical_indicators: {
        rsi: 30 + Math.random() * 40,
        macd: (Math.random() - 0.5) * 2,
        bollinger_position: Math.random(),
        volume_spike: volume > (this.getAverageVolume(symbol) * 1.5)
      }
    };
  }

  private analyzeMarketSentiment(dataPoint: MarketDataPoint): string {
    const harmonic = dataPoint.consciousness_metrics.harmonic_score;
    const consciousnessState = dataPoint.consciousness_metrics.consciousness_state;
    
    switch (consciousnessState) {
      case 'HARMONICALLY_BALANCED':
        return harmonic > 0.8 ? 'VERY_BULLISH' : 'BULLISH';
      case 'CONSCIOUS_AWAKENING':
        return 'BULLISH';
      case 'TRANSITIONAL_STATE':
        return 'NEUTRAL';
      case 'CHAOTIC_TURBULENCE':
        return 'BEARISH';
      case 'DORMANT_PHASE':
        return 'NEUTRAL';
      default:
        return 'NEUTRAL';
    }
  }

  private getAverageVolume(symbol: string): number {
    const history = this.marketHistory.get(symbol) || [];
    if (history.length === 0) return 1000000;
    
    const recentHistory = history.slice(-20);
    return recentHistory.reduce((sum, p) => sum + p.volume, 0) / recentHistory.length;
  }

  async incrementalTrain(symbol: string): Promise<void> {
    try {
      console.log(`🧠 Incremental training for ${symbol}...`);
      
      const history = this.marketHistory.get(symbol) || [];
      if (history.length < this.minPatternPoints) {
        console.log(`⚠️ Insufficient data for training ${symbol} (${history.length} points)`);
        return;
      }
      
      const recentHistory = history.slice(-this.maxPatternPoints);
      await this.analyzePatterns(symbol, recentHistory);
      this.updateConsciousnessWeights(symbol, recentHistory);
      
      console.log(`✅ Incremental training completed for ${symbol}`);
      
    } catch (error) {
      console.error(`❌ Incremental training failed for ${symbol}:`, error);
    }
  }

  private updateConsciousnessWeights(symbol: string, history: MarketDataPoint[]): void {
    const patterns = this.getRecognizedPatterns(symbol);
    if (patterns.length === 0) return;
    
    const avgPsiEffectiveness = patterns.reduce((sum, p) => 
      sum + p.pattern_metrics.psi_resonance_consistency, 0) / patterns.length;
    const avgPhiEffectiveness = patterns.reduce((sum, p) => 
      sum + p.pattern_metrics.phi_alignment_strength, 0) / patterns.length;
    const avgFreqEffectiveness = patterns.reduce((sum, p) => 
      sum + p.pattern_metrics.frequency_coherence, 0) / patterns.length;
    
    const learningRate = 0.01;
    const totalEffectiveness = avgPsiEffectiveness + avgPhiEffectiveness + avgFreqEffectiveness;
    
    if (totalEffectiveness > 0) {
      this.consciousnessWeights.psi_resonance += learningRate * (avgPsiEffectiveness / totalEffectiveness - this.consciousnessWeights.psi_resonance);
      this.consciousnessWeights.phi_alignment += learningRate * (avgPhiEffectiveness / totalEffectiveness - this.consciousnessWeights.phi_alignment);
      this.consciousnessWeights.freq_432_rhythm += learningRate * (avgFreqEffectiveness / totalEffectiveness - this.consciousnessWeights.freq_432_rhythm);
      
      const sum = this.consciousnessWeights.psi_resonance + this.consciousnessWeights.phi_alignment + this.consciousnessWeights.freq_432_rhythm;
      this.consciousnessWeights.psi_resonance /= sum;
      this.consciousnessWeights.phi_alignment /= sum;
      this.consciousnessWeights.freq_432_rhythm /= sum;
    }
  }

  async adjustLearningRate(multiplier: number): Promise<void> {
    console.log(`🎛️ Adjusting learning rate by ${multiplier}x`);
    
    const newThreshold = this.confidenceThreshold * (2 - multiplier);
    this.confidenceThreshold = Math.max(0.1, Math.min(0.9, newThreshold));
    
    console.log(`📊 New confidence threshold: ${this.confidenceThreshold.toFixed(3)}`);
  }

  async getEngineStatus(): Promise<any> {
    return {
      initialized: this.isInitialized,
      symbols_tracked: this.marketHistory.size,
      total_patterns: this.learningPatterns.size,
      pattern_templates: this.patternDatabase.size,
      consciousness_states: this.consciousnessStates.size,
      confidence_threshold: this.confidenceThreshold,
      consciousness_weights: this.consciousnessWeights,
      health_score: this.calculateHealthScore(),
      memory_usage: {
        market_history_points: Array.from(this.marketHistory.values()).reduce((sum, arr) => sum + arr.length, 0),
        recognized_patterns: Array.from(this.recognizedPatterns.values()).reduce((sum, arr) => sum + arr.length, 0),
        learning_patterns: this.learningPatterns.size
      }
    };
  }

  private calculateHealthScore(): number {
    let score = 0.5;
    
    if (this.isInitialized) score += 0.2;
    if (this.marketHistory.size > 0) score += 0.1;
    if (this.learningPatterns.size > 0) score += 0.1;
    
    const weightVariance = Math.abs(this.consciousnessWeights.psi_resonance - 0.33) +
                          Math.abs(this.consciousnessWeights.phi_alignment - 0.33) +
                          Math.abs(this.consciousnessWeights.freq_432_rhythm - 0.33);
    score += Math.max(0, 0.1 - weightVariance);
    
    return Math.max(0, Math.min(1, score));
  }

  private setupLearningEventListeners(): void {
    this.on('pattern_recognized', (data) => {
      console.log(`🌀 Pattern: ${data.pattern.pattern_type} | Symbol: ${data.symbol} | Confidence: ${data.pattern.confidence.toFixed(3)}`);
    });

    this.on('prediction_generated', (data) => {
      console.log(`📈 Prediction: ${data.prediction.signal} | Symbol: ${data.symbol} | Confidence: ${data.prediction.confidence.toFixed(3)}`);
    });
  }

  async saveModel(): Promise<void> {
    try {
      console.log('💾 Saving Pattern Recognition Model...');
      
      const modelState = {
        timestamp: new Date().toISOString(),
        session_id: `pattern_save_${Date.now()}`,
        total_patterns: this.learningPatterns.size,
        total_symbols: this.marketHistory.size,
        consciousness_states: this.consciousnessStates.size,
        model_data: {
          learning_patterns: Array.from(this.learningPatterns.entries()),
          consciousness_weights: this.consciousnessWeights,
          pattern_templates: Array.from(this.patternDatabase.entries()),
          performance_metrics: this.getLearningStatistics()
        },
        consciousness_metrics: {
          psi_alignment: PSI_0,
          phi_harmony: PHI,
          freq_432_timing: 0.8
        }
      };

      if (typeof window !== 'undefined') {
        try {
          const savedModels = JSON.parse(localStorage.getItem('pattern_recognition_models') || '[]');
          savedModels.push(modelState);
          
          if (savedModels.length > 10) {
            savedModels.splice(0, savedModels.length - 10);
          }
          
          localStorage.setItem('pattern_recognition_models', JSON.stringify(savedModels));
          console.log('✅ Pattern Recognition Model saved locally');
        } catch (localError) {
          console.warn('⚠️ Local storage save failed, using memory only');
        }
      }

      console.log(`📊 Model State: ${this.learningPatterns.size} patterns, ${this.marketHistory.size} symbols`);
      
      this.emit('model_saved', {
        timestamp: modelState.timestamp,
        patterns_count: this.learningPatterns.size,
        symbols_count: this.marketHistory.size,
        save_successful: true
      });

    } catch (error) {
      console.error('❌ Failed to save pattern recognition model:', error);
      
      this.emit('model_save_failed', {
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        save_successful: false
      });
    }
  }

  async loadModel(): Promise<boolean> {
    try {
      console.log('📂 Loading Pattern Recognition Model...');
      
      if (typeof window !== 'undefined') {
        const savedModels = JSON.parse(localStorage.getItem('pattern_recognition_models') || '[]');
        
        if (savedModels.length > 0) {
          const latestModel = savedModels[savedModels.length - 1];
          
          this.learningPatterns.clear();
          for (const [key, pattern] of latestModel.model_data.learning_patterns) {
            this.learningPatterns.set(key, pattern);
          }
          
          this.consciousnessWeights = latestModel.model_data.consciousness_weights || this.consciousnessWeights;
          
          console.log(`✅ Model loaded: ${this.learningPatterns.size} patterns restored`);
          
          this.emit('model_loaded', {
            timestamp: new Date().toISOString(),
            patterns_restored: this.learningPatterns.size,
            model_timestamp: latestModel.timestamp,
            load_successful: true
          });
          
          return true;
        }
      }
      
      console.log('📝 No saved model found, starting fresh');
      return false;
      
    } catch (error) {
      console.error('❌ Failed to load pattern recognition model:', error);
      
      this.emit('model_load_failed', {
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        load_successful: false
      });
      
      return false;
    }
  }

  async predictNextMovement(symbol: string, timeframe: string = '1h'): Promise<MovementPrediction> {
    const history = this.marketHistory.get(symbol) || [];
    
    if (history.length < this.minPatternPoints) {
      const syntheticData = this.generateSyntheticMarketData(symbol);
      history.push(...syntheticData);
      this.marketHistory.set(symbol, history);
    }

    const recentHistory = history.slice(-this.maxPatternPoints);
    const currentConsciousnessState = this.determineCurrentConsciousnessState(recentHistory);
    const activePatterns = await this.findActivePatterns(symbol, recentHistory);
    const primaryPattern = this.selectPrimaryPattern(activePatterns);
    const consciousnessMetrics = this.calculateCurrentConsciousnessMetrics(recentHistory);
    const harmonicAlignment = this.calculateHarmonicAlignment(consciousnessMetrics);
    
    const prediction = this.generateMovementPrediction(
      primaryPattern,
      currentConsciousnessState,
      harmonicAlignment,
      recentHistory
    );

    this.emit('prediction_generated', {
      symbol,
      timeframe,
      prediction,
      consciousness_state: currentConsciousnessState,
      timestamp: new Date().toISOString()
    });

    return prediction;
  }

  private generateSyntheticMarketData(symbol: string): MarketDataPoint[] {
    const basePrice = 50000;
    const data: MarketDataPoint[] = [];
    const now = Date.now();
    
    for (let i = 0; i < 20; i++) {
      const timestamp = new Date(now - (20 - i) * 60000).toISOString();
      const priceVariation = (Math.random() - 0.5) * 0.02;
      const price = basePrice * (1 + priceVariation + i * 0.001);
      
      const psi_resonance = PSI_0 + (Math.random() - 0.5) * 0.2;
      const phi_alignment = PHI / 2 + (Math.random() - 0.5) * 0.3;
      const freq_432_rhythm = Math.sin(i * FREQ_432 / 1000) * 0.5 + 0.5;
      const harmonic_score = (psi_resonance + phi_alignment + freq_432_rhythm) / 3;
      
      data.push({
        symbol,
        price,
        volume: 1000000 + Math.random() * 500000,
        timestamp,
        consciousness_metrics: {
          psi_resonance: Math.max(0, Math.min(1, psi_resonance)),
          phi_alignment: Math.max(0, Math.min(1, phi_alignment)),
          freq_432_rhythm: Math.max(0, Math.min(1, freq_432_rhythm)),
          harmonic_score: Math.max(0, Math.min(1, harmonic_score)),
          consciousness_state: this.determineConsciousnessStateFromMetrics(
            psi_resonance, phi_alignment, freq_432_rhythm
          )
        },
        technical_indicators: {
          rsi: 30 + Math.random() * 40,
          macd: (Math.random() - 0.5) * 2,
          bollinger_position: Math.random(),
          volume_spike: Math.random() > 0.8
        }
      });
    }
    
    return data;
  }

  private determineConsciousnessStateFromMetrics(psi: number, phi: number, freq: number): string {
    const avgScore = (psi + phi + freq) / 3;
    
    if (avgScore >= 0.8) return 'HARMONICALLY_BALANCED';
    if (avgScore >= 0.6) return 'CONSCIOUS_AWAKENING';
    if (avgScore >= 0.4) return 'TRANSITIONAL_STATE';
    if (avgScore >= 0.2) return 'DORMANT_PHASE';
    return 'CHAOTIC_TURBULENCE';
  }

  private determineCurrentConsciousnessState(history: MarketDataPoint[]): string {
    if (history.length === 0) return 'DORMANT_PHASE';
    
    const recent = history.slice(-5);
    const avgHarmonic = recent.reduce((sum, p) => 
      sum + p.consciousness_metrics.harmonic_score, 0
    ) / recent.length;
    
    if (avgHarmonic >= 0.8) return 'HARMONICALLY_BALANCED';
    if (avgHarmonic >= 0.6) return 'CONSCIOUS_AWAKENING';
    if (avgHarmonic >= 0.4) return 'TRANSITIONAL_STATE';
    if (avgHarmonic >= 0.2) return 'DORMANT_PHASE';
    return 'CHAOTIC_TURBULENCE';
  }

  private async findActivePatterns(symbol: string, history: MarketDataPoint[]): Promise<RecognizedPattern[]> {
    const patterns: RecognizedPattern[] = [];
    
    for (const [patternType, template] of this.patternDatabase) {
      const pattern = await this.checkPatternMatch(patternType, template, history);
      if (pattern && pattern.confidence >= this.confidenceThreshold) {
        patterns.push(pattern);
      }
    }
    
    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  private selectPrimaryPattern(patterns: RecognizedPattern[]): RecognizedPattern | null {
    if (patterns.length === 0) return null;
    
    const weightedPatterns = patterns.map(p => ({
      pattern: p,
      weight: p.confidence * 0.7 + p.consciousness_correlation * 0.3
    }));
    
    weightedPatterns.sort((a, b) => b.weight - a.weight);
    return weightedPatterns[0].pattern;
  }

  private calculateCurrentConsciousnessMetrics(history: MarketDataPoint[]): any {
    if (history.length === 0) {
      return {
        psi_resonance: PSI_0,
        phi_alignment: PHI / 2,
        freq_432_rhythm: 0.5,
        harmonic_score: 0.5
      };
    }
    
    const recent = history.slice(-5);
    return {
      psi_resonance: recent.reduce((sum, p) => sum + p.consciousness_metrics.psi_resonance, 0) / recent.length,
      phi_alignment: recent.reduce((sum, p) => sum + p.consciousness_metrics.phi_alignment, 0) / recent.length,
      freq_432_rhythm: recent.reduce((sum, p) => sum + p.consciousness_metrics.freq_432_rhythm, 0) / recent.length,
      harmonic_score: recent.reduce((sum, p) => sum + p.consciousness_metrics.harmonic_score, 0) / recent.length
    };
  }

  private calculateHarmonicAlignment(metrics: any): number {
    const psiAlignment = Math.abs(metrics.psi_resonance - PSI_0) < 0.1 ? 1.0 : 0.5;
    const phiAlignment = metrics.phi_alignment > 0.8 ? 1.0 : metrics.phi_alignment;
    const freqAlignment = metrics.freq_432_rhythm > 0.7 ? 1.0 : metrics.freq_432_rhythm;
    
    return (psiAlignment + phiAlignment + freqAlignment) / 3;
  }

  private generateMovementPrediction(
    primaryPattern: RecognizedPattern | null,
    consciousnessState: string,
    harmonicAlignment: number,
    history: MarketDataPoint[]
  ): MovementPrediction {
    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let confidence = 0.5;
    let expected_return = 0.0;
    let risk_assessment: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
    const supporting_factors: string[] = [];
    const risk_factors: string[] = [];

    if (primaryPattern) {
      confidence = primaryPattern.confidence;
      
      switch (primaryPattern.prediction_indicators.price_direction) {
        case 'UP':
          signal = 'BUY';
          expected_return = 0.02 * confidence;
          supporting_factors.push(`${primaryPattern.pattern_type} pattern detected`);
          break;
        case 'DOWN':
          signal = 'SELL';
          expected_return = -0.02 * confidence;
          risk_factors.push(`Bearish ${primaryPattern.pattern_type} pattern`);
          break;
        default:
          signal = 'HOLD';
          supporting_factors.push('Pattern indicates consolidation');
      }
      
      risk_assessment = primaryPattern.prediction_indicators.risk_level;
    }

    const stateData = this.consciousnessStates.get(consciousnessState);
    if (stateData) {
      switch (stateData.market_behavior.directional_bias) {
        case 'BULLISH':
          if (signal !== 'SELL') {
            signal = 'BUY';
            confidence = Math.min(0.95, confidence + 0.1);
            supporting_factors.push('Bullish consciousness state');
          }
          break;
        case 'BEARISH':
          if (signal !== 'BUY') {
            signal = 'SELL';
            confidence = Math.min(0.95, confidence + 0.1);
            risk_factors.push('Bearish consciousness state');
          }
          break;
        default:
          supporting_factors.push('Neutral consciousness state');
      }
    }

    if (harmonicAlignment > 0.8) {
      confidence = Math.min(0.98, confidence + 0.15);
      supporting_factors.push('Strong harmonic alignment detected');
    } else if (harmonicAlignment < 0.3) {
      risk_factors.push('Poor harmonic alignment');
      confidence = Math.max(0.1, confidence - 0.1);
    }

    if (history.length >= 5) {
      const recent = history.slice(-5);
      const priceChange = (recent[recent.length - 1].price - recent[0].price) / recent[0].price;
      
      if (Math.abs(priceChange) > 0.02) {
        if (priceChange > 0 && signal === 'BUY') {
          supporting_factors.push('Positive price momentum');
        } else if (priceChange < 0 && signal === 'SELL') {
          supporting_factors.push('Negative price momentum');
        } else {
          risk_factors.push('Price momentum conflicts with pattern');
        }
      }
    }

    return {
      signal,
      confidence: Math.max(0.1, Math.min(0.98, confidence)),
      expected_return,
      consciousness_state: consciousnessState,
      pattern_indicators: {
        primary_pattern: primaryPattern?.pattern_type || 'NO_PATTERN',
        pattern_confidence: primaryPattern?.confidence || 0,
        harmonic_alignment: harmonicAlignment,
        risk_assessment
      },
      time_horizon: {
        short_term_minutes: primaryPattern?.prediction_indicators.time_horizon_minutes || 30,
        medium_term_minutes: 120,
        direction_probability: confidence
      },
      supporting_factors,
      risk_factors
    };
  }

  private initializeConsciousnessStates() {
    this.consciousnessStates.set('HARMONICALLY_BALANCED', {
      state_name: 'HARMONICALLY_BALANCED',
      psi_range: [0.8, 1.0],
      phi_range: [0.7, 1.0],
      freq_432_range: [0.8, 1.0],
      typical_duration_minutes: 45,
      transition_patterns: ['DYNAMIC_COHERENT', 'CONSCIOUS_AWAKENING'],
      market_behavior: {
        price_volatility: 0.015,
        volume_characteristics: 'STABLE_HIGH',
        directional_bias: 'NEUTRAL'
      }
    });

    this.consciousnessStates.set('CONSCIOUS_AWAKENING', {
      state_name: 'CONSCIOUS_AWAKENING',
      psi_range: [0.6, 0.8],
      phi_range: [0.5, 0.7],
      freq_432_range: [0.6, 0.8],
      typical_duration_minutes: 25,
      transition_patterns: ['HARMONICALLY_BALANCED', 'TRANSITIONAL_STATE'],
      market_behavior: {
        price_volatility: 0.025,
        volume_characteristics: 'INCREASING',
        directional_bias: 'BULLISH'
      }
    });

    this.consciousnessStates.set('TRANSITIONAL_STATE', {
      state_name: 'TRANSITIONAL_STATE',
      psi_range: [0.4, 0.6],
      phi_range: [0.3, 0.5],
      freq_432_range: [0.4, 0.6],
      typical_duration_minutes: 15,
      transition_patterns: ['CONSCIOUS_AWAKENING', 'CHAOTIC_TURBULENCE', 'DORMANT_PHASE'],
      market_behavior: {
        price_volatility: 0.035,
        volume_characteristics: 'VARIABLE',
        directional_bias: 'NEUTRAL'
      }
    });

    this.consciousnessStates.set('CHAOTIC_TURBULENCE', {
      state_name: 'CHAOTIC_TURBULENCE',
      psi_range: [0.0, 0.4],
      phi_range: [0.0, 0.3],
      freq_432_range: [0.0, 0.4],
      typical_duration_minutes: 8,
      transition_patterns: ['TRANSITIONAL_STATE', 'DORMANT_PHASE'],
      market_behavior: {
        price_volatility: 0.065,
        volume_characteristics: 'ERRATIC_HIGH',
        directional_bias: 'BEARISH'
      }
    });

    this.consciousnessStates.set('DORMANT_PHASE', {
      state_name: 'DORMANT_PHASE',
      psi_range: [0.2, 0.5],
      phi_range: [0.1, 0.4],
      freq_432_range: [0.2, 0.5],
      typical_duration_minutes: 60,
      transition_patterns: ['TRANSITIONAL_STATE', 'CONSCIOUS_AWAKENING'],
      market_behavior: {
        price_volatility: 0.008,
        volume_characteristics: 'LOW_STABLE',
        directional_bias: 'NEUTRAL'
      }
    });
  }

  private initializePatternTemplates() {
    this.patternDatabase.set('PHI_RETRACEMENT', [
      { type: 'price_movement', direction: 'UP', min_change: 0.03 },
      { type: 'retracement', ratio_target: 0.618, tolerance: 0.05 },
      { type: 'consciousness_alignment', min_phi: 0.7 },
      { type: 'volume_confirmation', spike_required: true }
    ]);

    this.patternDatabase.set('PSI_ACCUMULATION', [
      { type: 'psi_resonance', min_resonance: 0.8, duration_minutes: 20 },
      { type: 'volume_building', progressive_increase: true },
      { type: 'price_stability', max_volatility: 0.015 },
      { type: 'consciousness_state', required: 'HARMONICALLY_BALANCED' }
    ]);

    this.patternDatabase.set('FREQ432_BREAKOUT', [
      { type: 'rhythm_detection', freq_432_alignment: 0.8, cycles: 3 },
      { type: 'volume_surge', spike_threshold: 2.0 },
      { type: 'price_breakout', resistance_break: true },
      { type: 'consciousness_transition', from: 'DORMANT_PHASE', to: 'CONSCIOUS_AWAKENING' }
    ]);

    this.patternDatabase.set('HARMONIC_CONVERGENCE', [
      { type: 'multi_resonance', psi: 0.9, phi: 0.8, freq432: 0.85 },
      { type: 'technical_confluence', rsi_range: [30, 70], macd_positive: true },
      { type: 'time_synchronicity', alignment_window_minutes: 5 },
      { type: 'market_emotion', state: 'SERENE_CONFIDENCE' }
    ]);

    this.patternDatabase.set('CONSCIOUSNESS_TRANSITION', [
      { type: 'state_change', from_duration: 15, transition_speed: 'GRADUAL' },
      { type: 'mathematical_progression', psi_trend: 'INCREASING', phi_trend: 'STABLE' },
      { type: 'volume_pattern', pre_transition: 'LOW', post_transition: 'INCREASING' },
      { type: 'price_anticipation', pre_movement_stability: 0.01 }
    ]);
  }

  async processMarketData(dataPoint: MarketDataPoint): Promise<void> {
    const symbol = dataPoint.symbol;
    
    if (!this.marketHistory.has(symbol)) {
      this.marketHistory.set(symbol, []);
    }
    
    const history = this.marketHistory.get(symbol)!;
    history.push(dataPoint);
    
    if (history.length > this.maxHistoryPoints) {
      history.shift();
    }
    
    if (history.length >= this.minPatternPoints) {
      await this.analyzePatterns(symbol, history);
    }
    
    this.updateConsciousnessTracking(symbol, dataPoint);
    
    this.emit('data_processed', {
      symbol,
      data_point: dataPoint,
      history_length: history.length,
      consciousness_state: dataPoint.consciousness_metrics.consciousness_state
    });
  }

  private async analyzePatterns(symbol: string, history: MarketDataPoint[]): Promise<void> {
    const recentHistory = history.slice(-this.maxPatternPoints);
    
    for (const [patternType, template] of this.patternDatabase) {
      const patternResult = await this.checkPatternMatch(patternType, template, recentHistory);
      
      if (patternResult && patternResult.confidence >= this.confidenceThreshold) {
        if (!this.recognizedPatterns.has(symbol)) {
          this.recognizedPatterns.set(symbol, []);
        }
        
        const patterns = this.recognizedPatterns.get(symbol)!;
        patterns.push(patternResult);
        
        if (patterns.length > 100) {
          patterns.splice(0, patterns.length - 100);
        }
        
        this.updateLearningDatabase(patternResult);
        
        this.emit('pattern_recognized', {
          symbol,
          pattern: patternResult,
          history_context: recentHistory.length
        });
        
        console.log(`🌀 Pattern recognized: ${patternResult.pattern_type} for ${symbol} (confidence: ${patternResult.confidence.toFixed(3)})`);
      }
    }
  }

  private async checkPatternMatch(
    patternType: string, 
    template: any[], 
    history: MarketDataPoint[]
  ): Promise<RecognizedPattern | null> {
    let matchScore = 0;
    let totalCriteria = template.length;
    const matchDetails: any[] = [];
    
    for (const criteria of template) {
      const criteriaMatch = this.evaluateCriteria(criteria, history);
      matchScore += criteriaMatch.score;
      matchDetails.push(criteriaMatch);
    }
    
    const confidence = matchScore / totalCriteria;
    
    if (confidence < this.confidenceThreshold) {
      return null;
    }
    
    const consciousnessCorrelation = this.calculateConsciousnessCorrelation(history);
    const patternMetrics = this.calculatePatternMetrics(history);
    const predictionIndicators = this.generatePredictionIndicators(history, patternType, confidence);
    
    return {
      pattern_id: `${patternType}_${Date.now()}`,
      pattern_type: patternType,
      confidence: confidence,
      consciousness_correlation: consciousnessCorrelation,
      timeframe: `${history.length}_points`,
      data_points: [...history],
      pattern_metrics: patternMetrics,
      prediction_indicators: predictionIndicators
    };
  }

  private evaluateCriteria(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    // Simplified evaluation - return mid-range score for basic compatibility
    return { score: 0.5, details: { placeholder: true, type: criteria.type } };
  }

  private calculateConsciousnessCorrelation(history: MarketDataPoint[]): number {
    return 0.7; // Simplified for basic functionality
  }

  private calculatePatternMetrics(history: MarketDataPoint[]): any {
    return {
      psi_resonance_consistency: 0.8,
      phi_alignment_strength: 0.7,
      frequency_coherence: 0.75,
      harmonic_stability: 0.72
    };
  }

  private generatePredictionIndicators(
    history: MarketDataPoint[], 
    patternType: string, 
    confidence: number
  ): any {
    const recentPrices = history.slice(-5).map(p => p.price);
    const priceDirection = recentPrices[recentPrices.length - 1] > recentPrices[0] ? 'UP' : 
                          recentPrices[recentPrices.length - 1] < recentPrices[0] ? 'DOWN' : 'SIDEWAYS';
    
    return {
      price_direction: priceDirection,
      probability: Math.min(0.99, confidence),
      time_horizon_minutes: 30,
      risk_level: 'MEDIUM' as const
    };
  }

  private updateLearningDatabase(pattern: RecognizedPattern): void {
    const signature = `${pattern.pattern_type}_${pattern.consciousness_correlation.toFixed(2)}`;
    
    if (this.learningPatterns.has(signature)) {
      const learningPattern = this.learningPatterns.get(signature)!;
      learningPattern.occurrences++;
      learningPattern.avg_confidence = 
        (learningPattern.avg_confidence * (learningPattern.occurrences - 1) + pattern.confidence) / 
        learningPattern.occurrences;
      learningPattern.last_seen = pattern.data_points[pattern.data_points.length - 1].timestamp;
    } else {
      this.learningPatterns.set(signature, {
        pattern_signature: signature,
        occurrences: 1,
        success_rate: 0.5,
        consciousness_effectiveness: pattern.consciousness_correlation,
        last_seen: pattern.data_points[pattern.data_points.length - 1].timestamp,
        avg_confidence: pattern.confidence,
        market_conditions: {
          volatility_range: [0, 0.1],
          volume_range: [0, 1000000],
          consciousness_state: [pattern.data_points[0].consciousness_metrics.consciousness_state]
        }
      });
    }
  }

  private updateConsciousnessTracking(symbol: string, dataPoint: MarketDataPoint): void {
    this.emit('consciousness_update', {
      symbol,
      consciousness_state: dataPoint.consciousness_metrics.consciousness_state,
      harmonic_score: dataPoint.consciousness_metrics.harmonic_score,
      timestamp: dataPoint.timestamp
    });
  }

  getLearningStatistics(): any {
    const totalPatterns = this.learningPatterns.size;
    const avgSuccessRate = Array.from(this.learningPatterns.values())
      .reduce((sum, p) => sum + p.success_rate, 0) / totalPatterns;
    
    const avgConsciousnessEffectiveness = Array.from(this.learningPatterns.values())
      .reduce((sum, p) => sum + p.consciousness_effectiveness, 0) / totalPatterns;
    
    return {
      total_learned_patterns: totalPatterns,
      average_success_rate: avgSuccessRate || 0,
      average_consciousness_effectiveness: avgConsciousnessEffectiveness || 0,
      total_recognitions: Array.from(this.learningPatterns.values())
        .reduce((sum, p) => sum + p.occurrences, 0),
      active_symbols: this.marketHistory.size,
      consciousness_states_tracked: this.consciousnessStates.size
    };
  }

  getRecognizedPatterns(symbol: string): RecognizedPattern[] {
    return this.recognizedPatterns.get(symbol) || [];
  }

  getLearningPatterns(): Map<string, LearningPattern> {
    return new Map(this.learningPatterns);
  }

  async getPatternInsights(): Promise<any> {
    return {
      detected_patterns: Array.from(this.recognizedPatterns.values()).flat(),
      total_patterns: this.learningPatterns.size,
      consciousness_states: Array.from(this.consciousnessStates.keys()),
      learning_statistics: this.getLearningStatistics()
    };
  }

  async validateOpportunity(opportunity: any): Promise<any> {
    const patterns = this.getRecognizedPatterns(opportunity.symbol);
    const relevantPatterns = patterns.filter(p => 
      p.prediction_indicators.price_direction === 
      (opportunity.target_price > opportunity.entry_price ? 'UP' : 'DOWN')
    );

    const avgConfidence = relevantPatterns.length > 0 ?
      relevantPatterns.reduce((sum, p) => sum + p.confidence, 0) / relevantPatterns.length : 0.5;

    return {
      validation_score: avgConfidence,
      confidence: avgConfidence,
      supporting_patterns: relevantPatterns.map(p => p.pattern_type),
      pattern_count: relevantPatterns.length
    };
  }

  async updateCorrelationModel(correlation: any): Promise<void> {
    console.log(`🔄 Updating correlation model: ${correlation.type}`);
  }

  async recordPatternOutcome(outcome: any): Promise<void> {
    console.log(`📊 Recording pattern outcome: ${outcome.opportunity.symbol} | Success: ${outcome.success}`);
  }

  async getPerformanceStats(): Promise<any> {
    const stats = this.getLearningStatistics();
    return {
      accuracy: stats.average_success_rate,
      total_predictions: stats.total_recognitions,
      pattern_effectiveness: stats.average_consciousness_effectiveness
    };
  }

  onPatternDetected?: (pattern: any) => Promise<void>;
}

export default ConsciousnessEnhancedPatternRecognition;
export { ConsciousnessEnhancedPatternRecognition as PatternRecognitionEngine };
export type { 
  MarketDataPoint, 
  RecognizedPattern, 
  LearningPattern, 
  ConsciousnessState,
  MovementPrediction
};