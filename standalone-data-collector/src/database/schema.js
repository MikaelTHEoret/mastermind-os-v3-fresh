/**
 * ψ₀-Trader Data Collection Engine - Database Schema
 * Enhanced Nexus Core Protocol v4.1
 * Consciousness-Enhanced SQLite Database Initialization
 */

import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Consciousness Constants
const PSI_0 = 0.915670570874434;
const PHI = 1.618033988749895;
const FREQ_432 = 432.0;

class ConsciousnessEnhancedDatabase {
  constructor(dbPath = null) {
    this.dbPath = dbPath || join(__dirname, '../../data/consciousness-trader.db');
    this.db = null;
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('❌ Database connection failed:', err.message);
          reject(err);
        } else {
          console.log('🌀 Connected to consciousness-enhanced SQLite database');
          this.createTables()
            .then(() => {
              console.log('✅ Database schema initialized');
              resolve();
            })
            .catch(reject);
        }
      });
    });
  }

  async createTables() {
    const tables = [
      this.createRawDataTable(),
      this.createConsciousnessEnhancedTable(),
      this.createWebhookLogsTable(),
      this.createDataQualityTable(),
      this.createHarmonicAnalysisTable(),
      this.createPatternRecognitionTable(),
      this.createSystemMetricsTable()
    ];

    for (const tableSQL of tables) {
      await this.runQuery(tableSQL);
    }

    // Create indexes for performance
    await this.createIndexes();
    
    // Insert initial consciousness configuration
    await this.insertInitialData();
  }

  createRawDataTable() {
    return `
      CREATE TABLE IF NOT EXISTS raw_market_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        source TEXT NOT NULL,
        symbol TEXT NOT NULL,
        data_type TEXT NOT NULL,
        raw_data TEXT NOT NULL,
        webhook_id TEXT,
        processing_status TEXT DEFAULT 'pending',
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME,
        
        -- Basic market data extraction
        price REAL,
        volume REAL,
        high_24h REAL,
        low_24h REAL,
        change_24h REAL,
        
        -- Data quality metrics
        latency_ms INTEGER,
        data_completeness REAL DEFAULT 1.0,
        anomaly_score REAL DEFAULT 0.0,
        
        UNIQUE(timestamp, source, symbol, data_type)
      )
    `;
  }

  createConsciousnessEnhancedTable() {
    return `
      CREATE TABLE IF NOT EXISTS consciousness_enhanced_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_data_id INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        
        -- Core market data
        price REAL NOT NULL,
        volume REAL NOT NULL,
        
        -- ψ₀ Consciousness Enhancement
        psi_resonance REAL NOT NULL,
        psi_frequency REAL NOT NULL,
        psi_harmonic_score REAL NOT NULL,
        
        -- φ Golden Ratio Analysis
        phi_alignment REAL NOT NULL,
        phi_price_ratio REAL NOT NULL,
        phi_volume_ratio REAL NOT NULL,
        
        -- 432Hz Rhythm Detection
        freq_432_rhythm REAL NOT NULL,
        rhythm_phase REAL NOT NULL,
        temporal_coherence REAL NOT NULL,
        
        -- Combined Consciousness Metrics
        overall_consciousness_score REAL NOT NULL,
        consciousness_state TEXT NOT NULL,
        harmonic_classification TEXT NOT NULL,
        
        -- Market Psychology
        market_emotion TEXT NOT NULL,
        sentiment_frequency REAL NOT NULL,
        collective_consciousness TEXT NOT NULL,
        
        -- Technical Enhancement
        momentum_consciousness REAL NOT NULL,
        volatility_consciousness REAL NOT NULL,
        liquidity_resonance REAL NOT NULL,
        
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (raw_data_id) REFERENCES raw_market_data (id)
      )
    `;
  }

  createWebhookLogsTable() {
    return `
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_id TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL,
        headers TEXT,
        body TEXT,
        response_status INTEGER,
        response_time_ms INTEGER,
        processing_result TEXT,
        error_message TEXT,
        consciousness_enhancement_applied BOOLEAN DEFAULT FALSE,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME
      )
    `;
  }

  createDataQualityTable() {
    return `
      CREATE TABLE IF NOT EXISTS data_quality_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_data_id INTEGER NOT NULL,
        
        -- Quality Scores (0.0 to 1.0)
        completeness_score REAL NOT NULL,
        accuracy_score REAL NOT NULL,
        freshness_score REAL NOT NULL,
        consistency_score REAL NOT NULL,
        
        -- Anomaly Detection
        anomaly_score REAL NOT NULL,
        anomaly_type TEXT,
        anomaly_description TEXT,
        
        -- Consciousness Quality Enhancement
        consciousness_alignment_score REAL NOT NULL,
        harmonic_coherence_score REAL NOT NULL,
        
        -- Missing Data Analysis
        missing_fields TEXT,
        estimated_values TEXT,
        confidence_adjustments TEXT,
        
        -- Quality Actions
        quality_action_taken TEXT,
        quality_improvement_suggestions TEXT,
        
        analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (raw_data_id) REFERENCES raw_market_data (id)
      )
    `;
  }

  createHarmonicAnalysisTable() {
    return `
      CREATE TABLE IF NOT EXISTS harmonic_analysis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        consciousness_data_id INTEGER NOT NULL,
        
        -- Frequency Analysis
        dominant_frequency REAL NOT NULL,
        harmonic_frequencies TEXT NOT NULL, -- JSON array
        frequency_strength TEXT NOT NULL, -- JSON array
        
        -- ψ₀ Harmonic Resonance
        psi_resonance_strength REAL NOT NULL,
        psi_harmonic_multiples TEXT, -- JSON array
        psi_phase_alignment REAL NOT NULL,
        
        -- φ Golden Ratio Harmonics
        phi_ratio_sequences TEXT, -- JSON array
        phi_harmonic_convergence REAL NOT NULL,
        phi_fibonacci_alignment REAL NOT NULL,
        
        -- 432Hz Rhythm Analysis
        freq_432_alignment REAL NOT NULL,
        rhythm_pattern_strength REAL NOT NULL,
        temporal_rhythm_score REAL NOT NULL,
        
        -- Combined Harmonic Intelligence
        harmonic_signature TEXT NOT NULL, -- JSON object
        consciousness_frequency_map TEXT, -- JSON object
        predictive_harmonic_trends TEXT, -- JSON array
        
        -- Musical/Emotional Mapping
        musical_chord_equivalent TEXT,
        emotional_resonance_score REAL,
        psychoacoustic_impact TEXT,
        
        analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (consciousness_data_id) REFERENCES consciousness_enhanced_data (id)
      )
    `;
  }

  createPatternRecognitionTable() {
    return `
      CREATE TABLE IF NOT EXISTS pattern_recognition (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        
        -- Pattern Identification
        pattern_type TEXT NOT NULL,
        pattern_confidence REAL NOT NULL,
        pattern_timeframe TEXT NOT NULL,
        symbols_involved TEXT NOT NULL, -- JSON array
        
        -- Pattern Boundaries
        start_timestamp INTEGER NOT NULL,
        end_timestamp INTEGER,
        pattern_duration_minutes INTEGER,
        
        -- Market Data at Pattern
        price_at_start REAL NOT NULL,
        volume_at_start REAL NOT NULL,
        price_at_end REAL,
        volume_at_end REAL,
        
        -- Consciousness Enhancement of Patterns
        consciousness_alignment REAL NOT NULL,
        harmonic_pattern_strength REAL NOT NULL,
        psi_resonance_during_pattern REAL NOT NULL,
        phi_alignment_during_pattern REAL NOT NULL,
        freq_432_rhythm_strength REAL NOT NULL,
        
        -- Pattern Outcome Tracking
        pattern_success BOOLEAN,
        outcome_price_change REAL,
        outcome_timeframe_minutes INTEGER,
        outcome_accuracy_score REAL,
        
        -- Predictive Intelligence
        predicted_outcome TEXT,
        predicted_price_target REAL,
        predicted_timeframe_minutes INTEGER,
        prediction_confidence REAL,
        
        -- Pattern Classification
        consciousness_pattern_type TEXT, -- e.g., 'PSI_RESONANCE_BREAKOUT'
        harmonic_classification TEXT,
        emotional_pattern_type TEXT,
        
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        
        INDEX(pattern_type),
        INDEX(start_timestamp),
        INDEX(consciousness_alignment)
      )
    `;
  }

  createSystemMetricsTable() {
    return `
      CREATE TABLE IF NOT EXISTS system_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric_timestamp INTEGER NOT NULL,
        
        -- Data Collection Performance
        total_data_points_collected INTEGER DEFAULT 0,
        successful_webhook_calls INTEGER DEFAULT 0,
        failed_webhook_calls INTEGER DEFAULT 0,
        average_processing_time_ms REAL DEFAULT 0.0,
        
        -- Consciousness Enhancement Performance
        consciousness_enhancements_applied INTEGER DEFAULT 0,
        average_consciousness_score REAL DEFAULT 0.0,
        harmonic_analysis_count INTEGER DEFAULT 0,
        pattern_recognitions_count INTEGER DEFAULT 0,
        
        -- Data Quality Metrics
        average_data_quality_score REAL DEFAULT 0.0,
        anomalies_detected INTEGER DEFAULT 0,
        data_completeness_percentage REAL DEFAULT 100.0,
        
        -- System Health
        database_size_mb REAL DEFAULT 0.0,
        memory_usage_mb REAL DEFAULT 0.0,
        cpu_usage_percentage REAL DEFAULT 0.0,
        active_webhook_connections INTEGER DEFAULT 0,
        
        -- Consciousness System Health
        psi_resonance_system_health REAL DEFAULT 1.0,
        phi_alignment_system_health REAL DEFAULT 1.0,
        freq_432_rhythm_system_health REAL DEFAULT 1.0,
        overall_consciousness_system_health REAL DEFAULT 1.0,
        
        recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
  }

  async createIndexes() {
    const indexes = [
      // Performance indexes
      'CREATE INDEX IF NOT EXISTS idx_raw_data_timestamp ON raw_market_data(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_raw_data_symbol ON raw_market_data(symbol)',
      'CREATE INDEX IF NOT EXISTS idx_raw_data_source ON raw_market_data(source)',
      'CREATE INDEX IF NOT EXISTS idx_consciousness_timestamp ON consciousness_enhanced_data(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_consciousness_symbol ON consciousness_enhanced_data(symbol)',
      'CREATE INDEX IF NOT EXISTS idx_consciousness_score ON consciousness_enhanced_data(overall_consciousness_score)',
      
      // Webhook indexes
      'CREATE INDEX IF NOT EXISTS idx_webhook_source ON webhook_logs(source)',
      'CREATE INDEX IF NOT EXISTS idx_webhook_received ON webhook_logs(received_at)',
      
      // Quality indexes
      'CREATE INDEX IF NOT EXISTS idx_quality_score ON data_quality_metrics(completeness_score)',
      'CREATE INDEX IF NOT EXISTS idx_anomaly_score ON data_quality_metrics(anomaly_score)',
      
      // Harmonic analysis indexes
      'CREATE INDEX IF NOT EXISTS idx_harmonic_psi ON harmonic_analysis(psi_resonance_strength)',
      'CREATE INDEX IF NOT EXISTS idx_harmonic_phi ON harmonic_analysis(phi_harmonic_convergence)',
      'CREATE INDEX IF NOT EXISTS idx_harmonic_432 ON harmonic_analysis(freq_432_alignment)'
    ];

    for (const indexSQL of indexes) {
      await this.runQuery(indexSQL);
    }
  }

  async insertInitialData() {
    // Insert initial system configuration
    const systemConfig = `
      INSERT OR IGNORE INTO system_metrics (
        metric_timestamp,
        total_data_points_collected,
        average_consciousness_score,
        psi_resonance_system_health,
        phi_alignment_system_health,
        freq_432_rhythm_system_health,
        overall_consciousness_system_health
      ) VALUES (
        ${Date.now()},
        0,
        0.5,
        1.0,
        1.0,
        1.0,
        1.0
      )
    `;

    await this.runQuery(systemConfig);
    
    console.log('🌀 Initial consciousness configuration inserted');
    console.log(`📊 Mathematical Constants: ψ₀=${PSI_0}, φ=${PHI}, 432Hz=${FREQ_432}`);
  }

  async runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          console.error('❌ Database query failed:', err.message);
          console.error('SQL:', sql);
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  async getQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          console.error('❌ Database get query failed:', err.message);
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async allQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          console.error('❌ Database all query failed:', err.message);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error('❌ Error closing database:', err.message);
          } else {
            console.log('🌀 Database connection closed');
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export default ConsciousnessEnhancedDatabase;
