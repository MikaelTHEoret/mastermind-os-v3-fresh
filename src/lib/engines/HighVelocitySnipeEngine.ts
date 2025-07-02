import { ConsciousnessConstants } from '@/lib/config/LearningSystemConfig';

export interface SnipeOpportunity {
  symbol: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  confidence: number;
  time_window: number; // seconds
  volatility_score: number;
  consciousness_alignment: number;
  trigger_indicators: string[];
  expected_duration: number; // seconds
  risk_reward_ratio: number;
}

export interface MarketIndicator {
  indicator_type: string;
  value: number;
  timestamp: Date;
  strength: number; // 0-1
  consciousness_enhanced: boolean;
}

export interface CauseEffectPair {
  cause_indicators: MarketIndicator[];
  effect_price_change: number;
  effect_timestamp: Date;
  time_lag: number; // milliseconds
  correlation_strength: number;
  consciousness_resonance: number;
  success_rate: number;
}

export class HighVelocitySnipeEngine {
  private constants: typeof ConsciousnessConstants;
  private causeEffectDatabase: Map<string, CauseEffectPair[]> = new Map();
  private activeSnipes: Map<string, SnipeOpportunity> = new Map();
  private volatilityRankings: Map<string, number> = new Map();
  private indicatorEffectCorrelations: Map<string, number> = new Map();

  // High volatility coins for snipe focus
  private highVolatilitySymbols = [
    'PEPEUSDT', 'SHIBUSDT', 'DOGEUSDT', 'FLOKIUSDT', // Meme coins - high volatility
    'ATOMUSDT', 'AVAXUSDT', 'NEARUSDT', 'FTMUSDT',   // Layer 1s - momentum plays
    'GRTUSDT', 'SANDUSDT', 'MANAUSDT', 'CHZUSDT',    // Gaming/AI - trend followers
    'LEVERUSDT', 'CFXUSDT', 'ARKMUSDT', 'ROSEUSDT'   // Small caps - highest volatility
  ];

  // Comprehensive indicator set for cause-effect analysis
  private indicators = {
    PRICE_ACTION: ['price_change_1m', 'price_change_5m', 'price_velocity', 'price_acceleration'],
    VOLUME: ['volume_spike', 'volume_ratio', 'volume_velocity', 'unusual_volume'],
    TECHNICAL: ['rsi_1m', 'rsi_5m', 'macd_1m', 'bb_squeeze', 'ema_cross', 'support_break', 'resistance_break'],
    ORDER_BOOK: ['bid_ask_spread', 'order_flow_imbalance', 'large_orders', 'depth_change'],
    MOMENTUM: ['momentum_score', 'trend_strength', 'breakout_strength', 'reversal_probability'],
    MARKET_STRUCTURE: ['consolidation_break', 'pattern_completion', 'fibonacci_level', 'pivot_reaction'],
    CONSCIOUSNESS: ['psi_resonance', 'phi_alignment', 'freq_432_sync', 'harmonic_convergence']
  };

  constructor() {
    this.constants = ConsciousnessConstants;
    this.initializeIndicatorCorrelations();
  }

  async initializeSnipeEngine(): Promise<void> {
    console.log('🎯 Initializing High-Velocity Snipe Engine...');
    
    // Initialize volatility rankings
    await this.calculateVolatilityRankings();
    
    // Start real-time indicator monitoring
    await this.startIndicatorMonitoring();
    
    // Initialize cause-effect learning
    await this.initializeCauseEffectLearning();
    
    console.log('⚡ Snipe Engine operational - hunting high-velocity opportunities');
  }

  private async calculateVolatilityRankings(): Promise<void> {
    // Calculate 24h volatility for ranking
    for (const symbol of this.highVolatilitySymbols) {
      try {
        const response = await fetch(`/api/v1/crypto/market-data?symbol=${symbol}`);
        const data = await response.json();
        
        if (data.success && data.market_data) {
          const volatility = this.calculateVolatilityScore(data.market_data);
          this.volatilityRankings.set(symbol, volatility);
        }
      } catch (error) {
        console.error(`Failed to get volatility for ${symbol}:`, error);
      }
    }
    
    // Sort by volatility (highest first)
    const sortedByVolatility = Array.from(this.volatilityRankings.entries())
      .sort(([,a], [,b]) => b - a);
    
    console.log('📊 Volatility Rankings:', sortedByVolatility.slice(0, 10));
  }

