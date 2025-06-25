import crypto from 'crypto';
import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || process.env.SECRET_KEY || 'fallback-key-change-in-production';

if (!process.env.ENCRYPTION_KEY && !process.env.SECRET_KEY) {
  console.warn('⚠️  ENCRYPTION_KEY not set, using fallback key. Set ENCRYPTION_KEY in production!');
}

export interface EncryptedData {
  encryptedValue: string;
  iv: string;
}

/**
 * Encrypt sensitive data using AES-256-GCM
 */
export function encryptData(text: string): EncryptedData {
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-gcm', ENCRYPTION_KEY);
    cipher.setAAD(Buffer.from('mastermind-os'));
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encryptedValue: encrypted + ':' + authTag.toString('hex'),
      iv: iv.toString('hex')
    };
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt sensitive data
 */
export function decryptData(encryptedData: EncryptedData): string {
  try {
    const [encrypted, authTagHex] = encryptedData.encryptedValue.split(':');
    const authTag = Buffer.from(authTagHex, 'hex');
    const iv = Buffer.from(encryptedData.iv, 'hex');
    
    const decipher = crypto.createDecipher('aes-256-gcm', ENCRYPTION_KEY);
    decipher.setAAD(Buffer.from('mastermind-os'));
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Simple encryption for less sensitive data using CryptoJS
 */
export function simpleEncrypt(text: string): string {
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

/**
 * Simple decryption
 */
export function simpleDecrypt(encryptedText: string): string {
  const bytes = CryptoJS.AES.decrypt(encryptedText, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}

/**
 * Generate a secure random token
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hash password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  const bcrypt = require('bcryptjs');
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
}

/**
 * Verify password against hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const bcrypt = require('bcryptjs');
  return await bcrypt.compare(password, hash);
}

/**
 * Generate a JWT token for sessions
 */
export async function generateJWT(payload: any, expiresIn: string = '7d'): Promise<string> {
  const { SignJWT } = require('jose');
  const secret = new TextEncoder().encode(ENCRYPTION_KEY);
  
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

/**
 * Verify and decode JWT token
 */
export async function verifyJWT(token: string): Promise<any> {
  const { jwtVerify } = require('jose');
  const secret = new TextEncoder().encode(ENCRYPTION_KEY);
  
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch (error) {
    throw new Error('Invalid token');
  }
}

/**
 * Sanitize input to prevent injection attacks
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>\"']/g, '') // Remove potentially dangerous characters
    .trim()
    .substring(0, 1000); // Limit length
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Generate a secure password with requirements
 */
export function generateSecurePassword(length: number = 16): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  
  const allChars = uppercase + lowercase + numbers + symbols;
  let password = '';
  
  // Ensure at least one character from each category
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += symbols[Math.floor(Math.random() * symbols.length)];
  
  // Fill the rest randomly
  for (let i = 4; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Validate password strength
 */
export function validatePasswordStrength(password: string): {
  isValid: boolean;
  score: number;
  feedback: string[];
} {
  const feedback: string[] = [];
  let score = 0;
  
  if (password.length >= 8) score += 1;
  else feedback.push('Password must be at least 8 characters long');
  
  if (/[A-Z]/.test(password)) score += 1;
  else feedback.push('Password must contain at least one uppercase letter');
  
  if (/[a-z]/.test(password)) score += 1;
  else feedback.push('Password must contain at least one lowercase letter');
  
  if (/\d/.test(password)) score += 1;
  else feedback.push('Password must contain at least one number');
  
  if (/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) score += 1;
  else feedback.push('Password must contain at least one special character');
  
  return {
    isValid: score >= 4,
    score,
    feedback
  };
}
