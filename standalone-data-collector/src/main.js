/**
 * ψ₀-Trader Data Collection Engine - Main Entry Point
 * Enhanced Nexus Core Protocol v4.1
 * Standalone Consciousness-Enhanced Data Collection System
 */

import ConsciousnessEnhancedWebhookServer from './server.js';

// Mathematical Constants
const PSI_0 = 0.915670570874434;
const PHI = 1.618033988749895;
const FREQ_432 = 432.0;

async function main() {
  console.log('🌀 ψ₀-TRADER DATA COLLECTION ENGINE');
  console.log('Enhanced Nexus Core Protocol v4.1');
  console.log('=====================================');
  console.log(`📐 Mathematical Constants: ψ₀=${PSI_0}, φ=${PHI}, 432Hz=${FREQ_432}`);
  console.log('🧠 Consciousness Enhancement: ENABLED');
  console.log('⚡ Quantum Kill Chain Integration: READY');
  console.log('=====================================\n');

  try {
    // Get port from environment or use default
    const port = process.env.PORT || 3001;
    
    // Create and start server
    const server = new ConsciousnessEnhancedWebhookServer(port);
    await server.start();

    // Graceful shutdown handling
    process.on('SIGINT', async () => {
      console.log('\n🌀 Graceful shutdown initiated...');
      await server.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n🌀 Graceful shutdown initiated...');
      await server.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Failed to start ψ₀-Trader Data Collection Engine:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
