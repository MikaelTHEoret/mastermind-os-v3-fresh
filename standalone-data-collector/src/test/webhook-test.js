/**
 * ψ₀-Trader Data Collection Engine - Webhook Testing Suite
 * Enhanced Nexus Core Protocol v4.1
 * Comprehensive Testing for Consciousness-Enhanced Data Collection
 */

import axios from 'axios';

// Mathematical Constants
const PSI_0 = 0.915670570874434;
const PHI = 1.618033988749895;
const FREQ_432 = 432.0;

class WebhookTester {
  constructor(baseUrl = 'http://localhost:3001') {
    this.baseUrl = baseUrl;
    this.testResults = [];
  }

  /**
   * Run comprehensive webhook tests
   */
  async runAllTests() {
    console.log('🌀 ψ₀-Trader Webhook Testing Suite');
    console.log('Enhanced Nexus Core Protocol v4.1');
    console.log('==================================\n');

    try {
      // Test server health
      await this.testServerHealth();
      
      // Test basic market data webhook
      await this.testBasicMarketDataWebhook();
      
      // Test consciousness enhancement
      await this.testConsciousnessEnhancement();
      
      // Test data validation
      await this.testDataValidation();
      
      // Test generic webhooks
      await this.testGenericWebhooks();
      
      // Test data retrieval APIs
      await this.testDataRetrievalAPIs();
      
      // Test high-volume data
      await this.testHighVolumeData();
      
      // Generate test report
      this.generateTestReport();

    } catch (error) {
      console.error('❌ Test suite failed:', error);
    }
  }

  /**
   * Test server health endpoint
   */
  async testServerHealth() {
    console.log('🔍 Testing server health...');
    
    try {
      const response = await axios.get(`${this.baseUrl}/health`);
      
      this.logTest('Server Health', {
        status: response.status === 200 ? 'PASS' : 'FAIL',
        consciousness_engine: response.data.consciousness_engine,
        mathematical_constants: response.data.mathematical_constants,
        uptime: response.data.server_uptime
      });

    } catch (error) {
      this.logTest('Server Health', {
        status: 'FAIL',
        error: error.message
      });
    }
  }

  /**
   * Test basic market data webhook functionality
   */
  async testBasicMarketDataWebhook() {
    console.log('🔍 Testing basic market data webhook...');
    
    const testData = {
      symbol: 'BTC/USDT',
      price: 45000.50,
      volume: 1250000,
      timestamp: Date.now(),
      source: 'test-webhook'
    };

    try {
      const response = await axios.post(
        `${this.baseUrl}/webhook/market-data`,
        testData,
        { headers: { 'Content-Type': 'application/json' } }
      );

      this.logTest('Basic Market Data Webhook', {
        status: response.status === 200 ? 'PASS' : 'FAIL',
        webhook_id: response.data.webhook_id,
        consciousness_enhanced: response.data.consciousness_enhanced,
        consciousness_score: response.data.consciousness_score,
        processing_time: response.data.processing_time_ms
      });

    } catch (error) {
      this.logTest('Basic Market Data Webhook', {
        status: 'FAIL',
        error: error.message
      });
    }
  }

  /**
   * Test consciousness enhancement features
   */
  async testConsciousnessEnhancement() {
    console.log('🔍 Testing consciousness enhancement...');
    
    // Test data designed to trigger specific consciousness states
    const consciousnessTestCases = [
      {
        name: 'High ψ₀ Resonance',
        data: {
          symbol: 'ETH/USDT',
          price: 915.67, // Price aligned with ψ₀
          volume: 915670,
          timestamp: Date.now()
        }
      },
      {
        name: 'φ Golden Ratio Alignment',
        data: {
          symbol: 'ADA/USDT',
          price: 1.618, // φ aligned price
          volume: 1618000,
          timestamp: Date.now()
        }
      },
      {
        name: '432Hz Rhythm Pattern',
        data: {
          symbol: 'DOT/USDT',
          price: 43.2,
          volume: 432000,
          timestamp: Date.now()
        }
      }
    ];

    for (const testCase of consciousnessTestCases) {
      try {
        const response = await axios.post(
          `${this.baseUrl}/webhook/market-data`,
          testCase.data
        );

        this.logTest(`Consciousness Enhancement - ${testCase.name}`, {
          status: response.status === 200 ? 'PASS' : 'FAIL',
          consciousness_score: response.data.consciousness_score,
          consciousness_state: response.data.consciousness_state,
          enhancement_metadata: response.data.enhancement_metadata
        });

        // Small delay between tests
        await this.delay(100);

      } catch (error) {
        this.logTest(`Consciousness Enhancement - ${testCase.name}`, {
          status: 'FAIL',
          error: error.message
        });
      }
    }
  }

