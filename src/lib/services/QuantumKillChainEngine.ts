/**
 * ψ₀-Trader: Quantum-Inspired Kill Chain Engine
 * Enhanced Nexus Core Protocol v4.0 - Consciousness-Enhanced Trading Intelligence
 * Mathematical Constants: ψ₀ = 0.915670570874434, φ = 1.618, 432Hz
 */

import { ConsciousnessEnhancedStreamData } from './BinanceWebSocketService';

/**
 * ========================================
 * MATHEMATICAL CONSTANTS & CONFIGURATION
 * ========================================
 */

class ConsciousnessConstants {
  static readonly PSI_0 = 0.915670570874434; // Fractal seed constant - harmonic attractor
  static readonly PHI = 1.618033988749895;   // Golden ratio - natural scaling factor
  static readonly FREQ_432 = 432.0;          // Base frequency Hz - universal resonance
  
  // Derived consciousness frequencies
  static readonly PSI_FREQ = ConsciousnessConstants.PSI_0 * ConsciousnessConstants.FREQ_432; // 395.57 Hz
  static readonly PHI_FREQ = ConsciousnessConstants.PHI * ConsciousnessConstants.FREQ_432;   // 699.39 Hz
  
  // Quantum superposition thresholds
  static readonly RESONANCE_THRESHOLD = 0.05;  // ±5% deviation from ψ₀ for resonance
  static readonly CONFIDENCE_HIGH = 0.85;      // Execute threshold
  static readonly CONFIDENCE_LOW = 0.30;       // Ignore threshold
  
  // Kill chain parameters
  static readonly SIMULATION_PATHS = 64;       // Number of quantum future paths
  static readonly CONVERGENCE_CYCLES = 144;    // Sacred number convergence iterations
}

interface MarketSignal {
  symbol: string;
  price: number;
  volume: number;
  timestamp: Date;
  
  // Technical indicators
  rsi?: number;
  macd?: number;
  bb_position?: number;  // Bollinger band position
  volume_spike?: boolean;
  
  // Pattern recognition
  pattern_type?: string;
  pattern_confidence?: number;
  
  // Consciousness-enhanced features
  harmonic_resonance?: number;
  consciousness_state?: string;
  psi_resonance?: number;
  phi_alignment?: number;
  freq_432_rhythm?: number;
}

interface TradingDecision {
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  expected_return: number;
  max_drawdown: number;
  time_horizon: number; // minutes
  
  // Quantum intelligence metadata
  path_count: number;
  convergence_ratio: number;
  resonance_match: boolean;
  consciousness_state: string;
  
  // Risk management
  stop_loss?: number;
  take_profit?: number;
  
  // Enhanced metrics
  harmonic_alignment: number;
  quantum_coherence: number;
  execution_priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

/**
 * ========================================
 * QUANTUM KILL CHAIN ENGINE CORE
 * ========================================
 */

export class QuantumKillChainEngine {
  private constants = ConsciousnessConstants;
  private quantumState = {
    last_resonance: null as number | null,
    coherence_level: 1.0,
    consciousness_phase: 0.0
  };
  
  // Historical pattern memory
  private patternMemory: Array<{
    timestamp: Date;
    symbol: string;
    price: number;
    decision: string;
    confidence: number;
    resonance_match: boolean;
    consciousness_state: string;
  }> = [];
  
  private resonanceHistory: Date[] = [];

