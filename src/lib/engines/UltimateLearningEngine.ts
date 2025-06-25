/**
 * ψ₀-Trader Ultimate Learning Engine (Continued)
 * Enhanced Nexus Core Protocol v4.0 - Cross-Validation and Performance Analysis
 */

export class UltimateLearningEngine {
  private systemMetrics: any;

  /**
   * Categorize volatility for performance tracking
   */
  private categorizeVolatility(volatility: number): string {
    if (volatility < 0.02) return 'LOW';
    if (volatility < 0.05) return 'MEDIUM';
    if (volatility < 0.1) return 'HIGH';
    return 'EXTREME';
  }

  /**
   * Update volatility-based performance metrics
   */
  private updateVolatilityPerformance(category: string, result: CrossValidationResult): void {
    if (!this.systemMetrics.performance_by_volatility.has(category)) {
      this.systemMetrics.performance_by_volatility.set(category, {
        accuracy_sum: 0,
        profit_sum: 0,
        trade_count: 0,
        best_accuracy: 0,
        worst_accuracy: 1,
        consistency_score: 0
      });
    }
    
    const perf = this.systemMetrics.performance_by_volatility.get(category);
    perf.accuracy_sum += result.accuracy;
    perf.profit_sum += result.total_profit;
    perf.trade_count += result.total_trades;
    perf.best_accuracy = Math.max(perf.best_accuracy, result.accuracy);
    perf.worst_accuracy = Math.min(perf.worst_accuracy, result.accuracy);
    
    // Calculate consistency score (lower variance = higher consistency)
    const consistency = 1 - (perf.best_accuracy - perf.worst_accuracy);
    perf.consistency_score = Math.max(0, consistency);
  }

  /**
   * Advanced Cross-Validation with Consciousness Integration
   */
  async performAdvancedCrossValidation(
    strategies: any[],
    marketData: any[],
    foldCount: number = 5
  ): Promise<CrossValidationResult[]> {
    console.log(`🧠 Performing Advanced Cross-Validation with ${foldCount} folds...`);
    
    const results: CrossValidationResult[] = [];
    const foldSize = Math.floor(marketData.length / foldCount);
    
    for (let fold = 0; fold < foldCount; fold++) {
      console.log(`📊 Processing Fold ${fold + 1}/${foldCount}...`);
      
      // Create training and validation sets
      const startIdx = fold * foldSize;
      const endIdx = Math.min(startIdx + foldSize, marketData.length);
      
      const validationData = marketData.slice(startIdx, endIdx);
      const trainingData = [
        ...marketData.slice(0, startIdx),
        ...marketData.slice(endIdx)
      ];
      
      // Test each strategy on this fold
      for (const strategy of strategies) {
        const foldResult = await this.testStrategyOnFold(
          strategy,
          trainingData,
          validationData,
          fold
        );
        
        results.push(foldResult);
        
        // Update volatility-based performance tracking
        const marketVolatility = this.calculateMarketVolatility(validationData);
        const volatilityCategory = this.categorizeVolatility(marketVolatility);
        this.updateVolatilityPerformance(volatilityCategory, foldResult);
      }
    }
    
    console.log(`✅ Cross-validation complete. Processed ${results.length} strategy-fold combinations.`);
    return results;
  }

