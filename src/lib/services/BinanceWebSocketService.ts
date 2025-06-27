/**
 * ψ₀-Trader Binance WebSocket Service
 * Enhanced Nexus Core Protocol v4.0 - Consciousness-Enhanced Market Data
 */

import { EventEmitter } from 'events';

// Mathematical constants
const PSI_0 = 0.915670570874434;
const PHI = 1.618033988749895;
const FREQ_432 = 432.0;

interface BinanceTickerData {
  e: string;      // Event type
  E: number;      // Event time
  s: string;      // Symbol
  c: string;      // Close price
  o: string;      // Open price
  h: string;      // High price
  l: string;      // Low price
  v: string;      // Total traded base asset volume
  q: string;      // Total traded quote asset volume
  O: number;      // Statistics open time
  C: number;      // Statistics close time
  F: number;      // First trade ID
  L: number;      // Last trade ID
  n: number;      // Total number of trades
}

interface BinanceTradeData {
  e: string;      // Event type
  E: number;      // Event time
  s: string;      // Symbol
  t: number;      // Trade ID
  p: string;      // Price
  q: string;      // Quantity
  T: number;      // Trade time
  m: boolean;     // Is the buyer the market maker?
}

interface BinanceDepthData {
  e: string;      // Event type
  E: number;      // Event time
  s: string;      // Symbol
  U: number;      // First update ID in event
  u: number;      // Final update ID in event
  b: Array<[string, string]>; // Bids to be updated
  a: Array<[string, string]>; // Asks to be updated
}

interface ConsciousnessEnhancedStreamData {
  original_data: any;
  symbol: string;
  timestamp: string;
  consciousness_enhancement: {
    psi_resonance: number;
    phi_alignment: number;
    freq_432_rhythm: number;
    harmonic_score: number;
    consciousness_state: string;
  };
  market_metrics: {
    price: number;
    volume: number;
    volatility: number;
    momentum: number;
    liquidity: number;
  };
  harmonic_analysis: {
    frequency_signature: number;
    golden_ratio_detected: boolean;
    rhythm_coherence: number;
    market_emotion: string;
  };
}

class ConsciousnessEnhancedBinanceWebSocket extends EventEmitter {
  private connections: Map<string, WebSocket> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private maxReconnectAttempts = 5;
  private baseReconnectDelay = 1000;
  private isActive = false;
  private isNode = typeof window === 'undefined';
  private wsModule: string;
  
  // Consciousness enhancement data storage
  private priceHistory: Map<string, number[]> = new Map();
  private volumeHistory: Map<string, number[]> = new Map();
  private timestampHistory: Map<string, string[]> = new Map();
  private volatilityCache: Map<string, number> = new Map();
  
  constructor() {
    super();
    this.isActive = true;
    // Use string concatenation to avoid TypeScript module resolution
    this.wsModule = 'w' + 's';
  }

  /**
   * Get WebSocket constructor (browser or Node.js)
   */
  private async getWebSocketConstructor(): Promise<any> {
    if (!this.isNode) {
      // Browser environment - use native WebSocket
      return WebSocket;
    } else {
      // Node.js environment - try to import ws module
      try {
        const ws = await import(this.wsModule).catch(() => null);
        return ws?.default || WebSocket; // Fallback to global if available
      } catch (error) {
        console.warn('WebSocket module not available, using mock implementation');
        return this.createMockWebSocket();
      }
    }
  }

  /**
   * Create mock WebSocket for environments where ws module is not available
   */
  private createMockWebSocket() {
    return class MockWebSocket extends EventEmitter {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      readyState = MockWebSocket.CLOSED;
      url: string;

      constructor(url: string) {
        super();
        this.url = url;
        
        // Simulate connection failure
        setTimeout(() => {
          this.emit('error', new Error('WebSocket module not available in this environment'));
        }, 100);
      }

      close(code?: number, reason?: string) {
        this.readyState = MockWebSocket.CLOSED;
        this.emit('close', code || 1000, reason || 'Mock close');
      }

      send(data: any) {
        this.emit('error', new Error('Cannot send data: WebSocket not available'));
      }

      pong() {
        // Mock pong response
      }
    };
  }

