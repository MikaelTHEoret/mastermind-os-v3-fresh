import { MarketIndicator, CauseEffectPair } from './HighVelocitySnipeEngine';

export interface IndicatorEffect {
  indicator_type: string;
  cause_value: number;
  effect_magnitude: number;
  time_lag: number; // milliseconds
  success_rate: number;
  sample_size: number;
  confidence_interval: [number, number];
}

export interface CauseEffectInsight {
  primary_cause: string;
  effect_magnitude: number;
  probability: number;
  time_to_effect: number;
  supporting_indicators: string[];
  historical_accuracy: number;
}

export interface CorrelationDiscovery {
  type: string;
  confidence: number;
  indicators: string[];
  effect_magnitude: number;
  timestamp: Date;
}

export class CauseEffectAnalysisEngine {
  private indicatorEffects: Map<string, Map<string, IndicatorEffect[]>> = new Map(); // symbol -> indicator -> effects
  private correlationMatrix: Map<string, Map<string, number>> = new Map(); // indicator1 -> indicator2 -> correlation
  private effectTimings: Map<string, number[]> = new Map(); // indicator -> [timing array]

  // Cross-engine integration callback
  public onCorrelationDiscovered?: (correlation: CorrelationDiscovery) => Promise<void>;

  constructor() {
    this.initializeAnalysisEngine();
  }

  private initializeAnalysisEngine(): void {
    console.log('🔬 Initializing Cause-Effect Analysis Engine...');
    
    // Initialize correlation tracking structures
    this.initializeCorrelationMatrix();
    this.initializeEffectTimings();
    
    console.log('✅ Cause-Effect Analysis Engine ready');
  }

  async processCauseEffectPair(symbol: string, causeEffectPair: CauseEffectPair): Promise<void> {
    // Process each indicator in the cause
    for (const indicator of causeEffectPair.cause_indicators) {
      await this.updateIndicatorEffect(symbol, indicator, causeEffectPair);
    }

    // Update indicator correlations
    await this.updateIndicatorCorrelations(causeEffectPair.cause_indicators);

    // Update timing patterns
    this.updateEffectTimings(causeEffectPair);
  }

  private async updateIndicatorEffect(symbol: string, indicator: MarketIndicator, causeEffect: CauseEffectPair): Promise<void> {
    // Initialize symbol tracking if needed
    if (!this.indicatorEffects.has(symbol)) {
      this.indicatorEffects.set(symbol, new Map());
    }

    const symbolEffects = this.indicatorEffects.get(symbol)!;
    
    // Initialize indicator tracking if needed
    if (!symbolEffects.has(indicator.indicator_type)) {
      symbolEffects.set(indicator.indicator_type, []);
    }

    const effects = symbolEffects.get(indicator.indicator_type)!;

    // Create new effect record
    const newEffect: IndicatorEffect = {
      indicator_type: indicator.indicator_type,
      cause_value: indicator.value,
      effect_magnitude: causeEffect.effect_price_change,
      time_lag: causeEffect.time_lag,
      success_rate: this.calculateSuccessRate(indicator.value, causeEffect.effect_price_change),
      sample_size: 1,
      confidence_interval: [causeEffect.effect_price_change * 0.8, causeEffect.effect_price_change * 1.2]
    };

    // Add to effects array
    effects.push(newEffect);

    // Aggregate similar effects for statistical significance
    await this.aggregateSimilarEffects(symbol, indicator.indicator_type);
  }

  private async aggregateSimilarEffects(symbol: string, indicatorType: string): Promise<void> {
    const effects = this.indicatorEffects.get(symbol)?.get(indicatorType) || [];
    
    if (effects.length < 10) return; // Need at least 10 samples for aggregation

    // Group similar cause values (±10% tolerance)
    const groups: Map<string, IndicatorEffect[]> = new Map();
    
    for (const effect of effects) {
      const groupKey = Math.round(effect.cause_value * 10).toString(); // Group by rounded value
      
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(effect);
    }

    // Create aggregated effects for groups with sufficient samples
    const aggregatedEffects: IndicatorEffect[] = [];
    
    const groupEntries = Array.from(groups.entries());
    for (const [groupKey, groupEffects] of groupEntries) {
      if (groupEffects.length >= 3) { // Need at least 3 samples for statistical significance
        const aggregated = this.createAggregatedEffect(groupEffects);
        aggregatedEffects.push(aggregated);
      }
    }

    // Replace individual effects with aggregated ones if we have enough data
    if (aggregatedEffects.length > 0) {
      this.indicatorEffects.get(symbol)?.set(indicatorType, aggregatedEffects);
    }
  }

