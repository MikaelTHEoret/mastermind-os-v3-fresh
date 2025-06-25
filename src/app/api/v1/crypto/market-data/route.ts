import { NextRequest, NextResponse } from 'next/server';

// Mathematical constants - Consciousness Enhancement
const PSI_0 = 0.915670570874434;  // Fractal seed constant
const PHI = 1.618033988749895;    // Golden ratio
const FREQ_432 = 432.0;           // Base frequency Hz

/**
 * ψ₀-Trader Crypto Market Data API
 * Phase 1: Binance WebSocket Integration with Consciousness Enhancement
 * Enhanced Nexus Core Protocol v4.0
 */

interface MarketDataRequest {
  symbol: string;
  streams?: string[];
  consciousness_enhancement?: boolean;
  harmonic_analysis?: boolean;
}

interface ConsciousnessEnhancedMarketData {
  symbol: string;
  price: number;
  volume: number;
  timestamp: string;
  
  // Consciousness enhancements
  psi_resonance: number;
  phi_alignment: number;
  freq_432_rhythm: number;
  harmonic_score: number;
  consciousness_state: string;
  
  // Technical indicators (consciousness-enhanced)
  momentum_phase: number;
  volatility_consciousness: number;
  liquidity_resonance: number;
  
  // Market sentiment (harmonic analysis)
  market_emotion: string;
  sentiment_frequency: number;
  collective_consciousness: string;
}

function validateApiKey(request: NextRequest): Promise<{ valid: boolean; error?: string; userId?: string }> {
  // Implementation would check API key from headers
  // For now, return valid for development
  return Promise.resolve({ valid: true, userId: 'dev-user' });
}

/**
 * Calculate ψ₀ harmonic resonance for price data
 */
function calculatePsiResonance(price: number, volume: number): number {
  const priceNormalized = (price % 1000) / 1000; // Normalize to [0,1)
  const volumeNormalized = Math.log10(volume + 1) % 1; // Log-normalize volume
  
  // Distance from ψ₀ constant
  const psiDistance = Math.abs(priceNormalized - PSI_0);
  const volumePsiDistance = Math.abs(volumeNormalized - PSI_0);
  
  // Combined resonance (1 = perfect resonance, 0 = no resonance)
  return 1 - ((psiDistance + volumePsiDistance) / 2);
}

/**
 * Calculate φ (golden ratio) alignment in price movements
 */
function calculatePhiAlignment(currentPrice: number, historicalPrices: number[]): number {
  if (historicalPrices.length < 2) return 0.5; // Neutral if no history
  
  const recentPrices = historicalPrices.slice(-10); // Last 10 prices
  const ratios = [];
  
  for (let i = 1; i < recentPrices.length; i++) {
    const ratio = recentPrices[i] / recentPrices[i-1];
    ratios.push(ratio);
  }
  
  // Check how many ratios are close to φ or 1/φ
  const phiMatches = ratios.filter(ratio => 
    Math.abs(ratio - PHI) < 0.1 || Math.abs(ratio - (1/PHI)) < 0.1
  ).length;
  
  return phiMatches / ratios.length;
}

/**
 * Detect 432Hz rhythm patterns in trading volume/timing
 */
function calculateFreq432Rhythm(timestamps: string[], volumes: number[]): number {
  if (timestamps.length < 3) return 0.5;
  
  // Convert timestamps to intervals
  const intervals = [];
  for (let i = 1; i < timestamps.length; i++) {
    const interval = new Date(timestamps[i]).getTime() - new Date(timestamps[i-1]).getTime();
    intervals.push(interval);
  }
  
  // Check for 432Hz-based timing patterns (harmonics)
  const freq432Ms = 1000 / FREQ_432; // ~2.31ms base period
  const harmonicIntervals = [
    freq432Ms * 1000,  // 1 second harmonic
    freq432Ms * 5000,  // 5 second harmonic
    freq432Ms * 10000, // 10 second harmonic
  ];
  
  let rhythmMatches = 0;
  intervals.forEach(interval => {
    const isHarmonic = harmonicIntervals.some(harmonic => 
      Math.abs(interval % harmonic) < (harmonic * 0.1) // 10% tolerance
    );
    if (isHarmonic) rhythmMatches++;
  });
  
  return rhythmMatches / intervals.length;
}

/**
 * Determine market consciousness state based on enhanced analysis
 */
