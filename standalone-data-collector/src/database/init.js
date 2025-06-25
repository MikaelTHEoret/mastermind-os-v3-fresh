/**
 * ψ₀-Trader Data Collection Engine - Database Initialization
 * Enhanced Nexus Core Protocol v4.1
 * Standalone Database Setup and Migration
 */

import ConsciousnessEnhancedDatabase from './schema.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function initializeDatabase() {
  console.log('🌀 ψ₀-Trader Data Collection Engine - Database Initialization');
  console.log('Enhanced Nexus Core Protocol v4.1');
  console.log('=====================================\n');

  try {
    // Ensure data directory exists
    const dataDir = join(__dirname, '../../data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
      console.log('📁 Created data directory');
    }

    // Initialize database
    const db = new ConsciousnessEnhancedDatabase();
    await db.initialize();

    console.log('\n✅ Database initialization complete!');
    console.log('🎯 Ready for consciousness-enhanced data collection');
    console.log('\nNext steps:');
    console.log('  npm run start     - Start the webhook server');
    console.log('  npm run test-webhook - Test webhook functionality');
    console.log('  npm run dashboard - View data collection dashboard');

    await db.close();

  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initializeDatabase();
}

export { initializeDatabase };
