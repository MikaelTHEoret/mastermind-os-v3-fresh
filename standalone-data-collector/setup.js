#!/usr/bin/env node

/**
 * ψ₀-Trader Data Collector - Quick Setup Script
 * Enhanced Nexus Core Protocol v4.1
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('🌀 ψ₀-TRADER DATA COLLECTOR SETUP');
console.log('Enhanced Nexus Core Protocol v4.1');
console.log('=================================');

async function setup() {
  try {
    // 1. Create necessary directories
    console.log('📁 Creating directories...');
    const dirs = ['data', 'logs', 'exports', 'backups'];
    dirs.forEach(dir => {
      const dirPath = path.join(__dirname, dir);
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
        console.log(`   ✅ Created ${dir}/`);
      } else {
        console.log(`   ℹ️  ${dir}/ already exists`);
      }
    });

    // 2. Copy environment file
    console.log('\n🔧 Setting up environment...');
    const envExample = path.join(__dirname, '.env.example');
    const envFile = path.join(__dirname, '.env');
    
    if (!existsSync(envFile) && existsSync(envExample)) {
      copyFileSync(envExample, envFile);
      console.log('   ✅ Created .env from .env.example');
      console.log('   ⚠️  Please update .env with your specific configuration');
    } else {
      console.log('   ℹ️  .env file already exists');
    }

    // 3. Install dependencies
    console.log('\n📦 Installing dependencies...');
    execSync('npm install', { stdio: 'inherit', cwd: __dirname });
    console.log('   ✅ Dependencies installed');

    // 4. Initialize database
    console.log('\n🗄️  Initializing database...');
    execSync('npm run init-db', { stdio: 'inherit', cwd: __dirname });
    console.log('   ✅ Database initialized');

    // 5. Generate sample data
    console.log('\n🎲 Generating sample data...');
    execSync('npm run sample-data 25', { stdio: 'inherit', cwd: __dirname });
    console.log('   ✅ Sample data generated');

    // 6. Run tests
    console.log('\n🧪 Running tests...');
    try {
      execSync('npm test', { stdio: 'inherit', cwd: __dirname });
      console.log('   ✅ All tests passed');
    } catch (error) {
      console.log('   ⚠️  Some tests failed - check output above');
    }

    // 7. Final summary
    console.log('\n🌀 SETUP COMPLETE!');
    console.log('==================');
    console.log('✅ Database initialized with consciousness enhancement');
    console.log('✅ Sample data generated and stored');
    console.log('✅ Test suite completed');
    console.log('');
    console.log('🚀 Quick Start Commands:');
    console.log('  npm start              - Start the webhook server');
    console.log('  npm run view-data      - View collected data');
    console.log('  npm run sample-data 50 - Generate more sample data');
    console.log('  npm test               - Run test suite');
    console.log('');
    console.log('📊 Server will run on: http://localhost:3001');
    console.log('🧠 Consciousness enhancement: ENABLED');
    console.log('⚡ Mathematical constants: ψ₀, φ, 432Hz active');
    console.log('');
    console.log('Ready for consciousness-enhanced data collection! 🌀✨');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    console.log('\n🔧 Manual setup required:');
    console.log('  1. npm install');
    console.log('  2. npm run init-db');
    console.log('  3. npm run sample-data');
    console.log('  4. npm test');
    process.exit(1);
  }
}

setup();