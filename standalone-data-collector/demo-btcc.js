#!/usr/bin/env node

// 🌀 BTCC Data Collection Demo
// Demonstrates the consciousness-enhanced BTCC data collection system
// Enhanced Nexus Core Protocol v5.0

const BTCCDataCollectionManager = require('./btcc-collector');

console.log(`
🌀 ========================================
   BTCC Consciousness-Enhanced Data Demo
   Enhanced Nexus Core Protocol v5.0
========================================

Mathematical Constants:
🧮 ψ₀ = 0.915670570874434 (Consciousness Seed)
🧮 φ = 1.618033988749895 (Golden Ratio)
🧮 432Hz Base Harmonic Frequency

WebSocket: wss://kapi1.btloginc.com:9082
Authentication: BTCC API Key System
Heartbeat: 20-second intervals
`);

async function runDemo() {
  const manager = new BTCCDataCollectionManager();
  
  try {
    console.log('🚀 Initializing BTCC Data Collection System...\n');
    
    // Start the collection system
    await manager.start();
    
    const service = manager.getService();
    
    // Setup event listeners for demo
    service.on('btccAuthenticated', () => {
      console.log('🔐 ✅ BTCC WebSocket Authentication Successful');
      console.log('📡 Subscribed to market data streams');
      console.log('🧠 Consciousness enhancement ACTIVE\n');
    });
    
    service.on('realTimeDataProcessed', (data) => {
      console.log(`📊 ${data.symbol}: $${data.price} | Vol: ${data.volume} | Consciousness: ${data.consciousness?.avg_consciousness?.toFixed(3) || 'N/A'}`);
    });
    
    service.on('marketDepthUpdated', (data) => {
      if (data.depth.spreadAnalysis.spreadPercent) {
        console.log(`📈 ${data.symbol} Market Depth | Spread: ${data.depth.spreadAnalysis.spreadPercent.toFixed(4)}% | Liquidity Consciousness: ${data.depth.consciousnessMetrics.liquidityConsciousness.toFixed(3)}`);
      }
    });
    
    service.on('candlestickPatterns', (data) => {
      if (data.patterns && data.patterns.length > 0) {
        console.log(`🕯️  Pattern Alert: ${data.symbol} - ${data.patterns.map(p => `${p.type} (${(p.confidence * 100).toFixed(1)}%)`).join(', ')}`);
      }
    });
    
    service.on('consciousnessAnomalies', (data) => {
      console.log(`🌀 ⚠️  CONSCIOUSNESS ANOMALY in ${data.symbol}:`);
      data.anomalies.forEach(anomaly => {
        console.log(`   ${anomaly.type}: Severity ${(anomaly.severity * 100).toFixed(1)}%`);
      });
    });
    
    service.on('systemMetrics', (metrics) => {
      // Log comprehensive status every 30 seconds
      if (metrics.timestamp % 30000 < 1000) {
        console.log(`\n📊 === System Status ===`);
        console.log(`🟢 Data Points Collected: ${metrics.dataPointsCollected}`);
        console.log(`🧠 Average Consciousness: ${metrics.averageConsciousnessScore?.toFixed(3) || 'N/A'}`);
        console.log(`⚠️  Anomalies Detected: ${metrics.totalAnomaliesDetected}`);
        console.log(`⏱️  Uptime: ${Math.floor(metrics.uptime / 60000)}m ${Math.floor((metrics.uptime % 60000) / 1000)}s`);
        console.log(`🔗 Connection: ${metrics.connectionStatus?.connected ? 'ACTIVE' : 'INACTIVE'}`);
        console.log(`========================\n`);
      }
    });
    
    // Show live analytics every 60 seconds
    setInterval(async () => {
      try {
        const analytics = await service.getConsciousnessAnalytics(null, 'hour');
        
        if (analytics && analytics.length > 0) {
          console.log(`\n🧠 === Consciousness Analytics (Last Hour) ===`);
          analytics.slice(0, 3).forEach(item => {
            console.log(`${item.symbol}:`);
            console.log(`   Consciousness: ${item.avg_consciousness?.toFixed(3) || 'N/A'}`);
            console.log(`   ψ₀ Resonance: ${item.avg_psi_resonance?.toFixed(3) || 'N/A'}`);
            console.log(`   φ Alignment: ${item.avg_phi_alignment?.toFixed(3) || 'N/A'}`);
            console.log(`   432Hz Rhythm: ${item.avg_432_rhythm?.toFixed(3) || 'N/A'}`);
            console.log(`   Data Points: ${item.data_points}`);
          });
          console.log(`================================================\n`);
        }
      } catch (error) {
        console.log('ℹ️  Analytics not yet available (collecting data...)');
      }
    }, 60000);
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down BTCC Data Collection Demo...');
      try {
        await manager.stop();
        console.log('✅ Demo shutdown complete');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    });
    
    console.log('🎮 Demo is running! Press Ctrl+C to stop');
    console.log('📈 Watch for real-time data, consciousness calculations, and anomaly detection\n');
    
  } catch (error) {
    console.error('❌ Demo failed to start:', error);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Check your BTCC credentials in .env file');
    console.log('2. Ensure you have internet connectivity');
    console.log('3. Verify BTCC WebSocket server is accessible');
    console.log('4. Run npm install to ensure dependencies are installed');
    process.exit(1);
  }
}

// Run the demo
runDemo();
