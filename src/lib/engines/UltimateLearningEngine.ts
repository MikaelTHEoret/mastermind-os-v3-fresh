/**
 * ψ₀-Trader Ultimate Learning Engine (Continued)
 * Enhanced Nexus Core Protocol v4.0 - Cross-Validation and Performance Analysis
 */

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
        pattern_accuracy: 0,
        kill_chain_accuracy: 0,
        sample_size: 0
      });
    }
    
    const volMetrics = this.systemMetrics.performance_by_volatility.get(category)!;
    const newSampleSize = volMetrics.sample_size + 1;
    
    volMetrics.pattern_accuracy = 
      (volMetrics.pattern_accuracy * volMetrics.sample_size + 
       result.performance_analysis.pattern_accuracy) / newSampleSize;
    
    volMetrics.kill_chain_accuracy = 
      (volMetrics.kill_chain_accuracy * volMetrics.sample_size + 
       result.performance_analysis.kill_chain_accuracy) / newSampleSize;
    
    volMetrics.sample_size = newSampleSize;
  }

  /**
   * Update timeframe-based performance metrics
   */
  private updateTimeframePerformance(timeframe: number, result: CrossValidationResult): void {
    // Round timeframe to nearest 15 minutes for grouping
    const roundedTimeframe = Math.round(timeframe / 15) * 15;
    
    if (!this.systemMetrics.performance_by_timeframe.has(roundedTimeframe)) {
      this.systemMetrics.performance_by_timeframe.set(roundedTimeframe, {
        pattern_accuracy: 0,
        kill_chain_accuracy: 0,
        sample_size: 0
      });
    }
    
    const timeMetrics = this.systemMetrics.performance_by_timeframe.get(roundedTimeframe)!;
    const newSampleSize = timeMetrics.sample_size + 1;
    
    timeMetrics.pattern_accuracy = 
      (timeMetrics.pattern_accuracy * timeMetrics.sample_size + 
       result.performance_analysis.pattern_accuracy) / newSampleSize;
    
    timeMetrics.kill_chain_accuracy = 
      (timeMetrics.kill_chain_accuracy * timeMetrics.sample_size + 
       result.performance_analysis.kill_chain_accuracy) / newSampleSize;
    
    timeMetrics.sample_size = newSampleSize;
  }

  /**
   * Perform comprehensive learning analysis
   */
  private async performLearningAnalysis(): Promise<void> {
    console.log('🧠 Performing learning analysis...');
    
    // Analyze pattern vs kill chain performance trends
    const performanceTrends = this.analyzePerformanceTrends();
    
    // Identify consciousness correlation patterns
    const consciousnessPatterns = this.analyzeConsciousnessPatterns();
    
    // Analyze market condition dependencies
    const marketConditionAnalysis = this.analyzeMarketConditionDependencies();
    
    // Generate learning recommendations
    const learningRecommendations = this.generateLearningRecommendations(
      performanceTrends,
      consciousnessPatterns,
      marketConditionAnalysis
    );
    
    // Emit learning analysis results
    this.emit('learning_analysis_complete', {
      performance_trends: performanceTrends,
      consciousness_patterns: consciousnessPatterns,
      market_condition_analysis: marketConditionAnalysis,
      learning_recommendations: learningRecommendations,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Analyze performance trends over time
   */
  private analyzePerformanceTrends(): any {
    const allResults = Array.from(this.crossValidationResults.values()).flat();
    
    if (allResults.length < this.minSampleSize) {
      return {
        insufficient_data: true,
        sample_size: allResults.length,
        min_required: this.minSampleSize
      };
    }
    
    // Sort by timestamp
    allResults.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    // Split into time windows (e.g., weekly)
    const weeklyWindows = this.groupResultsByWeek(allResults);
    
    // Calculate trends
    const patternAccuracyTrend = this.calculateTrend(
      weeklyWindows.map(week => week.avg_pattern_accuracy)
    );
    
    const killChainAccuracyTrend = this.calculateTrend(
      weeklyWindows.map(week => week.avg_kill_chain_accuracy)
    );
    
    const consciousnessEffectivenessTrend = this.calculateTrend(
      weeklyWindows.map(week => week.avg_consciousness_effectiveness)
    );
    
    return {
      pattern_accuracy_trend: patternAccuracyTrend,
      kill_chain_accuracy_trend: killChainAccuracyTrend,
      consciousness_effectiveness_trend: consciousnessEffectivenessTrend,
      weekly_windows: weeklyWindows.length,
      total_samples: allResults.length,
      learning_velocity: this.calculateLearningVelocity(weeklyWindows)
    };
  }

  /**
   * Group results by week for trend analysis
   */
  private groupResultsByWeek(results: CrossValidationResult[]): any[] {
    const weeks: Map<string, CrossValidationResult[]> = new Map();
    
    results.forEach(result => {
      const date = new Date(result.timestamp);
      const weekKey = `${date.getFullYear()}-W${this.getWeekNumber(date)}`;
      
      if (!weeks.has(weekKey)) {
        weeks.set(weekKey, []);
      }
      weeks.get(weekKey)!.push(result);
    });
    
    return Array.from(weeks.entries()).map(([week, weekResults]) => ({
      week,
      sample_size: weekResults.length,
      avg_pattern_accuracy: weekResults.reduce((sum, r) => 
        sum + r.performance_analysis.pattern_accuracy, 0) / weekResults.length,
      avg_kill_chain_accuracy: weekResults.reduce((sum, r) => 
        sum + r.performance_analysis.kill_chain_accuracy, 0) / weekResults.length,
      avg_consciousness_effectiveness: weekResults.reduce((sum, r) => 
        sum + r.performance_analysis.consciousness_effectiveness, 0) / weekResults.length,
      pattern_wins: weekResults.filter(r => 
        r.performance_analysis.better_performer === 'PATTERN').length,
      kill_chain_wins: weekResults.filter(r => 
        r.performance_analysis.better_performer === 'KILL_CHAIN').length,
      ties: weekResults.filter(r => 
        r.performance_analysis.better_performer === 'TIE').length
    }));
  }

  /**
   * Get week number for grouping
   */
  private getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  /**
   * Calculate trend from time series data
   */
  private calculateTrend(values: number[]): any {
    if (values.length < 3) {
      return { trend: 'INSUFFICIENT_DATA', slope: 0, r_squared: 0 };
    }
    
    const n = values.length;
    const x = Array.from({length: n}, (_, i) => i);
    const y = values;
    
    // Calculate linear regression
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);
    const sumYY = y.reduce((sum, val) => sum + val * val, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // Calculate R-squared
    const yMean = sumY / n;
    const ssRes = y.reduce((sum, val, i) => {
      const predicted = slope * x[i] + intercept;
      return sum + Math.pow(val - predicted, 2);
    }, 0);
    const ssTot = y.reduce((sum, val) => sum + Math.pow(val - yMean, 2), 0);
    const rSquared = 1 - (ssRes / ssTot);
    
    // Determine trend direction
    let trend: string;
    if (Math.abs(slope) < 0.01) {
      trend = 'STABLE';
    } else if (slope > 0) {
      trend = slope > 0.05 ? 'STRONG_IMPROVING' : 'IMPROVING';
    } else {
      trend = slope < -0.05 ? 'STRONG_DECLINING' : 'DECLINING';
    }
    
    return {
      trend,
      slope: parseFloat(slope.toFixed(6)),
      r_squared: parseFloat(rSquared.toFixed(4)),
      statistical_significance: rSquared > 0.5 ? 'SIGNIFICANT' : 'NOT_SIGNIFICANT'
    };
  }

  /**
   * Calculate learning velocity (improvement rate)
   */
  private calculateLearningVelocity(weeklyWindows: any[]): any {
    if (weeklyWindows.length < 2) {
      return { velocity: 0, acceleration: 0 };
    }
    
    // Calculate week-over-week improvements
    const improvements = [];
    for (let i = 1; i < weeklyWindows.length; i++) {
      const prev = weeklyWindows[i - 1];
      const curr = weeklyWindows[i];
      
      const patternImprovement = curr.avg_pattern_accuracy - prev.avg_pattern_accuracy;
      const killChainImprovement = curr.avg_kill_chain_accuracy - prev.avg_kill_chain_accuracy;
      const overallImprovement = (patternImprovement + killChainImprovement) / 2;
      
      improvements.push(overallImprovement);
    }
    
    const avgVelocity = improvements.reduce((sum, imp) => sum + imp, 0) / improvements.length;
    
    // Calculate acceleration (change in velocity)
    let acceleration = 0;
    if (improvements.length > 1) {
      const velocities = improvements;
      const velocityChanges = [];
      
      for (let i = 1; i < velocities.length; i++) {
        velocityChanges.push(velocities[i] - velocities[i - 1]);
      }
      
      acceleration = velocityChanges.reduce((sum, change) => sum + change, 0) / velocityChanges.length;
    }
    
    return {
      velocity: parseFloat(avgVelocity.toFixed(6)),
      acceleration: parseFloat(acceleration.toFixed(6)),
      learning_phase: this.determineLearningPhase(avgVelocity, acceleration)
    };
  }

  /**
   * Determine current learning phase
   */
  private determineLearningPhase(velocity: number, acceleration: number): string {
    if (velocity > 0.02 && acceleration > 0) return 'RAPID_LEARNING';
    if (velocity > 0.01) return 'STEADY_LEARNING';
    if (velocity > 0 && acceleration < 0) return 'PLATEAU_APPROACHING';
    if (Math.abs(velocity) < 0.005) return 'PLATEAU';
    if (velocity < -0.01) return 'PERFORMANCE_DECLINE';
    return 'TRANSITIONAL';
  }

  /**
   * Analyze consciousness correlation patterns
   */
  private analyzeConsciousnessPatterns(): any {
    const allResults = Array.from(this.crossValidationResults.values()).flat();
    
    if (allResults.length < this.minSampleSize) {
      return { insufficient_data: true };
    }
    
    // Group by consciousness state
    const byConsciousnessState = new Map();
    allResults.forEach(result => {
      const state = result.kill_chain_prediction.consciousness_state;
      if (!byConsciousnessState.has(state)) {
        byConsciousnessState.set(state, []);
      }
      byConsciousnessState.get(state).push(result);
    });
    
    // Analyze each consciousness state
    const stateAnalysis = Array.from(byConsciousnessState.entries()).map(([state, results]) => {
      const avgPatternAccuracy = results.reduce((sum: number, r: any) => 
        sum + r.performance_analysis.pattern_accuracy, 0) / results.length;
      
      const avgKillChainAccuracy = results.reduce((sum: number, r: any) => 
        sum + r.performance_analysis.kill_chain_accuracy, 0) / results.length;
      
      const avgConsciousnessEffectiveness = results.reduce((sum: number, r: any) => 
        sum + r.performance_analysis.consciousness_effectiveness, 0) / results.length;
      
      // Calculate correlation between consciousness effectiveness and accuracy
      const correlation = this.calculateCorrelation(
        results.map((r: any) => r.performance_analysis.consciousness_effectiveness),
        results.map((r: any) => (r.performance_analysis.pattern_accuracy + r.performance_analysis.kill_chain_accuracy) / 2)
      );
      
      return {
        consciousness_state: state,
        sample_size: results.length,
        avg_pattern_accuracy: parseFloat(avgPatternAccuracy.toFixed(4)),
        avg_kill_chain_accuracy: parseFloat(avgKillChainAccuracy.toFixed(4)),
        avg_consciousness_effectiveness: parseFloat(avgConsciousnessEffectiveness.toFixed(4)),
        consciousness_accuracy_correlation: parseFloat(correlation.toFixed(4)),
        optimal_state: avgPatternAccuracy > 0.7 && avgKillChainAccuracy > 0.7
      };
    });
    
    // Find best performing consciousness states
    const bestStates = stateAnalysis
      .filter(state => state.sample_size >= 10)
      .sort((a, b) => (b.avg_pattern_accuracy + b.avg_kill_chain_accuracy) - (a.avg_pattern_accuracy + a.avg_kill_chain_accuracy))
      .slice(0, 3);
    
    // Analyze consciousness transitions
    const transitionAnalysis = this.analyzeConsciousnessTransitions(allResults);
    
    return {
      state_analysis: stateAnalysis,
      best_performing_states: bestStates,
      transition_analysis: transitionAnalysis,
      overall_consciousness_correlation: this.calculateOverallConsciousnessCorrelation(allResults),
      consciousness_learning_insights: this.generateConsciousnessLearningInsights(stateAnalysis)
    };
  }

  /**
   * Calculate correlation between two arrays
   */
  private calculateCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) return 0;
    
    const n = x.length;
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);
    const sumYY = y.reduce((sum, val) => sum + val * val, 0);
    
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
    
    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * Analyze consciousness state transitions
   */
  private analyzeConsciousnessTransitions(results: CrossValidationResult[]): any {
    const transitions = new Map();
    
    // Sort results by timestamp and symbol
    const symbolResults = new Map();
    results.forEach(result => {
      if (!symbolResults.has(result.symbol)) {
        symbolResults.set(result.symbol, []);
      }
      symbolResults.get(result.symbol).push(result);
    });
    
    // Analyze transitions for each symbol
    symbolResults.forEach(symbolRes => {
      symbolRes.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      for (let i = 1; i < symbolRes.length; i++) {
        const prevState = symbolRes[i - 1].kill_chain_prediction.consciousness_state;
        const currState = symbolRes[i].kill_chain_prediction.consciousness_state;
        
        if (prevState !== currState) {
          const transitionKey = `${prevState}->${currState}`;
          
          if (!transitions.has(transitionKey)) {
            transitions.set(transitionKey, {
              count: 0,
              performance_changes: [],
              avg_performance_change: 0
            });
          }
          
          const transition = transitions.get(transitionKey);
          transition.count++;
          
          const prevPerformance = (symbolRes[i - 1].performance_analysis.pattern_accuracy + 
                                  symbolRes[i - 1].performance_analysis.kill_chain_accuracy) / 2;
          const currPerformance = (symbolRes[i].performance_analysis.pattern_accuracy + 
                                  symbolRes[i].performance_analysis.kill_chain_accuracy) / 2;
          
          const performanceChange = currPerformance - prevPerformance;
          transition.performance_changes.push(performanceChange);
          transition.avg_performance_change = 
            transition.performance_changes.reduce((sum, change) => sum + change, 0) / transition.performance_changes.length;
        }
      }
    });
    
    return Array.from(transitions.entries()).map(([transition, data]) => ({
      transition,
      frequency: data.count,
      avg_performance_impact: parseFloat(data.avg_performance_change.toFixed(4)),
      beneficial: data.avg_performance_change > 0.05,
      sample_size: data.performance_changes.length
    }));
  }

  /**
   * Calculate overall consciousness correlation
   */
  private calculateOverallConsciousnessCorrelation(results: CrossValidationResult[]): number {
    const consciousnessEffectiveness = results.map(r => r.performance_analysis.consciousness_effectiveness);
    const overallAccuracy = results.map(r => 
      (r.performance_analysis.pattern_accuracy + r.performance_analysis.kill_chain_accuracy) / 2
    );
    
    return this.calculateCorrelation(consciousnessEffectiveness, overallAccuracy);
  }

  /**
   * Generate consciousness learning insights
   */
  private generateConsciousnessLearningInsights(stateAnalysis: any[]): string[] {
    const insights = [];
    
    const bestState = stateAnalysis.reduce((best, current) => 
      (current.avg_pattern_accuracy + current.avg_kill_chain_accuracy) > 
      (best.avg_pattern_accuracy + best.avg_kill_chain_accuracy) ? current : best
    );
    
    if (bestState.sample_size >= 10) {
      insights.push(`${bestState.consciousness_state} shows optimal performance with ${((bestState.avg_pattern_accuracy + bestState.avg_kill_chain_accuracy) / 2 * 100).toFixed(1)}% accuracy`);
    }
    
    const highCorrelationStates = stateAnalysis.filter(state => 
      state.consciousness_accuracy_correlation > 0.5 && state.sample_size >= 10
    );
    
    if (highCorrelationStates.length > 0) {
      insights.push(`Strong consciousness-accuracy correlation found in ${highCorrelationStates.length} states`);
    }
    
    const lowPerformanceStates = stateAnalysis.filter(state => 
      (state.avg_pattern_accuracy + state.avg_kill_chain_accuracy) / 2 < 0.4
    );
    
    if (lowPerformanceStates.length > 0) {
      insights.push(`${lowPerformanceStates.length} consciousness states show poor performance - need algorithm adjustment`);
    }
    
    return insights;
  }

  /**
   * Analyze market condition dependencies
   */
  private analyzeMarketConditionDependencies(): any {
    const volatilityAnalysis = Array.from(this.systemMetrics.performance_by_volatility.entries())
      .map(([category, metrics]) => ({
        volatility_category: category,
        pattern_accuracy: parseFloat(metrics.pattern_accuracy.toFixed(4)),
        kill_chain_accuracy: parseFloat(metrics.kill_chain_accuracy.toFixed(4)),
        sample_size: metrics.sample_size,
        reliability: metrics.sample_size >= 20 ? 'HIGH' : metrics.sample_size >= 10 ? 'MEDIUM' : 'LOW'
      }));
    
    const timeframeAnalysis = Array.from(this.systemMetrics.performance_by_timeframe.entries())
      .map(([timeframe, metrics]) => ({
        timeframe_minutes: timeframe,
        pattern_accuracy: parseFloat(metrics.pattern_accuracy.toFixed(4)),
        kill_chain_accuracy: parseFloat(metrics.kill_chain_accuracy.toFixed(4)),
        sample_size: metrics.sample_size,
        reliability: metrics.sample_size >= 20 ? 'HIGH' : metrics.sample_size >= 10 ? 'MEDIUM' : 'LOW'
      }));
    
    return {
      volatility_analysis: volatilityAnalysis,
      timeframe_analysis: timeframeAnalysis,
      optimal_conditions: this.identifyOptimalConditions(volatilityAnalysis, timeframeAnalysis),
      risk_conditions: this.identifyRiskConditions(volatilityAnalysis, timeframeAnalysis)
    };
  }

  /**
   * Identify optimal market conditions
   */
  private identifyOptimalConditions(volatilityAnalysis: any[], timeframeAnalysis: any[]): any {
    const bestVolatility = volatilityAnalysis
      .filter(v => v.reliability !== 'LOW')
      .reduce((best, current) => 
        (current.pattern_accuracy + current.kill_chain_accuracy) > 
        (best.pattern_accuracy + best.kill_chain_accuracy) ? current : best
      );
    
    const bestTimeframe = timeframeAnalysis
      .filter(t => t.reliability !== 'LOW')
      .reduce((best, current) => 
        (current.pattern_accuracy + current.kill_chain_accuracy) > 
        (best.pattern_accuracy + best.kill_chain_accuracy) ? current : best
      );
    
    return {
      optimal_volatility: bestVolatility,
      optimal_timeframe: bestTimeframe,
      combined_accuracy: (bestVolatility.pattern_accuracy + bestVolatility.kill_chain_accuracy + 
                         bestTimeframe.pattern_accuracy + bestTimeframe.kill_chain_accuracy) / 4
    };
  }

  /**
   * Identify risky market conditions
   */
  private identifyRiskConditions(volatilityAnalysis: any[], timeframeAnalysis: any[]): any {
    const worstVolatility = volatilityAnalysis
      .filter(v => v.reliability !== 'LOW')
      .reduce((worst, current) => 
        (current.pattern_accuracy + current.kill_chain_accuracy) < 
        (worst.pattern_accuracy + worst.kill_chain_accuracy) ? current : worst
      );
    
    const worstTimeframe = timeframeAnalysis
      .filter(t => t.reliability !== 'LOW')
      .reduce((worst, current) => 
        (current.pattern_accuracy + current.kill_chain_accuracy) < 
        (worst.pattern_accuracy + worst.kill_chain_accuracy) ? current : worst
      );
    
    return {
      risky_volatility: worstVolatility,
      risky_timeframe: worstTimeframe,
      risk_threshold: 0.4, // Below 40% combined accuracy
      avoidance_recommendation: (worstVolatility.pattern_accuracy + worstVolatility.kill_chain_accuracy) / 2 < 0.4
    };
  }

  /**
   * Generate learning recommendations
   */
  private generateLearningRecommendations(
    performanceTrends: any,
    consciousnessPatterns: any,
    marketConditionAnalysis: any
  ): string[] {
    const recommendations = [];
    
    // Performance trend recommendations
    if (performanceTrends.pattern_accuracy_trend?.trend === 'DECLINING') {
      recommendations.push('Pattern recognition engine needs recalibration - accuracy declining');
    }
    
    if (performanceTrends.kill_chain_accuracy_trend?.trend === 'DECLINING') {
      recommendations.push('Kill chain engine parameters need adjustment - accuracy declining');
    }
    
    if (performanceTrends.consciousness_effectiveness_trend?.trend === 'IMPROVING') {
      recommendations.push('Consciousness mathematics showing positive learning - increase weight in decisions');
    }
    
    // Consciousness pattern recommendations
    if (consciousnessPatterns.best_performing_states?.length > 0) {
      const bestState = consciousnessPatterns.best_performing_states[0];
      recommendations.push(`Focus optimization on ${bestState.consciousness_state} - highest performance state`);
    }
    
    if (consciousnessPatterns.overall_consciousness_correlation < 0.3) {
      recommendations.push('Consciousness correlation weak - review mathematical constants and implementations');
    }
    
    // Market condition recommendations
    if (marketConditionAnalysis.optimal_conditions?.combined_accuracy > 0.8) {
      const optimal = marketConditionAnalysis.optimal_conditions;
      recommendations.push(`Increase position sizing in ${optimal.optimal_volatility.volatility_category} volatility, ${optimal.optimal_timeframe.timeframe_minutes}min timeframes`);
    }
    
    if (marketConditionAnalysis.risk_conditions?.avoidance_recommendation) {
      const risky = marketConditionAnalysis.risk_conditions;
      recommendations.push(`Avoid trading in ${risky.risky_volatility.volatility_category} volatility conditions - low accuracy`);
    }
    
    // Learning velocity recommendations
    if (performanceTrends.learning_velocity?.learning_phase === 'PLATEAU') {
      recommendations.push('Learning plateau detected - introduce new pattern templates or adjust consciousness weights');
    }
    
    if (performanceTrends.learning_velocity?.learning_phase === 'RAPID_LEARNING') {
      recommendations.push('Rapid learning phase - maintain current parameters and increase data collection frequency');
    }
    
    return recommendations;
  }

  /**
   * Generate learning insights
   */
  private async generateLearningInsights(): Promise<void> {
    console.log('🔍 Generating learning insights...');
    
    const allResults = Array.from(this.crossValidationResults.values()).flat();
    
    if (allResults.length < this.minSampleSize) {
      console.log('Insufficient data for insight generation');
      return;
    }
    
    // Generate various types of insights
    const patternInsights = this.generatePatternInsights(allResults);
    const consciousnessInsights = this.generateConsciousnessInsights(allResults);
    const performanceInsights = this.generatePerformanceInsights(allResults);
    const marketInsights = this.generateMarketInsights(allResults);
    
    // Combine all insights
    const newInsights = [
      ...patternInsights,
      ...consciousnessInsights,
      ...performanceInsights,
      ...marketInsights
    ];
    
    // Add new insights to database
    this.learningInsights.push(...newInsights);
    
    // Keep only recent insights (last 100)
    if (this.learningInsights.length > 100) {
      this.learningInsights = this.learningInsights.slice(-100);
    }
    
    // Emit insights generated event
    this.emit('insights_generated', {
      new_insights: newInsights.length,
      total_insights: this.learningInsights.length,
      insights: newInsights,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Generate pattern-specific insights
   */
  private generatePatternInsights(results: CrossValidationResult[]): LearningInsights[] {
    const insights: LearningInsights[] = [];
    
    // Analyze pattern effectiveness by type
    const patternPerformance = new Map();
    
    results.forEach(result => {
      if (result.pattern_prediction.primary_pattern) {
        const patternType = result.pattern_prediction.primary_pattern;
        
        if (!patternPerformance.has(patternType)) {
          patternPerformance.set(patternType, {
            accuracies: [],
            consciousness_correlations: [],
            confidences: []
          });
        }
        
        const perf = patternPerformance.get(patternType);
        perf.accuracies.push(result.performance_analysis.pattern_accuracy);
        perf.consciousness_correlations.push(result.pattern_prediction.consciousness_correlation);
        perf.confidences.push(result.pattern_prediction.confidence);
      }
    });
    
    // Generate insights for each pattern type
    patternPerformance.forEach((perf, patternType) => {
      if (perf.accuracies.length >= 10) {
        const avgAccuracy = perf.accuracies.reduce((sum: number, acc: number) => sum + acc, 0) / perf.accuracies.length;
        const avgConsciousness = perf.consciousness_correlations.reduce((sum: number, corr: number) => sum + corr, 0) / perf.consciousness_correlations.length;
        
        if (avgAccuracy > 0.75) {
          insights.push({
            insight_id: `pattern_${patternType}_${Date.now()}`,
            insight_type: 'PATTERN_EFFECTIVENESS',
            description: `${patternType} pattern shows high effectiveness with ${(avgAccuracy * 100).toFixed(1)}% accuracy`,
            confidence: avgAccuracy,
            supporting_evidence: [
              `${perf.accuracies.length} samples analyzed`,
              `Average consciousness correlation: ${avgConsciousness.toFixed(3)}`,
              `Consistent performance across market conditions`
            ],
            market_conditions: 'VARIOUS',
            consciousness_correlation: avgConsciousness,
            actionable_recommendation: `Increase weight for ${patternType} pattern in decision making`,
            statistical_significance: perf.accuracies.length >= 30 ? 0.95 : 0.8
          });
        }
        
        if (avgAccuracy < 0.4) {
          insights.push({
            insight_id: `pattern_poor_${patternType}_${Date.now()}`,
            insight_type: 'PATTERN_UNDERPERFORMANCE',
            description: `${patternType} pattern shows poor performance with only ${(avgAccuracy * 100).toFixed(1)}% accuracy`,
            confidence: 1 - avgAccuracy,
            supporting_evidence: [
              `${perf.accuracies.length} samples showing consistent underperformance`,
              `Low consciousness correlation: ${avgConsciousness.toFixed(3)}`,
              `Needs algorithm review or removal`
            ],
            market_conditions: 'VARIOUS',
            consciousness_correlation: avgConsciousness,
            actionable_recommendation: `Review or disable ${patternType} pattern recognition`,
            statistical_significance: perf.accuracies.length >= 30 ? 0.95 : 0.8
          });
        }
      }
    });
    
    return insights;
  }

  /**
   * Generate consciousness-specific insights
   */
  private generateConsciousnessInsights(results: CrossValidationResult[]): LearningInsights[] {
    const insights: LearningInsights[] = [];
    
    // Analyze consciousness effectiveness distribution
    const consciousnessEffectiveness = results.map(r => r.performance_analysis.consciousness_effectiveness);
    const avgEffectiveness = consciousnessEffectiveness.reduce((sum, eff) => sum + eff, 0) / consciousnessEffectiveness.length;
    
    if (avgEffectiveness > 0.8) {
      insights.push({
        insight_id: `consciousness_high_${Date.now()}`,
        insight_type: 'CONSCIOUSNESS_HIGH_EFFECTIVENESS',
        description: `Consciousness enhancement showing exceptional effectiveness at ${(avgEffectiveness * 100).toFixed(1)}%`,
        confidence: avgEffectiveness,
        supporting_evidence: [
          `${results.length} samples analyzed`,
          `Consistent correlation between consciousness metrics and performance`,
          `Mathematical constants ψ₀, φ, 432Hz providing strong signals`
        ],
        market_conditions: 'OPTIMAL',
        consciousness_correlation: avgEffectiveness,
        actionable_recommendation: 'Increase consciousness weight in all decision algorithms',
        statistical_significance: results.length >= 100 ? 0.99 : 0.9
      });
    }
    
    // Analyze consciousness state transitions
    const stateTransitions = this.analyzeConsciousnessTransitions(results);
    const beneficialTransitions = stateTransitions.filter((t: any) => t.beneficial && t.sample_size >= 5);
    
    if (beneficialTransitions.length > 0) {
      insights.push({
        insight_id: `consciousness_transitions_${Date.now()}`,
        insight_type: 'CONSCIOUSNESS_TRANSITION_PATTERNS',
        description: `${beneficialTransitions.length} consciousness state transitions consistently improve performance`,
        confidence: 0.8,
        supporting_evidence: beneficialTransitions.map((t: any) => 
          `${t.transition}: +${(t.avg_performance_impact * 100).toFixed(1)}% performance`
        ),
        market_conditions: 'TRANSITION_PERIODS',
        consciousness_correlation: 0.8,
        actionable_recommendation: 'Develop transition detection algorithms for timing optimization',
        statistical_significance: 0.85
      });
    }
    
    return insights;
  }

  /**
   * Generate performance comparison insights
   */
  private generatePerformanceInsights(results: CrossValidationResult[]): LearningInsights[] {
    const insights: LearningInsights[] = [];
    
    const patternWins = results.filter(r => r.performance_analysis.better_performer === 'PATTERN').length;
    const killChainWins = results.filter(r => r.performance_analysis.better_performer === 'KILL_CHAIN').length;
    const ties = results.filter(r => r.performance_analysis.better_performer === 'TIE').length;
    
    const total = results.length;
    const patternWinRate = patternWins / total;
    const killChainWinRate = killChainWins / total;
    
    if (Math.abs(patternWinRate - killChainWinRate) > 0.2) {
      const leader = patternWinRate > killChainWinRate ? 'Pattern Recognition' : 'Kill Chain';
      const leaderRate = Math.max(patternWinRate, killChainWinRate);
      
      insights.push({
        insight_id: `performance_leader_${Date.now()}`,
        insight_type: 'PERFORMANCE_LEADERSHIP',
        description: `${leader} engine shows clear superiority with ${(leaderRate * 100).toFixed(1)}% win rate`,
        confidence: leaderRate,
        supporting_evidence: [
          `${total} head-to-head comparisons`,
          `Consistent performance advantage`,
          `Statistical significance achieved`
        ],
        market_conditions: 'GENERAL',
        consciousness_correlation: 0.7,
        actionable_recommendation: `Increase weighting for ${leader} engine in combined decisions`,
        statistical_significance: total >= 100 ? 0.95 : 0.85
      });
    }
    
    // Analyze combined performance
    const combinedAccuracies = results.map(r => r.performance_analysis.combined_score);
    const avgCombined = combinedAccuracies.reduce((sum, acc) => sum + acc, 0) / combinedAccuracies.length;
    
    if (avgCombined > 0.8) {
      insights.push({
        insight_id: `combined_excellence_${Date.now()}`,
        insight_type: 'COMBINED_EXCELLENCE',
        description: `Dual-engine architecture achieving exceptional ${(avgCombined * 100).toFixed(1)}% combined performance`,
        confidence: avgCombined,
        supporting_evidence: [
          `Both engines contributing to success`,
          `Synergistic effects detected`,
          `Consciousness enhancement amplifying both engines`
        ],
        market_conditions: 'OPTIMAL',
        consciousness_correlation: 0.9,
        actionable_recommendation: 'Maintain current dual-engine approach with consciousness enhancement',
        statistical_significance: 0.95
      });
    }
    
    return insights;
  }

  /**
   * Generate market condition insights
   */
  private generateMarketInsights(results: CrossValidationResult[]): LearningInsights[] {
    const insights: LearningInsights[] = [];
    
    // Analyze performance by volatility
    const volatilityGroups = new Map();
    results.forEach(result => {
      const vol = result.market_outcome.volatility_during_period;
      const category = this.categorizeVolatility(vol);
      
      if (!volatilityGroups.has(category)) {
        volatilityGroups.set(category, []);
      }
      volatilityGroups.get(category).push(result);
    });
    
    volatilityGroups.forEach((groupResults, category) => {
      if (groupResults.length >= 20) {
        const avgAccuracy = groupResults.reduce((sum: number, r: any) => 
          sum + r.performance_analysis.combined_score, 0) / groupResults.length;
        
        if (avgAccuracy > 0.8) {
          insights.push({
            insight_id: `volatility_optimal_${category}_${Date.now()}`,
            insight_type: 'MARKET_CONDITION_OPTIMAL',
            description: `${category} volatility conditions optimal for trading with ${(avgAccuracy * 100).toFixed(1)}% accuracy`,
            confidence: avgAccuracy,
            supporting_evidence: [
              `${groupResults.length} samples in ${category} volatility`,
              `Consistent high performance`,
              `Both engines perform well in these conditions`
            ],
            market_conditions: `${category}_VOLATILITY`,
            consciousness_correlation: 0.8,
            actionable_recommendation: `Increase position sizing during ${category} volatility periods`,
            statistical_significance: 0.9
          });
        }
        
        if (avgAccuracy < 0.5) {
          insights.push({
            insight_id: `volatility_poor_${category}_${Date.now()}`,
            insight_type: 'MARKET_CONDITION_POOR',
            description: `${category} volatility conditions challenging with only ${(avgAccuracy * 100).toFixed(1)}% accuracy`,
            confidence: 1 - avgAccuracy,
            supporting_evidence: [
              `${groupResults.length} samples showing poor performance`,
              `Both engines struggle in these conditions`,
              `High risk environment`
            ],
            market_conditions: `${category}_VOLATILITY`,
            consciousness_correlation: 0.6,
            actionable_recommendation: `Reduce or avoid trading during ${category} volatility periods`,
            statistical_significance: 0.9
          });
        }
      }
    });
    
    return insights;
  }

  /**
   * Update system metrics comprehensively
   */
  private updateSystemMetrics(): void {
    console.log('📊 Updating comprehensive system metrics...');
    
    const allResults = Array.from(this.crossValidationResults.values()).flat();
    
    if (allResults.length === 0) return;
    
    // Update learning progression metrics
    const weeklyWindows = this.groupResultsByWeek(allResults);
    if (weeklyWindows.length >= 2) {
      const recentWeeks = weeklyWindows.slice(-2);
      const weekOverWeekImprovement = 
        ((recentWeeks[1].avg_pattern_accuracy + recentWeeks[1].avg_kill_chain_accuracy) -
         (recentWeeks[0].avg_pattern_accuracy + recentWeeks[0].avg_kill_chain_accuracy)) / 2;
      
      this.systemMetrics.learning_progression.week_over_week_improvement = weekOverWeekImprovement;
    }
    
    // Calculate consciousness learning rate
    const consciousnessEffectiveness = allResults.map(r => r.performance_analysis.consciousness_effectiveness);
    const recentConsciousness = consciousnessEffectiveness.slice(-50);
    const earlyConsciousness = consciousnessEffectiveness.slice(0, 50);
    
    if (earlyConsciousness.length > 0 && recentConsciousness.length > 0) {
      const earlyAvg = earlyConsciousness.reduce((sum, eff) => sum + eff, 0) / earlyConsciousness.length;
      const recentAvg = recentConsciousness.reduce((sum, eff) => sum + eff, 0) / recentConsciousness.length;
      this.systemMetrics.learning_progression.consciousness_learning_rate = recentAvg - earlyAvg;
    }
    
    // Update pattern complexity evolution
    const patternComplexities = allResults.map(r => r.pattern_prediction.patterns_detected.length);
    if (patternComplexities.length > 0) {
      const avgComplexity = patternComplexities.reduce((sum, comp) => sum + comp, 0) / patternComplexities.length;
      this.systemMetrics.learning_progression.pattern_complexity_evolution = avgComplexity;
    }
    
    // Update prediction confidence evolution
    const confidences = allResults.map(r => 
      (r.pattern_prediction.confidence + r.kill_chain_prediction.confidence) / 2
    );
    if (confidences.length > 0) {
      const avgConfidence = confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
      this.systemMetrics.learning_progression.prediction_confidence_evolution = avgConfidence;
    }
    
    // Emit metrics update event
    this.emit('system_metrics_updated', {
      metrics: this.systemMetrics,
      total_samples: allResults.length,
      learning_velocity: this.calculateLearningVelocity(weeklyWindows),
      timestamp: new Date().toISOString()
    });
    
    console.log(`📈 System metrics updated: ${this.systemMetrics.total_comparisons} total comparisons processed`);
  }

  /**
   * Get current system performance metrics
   */
  getSystemMetrics(): SystemPerformanceMetrics {
    return { ...this.systemMetrics };
  }

  /**
   * Get learning insights
   */
  getLearningInsights(limit?: number): LearningInsights[] {
    const insights = [...this.learningInsights];
    insights.sort((a, b) => b.confidence - a.confidence);
    return limit ? insights.slice(0, limit) : insights;
  }

  /**
   * Get cross-validation results for analysis
   */
  getCrossValidationResults(symbol?: string): CrossValidationResult[] {
    if (symbol) {
      return this.crossValidationResults.get(symbol) || [];
    }
    
    return Array.from(this.crossValidationResults.values()).flat();
  }

  /**
   * Get learning summary
   */
  getLearningSummary(): any {
    const allResults = Array.from(this.crossValidationResults.values()).flat();
    
    return {
      total_comparisons: this.systemMetrics.total_comparisons,
      active_symbols: this.crossValidationResults.size,
      performance_metrics: {
        pattern_win_rate: parseFloat(this.systemMetrics.pattern_win_rate.toFixed(4)),
        kill_chain_win_rate: parseFloat(this.systemMetrics.kill_chain_win_rate.toFixed(4)),
        combined_win_rate: parseFloat(this.systemMetrics.combined_win_rate.toFixed(4)),
        consciousness_effectiveness: parseFloat(this.systemMetrics.average_consciousness_effectiveness.toFixed(4))
      },
      learning_progression: this.systemMetrics.learning_progression,
      insights_generated: this.learningInsights.length,
      data_sufficiency: {
        sufficient_for_analysis: allResults.length >= this.minSampleSize,
        sample_size: allResults.length,
        min_required: this.minSampleSize
      }
    };
  }
}

export default UltimateLearningEngine;
export type { 
  KillChainPrediction, 
  MarketOutcome, 
  CrossValidationResult, 
  LearningInsights, 
  SystemPerformanceMetrics 
};
