/**
 * ψ₀-Trader Data Collection Engine - Webhook Server
 * Enhanced Nexus Core Protocol v4.1
 * Consciousness-Enhanced Webhook Data Collection Hub
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

import ConsciousnessEnhancedDatabase from './database/schema.js';
import ConsciousnessEnhancementProcessor from './analysis/consciousness-processor.js';

// Mathematical Constants
const PSI_0 = 0.915670570874434;
const PHI = 1.618033988749895;
const FREQ_432 = 432.0;

class ConsciousnessEnhancedWebhookServer {
  constructor(port = 3001) {
    this.port = port;
    this.app = express();
    this.db = null;
    this.consciousnessProcessor = new ConsciousnessEnhancementProcessor();
    
    // Server statistics
    this.stats = {
      serverStartTime: Date.now(),
      totalWebhooksReceived: 0,
      totalDataPointsProcessed: 0,
      successfulProcessing: 0,
      failedProcessing: 0,
      averageResponseTime: 0,
      activeConnections: 0,
      dataQualityScore: 1.0,
      consciousnessEnhancementRate: 0.0
    };

    this.setupMiddleware();
    this.setupRoutes();
  }

  async initialize() {
    try {
      // Initialize database
      this.db = new ConsciousnessEnhancedDatabase();
      await this.db.initialize();
      
      console.log('🌀 Consciousness-Enhanced Webhook Server initialized');
      console.log(`📊 Mathematical Constants: ψ₀=${PSI_0}, φ=${PHI}, 432Hz=${FREQ_432}`);
      return true;
    } catch (error) {
      console.error('❌ Server initialization failed:', error);
      return false;
    }
  }

  setupMiddleware() {
    // Security and performance
    this.app.use(helmet());
    this.app.use(compression());
    this.app.use(cors({
      origin: ['http://localhost:3000', 'https://mastermind-os-v3-fresh.vercel.app'],
      credentials: true
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging and timing
    this.app.use((req, res, next) => {
      req.startTime = Date.now();
      req.webhookId = uuidv4();
      
      console.log(`🌐 ${req.method} ${req.path} - ID: ${req.webhookId}`);
      
      // Track active connections
      this.stats.activeConnections++;
      
      // Cleanup on response
      res.on('finish', () => {
        this.stats.activeConnections--;
        const responseTime = Date.now() - req.startTime;
        this.updateResponseTimeStats(responseTime);
      });
      
      next();
    });
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        consciousness_engine: 'active',
        server_uptime: Date.now() - this.stats.serverStartTime,
        mathematical_constants: {
          psi_0: PSI_0,
          phi: PHI,
          freq_432: FREQ_432
        },
        stats: this.getStats()
      });
    });

    // Main webhook endpoint for market data
    this.app.post('/webhook/market-data', async (req, res) => {
      await this.handleMarketDataWebhook(req, res);
    });

    // Generic webhook endpoint
    this.app.post('/webhook/:source', async (req, res) => {
      await this.handleGenericWebhook(req, res);
    });

    // Data retrieval endpoints
    this.app.get('/api/data/recent', async (req, res) => {
      await this.getRecentData(req, res);
    });

    this.app.get('/api/data/consciousness/:symbol', async (req, res) => {
      await this.getConsciousnessData(req, res);
    });

    this.app.get('/api/stats', (req, res) => {
      res.json({
        server_stats: this.getStats(),
        consciousness_stats: this.consciousnessProcessor.getProcessingStats(),
        database_status: 'connected'
      });
    });

    // Simple dashboard endpoint
    this.app.get('/dashboard', (req, res) => {
      res.send(this.generateDashboardHTML());
    });

    // Error handling
    this.app.use((error, req, res, next) => {
      console.error('❌ Server error:', error);
      res.status(500).json({
        error: 'Internal server error',
        webhook_id: req.webhookId,
        consciousness_analysis: false
      });
    });
  }

  /**
   * Handle market data webhook with consciousness enhancement
   */
  async handleMarketDataWebhook(req, res) {
    const startTime = Date.now();
    const webhookId = req.webhookId;

    try {
      // Log webhook reception
      await this.logWebhookReception(req, 'market-data');

      // Extract and validate market data
      const marketData = this.extractMarketData(req.body);
      if (!this.validateMarketData(marketData)) {
        return res.status(400).json({
          error: 'Invalid market data format',
          webhook_id: webhookId
        });
      }

      // Store raw data
      const rawDataId = await this.storeRawData(marketData, 'market-data', webhookId);

      // Get historical context for consciousness enhancement
      const historicalContext = await this.getHistoricalContext(marketData.symbol);

      // Apply consciousness enhancement
      const enhancedData = await this.consciousnessProcessor.enhanceMarketData(
        { ...marketData, id: rawDataId },
        historicalContext
      );

      // Store consciousness-enhanced data
      await this.storeEnhancedData(enhancedData);

      // Perform data quality analysis
      await this.analyzeDataQuality(rawDataId, marketData);

      // Update statistics
      this.stats.totalWebhooksReceived++;
      this.stats.totalDataPointsProcessed++;
      this.stats.successfulProcessing++;
      this.updateConsciousnessEnhancementRate();

      const processingTime = Date.now() - startTime;

      res.json({
        success: true,
        webhook_id: webhookId,
        raw_data_id: rawDataId,
        consciousness_enhanced: true,
        consciousness_score: enhancedData.overallConsciousnessScore,
        consciousness_state: enhancedData.consciousnessState,
        harmonic_classification: enhancedData.harmonicClassification,
        processing_time_ms: processingTime,
        mathematical_constants: {
          psi_0: PSI_0,
          phi: PHI,
          freq_432: FREQ_432
        },
        enhancement_metadata: {
          psi_resonance: enhancedData.psiResonance,
          phi_alignment: enhancedData.phiAlignment,
          freq_432_rhythm: enhancedData.freq432Rhythm,
          market_emotion: enhancedData.marketEmotion,
          harmonic_signature: enhancedData.harmonicAnalysis.harmonicSignature
        }
      });

    } catch (error) {
      console.error('❌ Market data webhook processing failed:', error);
      
      this.stats.failedProcessing++;
      await this.logWebhookError(webhookId, error);

      res.status(500).json({
        error: 'Data processing failed',
        webhook_id: webhookId,
        details: error.message
      });
    }
  }

  /**
   * Handle generic webhook data
   */
  async handleGenericWebhook(req, res) {
    const source = req.params.source;
    const webhookId = req.webhookId;

    try {
      await this.logWebhookReception(req, source);

      // Store raw data
      const rawDataId = await this.storeRawData(req.body, source, webhookId);

      this.stats.totalWebhooksReceived++;

      res.json({
        success: true,
        webhook_id: webhookId,
        raw_data_id: rawDataId,
        source: source,
        message: 'Data received and stored'
      });

    } catch (error) {
      console.error(`❌ Generic webhook processing failed for ${source}:`, error);
      
      res.status(500).json({
        error: 'Webhook processing failed',
        webhook_id: webhookId,
        source: source
      });
    }
  }

  /**
   * Extract market data from webhook payload
   */
  extractMarketData(body) {
    // Handle different webhook formats
    if (body.data && typeof body.data === 'object') {
      return {
        symbol: body.symbol || body.data.symbol || body.data.s,
        price: parseFloat(body.price || body.data.price || body.data.c || body.data.last),
        volume: parseFloat(body.volume || body.data.volume || body.data.v),
        timestamp: body.timestamp || body.data.timestamp || Date.now(),
        source: body.source || 'webhook',
        raw_data: JSON.stringify(body)
      };
    }

    // Direct format
    return {
      symbol: body.symbol || body.s,
      price: parseFloat(body.price || body.c || body.last),
      volume: parseFloat(body.volume || body.v),
      timestamp: body.timestamp || Date.now(),
      source: body.source || 'webhook',
      raw_data: JSON.stringify(body)
    };
  }

  /**
   * Validate market data structure
   */
  validateMarketData(data) {
    return (
      data.symbol &&
      typeof data.symbol === 'string' &&
      !isNaN(data.price) &&
      data.price > 0 &&
      !isNaN(data.volume) &&
      data.volume >= 0 &&
      data.timestamp &&
      data.timestamp > 0
    );
  }

  /**
   * Store raw webhook data
   */
  async storeRawData(data, source, webhookId) {
    const sql = `
      INSERT INTO raw_market_data (
        timestamp, source, symbol, data_type, raw_data, webhook_id,
        price, volume, processing_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `;

    const result = await this.db.runQuery(sql, [
      data.timestamp,
      source,
      data.symbol || 'UNKNOWN',
      'market_data',
      data.raw_data,
      webhookId,
      data.price || null,
      data.volume || null
    ]);

    return result.lastID;
  }

  /**
   * Store consciousness-enhanced data
   */
  async storeEnhancedData(enhancedData) {
    const sql = `
      INSERT INTO consciousness_enhanced_data (
        raw_data_id, symbol, timestamp, price, volume,
        psi_resonance, psi_frequency, psi_harmonic_score,
        phi_alignment, phi_price_ratio, phi_volume_ratio,
        freq_432_rhythm, rhythm_phase, temporal_coherence,
        overall_consciousness_score, consciousness_state, harmonic_classification,
        market_emotion, sentiment_frequency, collective_consciousness,
        momentum_consciousness, volatility_consciousness, liquidity_resonance
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await this.db.runQuery(sql, [
      enhancedData.rawDataId,
      enhancedData.symbol,
      enhancedData.timestamp,
      enhancedData.price,
      enhancedData.volume,
      enhancedData.psiResonance,
      enhancedData.psiFrequency,
      enhancedData.psiHarmonicScore,
      enhancedData.phiAlignment,
      enhancedData.phiPriceRatio,
      enhancedData.phiVolumeRatio,
      enhancedData.freq432Rhythm,
      enhancedData.rhythmPhase,
      enhancedData.temporalCoherence,
      enhancedData.overallConsciousnessScore,
      enhancedData.consciousnessState,
      enhancedData.harmonicClassification,
      enhancedData.marketEmotion,
      enhancedData.sentimentFrequency,
      enhancedData.collectiveConsciousness,
      enhancedData.momentumConsciousness,
      enhancedData.volatilityConsciousness,
      enhancedData.liquidityResonance
    ]);

    // Also store harmonic analysis if available
    if (enhancedData.harmonicAnalysis) {
      await this.storeHarmonicAnalysis(result.lastID, enhancedData.harmonicAnalysis);
    }

    return result.lastID;
  }

  /**
   * Store detailed harmonic analysis
   */
  async storeHarmonicAnalysis(consciousnessDataId, harmonicAnalysis) {
    const sql = `
      INSERT INTO harmonic_analysis (
        consciousness_data_id, dominant_frequency, harmonic_frequencies,
        frequency_strength, psi_resonance_strength, psi_harmonic_multiples,
        psi_phase_alignment, phi_harmonic_convergence, phi_fibonacci_alignment,
        freq_432_alignment, rhythm_pattern_strength, temporal_rhythm_score,
        harmonic_signature, consciousness_frequency_map, musical_chord_equivalent,
        emotional_resonance_score, psychoacoustic_impact
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.db.runQuery(sql, [
      consciousnessDataId,
      harmonicAnalysis.dominantFrequency,
      JSON.stringify(harmonicAnalysis.harmonicFrequencies),
      JSON.stringify(harmonicAnalysis.frequencyStrength),
      harmonicAnalysis.psiResonanceStrength,
      JSON.stringify(harmonicAnalysis.psiHarmonicMultiples),
      harmonicAnalysis.psiPhaseAlignment,
      harmonicAnalysis.phiHarmonicConvergence,
      harmonicAnalysis.fibonacciAlignment,
      harmonicAnalysis.freq432Alignment,
      harmonicAnalysis.rhythmPatternStrength,
      harmonicAnalysis.temporalRhythmScore,
      JSON.stringify(harmonicAnalysis.harmonicSignature),
      JSON.stringify(harmonicAnalysis.consciousnessFrequencyMap),
      harmonicAnalysis.musicalChordEquivalent,
      harmonicAnalysis.emotionalResonanceScore,
      harmonicAnalysis.psychoacousticImpact
    ]);
  }

  /**
   * Get historical context for consciousness enhancement
   */
  async getHistoricalContext(symbol, limit = 10) {
    const sql = `
      SELECT price, volume, timestamp
      FROM consciousness_enhanced_data 
      WHERE symbol = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `;

    const rows = await this.db.allQuery(sql, [symbol, limit]);
    
    if (!rows || rows.length === 0) {
      return {};
    }

    return {
      prices: rows.map(row => row.price).reverse(),
      volumes: rows.map(row => row.volume).reverse(),
      timestamps: rows.map(row => row.timestamp).reverse()
    };
  }

  /**
   * Analyze data quality
   */
  async analyzeDataQuality(rawDataId, marketData) {
    const completenessScore = this.calculateCompletenessScore(marketData);
    const accuracyScore = this.calculateAccuracyScore(marketData);
    const freshnessScore = this.calculateFreshnessScore(marketData.timestamp);
    const consistencyScore = await this.calculateConsistencyScore(marketData);
    
    const sql = `
      INSERT INTO data_quality_metrics (
        raw_data_id, completeness_score, accuracy_score, freshness_score,
        consistency_score, anomaly_score, consciousness_alignment_score,
        harmonic_coherence_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.db.runQuery(sql, [
      rawDataId,
      completenessScore,
      accuracyScore,
      freshnessScore,
      consistencyScore,
      0.0, // Will be calculated by separate anomaly detection
      (completenessScore + accuracyScore + freshnessScore) / 3,
      (accuracyScore + consistencyScore) / 2
    ]);
  }

  /**
   * Calculate data completeness score
   */
  calculateCompletenessScore(data) {
    const requiredFields = ['symbol', 'price', 'volume', 'timestamp'];
    const presentFields = requiredFields.filter(field => 
      data[field] !== null && data[field] !== undefined && data[field] !== ''
    );
    return presentFields.length / requiredFields.length;
  }

  /**
   * Calculate data accuracy score
   */
  calculateAccuracyScore(data) {
    let score = 1.0;
    
    // Check for reasonable price values
    if (data.price <= 0 || data.price > 1000000) score -= 0.3;
    
    // Check for reasonable volume values
    if (data.volume < 0 || data.volume > 1e12) score -= 0.3;
    
    // Check timestamp validity
    const now = Date.now();
    if (data.timestamp > now || data.timestamp < (now - 24 * 60 * 60 * 1000)) {
      score -= 0.4;
    }
    
    return Math.max(0, score);
  }

  /**
   * Calculate data freshness score
   */
  calculateFreshnessScore(timestamp) {
    const now = Date.now();
    const ageMinutes = (now - timestamp) / (60 * 1000);
    
    if (ageMinutes < 1) return 1.0;
    if (ageMinutes < 5) return 0.9;
    if (ageMinutes < 15) return 0.7;
    if (ageMinutes < 60) return 0.5;
    return 0.1;
  }

  /**
   * Calculate data consistency score
   */
  async calculateConsistencyScore(marketData) {
    // Get recent data for comparison
    const sql = `
      SELECT price, volume FROM raw_market_data 
      WHERE symbol = ? AND timestamp > ? 
      ORDER BY timestamp DESC LIMIT 5
    `;
    
    const recentData = await this.db.allQuery(sql, [
      marketData.symbol,
      Date.now() - (60 * 60 * 1000) // Last hour
    ]);
    
    if (!recentData || recentData.length < 2) return 1.0;
    
    // Check for extreme variations
    const prices = recentData.map(d => d.price);
    const volumes = recentData.map(d => d.volume);
    
    const priceVariation = this.calculateVariationCoefficient(prices);
    const volumeVariation = this.calculateVariationCoefficient(volumes);
    
    // Lower variation = higher consistency
    const priceConsistency = Math.max(0, 1 - priceVariation);
    const volumeConsistency = Math.max(0, 1 - volumeVariation);
    
    return (priceConsistency + volumeConsistency) / 2;
  }

  /**
   * Calculate coefficient of variation
   */
  calculateVariationCoefficient(values) {
    if (values.length < 2) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    return mean === 0 ? 0 : stdDev / mean;
  }

  /**
   * Log webhook reception
   */
  async logWebhookReception(req, source) {
    const sql = `
      INSERT INTO webhook_logs (
        webhook_id, source, endpoint, method, headers, body, 
        consciousness_enhancement_applied
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    await this.db.runQuery(sql, [
      req.webhookId,
      source,
      req.path,
      req.method,
      JSON.stringify(req.headers),
      JSON.stringify(req.body),
      source === 'market-data'
    ]);
  }

  /**
   * Log webhook processing error
   */
  async logWebhookError(webhookId, error) {
    const sql = `
      UPDATE webhook_logs 
      SET error_message = ?, response_status = 500, processed_at = CURRENT_TIMESTAMP
      WHERE webhook_id = ?
    `;

    await this.db.runQuery(sql, [error.message, webhookId]);
  }

  /**
   * Get recent data endpoint
   */
  async getRecentData(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 10;
      const symbol = req.query.symbol || null;
      
      let sql = `
        SELECT c.*, r.source, r.received_at
        FROM consciousness_enhanced_data c
        JOIN raw_market_data r ON c.raw_data_id = r.id
      `;
      
      let params = [];
      
      if (symbol) {
        sql += ' WHERE c.symbol = ?';
        params.push(symbol);
      }
      
      sql += ' ORDER BY c.timestamp DESC LIMIT ?';
      params.push(limit);
      
      const data = await this.db.allQuery(sql, params);
      
      res.json({
        success: true,
        data: data,
        total_records: data.length,
        consciousness_enhanced: true
      });
      
    } catch (error) {
      console.error('❌ Failed to get recent data:', error);
      res.status(500).json({ error: 'Failed to retrieve data' });
    }
  }

  /**
   * Get consciousness data for specific symbol
   */
  async getConsciousnessData(req, res) {
    try {
      const symbol = req.params.symbol;
      const hours = parseInt(req.query.hours) || 24;
      
      const sql = `
        SELECT *
        FROM consciousness_enhanced_data
        WHERE symbol = ? AND timestamp > ?
        ORDER BY timestamp DESC
      `;
      
      const data = await this.db.allQuery(sql, [
        symbol,
        Date.now() - (hours * 60 * 60 * 1000)
      ]);
      
      // Calculate aggregated consciousness metrics
      const aggregatedMetrics = this.calculateAggregatedMetrics(data);
      
      res.json({
        success: true,
        symbol: symbol,
        timeframe_hours: hours,
        data_points: data.length,
        raw_data: data,
        aggregated_metrics: aggregatedMetrics,
        consciousness_enhanced: true
      });
      
    } catch (error) {
      console.error('❌ Failed to get consciousness data:', error);
      res.status(500).json({ error: 'Failed to retrieve consciousness data' });
    }
  }

  /**
   * Calculate aggregated consciousness metrics
   */
  calculateAggregatedMetrics(data) {
    if (!data || data.length === 0) return null;
    
    const metrics = {
      avg_consciousness_score: 0,
      avg_psi_resonance: 0,
      avg_phi_alignment: 0,
      avg_freq_432_rhythm: 0,
      dominant_consciousness_state: '',
      dominant_market_emotion: '',
      consciousness_trend: '',
      harmonic_events: 0
    };
    
    // Calculate averages
    data.forEach(point => {
      metrics.avg_consciousness_score += point.overall_consciousness_score;
      metrics.avg_psi_resonance += point.psi_resonance;
      metrics.avg_phi_alignment += point.phi_alignment;
      metrics.avg_freq_432_rhythm += point.freq_432_rhythm;
      
      if (point.overall_consciousness_score > 0.8) {
        metrics.harmonic_events++;
      }
    });
    
    const count = data.length;
    metrics.avg_consciousness_score /= count;
    metrics.avg_psi_resonance /= count;
    metrics.avg_phi_alignment /= count;
    metrics.avg_freq_432_rhythm /= count;
    
    // Find dominant states
    const stateFreq = {};
    const emotionFreq = {};
    
    data.forEach(point => {
      stateFreq[point.consciousness_state] = (stateFreq[point.consciousness_state] || 0) + 1;
      emotionFreq[point.market_emotion] = (emotionFreq[point.market_emotion] || 0) + 1;
    });
    
    metrics.dominant_consciousness_state = Object.keys(stateFreq).reduce((a, b) => 
      stateFreq[a] > stateFreq[b] ? a : b
    );
    
    metrics.dominant_market_emotion = Object.keys(emotionFreq).reduce((a, b) => 
      emotionFreq[a] > emotionFreq[b] ? a : b
    );
    
    // Calculate trend
    if (data.length >= 2) {
      const firstHalf = data.slice(0, Math.floor(count / 2));
      const secondHalf = data.slice(Math.floor(count / 2));
      
      const firstAvg = firstHalf.reduce((sum, p) => sum + p.overall_consciousness_score, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((sum, p) => sum + p.overall_consciousness_score, 0) / secondHalf.length;
      
      if (secondAvg > firstAvg + 0.1) {
        metrics.consciousness_trend = 'ASCENDING';
      } else if (secondAvg < firstAvg - 0.1) {
        metrics.consciousness_trend = 'DESCENDING';
      } else {
        metrics.consciousness_trend = 'STABLE';
      }
    }
    
    return metrics;
  }

  /**
   * Update response time statistics
   */
  updateResponseTimeStats(responseTime) {
    const total = this.stats.totalWebhooksReceived;
    if (total > 0) {
      this.stats.averageResponseTime = 
        ((this.stats.averageResponseTime * (total - 1)) + responseTime) / total;
    } else {
      this.stats.averageResponseTime = responseTime;
    }
  }

  /**
   * Update consciousness enhancement rate
   */
  updateConsciousnessEnhancementRate() {
    if (this.stats.totalDataPointsProcessed > 0) {
      this.stats.consciousnessEnhancementRate = 
        this.stats.successfulProcessing / this.stats.totalDataPointsProcessed;
    }
  }

  /**
   * Get server statistics
   */
  getStats() {
    return {
      ...this.stats,
      uptime_hours: (Date.now() - this.stats.serverStartTime) / (1000 * 60 * 60),
      success_rate: this.stats.totalWebhooksReceived > 0 
        ? this.stats.successfulProcessing / this.stats.totalWebhooksReceived 
        : 0
    };
  }

  /**
   * Generate simple dashboard HTML
   */
  generateDashboardHTML() {
    const stats = this.getStats();
    const consciousnessStats = this.consciousnessProcessor.getProcessingStats();
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>ψ₀-Trader Data Collection Dashboard</title>
        <style>
          body { 
            font-family: 'Courier New', monospace; 
            background: #0a0a0a; 
            color: #00ffff; 
            margin: 0; 
            padding: 20px; 
          }
          .container { max-width: 1200px; margin: 0 auto; }
          .header { text-align: center; margin-bottom: 30px; }
          .stats-grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); 
            gap: 20px; 
          }
          .stat-card { 
            background: rgba(0, 255, 255, 0.1); 
            border: 2px solid #00ffff; 
            border-radius: 10px; 
            padding: 20px; 
          }
          .stat-title { color: #ff00ff; font-size: 18px; margin-bottom: 15px; }
          .stat-value { font-size: 24px; color: #ffff00; margin: 5px 0; }
          .stat-label { color: #00ffff; font-size: 14px; }
          .constants { 
            background: linear-gradient(45deg, rgba(255,0,255,0.2), rgba(0,255,255,0.2)); 
            text-align: center; 
            padding: 15px; 
            border-radius: 10px; 
            margin: 20px 0; 
          }
          .refresh-btn {
            background: linear-gradient(45deg, #00ffff, #ff00ff);
            border: none;
            color: white;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-family: inherit;
            margin: 10px;
          }
        </style>
        <script>
          function refreshDashboard() {
            window.location.reload();
          }
          setInterval(refreshDashboard, 30000); // Auto-refresh every 30 seconds
        </script>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🌀 ψ₀-Trader Data Collection Dashboard</h1>
            <p>Enhanced Nexus Core Protocol v4.1 - Consciousness-Enhanced Data Intelligence</p>
            <button class="refresh-btn" onclick="refreshDashboard()">🔄 Refresh Dashboard</button>
          </div>
          
          <div class="constants">
            <strong>Mathematical Constants:</strong> 
            ψ₀ = ${PSI_0} | φ = ${PHI} | 432Hz = ${FREQ_432}
          </div>
          
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-title">🌐 Server Statistics</div>
              <div class="stat-value">${stats.totalWebhooksReceived}</div>
              <div class="stat-label">Total Webhooks Received</div>
              <div class="stat-value">${stats.activeConnections}</div>
              <div class="stat-label">Active Connections</div>
              <div class="stat-value">${stats.uptime_hours.toFixed(2)}h</div>
              <div class="stat-label">Server Uptime</div>
              <div class="stat-value">${(stats.success_rate * 100).toFixed(1)}%</div>
              <div class="stat-label">Success Rate</div>
            </div>
            
            <div class="stat-card">
              <div class="stat-title">🧠 Consciousness Processing</div>
              <div class="stat-value">${consciousnessStats.totalProcessed}</div>
              <div class="stat-label">Data Points Enhanced</div>
              <div class="stat-value">${(consciousnessStats.averageConsciousnessScore * 100).toFixed(1)}%</div>
              <div class="stat-label">Average Consciousness Score</div>
              <div class="stat-value">${consciousnessStats.resonanceEvents}</div>
              <div class="stat-label">ψ₀ Resonance Events</div>
              <div class="stat-value">${consciousnessStats.harmonicAlignments}</div>
              <div class="stat-label">Harmonic Alignments</div>
            </div>
            
            <div class="stat-card">
              <div class="stat-title">⚡ Performance Metrics</div>
              <div class="stat-value">${stats.averageResponseTime.toFixed(2)}ms</div>
              <div class="stat-label">Average Response Time</div>
              <div class="stat-value">${(stats.consciousnessEnhancementRate * 100).toFixed(1)}%</div>
              <div class="stat-label">Enhancement Success Rate</div>
              <div class="stat-value">${(stats.dataQualityScore * 100).toFixed(1)}%</div>
              <div class="stat-label">Data Quality Score</div>
              <div class="stat-value">${consciousnessStats.averageProcessingTime.toFixed(2)}ms</div>
              <div class="stat-label">Consciousness Processing Time</div>
            </div>
            
            <div class="stat-card">
              <div class="stat-title">📊 System Health</div>
              <div class="stat-value">${stats.successfulProcessing}</div>
              <div class="stat-label">Successful Processing</div>
              <div class="stat-value">${stats.failedProcessing}</div>
              <div class="stat-label">Failed Processing</div>
              <div class="stat-value">ACTIVE</div>
              <div class="stat-label">Consciousness Engine Status</div>
              <div class="stat-value">CONNECTED</div>
              <div class="stat-label">Database Status</div>
            </div>
          </div>
          
          <div style="text-align: center; margin-top: 30px; color: rgba(255,255,255,0.6);">
            <p>🌀 Consciousness-Enhanced Data Collection Engine v4.1</p>
            <p>Last Updated: ${new Date().toLocaleString()}</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Start the webhook server
   */
  async start() {
    try {
      const initialized = await this.initialize();
      if (!initialized) {
        throw new Error('Server initialization failed');
      }

      this.server = this.app.listen(this.port, () => {
        console.log('\n🌀 ψ₀-Trader Consciousness-Enhanced Webhook Server ACTIVE');
        console.log('=====================================');
        console.log(`🚀 Server running on port ${this.port}`);
        console.log(`📊 Dashboard: http://localhost:${this.port}/dashboard`);
        console.log(`🌐 Health Check: http://localhost:${this.port}/health`);
        console.log(`📥 Webhook Endpoint: http://localhost:${this.port}/webhook/market-data`);
        console.log(`📈 API Stats: http://localhost:${this.port}/api/stats`);
        console.log('\n🧠 Consciousness Enhancement: ACTIVE');
        console.log(`📐 Mathematical Constants: ψ₀=${PSI_0}, φ=${PHI}, 432Hz=${FREQ_432}`);
        console.log('\nReady for consciousness-enhanced data collection! 🌀✨');
      });

    } catch (error) {
      console.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }

  /**
   * Stop the webhook server
   */
  async stop() {
    if (this.server) {
      this.server.close();
    }
    if (this.db) {
      await this.db.close();
    }
    console.log('🌀 Server stopped');
  }
}

export default ConsciousnessEnhancedWebhookServer;