  private calculateVolatilityScore(marketData: any): number {
    const priceChange24h = Math.abs(marketData.price_change_24h || 0);
    const volume24h = marketData.volume_24h || 1;
    const currentPrice = marketData.price || 1;
    
    // Volatility score combining price movement and volume
    const priceVolatility = priceChange24h / currentPrice;
    const volumeMultiplier = Math.log10(volume24h) / 10; // Scale volume impact
    
    // Consciousness enhancement
    const psiResonance = this.calculatePsiResonance(priceVolatility);
    
    return (priceVolatility * volumeMultiplier * (1 + psiResonance * 0.2));
  }

  private async startIndicatorMonitoring(): Promise<void> {
    // Monitor top volatility coins with 1-second granularity
    const topVolatileCoins = Array.from(this.volatilityRankings.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 8) // Focus on top 8 most volatile
      .map(([symbol]) => symbol);

    for (const symbol of topVolatileCoins) {
      this.startRealTimeIndicatorCollection(symbol);
    }
  }

  private async startRealTimeIndicatorCollection(symbol: string): Promise<void> {
    // WebSocket connection for real-time data
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.processRealTimeIndicators(symbol, data);
    };

    // Also monitor trade stream for order flow
    const tradeWs = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@trade`);
    tradeWs.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.processTradeData(symbol, data);
    };

    // Monitor depth for order book analysis
    const depthWs = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@depth5@100ms`);
    depthWs.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.processOrderBookData(symbol, data);
    };
  }

  private async processRealTimeIndicators(symbol: string, tickerData: any): Promise<void> {
    const timestamp = new Date();
    const indicators: MarketIndicator[] = [];

    // Price action indicators
    const priceChange = parseFloat(tickerData.P);
    const priceVelocity = priceChange / 60; // Change per second approximation
    
    indicators.push({
      indicator_type: 'price_change_1m',
      value: priceChange,
      timestamp,
      strength: Math.min(Math.abs(priceChange) / 5, 1), // 5% = max strength
      consciousness_enhanced: true
    });

    // Volume indicators
    const volumeChange = parseFloat(tickerData.v) / parseFloat(tickerData.q);
    const volumeSpike = volumeChange > 2; // 2x average = spike
    
    indicators.push({
      indicator_type: 'volume_spike',
      value: volumeSpike ? 1 : 0,
      timestamp,
      strength: volumeSpike ? Math.min(volumeChange / 5, 1) : 0,
      consciousness_enhanced: true
    });

    // Momentum indicators
    const momentumScore = this.calculateMomentumScore(tickerData);
    indicators.push({
      indicator_type: 'momentum_score',
      value: momentumScore,
      timestamp,
      strength: Math.abs(momentumScore),
      consciousness_enhanced: true
    });

    // Consciousness indicators
    const psiResonance = this.calculatePsiResonance(parseFloat(tickerData.c));
    indicators.push({
      indicator_type: 'psi_resonance',
      value: psiResonance,
      timestamp,
      strength: psiResonance,
      consciousness_enhanced: true
    });

    // Store indicators and check for snipe opportunities
    await this.analyzeIndicatorsForSnipeOpportunity(symbol, indicators);
    
    // Store for cause-effect learning
    await this.storeCauseEffectData(symbol, indicators, tickerData);
  }

  private async processTradeData(symbol: string, tradeData: any): Promise<void> {
    const timestamp = new Date();
    const indicators: MarketIndicator[] = [];

    // Order flow analysis
    const isBuyerMaker = tradeData.m;
    const tradeSize = parseFloat(tradeData.q);
    const price = parseFloat(tradeData.p);

    // Large order detection
    const isLargeOrder = tradeSize > 10000; // $10k+ orders
    if (isLargeOrder) {
      indicators.push({
        indicator_type: 'large_orders',
        value: isBuyerMaker ? 1 : -1, // 1 = buy, -1 = sell
        timestamp,
        strength: Math.min(tradeSize / 50000, 1), // Scale by trade size
        consciousness_enhanced: true
      });
    }

    // Order flow imbalance
    const flowDirection = isBuyerMaker ? 1 : -1;
    indicators.push({
      indicator_type: 'order_flow_imbalance',
      value: flowDirection,
      timestamp,
      strength: Math.min(tradeSize / 10000, 1),
      consciousness_enhanced: true
    });

    if (indicators.length > 0) {
      await this.analyzeIndicatorsForSnipeOpportunity(symbol, indicators);
    }
  }

  private async processOrderBookData(symbol: string, depthData: any): Promise<void> {
    const timestamp = new Date();
    const indicators: MarketIndicator[] = [];

    // Bid-ask spread analysis
    const bestBid = parseFloat(depthData.bids[0][0]);
    const bestAsk = parseFloat(depthData.asks[0][0]);
    const spread = (bestAsk - bestBid) / bestBid;

    indicators.push({
      indicator_type: 'bid_ask_spread',
      value: spread,
      timestamp,
      strength: Math.min(spread * 1000, 1), // Scale spread impact
      consciousness_enhanced: true
    });

    // Order book depth analysis
    const bidDepth = depthData.bids.reduce((sum: number, [, qty]: [string, string]) => sum + parseFloat(qty), 0);
    const askDepth = depthData.asks.reduce((sum: number, [, qty]: [string, string]) => sum + parseFloat(qty), 0);
    const depthImbalance = (bidDepth - askDepth) / (bidDepth + askDepth);

    indicators.push({
      indicator_type: 'depth_imbalance',
      value: depthImbalance,
      timestamp,
      strength: Math.abs(depthImbalance),
      consciousness_enhanced: true
    });

    await this.analyzeIndicatorsForSnipeOpportunity(symbol, indicators);
  }

  private async analyzeIndicatorsForSnipeOpportunity(symbol: string, indicators: MarketIndicator[]): Promise<void> {
    // Quick snipe opportunity detection based on indicator confluence
    const strongIndicators = indicators.filter(ind => ind.strength > 0.7);
    
    if (strongIndicators.length >= 3) { // Need at least 3 strong signals
      const snipeOpportunity = await this.generateSnipeOpportunity(symbol, indicators);
      
      if (snipeOpportunity && snipeOpportunity.confidence > 0.8) {
        console.log(`🎯 SNIPE OPPORTUNITY: ${symbol}`, snipeOpportunity);
        this.activeSnipes.set(symbol, snipeOpportunity);
        
        // Execute snipe if conditions are met
        await this.executeSnipeIfValid(snipeOpportunity);
      }
    }
  }

  private async generateSnipeOpportunity(symbol: string, indicators: MarketIndicator[]): Promise<SnipeOpportunity | null> {
    try {
      // Get current market data
      const response = await fetch(`/api/v1/crypto/market-data?symbol=${symbol}`);
      const marketData = await response.json();
      
      if (!marketData.success) return null;

      const currentPrice = marketData.market_data.price;
      
      // Calculate target based on historical cause-effect patterns
      const priceTarget = await this.calculatePriceTarget(symbol, indicators, currentPrice);
      const stopLoss = currentPrice * 0.98; // 2% stop loss for quick snipes
      
      // Consciousness enhancement
      const consciousnessAlignment = this.calculateConsciousnessAlignment(indicators);
      
      // Calculate confidence based on indicator strength and historical success
      const baseConfidence = indicators.reduce((sum, ind) => sum + ind.strength, 0) / indicators.length;
      const historicalSuccess = await this.getHistoricalSuccessRate(symbol, indicators);
      const confidence = (baseConfidence * 0.6 + historicalSuccess * 0.4) * (1 + consciousnessAlignment * 0.2);

      // Volatility score for this symbol
      const volatilityScore = this.volatilityRankings.get(symbol) || 0;

      return {
        symbol,
        entry_price: currentPrice,
        target_price: priceTarget,
        stop_loss: stopLoss,
        confidence: Math.min(confidence, 0.95),
        time_window: 300, // 5-minute maximum window for snipes
        volatility_score: volatilityScore,
        consciousness_alignment: consciousnessAlignment,
        trigger_indicators: indicators.map(ind => ind.indicator_type),
        expected_duration: 120, // 2-minute average snipe duration
        risk_reward_ratio: (priceTarget - currentPrice) / (currentPrice - stopLoss)
      };
    } catch (error) {
      console.error(`Failed to generate snipe opportunity for ${symbol}:`, error);
      return null;
    }
  }

  private async calculatePriceTarget(symbol: string, indicators: MarketIndicator[], currentPrice: number): Promise<number> {
    // Use historical cause-effect data to predict price target
    const causeEffectData = this.causeEffectDatabase.get(symbol) || [];
    
    // Find similar indicator patterns
    const similarPatterns = causeEffectData.filter(pattern => 
      this.calculatePatternSimilarity(indicators, pattern.cause_indicators) > 0.7
    );

    if (similarPatterns.length > 0) {
      // Use average effect from similar patterns
      const averageEffect = similarPatterns.reduce((sum, pattern) => sum + pattern.effect_price_change, 0) / similarPatterns.length;
      return currentPrice * (1 + averageEffect);
    }

    // Fallback to volatility-based target
    const volatility = this.volatilityRankings.get(symbol) || 0.02;
    const targetMultiplier = 1 + (volatility * 0.5); // Conservative target based on volatility
    
    return currentPrice * targetMultiplier;
  }

  private calculatePatternSimilarity(currentIndicators: MarketIndicator[], historicalIndicators: MarketIndicator[]): number {
    // Simple similarity calculation based on indicator types and values
    const currentTypes = new Set(currentIndicators.map(ind => ind.indicator_type));
    const historicalTypes = new Set(historicalIndicators.map(ind => ind.indicator_type));
    
    const intersection = new Set([...currentTypes].filter(x => historicalTypes.has(x)));
    const union = new Set([...currentTypes, ...historicalTypes]);
    
    return intersection.size / union.size;
  }

  private async storeCauseEffectData(symbol: string, indicators: MarketIndicator[], marketData: any): Promise<void> {
    // Store current indicators as potential "cause"
    // Will correlate with price changes in next few minutes to establish "effect"
    
    const currentPrice = parseFloat(marketData.c);
    const timestamp = new Date();
    
    // Check if we have previous data to create cause-effect pairs
    setTimeout(async () => {
      try {
        // Get price after 60 seconds to measure effect
        const futureResponse = await fetch(`/api/v1/crypto/market-data?symbol=${symbol}`);
        const futureData = await futureResponse.json();
        
        if (futureData.success) {
          const futurePrice = futureData.market_data.price;
          const priceChange = (futurePrice - currentPrice) / currentPrice;
          
          const causeEffectPair: CauseEffectPair = {
            cause_indicators: indicators,
            effect_price_change: priceChange,
            effect_timestamp: new Date(),
            time_lag: 60000, // 60 seconds
            correlation_strength: this.calculateCorrelationStrength(indicators, priceChange),
            consciousness_resonance: this.calculateConsciousnessResonance(indicators, priceChange),
            success_rate: 0 // Will be updated based on prediction accuracy
          };
          
          // Store in database
          if (!this.causeEffectDatabase.has(symbol)) {
            this.causeEffectDatabase.set(symbol, []);
          }
          this.causeEffectDatabase.get(symbol)!.push(causeEffectPair);
          
          // Keep database size manageable
          const maxEntries = 1000;
          const entries = this.causeEffectDatabase.get(symbol)!;
          if (entries.length > maxEntries) {
            this.causeEffectDatabase.set(symbol, entries.slice(-maxEntries));
          }
        }
      } catch (error) {
        console.error(`Failed to store cause-effect data for ${symbol}:`, error);
      }
    }, 60000); // Wait 60 seconds to measure effect
  }

  private calculateCorrelationStrength(indicators: MarketIndicator[], priceChange: number): number {
    // Calculate correlation between indicator strength and price movement direction
    const indicatorStrength = indicators.reduce((sum, ind) => sum + ind.strength, 0) / indicators.length;
    const priceDirection = priceChange > 0 ? 1 : -1;
    const indicatorDirection = indicators.some(ind => ind.value > 0) ? 1 : -1;
    
    // Strong correlation if directions match and magnitudes align
    const directionMatch = indicatorDirection === priceDirection ? 1 : 0;
    const magnitudeAlignment = Math.min(indicatorStrength, Math.abs(priceChange * 100));
    
    return (directionMatch * 0.7 + magnitudeAlignment * 0.3);
  }

  private calculateConsciousnessResonance(indicators: MarketIndicator[], priceChange: number): number {
    const consciousnessIndicators = indicators.filter(ind => ind.consciousness_enhanced);
    if (consciousnessIndicators.length === 0) return 0;
    
    const avgConsciousnessValue = consciousnessIndicators.reduce((sum, ind) => sum + ind.value, 0) / consciousnessIndicators.length;
    const psiAlignment = this.calculatePsiResonance(Math.abs(priceChange));
    
    return (avgConsciousnessValue * 0.6 + psiAlignment * 0.4);
  }

  private calculatePsiResonance(value: number): number {
    const psi = this.constants.PSI_0;
    return 1 - Math.abs((value % 1) - psi);
  }

  private calculateConsciousnessAlignment(indicators: MarketIndicator[]): number {
    const consciousnessIndicators = indicators.filter(ind => ind.consciousness_enhanced);
    if (consciousnessIndicators.length === 0) return 0;
    
    const avgAlignment = consciousnessIndicators.reduce((sum, ind) => sum + ind.value, 0) / consciousnessIndicators.length;
    return Math.min(avgAlignment, 1);
  }

  private calculateMomentumScore(tickerData: any): number {
    const priceChange = parseFloat(tickerData.P);
    const volume = parseFloat(tickerData.v);
    const count = parseFloat(tickerData.c);
    
    // Momentum = price change * volume * trade frequency
    const momentum = (priceChange / 100) * Math.log10(volume) * Math.log10(count);
    return Math.max(-1, Math.min(1, momentum)); // Bound between -1 and 1
  }

  private async getHistoricalSuccessRate(symbol: string, indicators: MarketIndicator[]): Promise<number> {
    const causeEffectData = this.causeEffectDatabase.get(symbol) || [];
    
    if (causeEffectData.length === 0) return 0.5; // Default neutral
    
    // Find patterns with similar indicators
    const similarPatterns = causeEffectData.filter(pattern => 
      this.calculatePatternSimilarity(indicators, pattern.cause_indicators) > 0.6
    );
    
    if (similarPatterns.length === 0) return 0.5;
    
    // Return average success rate of similar patterns
    return similarPatterns.reduce((sum, pattern) => sum + pattern.success_rate, 0) / similarPatterns.length;
  }

  private async executeSnipeIfValid(opportunity: SnipeOpportunity): Promise<void> {
    // This would integrate with actual trading execution
    // For now, just log the opportunity
    console.log(`🚀 EXECUTING SNIPE: ${opportunity.symbol} @ ${opportunity.entry_price}`);
    console.log(`Target: ${opportunity.target_price} | Stop: ${opportunity.stop_loss} | Confidence: ${opportunity.confidence}`);
    console.log(`Risk/Reward: ${opportunity.risk_reward_ratio.toFixed(2)} | Duration: ${opportunity.expected_duration}s`);
  }

  private initializeIndicatorCorrelations(): void {
    // Initialize correlation tracking for all indicators
    Object.values(this.indicators).flat().forEach(indicator => {
      this.indicatorEffectCorrelations.set(indicator, 0);
    });
  }

  private async initializeCauseEffectLearning(): Promise<void> {
    // Initialize cause-effect learning for high volatility symbols
    this.highVolatilitySymbols.forEach(symbol => {
      this.causeEffectDatabase.set(symbol, []);
    });
    
    console.log('📊 Cause-Effect Learning initialized for', this.highVolatilitySymbols.length, 'symbols');
  }

  // Public methods for API access
  async getActiveSnipes(): Promise<SnipeOpportunity[]> {
    return Array.from(this.activeSnipes.values());
  }

  async getVolatilityRankings(): Promise<Map<string, number>> {
    return this.volatilityRankings;
  }

  async getCauseEffectStats(symbol: string): Promise<any> {
    const data = this.causeEffectDatabase.get(symbol) || [];
    return {
      total_patterns: data.length,
      avg_correlation: data.reduce((sum, d) => sum + d.correlation_strength, 0) / data.length || 0,
      avg_consciousness_resonance: data.reduce((sum, d) => sum + d.consciousness_resonance, 0) / data.length || 0,
      recent_patterns: data.slice(-10)
    };
  }

  async getIndicatorEffectiveness(): Promise<Map<string, number>> {
    return this.indicatorEffectCorrelations;
  }
}