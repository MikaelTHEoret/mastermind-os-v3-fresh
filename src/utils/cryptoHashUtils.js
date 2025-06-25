/**
 * Proper Keccak-256 Hash Implementation using @noble/hashes
 * This replaces the weak hash functions with cryptographically secure implementations
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha256';

/**
 * Convert string to Uint8Array
 */
function stringToBytes(str) {
  return new TextEncoder().encode(str);
}

/**
 * Convert bytes to hex string with 0x prefix
 */
function bytesToHex(bytes) {
  return '0x' + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate proper Keccak-256 hash
 * @param {string} input - Input string to hash
 * @returns {string} - Hex string with 0x prefix (64 characters + 0x)
 */
export function generateKeccakHash(input) {
  try {
    const inputBytes = stringToBytes(input);
    const hashBytes = keccak_256(inputBytes);
    return bytesToHex(hashBytes);
  } catch (error) {
    console.error('Error generating Keccak-256 hash:', error);
    throw new Error('Failed to generate Keccak-256 hash');
  }
}

/**
 * Generate SHA-256 hash (backup method)
 * @param {string} input - Input string to hash
 * @returns {string} - Hex string with 0x prefix
 */
export function generateSHA256Hash(input) {
  try {
    const inputBytes = stringToBytes(input);
    const hashBytes = sha256(inputBytes);
    return bytesToHex(hashBytes);
  } catch (error) {
    console.error('Error generating SHA-256 hash:', error);
    throw new Error('Failed to generate SHA-256 hash');
  }
}

/**
 * Generate content hash for scrolls and files
 * @param {string} content - Main content
 * @param {string} title - Optional title
 * @param {string} author - Optional author
 * @param {string} timestamp - Optional timestamp
 * @returns {string} - Keccak-256 hash with 0x prefix
 */
export function generateContentHash(content, title = '', author = '', timestamp = '') {
  try {
    // Create deterministic content string
    const fullContent = [title, author, content, timestamp].filter(Boolean).join('|');
    return generateKeccakHash(fullContent);
  } catch (error) {
    console.error('Error generating content hash:', error);
    throw new Error('Failed to generate content hash');
  }
}

/**
 * Generate scroll hash for blockchain minting
 * @param {Object} scrollData - Scroll data object
 * @returns {string} - Keccak-256 hash with 0x prefix
 */
export function generateScrollHash(scrollData) {
  try {
    const {
      title = '',
      author = '',
      content = '',
      abstract = '',
      timestamp = new Date().toISOString(),
      version = '1.0'
    } = scrollData;

    // Create canonical string representation
    const canonicalData = JSON.stringify({
      title,
      author,
      content,
      abstract,
      timestamp,
      version
    }, Object.keys({title, author, content, abstract, timestamp, version}).sort());

    return generateKeccakHash(canonicalData);
  } catch (error) {
    console.error('Error generating scroll hash:', error);
    throw new Error('Failed to generate scroll hash');
  }
}

/**
 * Generate file hash
 * @param {File|string} file - File object or string content
 * @returns {Promise<string>} - Keccak-256 hash with 0x prefix
 */
export async function generateFileHash(file) {
  try {
    let content;
    if (typeof file === 'string') {
      content = file;
    } else if (file instanceof File) {
      content = await file.text();
    } else {
      throw new Error('Invalid file input - must be File object or string');
    }
    
    return generateKeccakHash(content);
  } catch (error) {
    console.error('Error generating file hash:', error);
    throw new Error('Failed to generate file hash');
  }
}

/**
 * Validate hash format (must be 0x followed by 64 hex characters)
 * @param {string} hash - Hash to validate
 * @returns {boolean} - True if valid Keccak-256 format
 */
export function isValidKeccakHash(hash) {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
}

/**
 * Validate Ethereum address format
 * @param {string} address - Address to validate
 * @returns {boolean} - True if valid Ethereum address format
 */
export function isValidEthereumAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Generate deterministic hash from multiple inputs
 * @param {...string} inputs - Multiple string inputs
 * @returns {string} - Keccak-256 hash with 0x prefix
 */
export function generateMultiInputHash(...inputs) {
  try {
    const combinedInput = inputs.filter(input => input !== null && input !== undefined).join('|');
    return generateKeccakHash(combinedInput);
  } catch (error) {
    console.error('Error generating multi-input hash:', error);
    throw new Error('Failed to generate multi-input hash');
  }
}

/**
 * Generate timestamp-based hash (includes current timestamp)
 * @param {string} input - Input to hash
 * @returns {string} - Keccak-256 hash with 0x prefix
 */
export function generateTimestampedHash(input) {
  try {
    const timestamp = new Date().toISOString();
    return generateKeccakHash(`${input}|${timestamp}`);
  } catch (error) {
    console.error('Error generating timestamped hash:', error);
    throw new Error('Failed to generate timestamped hash');
  }
}

// Export all functions
export default {
  generateKeccakHash,
  generateSHA256Hash,
  generateContentHash,
  generateScrollHash,
  generateFileHash,
  generateMultiInputHash,
  generateTimestampedHash,
  isValidKeccakHash,
  isValidEthereumAddress
};
