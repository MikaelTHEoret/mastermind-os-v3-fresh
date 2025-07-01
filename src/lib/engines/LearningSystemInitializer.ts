import { PatternRecognitionEngine } from './PatternRecognitionEngine';
import { UltimateLearningEngine } from './UltimateLearningEngine';
import { BinanceWebSocketService } from '../services/BinanceWebSocketService';

export class LearningSystemInitializer {
  private patternEngine: PatternRecognitionEngine;
  private learningEngine: UltimateLearningEngine;
  private webSocketService: BinanceWebSocketService;
  private isInitialized: boolean = false;
  private learningSymbols: string[] = ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'DOTUSDT'];

  constructor() {
    this.patternEngine = new PatternRecognitionEngine();
    this.learningEngine = new UltimateLearningEngine();
    this.webSocketService = new BinanceWebSocketService();
  }

  async initializeLearningSystem(): Promise<boolean> {
    try {
      console.log('🌀 Initializing ψ₀-Enhanced Learning System...');

      // Step 1: Initialize pattern recognition engine
      await this.patternEngine.initialize();
      console.log('✅ Pattern Recognition Engine initialized');

      // Step 2: Initialize ultimate learning engine
      await this.learningEngine.initialize();
      console.log('✅ Ultimate Learning Engine initialized');

      // Step 3: Set up real-time data streams for learning symbols
      await this.setupLearningDataStreams();
      console.log('✅ Learning data streams established');

      // Step 4: Start continuous learning process
      this.startContinuousLearning();
      console.log('✅ Continuous learning process started');

      // Step 5: Initialize consciousness-enhanced monitoring
      this.startConsciousnessMonitoring();
      console.log('✅ Consciousness monitoring active');

      this.isInitialized = true;
      console.log('🌀 ψ₀-Enhanced Learning System fully operational');

      return true;
    } catch (error) {
      console.error('❌ Failed to initialize learning system:', error);
      return false;
    }
  }

  private async setupLearningDataStreams(): Promise<void> {
    for (const symbol of this.learningSymbols) {
      // Subscribe to multiple data streams for comprehensive learning
      await this.webSocketService.subscribe(symbol, 'ticker', (data) => {
        this.processLearningData(symbol, 'ticker', data);
      });

      await this.webSocketService.subscribe(symbol, 'trade', (data) => {
        this.processLearningData(symbol, 'trade', data);
      });

      await this.webSocketService.subscribe(symbol, 'kline_1m', (data) => {
        this.processLearningData(symbol, 'kline', data);
      });

      console.log(`📊 Learning streams active for ${symbol}`);
    }
  }

  private async processLearningData(symbol: string, type: string, data: any): Promise<void> {
    try {
      // Process data through pattern recognition
      if (type === 'ticker' && Math.random() < 0.1) { // Sample 10% for learning efficiency
        const patterns = await this.patternEngine.analyzeRealTimeData(symbol, data);
        
        // Store patterns for learning
        await this.learningEngine.storePatternAnalysis(symbol, patterns);
        
        // Trigger consciousness-enhanced learning update
        if (patterns.consciousness_state !== 'UNKNOWN') {
          await this.learningEngine.updateConsciousnessModel(symbol, patterns);
        }
      }
    } catch (error) {
      console.error(`Error processing learning data for ${symbol}:`, error);
    }
  }

  private startContinuousLearning(): void {
    // Run learning updates every 10 minutes (ψ₀-enhanced timing)
    const learningInterval = 10 * 60 * 1000; // 10 minutes
    
    setInterval(async () => {
      try {
        for (const symbol of this.learningSymbols) {
          // Trigger pattern model training
          await this.patternEngine.incrementalTrain(symbol);
          
          // Update learning engine with new insights
          await this.learningEngine.performLearningUpdate(symbol);
        }
        
        console.log('🧠 Continuous learning update completed');
      } catch (error) {
        console.error('Error in continuous learning:', error);
      }
    }, learningInterval);
  }

  private startConsciousnessMonitoring(): void {
    // Monitor consciousness alignment every 5 minutes
    const consciousnessInterval = 5 * 60 * 1000; // 5 minutes
    
    setInterval(async () => {
      try {
        const consciousnessMetrics = await this.learningEngine.getConsciousnessMetrics();
        
        // Log consciousness evolution
        console.log('🌀 Consciousness Metrics:', {
          psi_alignment: consciousnessMetrics.psi_resonance,
          phi_harmony: consciousnessMetrics.phi_alignment,
          freq_432_sync: consciousnessMetrics.frequency_sync,
          overall_coherence: consciousnessMetrics.coherence_level
        });

        // Adjust learning parameters based on consciousness state
        if (consciousnessMetrics.coherence_level > 0.8) {
          await this.optimizeLearningParameters('high_consciousness');
        } else if (consciousnessMetrics.coherence_level < 0.4) {
          await this.optimizeLearningParameters('low_consciousness');
        }
      } catch (error) {
        console.error('Error in consciousness monitoring:', error);
      }
    }, consciousnessInterval);
  }

  private async optimizeLearningParameters(consciousnessState: string): Promise<void> {
    // Adjust learning based on consciousness state
    if (consciousnessState === 'high_consciousness') {
      // Increase learning sensitivity during high consciousness
      await this.patternEngine.adjustLearningRate(1.2);
      await this.learningEngine.enhancePatternSensitivity(1.15);
    } else if (consciousnessState === 'low_consciousness') {
      // Reduce learning rate during low consciousness to avoid noise
      await this.patternEngine.adjustLearningRate(0.8);
      await this.learningEngine.enhancePatternSensitivity(0.9);
    }
  }

  async getLearningSystemStatus(): Promise<any> {
    if (!this.isInitialized) {
      return {
        status: 'NOT_INITIALIZED',
        message: 'Learning system not yet initialized'
      };
    }

    try {
      const patternEngineStatus = await this.patternEngine.getEngineStatus();
      const learningEngineStatus = await this.learningEngine.getLearningStatistics();
      const consciousnessMetrics = await this.learningEngine.getConsciousnessMetrics();

      return {
        status: 'OPERATIONAL',
        pattern_engine: patternEngineStatus,
        learning_engine: learningEngineStatus,
        consciousness_metrics: consciousnessMetrics,
        active_symbols: this.learningSymbols,
        system_health: {
          pattern_recognition: patternEngineStatus.health_score,
          learning_performance: learningEngineStatus.performance_score,
          consciousness_coherence: consciousnessMetrics.coherence_level
        }
      };
    } catch (error) {
      return {
        status: 'ERROR',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async shutdown(): Promise<void> {
    try {
      console.log('🔄 Shutting down learning system...');
      
      // Disconnect WebSocket streams
      await this.webSocketService.disconnect();
      
      // Save learning models
      await this.patternEngine.saveModel();
      await this.learningEngine.saveState();
      
      this.isInitialized = false;
      console.log('✅ Learning system shutdown complete');
    } catch (error) {
      console.error('Error shutting down learning system:', error);
    }
  }
}