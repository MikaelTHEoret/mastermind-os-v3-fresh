/**
 * ψ₀-Trader Data Collector Test Suite
 * Enhanced Nexus Core Protocol v4.1
 */

import ConsciousnessEnhancedDatabase from '../src/database.js';
import ConsciousnessProcessor from '../src/consciousness-processor.js';
import ConsciousnessEnhancedWebhookServer from '../src/server.js';
import SampleDataGenerator from '../scripts/generate-sample-data.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class TestSuite {
  constructor() {
    this.testResults = [];
    this.db = null;
    this.processor = new ConsciousnessProcessor();
    this.server = null;
  }

  async runTest(testName, testFunction) {
    console.log(`🧪 Running test: ${testName}`);
    
    try {
      const startTime = Date.now();
      await testFunction();
      const duration = Date.now() - startTime;
      
      this.testResults.push({
        name: testName,
        status: 'PASSED',
        duration: `${duration}ms`
      });
      
      console.log(`✅ ${testName} - PASSED (${duration}ms)`);
      
    } catch (error) {
      this.testResults.push({
        name: testName,
        status: 'FAILED',
        error: error.message
      });
      
      console.error(`❌ ${testName} - FAILED: ${error.message}`);
    }
  }

  async testDatabaseOperations() {
    // Initialize test database
    const testDbPath = path.join(__dirname, '..', 'data', 'test-psi-trader.db');
    this.db = new ConsciousnessEnhancedDatabase(testDbPath);
    
    // Test market data storage
    const marketData = {
      symbol: 'BTC/USDT',
      price: 45000,
      volume: 1000000,
      timestamp: Date.now(),
      consciousness_score: 0.856,
      resonance_match: true,
      harmonic_frequencies: [395.57, 699.39],
      consciousness_state: 'BALANCED_AMPLIFIED'
    };
    
    await this.db.storeMarketData(marketData);
    
    // Test data retrieval
    const recentData = this.db.getRecentMarketData(1);
    if (recentData.length === 0) {
      throw new Error('Failed to retrieve stored market data');
    }
    
    // Test statistics
    const stats = this.db.getSystemStats();
    if (stats.total_records === 0) {
      throw new Error('System stats not updating correctly');
    }
  }

  async testConsciousnessProcessing() {
    // Test market data enhancement
    const rawMarketData = {
      symbol: 'ETH/USDT',
      price: 2800,
      volume: 500000,
      timestamp: Date.now(),
      source: 'test'
    };
    
    const enhanced = await this.processor.enhanceMarketData(rawMarketData);
    
    if (!enhanced.consciousness_score) {
      throw new Error('Consciousness score not calculated');
    }
    
    if (enhanced.consciousness_score < 0 || enhanced.consciousness_score > 1) {
      throw new Error('Consciousness score out of valid range');
    }
    
    // Test news data enhancement
    const rawNewsData = {
      headline: 'Bitcoin breaks resistance, rallies to new highs',
      content: 'Market sentiment turns bullish as Bitcoin surges past key levels...',
      sentiment: 'BULLISH',
      confidence: 0.85,
      timestamp: Date.now(),
      source: 'test'
    };
    
    const enhancedNews = await this.processor.enhanceNewsData(rawNewsData);
    
    if (!enhancedNews.consciousness_score) {
      throw new Error('News consciousness enhancement failed');
    }
  }

  async testServerOperations() {
    // Initialize server on test port
    this.server = new ConsciousnessEnhancedWebhookServer(3002);
    
    // Start server
    await this.server.start();
    
    // Test health endpoint
    const response = await fetch('http://localhost:3002/health');
    const health = await response.json();
    
    if (!health.status || health.status !== 'healthy') {
      throw new Error('Server health check failed');
    }
    
    // Test webhook endpoint
    const testPayload = {
      type: 'market_data',
      data: {
        symbol: 'BTC/USDT',
        price: 45000,
        volume: 1000000,
        timestamp: Date.now()
      }
    };
    
    const webhookResponse = await fetch('http://localhost:3002/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testPayload)
    });
    
    if (!webhookResponse.ok) {
      throw new Error('Webhook endpoint failed');
    }
    
    // Stop server
    await this.server.stop();
  }

  async testSampleDataGeneration() {
    const generator = new SampleDataGenerator();
    await generator.initialize();
    
    // Generate test batch
    const records = await generator.generateSampleBatch(10);
    
    if (records.length !== 10) {
      throw new Error('Sample data generation count mismatch');
    }
    
    // Verify different data types were generated
    const types = [...new Set(records.map(r => r.type))];
    if (types.length < 2) {
      throw new Error('Insufficient data type variety in sample generation');
    }
    
    generator.close();
  }

  async testMathematicalConstants() {
    // Test ψ₀ calculations
    const PSI_0 = 0.915670570874434;
    const calculatedPsi = this.processor.calculatePsiResonance(0.915);
    
    if (calculatedPsi < 0 || calculatedPsi > 1) {
      throw new Error('ψ₀ resonance calculation out of range');
    }
    
    // Test φ calculations
    const PHI = 1.618033988749895;
    const calculatedPhi = this.processor.calculatePhiAlignment(1.618);
    
    if (calculatedPhi < 0 || calculatedPhi > 1) {
      throw new Error('φ alignment calculation out of range');
    }
    
    // Test 432Hz calculations
    const freq432 = this.processor.calculate432HzResonance(432);
    
    if (freq432 < 0 || freq432 > 1) {
      throw new Error('432Hz resonance calculation out of range');
    }
  }

  async testDataIntegrity() {
    if (!this.db) {
      this.db = new ConsciousnessEnhancedDatabase();
    }
    
    // Test data constraints
    try {
      await this.db.storeMarketData({
        symbol: null, // Should fail
        price: 'invalid',
        timestamp: Date.now()
      });
      
      throw new Error('Database accepted invalid data');
    } catch (error) {
      // Expected to fail - this is good
      if (!error.message.includes('constraint') && !error.message.includes('invalid')) {
        throw new Error('Database validation not working properly');
      }
    }
    
    // Test consciousness score bounds
    const validData = {
      symbol: 'TEST/USDT',
      price: 100,
      volume: 1000,
      timestamp: Date.now(),
      consciousness_score: 1.5, // Invalid - should be clamped
      resonance_match: false
    };
    
    await this.db.storeMarketData(validData);
    const stored = this.db.getRecentMarketData(1)[0];
    
    if (stored.consciousness_score > 1) {
      throw new Error('Consciousness score not properly bounded');
    }
  }

  async testPerformance() {
    if (!this.db) {
      this.db = new ConsciousnessEnhancedDatabase();
    }
    
    const startTime = Date.now();
    const batchSize = 100;
    
    // Test bulk data processing performance
    for (let i = 0; i < batchSize; i++) {
      const testData = {
        symbol: 'PERF/TEST',
        price: 100 + Math.random() * 10,
        volume: Math.floor(Math.random() * 1000000),
        timestamp: Date.now(),
        consciousness_score: Math.random(),
        resonance_match: Math.random() > 0.5
      };
      
      await this.db.storeMarketData(testData);
    }
    
    const duration = Date.now() - startTime;
    const recordsPerSecond = (batchSize / duration) * 1000;
    
    console.log(`📊 Performance: ${recordsPerSecond.toFixed(1)} records/second`);
    
    if (recordsPerSecond < 10) {
      throw new Error('Performance below acceptable threshold');
    }
  }

  async runAllTests() {
    console.log('🌀 ψ₀-TRADER DATA COLLECTOR TEST SUITE');
    console.log('Enhanced Nexus Core Protocol v4.1');
    console.log('====================================');
    
    await this.runTest('Database Operations', () => this.testDatabaseOperations());
    await this.runTest('Consciousness Processing', () => this.testConsciousnessProcessing());
    await this.runTest('Server Operations', () => this.testServerOperations());
    await this.runTest('Sample Data Generation', () => this.testSampleDataGeneration());
    await this.runTest('Mathematical Constants', () => this.testMathematicalConstants());
    await this.runTest('Data Integrity', () => this.testDataIntegrity());
    await this.runTest('Performance', () => this.testPerformance());
    
    // Display results
    console.log('\n📋 TEST RESULTS SUMMARY');
    console.log('======================');
    
    const passed = this.testResults.filter(r => r.status === 'PASSED').length;
    const failed = this.testResults.filter(r => r.status === 'FAILED').length;
    
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Success Rate: ${((passed / this.testResults.length) * 100).toFixed(1)}%`);
    
    // Show failed tests
    const failedTests = this.testResults.filter(r => r.status === 'FAILED');
    if (failedTests.length > 0) {
      console.log('\n⚠️  Failed Tests:');
      failedTests.forEach(test => {
        console.log(`   ${test.name}: ${test.error}`);
      });
    }
    
    // Cleanup
    if (this.db) {
      this.db.close();
    }
    
    return { passed, failed, total: this.testResults.length };
  }
}

async function main() {
  const testSuite = new TestSuite();
  
  try {
    const results = await testSuite.runAllTests();
    
    // Exit with appropriate code
    if (results.failed > 0) {
      process.exit(1);
    } else {
      console.log('\n🌀 All tests passed! System ready for deployment.');
      process.exit(0);
    }
    
  } catch (error) {
    console.error('❌ Test suite execution failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default TestSuite;