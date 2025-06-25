#!/usr/bin/env node
/**
 * Generate secure keys for Mastermind OS production deployment
 * Run: node scripts/generate-keys.js
 */

const crypto = require('crypto');

function generateSecureKey(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

function generateBase64Key(length = 32) {
  return crypto.randomBytes(length).toString('base64url');
}

console.log('🔐 MASTERMIND OS - SECURE KEY GENERATION\n');
console.log('Copy these values to your .env.local and Vercel environment variables:\n');

console.log('# Encryption & Security Keys');
console.log(`ENCRYPTION_KEY="${generateSecureKey(32)}"`);
console.log(`SECRET_KEY="${generateSecureKey(64)}"`);
console.log(`NEXTAUTH_SECRET="${generateBase64Key(32)}"`);

console.log('\n# Session Encryption');
console.log(`SESSION_SECRET="${generateSecureKey(32)}"`);

console.log('\n# JWT Signing Keys');
console.log(`JWT_SECRET="${generateBase64Key(64)}"`);

console.log('\n# Password Salt');
console.log(`BCRYPT_SALT_ROUNDS="12"`);

console.log('\n✅ Keys generated successfully!');
console.log('\n⚠️  IMPORTANT: Store these keys securely and never commit them to version control!');
console.log('\n📝 Next steps:');
console.log('1. Update your .env.local with these keys');
console.log('2. Add them to Vercel environment variables');
console.log('3. Run database migrations: npm run db:migrate');
console.log('4. Deploy to Vercel: vercel --prod');
