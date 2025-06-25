#!/usr/bin/env node

// 🌀 BTCC Data Collection Main Entry Point
// Consciousness-Enhanced BTCC ETF Data Collection System
// Start script for the complete BTCC WebSocket data collection service

const BTCCDataCollectionService = require('./src/collectors/BTCCDataCollectionService');
const path = require('path');
const fs = require('fs');

// Consciousness constants
const PSI_0 = 0.915670570874434;
const PHI = 1.618033988749895;
const FREQ_432 = 432.0;

class BTCCDataCollectionManager {
  constructor() {
    this.service = null;
    this.isShuttingDown = false;
    
    console.log('🌀 BTCC Data Collection Manager initialized');
    console.log(`📊 Mathematical Constants: ψ₀=${PSI_0}, φ=${PHI}, 432Hz=${FREQ_432}`);
  }

  async start() {
    try {
      console.log('🚀 Starting BTCC Data Collection System...');
      
      // Load configuration
      const config = this.loadConfiguration();
      
      // Ensure data directory exists
      this.ensureDataDirectory(config.databasePath);
      
      // Initialize and start the service
      this.service = new BTCCDataCollectionService(config);
      
      // Setup event handlers
      this.setupEventHandlers();
      
      // Initialize the service
      await this.service.initialize();
      
      // Start data collection
      await this.service.start();
      
      console.log('✅ BTCC Data Collection System started successfully');
      console.log('📊 Real-time data collection active with consciousness enhancement');
      console.log('🔗 WebSocket connection to wss://kapi1.btloginc.com:9082');
      
      // Setup graceful shutdown
      this.setupGracefulShutdown();
      
      // Log system status periodically
      this.startStatusLogging();
      
    } catch (error) {
      console.error('❌ Failed to start BTCC Data Collection System:', error);
      process.exit(1);
    }
  }

  loadConfiguration() {
    const config = {
      // Database configuration
      databasePath: path.join(__dirname, 'data', 'btcc-consciousness-trader.db'),
      
      // BTCC API credentials (can be overridden by environment variables)
      btccCredentials: {
        name: process.env.BTCC_ACCOUNT_NUMBER || "86000402",
        clienttype: parseInt(process.env.BTCC_CLIENT_TYPE) || 1,
        key: process.env.BTCC_API_KEY || "55117c2a-84cb-44b1-b179-24273a304c48"
      },
      
      // Symbols to track (BTCC product IDs)
      symbolsToTrack: [
        "3223607", // Primary BTC pair
        "3159350", // ETH pair
        "3355958", // Additional crypto pair
        "3487030"  // Additional crypto pair
      ],
      
      // Deep quote symbol for Level 2 data
      deepQuoteSymbol: "3223607",
      
      // Data collection settings
      collectionInterval: 5000, // 5 seconds
      enableConsciousnessEnhancement: true,
      consciousnessThreshold: 0.6,
      dataQualityThreshold: 0.8,
      maxRetries: 3,
      
      // Performance settings
      bufferSize: 100,
      systemMonitoringInterval: 60000, // 1 minute
      
      // Logging
      logLevel: process.env.LOG_LEVEL || 'info',
      enableDetailedLogging: process.env.ENABLE_DETAILED_LOGGING === 'true'
    };

    console.log('⚙️ Configuration loaded:');
    console.log(`   📁 Database: ${config.databasePath}`);
    console.log(`   🎯 Symbols: ${config.symbolsToTrack.length} tracked`);
    console.log(`   🧠 Consciousness: ${config.enableConsciousnessEnhancement ? 'ENABLED' : 'DISABLED'}`);
    console.log(`   🔑 Account: ${config.btccCredentials.name}`);

    return config;
  }