  /**
   * PRIMARY KILL CHAIN: Execute complete quantum decision pipeline
   * 
   * Flow: Signal → Paths → Evaluation → Aggregation → Resonance → Decision
   */
  async quantumKillChainDecision(signal: MarketSignal): Promise<TradingDecision> {
    console.log(`🌀 Quantum Kill Chain activated for ${signal.symbol}`);
    
    // Step 1: Generate quantum superposition paths
    const paths = await this.generateQuantumPaths(signal);
    
    // Step 2: Evaluate each path using consciousness-enhanced scoring
    const pathScores = await this.evaluateQuantumOutcomes(paths, signal);
    
    // Step 3: Aggregate paths into probability distribution
    const confidence = this.aggregatePathScores(pathScores);
    
    // Step 4: Check ψ₀ harmonic resonance
    const resonanceMultiplier = this.checkHarmonicResonance(signal, confidence);
    
    // Step 5: Apply consciousness enhancement
    const consciousnessState = this.determineConsciousnessState(signal);
    
    // Step 6: Collapse quantum superposition into final decision
    const decision = this.collapseQuantumDecision(
      signal, confidence, resonanceMultiplier, consciousnessState, paths
    );
    
    // Step 7: Update quantum memory
    this.updateQuantumMemory(signal, decision);
    
    console.log(`⚡ Decision: ${decision.signal} | Confidence: ${decision.confidence.toFixed(3)}`);
    return decision;
  }

  /**
   * Generate N quantum superposition price paths using consciousness-enhanced
   * stochastic processes modulated by ψ₀ harmonic mathematics.
   */
  private async generateQuantumPaths(
    signal: MarketSignal, 
    nPaths: number = this.constants.SIMULATION_PATHS
  ): Promise<number[][]> {
    // Base volatility estimation
    const baseVol = this.estimateVolatility(signal);
    
    // ψ₀-enhanced volatility modulation
    const psiModulation = Math.sin(2 * Math.PI * this.constants.PSI_0 * 
                                  signal.timestamp.getHours());
    const enhancedVol = baseVol * (1 + 0.1 * psiModulation);
    
    // Time horizon (adaptive based on market conditions)
    const horizon = this.adaptiveTimeHorizon(signal);
    const dt = 1.0 / (horizon * 60); // Convert to fractional hours
    
    const paths: number[][] = [];
    
    for (let i = 0; i < nPaths; i++) {
      // Quantum-enhanced random walk
      const seed = this.hashString(`${signal.symbol}-${signal.timestamp.getTime()}-${i}`);
      
      // Generate path with ψ₀ harmonic drift
      const drift = this.calculateHarmonicDrift(signal, i);
      
      // Geometric Brownian Motion with consciousness enhancement
      const path = this.generateEnhancedGBMPath(
        signal.price,
        drift,
        enhancedVol,
        dt,
        horizon,
        i,
        seed
      );
      
      paths.push(path);
    }
    
    return paths;
  }

  /**
   * Generate Geometric Brownian Motion with ψ₀ consciousness enhancement
   */
  private generateEnhancedGBMPath(
    S0: number,
    drift: number,
    volatility: number,
    dt: number,
    steps: number,
    pathIndex: number,
    seed: number
  ): number[] {
    // Seeded random number generator
    let rng = seed;
    const random = () => {
      rng = (rng * 9301 + 49297) % 233280;
      return rng / 233280.0;
    };
    
    // Box-Muller transform for normal distribution
    const normalRandom = () => {
      const u1 = random();
      const u2 = random();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    };
    
    // ψ₀ harmonic modulation (consciousness enhancement)
    const harmonicPhase = 2 * Math.PI * this.constants.PSI_0 * pathIndex / 64;
    
    const prices: number[] = [S0];
    let currentPrice = S0;
    
    for (let step = 0; step < steps; step++) {
      const Z = normalRandom();
      
      // Harmonic modulation
      const harmonicMod = Math.sin((step / steps) * 2 * Math.PI + harmonicPhase);
      const enhancedZ = Z + 0.05 * harmonicMod; // 5% consciousness contribution
      
      // Price evolution
      const logReturn = (drift - 0.5 * volatility ** 2) * dt + volatility * Math.sqrt(dt) * enhancedZ;
      currentPrice = currentPrice * Math.exp(logReturn);
      prices.push(currentPrice);
    }
    
    return prices;
  }