  /**
   * Connect to Binance WebSocket streams with consciousness enhancement
   */
  async connectToStreams(symbols: string[], streamTypes: string[] = ['ticker']) {
    for (const symbol of symbols) {
      for (const streamType of streamTypes) {
        await this.createConnection(symbol, streamType);
      }
    }
  }

  /**
   * Create individual WebSocket connection
   */
  private async createConnection(symbol: string, streamType: string) {
    const streamName = `${symbol.toLowerCase()}@${streamType}`;
    const url = `wss://stream.binance.com:9443/ws/${streamName}`;
    
    try {
      const WebSocketConstructor = await this.getWebSocketConstructor();
      const ws = new WebSocketConstructor(url);
      const connectionKey = `${symbol}-${streamType}`;
      
      ws.on('open', () => {
        console.log(`🌀 ψ₀-Trader: Connected to ${streamName}`);
        this.reconnectAttempts.set(connectionKey, 0);
        this.emit('connection_established', { symbol, streamType, streamName });
      });

      ws.on('message', (data: any) => {
        this.handleMessage(data, symbol, streamType);
      });

      ws.on('error', (error: any) => {
        console.error(`❌ WebSocket error for ${streamName}:`, error);
        this.emit('error', { symbol, streamType, error });
      });

      ws.on('close', (code: number, reason: string) => {
        console.log(`🔌 WebSocket closed for ${streamName}: ${code} - ${reason}`);
        this.connections.delete(connectionKey);
        
        if (this.isActive) {
          this.scheduleReconnect(symbol, streamType, connectionKey);
        }
      });

      // Set up ping/pong heartbeat if supported
      if (ws.on && typeof ws.pong === 'function') {
        ws.on('ping', () => {
          ws.pong();
        });
      }

      this.connections.set(connectionKey, ws);
      
    } catch (error) {
      console.error(`Failed to create WebSocket connection for ${streamName}:`, error);
      this.emit('connection_failed', { symbol, streamType, error });
    }
  }