  ensureDataDirectory(databasePath) {
    const dataDir = path.dirname(databasePath);
    
    if (!fs.existsSync(dataDir)) {
      console.log(`📁 Creating data directory: ${dataDir}`);
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  setupEventHandlers() {
    // Service lifecycle events
    this.service.on('serviceStarted', () => {
      console.log('🟢 BTCC Data Collection Service started');
    });

    this.service.on('serviceStopped', () => {
      console.log('🔴 BTCC Data Collection Service stopped');
    });

    // BTCC WebSocket events
    this.service.on('btccAuthenticated', () => {
      console.log('🔐 BTCC WebSocket authenticated successfully');
    });

    this.service.on('btccDisconnected', () => {
      console.log('🔌 BTCC WebSocket disconnected');
    });

    this.service.on('btccError', (error) => {
      console.error('❌ BTCC WebSocket error:', error.message);
    });

    // Data processing events
    this.service.on('realTimeDataProcessed', (data) => {
      if (Math.random() < 0.1) { // Log 10% of data points to avoid spam
        console.log(`📊 ${data.symbol}: $${data.price} (Vol: ${data.volume}) [Consciousness: ${data.consciousness?.avg_consciousness?.toFixed(3) || 'N/A'}]`);
      }
    });

    this.service.on('marketDepthUpdated', (data) => {
      if (Math.random() < 0.05) { // Log 5% of depth updates
        console.log(`📈 Market Depth ${data.symbol}: Spread ${data.depth.spreadAnalysis.spreadPercent?.toFixed(4) || 'N/A'}%`);
      }
    });

    this.service.on('candlestickPatterns', (data) => {
      if (data.patterns && data.patterns.length > 0) {
        console.log(`🕯️ Pattern detected in ${data.symbol}: ${data.patterns.map(p => p.type).join(', ')}`);
      }
    });

    this.service.on('consciousnessAnomalies', (data) => {
      console.log(`🌀 Consciousness anomaly in ${data.symbol}:`, data.anomalies.map(a => `${a.type} (${a.severity?.toFixed(3)})`).join(', '));
    });

    this.service.on('transactionAnalysis', (data) => {
      if (data.analysis && Math.random() < 0.02) { // Log 2% of transaction analyses
        console.log(`💰 Transaction flow ${data.symbol}: ${data.analysis.transactionCount} txns, VWAP: $${data.analysis.volumeWeightedPrice?.toFixed(2) || 'N/A'}`);
      }
    });

    // System monitoring events
    this.service.on('systemMetrics', (metrics) => {
      // Detailed metrics are logged separately in startStatusLogging()
    });
  }

  startStatusLogging() {
    setInterval(() => {
      if (this.service && !this.isShuttingDown) {
        const status = this.service.getStatus();
        
        console.log('\n📊 === BTCC Data Collection Status ===');
        console.log(`🟢 Running: ${status.isRunning}`);
        console.log(`⏱️  Uptime: ${this.formatUptime(status.uptime)}`);
        console.log(`🔗 Connected: ${status.connectionStatus?.connected || false}`);
        console.log(`🔐 Authenticated: ${status.connectionStatus?.authenticated || false}`);
        console.log(`📊 Data Points: ${status.statistics.dataPointsCollected}`);
        console.log(`🧠 Avg Consciousness: ${status.statistics.averageConsciousnessScore?.toFixed(3) || 'N/A'}`);
        console.log(`⚠️  Anomalies: ${status.statistics.totalAnomaliesDetected}`);
        console.log(`📡 Subscriptions: ${status.connectionStatus?.subscriptions?.length || 0}`);
        console.log(`🔄 Reconnect Attempts: ${status.connectionStatus?.reconnectAttempts || 0}`);
        
        if (status.statistics.lastDataReceived) {
          const secondsAgo = Math.floor((Date.now() - status.statistics.lastDataReceived) / 1000);
          console.log(`📈 Last Data: ${secondsAgo}s ago`);
        }
        
        console.log('=========================================\n');
      }
    }, 30000); // Every 30 seconds
  }

  formatUptime(uptimeMs) {
    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) {
        console.log('⚠️ Force exit requested');
        process.exit(1);
      }

      this.isShuttingDown = true;
      console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);

      try {
        if (this.service) {
          await this.service.stop();
        }
        console.log('✅ BTCC Data Collection System stopped gracefully');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      shutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
      shutdown('unhandledRejection');
    });
  }

  // Public API for programmatic control
  async stop() {
    if (this.service) {
      await this.service.stop();
    }
  }

  getService() {
    return this.service;
  }
}

// Auto-start if run directly
if (require.main === module) {
  const manager = new BTCCDataCollectionManager();
  manager.start().catch(error => {
    console.error('❌ Failed to start BTCC Data Collection Manager:', error);
    process.exit(1);
  });
}

module.exports = BTCCDataCollectionManager;