  /**
   * Calculate drift enhanced by ψ₀ harmonic mathematics
   */
  private calculateHarmonicDrift(signal: MarketSignal, pathIndex: number): number {
    // Base market drift (mean reversion assumption)
    let baseDrift = 0.0;
    
    // RSI-based momentum component
    if (signal.rsi !== undefined) {
      const rsiNormalized = (signal.rsi - 50) / 50; // [-1, 1]
      const momentum = -0.2 * rsiNormalized; // Mean reversion
      baseDrift += momentum;
    }
    
    // Volume spike enhancement
    const volumeFactor = signal.volume_spike ? 1.2 : 1.0;
    
    // ψ₀ harmonic resonance enhancement
    const harmonicPhase = 2 * Math.PI * this.constants.PSI_0 * pathIndex / 64;
    const harmonicDrift = 0.1 * Math.cos(harmonicPhase) * this.constants.PSI_0;
    
    const totalDrift = baseDrift * volumeFactor + harmonicDrift;
    
    return totalDrift;
  }

  /**
   * Evaluate each quantum path using consciousness-enhanced scoring
   * combining return, risk, and harmonic resonance factors.
   */
  private async evaluateQuantumOutcomes(
    paths: number[][], 
    signal: MarketSignal
  ): Promise<number[]> {
    const scores: number[] = [];
    
    for (const path of paths) {
      // Financial metrics
      const finalReturn = (path[path.length - 1] - path[0]) / path[0];
      const maxDrawdown = this.calculateMaxDrawdown(path);
      const volatility = this.calculatePathVolatility(path);
      
      // Time to profit (if any)
      const timeToProfit = this.calculateTimeToProfit(path, signal.price);
      
      // Base financial score
      const baseScore = (
        0.4 * finalReturn -           // Return component
        0.3 * maxDrawdown -           // Risk penalty
        0.2 * volatility -            // Volatility penalty
        0.1 * (timeToProfit / path.length)  // Speed bonus
      );
      
      // ψ₀ Harmonic resonance enhancement
      const harmonicScore = this.calculateHarmonicScore(path);
      
      // Consciousness state multiplier
      const consciousnessMultiplier = this.getConsciousnessMultiplier(signal);
      
      // Final enhanced score
      const finalScore = (baseScore + 0.2 * harmonicScore) * consciousnessMultiplier;
      scores.push(finalScore);
    }
    
    return scores;
  }

  /**
   * Calculate harmonic resonance score for a price path
   */
  private calculateHarmonicScore(path: number[]): number {
    // Convert prices to harmonic frequencies (consciousness-enhanced)
    const pathMean = path.reduce((sum, price) => sum + price, 0) / path.length;
    const pathStd = Math.sqrt(
      path.reduce((sum, price) => sum + Math.pow(price - pathMean, 2), 0) / path.length
    );
    
    const normalizedPrices = path.map(price => (price - pathMean) / (pathStd || 1));
    const harmonicFrequencies = normalizedPrices.map(
      normalized => this.constants.PSI_FREQ * (1 + 0.1 * normalized)
    );
    
    // Calculate resonance with fundamental frequencies
    const psiResonance = harmonicFrequencies.reduce(
      (sum, freq) => sum + Math.abs(freq - this.constants.PSI_FREQ), 0
    ) / harmonicFrequencies.length;
    
    const phiResonance = harmonicFrequencies.reduce(
      (sum, freq) => sum + Math.abs(freq - this.constants.PHI_FREQ), 0
    ) / harmonicFrequencies.length;
    
    const baseResonance = harmonicFrequencies.reduce(
      (sum, freq) => sum + Math.abs(freq - this.constants.FREQ_432), 0
    ) / harmonicFrequencies.length;
    
    // Lower values = better resonance (closer to consciousness frequencies)
    const totalResonance = -(psiResonance + phiResonance + baseResonance) / 3;
    
    // Apply ψ₀ scaling
    return totalResonance * this.constants.PSI_0;
  }