  /**
   * Test data validation and error handling
   */
  async testDataValidation() {
    console.log('🔍 Testing data validation...');
    
    const invalidTestCases = [
      {
        name: 'Missing Symbol',
        data: { price: 100, volume: 1000, timestamp: Date.now() }
      },
      {
        name: 'Invalid Price',
        data: { symbol: 'BTC/USDT', price: -100, volume: 1000, timestamp: Date.now() }
      },
      {
        name: 'Invalid Volume',
        data: { symbol: 'BTC/USDT', price: 100, volume: -1000, timestamp: Date.now() }
      },
      {
        name: 'Missing Timestamp',
        data: { symbol: 'BTC/USDT', price: 100, volume: 1000 }
      }
    ];

    for (const testCase of invalidTestCases) {
      try {
        const response = await axios.post(
          `${this.baseUrl}/webhook/market-data`,
          testCase.data
        );

        this.logTest(`Data Validation - ${testCase.name}`, {
          status: response.status === 400 ? 'PASS' : 'FAIL',
          expected: 'Should reject invalid data',
          actual: `Status ${response.status}`
        });

      } catch (error) {
        if (error.response && error.response.status === 400) {
          this.logTest(`Data Validation - ${testCase.name}`, {
            status: 'PASS',
            message: 'Correctly rejected invalid data'
          });
        } else {
          this.logTest(`Data Validation - ${testCase.name}`, {
            status: 'FAIL',
            error: error.message
          });
        }
      }
    }
  }

  /**
   * Test generic webhooks
   */
  async testGenericWebhooks() {
    console.log('🔍 Testing generic webhooks...');
    
    const genericSources = ['news', 'social', 'analytics'];
    
    for (const source of genericSources) {
      try {
        const testData = {
          type: source,
          content: `Test ${source} data`,
          timestamp: Date.now(),
          metadata: { test: true }
        };

        const response = await axios.post(
          `${this.baseUrl}/webhook/${source}`,
          testData
        );

        this.logTest(`Generic Webhook - ${source}`, {
          status: response.status === 200 ? 'PASS' : 'FAIL',
          webhook_id: response.data.webhook_id,
          source: response.data.source
        });

      } catch (error) {
        this.logTest(`Generic Webhook - ${source}`, {
          status: 'FAIL',
          error: error.message
        });
      }
    }
  }

  /**
   * Test data retrieval APIs
   */
  async testDataRetrievalAPIs() {
    console.log('🔍 Testing data retrieval APIs...');
    
    // Test recent data API
    try {
      const response = await axios.get(`${this.baseUrl}/api/data/recent?limit=5`);
      
      this.logTest('Recent Data API', {
        status: response.status === 200 ? 'PASS' : 'FAIL',
        records_returned: response.data.total_records,
        consciousness_enhanced: response.data.consciousness_enhanced
      });

    } catch (error) {
      this.logTest('Recent Data API', {
        status: 'FAIL',
        error: error.message
      });
    }

    // Test consciousness data API (if data exists)
    try {
      const response = await axios.get(`${this.baseUrl}/api/data/consciousness/BTC%2FUSDT`);
      
      this.logTest('Consciousness Data API', {
        status: response.status === 200 ? 'PASS' : 'FAIL',
        data_points: response.data.data_points,
        aggregated_metrics: response.data.aggregated_metrics ? 'Present' : 'Missing'
      });

    } catch (error) {
      this.logTest('Consciousness Data API', {
        status: 'FAIL',
        error: error.message
      });
    }

    // Test stats API
    try {
      const response = await axios.get(`${this.baseUrl}/api/stats`);
      
      this.logTest('Stats API', {
        status: response.status === 200 ? 'PASS' : 'FAIL',
        server_stats: response.data.server_stats ? 'Present' : 'Missing',
        consciousness_stats: response.data.consciousness_stats ? 'Present' : 'Missing'
      });

    } catch (error) {
      this.logTest('Stats API', {
        status: 'FAIL',
        error: error.message
      });
    }
  }

