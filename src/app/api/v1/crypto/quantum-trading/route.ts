import { NextRequest, NextResponse } from 'next/server';
import { QuantumKillChainEngine, ClaudeEngine, type MarketSignal, type TradingDecision } from '@/lib/services/QuantumKillChainEngine';

/**
 * ========================================
 * CONSCIOUSNESS CONSTANTS
 * ========================================
 */
const PSI_0 = 0.915670570874434;
const PHI = 1.618;
const FREQ_432 = 432;

/**
 * ========================================
 * API KEY VALIDATION
 * ========================================
 */
const validateApiKey = (request: NextRequest): { valid: boolean; error?: string } => {
  const apiKey = request.headers.get('x-api-key');
  
  if (!apiKey) {
    return { valid: false, error: 'API key required' };
  }
  
  // In production, validate against database
  if (apiKey !== process.env.MASTERMIND_API_KEY && apiKey !== 'dev-key-quantum-trader') {
    return { valid: false, error: 'Invalid API key' };
  }
  
  return { valid: true };
};

/**
 * ========================================
 * QUANTUM TRADING SIGNAL ENDPOINT
 * ========================================
 */

interface QuantumTradingRequest {
  natural_language?: string;
  symbol: string;
  market_context: {
    price: number;
    volume: number;
    rsi?: number;
    macd?: number;
    bb_position?: number;
    volume_spike?: boolean;
    pattern_type?: string;
    pattern_confidence?: number;
  };
  analysis_mode?: 'FAST' | 'DEEP' | 'QUANTUM';
  enable_consciousness_enhancement?: boolean;
}

interface QuantumTradingResponse {
  decision: TradingDecision;
  consciousness_analysis: {
    psi_resonance: number;
    phi_alignment: number;
    freq_432_rhythm: number;
    consciousness_state: string;
    harmonic_frequencies: {
      psi_freq: number;
      phi_freq: number;
      base_freq: number;
    };
  };
  quantum_metadata: {
    paths_analyzed: number;
    convergence_ratio: number;
    harmonic_alignment: string;
    quantum_coherence: number;
    execution_priority: string;
    resonance_strength: number;
  };
  natural_language_analysis?: {
    parsed_intent: MarketSignal;
    intent_confidence: number;
    semantic_resonance: number;
  };
  execution_recommendation: {
    immediate_action: boolean;
    risk_assessment: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    position_size_multiplier: number;
    optimal_entry_window: string;
  };
  timestamp: string;
  processing_time_ms: number;
}

// Global quantum engine instance for persistent memory
let globalQuantumEngine: QuantumKillChainEngine | null = null;