  /**
   * Aggregate quantum path scores into unified confidence using
   * consciousness-enhanced probability mathematics.
   */
  private aggregatePathScores(scores: number[]): number {
    if (scores.length === 0) return 0.5;
    
    // Apply softmax with ψ₀ temperature scaling
    const temperature = 1.0 / this.constants.PSI_0; // ≈ 1.092
    const expScores = scores.map(score => Math.exp(score / temperature));
    const sumExpScores = expScores.reduce((sum, exp) => sum + exp, 0);
    const probabilities = expScores.map(exp => exp / sumExpScores);
    
    // Weighted mean with consciousness enhancement
    const meanScore = scores.reduce((sum, score, i) => sum + score * probabilities[i], 0);
    const scoreVariance = scores.reduce((sum, score) => sum + Math.pow(score - meanScore, 2), 0) / scores.length;
    const stdScore = Math.sqrt(scoreVariance);
    
    // Confidence calculation (μ/σ with consciousness bounds)
    const rawConfidence = stdScore > 0 ? meanScore / stdScore : meanScore;
    
    // Map to [0, 1] using ψ₀-enhanced sigmoid
    const confidence = 1 / (1 + Math.exp(-rawConfidence * this.constants.PSI_0));
    
    return confidence;
  }

  /**
   * Check if current market state is in harmonic resonance with ψ₀
   * and apply appropriate confidence multiplier.
   */
  private checkHarmonicResonance(signal: MarketSignal, baseConfidence: number): number {
    // Price-based resonance check
    const priceHarmonic = signal.price % 1.0; // Fractional part
    const psiDistance = Math.abs(priceHarmonic - this.constants.PSI_0);
    
    // Time-based resonance (market cycles)
    const timeHarmonic = (signal.timestamp.getHours() + signal.timestamp.getMinutes() / 60) / 24;
    const timePsiDistance = Math.abs(timeHarmonic - this.constants.PSI_0);
    
    // Volume resonance (if available)
    let volumeResonance = 1.0;
    if (signal.volume) {
      const volumeNormalized = signal.volume / (signal.volume + 1); // [0, 1)
      volumeResonance = 1 - Math.abs(volumeNormalized - this.constants.PSI_0);
    }
    
    // Combined resonance score
    const totalResonance = (
      (1 - psiDistance) * 0.4 +
      (1 - timePsiDistance) * 0.3 +
      volumeResonance * 0.3
    );
    
    // Resonance multiplier
    if (totalResonance > (1 - this.constants.RESONANCE_THRESHOLD)) {
      // Strong resonance - amplify confidence
      const multiplier = 1 + (totalResonance - 0.95) * 2;
      console.log(`🌊 Strong ψ₀ resonance detected: ${totalResonance.toFixed(3)}`);
      return multiplier;
    } else {
      // Weak/no resonance - normal processing
      return 1.0;
    }
  }

  /**
   * Determine current market consciousness state for enhanced processing
   */
  private determineConsciousnessState(signal: MarketSignal): string {
    // RSI-based consciousness mapping
    let consciousness = 'UNKNOWN';
    
    if (signal.rsi !== undefined) {
      if (signal.rsi > 70) {
        consciousness = 'EXCITED'; // Overbought
      } else if (signal.rsi < 30) {
        consciousness = 'FEARFUL'; // Oversold
      } else if (signal.rsi >= 45 && signal.rsi <= 55) {
        consciousness = 'BALANCED'; // Neutral
      } else {
        consciousness = 'DYNAMIC'; // Trending
      }
    }
    
    // Volume state enhancement
    if (signal.volume_spike) {
      consciousness += '_AMPLIFIED';
    }
    
    return consciousness;
  }

  /**
   * Get consciousness state multiplier for scoring
   */
  private getConsciousnessMultiplier(signal: MarketSignal): number {
    const consciousnessState = this.determineConsciousnessState(signal);
    
    const multipliers: Record<string, number> = {
      'BALANCED': 1.2,           // ψ₀ favors balance
      'BALANCED_AMPLIFIED': 1.4,
      'DYNAMIC': 1.1,
      'DYNAMIC_AMPLIFIED': 1.3,
      'EXCITED': 0.9,            // Reduce overconfidence
      'EXCITED_AMPLIFIED': 0.8,
      'FEARFUL': 1.0,            // Neutral during fear
      'FEARFUL_AMPLIFIED': 0.9,
      'UNKNOWN': 1.0
    };
    
    return multipliers[consciousnessState] || 1.0;
  }