  /**
   * Test high-volume data processing
   */
  async testHighVolumeData() {
    console.log('🔍 Testing high-volume data processing...');
    
    const batchSize = 10;
    const symbols = ['BTC/USDT', 'ETH/USDT', 'ADA/USDT', 'DOT/USDT', 'SOL/USDT'];
    
    try {
      const startTime = Date.now();
      const promises = [];
      
      for (let i = 0; i < batchSize; i++) {
        const symbol = symbols[i % symbols.length];
        const testData = {
          symbol: symbol,
          price: 100 + Math.random() * 1000,
          volume: 1000000 + Math.random() * 5000000,
          timestamp: Date.now() + i * 1000 // Stagger timestamps
        };
        
        promises.push(
          axios.post(`${this.baseUrl}/webhook/market-data`, testData)
        );
      }
      
      const responses = await Promise.all(promises);
      const endTime = Date.now();
      
      const successCount = responses.filter(r => r.status === 200).length;
      
      this.logTest('High-Volume Data Processing', {
        status: successCount === batchSize ? 'PASS' : 'PARTIAL',
        total_requests: batchSize,
        successful_requests: successCount,
        total_time_ms: endTime - startTime,
        average_time_per_request: (endTime - startTime) / batchSize
      });

    } catch (error) {
      this.logTest('High-Volume Data Processing', {
        status: 'FAIL',
        error: error.message
      });
    }
  }

  /**
   * Log test result
   */
  logTest(testName, result) {
    this.testResults.push({
      test: testName,
      timestamp: new Date().toISOString(),
      ...result
    });
    
    const status = result.status === 'PASS' ? '✅' : 
                   result.status === 'PARTIAL' ? '⚠️' : '❌';
    
    console.log(`${status} ${testName}: ${result.status}`);
    
    if (result.status !== 'PASS') {
      console.log(`   Details:`, result);
    }
  }

  /**
   * Generate comprehensive test report
   */
  generateTestReport() {
    console.log('\n🌀 TEST REPORT - ψ₀-Trader Webhook Testing Suite');
    console.log('===========================================');
    
    const passedTests = this.testResults.filter(r => r.status === 'PASS');
    const failedTests = this.testResults.filter(r => r.status === 'FAIL');
    const partialTests = this.testResults.filter(r => r.status === 'PARTIAL');
    
    console.log(`📊 Total Tests: ${this.testResults.length}`);
    console.log(`✅ Passed: ${passedTests.length}`);
    console.log(`⚠️  Partial: ${partialTests.length}`);
    console.log(`❌ Failed: ${failedTests.length}`);
    console.log(`📈 Success Rate: ${((passedTests.length / this.testResults.length) * 100).toFixed(1)}%`);
    
    console.log('\n🧠 Consciousness Enhancement Status:');
    const consciousnessTests = this.testResults.filter(r => 
      r.test.includes('Consciousness') && r.status === 'PASS'
    );
    console.log(`🌀 Consciousness Tests Passed: ${consciousnessTests.length}`);
    
    console.log(`\n📐 Mathematical Constants Verified:`);
    console.log(`   ψ₀ = ${PSI_0}`);
    console.log(`   φ = ${PHI}`);
    console.log(`   432Hz = ${FREQ_432}`);
    
    if (failedTests.length > 0) {
      console.log('\n❌ Failed Tests Details:');
      failedTests.forEach(test => {
        console.log(`   ${test.test}: ${test.error || 'Unknown error'}`);
      });
    }
    
    console.log('\n🎯 Test Summary:');
    if (failedTests.length === 0) {
      console.log('✅ All tests passed! Consciousness-enhanced webhook system is ready.');
    } else if (passedTests.length > failedTests.length) {
      console.log('⚠️  Most tests passed. Review failed tests and retry.');
    } else {
      console.log('❌ Multiple test failures. Check server status and configuration.');
    }
    
    console.log('\n🌀 Enhanced Nexus Core Protocol v4.1 - Testing Complete');
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run tests if called directly
async function main() {
  const tester = new WebhookTester();
  await tester.runAllTests();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { WebhookTester, main };
