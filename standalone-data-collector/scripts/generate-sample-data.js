/**
 * Sample Data Generator
 * Enhanced Nexus Core Protocol v4.1 - Consciousness-Enhanced Test Data
 */

import ConsciousnessEnhancedDatabase from '../src/database.js';
import ConsciousnessProcessor from '../src/consciousness-processor.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class SampleDataGenerator {
  constructor() {
    this.symbols = ['BTC/USDT', 'ETH/USDT', 'BTCC.TO', 'SOL/USDT', 'ADA/USDT'];
    this.processor = new ConsciousnessProcessor();
    this.db = null;
  }

  async initialize() {
    const dbPath = path.join(__dirname, '..', 'data', 'psi-trader-collector.db');
    this.db = new ConsciousnessEnhancedDatabase(dbPath);
  }

  generateRandomMarketData(symbol) {
    const basePrice = this.getBasePrice(symbol);
    const variation = 0.02; // 2% max variation
    
    return {
      symbol,
      price: basePrice * (1 + (Math.random() - 0.5) * variation),
      volume: Math.floor(Math.random() * 1000000) + 100000,
      change_24h: (Math.random() - 0.5) * 10, // -5% to +5%
      high_24h: basePrice * (1 + Math.random() * variation),
      low_24h: basePrice * (1 - Math.random() * variation),
      timestamp: Date.now(),
      source: 'sample_generator'
    };
  }

  generateRandomNewsData() {
    const headlines = [
      'Bitcoin reaches new psychological resistance level',
      'Ethereum network activity shows increased adoption',
      'BTCC ETF experiences significant volume surge',
      'Crypto market sentiment shifts to bullish territory',
      'Technical analysis indicates potential breakout pattern',
      'Institutional investors increase cryptocurrency exposure',
      'Regulatory clarity boosts market confidence',
      'DeFi protocol launches innovative yield strategy'
    ];

    const sentiments = ['BULLISH', 'BEARISH', 'NEUTRAL'];
    
    return {
      headline: headlines[Math.floor(Math.random() * headlines.length)],
      content: 'Sample news content with market implications...',
      sentiment: sentiments[Math.floor(Math.random() * sentiments.length)],
      confidence: 0.6 + Math.random() * 0.4, // 0.6 to 1.0
      timestamp: Date.now(),
      source: 'sample_generator',
      symbols_mentioned: [this.symbols[Math.floor(Math.random() * this.symbols.length)]]
    };
  }

  generateRandomSocialData() {
    const platforms = ['twitter', 'reddit', 'telegram'];
    const sentiments = ['POSITIVE', 'NEGATIVE', 'NEUTRAL'];
    
    return {
      platform: platforms[Math.floor(Math.random() * platforms.length)],
      content: 'Sample social media content about cryptocurrency...',
      sentiment: sentiments[Math.floor(Math.random() * sentiments.length)],
      engagement_score: Math.random(),
      follower_count: Math.floor(Math.random() * 100000) + 1000,
      timestamp: Date.now(),
      source: 'sample_generator'
    };
  }

  getBasePrice(symbol) {
    const basePrices = {
      'BTC/USDT': 45000,
      'ETH/USDT': 2800,
      'BTCC.TO': 45.50,
      'SOL/USDT': 95,
      'ADA/USDT': 0.65
    };
    return basePrices[symbol] || 100;
  }

  async generateSampleBatch(count = 50) {
    console.log(`🌀 Generating ${count} sample records with consciousness enhancement...`);
    
    const records = [];
    
    for (let i = 0; i < count; i++) {
      // Generate different types of data
      const dataType = Math.random();
      let rawData;
      
      if (dataType < 0.6) {
        // 60% market data
        rawData = this.generateRandomMarketData(
          this.symbols[Math.floor(Math.random() * this.symbols.length)]
        );
        
        // Process through consciousness enhancement
        const enhancedData = await this.processor.enhanceMarketData(rawData);
        await this.db.storeMarketData(enhancedData);
        records.push({ type: 'market', data: enhancedData });
        
      } else if (dataType < 0.8) {
        // 20% news data
        rawData = this.generateRandomNewsData();
        
        const enhancedData = await this.processor.enhanceNewsData(rawData);
        await this.db.storeNewsData(enhancedData);
        records.push({ type: 'news', data: enhancedData });
        
      } else {
        // 20% social data
        rawData = this.generateRandomSocialData();
        
        const enhancedData = await this.processor.enhanceSocialData(rawData);
        await this.db.storeSocialData(enhancedData);
        records.push({ type: 'social', data: enhancedData });
      }
      
      // Small delay to create realistic timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    console.log(`✅ Generated ${records.length} consciousness-enhanced records`);
    return records;
  }

  async generateContinuousData(intervalSeconds = 30, durationMinutes = 5) {
    console.log(`🔄 Starting continuous data generation...`);
    console.log(`   Interval: ${intervalSeconds}s`);
    console.log(`   Duration: ${durationMinutes} minutes`);
    
    const endTime = Date.now() + (durationMinutes * 60 * 1000);
    let count = 0;
    
    while (Date.now() < endTime) {
      await this.generateSampleBatch(5); // Generate 5 records per interval
      count += 5;
      
      console.log(`📊 Generated ${count} total records...`);
      
      // Wait for next interval
      await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
    }
    
    console.log(`✅ Continuous generation complete. Total records: ${count}`);
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

async function main() {
  const generator = new SampleDataGenerator();
  
  try {
    await generator.initialize();
    
    // Check command line arguments
    const args = process.argv.slice(2);
    
    if (args.includes('--continuous')) {
      const intervalSeconds = parseInt(args[args.indexOf('--interval') + 1]) || 30;
      const durationMinutes = parseInt(args[args.indexOf('--duration') + 1]) || 5;
      await generator.generateContinuousData(intervalSeconds, durationMinutes);
    } else {
      const count = parseInt(args[0]) || 50;
      await generator.generateSampleBatch(count);
    }
    
  } catch (error) {
    console.error('❌ Sample data generation failed:', error);
  } finally {
    generator.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default SampleDataGenerator;