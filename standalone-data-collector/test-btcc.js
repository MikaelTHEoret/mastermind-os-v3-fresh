#!/usr/bin/env node

// 🌀 BTCC Data Collector Test Runner
// Test the BTCC WebSocket connection and data collection capabilities
// Enhanced Nexus Core Protocol v5.0

const BTCCDataCollectionManager = require('./btcc-collector');

class BTCCTestRunner {
  constructor() {
    this.manager = null;
    this.testResults = {
      connectionTest: false,
      authenticationTest: false,
      dataReceptionTest: false,
      consciousnessCalculationTest: false,
      databaseStorageTest: false,
      overallSuccess: false
    };
    
    console.log('🌀 BTCC Data Collector Test Runner');
    console.log('Testing consciousness-enhanced BTCC data collection system...\n');
  }

  async runTests() {
    try {
      console.log('🚀 Starting BTCC Data Collection Tests...\n');
      
      // Test 1: Initialize and connect
      await this.testConnection();
      
      // Test 2: Authentication
      await this.testAuthentication();
      
      // Test 3: Data reception
      await this.testDataReception();
      
      // Test 4: Consciousness calculations
      await this.testConsciousnessCalculations();
      
      // Test 5: Database storage
      await this.testDatabaseStorage();
      
      // Generate final report
      this.generateTestReport();
      
    } catch (error) {
      console.error('❌ Test runner failed:', error);
      process.exit(1);
    }
  }