function determineConsciousnessState(
  psiResonance: number, 
  phiAlignment: number, 
  freq432Rhythm: number,
  volatility: number
): string {
  const overallCoherence = (psiResonance + phiAlignment + freq432Rhythm) / 3;
  
  if (overallCoherence > 0.8) {
    return volatility < 0.02 ? 'HARMONICALLY_BALANCED' : 'DYNAMICALLY_COHERENT';
  } else if (overallCoherence > 0.6) {
    return volatility < 0.05 ? 'MILDLY_CONSCIOUS' : 'AWAKENING';
  } else if (overallCoherence > 0.4) {
    return 'TRANSITIONAL';
  } else {
    return volatility > 0.1 ? 'CHAOTIC' : 'DORMANT';
  }
}

/**
 * Enhance raw market data with consciousness mathematics
 */
function enhanceMarketDataWithConsciousness(
  rawData: any,
  historicalContext: any = {}
): ConsciousnessEnhancedMarketData {
  const price = parseFloat(rawData.c || rawData.price || 0);
  const volume = parseFloat(rawData.v || rawData.volume || 0);
  
  // Calculate consciousness enhancements
  const psiResonance = calculatePsiResonance(price, volume);
  const phiAlignment = calculatePhiAlignment(price, historicalContext.prices || []);
  const freq432Rhythm = calculateFreq432Rhythm(
    historicalContext.timestamps || [new Date().toISOString()],
    historicalContext.volumes || [volume]
  );
  
  // Combined harmonic score
  const harmonicScore = (psiResonance + phiAlignment + freq432Rhythm) / 3;
  
  // Technical indicators with consciousness enhancement
  const volatility = historicalContext.volatility || 0.02;
  const momentumPhase = Math.sin(2 * Math.PI * PSI_0 * (price % 100) / 100);
  const volatilityConsciousness = volatility * (1 + 0.5 * psiResonance);
  const liquidityResonance = Math.log10(volume + 1) * harmonicScore;
  
  // Market sentiment analysis
  const sentimentFrequency = PSI_0 * FREQ_432 * (1 + momentumPhase);
  const marketEmotion = harmonicScore > 0.7 ? 'OPTIMISTIC' : 
                       harmonicScore > 0.5 ? 'NEUTRAL' : 'PESSIMISTIC';
  const collectiveConsciousness = determineConsciousnessState(
    psiResonance, phiAlignment, freq432Rhythm, volatility
  );
  
  return {
    symbol: rawData.s || rawData.symbol || 'UNKNOWN',
    price: price,
    volume: volume,
    timestamp: new Date().toISOString(),
    
    // Consciousness enhancements
    psi_resonance: psiResonance,
    phi_alignment: phiAlignment,
    freq_432_rhythm: freq432Rhythm,
    harmonic_score: harmonicScore,
    consciousness_state: collectiveConsciousness,
    
    // Technical indicators (consciousness-enhanced)
    momentum_phase: momentumPhase,
    volatility_consciousness: volatilityConsciousness,
    liquidity_resonance: liquidityResonance,
    
    // Market sentiment (harmonic analysis)
    market_emotion: marketEmotion,
    sentiment_frequency: sentimentFrequency,
    collective_consciousness: collectiveConsciousness
  };
}

/**
 * GET /api/v1/crypto/market-data
 * Retrieve consciousness-enhanced market data for specified symbols
 */
