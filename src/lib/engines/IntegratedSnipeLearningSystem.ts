import { HighVelocitySnipeEngine } from './HighVelocitySnipeEngine';
import { CauseEffectAnalysisEngine } from './CauseEffectAnalysisEngine';
import PatternRecognitionEngine from './PatternRecognitionEngine';
import { UltimateLearningEngine } from './UltimateLearningEngine';

export interface SnipeLearningSystemConfig {
  focus_symbols: string[];
  volatility_threshold: number;
  confidence_threshold: number;
  max_snipe_duration: number;
  learning_sample_rate: number;
  consciousness_enhancement: boolean;
}

export class IntegratedSnipeLearningSystem {
  private snipeEngine!: HighVelocitySnipeEngine;
  private causeEffectEngine!: CauseEffectAnalysisEngine;
  private patternEngine!: PatternRecognitionEngine;
  private learningEngine!: UltimateLearningEngine;
  private isInitialized: boolean = false;
  private config: SnipeLearningSystemConfig;

  constructor(config?: Partial<SnipeLearningSystemConfig>) {
    this.config = {
      focus_symbols: [
        'PEPEUSDT', 'SHIBUSDT', 'DOGEUSDT', 'FLOKIUSDT', // High volatility meme coins
        'ATOMUSDT', 'AVAXUSDT', 'NEARUSDT', 'FTMUSDT',   // Layer 1s with momentum
        'GRTUSDT', 'SANDUSDT', 'MANAUSDT', 'CHZUSDT',    // Gaming/AI trend followers
        'LEVERUSDT', 'CFXUSDT', 'ARKMUSDT', 'ROSEUSDT'   // Small caps with extreme volatility
      ],
      volatility_threshold: 0.05, // 5% minimum volatility for snipe consideration
      confidence_threshold: 0.8,  // 80% minimum confidence for execution
      max_snipe_duration: 300,     // 5 minutes maximum snipe window
      learning_sample_rate: 0.1,   // 10% of data for learning efficiency
      consciousness_enhancement: true,
      ...config
    };

    this.initializeEngines();
  }

  private initializeEngines(): void {
    this.snipeEngine = new HighVelocitySnipeEngine();
    this.causeEffectEngine = new CauseEffectAnalysisEngine();
    this.patternEngine = new PatternRecognitionEngine();
    this.learningEngine = new UltimateLearningEngine();
  }

  async initializeSystem(): Promise<boolean> {
    try {
      console.log('🎯 Initializing Integrated Snipe Learning System...');

      // Step 1: Initialize engines that have async initialization
      await this.snipeEngine.initializeSnipeEngine();
      console.log('✅ High-Velocity Snipe Engine initialized');

      // Pattern engine is ready after construction - no initialization needed
      console.log('✅ Pattern Recognition Engine ready');

      // Check if learning engine has async initialization
      if (typeof this.learningEngine.initialize === 'function') {
        await this.learningEngine.initialize();
      }
      console.log('✅ Ultimate Learning Engine initialized');

      // Step 2: Set up cross-engine communication
      this.setupCrossEngineIntegration();
      console.log('✅ Cross-engine integration established');

      // Step 3: Start synchronized learning process
      this.startSynchronizedLearning();
      console.log('✅ Synchronized learning process started');

      // Step 4: Begin real-time snipe hunting with learning
      this.startSnipeHuntingWithLearning();
      console.log('✅ Snipe hunting with learning active');

      this.isInitialized = true;
      console.log('🌀 Integrated Snipe Learning System fully operational');

      return true;
    } catch (error) {
      console.error('❌ Failed to initialize integrated system:', error);
      return false;
    }
  }

