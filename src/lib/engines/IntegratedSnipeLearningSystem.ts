import { HighVelocitySnipeEngine, MarketIndicator, SnipeOpportunity } from './HighVelocitySnipeEngine';
import { CauseEffectAnalysisEngine } from './CauseEffectAnalysisEngine';
import { PatternRecognitionEngine } from './PatternRecognitionEngine';
import { UltimateLearningEngine } from './UltimateLearningEngine';

export interface SnipeLearningSystemConfig {
  focus_symbols: string[];
  volatility_threshold: number;
  confidence_threshold: number;
  max_snipe_duration: number;
  learning_sample_rate: number;
}

// Enhanced typing interfaces
export interface ValidatedPattern {
  type: string;
  confidence: number;
  cross_validation_score: number;
  [key: string]: any;
}

export interface ValidatedCorrelation {
  type: string;
  confidence: number;
  pattern_support: number;
  final_confidence: number;
  [key: string]: any;
}

export interface SystemPerformanceMetrics {
  accuracy: number;
  learning_rate: number;
  total_predictions: number;
}

export interface CrossValidatedInsights {
  high_confidence_patterns: ValidatedPattern[];
  validated_correlations: ValidatedCorrelation[];
  system_performance_metrics: SystemPerformanceMetrics;
}

// Extended interface for enhanced snipe opportunities with learning data
export interface EnhancedSnipeOpportunity extends SnipeOpportunity {
  pattern_validation?: any;
  cause_effect_insights?: any;
  enhanced_confidence?: number;
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

      // Step 1: Initialize all engines
      await this.snipeEngine.initializeSnipeEngine();
      console.log('✅ High-Velocity Snipe Engine initialized');

      await this.patternEngine.initialize();
      console.log('✅ Pattern Recognition Engine initialized');

      await this.learningEngine.initialize();
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
    
    // Snipe Engine → Cause-Effect Engine: Feed snipe results for learning
    this.snipeEngine.onSnipeResult = async (snipeResult) => {
      await this.learningEngine.recordSnipeOutcome(snipeResult);
    };

    // Pattern Engine → Snipe Engine: Share pattern insights for better snipe detection
    this.patternEngine.onPatternDetected = async (pattern) => {
      // Use pattern for snipe opportunity validation
      await this.snipeEngine.validateOpportunityWithPattern(pattern);
    };

    // Cause-Effect Engine → Learning Engine: Share correlation insights
    this.causeEffectEngine.onCorrelationDiscovered = async (correlation) => {
      await this.learningEngine.updateCorrelationModel(correlation);
    };
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

    // Step 1: Get learning insights from all engines
    const snipeInsights = await this.snipeEngine.getLearningInsights();
    const patternInsights = await this.patternEngine.getPatternInsights();
    const causeEffectInsights = await this.causeEffectEngine.getCorrelationInsights();

    // Step 2: Cross-validate insights across engines
    const crossValidatedInsights = await this.crossValidateInsights(
      snipeInsights, patternInsights, causeEffectInsights
    );

    // Step 3: Update all engines with validated insights
    await this.updateAllEnginesWithInsights(crossValidatedInsights);

    // Step 4: Adjust system parameters based on learning
    await this.adjustSystemParameters(crossValidatedInsights);