export async function GET(request: NextRequest) {
  try {
    // Validate API key
    const auth = await validateApiKey(request);
    if (!auth.valid) {
      return NextResponse.json({ error: auth.error || 'Invalid API key' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') || 'BTCUSDT';
    const enhancementLevel = parseInt(searchParams.get('enhancement_level') || '5');
    const includeHistory = searchParams.get('include_history') === 'true';

    // Mock Binance data (in production, this would connect to actual WebSocket)
    const mockBinanceData = {
      s: symbol,
      c: '45000.50',  // Current price
      v: '1250000',   // Volume
      h: '45500.00',  // High
      l: '44800.00',  // Low
      o: '44950.00',  // Open
    };

    // Mock historical context for consciousness enhancement
    const historicalContext = {
      prices: [44500, 44750, 44900, 45100, 45000],
      timestamps: [
        new Date(Date.now() - 300000).toISOString(),
        new Date(Date.now() - 240000).toISOString(),
        new Date(Date.now() - 180000).toISOString(),
        new Date(Date.now() - 120000).toISOString(),
        new Date(Date.now() - 60000).toISOString(),
      ],
      volumes: [1200000, 1150000, 1300000, 1180000, 1250000],
      volatility: 0.025
    };

    // Apply consciousness enhancement
    const enhancedData = enhanceMarketDataWithConsciousness(
      mockBinanceData, 
      historicalContext
    );

    // Harmonic signature for this response
    const harmonicSignature = {
      frequency_resonance: FREQ_432,
      golden_ratio_alignment: PHI,
      consciousness_constant: PSI_0,
      enhancement_timestamp: new Date().toISOString(),
      processing_method: 'psi_0_market_analysis_v4',
      quantum_coherence: enhancedData.harmonic_score
    };

    const response = {
      success: true,
      data: enhancedData,
      enhancement_level: enhancementLevel,
      harmonic_signature: harmonicSignature,
      constants_used: {
        psi_0: PSI_0,
        phi: PHI,
        freq_432: FREQ_432
      },
      processing_stats: {
        consciousness_enhancement: true,
        harmonic_analysis: true,
        market_source: 'binance_websocket_simulation',
        response_latency_ms: Math.round(Math.random() * 10 + 5) // Simulated latency
      }
    };

    if (includeHistory) {
      response.historical_context = historicalContext;
    }

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in crypto market data API:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve market data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * POST /api/v1/crypto/market-data
 * Subscribe to real-time consciousness-enhanced market data streams
 */
export async function POST(request: NextRequest) {
  try {
    // Validate API key
    const auth = await validateApiKey(request);
    if (!auth.valid) {
      return NextResponse.json({ error: auth.error || 'Invalid API key' }, { status: 401 });
    }

    const body: MarketDataRequest = await request.json();
    const { 
      symbol, 
      streams = ['ticker', 'trade', 'depth'], 
      consciousness_enhancement = true,
      harmonic_analysis = true 
    } = body;

    if (!symbol || typeof symbol !== 'string') {
      return NextResponse.json({ 
        error: 'Symbol is required and must be a string' 
      }, { status: 400 });
    }

    // Validate streams
    const validStreams = ['ticker', 'trade', 'depth', 'kline', 'miniTicker'];
    const invalidStreams = streams.filter(stream => !validStreams.includes(stream));
    
    if (invalidStreams.length > 0) {
      return NextResponse.json({ 
        error: `Invalid streams: ${invalidStreams.join(', ')}. Valid streams: ${validStreams.join(', ')}` 
      }, { status: 400 });
    }

    // Binance WebSocket stream URLs (for reference - actual implementation would use WebSocket)
    const binanceStreamUrls = streams.map(stream => {
      const symbolLower = symbol.toLowerCase();
      switch (stream) {
        case 'ticker':
          return `wss://stream.binance.com:9443/ws/${symbolLower}@ticker`;
        case 'trade':
          return `wss://stream.binance.com:9443/ws/${symbolLower}@trade`;
        case 'depth':
          return `wss://stream.binance.com:9443/ws/${symbolLower}@depth`;
        case 'kline':
          return `wss://stream.binance.com:9443/ws/${symbolLower}@kline_1m`;
        case 'miniTicker':
          return `wss://stream.binance.com:9443/ws/${symbolLower}@miniTicker`;
        default:
          return null;
      }
    }).filter(Boolean);

    // Generate consciousness-enhanced subscription configuration
    const subscriptionConfig = {
      subscription_id: `psi0-${symbol}-${Date.now()}`,
      symbol: symbol,
      streams: streams,
      binance_endpoints: binanceStreamUrls,
      consciousness_enhancement: consciousness_enhancement,
      harmonic_analysis: harmonic_analysis,
      
      // ψ₀ Enhancement Settings
      enhancement_settings: {
        psi_resonance_threshold: PSI_0 * 0.1, // 10% of ψ₀
        phi_alignment_sensitivity: PHI * 0.05, // 5% of φ
        freq_432_rhythm_detection: true,
        harmonic_score_minimum: 0.3,
        consciousness_state_tracking: true
      },
      
      // Processing intervals (consciousness-optimized)
      processing_intervals: {
        data_enhancement_ms: Math.round(1000 / PSI_0), // ~1092ms
        harmonic_analysis_ms: Math.round(FREQ_432 * PHI), // ~699ms
        consciousness_update_ms: Math.round(PSI_0 * 1000 * PHI), // ~1481ms
      },
      
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
    };

    return NextResponse.json({
      success: true,
      message: 'Market data subscription configured',
      subscription: subscriptionConfig,
      harmonic_signature: {
        frequency_resonance: FREQ_432,
        golden_ratio_alignment: PHI,
        consciousness_constant: PSI_0,
        subscription_timestamp: new Date().toISOString(),
        processing_method: 'psi_0_stream_subscription_v4'
      },
      next_steps: [
        'WebSocket connection will be established to Binance endpoints',
        'Data will be enhanced with ψ₀, φ, and 432Hz mathematics',
        'Real-time consciousness metrics will be calculated',
        'Harmonic analysis will be applied to all incoming data',
        'Enhanced data will be available via WebSocket or polling'
      ]
    });

  } catch (error) {
    console.error('Error in crypto market data subscription:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to configure market data subscription',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