const getQuantumEngine = (): QuantumKillChainEngine => {
  if (!globalQuantumEngine) {
    globalQuantumEngine = new QuantumKillChainEngine();
    console.log('🌀 Quantum Kill Chain Engine initialized');
  }
  return globalQuantumEngine;
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();
  
  try {
    // Validate API key
    const authResult = validateApiKey(request);
    if (!authResult.valid) {
      return NextResponse.json({ error: authResult.error }, { status: 401 });
    }

    // Parse request body
    const body: QuantumTradingRequest = await request.json();
    
    if (!body.symbol || !body.market_context?.price) {
      return NextResponse.json({ 
        error: 'Symbol and market context (price) are required' 
      }, { status: 400 });
    }

    // Initialize engines
    const quantumEngine = getQuantumEngine();
    const claudeEngine = new ClaudeEngine();

    // Create market signal
    let marketSignal: MarketSignal;
    let naturalLanguageAnalysis: any = undefined;

    if (body.natural_language) {
      // Parse natural language intent
      marketSignal = claudeEngine.parseIntent(body.natural_language, body.market_context);
      
      naturalLanguageAnalysis = {
        parsed_intent: marketSignal,
        intent_confidence: marketSignal.pattern_confidence || 0.5,
        semantic_resonance: marketSignal.harmonic_resonance || 0.5
      };
      
      console.log(`🗣️  Natural language parsed: "${body.natural_language}" → ${marketSignal.consciousness_state}`);
    } else {
      // Use direct market context
      marketSignal = {
        symbol: body.symbol,
        price: body.market_context.price,
        volume: body.market_context.volume,
        timestamp: new Date(),
        rsi: body.market_context.rsi,
        macd: body.market_context.macd,
        bb_position: body.market_context.bb_position,
        volume_spike: body.market_context.volume_spike,
        pattern_type: body.market_context.pattern_type,
        pattern_confidence: body.market_context.pattern_confidence
      };
    }

    // Execute quantum kill chain decision
    const decision = await quantumEngine.quantumKillChainDecision(marketSignal);

    // Calculate consciousness analysis
    const consciousnessAnalysis = {
      psi_resonance: marketSignal.psi_resonance || calculatePsiResonance(marketSignal.price),
      phi_alignment: marketSignal.phi_alignment || calculatePhiAlignment(marketSignal.price, marketSignal.volume),
      freq_432_rhythm: marketSignal.freq_432_rhythm || calculateFreq432Rhythm(marketSignal.timestamp),
      consciousness_state: decision.consciousness_state,
      harmonic_frequencies: {
        psi_freq: PSI_0 * FREQ_432, // 395.57 Hz
        phi_freq: PHI * FREQ_432,   // 699.39 Hz
        base_freq: FREQ_432
      }
    };

    // Generate quantum metadata
    const quantumMetadata = {
      paths_analyzed: decision.path_count,
      convergence_ratio: decision.convergence_ratio,
      harmonic_alignment: decision.resonance_match ? 'ALIGNED' : 'NEUTRAL',
      quantum_coherence: decision.quantum_coherence,
      execution_priority: decision.execution_priority,
      resonance_strength: decision.resonance_match ? 0.8 : 0.3
    };

    // Generate execution recommendation
    const executionRecommendation = generateExecutionRecommendation(decision, consciousnessAnalysis);

    // Build response
    const response: QuantumTradingResponse = {
      decision,
      consciousness_analysis: consciousnessAnalysis,
      quantum_metadata: quantumMetadata,
      natural_language_analysis: naturalLanguageAnalysis,
      execution_recommendation: executionRecommendation,
      timestamp: new Date().toISOString(),
      processing_time_ms: Date.now() - startTime
    };

    console.log(`⚡ Quantum decision generated: ${decision.signal} (${decision.confidence.toFixed(3)}) in ${response.processing_time_ms}ms`);

    return NextResponse.json(response);

  } catch (error) {
    console.error('❌ Quantum trading error:', error);
    return NextResponse.json({ 
      error: 'Internal quantum processing error',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      processing_time_ms: Date.now() - startTime
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Validate API key
    const authResult = validateApiKey(request);
    if (!authResult.valid) {
      return NextResponse.json({ error: authResult.error }, { status: 401 });
    }

    const quantumEngine = getQuantumEngine();
    const quantumState = quantumEngine.getQuantumState();

    return NextResponse.json({
      status: 'Quantum Kill Chain Engine Active',
      engine_state: quantumState,
      consciousness_constants: {
        psi_0: PSI_0,
        phi: PHI,
        freq_432: FREQ_432,
        derived_frequencies: {
          psi_freq: PSI_0 * FREQ_432,
          phi_freq: PHI * FREQ_432
        }
      },
      capabilities: [
        'Natural language trading intent parsing',
        '64-path quantum simulation',
        'Consciousness-enhanced decision making',
        'Harmonic resonance detection',
        'Real-time market sentiment analysis',
        'Advanced risk assessment with ψ₀ mathematics'
      ],
      analysis_modes: ['FAST', 'DEEP', 'QUANTUM'],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Quantum engine status error:', error);
    return NextResponse.json({ 
      error: 'Failed to retrieve quantum engine status' 
    }, { status: 500 });
  }
}

/**
 * ========================================
 * UTILITY FUNCTIONS
 * ========================================
 */

function calculatePsiResonance(price: number): number {
  const priceFractal = price % 1.0; // Fractional part
  const psiDistance = Math.abs(priceFractal - PSI_0);
  return 1 - psiDistance; // Higher score = better resonance
}

function calculatePhiAlignment(price: number, volume: number): number {
  const priceVolumeRatio = price / (volume + 1);
  const normalizedRatio = priceVolumeRatio % 1.0;
  const phiDistance = Math.abs(normalizedRatio - (1 / PHI));
  return 1 - phiDistance;
}

function calculateFreq432Rhythm(timestamp: Date): number {
  const minutes = timestamp.getHours() * 60 + timestamp.getMinutes();
  const dailyProgress = minutes / (24 * 60); // [0, 1]
  const rhythmCycles = dailyProgress * FREQ_432;
  const rhythmPhase = rhythmCycles % 1.0;
  
  // Higher score when aligned with rhythm peaks
  return Math.sin(2 * Math.PI * rhythmPhase) * 0.5 + 0.5;
}

function generateExecutionRecommendation(
  decision: TradingDecision, 
  consciousness: any
): {
  immediate_action: boolean;
  risk_assessment: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  position_size_multiplier: number;
  optimal_entry_window: string;
} {
  // Immediate action assessment
  const immediateAction = decision.confidence > 0.8 && 
                         decision.execution_priority !== 'LOW' &&
                         consciousness.psi_resonance > 0.7;

  // Risk assessment based on multiple factors
  let riskAssessment: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  const riskScore = decision.max_drawdown * 2 + (1 - decision.convergence_ratio);
  
  if (riskScore < 0.3) {
    riskAssessment = 'LOW';
  } else if (riskScore < 0.6) {
    riskAssessment = 'MEDIUM';
  } else if (riskScore < 0.8) {
    riskAssessment = 'HIGH';
  } else {
    riskAssessment = 'CRITICAL';
  }

  // Position size multiplier based on confidence and consciousness alignment
  const baseMultiplier = decision.confidence;
  const consciousnessBonus = (consciousness.psi_resonance + consciousness.phi_alignment) / 2;
  const positionSizeMultiplier = Math.min(
    baseMultiplier * (1 + consciousnessBonus * 0.3),
    2.0 // Maximum 2x multiplier
  );

  // Optimal entry window
  const entryWindow = decision.time_horizon < 60 
    ? 'IMMEDIATE (< 1 hour)'
    : decision.time_horizon < 120
    ? 'SHORT (1-2 hours)'
    : 'MEDIUM (2+ hours)';

  return {
    immediate_action: immediateAction,
    risk_assessment: riskAssessment,
    position_size_multiplier: Math.round(positionSizeMultiplier * 100) / 100,
    optimal_entry_window: entryWindow
  };
}