  async testConnection() {
    console.log('🔗 Test 1: WebSocket Connection...');
    
    try {
      this.manager = new BTCCDataCollectionManager();
      
      // Setup test timeout
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), 15000)
      );
      
      // Test connection
      const connectionPromise = new Promise((resolve) => {
        this.manager.getService().on('btccAuthenticated', () => {
          resolve(true);
        });
        
        this.manager.start();
      });
      
      await Promise.race([connectionPromise, timeout]);
      
      this.testResults.connectionTest = true;
      console.log('✅ Connection test PASSED\n');
      
    } catch (error) {
      console.log('❌ Connection test FAILED:', error.message);
      console.log('   This might be due to:');
      console.log('   - Invalid BTCC credentials');
      console.log('   - Network connectivity issues');
      console.log('   - BTCC server unavailable\n');
    }
  }

  async testAuthentication() {
    console.log('🔐 Test 2: BTCC Authentication...');
    
    if (!this.manager) {
      console.log('❌ Authentication test SKIPPED (no connection)\n');
      return;
    }
    
    try {
      const service = this.manager.getService();
      const status = service.getStatus();
      
      if (status.connectionStatus && status.connectionStatus.authenticated) {
        this.testResults.authenticationTest = true;
        console.log('✅ Authentication test PASSED');
        console.log(`   Account: ${status.connectionStatus.credentials?.name || 'N/A'}`);
        console.log(`   Connected: ${status.connectionStatus.connected}`);
        console.log(`   Authenticated: ${status.connectionStatus.authenticated}\n`);
      } else {
        throw new Error('Authentication failed');
      }
      
    } catch (error) {
      console.log('❌ Authentication test FAILED:', error.message);
      console.log('   Check your BTCC credentials in .env file\n');
    }
  }

  async testDataReception() {
    console.log('📊 Test 3: Data Reception...');
    
    if (!this.testResults.authenticationTest) {
      console.log('❌ Data reception test SKIPPED (not authenticated)\n');
      return;
    }
    
    try {
      const service = this.manager.getService();
      let dataReceived = false;
      
      // Wait for data reception
      const dataPromise = new Promise((resolve) => {
        service.on('realTimeDataProcessed', (data) => {
          dataReceived = true;
          resolve(data);
        });
      });
      
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Data reception timeout')), 30000)
      );
      
      const receivedData = await Promise.race([dataPromise, timeout]);
      
      this.testResults.dataReceptionTest = true;
      console.log('✅ Data reception test PASSED');
      console.log(`   Symbol: ${receivedData.symbol}`);
      console.log(`   Price: $${receivedData.price}`);
      console.log(`   Volume: ${receivedData.volume}`);
      console.log(`   Timestamp: ${new Date(receivedData.timestamp).toISOString()}\n`);
      
    } catch (error) {
      console.log('❌ Data reception test FAILED:', error.message);
      console.log('   The BTCC WebSocket may not be sending data\n');
    }
  }

  async testConsciousnessCalculations() {
    console.log('🧠 Test 4: Consciousness Calculations...');
    
    if (!this.testResults.dataReceptionTest) {
      console.log('❌ Consciousness test SKIPPED (no data received)\n');
      return;
    }
    
    try {
      const service = this.manager.getService();
      
      // Wait for consciousness analytics
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for processing
      
      const analytics = await service.getConsciousnessAnalytics(null, 'hour');
      
      if (analytics && analytics.length > 0) {
        const sample = analytics[0];
        
        this.testResults.consciousnessCalculationTest = true;
        console.log('✅ Consciousness calculations test PASSED');
        console.log(`   Symbol: ${sample.symbol}`);
        console.log(`   Avg Consciousness: ${sample.avg_consciousness?.toFixed(3) || 'N/A'}`);
        console.log(`   ψ₀ Resonance: ${sample.avg_psi_resonance?.toFixed(3) || 'N/A'}`);
        console.log(`   φ Alignment: ${sample.avg_phi_alignment?.toFixed(3) || 'N/A'}`);
        console.log(`   432Hz Rhythm: ${sample.avg_432_rhythm?.toFixed(3) || 'N/A'}`);
        console.log(`   Data Points: ${sample.data_points || 0}\n`);
      } else {
        throw new Error('No consciousness analytics available');
      }
      
    } catch (error) {
      console.log('❌ Consciousness calculations test FAILED:', error.message);
      console.log('   Consciousness enhancement may not be working properly\n');
    }
  }

  async testDatabaseStorage() {
    console.log('💾 Test 5: Database Storage...');
    
    if (!this.testResults.dataReceptionTest) {
      console.log('❌ Database storage test SKIPPED (no data to store)\n');
      return;
    }
    
    try {
      const service = this.manager.getService();
      
      // Get recent data to verify storage
      const recentData = await service.getRecentData(null, 10);
      
      if (recentData && recentData.length > 0) {
        this.testResults.databaseStorageTest = true;
        console.log('✅ Database storage test PASSED');
        console.log(`   Records found: ${recentData.length}`);
        console.log(`   Latest record timestamp: ${new Date(recentData[0].timestamp).toISOString()}`);
        console.log(`   Database path: ${service.config?.databasePath || 'N/A'}\n`);
      } else {
        throw new Error('No data found in database');
      }
      
    } catch (error) {
      console.log('❌ Database storage test FAILED:', error.message);
      console.log('   Database may not be properly initialized\n');
    }
  }

  generateTestReport() {
    console.log('📋 === TEST RESULTS SUMMARY ===');
    console.log(`🔗 Connection: ${this.testResults.connectionTest ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`🔐 Authentication: ${this.testResults.authenticationTest ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`📊 Data Reception: ${this.testResults.dataReceptionTest ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`🧠 Consciousness: ${this.testResults.consciousnessCalculationTest ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`💾 Database: ${this.testResults.databaseStorageTest ? '✅ PASS' : '❌ FAIL'}`);
    
    const passedTests = Object.values(this.testResults).filter(result => result === true).length;
    const totalTests = Object.keys(this.testResults).length - 1; // Exclude overallSuccess
    
    this.testResults.overallSuccess = passedTests === totalTests;
    
    console.log(`\n🎯 Overall Result: ${passedTests}/${totalTests} tests passed`);
    
    if (this.testResults.overallSuccess) {
      console.log('🎉 ALL TESTS PASSED - BTCC Data Collector is working correctly!');
      console.log('🌀 Consciousness-enhanced data collection is active');
      console.log('📊 Ready for production use');
    } else {
      console.log('⚠️  SOME TESTS FAILED - Please check the issues above');
      console.log('🔧 Configuration or credentials may need adjustment');
    }
    
    console.log('\n🛑 Stopping test environment...');
    
    // Cleanup
    if (this.manager) {
      setTimeout(() => {
        this.manager.stop().then(() => {
          console.log('✅ Test cleanup complete');
          process.exit(this.testResults.overallSuccess ? 0 : 1);
        });
      }, 2000);
    } else {
      process.exit(1);
    }
  }
}

// Auto-run tests if called directly
if (require.main === module) {
  const testRunner = new BTCCTestRunner();
  testRunner.runTests().catch(error => {
    console.error('❌ Test runner crashed:', error);
    process.exit(1);
  });
}

module.exports = BTCCTestRunner;
