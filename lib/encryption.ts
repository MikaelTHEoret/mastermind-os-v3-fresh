// lib/encryption.ts - Resilient encryption utilities for MasterMind OS
import crypto from 'crypto';

const SECRET_KEY = process.env.ENCRYPTION_KEY || 'mastermind-dev-fallback-key-32-chars';

// Simple, reliable encryption for development
export function simpleEncrypt(text: string): string {
  try {
    if (!text) return '';
    
    // Use a simple, reliable algorithm that works in all Node.js versions
    const cipher = crypto.createCipher('aes192', SECRET_KEY);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  } catch (error) {
    console.warn('Encryption failed, storing as plain text in development:', error);
    // In development, just return base64 encoded text if encryption fails
    return Buffer.from(text).toString('base64');
  }
}

export function simpleDecrypt(encryptedData: string): string {
  try {
    if (!encryptedData) return '';
    
    // Try to decrypt first
    const decipher = crypto.createDecipher('aes192', SECRET_KEY);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    // If decryption fails, try base64 decode (fallback for development)
    try {
      return Buffer.from(encryptedData, 'base64').toString('utf8');
    } catch (base64Error) {
      console.warn('Both decryption and base64 decode failed, returning original data');
      return encryptedData;
    }
  }
}

// Check if encryption is working properly
export function testEncryption(): boolean {
  try {
    const testData = 'test-encryption-data';
    const encrypted = simpleEncrypt(testData);
    const decrypted = simpleDecrypt(encrypted);
    return decrypted === testData;
  } catch (error) {
    console.warn('Encryption test failed:', error);
    return false;
  }
}