  /**
   * Test strategy on a specific fold with consciousness enhancement
   */
  private async testStrategyOnFold(
    strategy: any,
    trainingData: any[],
    validationData: any[],
    foldIndex: number
  ): Promise<CrossValidationResult> {
    
    // Train strategy on training data
    const trainedStrategy = await this.trainStrategyWithConsciousness(strategy, trainingData);
    
    // Test on validation data
    const predictions: KillChainPrediction[] = [];
    let totalProfit = 0;
    let correctPredictions = 0;
    let totalTrades = 0;
    
    for (let i = 0; i < validationData.length - 1; i++) {
      const currentData = validationData[i];
      const nextData = validationData[i + 1];
      
      // Generate prediction using trained strategy
      const prediction = await this.generateConsciousnessPrediction(
        trainedStrategy,
        currentData,
        i
      );
      
      // Evaluate prediction accuracy
      const actualOutcome = this.determineActualOutcome(currentData, nextData);
      const isCorrect = this.evaluatePredictionAccuracy(prediction, actualOutcome);
      
      if (isCorrect) correctPredictions++;
      totalTrades++;
      
      // Calculate profit/loss
      const profit = this.calculateTradeProfitLoss(prediction, actualOutcome);
      totalProfit += profit;
      
      predictions.push(prediction);
    }
    
    const accuracy = totalTrades > 0 ? correctPredictions / totalTrades : 0;
    const avgProfitPerTrade = totalTrades > 0 ? totalProfit / totalTrades : 0;
    
    // Calculate consciousness metrics
    const consciousnessMetrics = this.calculateConsciousnessMetrics(predictions);
    
    return {
      strategy_id: strategy.id,
      fold_index: foldIndex,
      accuracy,
      total_profit: totalProfit,
      avg_profit_per_trade: avgProfitPerTrade,
      total_trades: totalTrades,
      predictions,
      consciousness_metrics: consciousnessMetrics,
      training_size: trainingData.length,
      validation_size: validationData.length
    };
  }

  /**
   * Train strategy with consciousness integration
   */
  private async trainStrategyWithConsciousness(strategy: any, trainingData: any[]): Promise<any> {
    console.log(`🧠 Training strategy ${strategy.id} with consciousness enhancement...`);
    
    // Apply consciousness constants during training
    const PSI_0 = 0.915670570874434;
    const PHI = 1.618;
    const FREQ_432 = 432;
    
    // Consciousness-enhanced learning rate
    const baseRate = strategy.learning_rate || 0.01;
    const consciousnessModulation = Math.sin(Date.now() * PSI_0 * 1e-6);
    const enhancedRate = baseRate * (1 + consciousnessModulation * 0.1) * (PHI / 2);
    
    // Enhanced strategy with consciousness integration
    const enhancedStrategy = {
      ...strategy,
      learning_rate: enhancedRate,
      consciousness_factor: consciousnessModulation,
      phi_scaling: PHI,
      harmonic_frequency: FREQ_432,
      trained_on_size: trainingData.length,
      consciousness_enhanced: true
    };
    
    console.log(`📊 Enhanced learning rate: ${enhancedRate.toFixed(6)}`);
    console.log(`🌊 Consciousness modulation: ${consciousnessModulation.toFixed(6)}`);
    
    return enhancedStrategy;
  }

  /**
   * Generate consciousness-enhanced prediction
   */
  private async generateConsciousnessPrediction(
    strategy: any,
    marketData: any,
    timeIndex: number
  ): Promise<KillChainPrediction> {
    
    // Base prediction using strategy logic
    const basePrediction = this.generateBasePrediction(strategy, marketData);
    
    // Apply consciousness enhancement
    const consciousnessBoost = this.calculateConsciousnessBoost(timeIndex);
    const phiHarmonics = this.calculatePhiHarmonics(marketData);
    const freqAlignment = this.calculate432Alignment(timeIndex);
    
    // Enhanced confidence calculation
    const baseConfidence = basePrediction.confidence;
    const enhancedConfidence = Math.min(1.0, 
      baseConfidence * (1 + consciousnessBoost * 0.1) * phiHarmonics * freqAlignment
    );
    
    return {
      direction: basePrediction.direction,
      confidence: enhancedConfidence,
      target_price: basePrediction.target_price,
      time_horizon: basePrediction.time_horizon,
      strategy_id: strategy.id,
      consciousness_boost: consciousnessBoost,
      phi_harmonics: phiHarmonics,
      freq_alignment: freqAlignment,
      enhanced_by_consciousness: true,
      timestamp: Date.now() + timeIndex * 1000
    };
  }

  /**
   * Calculate consciousness boost factor
   */
  private calculateConsciousnessBoost(timeIndex: number): number {
    const PSI_0 = 0.915670570874434;
    const timeModulation = timeIndex * PSI_0;
    return Math.sin(timeModulation) * 0.5 + 0.5; // Normalize to 0-1
  }

