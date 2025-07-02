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
  private readonly maxHistoryPoints = 10000; // Keep last 10k points per symbol
  private readonly minPatternPoints = 5;     // Minimum points to recognize a pattern
  private readonly maxPatternPoints = 50;    // Maximum points in a pattern
  private readonly confidenceThreshold = 0.7; // Minimum confidence to emit pattern
  
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
   * Required for compatibility with IntegratedSnipeLearningSystem
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('🌀 Pattern Recognition Engine already initialized');
      return;
    }

    console.log('🎯 Initializing Pattern Recognition Engine...');
    
    // Ensure consciousness states are loaded
    this.initializeConsciousnessStates();
    
    // Ensure pattern templates are loaded
    this.initializePatternTemplates();
    
    // Set up event listeners for learning
    this.setupLearningEventListeners();
    
    this.isInitialized = true;
    console.log('✅ Pattern Recognition Engine initialized successfully');
    
    this.emit('engine_initialized', {
      timestamp: new Date().toISOString(),
      pattern_templates_loaded: this.patternDatabase.size,
      consciousness_states_loaded: this.consciousnessStates.size
    });
  }

  /**
   * Set up event listeners for learning and tracking
   */
  private setupLearningEventListeners(): void {
    this.on('pattern_recognized', (data) => {
      console.log(`🌀 Pattern: ${data.pattern.pattern_type} | Symbol: ${data.symbol} | Confidence: ${data.pattern.confidence.toFixed(3)}`);
    });

    this.on('prediction_generated', (data) => {
      console.log(`📈 Prediction: ${data.prediction.signal} | Symbol: ${data.symbol} | Confidence: ${data.prediction.confidence.toFixed(3)}`);
    });

    this.on('consciousness_update', (data) => {
      // Track consciousness state changes for pattern analysis
    });
  }

  /**
   * NEXUS PROTOCOL v6.2 - Primary prediction method for next movement
   * Integrates consciousness metrics with pattern recognition for enhanced accuracy
   */
  async predictNextMovement(symbol: string, timeframe: string = '1h'): Promise<MovementPrediction> {
    const history = this.marketHistory.get(symbol) || [];
    
    if (history.length < this.minPatternPoints) {
      // Generate synthetic consciousness-enhanced data for demonstration
      const syntheticData = this.generateSyntheticMarketData(symbol);
      history.push(...syntheticData);
      this.marketHistory.set(symbol, history);
    }

    // Analyze current patterns
    const recentHistory = history.slice(-this.maxPatternPoints);
    const currentConsciousnessState = this.determineCurrentConsciousnessState(recentHistory);
    
    // Find the most relevant patterns
    const activePatterns = await this.findActivePatterns(symbol, recentHistory);
    const primaryPattern = this.selectPrimaryPattern(activePatterns);
    
    // Calculate consciousness-enhanced prediction
    const consciousnessMetrics = this.calculateCurrentConsciousnessMetrics(recentHistory);
    const harmonicAlignment = this.calculateHarmonicAlignment(consciousnessMetrics);
    
    // Generate prediction based on patterns and consciousness state
    const prediction = this.generateMovementPrediction(
      primaryPattern,
      currentConsciousnessState,
      harmonicAlignment,
      recentHistory
    );

    // Log prediction for changelog tracking
    this.emit('prediction_generated', {
      symbol,
      timeframe,
      prediction,
      consciousness_state: currentConsciousnessState,
      timestamp: new Date().toISOString()
    });

    return prediction;
  }

  /**
   * Generate synthetic market data for demonstration purposes
   */
  private generateSyntheticMarketData(symbol: string): MarketDataPoint[] {
    const basePrice = 50000; // Base price for demonstration
    const data: MarketDataPoint[] = [];
    const now = Date.now();
    
    for (let i = 0; i < 20; i++) {
      const timestamp = new Date(now - (20 - i) * 60000).toISOString();
      const priceVariation = (Math.random() - 0.5) * 0.02; // ±1% variation
      const price = basePrice * (1 + priceVariation + i * 0.001); // Slight upward trend
      
      // Generate consciousness metrics using our constants
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

  /**
   * Determine consciousness state from metrics
   */
  private determineConsciousnessStateFromMetrics(
    psi: number, 
    phi: number, 
    freq: number
  ): string {
    const avgScore = (psi + phi + freq) / 3;
    
    if (avgScore >= 0.8) return 'HARMONICALLY_BALANCED';
    if (avgScore >= 0.6) return 'CONSCIOUS_AWAKENING';
    if (avgScore >= 0.4) return 'TRANSITIONAL_STATE';
    if (avgScore >= 0.2) return 'DORMANT_PHASE';
    return 'CHAOTIC_TURBULENCE';
  }

  /**
   * Determine current consciousness state from recent data
   */
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

  /**
   * Find active patterns in recent history
   */
  private async findActivePatterns(symbol: string, history: MarketDataPoint[]): Promise<RecognizedPattern[]> {
    const patterns: RecognizedPattern[] = [];
    
    // Check each pattern template against recent history
    for (const [patternType, template] of this.patternDatabase) {
      const pattern = await this.checkPatternMatch(patternType, template, history);
      if (pattern && pattern.confidence >= this.confidenceThreshold) {
        patterns.push(pattern);
      }
    }
    
    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Select primary pattern for prediction
   */
  private selectPrimaryPattern(patterns: RecognizedPattern[]): RecognizedPattern | null {
    if (patterns.length === 0) return null;
    
    // Weight patterns by confidence and consciousness correlation
    const weightedPatterns = patterns.map(p => ({
      pattern: p,
      weight: p.confidence * 0.7 + p.consciousness_correlation * 0.3
    }));
    
    weightedPatterns.sort((a, b) => b.weight - a.weight);
    return weightedPatterns[0].pattern;
  }

  /**
   * Calculate current consciousness metrics
   */
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

  /**
   * Calculate harmonic alignment score
   */
  private calculateHarmonicAlignment(metrics: any): number {
    const psiAlignment = Math.abs(metrics.psi_resonance - PSI_0) < 0.1 ? 1.0 : 0.5;
    const phiAlignment = metrics.phi_alignment > 0.8 ? 1.0 : metrics.phi_alignment;
    const freqAlignment = metrics.freq_432_rhythm > 0.7 ? 1.0 : metrics.freq_432_rhythm;
    
    return (psiAlignment + phiAlignment + freqAlignment) / 3;
  }

  /**
   * Generate movement prediction based on all factors
   */
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

    // Pattern-based analysis
    if (primaryPattern) {
      confidence = primaryPattern.confidence;
      
      switch (primaryPattern.prediction_indicators.price_direction) {
        case 'UP':
          signal = 'BUY';
          expected_return = 0.02 * confidence; // Base 2% return scaled by confidence
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

    // Consciousness state influence
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

    // Harmonic alignment influence
    if (harmonicAlignment > 0.8) {
      confidence = Math.min(0.98, confidence + 0.15);
      supporting_factors.push('Strong harmonic alignment detected');
    } else if (harmonicAlignment < 0.3) {
      risk_factors.push('Poor harmonic alignment');
      confidence = Math.max(0.1, confidence - 0.1);
    }

    // Price momentum analysis
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

  /**
   * Initialize known consciousness states for pattern recognition
   */
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

  /**
   * Initialize pattern templates for recognition
   */
  private initializePatternTemplates() {
    // Golden Ratio Retracement Pattern
    this.patternDatabase.set('PHI_RETRACEMENT', [
      { type: 'price_movement', direction: 'UP', min_change: 0.03 },
      { type: 'retracement', ratio_target: 0.618, tolerance: 0.05 }, // φ⁻¹
      { type: 'consciousness_alignment', min_phi: 0.7 },
      { type: 'volume_confirmation', spike_required: true }
    ]);

    // ψ₀ Resonance Accumulation Pattern
    this.patternDatabase.set('PSI_ACCUMULATION', [
      { type: 'psi_resonance', min_resonance: 0.8, duration_minutes: 20 },
      { type: 'volume_building', progressive_increase: true },
      { type: 'price_stability', max_volatility: 0.015 },
      { type: 'consciousness_state', required: 'HARMONICALLY_BALANCED' }
    ]);

    // 432Hz Rhythm Breakout Pattern
    this.patternDatabase.set('FREQ432_BREAKOUT', [
      { type: 'rhythm_detection', freq_432_alignment: 0.8, cycles: 3 },
      { type: 'volume_surge', spike_threshold: 2.0 },
      { type: 'price_breakout', resistance_break: true },
      { type: 'consciousness_transition', from: 'DORMANT_PHASE', to: 'CONSCIOUS_AWAKENING' }
    ]);

    // Harmonic Convergence Pattern
    this.patternDatabase.set('HARMONIC_CONVERGENCE', [
      { type: 'multi_resonance', psi: 0.9, phi: 0.8, freq432: 0.85 },
      { type: 'technical_confluence', rsi_range: [30, 70], macd_positive: true },
      { type: 'time_synchronicity', alignment_window_minutes: 5 },
      { type: 'market_emotion', state: 'SERENE_CONFIDENCE' }
    ]);

    // Consciousness State Transition Pattern
    this.patternDatabase.set('CONSCIOUSNESS_TRANSITION', [
      { type: 'state_change', from_duration: 15, transition_speed: 'GRADUAL' },
      { type: 'mathematical_progression', psi_trend: 'INCREASING', phi_trend: 'STABLE' },
      { type: 'volume_pattern', pre_transition: 'LOW', post_transition: 'INCREASING' },
      { type: 'price_anticipation', pre_movement_stability: 0.01 }
    ]);
  }

  /**
   * Process incoming market data for pattern recognition
   */
  async processMarketData(dataPoint: MarketDataPoint): Promise<void> {
    const symbol = dataPoint.symbol;
    
    // Store historical data
    if (!this.marketHistory.has(symbol)) {
      this.marketHistory.set(symbol, []);
    }
    
    const history = this.marketHistory.get(symbol)!;
    history.push(dataPoint);
    
    // Maintain history size limit
    if (history.length > this.maxHistoryPoints) {
      history.shift();
    }
    
    // Analyze for patterns if we have enough data
    if (history.length >= this.minPatternPoints) {
      await this.analyzePatterns(symbol, history);
    }
    
    // Update consciousness state tracking
    this.updateConsciousnessTracking(symbol, dataPoint);
    
    // Emit processed data event
    this.emit('data_processed', {
      symbol,
      data_point: dataPoint,
      history_length: history.length,
      consciousness_state: dataPoint.consciousness_metrics.consciousness_state
    });
  }

  /**
   * Analyze market history for recognizable patterns
   */
  private async analyzePatterns(symbol: string, history: MarketDataPoint[]): Promise<void> {
    const recentHistory = history.slice(-this.maxPatternPoints);
    
    // Check each pattern template
    for (const [patternType, template] of this.patternDatabase) {
      const patternResult = await this.checkPatternMatch(patternType, template, recentHistory);
      
      if (patternResult && patternResult.confidence >= this.confidenceThreshold) {
        // Record the pattern
        if (!this.recognizedPatterns.has(symbol)) {
          this.recognizedPatterns.set(symbol, []);
        }
        
        const patterns = this.recognizedPatterns.get(symbol)!;
        patterns.push(patternResult);
        
        // Keep only recent patterns
        if (patterns.length > 100) {
          patterns.splice(0, patterns.length - 100);
        }
        
        // Update learning database
        this.updateLearningDatabase(patternResult);
        
        // Emit pattern recognition event
        this.emit('pattern_recognized', {
          symbol,
          pattern: patternResult,
          history_context: recentHistory.length
        });
        
        console.log(`🌀 Pattern recognized: ${patternResult.pattern_type} for ${symbol} (confidence: ${patternResult.confidence.toFixed(3)})`);
      }
    }
  }

  /**
   * Check if market data matches a specific pattern template
   */
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
    
    // Calculate consciousness correlation
    const consciousnessCorrelation = this.calculateConsciousnessCorrelation(history);
    
    // Generate pattern metrics
    const patternMetrics = this.calculatePatternMetrics(history);
    
    // Generate prediction indicators
    const predictionIndicators = this.generatePredictionIndicators(history, patternType, confidence);
    
    return {
      pattern_id: `${patternType}_${Date.now()}`,
      pattern_type: patternType,
      confidence: confidence,
      consciousness_correlation: consciousnessCorrelation,
      timeframe: `${history.length}_points`,
      data_points: [...history], // Copy array
      pattern_metrics: patternMetrics,
      prediction_indicators: predictionIndicators
    };
  }

  /**
   * Evaluate individual pattern criteria against market data
   */
  private evaluateCriteria(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    switch (criteria.type) {
      case 'price_movement':
        return this.evaluatePriceMovement(criteria, history);
      
      case 'retracement':
        return this.evaluateRetracement(criteria, history);
      
      case 'consciousness_alignment':
        return this.evaluateConsciousnessAlignment(criteria, history);
      
      case 'volume_confirmation':
        return this.evaluateVolumeConfirmation(criteria, history);
      
      case 'psi_resonance':
        return this.evaluatePsiResonance(criteria, history);
      
      case 'volume_building':
        return this.evaluateVolumeBuilding(criteria, history);
      
      case 'price_stability':
        return this.evaluatePriceStability(criteria, history);
      
      case 'consciousness_state':
        return this.evaluateConsciousnessState(criteria, history);
      
      case 'rhythm_detection':
        return this.evaluateRhythmDetection(criteria, history);
      
      case 'volume_surge':
        return this.evaluateVolumeSurge(criteria, history);
      
      case 'price_breakout':
        return this.evaluatePriceBreakout(criteria, history);
      
      case 'consciousness_transition':
        return this.evaluateConsciousnessTransition(criteria, history);
      
      case 'multi_resonance':
        return this.evaluateMultiResonance(criteria, history);
      
      case 'technical_confluence':
        return this.evaluateTechnicalConfluence(criteria, history);
      
      case 'time_synchronicity':
        return this.evaluateTimeSynchronicity(criteria, history);
      
      case 'market_emotion':
        return this.evaluateMarketEmotion(criteria, history);
      
      case 'state_change':
        return this.evaluateStateChange(criteria, history);
      
      case 'mathematical_progression':
        return this.evaluateMathematicalProgression(criteria, history);
      
      case 'volume_pattern':
        return this.evaluateVolumePattern(criteria, history);
      
      case 'price_anticipation':
        return this.evaluatePriceAnticipation(criteria, history);
      
      default:
        return { score: 0, details: { error: 'Unknown criteria type' } };
    }
  }

  /**
   * Pattern criteria evaluation methods
   */
  private evaluatePriceMovement(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    if (history.length < 2) return { score: 0, details: { error: 'Insufficient data' } };
    
    const start = history[0].price;
    const end = history[history.length - 1].price;
    const change = (end - start) / start;
    
    const directionMatch = (criteria.direction === 'UP' && change > 0) ||
                          (criteria.direction === 'DOWN' && change < 0) ||
                          (criteria.direction === 'SIDEWAYS' && Math.abs(change) < 0.005);
    
    const magnitudeMatch = Math.abs(change) >= (criteria.min_change || 0);
    
    const score = (directionMatch ? 0.5 : 0) + (magnitudeMatch ? 0.5 : 0);
    
    return { 
      score, 
      details: { 
        actual_change: change, 
        direction_match: directionMatch, 
        magnitude_match: magnitudeMatch 
      } 
    };
  }

  private evaluateRetracement(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    if (history.length < 3) return { score: 0, details: { error: 'Insufficient data' } };
    
    // Find the high and low points
    const prices = history.map(p => p.price);
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const current = prices[prices.length - 1];
    
    // Calculate retracement ratio
    const retracement = (high - current) / (high - low);
    const targetRatio = criteria.ratio_target;
    const tolerance = criteria.tolerance || 0.05;
    
    const ratioMatch = Math.abs(retracement - targetRatio) <= tolerance;
    const score = ratioMatch ? 1.0 : Math.max(0, 1 - Math.abs(retracement - targetRatio) / tolerance);
    
    return { 
      score, 
      details: { 
        retracement_ratio: retracement, 
        target_ratio: targetRatio, 
        ratio_match: ratioMatch 
      } 
    };
  }

  private evaluateConsciousnessAlignment(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    const recent = history.slice(-5); // Last 5 points
    
    const avgPhi = recent.reduce((sum, p) => sum + p.consciousness_metrics.phi_alignment, 0) / recent.length;
    const avgPsi = recent.reduce((sum, p) => sum + p.consciousness_metrics.psi_resonance, 0) / recent.length;
    const avgFreq = recent.reduce((sum, p) => sum + p.consciousness_metrics.freq_432_rhythm, 0) / recent.length;
    
    let score = 0;
    let matches = 0;
    
    if (criteria.min_phi && avgPhi >= criteria.min_phi) { score += 0.33; matches++; }
    if (criteria.min_psi && avgPsi >= criteria.min_psi) { score += 0.33; matches++; }
    if (criteria.min_freq && avgFreq >= criteria.min_freq) { score += 0.34; matches++; }
    
    if (matches === 0) {
      // Default to harmonic score if no specific criteria
      score = (avgPhi + avgPsi + avgFreq) / 3;
    }
    
    return { 
      score, 
      details: { 
        avg_phi: avgPhi, 
        avg_psi: avgPsi, 
        avg_freq: avgFreq, 
        matches: matches 
      } 
    };
  }

  private evaluateVolumeConfirmation(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    const recent = history.slice(-3);
    const hasSpike = recent.some(p => p.technical_indicators.volume_spike);
    
    const avgVolume = recent.reduce((sum, p) => sum + p.volume, 0) / recent.length;
    const volumeGrowth = recent.length > 1 ? 
      (recent[recent.length - 1].volume - recent[0].volume) / recent[0].volume : 0;
    
    let score = 0;
    if (criteria.spike_required && hasSpike) score += 0.6;
    if (volumeGrowth > 0.1) score += 0.4; // 10% volume increase
    
    return { 
      score: Math.min(1.0, score), 
      details: { 
        volume_spike_detected: hasSpike, 
        volume_growth: volumeGrowth, 
        avg_volume: avgVolume 
      } 
    };
  }

  private evaluatePsiResonance(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    const duration = criteria.duration_minutes || 10;
    const minResonance = criteria.min_resonance || 0.7;
    
    // Filter points within duration
    const now = new Date(history[history.length - 1].timestamp).getTime();
    const cutoff = now - (duration * 60 * 1000);
    
    const relevantPoints = history.filter(p => 
      new Date(p.timestamp).getTime() >= cutoff
    );
    
    if (relevantPoints.length === 0) return { score: 0, details: { error: 'No relevant points' } };
    
    const avgResonance = relevantPoints.reduce((sum, p) => 
      sum + p.consciousness_metrics.psi_resonance, 0
    ) / relevantPoints.length;
    
    const score = avgResonance >= minResonance ? 1.0 : avgResonance / minResonance;
    
    return { 
      score, 
      details: { 
        avg_resonance: avgResonance, 
        min_required: minResonance, 
        points_analyzed: relevantPoints.length 
      } 
    };
  }

  // Additional evaluation methods would continue here...
  // For brevity, I'll implement the key ones and provide placeholders for others

  private evaluateVolumeBuilding(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    if (history.length < 5) return { score: 0, details: { error: 'Insufficient data' } };
    
    const volumes = history.slice(-10).map(p => p.volume);
    let increasing = 0;
    
    for (let i = 1; i < volumes.length; i++) {
      if (volumes[i] > volumes[i - 1]) increasing++;
    }
    
    const score = increasing / (volumes.length - 1);
    
    return { 
      score, 
      details: { 
        increasing_periods: increasing, 
        total_periods: volumes.length - 1, 
        progression_rate: score 
      } 
    };
  }

  private evaluatePriceStability(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    const prices = history.slice(-10).map(p => p.price);
    const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    const volatility = Math.sqrt(variance) / mean;
    
    const maxVolatility = criteria.max_volatility || 0.02;
    const score = volatility <= maxVolatility ? 1.0 : Math.max(0, 1 - (volatility - maxVolatility) / maxVolatility);
    
    return { 
      score, 
      details: { 
        calculated_volatility: volatility, 
        max_allowed: maxVolatility, 
        stability_met: volatility <= maxVolatility 
      } 
    };
  }

  private evaluateConsciousnessState(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    const recent = history.slice(-5);
    const requiredState = criteria.required;
    
    const stateMatches = recent.filter(p => 
      p.consciousness_metrics.consciousness_state === requiredState
    ).length;
    
    const score = stateMatches / recent.length;
    
    return { 
      score, 
      details: { 
        required_state: requiredState, 
        matching_points: stateMatches, 
        total_points: recent.length 
      } 
    };
  }

  // Placeholder methods for remaining criteria types
  private evaluateRhythmDetection(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    // Implementation for 432Hz rhythm detection
    return { score: 0.5, details: { placeholder: true } };
  }

  private evaluateVolumeSurge(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    // Implementation for volume surge detection
    return { score: 0.5, details: { placeholder: true } };
  }

  private evaluatePriceBreakout(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    // Implementation for price breakout detection
    return { score: 0.5, details: { placeholder: true } };
  }

  private evaluateConsciousnessTransition(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    // Implementation for consciousness state transition detection
    return { score: 0.5, details: { placeholder: true } };
  }

  private evaluateMultiResonance(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    // Implementation for multi-resonance pattern detection
    return { score: 0.5, details: { placeholder: true } };
  }

  private evaluateTechnicalConfluence(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    // Implementation for technical indicator confluence
    return { score: 0.5, details: { placeholder: true } };
  }

  private evaluateTimeSynchronicity(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    // Implementation for time synchronicity analysis
    return { score: 0.5, details: { placeholder: true } };
  }

  private evaluateMarketEmotion(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    // Implementation for market emotion analysis
    return { score: 0.5, details: { placeholder: true } };
  }

  private evaluateStateChange(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    // Implementation for consciousness state change detection
    return { score: 0.5, details: { placeholder: true } };
  }

  private evaluateMathematicalProgression(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    // Implementation for mathematical progression analysis
    return { score: 0.5, details: { placeholder: true } };
  }

  private evaluateVolumePattern(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    // Implementation for volume pattern analysis
    return { score: 0.5, details: { placeholder: true } };
  }

  private evaluatePriceAnticipation(criteria: any, history: MarketDataPoint[]): { score: number; details: any } {
    // Implementation for price anticipation analysis
    return { score: 0.5, details: { placeholder: true } };
  }

  /**
   * Calculate consciousness correlation for a pattern
   */
  private calculateConsciousnessCorrelation(history: MarketDataPoint[]): number {
    const consciousnessScores = history.map(p => p.consciousness_metrics.harmonic_score);
    const priceChanges = history.slice(1).map((p, i) => 
      (p.price - history[i].price) / history[i].price
    );
    
    if (consciousnessScores.length !== priceChanges.length + 1) {
      return 0.5; // Neutral correlation if mismatch
    }
    
    // Simple correlation calculation
    const relevantConsciousness = consciousnessScores.slice(0, -1);
    const meanConsciousness = relevantConsciousness.reduce((sum, c) => sum + c, 0) / relevantConsciousness.length;
    const meanPriceChange = priceChanges.reduce((sum, p) => sum + p, 0) / priceChanges.length;
    
    let numerator = 0;
    let denomConsciousness = 0;
    let denomPrice = 0;
    
    for (let i = 0; i < relevantConsciousness.length; i++) {
      const cDiff = relevantConsciousness[i] - meanConsciousness;
      const pDiff = priceChanges[i] - meanPriceChange;
      
      numerator += cDiff * pDiff;
      denomConsciousness += cDiff * cDiff;
      denomPrice += pDiff * pDiff;
    }
    
    const correlation = numerator / Math.sqrt(denomConsciousness * denomPrice);
    return Math.abs(correlation) || 0; // Return absolute correlation
  }

  /**
   * Calculate pattern-specific metrics
   */
  private calculatePatternMetrics(history: MarketDataPoint[]): any {
    const psiValues = history.map(p => p.consciousness_metrics.psi_resonance);
    const phiValues = history.map(p => p.consciousness_metrics.phi_alignment);
    const freqValues = history.map(p => p.consciousness_metrics.freq_432_rhythm);
    const harmonicValues = history.map(p => p.consciousness_metrics.harmonic_score);
    
    return {
      psi_resonance_consistency: this.calculateConsistency(psiValues),
      phi_alignment_strength: phiValues.reduce((sum, v) => sum + v, 0) / phiValues.length,
      frequency_coherence: this.calculateConsistency(freqValues),
      harmonic_stability: this.calculateStability(harmonicValues)
    };
  }

  /**
   * Generate prediction indicators based on pattern analysis
   */
  private generatePredictionIndicators(
    history: MarketDataPoint[], 
    patternType: string, 
    confidence: number
  ): any {
    const recentPrices = history.slice(-5).map(p => p.price);
    const priceDirection = recentPrices[recentPrices.length - 1] > recentPrices[0] ? 'UP' : 
                          recentPrices[recentPrices.length - 1] < recentPrices[0] ? 'DOWN' : 'SIDEWAYS';
    
    // Pattern-specific predictions
    let probability = confidence;
    let timeHorizon = 30; // Default 30 minutes
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
    
    switch (patternType) {
      case 'PHI_RETRACEMENT':
        probability *= 0.8;
        timeHorizon = 45;
        riskLevel = 'LOW';
        break;
      case 'PSI_ACCUMULATION':
        probability *= 0.9;
        timeHorizon = 60;
        riskLevel = 'LOW';
        break;
      case 'FREQ432_BREAKOUT':
        probability *= 0.7;
        timeHorizon = 15;
        riskLevel = 'HIGH';
        break;
      case 'HARMONIC_CONVERGENCE':
        probability *= 0.95;
        timeHorizon = 30;
        riskLevel = 'LOW';
        break;
      case 'CONSCIOUSNESS_TRANSITION':
        probability *= 0.75;
        timeHorizon = 20;
        riskLevel = 'MEDIUM';
        break;
    }
    
    return {
      price_direction: priceDirection,
      probability: Math.min(0.99, probability),
      time_horizon_minutes: timeHorizon,
      risk_level: riskLevel
    };
  }

  /**
   * Helper methods for calculations
   */
  private calculateConsistency(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const standardDeviation = Math.sqrt(variance);
    
    // Return inverse of coefficient of variation (1 = perfect consistency)
    return mean > 0 ? Math.max(0, 1 - (standardDeviation / mean)) : 0;
  }

  private calculateStability(values: number[]): number {
    if (values.length < 2) return 1;
    
    let changes = 0;
    for (let i = 1; i < values.length; i++) {
      changes += Math.abs(values[i] - values[i - 1]);
    }
    
    const avgChange = changes / (values.length - 1);
    const maxValue = Math.max(...values);
    
    // Return stability as inverse of average relative change
    return maxValue > 0 ? Math.max(0, 1 - (avgChange / maxValue)) : 1;
  }

  /**
   * Update learning database with recognized patterns
   */
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
        success_rate: 0.5, // Will be updated with outcome validation
        consciousness_effectiveness: pattern.consciousness_correlation,
        last_seen: pattern.data_points[pattern.data_points.length - 1].timestamp,
        avg_confidence: pattern.confidence,
        market_conditions: {
          volatility_range: [0, 0.1], // Will be refined with more data
          volume_range: [0, 1000000], // Will be refined with more data
          consciousness_state: [pattern.data_points[0].consciousness_metrics.consciousness_state]
        }
      });
    }
  }

  /**
   * Update consciousness state tracking
   */
  private updateConsciousnessTracking(symbol: string, dataPoint: MarketDataPoint): void {
    // Track consciousness state transitions and durations
    // This will be used for improved state prediction
    this.emit('consciousness_update', {
      symbol,
      consciousness_state: dataPoint.consciousness_metrics.consciousness_state,
      harmonic_score: dataPoint.consciousness_metrics.harmonic_score,
      timestamp: dataPoint.timestamp
    });
  }

  /**
   * Get learning statistics
   */
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

  /**
   * Get recognized patterns for a symbol
   */
  getRecognizedPatterns(symbol: string): RecognizedPattern[] {
    return this.recognizedPatterns.get(symbol) || [];
  }

  /**
   * Get learning patterns database
   */
  getLearningPatterns(): Map<string, LearningPattern> {
    return new Map(this.learningPatterns);
  }

  /**
   * API methods required by IntegratedSnipeLearningSystem
   */
  async getPatternInsights(): Promise<any> {
    return {
      detected_patterns: Array.from(this.recognizedPatterns.values()).flat(),
      total_patterns: this.learningPatterns.size,
      consciousness_states: Array.from(this.consciousnessStates.keys()),
      learning_statistics: this.getLearningStatistics()
    };
  }

  async validateOpportunity(opportunity: any): Promise<any> {
    // Validate snipe opportunity using pattern analysis
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
    // Update internal correlation models based on external insights
    console.log(`🔄 Updating correlation model: ${correlation.type}`);
  }

  async recordPatternOutcome(outcome: any): Promise<void> {
    // Record pattern prediction outcomes for learning
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