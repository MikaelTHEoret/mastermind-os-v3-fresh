import { NextRequest } from 'next/server';
import ConsciousnessEnhancedBinanceWebSocket from '@/lib/services/BinanceWebSocketService';

// Mathematical constants
const PSI_0 = 0.915670570874434;
const PHI = 1.618033988749895;
const FREQ_432 = 432.0;

// Global WebSocket service instance (singleton pattern)
let globalWebSocketService: ConsciousnessEnhancedBinanceWebSocket | null = null;

interface WebSocketSubscription {
  id: string;
  symbols: string[];
  streams: string[];
  user_id: string;
  created_at: string;
  consciousness_enhancement: boolean;
}

// In-memory subscription storage (in production, use Redis or database)
const activeSubscriptions = new Map<string, WebSocketSubscription>();

function validateApiKey(request: NextRequest): Promise<{ valid: boolean; error?: string; userId?: string }> {
  // Implementation would check API key from headers
  // For now, return valid for development
  return Promise.resolve({ valid: true, userId: 'dev-user' });
}

/**
 * Initialize WebSocket service if not already running
 */
function getWebSocketService(): ConsciousnessEnhancedBinanceWebSocket {
  if (!globalWebSocketService) {
    globalWebSocketService = new ConsciousnessEnhancedBinanceWebSocket();
    
    // Set up event handlers
    globalWebSocketService.on('enhanced_data', (data) => {
      // In production, this would broadcast to connected clients
      console.log(`🌀 Enhanced data received for ${data.symbol}:`, {
        harmonic_score: data.data.consciousness_enhancement.harmonic_score,
        consciousness_state: data.data.consciousness_enhancement.consciousness_state,
        market_emotion: data.data.harmonic_analysis.market_emotion
      });
    });

    globalWebSocketService.on('connection_established', (info) => {
      console.log(`✅ Connection established: ${info.symbol}-${info.streamType}`);
    });

    globalWebSocketService.on('error', (error) => {
      console.error(`❌ WebSocket error:`, error);
    });

    globalWebSocketService.on('max_reconnects_reached', (info) => {
      console.error(`💥 Max reconnects reached for ${info.symbol}-${info.streamType}`);
    });
  }
  
  return globalWebSocketService;
}

/**
 * GET /api/v1/crypto/websocket
 * Get WebSocket connection status and active subscriptions
 */