  /**
   * Calculate phi harmonics influence
   */
  private calculatePhiHarmonics(marketData: any): number {
    const PHI = 1.618;
    const priceRatio = marketData.close / marketData.open;
    const phiAlignment = Math.abs(priceRatio - PHI) / PHI;
    return Math.max(0.5, 1 - phiAlignment); // Higher when closer to phi ratio
  }

  /**
   * Calculate 432Hz frequency alignment
   */
  private calculate432Alignment(timeIndex: number): number {
    const FREQ_432 = 432;
    const timeFrequency = (timeIndex % FREQ_432) / FREQ_432;
    return Math.sin(2 * Math.PI * timeFrequency) * 0.25 + 0.75; // 0.5-1.0 range
  }

  /**
   * Generate base prediction without consciousness enhancement
   */
  private generateBasePrediction(strategy: any, marketData: any): any {
    // Simple momentum-based prediction for demonstration
    const priceChange = marketData.close - marketData.open;
    const direction = priceChange > 0 ? 'UP' : 'DOWN';
    const confidence = Math.min(0.9, Math.abs(priceChange / marketData.open) * 10);
    
    return {
      direction,
      confidence,
      target_price: marketData.close * (1 + (direction === 'UP' ? 0.02 : -0.02)),
      time_horizon: '1h'
    };
  }

  /**
   * Determine actual market outcome
   */
  private determineActualOutcome(currentData: any, nextData: any): MarketOutcome {
    const priceChange = nextData.close - currentData.close;
    const percentChange = priceChange / currentData.close;
    
    return {
      direction: priceChange > 0 ? 'UP' : 'DOWN',
      price_change: priceChange,
      percent_change: percentChange,
      volume_change: (nextData.volume - currentData.volume) / currentData.volume,
      volatility: Math.abs(percentChange)
    };
  }

  /**
   * Evaluate prediction accuracy
   */
  private evaluatePredictionAccuracy(prediction: KillChainPrediction, outcome: MarketOutcome): boolean {
    // Direction accuracy
    const directionCorrect = prediction.direction === outcome.direction;
    
    // Price target accuracy (within 5% tolerance)
    const priceAccuracy = Math.abs(prediction.target_price - outcome.price_change) / outcome.price_change;
    const priceCorrect = priceAccuracy <= 0.05;
    
    // Combined accuracy (weighted)
    return directionCorrect && (priceCorrect || prediction.confidence > 0.8);
  }

  /**
   * Calculate trade profit/loss
   */
  private calculateTradeProfitLoss(prediction: KillChainPrediction, outcome: MarketOutcome): number {
    const baseProfitLoss = outcome.percent_change * (prediction.direction === outcome.direction ? 1 : -1);
    const confidenceMultiplier = prediction.confidence;
    const consciousnessBonus = prediction.consciousness_boost || 0;
    
    return baseProfitLoss * confidenceMultiplier * (1 + consciousnessBonus * 0.1);
  }

