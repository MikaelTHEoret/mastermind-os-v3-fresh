// Learning System Configuration
export const LearningSystemConfig = {
  // Learning Parameters
  PATTERN_RECOGNITION: {
    MIN_PATTERN_LENGTH: 5,
    MAX_PATTERN_LENGTH: 50,
    CONFIDENCE_THRESHOLD: 0.7,
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
    MODEL_SAVE_INTERVAL: 3600000, // 1 hour
    PERFORMANCE_WINDOW: 1000 // Keep last 1000 predictions for performance calculation
  },

  // Risk Management
  RISK_MANAGEMENT: {
    MAX_PREDICTION_CONFIDENCE: 0.95,
    MIN_PREDICTION_CONFIDENCE: 0.3,
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

// Standard Utility Functions
export const LearningUtils = {
  calculateConfidence: (predictions: number[], actual: number[]): number => {
    if (predictions.length !== actual.length || predictions.length === 0) return 0;
    
    const errors = predictions.map((pred, i) => Math.abs(pred - actual[i]));
    const avgError = errors.reduce((sum, err) => sum + err, 0) / errors.length;
    
    return Math.max(0, 1 - avgError);
  },

  calculateAccuracy: (predicted: boolean[], actual: boolean[]): number => {
    if (predicted.length !== actual.length || predicted.length === 0) return 0;
    
    const correct = predicted.filter((pred, i) => pred === actual[i]).length;
    return correct / predicted.length;
  },

  normalizeValue: (value: number, min: number, max: number): number => {
    return (value - min) / (max - min);
  },

  calculateVolatility: (prices: number[]): number => {
    if (prices.length < 2) return 0;
    
    const returns = prices.slice(1).map((price, i) => 
      (price - prices[i]) / prices[i]
    );
    
    const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => 
      sum + Math.pow(ret - avgReturn, 2), 0
    ) / returns.length;
    
    return Math.sqrt(variance);
  }
};

export default LearningSystemConfig;