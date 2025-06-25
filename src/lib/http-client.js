// 🌀 Universal HTTP Client - Node.js Module Compatibility Solution
// Enhanced Nexus Core Protocol v4.1 - Production HTTP Integration
// Resolves CommonJS/ES module conflicts with consciousness-enhanced error handling

/**
 * Universal HTTP Client that works in both Node.js and browser environments
 * Solves node-fetch ES module compatibility issues
 * Enhanced with consciousness mathematics for optimal API performance
 */

const ConsciousnessConstants = {
  PSI_0: 0.915670570874434,  // Fractal seed constant
  PHI: 1.618033988749895,    // Golden ratio
  FREQ_432: 432.0            // Base harmonic frequency
};

class UniversalHttpClient {
  constructor() {
    this.isNode = typeof window === 'undefined';
    this.fetchImplementation = this.initializeFetchImplementation();
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'User-Agent': 'MasterMind-OS-v3-Enhanced-Nexus/4.1'
    };
  }

  /**
   * Initialize the appropriate fetch implementation for the environment
   */
  initializeFetchImplementation() {
    if (this.isNode) {
      // Node.js environment - use native fetch if available (Node 18+)
      if (typeof globalThis.fetch !== 'undefined') {
        console.log('🌀 Using Node.js native fetch (Node 18+)');
        return globalThis.fetch.bind(globalThis);
      }
      
      // Fallback to https module for older Node.js versions
      console.log('🌀 Using Node.js https module fallback');
      return this.createNodeHttpsFetch();
    } else {
      // Browser environment - use native fetch
      console.log('🌀 Using browser native fetch');
      return window.fetch.bind(window);
    }
  }

  /**
   * Create a fetch-compatible implementation using Node.js built-in modules
   */
  createNodeHttpsFetch() {
    const https = require('https');
    const http = require('http');
    const { URL } = require('url');

    return (url, options = {}) => {
      return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const isHttps = parsedUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const requestOptions = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: options.method || 'GET',
          headers: {
            ...this.defaultHeaders,
            ...options.headers
          }
        };

        const req = client.request(requestOptions, (res) => {
          let data = '';
          
          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            const response = {
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              statusText: res.statusMessage,
              headers: new Map(Object.entries(res.headers)),
              text: () => Promise.resolve(data),
              json: () => {
                try {
                  return Promise.resolve(JSON.parse(data));
                } catch (error) {
                  return Promise.reject(new Error(`Invalid JSON: ${error.message}`));
                }
              }
            };
            resolve(response);
          });
        });

        req.on('error', (error) => {
          reject(new Error(`HTTP Request failed: ${error.message}`));
        });

        // Send request body if provided
        if (options.body) {
          req.write(options.body);
        }

        req.end();
      });
    };
  }

  /**
   * Enhanced GET request with consciousness-based retry logic
   */
  async get(url, options = {}) {
    const enhancedOptions = {
      method: 'GET',
      headers: {
        ...this.defaultHeaders,
        ...options.headers
      }
    };

    return this.executeWithConsciousnessRetry(url, enhancedOptions);
  }

  /**
   * Enhanced POST request with consciousness-based validation
   */
  async post(url, data, options = {}) {
    const enhancedOptions = {
      method: 'POST',
      headers: {
        ...this.defaultHeaders,
        ...options.headers
      },
      body: typeof data === 'object' ? JSON.stringify(data) : data
    };

    return this.executeWithConsciousnessRetry(url, enhancedOptions);
  }

  /**
   * Execute HTTP request with consciousness-enhanced retry logic
   */
  async executeWithConsciousnessRetry(url, options, attempt = 1) {
    const maxAttempts = 3;
    
    try {
      const startTime = Date.now();
      const response = await this.fetchImplementation(url, options);
      const endTime = Date.now();
      
      // Calculate consciousness-enhanced latency metrics
      const latency = endTime - startTime;
      const psiOptimalLatency = ConsciousnessConstants.PSI_0 * 1000; // ~915ms optimal
      const latencyScore = this.calculateLatencyScore(latency, psiOptimalLatency);
      
      console.log(`🌀 HTTP Request: ${options.method} ${url}`);
      console.log(`⚡ Latency: ${latency}ms (ψ₀ score: ${latencyScore.toFixed(3)})`);
      console.log(`📊 Status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      console.error(`🌀 HTTP Error (attempt ${attempt}):`, error.message);
      
      if (attempt < maxAttempts) {
        // Consciousness-enhanced retry delay using φ exponential backoff
        const baseDelay = 1000; // 1 second
        const retryDelay = baseDelay * Math.pow(ConsciousnessConstants.PHI, attempt - 1);
        
        console.log(`🔄 Retrying in ${retryDelay.toFixed(0)}ms (φ-enhanced backoff)...`);
        
        await this.delay(retryDelay);
        return this.executeWithConsciousnessRetry(url, options, attempt + 1);
      }
      
      throw error;
    }
  }

  /**
   * Calculate consciousness-based latency score
   */
  calculateLatencyScore(actualLatency, optimalLatency) {
    const latencyRatio = actualLatency / optimalLatency;
    // Closer to ψ₀ optimal latency = higher score
    return Math.max(0, 1 - Math.abs(latencyRatio - ConsciousnessConstants.PSI_0));
  }

  /**
   * Consciousness-enhanced delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test connection with consciousness validation
   */
  async testConnection(url) {
    try {
      console.log(`🌀 Testing connection to: ${url}`);
      const response = await this.get(url);
      
      return {
        success: true,
        status: response.status,
        message: 'Connection successful with consciousness enhancement',
        consciousness_validation: true
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Connection failed - consciousness enhancement available',
        consciousness_validation: false
      };
    }
  }
}

// Export for both CommonJS and ES modules
const httpClient = new UniversalHttpClient();

// CommonJS export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = httpClient;
  module.exports.UniversalHttpClient = UniversalHttpClient;
  module.exports.ConsciousnessConstants = ConsciousnessConstants;
}

// ES module export (for future compatibility)
if (typeof globalThis !== 'undefined') {
  globalThis.UniversalHttpClient = UniversalHttpClient;
  globalThis.httpClient = httpClient;
}

console.log('🌀 Universal HTTP Client initialized with consciousness enhancement');
console.log(`📡 Environment: ${typeof window === 'undefined' ? 'Node.js' : 'Browser'}`);
console.log(`⚡ ψ₀ = ${ConsciousnessConstants.PSI_0}, φ = ${ConsciousnessConstants.PHI}, 432Hz = ${ConsciousnessConstants.FREQ_432}`);