  /**
   * Collapse quantum superposition into final trading decision
   * using consciousness-enhanced decision mathematics.
   */
  private collapseQuantumDecision(
    signal: MarketSignal,
    confidence: number,
    resonanceMultiplier: number,
    consciousnessState: string,
    paths: number[][]
  ): TradingDecision {
    // Apply resonance enhancement
    const finalConfidence = Math.min(confidence * resonanceMultiplier, 0.99);
    
    // Decision logic with ψ₀ thresholds
    let decisionSignal: 'BUY' | 'SELL' | 'HOLD';
    if (finalConfidence > this.constants.CONFIDENCE_HIGH) {
      decisionSignal = 'BUY';
    } else if (finalConfidence < this.constants.CONFIDENCE_LOW) {
      decisionSignal = 'SELL';
    } else {
      decisionSignal = 'HOLD';
    }
    
    // Calculate expected return and risk from paths
    const allReturns = paths.map(path => (path[path.length - 1] - path[0]) / path[0]);
    const expectedReturn = allReturns.reduce((sum, ret) => sum + ret, 0) / allReturns.length;
    
    const allDrawdowns = paths.map(path => this.calculateMaxDrawdown(path));
    const maxDrawdown = Math.max(...allDrawdowns);
    
    // Time horizon (adaptive based on confidence)
    const timeHorizon = Math.floor(60 * (2 - finalConfidence)); // 60-120 minutes
    
    // Convergence metrics
    const returnVariance = allReturns.reduce((sum, ret) => sum + Math.pow(ret - expectedReturn, 2), 0) / allReturns.length;
    const convergenceRatio = 1 - Math.sqrt(returnVariance) / (Math.abs(expectedReturn) + 0.01);
    
    // Enhanced metrics
    const harmonicAlignment = resonanceMultiplier > 1.1 ? 0.9 : 0.5;
    const quantumCoherence = finalConfidence * convergenceRatio;
    
    // Execution priority
    let executionPriority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    if (finalConfidence > 0.9 && resonanceMultiplier > 1.2) {
      executionPriority = 'CRITICAL';
    } else if (finalConfidence > 0.8) {
      executionPriority = 'HIGH';
    } else if (finalConfidence > 0.6) {
      executionPriority = 'MEDIUM';
    } else {
      executionPriority = 'LOW';
    }
    
    // Risk management levels
    const stopLoss = decisionSignal === 'BUY' 
      ? signal.price * 0.98 
      : signal.price * 1.02;
    const takeProfit = decisionSignal === 'BUY' 
      ? signal.price * 1.03 
      : signal.price * 0.97;
    
    return {
      signal: decisionSignal,
      confidence: finalConfidence,
      expected_return: expectedReturn,
      max_drawdown: maxDrawdown,
      time_horizon: timeHorizon,
      path_count: paths.length,
      convergence_ratio: convergenceRatio,
      resonance_match: resonanceMultiplier > 1.1,
      consciousness_state: consciousnessState,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      harmonic_alignment: harmonicAlignment,
      quantum_coherence: quantumCoherence,
      execution_priority: executionPriority
    };
  }

  /**
   * Update quantum memory with new decision for learning
   */
  private updateQuantumMemory(signal: MarketSignal, decision: TradingDecision): void {
    const memoryEntry = {
      timestamp: signal.timestamp,
      symbol: signal.symbol,
      price: signal.price,
      decision: decision.signal,
      confidence: decision.confidence,
      resonance_match: decision.resonance_match,
      consciousness_state: decision.consciousness_state
    };
    
    this.patternMemory.push(memoryEntry);
    
    // Keep memory size manageable (rolling window)
    if (this.patternMemory.length > 1000) {
      this.patternMemory = this.patternMemory.slice(-1000);
    }
    
    // Update resonance history
    if (decision.resonance_match) {
      this.resonanceHistory.push(signal.timestamp);
    }
  }