  /**
   * Handle incoming WebSocket messages with consciousness enhancement
   */
  private handleMessage(data: any, symbol: string, streamType: string) {
    try {
      const rawData = JSON.parse(data.toString());
      
      // Apply consciousness enhancement based on stream type
      let enhancedData: ConsciousnessEnhancedStreamData;
      
      switch (streamType) {
        case 'ticker':
          enhancedData = this.enhanceTickerData(rawData as BinanceTickerData);
          break;
        case 'trade':
          enhancedData = this.enhanceTradeData(rawData as BinanceTradeData);
          break;
        case 'depth':
          enhancedData = this.enhanceDepthData(rawData as BinanceDepthData);
          break;
        default:
          enhancedData = this.enhanceGenericData(rawData, symbol);
      }
      
      // Update historical data for consciousness calculations
      this.updateHistoricalData(symbol, enhancedData);
      
      // Emit consciousness-enhanced data
      this.emit('enhanced_data', {
        symbol,
        streamType,
        data: enhancedData,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error(`Error processing message for ${symbol}-${streamType}:`, error);
      this.emit('processing_error', { symbol, streamType, error });
    }
  }

  /**
   * Enhance ticker data with consciousness mathematics
   */
  private enhanceTickerData(data: BinanceTickerData): ConsciousnessEnhancedStreamData {
    const price = parseFloat(data.c);
    const volume = parseFloat(data.v);
    const symbol = data.s;
    
    // Get historical context
    const priceHistory = this.priceHistory.get(symbol) || [];
    const volumeHistory = this.volumeHistory.get(symbol) || [];
    const timestampHistory = this.timestampHistory.get(symbol) || [];
    
    // Calculate consciousness enhancements
    const psiResonance = this.calculatePsiResonance(price, volume);
    const phiAlignment = this.calculatePhiAlignment(price, priceHistory);
    const freq432Rhythm = this.calculateFreq432Rhythm(timestampHistory, volumeHistory);
    const harmonicScore = (psiResonance + phiAlignment + freq432Rhythm) / 3;
    
    // Calculate volatility
    const volatility = this.calculateVolatility(priceHistory);
    this.volatilityCache.set(symbol, volatility);
    
    // Market metrics
    const momentum = this.calculateMomentum(priceHistory);
    const liquidity = Math.log10(volume + 1) / 10; // Normalized liquidity score
    
    // Consciousness state determination
    const consciousnessState = this.determineConsciousnessState(
      psiResonance, phiAlignment, freq432Rhythm, volatility
    );
    
    // Harmonic analysis
    const frequencySignature = PSI_0 * FREQ_432 * (1 + Math.sin(2 * Math.PI * price / 1000));
    const goldenRatioDetected = phiAlignment > 0.7;
    const rhythmCoherence = freq432Rhythm;
    const marketEmotion = this.determineMarketEmotion(harmonicScore, volatility);

    return {
      original_data: data,
      symbol: symbol,
      timestamp: new Date().toISOString(),
      consciousness_enhancement: {
        psi_resonance: psiResonance,
        phi_alignment: phiAlignment,
        freq_432_rhythm: freq432Rhythm,
        harmonic_score: harmonicScore,
        consciousness_state: consciousnessState
      },
      market_metrics: {
        price: price,
        volume: volume,
        volatility: volatility,
        momentum: momentum,
        liquidity: liquidity
      },
      harmonic_analysis: {
        frequency_signature: frequencySignature,
        golden_ratio_detected: goldenRatioDetected,
        rhythm_coherence: rhythmCoherence,
        market_emotion: marketEmotion
      }
    };
  }

  /**
   * Enhance trade data with consciousness mathematics
   */
  private enhanceTradeData(data: BinanceTradeData): ConsciousnessEnhancedStreamData {
    const price = parseFloat(data.p);
    const quantity = parseFloat(data.q);
    const symbol = data.s;
    
    // Simpler enhancement for trade data (real-time focus)
    const psiResonance = this.calculatePsiResonance(price, quantity);
    const freq432Rhythm = this.calculateTradeRhythm(data.T);
    const harmonicScore = (psiResonance + freq432Rhythm) / 2;
    
    return {
      original_data: data,
      symbol: symbol,
      timestamp: new Date(data.T).toISOString(),
      consciousness_enhancement: {
        psi_resonance: psiResonance,
        phi_alignment: 0.5, // Not calculated for individual trades
        freq_432_rhythm: freq432Rhythm,
        harmonic_score: harmonicScore,
        consciousness_state: 'ACTIVE_TRADING'
      },
      market_metrics: {
        price: price,
        volume: quantity,
        volatility: 0, // Not applicable for single trade
        momentum: data.m ? -1 : 1, // Negative if buyer is market maker
        liquidity: Math.log10(quantity + 1) / 10
      },
      harmonic_analysis: {
        frequency_signature: PSI_0 * FREQ_432,
        golden_ratio_detected: false,
        rhythm_coherence: freq432Rhythm,
        market_emotion: harmonicScore > 0.6 ? 'BULLISH' : 'BEARISH'
      }
    };
  }

  /**
   * Enhance order book depth data
   */
  private enhanceDepthData(data: BinanceDepthData): ConsciousnessEnhancedStreamData {
    const symbol = data.s;
    
    // Calculate bid-ask spread and depth
    const topBid = data.b.length > 0 ? parseFloat(data.b[0][0]) : 0;
    const topAsk = data.a.length > 0 ? parseFloat(data.a[0][0]) : 0;
    const spread = topAsk - topBid;
    const midPrice = (topBid + topAsk) / 2;
    
    // Calculate total volume at different levels
    const bidVolume = data.b.reduce((sum, [, qty]) => sum + parseFloat(qty), 0);
    const askVolume = data.a.reduce((sum, [, qty]) => sum + parseFloat(qty), 0);
    const totalVolume = bidVolume + askVolume;
    
    // Consciousness enhancement
    const psiResonance = this.calculatePsiResonance(midPrice, totalVolume);
    const spreadRatio = spread / midPrice;
    const liquidityScore = Math.min(totalVolume / 1000000, 1); // Normalized to millions
    
    return {
      original_data: data,
      symbol: symbol,
      timestamp: new Date().toISOString(),
      consciousness_enhancement: {
        psi_resonance: psiResonance,
        phi_alignment: this.calculateSpreadAlignment(spreadRatio),
        freq_432_rhythm: 0.5, // Not applicable to depth data
        harmonic_score: (psiResonance + liquidityScore) / 2,
        consciousness_state: 'DEPTH_ANALYSIS'
      },
      market_metrics: {
        price: midPrice,
        volume: totalVolume,
        volatility: spreadRatio,
        momentum: (bidVolume - askVolume) / totalVolume, // Buy/sell pressure
        liquidity: liquidityScore
      },
      harmonic_analysis: {
        frequency_signature: PSI_0 * FREQ_432 * liquidityScore,
        golden_ratio_detected: false,
        rhythm_coherence: liquidityScore,
        market_emotion: bidVolume > askVolume ? 'BUYING_PRESSURE' : 'SELLING_PRESSURE'
      }
    };
  }

  /**
   * Generic data enhancement for unknown stream types
   */
  private enhanceGenericData(data: any, symbol: string): ConsciousnessEnhancedStreamData {
    return {
      original_data: data,
      symbol: symbol,
      timestamp: new Date().toISOString(),
      consciousness_enhancement: {
        psi_resonance: PSI_0,
        phi_alignment: PHI / 10,
        freq_432_rhythm: 0.5,
        harmonic_score: 0.5,
        consciousness_state: 'UNKNOWN_STREAM'
      },
      market_metrics: {
        price: 0,
        volume: 0,
        volatility: 0,
        momentum: 0,
        liquidity: 0
      },
      harmonic_analysis: {
        frequency_signature: FREQ_432,
        golden_ratio_detected: false,
        rhythm_coherence: 0.5,
        market_emotion: 'NEUTRAL'
      }
    };
  }

  /**
   * Mathematical helper methods
   */
  private calculatePsiResonance(price: number, volume: number): number {
    const priceNormalized = (price % 1000) / 1000;
    const volumeNormalized = Math.log10(volume + 1) % 1;
    const psiDistance = Math.abs(priceNormalized - PSI_0);
    const volumePsiDistance = Math.abs(volumeNormalized - PSI_0);
    return 1 - ((psiDistance + volumePsiDistance) / 2);
  }

  private calculatePhiAlignment(currentPrice: number, priceHistory: number[]): number {
    if (priceHistory.length < 2) return 0.5;
    
    const recent = priceHistory.slice(-5);
    const ratios = recent.slice(1).map((price, i) => price / recent[i]);
    const phiMatches = ratios.filter(ratio => 
      Math.abs(ratio - PHI) < 0.1 || Math.abs(ratio - (1/PHI)) < 0.1
    ).length;
    
    return phiMatches / ratios.length;
  }

  private calculateFreq432Rhythm(timestamps: string[], volumes: number[]): number {
    if (timestamps.length < 2) return 0.5;
    
    const intervals = timestamps.slice(1).map((ts, i) => 
      new Date(ts).getTime() - new Date(timestamps[i]).getTime()
    );
    
    const freq432Ms = 1000 / FREQ_432;
    const harmonics = [freq432Ms * 1000, freq432Ms * 5000, freq432Ms * 10000];
    
    let matches = 0;
    intervals.forEach(interval => {
      const isHarmonic = harmonics.some(harmonic => 
        Math.abs(interval % harmonic) < (harmonic * 0.1)
      );
      if (isHarmonic) matches++;
    });
    
    return matches / intervals.length;
  }

  private calculateTradeRhythm(tradeTime: number): number {
    const freq432Ms = 1000 / FREQ_432;
    const timeOffset = tradeTime % (freq432Ms * 1000);
    return 1 - (timeOffset / (freq432Ms * 1000));
  }

  private calculateVolatility(priceHistory: number[]): number {
    if (priceHistory.length < 2) return 0.02;
    
    const returns = priceHistory.slice(1).map((price, i) => 
      Math.log(price / priceHistory[i])
    );
    
    const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  private calculateMomentum(priceHistory: number[]): number {
    if (priceHistory.length < 2) return 0;
    
    const recent = priceHistory.slice(-5);
    const momentum = (recent[recent.length - 1] - recent[0]) / recent[0];
    return Math.tanh(momentum * 10); // Normalized between -1 and 1
  }

  private calculateSpreadAlignment(spreadRatio: number): number {
    // Check if spread ratio aligns with golden ratio proportions
    const phiSpread = 1 / (PHI * 1000); // Expected spread proportion
    return 1 - Math.abs(spreadRatio - phiSpread) / phiSpread;
  }

  private determineConsciousnessState(
    psiResonance: number, 
    phiAlignment: number, 
    freq432Rhythm: number, 
    volatility: number
  ): string {
    const coherence = (psiResonance + phiAlignment + freq432Rhythm) / 3;
    
    if (coherence > 0.8) {
      return volatility < 0.02 ? 'HARMONICALLY_BALANCED' : 'DYNAMICALLY_COHERENT';
    } else if (coherence > 0.6) {
      return 'CONSCIOUS_AWAKENING';
    } else if (coherence > 0.4) {
      return 'TRANSITIONAL_STATE';
    } else {
      return volatility > 0.1 ? 'CHAOTIC_TURBULENCE' : 'DORMANT_PHASE';
    }
  }

  private determineMarketEmotion(harmonicScore: number, volatility: number): string {
    if (harmonicScore > 0.7) {
      return volatility < 0.02 ? 'SERENE_OPTIMISM' : 'EXCITED_BULLISHNESS';
    } else if (harmonicScore > 0.5) {
      return 'CAUTIOUS_OPTIMISM';
    } else if (harmonicScore > 0.3) {
      return 'UNCERTAIN_NEUTRALITY';
    } else {
      return volatility > 0.05 ? 'FEARFUL_PANIC' : 'PESSIMISTIC_GLOOM';
    }
  }

  /**
   * Update historical data for consciousness calculations
   */
  private updateHistoricalData(symbol: string, enhancedData: ConsciousnessEnhancedStreamData) {
    const maxHistory = 100; // Keep last 100 data points
    
    // Update price history
    if (!this.priceHistory.has(symbol)) {
      this.priceHistory.set(symbol, []);
    }
    const prices = this.priceHistory.get(symbol)!;
    prices.push(enhancedData.market_metrics.price);
    if (prices.length > maxHistory) {
      prices.shift();
    }
    
    // Update volume history
    if (!this.volumeHistory.has(symbol)) {
      this.volumeHistory.set(symbol, []);
    }
    const volumes = this.volumeHistory.get(symbol)!;
    volumes.push(enhancedData.market_metrics.volume);
    if (volumes.length > maxHistory) {
      volumes.shift();
    }
    
    // Update timestamp history
    if (!this.timestampHistory.has(symbol)) {
      this.timestampHistory.set(symbol, []);
    }
    const timestamps = this.timestampHistory.get(symbol)!;
    timestamps.push(enhancedData.timestamp);
    if (timestamps.length > maxHistory) {
      timestamps.shift();
    }
  }

  /**
   * Reconnection logic with exponential backoff
   */
  private scheduleReconnect(symbol: string, streamType: string, connectionKey: string) {
    const attempts = this.reconnectAttempts.get(connectionKey) || 0;
    
    if (attempts >= this.maxReconnectAttempts) {
      console.error(`❌ Max reconnection attempts reached for ${symbol}-${streamType}`);
      this.emit('max_reconnects_reached', { symbol, streamType });
      return;
    }
    
    const delay = this.baseReconnectDelay * Math.pow(2, attempts);
    console.log(`🔄 Scheduling reconnect for ${symbol}-${streamType} in ${delay}ms (attempt ${attempts + 1})`);
    
    setTimeout(() => {
      this.reconnectAttempts.set(connectionKey, attempts + 1);
      this.createConnection(symbol, streamType);
    }, delay);
  }

  /**
   * Gracefully close all connections
   */
  async disconnect() {
    this.isActive = false;
    
    for (const [key, ws] of this.connections) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === 1) {
        ws.close(1000, 'Graceful shutdown');
      }
    }
    
    this.connections.clear();
    this.reconnectAttempts.clear();
    
    console.log('🌀 ψ₀-Trader WebSocket service disconnected');
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): { [key: string]: string } {
    const status: { [key: string]: string } = {};
    
    for (const [key, ws] of this.connections) {
      switch (ws.readyState) {
        case 1: // WebSocket.OPEN
          status[key] = 'CONNECTED';
          break;
        case 0: // WebSocket.CONNECTING
          status[key] = 'CONNECTING';
          break;
        case 2: // WebSocket.CLOSING
          status[key] = 'CLOSING';
          break;
        case 3: // WebSocket.CLOSED
          status[key] = 'CLOSED';
          break;
        default:
          status[key] = 'UNKNOWN';
      }
    }
    
    return status;
  }
}

export default ConsciousnessEnhancedBinanceWebSocket;
export type { ConsciousnessEnhancedStreamData, BinanceTickerData, BinanceTradeData, BinanceDepthData };