  private createAggregatedEffect(effects: IndicatorEffect[]): IndicatorEffect {
    const avgCauseValue = effects.reduce((sum: number, e: IndicatorEffect) => sum + e.cause_value, 0) / effects.length;
    const avgEffect = effects.reduce((sum: number, e: IndicatorEffect) => sum + e.effect_magnitude, 0) / effects.length;
    const avgTimeLag = effects.reduce((sum: number, e: IndicatorEffect) => sum + e.time_lag, 0) / effects.length;
    const avgSuccessRate = effects.reduce((sum: number, e: IndicatorEffect) => sum + e.success_rate, 0) / effects.length;

    // Calculate confidence interval based on variance
    const variance = effects.reduce((sum: number, e: IndicatorEffect) => sum + Math.pow(e.effect_magnitude - avgEffect, 2), 0) / effects.length;
    const stdDev = Math.sqrt(variance);
    
    return {
      indicator_type: effects[0].indicator_type,
      cause_value: avgCauseValue,
      effect_magnitude: avgEffect,
      time_lag: avgTimeLag,
      success_rate: avgSuccessRate,
      sample_size: effects.length,
      confidence_interval: [avgEffect - stdDev, avgEffect + stdDev]
    };
  }

  private calculateSuccessRate(causeValue: number, effectMagnitude: number): number {
    // Success = prediction direction matches actual direction
    const predictedDirection = causeValue > 0 ? 1 : -1;
    const actualDirection = effectMagnitude > 0 ? 1 : -1;
    
    // Additional success factor based on magnitude accuracy
    const magnitudeAccuracy = 1 - Math.abs(Math.abs(causeValue) - Math.abs(effectMagnitude));
    
    const directionMatch = predictedDirection === actualDirection ? 1 : 0;
    return (directionMatch * 0.7 + magnitudeAccuracy * 0.3);
  }

  private async updateIndicatorCorrelations(indicators: MarketIndicator[]): Promise<void> {
    // Calculate correlation between indicators appearing together
    for (let i = 0; i < indicators.length; i++) {
      for (let j = i + 1; j < indicators.length; j++) {
        const indicator1 = indicators[i].indicator_type;
        const indicator2 = indicators[j].indicator_type;
        
        const correlation = this.updatePairwiseCorrelation(indicator1, indicator2, indicators[i].value, indicators[j].value);
        
        // Check if this is a significant new correlation discovery
        if (Math.abs(correlation) > 0.7 && this.onCorrelationDiscovered) {
          await this.triggerCorrelationDiscovery(indicator1, indicator2, correlation, indicators);
        }
      }
    }
  }

  private async triggerCorrelationDiscovery(indicator1: string, indicator2: string, correlation: number, indicators: MarketIndicator[]): Promise<void> {
    if (!this.onCorrelationDiscovered) return;

    const discovery: CorrelationDiscovery = {
      type: `${indicator1}_${indicator2}_correlation`,
      confidence: Math.abs(correlation),
      indicators: [indicator1, indicator2],
      effect_magnitude: Math.abs(correlation),
      timestamp: new Date()
    };

    console.log(`🔍 Correlation Discovery: ${indicator1} ↔ ${indicator2} (${correlation.toFixed(3)})`);
    await this.onCorrelationDiscovered(discovery);
  }

  private updatePairwiseCorrelation(indicator1: string, indicator2: string, value1: number, value2: number): number {
    // Initialize correlation matrix entries
    if (!this.correlationMatrix.has(indicator1)) {
      this.correlationMatrix.set(indicator1, new Map());
    }
    if (!this.correlationMatrix.has(indicator2)) {
      this.correlationMatrix.set(indicator2, new Map());
    }

    // Simple correlation update (would use proper correlation calculation in production)
    const correlation = this.calculateSimpleCorrelation(value1, value2);
    
    // Update both directions
    this.correlationMatrix.get(indicator1)!.set(indicator2, correlation);
    this.correlationMatrix.get(indicator2)!.set(indicator1, correlation);

    return correlation;
  }

