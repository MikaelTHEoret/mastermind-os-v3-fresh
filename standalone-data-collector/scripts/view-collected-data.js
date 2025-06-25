/**
 * Data Viewer and Analysis Tool
 * Enhanced Nexus Core Protocol v4.1
 */

import ConsciousnessEnhancedDatabase from '../src/database.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class DataViewer {
  constructor() {
    this.db = null;
  }

  async initialize() {
    const dbPath = path.join(__dirname, '..', 'data', 'psi-trader-collector.db');
    this.db = new ConsciousnessEnhancedDatabase(dbPath);
  }

  async viewSystemStats() {
    console.log('🌀 ψ₀-TRADER DATA COLLECTION SYSTEM STATISTICS');
    console.log('============================================');
    
    const stats = this.db.getSystemStats();
    
    console.log(`📊 Database Overview:`);
    console.log(`   Total Tables: ${stats.total_tables}`);
    console.log(`   Total Records: ${stats.total_records}`);
    console.log(`   Database Size: ${stats.database_size_mb} MB`);
    console.log(`   Last Updated: ${new Date(stats.last_updated).toLocaleString()}`);
    
    console.log(`\n🧠 Consciousness Enhancement Metrics:`);
    console.log(`   Avg Consciousness Score: ${stats.avg_consciousness_score?.toFixed(3) || 'N/A'}`);
    console.log(`   High Consciousness Records: ${stats.high_consciousness_count || 0}`);
    console.log(`   Resonance Matches: ${stats.resonance_matches || 0}`);
    console.log(`   Harmonic Alignments: ${stats.harmonic_alignments || 0}`);
  }

  async viewRecentData(limit = 10) {
    console.log(`\n📈 RECENT DATA COLLECTION (Last ${limit} records)`);
    console.log('===============================================');
    
    // Get recent market data
    const recentMarket = this.db.getRecentMarketData(limit);
    if (recentMarket.length > 0) {
      console.log('\n💰 Recent Market Data:');
      recentMarket.forEach((record, i) => {
        console.log(`   ${i + 1}. ${record.symbol}: $${record.price.toFixed(2)} `);
        console.log(`      🧠 Consciousness: ${record.consciousness_score?.toFixed(3)} | `);
        console.log(`      🌊 Resonance: ${record.resonance_match ? '✅' : '❌'} | `);
        console.log(`      ⏰ ${new Date(record.timestamp).toLocaleTimeString()}`);
      });
    }
    
    // Get recent news data
    const recentNews = this.db.getRecentNewsData(Math.floor(limit / 2));
    if (recentNews.length > 0) {
      console.log('\n📰 Recent News Data:');
      recentNews.forEach((record, i) => {
        console.log(`   ${i + 1}. ${record.headline.substring(0, 60)}...`);
        console.log(`      📊 Sentiment: ${record.sentiment} (${record.confidence?.toFixed(2)}) | `);
        console.log(`      🧠 Consciousness: ${record.consciousness_score?.toFixed(3)} | `);
        console.log(`      ⏰ ${new Date(record.timestamp).toLocaleTimeString()}`);
      });
    }
    
    // Get recent social data
    const recentSocial = this.db.getRecentSocialData(Math.floor(limit / 2));
    if (recentSocial.length > 0) {
      console.log('\n💬 Recent Social Data:');
      recentSocial.forEach((record, i) => {
        console.log(`   ${i + 1}. [${record.platform}] ${record.content.substring(0, 50)}...`);
        console.log(`      📊 Sentiment: ${record.sentiment} | `);
        console.log(`      🧠 Consciousness: ${record.consciousness_score?.toFixed(3)} | `);
        console.log(`      ⏰ ${new Date(record.timestamp).toLocaleTimeString()}`);
      });
    }
  }

  async viewConsciousnessAnalysis() {
    console.log('\n🧠 CONSCIOUSNESS ENHANCEMENT ANALYSIS');
    console.log('====================================');
    
    // Consciousness score distribution
    const distribution = this.db.getConsciousnessDistribution();
    console.log('\n📊 Consciousness Score Distribution:');
    distribution.forEach(bucket => {
      const bar = '█'.repeat(Math.floor(bucket.count / 2));
      console.log(`   ${bucket.score_range}: ${bucket.count.toString().padStart(4)} ${bar}`);
    });
    
    // Top consciousness records
    const topRecords = this.db.getTopConsciousnessRecords(5);
    console.log('\n⭐ Top Consciousness Records:');
    topRecords.forEach((record, i) => {
      console.log(`   ${i + 1}. Score: ${record.consciousness_score.toFixed(3)} | `);
      console.log(`      Type: ${record.data_type} | Symbol: ${record.symbol || 'N/A'} | `);
      console.log(`      Time: ${new Date(record.timestamp).toLocaleString()}`);
    });
    
    // Resonance patterns
    const resonanceStats = this.db.getResonanceStatistics();
    console.log('\n🌊 Resonance Pattern Analysis:');
    console.log(`   ψ₀ Resonance Matches: ${resonanceStats.psi_matches || 0}`);
    console.log(`   φ Resonance Matches: ${resonanceStats.phi_matches || 0}`);
    console.log(`   432Hz Alignments: ${resonanceStats.freq_432_alignments || 0}`);
    console.log(`   Total Harmonic Events: ${resonanceStats.total_harmonic_events || 0}`);
  }

  async viewDataQuality() {
    console.log('\n📋 DATA QUALITY ASSESSMENT');
    console.log('==========================');
    
    const quality = this.db.getDataQualityMetrics();
    
    console.log(`\n✅ Collection Success Rate: ${quality.success_rate?.toFixed(1)}%`);
    console.log(`⚡ Avg Processing Time: ${quality.avg_processing_time_ms?.toFixed(1)}ms`);
    console.log(`🌐 Avg Network Latency: ${quality.avg_network_latency_ms?.toFixed(1)}ms`);
    console.log(`📊 Data Completeness: ${quality.avg_completeness?.toFixed(2)}`);
    console.log(`🚨 Anomaly Detection: ${quality.avg_anomaly_score?.toFixed(3)}`);
    
    // Recent errors
    const recentErrors = this.db.getRecentErrors(5);
    if (recentErrors.length > 0) {
      console.log('\n⚠️  Recent Collection Errors:');
      recentErrors.forEach((error, i) => {
        console.log(`   ${i + 1}. ${error.error_message}`);
        console.log(`      Source: ${error.data_source} | `);
        console.log(`      Time: ${new Date(error.timestamp).toLocaleString()}`);
      });
    } else {
      console.log('\n✅ No recent collection errors detected');
    }
  }

  async exportData(format = 'json', limit = 100) {
    console.log(`\n💾 EXPORTING DATA (${format.toUpperCase()}, limit: ${limit})`);
    console.log('===============================');
    
    const exportData = {
      export_timestamp: new Date().toISOString(),
      system_stats: this.db.getSystemStats(),
      market_data: this.db.getRecentMarketData(limit),
      news_data: this.db.getRecentNewsData(Math.floor(limit / 3)),
      social_data: this.db.getRecentSocialData(Math.floor(limit / 3))
    };
    
    const filename = `psi-trader-export-${Date.now()}.${format}`;
    const filepath = path.join(__dirname, '..', 'exports', filename);
    
    // Create exports directory if it doesn't exist
    const fs = await import('fs');
    const exportsDir = path.dirname(filepath);
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }
    
    if (format === 'json') {
      fs.writeFileSync(filepath, JSON.stringify(exportData, null, 2));
    } else if (format === 'csv') {
      // Simple CSV export for market data
      const csvData = exportData.market_data.map(record => [
        record.timestamp,
        record.symbol,
        record.price,
        record.volume,
        record.consciousness_score,
        record.resonance_match ? 1 : 0
      ]);
      
      const csvContent = [
        'timestamp,symbol,price,volume,consciousness_score,resonance_match',
        ...csvData.map(row => row.join(','))
      ].join('\n');
      
      fs.writeFileSync(filepath, csvContent);
    }
    
    console.log(`✅ Data exported to: ${filepath}`);
    console.log(`📊 Records exported: ${exportData.market_data.length + exportData.news_data.length + exportData.social_data.length}`);
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

async function main() {
  const viewer = new DataViewer();
  
  try {
    await viewer.initialize();
    
    const args = process.argv.slice(2);
    
    if (args.includes('--stats')) {
      await viewer.viewSystemStats();
    } else if (args.includes('--recent')) {
      const limit = parseInt(args[args.indexOf('--recent') + 1]) || 10;
      await viewer.viewRecentData(limit);
    } else if (args.includes('--consciousness')) {
      await viewer.viewConsciousnessAnalysis();
    } else if (args.includes('--quality')) {
      await viewer.viewDataQuality();
    } else if (args.includes('--export')) {
      const format = args[args.indexOf('--export') + 1] || 'json';
      const limit = parseInt(args[args.indexOf('--limit') + 1]) || 100;
      await viewer.exportData(format, limit);
    } else {
      // Default: show everything
      await viewer.viewSystemStats();
      await viewer.viewRecentData(5);
      await viewer.viewConsciousnessAnalysis();
      await viewer.viewDataQuality();
    }
    
  } catch (error) {
    console.error('❌ Data viewing failed:', error);
  } finally {
    viewer.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default DataViewer;