    console.log('✅ Synchronized learning cycle complete');
  }

  private async crossValidateInsights(snipeInsights: any, patternInsights: any, causeEffectInsights: any): Promise<CrossValidatedInsights> {
    // Cross-validate insights between engines to improve accuracy
    const validatedInsights: CrossValidatedInsights = {
      high_confidence_patterns: [] as ValidatedPattern[],
      validated_correlations: [] as ValidatedCorrelation[],
      system_performance_metrics: {
        accuracy: 0,
        learning_rate: 0,
        total_predictions: 0
      } as SystemPerformanceMetrics
    };

    // Validate patterns that appear in multiple engines
    for (const pattern of patternInsights.detected_patterns || []) {
      const snipeConfirm = snipeInsights.pattern_confirmations?.[pattern.type] || 0;
      const causeEffectConfirm = causeEffectInsights.pattern_correlations?.[pattern.type] || 0;
      
      if (snipeConfirm > 0.6 && causeEffectConfirm > 0.6) {
        const validatedPattern: ValidatedPattern = {
          ...pattern,
          cross_validation_score: (snipeConfirm + causeEffectConfirm) / 2
        };
        validatedInsights.high_confidence_patterns.push(validatedPattern);
      }
    }

    // Validate correlations
    for (const correlation of causeEffectInsights.discovered_correlations || []) {
      const patternSupport = patternInsights.correlation_support?.[correlation.type] || 0;
      
      if (patternSupport > 0.5) {
        const validatedCorrelation: ValidatedCorrelation = {
          ...correlation,
          pattern_support: patternSupport,
          final_confidence: correlation.confidence
        };
        validatedInsights.validated_correlations.push(validatedCorrelation);
      }
    }

    // Calculate system performance metrics
    validatedInsights.system_performance_metrics = await this.calculateSystemPerformance();

    return validatedInsights;
  }

  private async updateAllEnginesWithInsights(insights: CrossValidatedInsights): Promise<void> {
    // Update each engine with cross-validated insights
    
    // Update snipe engine with validated patterns
    for (const pattern of insights.high_confidence_patterns) {
      await this.snipeEngine.updatePatternDatabase(pattern);
    }

    // Update pattern engine with validated correlations
    for (const correlation of insights.validated_correlations) {
      await this.patternEngine.updateCorrelationModel(correlation);
    }

    // Update learning engine with all insights
    await this.learningEngine.updateSystemInsights(insights);
  }

  private async adjustSystemParameters(insights: CrossValidatedInsights): Promise<void> {
    // Dynamically adjust system parameters based on learning insights
    
    const systemPerformance = insights.system_performance_metrics;
    
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

  private async calculateSystemPerformance(): Promise<SystemPerformanceMetrics> {
    // Calculate overall system performance metrics
    const snipeStats = await this.snipeEngine.getPerformanceStats();
    const patternStats = await this.patternEngine.getPerformanceStats();
    const learningStats = await this.learningEngine.getPerformanceStats();

    return {
      accuracy: (snipeStats.accuracy + patternStats.accuracy + learningStats.accuracy) / 3,
      total_predictions: snipeStats.total_predictions + patternStats.total_predictions,
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

  // Helper method to convert string[] to MarketIndicator[]
  private convertTriggerIndicatorsToMarketIndicators(triggerIndicators: string[], confidence: number = 0.8): MarketIndicator[] {
    const currentTime = new Date();
    
    return triggerIndicators.map((indicatorType, index) => ({
      indicator_type: indicatorType,
      value: confidence + (Math.random() - 0.5) * 0.2, // Add slight variation around confidence
      timestamp: new Date(currentTime.getTime() + index * 100), // Slight time offsets
      strength: confidence
    }));
  }

  private async huntSnipesWithLearning(): Promise<void> {
    // Get current snipe opportunities
    const snipeOpportunities = await this.snipeEngine.getActiveSnipes();
    
    // Enhance opportunities with pattern and cause-effect insights
    for (const opportunity of snipeOpportunities) {
      // Create enhanced opportunity with additional properties
      const enhancedOpportunity: EnhancedSnipeOpportunity = { ...opportunity };
      
      // Get pattern validation
      const patternValidation = await this.patternEngine.validateOpportunity(opportunity);
      
      // Convert string[] to MarketIndicator[] for type safety
      const triggerIndicatorsAsMarketIndicators = this.convertTriggerIndicatorsToMarketIndicators(
        opportunity.trigger_indicators,
        opportunity.confidence
      );
      
      // Get cause-effect insights with proper typing
      const causeEffectInsights = await this.causeEffectEngine.generateCauseEffectInsights(
        opportunity.symbol, 
        triggerIndicatorsAsMarketIndicators
      );
      
      // Update enhanced opportunity with insights
      enhancedOpportunity.pattern_validation = patternValidation;
      enhancedOpportunity.cause_effect_insights = causeEffectInsights;
      enhancedOpportunity.enhanced_confidence = this.calculateEnhancedConfidence(
        enhancedOpportunity, patternValidation, causeEffectInsights
      );
      
      // Execute if enhanced confidence exceeds threshold
      if (enhancedOpportunity.enhanced_confidence > this.config.confidence_threshold) {
        console.log(`🚀 EXECUTING ENHANCED SNIPE: ${enhancedOpportunity.symbol} (${enhancedOpportunity.enhanced_confidence.toFixed(3)})`);
        await this.executeSnipeWithLearning(enhancedOpportunity);
      }
    }
  }

  private calculateEnhancedConfidence(opportunity: any, patternValidation: any, causeEffectInsights: any): number {
    const baseConfidence = opportunity.confidence;
    const patternBonus = (patternValidation?.confidence || 0) * 0.2;
    const causeEffectBonus = (causeEffectInsights?.probability || 0) * 0.2;
    
    return Math.min(0.95, baseConfidence + patternBonus + causeEffectBonus);
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
        error: error instanceof Error ? error.message : 'Unknown error'
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
    // Record snipe outcome in all engines for learning
    await this.snipeEngine.recordOutcome(outcome);
    await this.patternEngine.recordPatternOutcome(outcome);
    await this.causeEffectEngine.recordCauseEffectOutcome(outcome);
    await this.learningEngine.recordSystemOutcome(outcome);
    
    console.log(`📊 Snipe outcome recorded: ${outcome.opportunity.symbol} | Success: ${outcome.success} | Return: ${(outcome.actual_return * 100).toFixed(2)}%`);
  }

  // Public API methods
  async getSystemStatus(): Promise<any> {
    if (!this.isInitialized) {
      return { status: 'NOT_INITIALIZED' };
    }

    const performance = await this.calculateSystemPerformance();
    const activeSnipes = await this.snipeEngine.getActiveSnipes();
    const volatilityRankings = await this.snipeEngine.getVolatilityRankings();

    return {
      status: 'OPERATIONAL',
      performance,
      active_snipes: activeSnipes.length,
      monitored_symbols: this.config.focus_symbols.length,
      top_volatile: Array.from(volatilityRankings.entries()).slice(0, 5),
      system_config: this.config
    };
  }

  async shutdown(): Promise<void> {
    console.log('🔄 Shutting down Integrated Snipe Learning System...');
    
    // Save all learning models and data
    await this.snipeEngine.saveState();
    await this.patternEngine.saveModel();
    await this.learningEngine.saveState();
    
    this.isInitialized = false;
    console.log('✅ System shutdown complete');
  }
}