  private calculateSimpleCorrelation(value1: number, value2: number): number {
    // Simplified correlation - sign match gives positive correlation
    const signMatch = Math.sign(value1) === Math.sign(value2) ? 1 : -1;
    const magnitudeSimilarity = 1 - Math.abs(Math.abs(value1) - Math.abs(value2));
    
    return signMatch * magnitudeSimilarity;
  }

  private updateEffectTimings(causeEffect: CauseEffectPair): void {
    for (const indicator of causeEffect.cause_indicators) {
      if (!this.effectTimings.has(indicator.indicator_type)) {
        this.effectTimings.set(indicator.indicator_type, []);
      }
      
      this.effectTimings.get(indicator.indicator_type)!.push(causeEffect.time_lag);
      
      // Keep only recent timings (last 100)
      const timings = this.effectTimings.get(indicator.indicator_type)!;
      if (timings.length > 100) {
        this.effectTimings.set(indicator.indicator_type, timings.slice(-100));
      }
    }
  }

  // Analysis methods for generating insights
  async generateCauseEffectInsights(symbol: string, currentIndicators: MarketIndicator[]): Promise<CauseEffectInsight[]> {
    const insights: CauseEffectInsight[] = [];
    
    for (const indicator of currentIndicators) {
      const insight = await this.generateIndicatorInsight(symbol, indicator);
      if (insight) {
        insights.push(insight);
      }
    }

    // Sort by probability
    return insights.sort((a, b) => b.probability - a.probability);
  }

  private async generateIndicatorInsight(symbol: string, indicator: MarketIndicator): Promise<CauseEffectInsight | null> {
    const effects = this.indicatorEffects.get(symbol)?.get(indicator.indicator_type) || [];
    
    if (effects.length === 0) return null;

    // Find most similar historical effect
    const similarEffect = this.findMostSimilarEffect(effects, indicator.value);
    if (!similarEffect) return null;

    // Get supporting indicators (correlated indicators)
    const supportingIndicators = this.getSupportingIndicators(indicator.indicator_type);

    // Calculate expected timing
    const timings = this.effectTimings.get(indicator.indicator_type) || [60000];
    const avgTiming = timings.reduce((sum: number, t: number) => sum + t, 0) / timings.length;

    return {
      primary_cause: indicator.indicator_type,
      effect_magnitude: similarEffect.effect_magnitude,
      probability: similarEffect.success_rate,
      time_to_effect: avgTiming,
      supporting_indicators: supportingIndicators,
      historical_accuracy: this.calculateHistoricalAccuracy(indicator.indicator_type, symbol)
    };
  }

  private findMostSimilarEffect(effects: IndicatorEffect[], targetValue: number): IndicatorEffect | null {
    if (effects.length === 0) return null;

    return effects.reduce((best, current) => {
      const currentSimilarity = 1 - Math.abs(current.cause_value - targetValue);
      const bestSimilarity = 1 - Math.abs(best.cause_value - targetValue);
      
      return currentSimilarity > bestSimilarity ? current : best;
    });
  }

  private getSupportingIndicators(primaryIndicator: string): string[] {
    const correlations = this.correlationMatrix.get(primaryIndicator) || new Map();
    
    return Array.from(correlations.entries())
      .filter(([, correlation]) => correlation > 0.5) // Strong positive correlation
      .sort(([, a], [, b]) => b - a) // Sort by correlation strength
      .slice(0, 3) // Top 3 supporting indicators
      .map(([indicator]) => indicator);
  }

  private calculateHistoricalAccuracy(indicatorType: string, symbol: string): number {
    const effects = this.indicatorEffects.get(symbol)?.get(indicatorType) || [];
    
    if (effects.length === 0) return 0.5; // Default neutral
    
    return effects.reduce((sum: number, effect: IndicatorEffect) => sum + effect.success_rate, 0) / effects.length;
  }