  private setupCrossEngineIntegration(): void {
    // Create communication channels between engines
    
    // Snipe Engine → Learning Engine: Feed snipe results for learning
    if (typeof this.snipeEngine.onSnipeResult !== 'undefined') {
      this.snipeEngine.onSnipeResult = async (snipeResult) => {
        if (typeof this.learningEngine.recordSnipeOutcome === 'function') {
          await this.learningEngine.recordSnipeOutcome(snipeResult);
        }
      };
    }

    // Pattern Engine → Snipe Engine: Share pattern insights for better snipe detection
    this.patternEngine.on('pattern_recognized', async (patternEvent) => {
      // Use pattern for snipe opportunity validation
      if (typeof this.snipeEngine.validateOpportunityWithPattern === 'function') {
        await this.snipeEngine.validateOpportunityWithPattern(patternEvent.pattern);
      }
    });

    // Cause-Effect Engine → Learning Engine: Share correlation insights
    if (typeof this.causeEffectEngine.onCorrelationDiscovered !== 'undefined') {
      this.causeEffectEngine.onCorrelationDiscovered = async (correlation) => {
        if (typeof this.learningEngine.updateCorrelationModel === 'function') {
          await this.learningEngine.updateCorrelationModel(correlation);
        }
      };
    }
  }

