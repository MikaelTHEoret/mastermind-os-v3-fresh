#!/usr/bin/env node
/**
 * Database setup and migration script for Mastermind OS
 * Run: node scripts/setup-database.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🗄️  MASTERMIND OS - DATABASE SETUP\n');

// Check if .env.local exists
const envPath = path.join(process.cwd(), '.env.local');
if (!fs.existsSync(envPath)) {
  console.error('❌ .env.local file not found!');
  console.log('Please create .env.local with your Neon database credentials.');
  process.exit(1);
}

// Load environment variables
require('dotenv').config({ path: envPath });

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in .env.local!');
  console.log('Please add your Neon database URL to .env.local');
  process.exit(1);
}

console.log('✅ Environment variables loaded');
console.log(`🔗 Database: ${process.env.DATABASE_URL.split('@')[1]?.split('/')[0] || 'Neon PostgreSQL'}`);

try {
  console.log('\n📋 Generating database migrations...');
  execSync('npm run db:generate', { stdio: 'inherit' });
  
  console.log('\n🚀 Running database migrations...');
  execSync('npm run db:migrate', { stdio: 'inherit' });
  
  console.log('\n✅ Database setup completed successfully!');
  console.log('\n📊 You can view your database with:');
  console.log('npm run db:studio');
  
  console.log('\n🚢 Ready for deployment!');
  console.log('Next steps:');
  console.log('1. Commit your changes: git add . && git commit -m "Database setup complete"');
  console.log('2. Deploy to Vercel: vercel --prod');
  
} catch (error) {
  console.error('\n❌ Database setup failed:', error.message);
  console.log('\n🔧 Troubleshooting:');
  console.log('1. Verify your DATABASE_URL is correct');
  console.log('2. Ensure your Neon database is accessible');
  console.log('3. Check network connectivity');
  process.exit(1);
}
