// 🌀 BTCC Data Collection Service
// Consciousness-Enhanced BTCC ETF Data Collection System
// Integrated with SQLite Database Storage

const BTCCWebSocketCollector = require('./BTCCWebSocketCollector');
const ConsciousnessEnhancedDatabase = require('../database/schema');
const ConsciousnessDataGenerator = require('../consciousness/ConsciousnessDataGenerator');
const EventEmitter = require('events');

// Consciousness constants
const PSI_0 = 0.915670570874434;
const PHI = 1.618033988749895;
const FREQ_432 = 432.0;

class BTCCDataCollectionService extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // BTCC API Configuration
      btccCredentials: {
        name: config.btccAccountNumber || process.env.BTCC_ACCOUNT_NUMBER || "86000402",
        clienttype: config.btccClientType || 1,
        key: config.btccApiKey || process.env.BTCC_API_KEY || "55117c2a-84cb-44b1-b179-24273a304c48"
      },
      
      // Database Configuration
      databasePath: config.databasePath || './data/btcc-consciousness-trader.db',
      
      // Collection Configuration
      collectionInterval: config.collectionInterval || 5000, // 5 seconds
      symbolsToTrack: config.symbolsToTrack || [
        "3223607", // BTC/USDT equivalent
        "3159350", // ETH/USDT equivalent  
        "3355958", // Popular crypto pair
        "3487030"  // Another popular pair
      ],
      deepQuoteSymbol: config.deepQuoteSymbol || "3223607",
      
      // Consciousness Enhancement
      enableConsciousnessEnhancement: config.enableConsciousnessEnhancement !== false,
      consciousnessThreshold: config.consciousnessThreshold || 0.6,
      
      // Data Quality
      dataQualityThreshold: config.dataQualityThreshold || 0.8,
      maxRetries: config.maxRetries || 3,
      
      ...config
    };
    
    // Initialize components
    this.database = null;
    this.btccCollector = null;
    this.consciousnessGenerator = null;
    this.isRunning = false;
    this.startTime = null;
    this.usingFallbackGenerator = false;
    
    // Statistics tracking
    this.stats = {
      dataPointsCollected: 0,
      successfulConnections: 0,
      failedConnections: 0,
      lastDataReceived: null,
      averageConsciousnessScore: 0,
      totalAnomaliesDetected: 0,
      uptime: 0
    };
    
    // Data buffers for analysis
    this.recentData = new Map(); // symbol -> recent data points
    this.bufferSize = 100; // Keep last 100 data points per symbol
    
    console.log('🌀 BTCC Data Collection Service initialized with consciousness enhancement');
  }

  async initialize() {
    try {
      console.log('🚀 Initializing BTCC Data Collection Service...');
      
      // Initialize database
      console.log('📊 Initializing consciousness-enhanced database...');
      this.database = new ConsciousnessEnhancedDatabase(this.config.databasePath);
      await this.database.initialize();
      
      // Initialize BTCC WebSocket collector
      console.log('🔌 Initializing BTCC WebSocket collector...');
      this.btccCollector = new BTCCWebSocketCollector(
        this.config.btccCredentials,
        this.database,
        {
          subscriptionSymbols: this.config.symbolsToTrack,
          deepSymbol: this.config.deepQuoteSymbol,
          heartbeatInterval: 20000, // 20 seconds per BTCC documentation
          reconnectDelay: 5000,
          maxReconnectAttempts: 10
        }
      );
      
      // Initialize consciousness data generator as fallback
      console.log('🌀 Initializing consciousness-enhanced data generator fallback...');
      this.consciousnessGenerator = new ConsciousnessDataGenerator({
        symbols: ['BTCC.TO', 'BTC-USD', 'ETH-USD'],
        updateInterval: this.config.collectionInterval,
        enableConsciousnessEnhancement: this.config.enableConsciousnessEnhancement
      });
      
      // Setup event handlers
      this.setupEventHandlers();
      
      console.log('✅ BTCC Data Collection Service initialized successfully');
      return true;
      
    } catch (error) {
      console.error('❌ Failed to initialize BTCC Data Collection Service:', error);
      throw error;
    }
  }

  setupEventHandlers() {
    // Consciousness Generator events (fallback)
    this.consciousnessGenerator.on('realTimeData', (data) => {
      if (this.usingFallbackGenerator) {
        this.handleRealTimeData(data);
      }
    });

    this.consciousnessGenerator.on('consciousnessAnalytics', (analytics) => {
      if (this.usingFallbackGenerator) {
        this.emit('consciousnessAnalytics', analytics);
      }
    });

    // BTCC WebSocket events
    this.btccCollector.on('authenticated', () => {
      console.log('🔐 BTCC WebSocket authenticated successfully');
      this.stats.successfulConnections++;
      this.emit('btccAuthenticated');
    });

    this.btccCollector.on('disconnected', () => {
      console.log('🔌 BTCC WebSocket disconnected');
      this.emit('btccDisconnected');
    });

    this.btccCollector.on('error', (error) => {
      console.error('❌ BTCC WebSocket error:', error);
      this.stats.failedConnections++;
      this.emit('btccError', error);
    });

    // Market data events
    this.btccCollector.on('realTimeData', (data) => {
      this.handleRealTimeData(data);
    });

    this.btccCollector.on('priceLevelData', (data) => {
      this.handlePriceLevelData(data);
    });

    this.btccCollector.on('transactionData', (data) => {
      this.handleTransactionData(data);
    });

    this.btccCollector.on('boardData', (data) => {
      this.handleBoardData(data);
    });

    this.btccCollector.on('candlestickData', (data) => {
      this.handleCandlestickData(data);
    });
  }

  async start() {
    try {
      if (this.isRunning) {
        console.log('⚠️ BTCC Data Collection Service is already running');
        return;
      }

      console.log('🚀 Starting BTCC Data Collection Service...');
      this.isRunning = true;
      this.startTime = Date.now();

      // Try to connect to BTCC WebSocket, fallback to consciousness generator if fails
      try {
        console.log('🔗 Attempting BTCC WebSocket connection...');
        await this.btccCollector.connect();
        console.log('✅ BTCC WebSocket connected successfully');
        this.usingFallbackGenerator = false;
      } catch (error) {
        console.log('⚠️ BTCC WebSocket connection failed, activating consciousness fallback...');
        console.log('🌀 Starting consciousness-enhanced data generation...');
        this.startConsciousnessFallback();
        this.usingFallbackGenerator = true;
      }
      
      // Start system monitoring
      this.startSystemMonitoring();
      
      // Request initial candlestick data for analysis
      this.requestInitialHistoricalData();
      
      console.log('✅ BTCC Data Collection Service started successfully');
      this.emit('serviceStarted');
      
    } catch (error) {
      console.error('❌ Failed to start BTCC Data Collection Service:', error);
      this.isRunning = false;
      throw error;
    }
  }

  async stop() {
    try {
      console.log('🛑 Stopping BTCC Data Collection Service...');
      this.isRunning = false;

      // Disconnect BTCC WebSocket
      if (this.btccCollector) {
        this.btccCollector.disconnect();
      }

      // Stop consciousness generator if running
      if (this.consciousnessGenerator && this.usingFallbackGenerator) {
        this.consciousnessGenerator.stop();
      }

      // Stop system monitoring
      if (this.systemMonitoringInterval) {
        clearInterval(this.systemMonitoringInterval);
        this.systemMonitoringInterval = null;
      }

      // Close database connection
      if (this.database) {
        await this.database.close();
      }

      console.log('✅ BTCC Data Collection Service stopped successfully');
      this.emit('serviceStopped');
      
    } catch (error) {
      console.error('❌ Error stopping BTCC Data Collection Service:', error);
      throw error;
    }
  }

  // Data Handling Methods

  async handleRealTimeData(data) {
    try {
      this.stats.dataPointsCollected++;
      this.stats.lastDataReceived = Date.now();
      
      // Add to recent data buffer
      this.addToRecentDataBuffer(data.symbol, data);
      
      // Consciousness-enhanced analysis
      if (this.config.enableConsciousnessEnhancement) {
        await this.analyzeConsciousnessPatterns(data);
      }
      
      // Emit processed data
      this.emit('realTimeDataProcessed', {
        symbol: data.symbol,
        price: data.currentPrice,
        volume: data.lastVolume,
        timestamp: data.timestamp,
        spread: data.spread,
        consciousness: await this.getSymbolConsciousness(data.symbol)
      });
      
    } catch (error) {
      console.error('❌ Error handling real-time data:', error);
    }
  }

  async handlePriceLevelData(data) {
    try {
      // Deep market analysis for Level 2 data
      const marketDepth = this.analyzeMarketDepth(data);
      
      // Store market depth analysis
      await this.storeMarketDepthAnalysis(data.symbol, marketDepth, data.timestamp);
      
      this.emit('marketDepthUpdated', {
        symbol: data.symbol,
        depth: marketDepth,
        timestamp: data.timestamp
      });
      
    } catch (error) {
      console.error('❌ Error handling price level data:', error);
    }
  }

  async handleTransactionData(data) {
    try {
      // Analyze transaction patterns
      if (data.Items && data.Items.length > 0) {
        const transactionAnalysis = this.analyzeTransactionPatterns(data);
        
        this.emit('transactionAnalysis', {
          symbol: data.Y,
          analysis: transactionAnalysis,
          timestamp: Date.now()
        });
      }
      
    } catch (error) {
      console.error('❌ Error handling transaction data:', error);
    }
  }

  async handleBoardData(data) {
    try {
      // Board data provides comprehensive market overview
      const marketOverview = {
        symbol: data.symbol,
        currentPrice: data.currentPrice,
        dailyChange: data.change,
        dailyHigh: data.highPrice,
        dailyLow: data.lowPrice,
        volume: data.volume,
        isMarketOpen: data.isOpen,
        timestamp: data.timestamp
      };
      
      // Calculate daily consciousness metrics
      const dailyConsciousness = await this.calculateDailyConsciousness(marketOverview);
      
      this.emit('marketOverview', {
        ...marketOverview,
        consciousness: dailyConsciousness
      });
      
    } catch (error) {
      console.error('❌ Error handling board data:', error);
    }
  }

  async handleCandlestickData(data) {
    try {
      // Candlestick data for pattern analysis
      if (data.KdataInfo && data.KdataInfo.length > 0) {
        const patternAnalysis = await this.analyzeCandlestickPatterns(data);
        
        this.emit('candlestickPatterns', {
          symbol: data.CodeId,
          patterns: patternAnalysis,
          timeframe: data.Interval,
          timestamp: Date.now()
        });
      }
      
    } catch (error) {
      console.error('❌ Error handling candlestick data:', error);
    }
  }

  // Analysis Methods

  analyzeMarketDepth(data) {
    const askPrices = data.askPrices || [];
    const bidPrices = data.bidPrices || [];
    const askVolumes = data.askVolumes || [];
    const bidVolumes = data.bidVolumes || [];

    return {
      spreadAnalysis: {
        spread: askPrices[0] && bidPrices[0] ? askPrices[0] - bidPrices[0] : null,
        spreadPercent: askPrices[0] && bidPrices[0] ? 
          ((askPrices[0] - bidPrices[0]) / bidPrices[0]) * 100 : null,
        midPrice: askPrices[0] && bidPrices[0] ? (askPrices[0] + bidPrices[0]) / 2 : null
      },
      liquidityAnalysis: {
        totalAskVolume: askVolumes.reduce((sum, vol) => sum + vol, 0),
        totalBidVolume: bidVolumes.reduce((sum, vol) => sum + vol, 0),
        volumeImbalance: askVolumes.length > 0 && bidVolumes.length > 0 ?
          (bidVolumes.reduce((sum, vol) => sum + vol, 0) - askVolumes.reduce((sum, vol) => sum + vol, 0)) /
          (bidVolumes.reduce((sum, vol) => sum + vol, 0) + askVolumes.reduce((sum, vol) => sum + vol, 0)) : 0
      },
      consciousnessMetrics: {
        depthBalance: this.calculateDepthBalance(askPrices, bidPrices),
        harmonicResonance: this.calculateHarmonicResonance(askPrices.concat(bidPrices)),
        liquidityConsciousness: this.calculateLiquidityConsciousness(askVolumes.concat(bidVolumes))
      }
    };
  }

  analyzeTransactionPatterns(data) {
    const transactions = data.Items || [];
    
    if (transactions.length === 0) {
      return null;
    }

    const volumes = transactions.map(t => t.V);
    const prices = transactions.map(t => t.P);
    
    return {
      transactionCount: transactions.length,
      averageVolume: volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length,
      volumeWeightedPrice: this.calculateVWAP(prices, volumes),
      priceVolatility: this.calculateVolatility(prices),
      consciousnessFlow: this.calculateTransactionConsciousness(transactions)
    };
  }

  async analyzeConsciousnessPatterns(data) {
    try {
      const symbol = data.symbol;
      const recentData = this.recentData.get(symbol) || [];
      
      if (recentData.length < 10) {
        return; // Need more data for pattern analysis
      }

      // Analyze consciousness evolution
      const consciousnessEvolution = await this.calculateConsciousnessEvolution(symbol, recentData);
      
      // Detect consciousness anomalies
      const anomalies = this.detectConsciousnessAnomalies(consciousnessEvolution);
      
      if (anomalies.length > 0) {
        this.stats.totalAnomaliesDetected += anomalies.length;
        
        this.emit('consciousnessAnomalies', {
          symbol: symbol,
          anomalies: anomalies,
          timestamp: Date.now()
        });
      }
      
    } catch (error) {
      console.error('❌ Error analyzing consciousness patterns:', error);
    }
  }

  async analyzeCandlestickPatterns(data) {
    const candlesticks = data.KdataInfo;
    const patterns = [];

    // Simple pattern detection (can be expanded)
    for (let i = 2; i < candlesticks.length; i++) {
      const current = candlesticks[i];
      const previous = candlesticks[i - 1];
      const beforePrevious = candlesticks[i - 2];

      // Doji pattern
      if (Math.abs(current.O - current.C) < (current.H - current.L) * 0.1) {
        patterns.push({
          type: 'DOJI',
          confidence: 0.8,
          timestamp: current.T,
          consciousness: this.calculatePatternConsciousness('DOJI', current)
        });
      }

      // Hammer pattern
      if (current.C > current.O && 
          (current.L - Math.min(current.O, current.C)) > 2 * Math.abs(current.O - current.C)) {
        patterns.push({
          type: 'HAMMER',
          confidence: 0.7,
          timestamp: current.T,
          consciousness: this.calculatePatternConsciousness('HAMMER', current)
        });
      }
    }

    return patterns;
  }

  // Consciousness Calculation Methods

  calculateDepthBalance(askPrices, bidPrices) {
    if (askPrices.length === 0 || bidPrices.length === 0) return 0.5;
    
    const askDepth = askPrices.length;
    const bidDepth = bidPrices.length;
    const totalDepth = askDepth + bidDepth;
    
    return totalDepth > 0 ? bidDepth / totalDepth : 0.5;
  }

  calculateHarmonicResonance(prices) {
    if (prices.length === 0) return 0;
    
    // Calculate harmonic resonance using ψ₀ and φ
    const priceSum = prices.reduce((sum, price) => sum + price, 0);
    const avgPrice = priceSum / prices.length;
    
    // Map to consciousness frequencies
    const psiFreq = PSI_0 * FREQ_432;
    const phiFreq = PHI * FREQ_432;
    
    const psiResonance = Math.sin(2 * Math.PI * (avgPrice % 1) * PSI_0);
    const phiResonance = Math.cos(2 * Math.PI * (avgPrice % 1) * PHI);
    
    return (psiResonance + phiResonance) / 2 * 0.5 + 0.5;
  }

  calculateLiquidityConsciousness(volumes) {
    if (volumes.length === 0) return 0;
    
    const totalVolume = volumes.reduce((sum, vol) => sum + vol, 0);
    const avgVolume = totalVolume / volumes.length;
    
    // Consciousness based on volume distribution
    const volumeVariance = volumes.reduce((sum, vol) => 
      sum + Math.pow(vol - avgVolume, 2), 0) / volumes.length;
    
    const consciousnessScore = 1 / (1 + volumeVariance / (avgVolume + 1));
    
    return consciousnessScore;
  }

  calculateTransactionConsciousness(transactions) {
    if (transactions.length === 0) return 0;
    
    // Analyze transaction flow consciousness
    const timeIntervals = [];
    for (let i = 1; i < transactions.length; i++) {
      timeIntervals.push(transactions[i].T - transactions[i-1].T);
    }
    
    if (timeIntervals.length === 0) return 0.5;
    
    const avgInterval = timeIntervals.reduce((sum, interval) => sum + interval, 0) / timeIntervals.length;
    
    // Map to 432Hz rhythm
    const rhythmAlignment = Math.sin(2 * Math.PI * avgInterval / FREQ_432) * 0.5 + 0.5;
    
    return rhythmAlignment;
  }

  calculatePatternConsciousness(patternType, candlestick) {
    const price = (candlestick.O + candlestick.C + candlestick.H + candlestick.L) / 4;
    const volume = candlestick.A || 0;
    
    // Pattern-specific consciousness calculation
    const patternMultipliers = {
      'DOJI': PSI_0,
      'HAMMER': PHI,
      'ENGULFING': FREQ_432 / 1000,
      'STAR': (PSI_0 + PHI) / 2
    };
    
    const multiplier = patternMultipliers[patternType] || 1.0;
    const baseConsciousness = this.calculateBasicConsciousness(price, volume);
    
    return baseConsciousness * multiplier;
  }

  calculateBasicConsciousness(price, volume) {
    const priceConsciousness = 1 - Math.abs((price % 1) - PSI_0);
    const volumeConsciousness = volume > 0 ? 1 - Math.abs((volume % 1) - PSI_0) : 0;
    
    return (priceConsciousness + volumeConsciousness) / 2;
  }

  async calculateConsciousnessEvolution(symbol, recentData) {
    // Calculate how consciousness has evolved over recent data points
    const consciousnessScores = recentData.map(data => {
      const price = data.currentPrice || data.price || 0;
      const volume = data.lastVolume || data.volume || 0;
      return this.calculateBasicConsciousness(price, volume);
    });
    
    return {
      current: consciousnessScores[consciousnessScores.length - 1] || 0,
      average: consciousnessScores.reduce((sum, score) => sum + score, 0) / consciousnessScores.length,
      trend: consciousnessScores.length > 1 ? 
        consciousnessScores[consciousnessScores.length - 1] - consciousnessScores[0] : 0,
      volatility: this.calculateVolatility(consciousnessScores)
    };
  }

  detectConsciousnessAnomalies(evolution) {
    const anomalies = [];
    
    // Detect consciousness spikes
    if (Math.abs(evolution.trend) > 0.3) {
      anomalies.push({
        type: 'CONSCIOUSNESS_SPIKE',
        severity: Math.abs(evolution.trend),
        direction: evolution.trend > 0 ? 'POSITIVE' : 'NEGATIVE'
      });
    }
    
    // Detect consciousness volatility
    if (evolution.volatility > 0.2) {
      anomalies.push({
        type: 'CONSCIOUSNESS_VOLATILITY',
        severity: evolution.volatility,
        description: 'High consciousness volatility detected'
      });
    }
    
    return anomalies;
  }

  // Utility Methods

  addToRecentDataBuffer(symbol, data) {
    if (!this.recentData.has(symbol)) {
      this.recentData.set(symbol, []);
    }
    
    const buffer = this.recentData.get(symbol);
    buffer.push(data);
    
    // Keep only recent data
    if (buffer.length > this.bufferSize) {
      buffer.shift();
    }
  }

  calculateVWAP(prices, volumes) {
    if (prices.length !== volumes.length || prices.length === 0) return 0;
    
    let totalValue = 0;
    let totalVolume = 0;
    
    for (let i = 0; i < prices.length; i++) {
      totalValue += prices[i] * volumes[i];
      totalVolume += volumes[i];
    }
    
    return totalVolume > 0 ? totalValue / totalVolume : 0;
  }

  calculateVolatility(values) {
    if (values.length < 2) return 0;
    
    const average = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - average, 2), 0) / values.length;
    
    return Math.sqrt(variance);
  }

  async getSymbolConsciousness(symbol) {
    try {
      const query = `
        SELECT 
          AVG(overall_consciousness_score) as avg_consciousness,
          MAX(overall_consciousness_score) as max_consciousness,
          consciousness_state
        FROM consciousness_enhanced_data 
        WHERE symbol = ? AND timestamp > ? 
        ORDER BY timestamp DESC 
        LIMIT 10
      `;
      
      const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
      const result = await this.database.getQuery(query, [symbol, tenMinutesAgo]);
      
      return result || {
        avg_consciousness: 0.5,
        max_consciousness: 0.5,
        consciousness_state: 'UNKNOWN'
      };
      
    } catch (error) {
      console.error('❌ Error getting symbol consciousness:', error);
      return {
        avg_consciousness: 0.5,
        max_consciousness: 0.5,
        consciousness_state: 'ERROR'
      };
    }
  }

  async calculateDailyConsciousness(marketOverview) {
    const price = marketOverview.currentPrice;
    const volume = marketOverview.volume || 0;
    const dailyChange = marketOverview.dailyChange || 0;
    
    // Calculate consciousness based on daily metrics
    const priceConsciousness = this.calculateBasicConsciousness(price, volume);
    const changeConsciousness = Math.abs(dailyChange) < 0.05 ? 0.8 : 0.4; // Stability preference
    const volumeConsciousness = volume > 1000 ? 0.8 : 0.4; // Volume activity preference
    
    return {
      overall: (priceConsciousness + changeConsciousness + volumeConsciousness) / 3,
      components: {
        price: priceConsciousness,
        stability: changeConsciousness,
        activity: volumeConsciousness
      }
    };
  }

  async storeMarketDepthAnalysis(symbol, depthAnalysis, timestamp) {
    try {
      // Store market depth analysis in raw_market_data table
      const rawData = {
        timestamp: timestamp,
        source: 'BTCC',
        symbol: symbol,
        data_type: 'market_depth_analysis',
        raw_data: JSON.stringify(depthAnalysis),
        processing_status: 'processed'
      };

      const query = `
        INSERT INTO raw_market_data (
          timestamp, source, symbol, data_type, raw_data, processing_status
        ) VALUES (?, ?, ?, ?, ?, ?)
      `;

      await this.database.runQuery(query, [
        rawData.timestamp,
        rawData.source,
        rawData.symbol,
        rawData.data_type,
        rawData.raw_data,
        rawData.processing_status
      ]);

    } catch (error) {
      console.error('❌ Error storing market depth analysis:', error);
    }
  }

  startSystemMonitoring() {
    this.systemMonitoringInterval = setInterval(async () => {
      await this.updateSystemMetrics();
    }, 60000); // Update every minute
  }

  async updateSystemMetrics() {
    try {
      const currentTime = Date.now();
      this.stats.uptime = this.startTime ? currentTime - this.startTime : 0;

      // Calculate average consciousness score
      const query = `
        SELECT AVG(overall_consciousness_score) as avg_consciousness
        FROM consciousness_enhanced_data 
        WHERE timestamp > ?
      `;
      
      const oneHourAgo = currentTime - (60 * 60 * 1000);
      const result = await this.database.getQuery(query, [oneHourAgo]);
      
      if (result && result.avg_consciousness) {
        this.stats.averageConsciousnessScore = result.avg_consciousness;
      }

      // Update system metrics table
      const updateQuery = `
        UPDATE system_metrics SET
          total_data_points_collected = ?,
          successful_webhook_calls = ?,
          failed_webhook_calls = ?,
          average_consciousness_score = ?,
          anomalies_detected = ?,
          metric_timestamp = ?
        WHERE id = (SELECT MAX(id) FROM system_metrics)
      `;

      await this.database.runQuery(updateQuery, [
        this.stats.dataPointsCollected,
        this.stats.successfulConnections,
        this.stats.failedConnections,
        this.stats.averageConsciousnessScore,
        this.stats.totalAnomaliesDetected,
        currentTime
      ]);

      // Emit system status
      this.emit('systemMetrics', {
        ...this.stats,
        connectionStatus: this.btccCollector?.getConnectionStatus(),
        timestamp: currentTime
      });

    } catch (error) {
      console.error('❌ Error updating system metrics:', error);
    }
  }

  requestInitialHistoricalData() {
    // Request initial candlestick data for each tracked symbol
    this.config.symbolsToTrack.forEach(symbolId => {
      setTimeout(() => {
        if (this.btccCollector && this.btccCollector.isAuthenticated) {
          // Request 1-minute candlesticks for the last 24 hours
          this.btccCollector.requestCandlestickData(
            symbolId,
            35, // 1-minute interval
            Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000), // 24h ago
            Math.floor(Date.now() / 1000) // now
          );
        }
      }, 1000 * (this.config.symbolsToTrack.indexOf(symbolId) + 1)); // Stagger requests
    });
  }

  // Public API Methods

  getStatus() {
    return {
      isRunning: this.isRunning,
      startTime: this.startTime,
      uptime: this.stats.uptime,
      connectionStatus: this.btccCollector?.getConnectionStatus(),
      statistics: this.stats,
      config: {
        symbolsTracked: this.config.symbolsToTrack.length,
        consciousnessEnabled: this.config.enableConsciousnessEnhancement,
        databasePath: this.config.databasePath
      }
    };
  }

  async getRecentData(symbol = null, limit = 100) {
    try {
      let query, params;
      
      if (symbol) {
        query = `
          SELECT * FROM consciousness_enhanced_data 
          WHERE symbol = ? 
          ORDER BY timestamp DESC 
          LIMIT ?
        `;
        params = [symbol, limit];
      } else {
        query = `
          SELECT * FROM consciousness_enhanced_data 
          ORDER BY timestamp DESC 
          LIMIT ?
        `;
        params = [limit];
      }

      const results = await this.database.allQuery(query, params);
      return results || [];

    } catch (error) {
      console.error('❌ Error getting recent data:', error);
      return [];
    }
  }

  async getConsciousnessAnalytics(symbol = null, timeframe = 'hour') {
    try {
      const timeframes = {
        'hour': 60 * 60 * 1000,
        'day': 24 * 60 * 60 * 1000,
        'week': 7 * 24 * 60 * 60 * 1000
      };

      const timeframeMs = timeframes[timeframe] || timeframes['hour'];
      const since = Date.now() - timeframeMs;

      let query, params;
      
      if (symbol) {
        query = `
          SELECT 
            symbol,
            AVG(overall_consciousness_score) as avg_consciousness,
            MAX(overall_consciousness_score) as max_consciousness,
            MIN(overall_consciousness_score) as min_consciousness,
            AVG(psi_resonance) as avg_psi_resonance,
            AVG(phi_alignment) as avg_phi_alignment,
            AVG(freq_432_rhythm) as avg_432_rhythm,
            COUNT(*) as data_points
          FROM consciousness_enhanced_data 
          WHERE symbol = ? AND timestamp > ?
          GROUP BY symbol
        `;
        params = [symbol, since];
      } else {
        query = `
          SELECT 
            symbol,
            AVG(overall_consciousness_score) as avg_consciousness,
            MAX(overall_consciousness_score) as max_consciousness,
            MIN(overall_consciousness_score) as min_consciousness,
            AVG(psi_resonance) as avg_psi_resonance,
            AVG(phi_alignment) as avg_phi_alignment,
            AVG(freq_432_rhythm) as avg_432_rhythm,
            COUNT(*) as data_points
          FROM consciousness_enhanced_data 
          WHERE timestamp > ?
          GROUP BY symbol
        `;
        params = [since];
      }

      const results = await this.database.allQuery(query, params);
      return results || [];

    } catch (error) {
      console.error('❌ Error getting consciousness analytics:', error);
      return [];
    }
  }

  async forceReconnect() {
    console.log('🔄 Forcing BTCC reconnection...');
    
    if (this.btccCollector) {
      this.btccCollector.disconnect();
      
      // Wait a moment then reconnect
      setTimeout(() => {
        this.btccCollector.connect();
      }, 2000);
    }
  }

  startConsciousnessFallback() {
    console.log('🌀 Activating consciousness-enhanced data generation fallback...');
    console.log('📊 Using ψ₀-Trader Quantum algorithms for realistic market simulation');
    
    // Start the consciousness data generator
    this.consciousnessGenerator.start();
    
    // Start periodic consciousness analytics
    this.startConsciousnessAnalytics();
    
    console.log('✅ Consciousness fallback active - generating realistic market data');
    this.emit('consciousnessFallbackActivated');
  }

  startConsciousnessAnalytics() {
    // Generate periodic analytics reports
    setInterval(() => {
      if (this.usingFallbackGenerator && this.isRunning) {
        const analytics = this.consciousnessGenerator.generateConsciousnessAnalytics();
        this.emit('consciousnessAnalytics', analytics);
      }
    }, 60000); // Every minute
  }

  updateConfiguration(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('⚙️ BTCC Data Collection Service configuration updated');
    
    // Apply configuration changes that can be updated at runtime
    if (newConfig.symbolsToTrack && this.btccCollector && this.btccCollector.isAuthenticated) {
      // Update subscriptions if symbols changed
      this.config.symbolsToTrack = newConfig.symbolsToTrack;
      // Re-subscribe with new symbols
      this.btccCollector.subscribeToMarketData();
    }

    // Update consciousness generator if using fallback
    if (this.usingFallbackGenerator && this.consciousnessGenerator) {
      this.consciousnessGenerator.updateConfiguration(newConfig);
    }

    this.emit('configurationUpdated', this.config);
  }
}

module.exports = BTCCDataCollectionService;