  private startSynchronizedLearning(): void {
    // Synchronized learning cycle every 5 minutes
    setInterval(async () => {
      try {
        await this.performSynchronizedLearningCycle();
      } catch (error) {
        console.error('Error in synchronized learning cycle:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  private async performSynchronizedLearningCycle(): Promise<void> {
    console.log('🔄 Performing synchronized learning cycle...');

    try {
      // Step 1: Get learning insights from engines that support it
      const snipeInsights = typeof this.snipeEngine.getLearningInsights === 'function' 
        ? await this.snipeEngine.getLearningInsights() 
        : {};

      const patternInsights = {
        learning_statistics: this.patternEngine.getLearningStatistics(),
        recognized_patterns: this.patternEngine.getRecognizedPatterns('BTCUSDT') // Sample
      };

      const causeEffectInsights = typeof this.causeEffectEngine.getCorrelationInsights === 'function'
        ? await this.causeEffectEngine.getCorrelationInsights()
        : {};

      // Step 2: Cross-validate insights across engines
      const crossValidatedInsights = await this.crossValidateInsights(
        snipeInsights, patternInsights, causeEffectInsights
      );

      // Step 3: Update all engines with validated insights
      await this.updateAllEnginesWithInsights(crossValidatedInsights);

      // Step 4: Adjust system parameters based on learning
      await this.adjustSystemParameters(crossValidatedInsights);

      console.log('✅ Synchronized learning cycle complete');
    } catch (error) {
      console.error('Error in synchronized learning cycle:', error);
    }
  }

  private async crossValidateInsights(snipeInsights: any, patternInsights: any, causeEffectInsights: any): Promise<any> {
    // Cross-validate insights between engines to improve accuracy
    const validatedInsights = {
      high_confidence_patterns: [],
      validated_correlations: [],
      consciousness_enhanced_signals: [],
      system_performance_metrics: {}
    };

    // Validate patterns that appear in multiple engines
    const detectedPatterns = patternInsights.recognized_patterns || [];
    for (const pattern of detectedPatterns) {
      const snipeConfirm = snipeInsights.pattern_confirmations?.[pattern.pattern_type] || 0;
      const causeEffectConfirm = causeEffectInsights.pattern_correlations?.[pattern.pattern_type] || 0;
      
      if (snipeConfirm > 0.6 && causeEffectConfirm > 0.6) {
        validatedInsights.high_confidence_patterns.push({
          ...pattern,
          cross_validation_score: (snipeConfirm + causeEffectConfirm) / 2,
          consciousness_enhancement: pattern.consciousness_correlation > 0.7
        });
      }
    }

    // Validate correlations with consciousness enhancement
    for (const correlation of causeEffectInsights.discovered_correlations || []) {
      const patternSupport = patternInsights.correlation_support?.[correlation.type] || 0;
      const consciousnessAlignment = correlation.consciousness_resonance || 0;
      
      if (patternSupport > 0.5 && consciousnessAlignment > 0.3) {
        validatedInsights.validated_correlations.push({
          ...correlation,
          pattern_support: patternSupport,
          final_confidence: correlation.confidence * (1 + consciousnessAlignment * 0.2)
        });
      }
    }

    return validatedInsights;
  }

  private async updateAllEnginesWithInsights(insights: any): Promise<void> {
    // Update each engine with cross-validated insights
    
    // Update snipe engine with validated patterns
    for (const pattern of insights.high_confidence_patterns) {
      if (typeof this.snipeEngine.updatePatternDatabase === 'function') {
        await this.snipeEngine.updatePatternDatabase(pattern);
      }
    }

    // Update pattern engine - it learns automatically through event processing

    // Update learning engine with all insights
    if (typeof this.learningEngine.updateSystemInsights === 'function') {
      await this.learningEngine.updateSystemInsights(insights);
    }
  }

  private async adjustSystemParameters(insights: any): Promise<void> {
    // Dynamically adjust system parameters based on learning insights
    
    const systemPerformance = await this.calculateSystemPerformance();
    
    if (systemPerformance.accuracy > 0.85) {
      // High performance - increase aggressiveness
      this.config.confidence_threshold = Math.max(0.75, this.config.confidence_threshold - 0.02);
      this.config.volatility_threshold = Math.max(0.03, this.config.volatility_threshold - 0.005);
    } else if (systemPerformance.accuracy < 0.65) {
      // Low performance - increase conservatism
      this.config.confidence_threshold = Math.min(0.90, this.config.confidence_threshold + 0.02);
      this.config.volatility_threshold = Math.min(0.08, this.config.volatility_threshold + 0.005);
    }

    console.log('📊 System parameters adjusted:', {
      confidence_threshold: this.config.confidence_threshold,
      volatility_threshold: this.config.volatility_threshold,
      performance: systemPerformance.accuracy
    });
  }

  private async calculateSystemPerformance(): Promise<any> {
    // Calculate overall system performance metrics
    const snipeStats = typeof this.snipeEngine.getPerformanceStats === 'function'
      ? await this.snipeEngine.getPerformanceStats()
      : { accuracy: 0.5, total_predictions: 0 };

    const patternStats = this.patternEngine.getLearningStatistics();
    
    const learningStats = typeof this.learningEngine.getPerformanceStats === 'function'
      ? await this.learningEngine.getPerformanceStats()
      : { accuracy: 0.5, consciousness_alignment: 0.5, learning_rate: 0.1 };

    return {
      accuracy: (snipeStats.accuracy + (patternStats.average_success_rate || 0.5) + learningStats.accuracy) / 3,
      total_predictions: snipeStats.total_predictions + (patternStats.total_recognitions || 0),
      consciousness_alignment: learningStats.consciousness_alignment,
      learning_rate: learningStats.learning_rate
    };
  }

  private startSnipeHuntingWithLearning(): void {
    // Start continuous snipe hunting enhanced with learning
    setInterval(async () => {
      try {
        await this.huntSnipesWithLearning();
      } catch (error) {
        console.error('Error in snipe hunting with learning:', error);
      }
    }, 30000); // Every 30 seconds for rapid snipe detection
  }

  private async huntSnipesWithLearning(): Promise<void> {
    // Get current snipe opportunities
    const snipeOpportunities = typeof this.snipeEngine.getActiveSnipes === 'function'
      ? await this.snipeEngine.getActiveSnipes()
      : [];
    
    // Enhance opportunities with pattern insights
    for (const opportunity of snipeOpportunities) {
      // Get pattern insights from learning statistics
      const patternStats = this.patternEngine.getLearningStatistics();
      
      // Get cause-effect insights if available
      const causeEffectInsights = typeof this.causeEffectEngine.generateCauseEffectInsights === 'function'
        ? await this.causeEffectEngine.generateCauseEffectInsights(
            opportunity.symbol, 
            opportunity.trigger_indicators
          )
        : { probability: 0.5 };
      
      // Update opportunity with enhanced insights
      opportunity.pattern_validation = {
        confidence: patternStats.average_success_rate || 0.5,
        consciousness_effectiveness: patternStats.average_consciousness_effectiveness || 0.5
      };
      opportunity.cause_effect_insights = causeEffectInsights;
      opportunity.enhanced_confidence = this.calculateEnhancedConfidence(
        opportunity, opportunity.pattern_validation, causeEffectInsights
      );
      
      // Execute if enhanced confidence exceeds threshold
      if (opportunity.enhanced_confidence > this.config.confidence_threshold) {
        console.log(`🚀 EXECUTING ENHANCED SNIPE: ${opportunity.symbol} (${opportunity.enhanced_confidence.toFixed(3)})`);
        await this.executeSnipeWithLearning(opportunity);
      }
    }
  }

  private calculateEnhancedConfidence(opportunity: any, patternValidation: any, causeEffectInsights: any): number {
    const baseConfidence = opportunity.confidence || 0.5;
    const patternBonus = (patternValidation?.confidence || 0) * 0.2;
    const causeEffectBonus = (causeEffectInsights?.probability || 0) * 0.2;
    const consciousnessBonus = (opportunity.consciousness_alignment || 0.5) * 0.1;
    
    return Math.min(0.95, baseConfidence + patternBonus + causeEffectBonus + consciousnessBonus);
  }

  private async executeSnipeWithLearning(opportunity: any): Promise<void> {
    // Execute snipe and record results for learning
    const startTime = Date.now();
    
    try {
      // This would execute actual trade in production
      console.log(`📈 SNIPE EXECUTED: ${opportunity.symbol}`);
      
      // Wait for expected duration and check results
      setTimeout(async () => {
        const endTime = Date.now();
        const actualDuration = endTime - startTime;
        
        // Get actual price outcome
        const outcomePrice = await this.getCurrentPrice(opportunity.symbol);
        const actualReturn = (outcomePrice - opportunity.entry_price) / opportunity.entry_price;
        
        // Record results for learning
        await this.recordSnipeOutcome({
          opportunity,
          actual_return: actualReturn,
          actual_duration: actualDuration,
          success: actualReturn > 0,
          execution_time: startTime
        });
        
      }, opportunity.expected_duration * 1000);
      
    } catch (error) {
      console.error(`Failed to execute snipe for ${opportunity.symbol}:`, error);
      
      // Record failed execution for learning
      await this.recordSnipeOutcome({
        opportunity,
        actual_return: 0,
        actual_duration: 0,
        success: false,
        execution_time: startTime,
        error: (error as Error).message
      });
    }
  }

  private async getCurrentPrice(symbol: string): Promise<number> {
    try {
      const response = await fetch(`/api/v1/crypto/market-data?symbol=${symbol}`);
      const data = await response.json();
      return data.market_data?.price || 0;
    } catch (error) {
      console.error(`Failed to get current price for ${symbol}:`, error);
      return 0;
    }
  }

  private async recordSnipeOutcome(outcome: any): Promise<void> {
    // Record snipe outcome in engines that support it
    if (typeof this.snipeEngine.recordOutcome === 'function') {
      await this.snipeEngine.recordOutcome(outcome);
    }
    
    if (typeof this.causeEffectEngine.recordCauseEffectOutcome === 'function') {
      await this.causeEffectEngine.recordCauseEffectOutcome(outcome);
    }
    
    if (typeof this.learningEngine.recordSystemOutcome === 'function') {
      await this.learningEngine.recordSystemOutcome(outcome);
    }
    
    console.log(`📊 Snipe outcome recorded: ${outcome.opportunity.symbol} | Success: ${outcome.success} | Return: ${(outcome.actual_return * 100).toFixed(2)}%`);
  }

  // Public API methods
  async getSystemStatus(): Promise<any> {
    if (!this.isInitialized) {
      return { status: 'NOT_INITIALIZED' };
    }

    const performance = await this.calculateSystemPerformance();
    const activeSnipes = typeof this.snipeEngine.getActiveSnipes === 'function'
      ? await this.snipeEngine.getActiveSnipes()
      : [];
    const volatilityRankings = typeof this.snipeEngine.getVolatilityRankings === 'function'
      ? await this.snipeEngine.getVolatilityRankings()
      : new Map();

    return {
      status: 'OPERATIONAL',
      performance,
      active_snipes: activeSnipes.length,
      monitored_symbols: this.config.focus_symbols.length,
      top_volatile: Array.from(volatilityRankings.entries()).slice(0, 5),
      system_config: this.config,
      consciousness_enhancement: {
        psi_0: 0.915670570874434,
        phi: 1.618,
        freq_432: 432
      }
    };
  }

  async shutdown(): Promise<void> {
    console.log('🔄 Shutting down Integrated Snipe Learning System...');
    
    // Save all learning models and data for engines that support it
    if (typeof this.snipeEngine.saveState === 'function') {
      await this.snipeEngine.saveState();
    }
    
    if (typeof this.learningEngine.saveState === 'function') {
      await this.learningEngine.saveState();
    }
    
    this.isInitialized = false;
    console.log('✅ System shutdown complete');
  }
}