  // Enhanced learning integration methods
  async recordCauseEffectOutcome(outcome: any): Promise<void> {
    console.log('📊 Recording cause-effect outcome for learning enhancement');
    
    // Process the outcome for cause-effect learning
    if (outcome.opportunity && outcome.opportunity.trigger_indicators) {
      const mockIndicators: MarketIndicator[] = outcome.opportunity.trigger_indicators.map((ind: string) => ({
        indicator_type: ind,
        value: outcome.success ? 1 : -1,
        timestamp: new Date(),
        strength: outcome.actual_return ? Math.abs(outcome.actual_return) : 0
      }));

      const causeEffectPair: CauseEffectPair = {
        cause_indicators: mockIndicators,
        effect_price_change: outcome.actual_return || 0,
        effect_timestamp: new Date(),
        time_lag: outcome.actual_duration || 0,
        correlation_strength: outcome.success ? 0.8 : 0.2,
        success_rate: outcome.success ? 1 : 0
      };

      await this.processCauseEffectPair(outcome.opportunity.symbol, causeEffectPair);
    }
  }

  async getCorrelationInsights(): Promise<any> {
    const insights = {
      discovered_correlations: [] as CorrelationDiscovery[],
      strong_correlations: new Map<string, number>()
    };

    // Analyze correlation matrix for strong correlations
    for (const [indicator1, correlations] of this.correlationMatrix.entries()) {
      for (const [indicator2, correlation] of correlations.entries()) {
        if (Math.abs(correlation) > 0.7) {
          insights.strong_correlations.set(`${indicator1}_${indicator2}`, correlation);
        }
      }
    }

    return insights;
  }

  // Public API methods
  async getIndicatorEffectiveness(symbol: string): Promise<Map<string, number>> {
    const symbolEffects = this.indicatorEffects.get(symbol) || new Map();
    const effectiveness = new Map<string, number>();
    
    const symbolEffectEntries = Array.from(symbolEffects.entries());
    for (const [indicator, effects] of symbolEffectEntries) {
      const avgSuccessRate = effects.reduce((sum: number, e: IndicatorEffect) => sum + e.success_rate, 0) / effects.length;
      effectiveness.set(indicator, avgSuccessRate);
    }
    
    return effectiveness;
  }

  async getCorrelationMatrix(): Promise<Map<string, Map<string, number>>> {
    return this.correlationMatrix;
  }

  async getEffectTimingStats(indicatorType: string): Promise<any> {
    const timings = this.effectTimings.get(indicatorType) || [];
    
    if (timings.length === 0) {
      return { avg: 60000, min: 60000, max: 60000, count: 0 };
    }
    
    const avg = timings.reduce((sum: number, t: number) => sum + t, 0) / timings.length;
    const min = Math.min(...timings);
    const max = Math.max(...timings);
    
    return { avg, min, max, count: timings.length };
  }

  async exportCauseEffectData(symbol: string): Promise<any> {
    return {
      indicator_effects: Object.fromEntries(this.indicatorEffects.get(symbol) || new Map()),
      correlation_matrix: Object.fromEntries(this.correlationMatrix),
      effect_timings: Object.fromEntries(this.effectTimings)
    };
  }

  private initializeCorrelationMatrix(): void {
    // Initialize with known indicator types
    const indicatorTypes = [
      'price_change_1m', 'price_change_5m', 'volume_spike', 'volume_ratio',
      'rsi_1m', 'rsi_5m', 'macd_1m', 'momentum_score', 'large_orders',
      'order_flow_imbalance', 'bid_ask_spread', 'depth_imbalance'
    ];
    
    for (const indicator of indicatorTypes) {
      this.correlationMatrix.set(indicator, new Map());
    }
  }

  private initializeEffectTimings(): void {
    // Initialize timing tracking for all indicators
    const indicatorTypes = [
      'price_change_1m', 'price_change_5m', 'volume_spike', 'volume_ratio',
      'rsi_1m', 'rsi_5m', 'macd_1m', 'momentum_score', 'large_orders',
      'order_flow_imbalance', 'bid_ask_spread', 'depth_imbalance'
    ];
    
    for (const indicator of indicatorTypes) {
      this.effectTimings.set(indicator, []);
    }
  }
}