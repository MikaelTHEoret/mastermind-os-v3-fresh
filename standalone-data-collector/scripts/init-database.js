/**
 * Database Initialization Script
 * Enhanced Nexus Core Protocol v4.1
 */

import ConsciousnessEnhancedDatabase from '../src/database.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function initializeDatabase() {
  console.log('🌀 Initializing ψ₀-Trader Database...');
  
  try {
    // Create data directory if it doesn't exist
    const dataDir = path.join(__dirname, '..', 'data');
    
    // Initialize database
    const dbPath = path.join(dataDir, 'psi-trader-collector.db');
    const db = new ConsciousnessEnhancedDatabase(dbPath);
    
    console.log('✅ Database initialized successfully!');
    console.log(`📍 Database location: ${dbPath}`);
    
    // Test database connection
    const stats = db.getSystemStats();
    console.log('📊 Database Statistics:');
    console.log(`   - Tables created: ${stats.total_tables}`);
    console.log(`   - Records: ${stats.total_records}`);
    console.log(`   - Consciousness enhancement: ENABLED`);
    
    // Close database
    db.close();
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

initializeDatabase();