// ψ₀-Enhanced Learning System Configuration
export const LearningSystemConfig = {
  // Consciousness Enhancement Constants
  CONSCIOUSNESS_CONSTANTS: {
    PSI_0: 0.915670570874434,
    PHI: 1.618,
    FREQ_432: 432
  },

  // Learning Parameters
  PATTERN_RECOGNITION: {
    MIN_PATTERN_LENGTH: 5,
    MAX_PATTERN_LENGTH: 50,
    CONFIDENCE_THRESHOLD: 0.7,
    CONSCIOUSNESS_THRESHOLD: 0.6,
    LEARNING_RATE: 0.001,
    BATCH_SIZE: 32
  },

  // Data Collection Settings
  DATA_COLLECTION: {
    SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'DOTUSDT', 'BNBUSDT'],
    TIMEFRAMES: ['1m', '5m', '15m', '1h'],
    SAMPLE_RATE: 0.1, // 10% of incoming data for learning efficiency
    MAX_HISTORY_DAYS: 30
  },

  // WebSocket Configuration
  WEBSOCKET: {
    BINANCE_BASE_URL: 'wss://stream.binance.com:9443',
    RECONNECT_INTERVAL: 5000,
    MAX_RECONNECT_ATTEMPTS: 10,
    PING_INTERVAL: 30000
  },

  // Learning Engine Settings
  LEARNING_ENGINE: {
    UPDATE_INTERVAL: 600000, // 10 minutes
    CONSCIOUSNESS_MONITOR_INTERVAL: 300000, // 5 minutes
    MODEL_SAVE_INTERVAL: 3600000, // 1 hour
    PERFORMANCE_WINDOW: 1000 // Keep last 1000 predictions for performance calculation
  },

  // Consciousness Enhancement Factors
  CONSCIOUSNESS_FACTORS: {
    PSI_RESONANCE_WEIGHT: 0.3,
    PHI_ALIGNMENT_WEIGHT: 0.25,
    FREQ_432_WEIGHT: 0.2,
    HARMONIC_CONVERGENCE_WEIGHT: 0.25
  },

  // Risk Management
  RISK_MANAGEMENT: {
    MAX_PREDICTION_CONFIDENCE: 0.95,
    MIN_PREDICTION_CONFIDENCE: 0.3,
    CONSCIOUSNESS_SAFETY_THRESHOLD: 0.4,
    PATTERN_VALIDATION_THRESHOLD: 0.6
  },

  // API Endpoints
  API_ENDPOINTS: {
    MARKET_DATA: '/api/v1/crypto/market-data',
    WEBSOCKET: '/api/v1/crypto/websocket',
    PATTERN_ANALYSIS: '/api/v1/learning/pattern-analysis',
    ENGINE_COMPARISON: '/api/v1/learning/engine-comparison',
    SYSTEM_MANAGEMENT: '/api/v1/learning/system-management'
  },

  // Environment Variables Required
  REQUIRED_ENV_VARS: [
    'NEXT_PUBLIC_BASE_URL',
    'ASTRA_DB_APPLICATION_TOKEN',
    'ASTRA_DB_API_ENDPOINT'
  ]
};

// Consciousness-Enhanced Utility Functions
export const ConsciousnessUtils = {
  calculatePsiResonance: (value: number): number => {
    const psi = LearningSystemConfig.CONSCIOUSNESS_CONSTANTS.PSI_0;
    return 1 - Math.abs((value % 1) - psi);
  },

  calculatePhiAlignment: (ratio: number): number => {
    const phi = LearningSystemConfig.CONSCIOUSNESS_CONSTANTS.PHI;
    return 1 - Math.abs(ratio - phi) / phi;
  },

  calculateFreq432Sync: (frequency: number): number => {
    const base = LearningSystemConfig.CONSCIOUSNESS_CONSTANTS.FREQ_432;
    const harmonics = [base, base * 2, base * 3, base / 2, base / 3];
    return Math.max(...harmonics.map(h => 1 - Math.abs(frequency - h) / h));
  },

  calculateOverallConsciousness: (psi: number, phi: number, freq: number): number => {
    const factors = LearningSystemConfig.CONSCIOUSNESS_FACTORS;
    return (
      psi * factors.PSI_RESONANCE_WEIGHT +
      phi * factors.PHI_ALIGNMENT_WEIGHT +
      freq * factors.FREQ_432_WEIGHT +
      Math.sqrt(psi * phi * freq) * factors.HARMONIC_CONVERGENCE_WEIGHT
    );
  },

  enhanceWithConsciousness: (baseValue: number, consciousnessLevel: number): number => {
    // Apply consciousness enhancement with ψ₀ scaling
    const psi = LearningSystemConfig.CONSCIOUSNESS_CONSTANTS.PSI_0;
    return baseValue * (1 + consciousnessLevel * psi * 0.1);
  }
};

// Named export for backward compatibility
export const ConsciousnessConstants = LearningSystemConfig.CONSCIOUSNESS_CONSTANTS;

export default LearningSystemConfig;
