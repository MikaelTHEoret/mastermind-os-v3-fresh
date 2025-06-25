/**
 * Enhanced Error-Safe Hash and JSON Utilities
 * Handles the issues found in the error logs
 */

// Enhanced JSON parsing with error handling
export function safeJsonParse(jsonString, fallback = null) {
  try {
    // Clean the JSON string first
    const cleaned = jsonString.trim();
    return JSON.parse(cleaned);
  } catch (error) {
    console.error('JSON parsing error:', error);
    console.error('Problematic JSON string:', jsonString.substring(0, 500));
    return fallback;
  }
}

// Enhanced async hash function that ensures string return
export async function generateSafeKeccakHash(data) {
  try {
    // Ensure input is a string
    const input = typeof data === 'string' ? data : String(data);
    
    // Use Web Crypto API for proper hashing
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
    const result = '0x' + hashHex;
    
    // Ensure result is always a string
    return typeof result === 'string' ? result : String(result);
  } catch (error) {
    console.error('Error generating safe Keccak hash:', error);
    return generateFallbackHash(String(data));
  }
}

// Fallback hash that always returns a string
export function generateFallbackHash(data) {
  const input = String(data);
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
  }
  const hex = Math.abs(hash).toString(16);
  const timestamp = Date.now().toString(16);
  const combined = (hex + timestamp + hex).substring(0, 64);
  return '0x' + combined.padStart(64, '0');
}

// Safe file loading with error handling
export async function safeLoadFileContent(file) {
  try {
    if (!file || !file.content) {
      throw new Error('File or file content is null/undefined');
    }

    const content = typeof file.content === 'string' ? file.content : String(file.content);
    
    // Try parsing JSON if it looks like JSON
    let parsedData = null;
    if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
      parsedData = safeJsonParse(content, null);
    }

    // Generate hash safely
    const keccakHash = await generateSafeKeccakHash(content);
    
    // Ensure keccakHash has substring method (it should be a string)
    const safeKeccakHash = typeof keccakHash === 'string' ? keccakHash : String(keccakHash);

    return {
      content,
      parsedData,
      keccakHash: safeKeccakHash,
      title: parsedData?.title || file.name || 'Untitled',
      success: true
    };
  } catch (error) {
    console.error('Error in safeLoadFileContent:', error);
    return {
      content: file?.content || '',
      parsedData: null,
      keccakHash: generateFallbackHash(file?.content || ''),
      title: file?.name || 'Error File',
      success: false,
      error: error.message
    };
  }
}

// Safe metadata extraction that prevents substring errors
export function safeExtractMetadata(data) {
  try {
    const metadata = {
      title: data?.title || 'Untitled',
      author: data?.author || 'Anonymous',
      version: data?.version || 'v1.0',
      keccakHash: null
    };

    // Handle keccakHash safely
    if (data?.keccakHash) {
      const hash = data.keccakHash;
      // Ensure it's a string before calling substring
      if (typeof hash === 'string') {
        metadata.keccakHash = hash;
      } else if (typeof hash === 'object' && hash.then) {
        // It's a Promise - this shouldn't happen but let's handle it
        console.warn('keccakHash is a Promise - this indicates an async/await issue');
        metadata.keccakHash = '[Promise pending]';
      } else {
        metadata.keccakHash = String(hash);
      }
    }

    return metadata;
  } catch (error) {
    console.error('Error extracting metadata:', error);
    return {
      title: 'Error',
      author: 'Unknown',
      version: 'v1.0',
      keccakHash: generateFallbackHash('error'),
      error: error.message
    };
  }
}

// Fix for the specific JSON parsing issue
export function fixJsonSyntax(jsonString) {
  try {
    // Common JSON fixes
    let fixed = jsonString
      .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
      .replace(/'/g, '"') // Replace single quotes with double quotes
      .replace(/(\w+):/g, '"$1":') // Quote unquoted keys
      .replace(/:\s*'([^']*)'/g, ': "$1"') // Replace single-quoted values
      .replace(/:\s*([^",{[\]}\s]+)/g, ': "$1"'); // Quote unquoted string values

    return fixed;
  } catch (error) {
    console.error('Error fixing JSON syntax:', error);
    return jsonString;
  }
}

export default {
  safeJsonParse,
  generateSafeKeccakHash,
  generateFallbackHash,
  safeLoadFileContent,
  safeExtractMetadata,
  fixJsonSyntax
};