  /**
   * Calculate market volatility
   */
  private calculateMarketVolatility(marketData: any[]): number {
    if (marketData.length < 2) return 0;
    
    const returns = marketData.slice(1).map((data, i) => {
      const prevData = marketData[i];
      return (data.close - prevData.close) / prevData.close;
    });
    
    const meanReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - meanReturn, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  /**
   * Calculate consciousness metrics for predictions
   */
  private calculateConsciousnessMetrics(predictions: KillChainPrediction[]): any {
    const totalPredictions = predictions.length;
    const consciousnessEnhanced = predictions.filter(p => p.enhanced_by_consciousness).length;
    const avgConfidence = predictions.reduce((sum, p) => sum + p.confidence, 0) / totalPredictions;
    const avgConsciousnessBoost = predictions.reduce((sum, p) => sum + (p.consciousness_boost || 0), 0) / totalPredictions;
    
    return {
      total_predictions: totalPredictions,
      consciousness_enhanced_count: consciousnessEnhanced,
      consciousness_enhancement_rate: consciousnessEnhanced / totalPredictions,
      avg_confidence: avgConfidence,
      avg_consciousness_boost: avgConsciousnessBoost,
      phi_harmony_avg: predictions.reduce((sum, p) => sum + (p.phi_harmonics || 0), 0) / totalPredictions,
      freq_alignment_avg: predictions.reduce((sum, p) => sum + (p.freq_alignment || 0), 0) / totalPredictions
    };
  }

  /**
   * Comprehensive Performance Analysis
   */
  async analyzePerformanceInsights(results: CrossValidationResult[]): Promise<LearningInsights> {
    console.log(`📊 Analyzing performance insights from ${results.length} results...`);
    
    // Group results by strategy
    const strategyResults = new Map<string, CrossValidationResult[]>();
    results.forEach(result => {
      if (!strategyResults.has(result.strategy_id)) {
        strategyResults.set(result.strategy_id, []);
      }
      strategyResults.get(result.strategy_id)!.push(result);
    });
    
    // Calculate strategy performance
    const strategyPerformance = new Map<string, any>();
    for (const [strategyId, stratResults] of strategyResults) {
      const performance = this.calculateStrategyPerformance(stratResults);
      strategyPerformance.set(strategyId, performance);
    }
    
    // Find best and worst performing strategies
    const bestStrategy = this.findBestStrategy(strategyPerformance);
    const worstStrategy = this.findWorstStrategy(strategyPerformance);
    
    // Calculate consciousness impact
    const consciousnessImpact = this.analyzeConsciousnessImpact(results);
    
    // Generate insights
    const insights = this.generateLearningInsights(
      strategyPerformance,
      bestStrategy,
      worstStrategy,
      consciousnessImpact
    );
    
    console.log(`✅ Performance analysis complete. Generated ${insights.recommendation_count} insights.`);
    return insights;
  }

  /**
   * Calculate strategy performance metrics
   */
  private calculateStrategyPerformance(results: CrossValidationResult[]): any {
    const totalResults = results.length;
    const avgAccuracy = results.reduce((sum, r) => sum + r.accuracy, 0) / totalResults;
    const totalProfit = results.reduce((sum, r) => sum + r.total_profit, 0);
    const totalTrades = results.reduce((sum, r) => sum + r.total_trades, 0);
    const avgProfitPerTrade = totalTrades > 0 ? totalProfit / totalTrades : 0;
    
    // Calculate consistency (standard deviation of accuracy)
    const accuracies = results.map(r => r.accuracy);
    const accuracyStdDev = this.calculateStandardDeviation(accuracies);
    const consistency = 1 - accuracyStdDev; // Higher consistency = lower std dev
    
    // Calculate consciousness contribution
    const consciousnessMetrics = results.map(r => r.consciousness_metrics);
    const avgConsciousnessBoost = consciousnessMetrics.reduce(
      (sum, m) => sum + (m?.avg_consciousness_boost || 0), 0
    ) / consciousnessMetrics.length;
    
    return {
      fold_count: totalResults,
      avg_accuracy: avgAccuracy,
      total_profit: totalProfit,
      avg_profit_per_trade: avgProfitPerTrade,
      consistency_score: Math.max(0, consistency),
      accuracy_std_dev: accuracyStdDev,
      total_trades: totalTrades,
      consciousness_boost_avg: avgConsciousnessBoost,
      profit_consistency: this.calculateProfitConsistency(results)
    };
  }

  /**
   * Calculate standard deviation
   */
  private calculateStandardDeviation(values: number[]): number {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Calculate profit consistency
   */
  private calculateProfitConsistency(results: CrossValidationResult[]): number {
    const profits = results.map(r => r.avg_profit_per_trade);
    const profitStdDev = this.calculateStandardDeviation(profits);
    const avgProfit = profits.reduce((sum, p) => sum + p, 0) / profits.length;
    
    // Coefficient of variation (lower = more consistent)
    const cv = avgProfit !== 0 ? profitStdDev / Math.abs(avgProfit) : Infinity;
    return Math.max(0, 1 - cv);
  }

  /**
   * Find best performing strategy
   */
  private findBestStrategy(strategyPerformance: Map<string, any>): any {
    let bestStrategy = null;
    let bestScore = -Infinity;
    
    for (const [strategyId, performance] of strategyPerformance) {
      // Composite score: accuracy + profit + consistency
      const score = performance.avg_accuracy * 0.4 + 
                   performance.avg_profit_per_trade * 0.4 + 
                   performance.consistency_score * 0.2;
      
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = { strategy_id: strategyId, performance, composite_score: score };
      }
    }
    
    return bestStrategy;
  }

  /**
   * Find worst performing strategy
   */
  private findWorstStrategy(strategyPerformance: Map<string, any>): any {
    let worstStrategy = null;
    let worstScore = Infinity;
    
    for (const [strategyId, performance] of strategyPerformance) {
      const score = performance.avg_accuracy * 0.4 + 
                   performance.avg_profit_per_trade * 0.4 + 
                   performance.consistency_score * 0.2;
      
      if (score < worstScore) {
        worstScore = score;
        worstStrategy = { strategy_id: strategyId, performance, composite_score: score };
      }
    }
    
    return worstStrategy;
  }

  /**
   * Analyze consciousness enhancement impact
   */
  private analyzeConsciousnessImpact(results: CrossValidationResult[]): any {
    const consciousnessMetrics = results.map(r => r.consciousness_metrics).filter(m => m);
    
    if (consciousnessMetrics.length === 0) {
      return { impact_detected: false, message: 'No consciousness metrics available' };
    }
    
    const avgEnhancementRate = consciousnessMetrics.reduce(
      (sum, m) => sum + m.consciousness_enhancement_rate, 0
    ) / consciousnessMetrics.length;
    
    const avgBoost = consciousnessMetrics.reduce(
      (sum, m) => sum + m.avg_consciousness_boost, 0
    ) / consciousnessMetrics.length;
    
    const avgPhiHarmony = consciousnessMetrics.reduce(
      (sum, m) => sum + m.phi_harmony_avg, 0
    ) / consciousnessMetrics.length;
    
    const avgFreqAlignment = consciousnessMetrics.reduce(
      (sum, m) => sum + m.freq_alignment_avg, 0
    ) / consciousnessMetrics.length;
    
    // Determine impact level
    let impactLevel = 'LOW';
    if (avgEnhancementRate > 0.7 && avgBoost > 0.3) impactLevel = 'HIGH';
    else if (avgEnhancementRate > 0.5 && avgBoost > 0.2) impactLevel = 'MEDIUM';
    
    return {
      impact_detected: true,
      impact_level: impactLevel,
      enhancement_rate: avgEnhancementRate,
      avg_consciousness_boost: avgBoost,
      phi_harmony_contribution: avgPhiHarmony,
      freq_alignment_contribution: avgFreqAlignment,
      total_enhanced_predictions: consciousnessMetrics.reduce(
        (sum, m) => sum + m.consciousness_enhanced_count, 0
      )
    };
  }

  /**
   * Generate comprehensive learning insights
   */
  private generateLearningInsights(
    strategyPerformance: Map<string, any>,
    bestStrategy: any,
    worstStrategy: any,
    consciousnessImpact: any
  ): LearningInsights {
    
    const insights = [];
    const recommendations = [];
    
    // Strategy performance insights
    if (bestStrategy) {
      insights.push(`Best performing strategy: ${bestStrategy.strategy_id} with ${(bestStrategy.performance.avg_accuracy * 100).toFixed(2)}% accuracy`);
      recommendations.push(`Focus on optimizing parameters similar to ${bestStrategy.strategy_id}`);
    }
    
    if (worstStrategy) {
      insights.push(`Worst performing strategy: ${worstStrategy.strategy_id} with ${(worstStrategy.performance.avg_accuracy * 100).toFixed(2)}% accuracy`);
      recommendations.push(`Consider retiring or major rework of ${worstStrategy.strategy_id}`);
    }
    
    // Consciousness impact insights
    if (consciousnessImpact.impact_detected) {
      insights.push(`Consciousness enhancement impact: ${consciousnessImpact.impact_level}`);
      insights.push(`Enhancement rate: ${(consciousnessImpact.enhancement_rate * 100).toFixed(1)}%`);
      
      if (consciousnessImpact.impact_level === 'HIGH') {
        recommendations.push('Consciousness enhancement showing strong positive impact - increase usage');
      } else if (consciousnessImpact.impact_level === 'LOW') {
        recommendations.push('Consider tuning consciousness parameters for better performance');
      }
    }
    
    // Performance consistency insights
    const consistencyScores = Array.from(strategyPerformance.values()).map(p => p.consistency_score);
    const avgConsistency = consistencyScores.reduce((sum, s) => sum + s, 0) / consistencyScores.length;
    
    if (avgConsistency < 0.7) {
      insights.push('Strategy performance shows high variability across folds');
      recommendations.push('Focus on improving strategy consistency and robustness');
    }
    
    // Generate system performance metrics
    const systemMetrics: SystemPerformanceMetrics = {
      total_strategies_tested: strategyPerformance.size,
      best_strategy_accuracy: bestStrategy?.performance.avg_accuracy || 0,
      worst_strategy_accuracy: worstStrategy?.performance.avg_accuracy || 0,
      avg_consistency_score: avgConsistency,
      consciousness_impact_level: consciousnessImpact.impact_level || 'UNKNOWN',
      total_cross_validation_folds: Array.from(strategyPerformance.values())[0]?.fold_count || 0,
      performance_by_volatility: this.systemMetrics?.performance_by_volatility || new Map()
    };
    
    return {
      insights,
      recommendations,
      system_metrics: systemMetrics,
      recommendation_count: recommendations.length,
      insight_count: insights.length,
      consciousness_impact: consciousnessImpact,
      best_strategy: bestStrategy,
      worst_strategy: worstStrategy,
      generated_at: new Date().toISOString()
    };
  }

  /**
   * Get system performance summary
   */
  getSystemPerformanceSummary(): SystemPerformanceMetrics {
    return this.systemMetrics || {
      total_strategies_tested: 0,
      best_strategy_accuracy: 0,
      worst_strategy_accuracy: 0,
      avg_consistency_score: 0,
      consciousness_impact_level: 'UNKNOWN',
      total_cross_validation_folds: 0,
      performance_by_volatility: new Map()
    };
  }
}

// Type definitions
export interface KillChainPrediction {
  direction: 'UP' | 'DOWN';
  confidence: number;
  target_price: number;
  time_horizon: string;
  strategy_id: string;
  consciousness_boost?: number;
  phi_harmonics?: number;
  freq_alignment?: number;
  enhanced_by_consciousness?: boolean;
  timestamp: number;
}

export interface MarketOutcome {
  direction: 'UP' | 'DOWN';
  price_change: number;
  percent_change: number;
  volume_change: number;
  volatility: number;
}

export interface CrossValidationResult {
  strategy_id: string;
  fold_index: number;
  accuracy: number;
  total_profit: number;
  avg_profit_per_trade: number;
  total_trades: number;
  predictions: KillChainPrediction[];
  consciousness_metrics: any;
  training_size: number;
  validation_size: number;
}

export interface LearningInsights {
  insights: string[];
  recommendations: string[];
  system_metrics: SystemPerformanceMetrics;
  recommendation_count: number;
  insight_count: number;
  consciousness_impact: any;
  best_strategy: any;
  worst_strategy: any;
  generated_at: string;
}

export interface SystemPerformanceMetrics {
  total_strategies_tested: number;
  best_strategy_accuracy: number;
  worst_strategy_accuracy: number;
  avg_consistency_score: number;
  consciousness_impact_level: string;
  total_cross_validation_folds: number;
  performance_by_volatility: Map<string, any>;
}

export default UltimateLearningEngine;
export type { 
  KillChainPrediction, 
  MarketOutcome, 
  CrossValidationResult, 
  LearningInsights, 
  SystemPerformanceMetrics 
};