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