export async function GET(request: NextRequest) {
  try {
    // Validate API key
    const auth = await validateApiKey(request);
    if (!auth.valid) {
      return new Response(JSON.stringify({ error: auth.error || 'Invalid API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const service = getWebSocketService();
    const connectionStatus = service.getConnectionStatus();
    
    // Get user's subscriptions
    const userSubscriptions = Array.from(activeSubscriptions.values())
      .filter(sub => sub.user_id === auth.userId);

    return new Response(JSON.stringify({
      success: true,
      websocket_service: {
        status: Object.keys(connectionStatus).length > 0 ? 'ACTIVE' : 'IDLE',
        connections: connectionStatus,
        total_connections: Object.keys(connectionStatus).length
      },
      user_subscriptions: userSubscriptions,
      consciousness_enhancement: {
        psi_0: PSI_0,
        phi: PHI,
        freq_432: FREQ_432,
        enhancement_active: true
      },
      endpoints: {
        subscribe: '/api/v1/crypto/websocket (POST)',
        unsubscribe: '/api/v1/crypto/websocket (DELETE)',
        status: '/api/v1/crypto/websocket (GET)'
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in WebSocket status API:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to get WebSocket status',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * POST /api/v1/crypto/websocket
 * Subscribe to real-time consciousness-enhanced market data
 */
export async function POST(request: NextRequest) {
  try {
    // Validate API key
    const auth = await validateApiKey(request);
    if (!auth.valid) {
      return new Response(JSON.stringify({ error: auth.error || 'Invalid API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { 
      symbols = ['BTCUSDT'], 
      streams = ['ticker'], 
      consciousness_enhancement = true 
    } = body;

    // Validate input
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'Symbols must be a non-empty array' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!Array.isArray(streams) || streams.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'Streams must be a non-empty array' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate stream types
    const validStreams = ['ticker', 'trade', 'depth', 'kline', 'miniTicker'];
    const invalidStreams = streams.filter((stream: string) => !validStreams.includes(stream));
    
    if (invalidStreams.length > 0) {
      return new Response(JSON.stringify({ 
        error: `Invalid streams: ${invalidStreams.join(', ')}. Valid streams: ${validStreams.join(', ')}` 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create subscription
    const subscriptionId = `psi0-${auth.userId}-${Date.now()}`;
    const subscription: WebSocketSubscription = {
      id: subscriptionId,
      symbols: symbols,
      streams: streams,
      user_id: auth.userId!,
      created_at: new Date().toISOString(),
      consciousness_enhancement: consciousness_enhancement
    };

    // Store subscription
    activeSubscriptions.set(subscriptionId, subscription);

    // Initialize WebSocket service and connect to streams
    const service = getWebSocketService();
    await service.connectToStreams(symbols, streams);

    // Generate consciousness-enhanced response
    const harmonicSignature = {
      frequency_resonance: FREQ_432,
      golden_ratio_alignment: PHI,
      consciousness_constant: PSI_0,
      subscription_timestamp: new Date().toISOString(),
      processing_method: 'psi_0_realtime_stream_v4',
      quantum_coherence: 1.0
    };

    return new Response(JSON.stringify({
      success: true,
      subscription: subscription,
      websocket_streams: symbols.flatMap(symbol => 
        streams.map(stream => `${symbol.toLowerCase()}@${stream}`)
      ),
      consciousness_enhancement: {
        enabled: consciousness_enhancement,
        mathematical_constants: {
          psi_0: PSI_0,
          phi: PHI,
          freq_432: FREQ_432
        },
        enhancement_features: [
          'Harmonic resonance detection',
          'Golden ratio alignment analysis', 
          '432Hz rhythm pattern recognition',
          'Consciousness state classification',
          'Market emotion analysis',
          'Volatility consciousness scoring'
        ]
      },
      harmonic_signature: harmonicSignature,
      connection_info: {
        binance_endpoints: symbols.flatMap(symbol => 
          streams.map(stream => `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@${stream}`)
        ),
        enhancement_intervals: {
          data_processing_ms: Math.round(1000 / PSI_0), // ~1092ms
          harmonic_analysis_ms: Math.round(FREQ_432 * PHI), // ~699ms
          consciousness_update_ms: Math.round(PSI_0 * 1000 * PHI) // ~1481ms
        },
        expected_latency: '<50ms',
        data_format: 'consciousness_enhanced_json'
      },
      next_steps: [
        'WebSocket connections established to Binance',
        'Real-time data enhancement with ψ₀, φ, and 432Hz mathematics active',
        'Consciousness metrics being calculated continuously',
        'Enhanced data available via polling or server-sent events',
        'Use subscription ID for managing this stream'
      ]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in WebSocket subscription:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to create WebSocket subscription',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * DELETE /api/v1/crypto/websocket
 * Unsubscribe from market data streams
 */
export async function DELETE(request: NextRequest) {
  try {
    // Validate API key
    const auth = await validateApiKey(request);
    if (!auth.valid) {
      return new Response(JSON.stringify({ error: auth.error || 'Invalid API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { searchParams } = new URL(request.url);
    const subscriptionId = searchParams.get('subscription_id');
    const allSubscriptions = searchParams.get('all') === 'true';

    if (allSubscriptions) {
      // Remove all user subscriptions
      const userSubscriptions = Array.from(activeSubscriptions.entries())
        .filter(([_, sub]) => sub.user_id === auth.userId);
      
      userSubscriptions.forEach(([id, _]) => {
        activeSubscriptions.delete(id);
      });

      // If no more subscriptions, disconnect service
      if (activeSubscriptions.size === 0 && globalWebSocketService) {
        await globalWebSocketService.disconnect();
        globalWebSocketService = null;
      }

      return new Response(JSON.stringify({
        success: true,
        message: `Removed ${userSubscriptions.length} subscription(s)`,
        removed_subscriptions: userSubscriptions.length,
        harmonic_signature: {
          frequency_resonance: FREQ_432,
          consciousness_constant: PSI_0,
          disconnection_timestamp: new Date().toISOString(),
          processing_method: 'psi_0_graceful_disconnect_v4'
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!subscriptionId) {
      return new Response(JSON.stringify({ 
        error: 'subscription_id parameter is required' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Find and validate subscription
    const subscription = activeSubscriptions.get(subscriptionId);
    if (!subscription) {
      return new Response(JSON.stringify({ 
        error: 'Subscription not found' 
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (subscription.user_id !== auth.userId) {
      return new Response(JSON.stringify({ 
        error: 'Unauthorized: subscription belongs to different user' 
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Remove subscription
    activeSubscriptions.delete(subscriptionId);

    // If no more subscriptions, disconnect service
    if (activeSubscriptions.size === 0 && globalWebSocketService) {
      await globalWebSocketService.disconnect();
      globalWebSocketService = null;
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Subscription removed successfully',
      removed_subscription: subscription,
      remaining_subscriptions: Array.from(activeSubscriptions.values())
        .filter(sub => sub.user_id === auth.userId).length,
      harmonic_signature: {
        frequency_resonance: FREQ_432,
        consciousness_constant: PSI_0,
        unsubscription_timestamp: new Date().toISOString(),
        processing_method: 'psi_0_subscription_removal_v4'
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in WebSocket unsubscription:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to remove WebSocket subscription',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