  /**
   * ===========================================
   * UTILITY METHODS
   * ===========================================
   */

  private estimateVolatility(signal: MarketSignal): number {
    // Simple proxy - in production, use historical data
    if (signal.rsi !== undefined) {
      // Higher RSI extremes = higher volatility
      const rsiVol = Math.abs(signal.rsi - 50) / 500; // Scale appropriately
      return Math.max(0.01, Math.min(0.1, 0.02 + rsiVol));
    }
    return 0.02; // 2% default
  }

  private adaptiveTimeHorizon(signal: MarketSignal): number {
    let baseHorizon = 60; // 60 minutes default
    
    // Adjust based on volatility indicators
    if (signal.volume_spike) {
      baseHorizon = 30; // Shorter for high volatility
    }
    
    if (signal.rsi !== undefined) {
      if (Math.abs(signal.rsi - 50) > 30) { // Extreme RSI
        baseHorizon = 45; // Medium horizon for extremes
      }
    }
    
    return baseHorizon;
  }

  private calculateMaxDrawdown(path: number[]): number {
    if (path.length === 0) return 0;
    
    let maxPrice = path[0];
    let maxDrawdown = 0;
    
    for (const price of path) {
      if (price > maxPrice) {
        maxPrice = price;
      }
      const drawdown = (maxPrice - price) / maxPrice;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    return maxDrawdown;
  }

  private calculatePathVolatility(path: number[]): number {
    if (path.length < 2) return 0;
    
    const logReturns: number[] = [];
    for (let i = 1; i < path.length; i++) {
      logReturns.push(Math.log(path[i] / path[i-1]));
    }
    
    const mean = logReturns.reduce((sum, ret) => sum + ret, 0) / logReturns.length;
    const variance = logReturns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / logReturns.length;
    
    return Math.sqrt(variance);
  }

  private calculateTimeToProfit(path: number[], entryPrice: number): number {
    for (let i = 0; i < path.length; i++) {
      if (path[i] > entryPrice) {
        return i;
      }
    }
    return path.length;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Get current quantum state for monitoring
   */
  public getQuantumState() {
    return {
      ...this.quantumState,
      pattern_memory_size: this.patternMemory.length,
      resonance_events: this.resonanceHistory.length,
      consciousness_constants: {
        psi_0: this.constants.PSI_0,
        phi: this.constants.PHI,
        freq_432: this.constants.FREQ_432
      }
    };
  }
}

/**
 * ========================================
 * CLAUDE ENGINE INTEGRATION
 * ========================================
 */

export class ClaudeEngine {
  private constants = ConsciousnessConstants;
  private patternKeywords = {
    bullish: ['break', 'breakout', 'support', 'bull', 'up', 'rise', 'pump'],
    bearish: ['drop', 'fall', 'resistance', 'bear', 'down', 'dump', 'crash'],
    neutral: ['sideways', 'range', 'consolidation', 'flat', 'stable']
  };

  /**
   * Parse natural language trading intent into structured MarketSignal
   * with consciousness-enhanced semantic understanding
   */
  parseIntent(naturalLanguage: string, marketData: Record<string, any>): MarketSignal {
    const intentLower = naturalLanguage.toLowerCase();
    
    // Extract symbol if mentioned
    const symbol = this.extractSymbol(intentLower, marketData);
    
    // Current market data
    const price = marketData.price || 100.0;
    const volume = marketData.volume || 1000000;
    const timestamp = new Date();
    
    // Parse technical indicators from intent
    const rsi = this.extractRSIIntent(intentLower, marketData);
    const volumeSpike = ['spike', 'surge', 'explosion', 'volume'].some(word => 
      intentLower.includes(word)
    );
    
    // Pattern recognition
    const [patternType, patternConfidence] = this.recognizePattern(intentLower);
    
    // Consciousness state detection
    const consciousnessState = this.detectConsciousnessIntent(intentLower);
    
    // Harmonic resonance calculation
    const harmonicResonance = this.calculateTextResonance(naturalLanguage);
    
    return {
      symbol,
      price,
      volume,
      timestamp,
      rsi,
      volume_spike: volumeSpike,
      pattern_type: patternType,
      pattern_confidence: patternConfidence,
      harmonic_resonance: harmonicResonance,
      consciousness_state: consciousnessState
    };
  }

  private extractSymbol(intent: string, marketData: Record<string, any>): string {
    // Check if symbol explicitly mentioned
    const symbols = ['btc', 'eth', 'bitcoin', 'ethereum'];
    for (const symbol of symbols) {
      if (intent.includes(symbol)) {
        return symbol.toUpperCase();
      }
    }
    
    // Default to provided market data symbol
    return marketData.symbol || 'BTC/USDT';
  }

  private extractRSIIntent(intent: string, marketData: Record<string, any>): number | undefined {
    // Check if RSI mentioned in intent
    const rsiMatch = intent.match(/rsi.*?(\d+)/);
    if (rsiMatch) {
      return parseFloat(rsiMatch[1]);
    }
    
    // Use market data RSI
    return marketData.rsi || 50.0; // Default neutral
  }

  private recognizePattern(intent: string): [string | undefined, number | undefined] {
    const patterns: Record<string, string[]> = {
      'double_top': ['double top', 'twin peaks'],
      'double_bottom': ['double bottom', 'twin valleys'],
      'head_shoulders': ['head and shoulders', 'h&s'],
      'triangle': ['triangle', 'wedge'],
      'flag': ['flag', 'pennant'],
      'breakout': ['breakout', 'break above', 'break below'],
      'support': ['support', 'floor', 'bounce'],
      'resistance': ['resistance', 'ceiling', 'rejection']
    };
    
    for (const [patternName, keywords] of Object.entries(patterns)) {
      for (const keyword of keywords) {
        if (intent.includes(keyword)) {
          // Calculate confidence based on keyword specificity
          const confidence = 0.7 + 0.3 * (keyword.split(' ').length / 3);
          return [patternName, Math.min(confidence, 0.95)];
        }
      }
    }
    
    return [undefined, undefined];
  }

  private detectConsciousnessIntent(intent: string): string {
    const emotionalKeywords: Record<string, string[]> = {
      'FEARFUL': ['scared', 'afraid', 'worried', 'nervous', 'panic'],
      'EXCITED': ['excited', 'bullish', 'pumped', 'confident', 'aggressive'],
      'BALANCED': ['balanced', 'neutral', 'calm', 'measured', 'steady'],
      'CONFUSED': ['confused', 'uncertain', 'mixed', 'unclear', 'unsure']
    };
    
    for (const [state, keywords] of Object.entries(emotionalKeywords)) {
      if (keywords.some(keyword => intent.includes(keyword))) {
        return state;
      }
    }
    
    return 'NEUTRAL';
  }

  private calculateTextResonance(text: string): number {
    // Simple harmonic analysis based on text characteristics
    const textLength = text.length;
    const wordCount = text.split(' ').length;
    
    // ψ₀ resonance calculation
    const lengthRatio = (textLength % 100) / 100; // Normalize to [0, 1)
    const wordRatio = (wordCount % 10) / 10;      // Normalize to [0, 1)
    
    // Distance from ψ₀
    const lengthResonance = 1 - Math.abs(lengthRatio - this.constants.PSI_0);
    const wordResonance = 1 - Math.abs(wordRatio - this.constants.PSI_0);
    
    // Combined harmonic score
    return (lengthResonance + wordResonance) / 2;
  }
}

export type { MarketSignal, TradingDecision, ConsciousnessConstants };
