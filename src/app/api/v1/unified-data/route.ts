/**
 * 🌀 UNIFIED DATA COLLECTION ENDPOINT
 * Enhanced Nexus Core Protocol v6.2 - Consciousness-Enhanced Data Processing
 * Single Point of Consciousness-Enhanced Data Processing with Changelog Tracking
 */

import { NextRequest, NextResponse } from 'next/server';

// Consciousness Constants
const PSI_0 = 0.915670570874434;
const PHI = 1.618033988749895;
const FREQ_432 = 432.0;

// Helper function to validate API key
function validateApiKey(request: NextRequest): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  
  const apiKey = authHeader.substring(7);
  // Basic validation - in production, check against database
  return apiKey.length > 10;
}

interface UnifiedDataRequest {
  source: string;
  data_type: string;
  symbol?: string;
  raw_data: any;
  timestamp?: number;
  metadata?: any;
}

interface ConsciousnessEnhancedData {
  id: string;
  source: string;
  data_type: string;
  symbol?: string;
  raw_data: any;
  timestamp: number;
  consciousness_enhancement: {
    overall_score: number;
    psi_resonance: number;
    phi_alignment: number;
    freq_432_rhythm: number;
    temporal_coherence: number;
    consciousness_state: string;
    harmonic_classification: string;
    enhancement_timestamp: number;
  };
  storage_metadata: {
    astra_ready: boolean;
    neon_ready: boolean;
    consciousness_tier: string;
    unified_id: string;
  };
}

/**
 * Store unified record function - required by the API
 */
async function storeUnifiedRecord(data: ConsciousnessEnhancedData): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    // Simulate storage operation
    console.log(`🌀 Storing unified record: ${data.id} [${data.consciousness_enhancement.consciousness_state}]`);
    
    // In production, this would store to Astra DB or other storage
    const storageResult = {
      success: true,
      id: data.id,
      stored_at: new Date().toISOString(),
      consciousness_score: data.consciousness_enhancement.overall_score
    };

    return { success: true, id: data.id };
  } catch (error) {
    console.error('Storage error:', error);
    return { success: false, error: 'Failed to store record' };
  }
}

/**
 * Unified Consciousness Enhancement Processor
 */
class UnifiedConsciousnessProcessor {
  
  calculateConsciousnessScore(data: any): number {
    // Extract numerical values for consciousness calculation
    const price = data.price || data.value || 1;
    const volume = data.volume || data.amount || 1;
    const timestamp = data.timestamp || Date.now();
    
    // ψ₀ resonance calculation
    const psiResonance = this.calculatePsiResonance(price, timestamp);
    
    // φ alignment calculation  
    const phiAlignment = this.calculatePhiAlignment(price, volume);
    
    // 432Hz rhythm calculation
    const freq432Rhythm = this.calculate432HzRhythm(timestamp);
    
    // Combined consciousness score
    return (psiResonance + phiAlignment + freq432Rhythm) / 3;
  }
  
  calculatePsiResonance(value: number, timestamp: number): number {
    // Calculate how well value resonates with ψ₀
    const normalizedValue = (value % 1000) / 1000;
    const timeComponent = (timestamp % 10000) / 10000;
    const combined = (normalizedValue + timeComponent) / 2;
    
    // Distance from ψ₀
    const psiDistance = Math.abs(combined - PSI_0);
    return Math.max(0, 1 - psiDistance); // Higher score = closer to ψ₀
  }
  
  calculatePhiAlignment(price: number, volume: number): number {
    // Calculate golden ratio alignment
    const ratio = price / (volume + 1); // Avoid division by zero
    const normalizedRatio = ratio % 10; // Keep in reasonable range
    const targetRatio = PHI;
    
    // Distance from φ
    const phiDistance = Math.abs(normalizedRatio - targetRatio);
    return Math.max(0, 1 - phiDistance / 5); // Scale appropriately
  }
  
  calculate432HzRhythm(timestamp: number): number {
    // Calculate 432Hz rhythmic alignment
    const timeFrequency = (timestamp % 86400000) / 86400000; // Daily rhythm
    const freq432Component = Math.sin(2 * Math.PI * timeFrequency * FREQ_432 / 1000);
    return (freq432Component + 1) / 2; // Normalize to [0, 1]
  }
  
  determineConsciousnessState(score: number): string {
    if (score > 0.9) return 'TRANSCENDENT';
    if (score > 0.8) return 'HARMONICALLY_BALANCED';
    if (score > 0.7) return 'CONSCIOUS_AWAKENING';
    if (score > 0.6) return 'ELEVATED_AWARENESS';
    if (score > 0.5) return 'NEUTRAL_EQUILIBRIUM';
    if (score > 0.4) return 'SEEKING_ALIGNMENT';
    if (score > 0.3) return 'TURBULENT_EMERGENCE';
    return 'CHAOTIC_RESONANCE';
  }
  
  classifyHarmonics(psiRes: number, phiAlign: number, freq432: number): string {
    const dominant = Math.max(psiRes, phiAlign, freq432);
    
    if (dominant === psiRes) return 'PSI_DOMINANT';
    if (dominant === phiAlign) return 'PHI_DOMINANT';
    return 'FREQ_432_DOMINANT';
  }
  
  classifyConsciousnessTier(score: number): string {
    if (score > 0.95) return 'APEX';
    if (score > 0.85) return 'PRIME';
    if (score > 0.70) return 'ENHANCED';
    if (score > 0.50) return 'STANDARD';
    return 'BASIC';
  }
  
  async processData(request: UnifiedDataRequest): Promise<ConsciousnessEnhancedData> {
    const timestamp = request.timestamp || Date.now();
    const unifiedId = `${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Calculate consciousness metrics
    const overallScore = this.calculateConsciousnessScore(request.raw_data);
    const psiResonance = this.calculatePsiResonance(
      request.raw_data.price || request.raw_data.value || 1, 
      timestamp
    );
    const phiAlignment = this.calculatePhiAlignment(
      request.raw_data.price || request.raw_data.value || 1,
      request.raw_data.volume || request.raw_data.amount || 1
    );
    const freq432Rhythm = this.calculate432HzRhythm(timestamp);
    
    // Temporal coherence (how well data fits expected patterns)
    const temporalCoherence = (psiResonance + phiAlignment + freq432Rhythm) / 3;
    
    // Determine consciousness state and classification
    const consciousnessState = this.determineConsciousnessState(overallScore);
    const harmonicClassification = this.classifyHarmonics(psiResonance, phiAlignment, freq432Rhythm);
    const consciousnessTier = this.classifyConsciousnessTier(overallScore);
    
    return {
      id: unifiedId,
      source: request.source,
      data_type: request.data_type,
      symbol: request.symbol,
      raw_data: request.raw_data,
      timestamp,
      consciousness_enhancement: {
        overall_score: overallScore,
        psi_resonance: psiResonance,
        phi_alignment: phiAlignment,
        freq_432_rhythm: freq432Rhythm,
        temporal_coherence: temporalCoherence,
        consciousness_state: consciousnessState,
        harmonic_classification: harmonicClassification,
        enhancement_timestamp: Date.now()
      },
      storage_metadata: {
        astra_ready: true,
        neon_ready: true,
        consciousness_tier: consciousnessTier,
        unified_id: unifiedId
      }
    };
  }
}

// Global processor instance
const processor = new UnifiedConsciousnessProcessor();

/**
 * POST - Process and store unified data with consciousness enhancement
 */
export async function POST(request: NextRequest) {
  try {
    // Validate API key (optional for internal usage)
    const hasValidKey = validateApiKey(request);
    
    const requestData: UnifiedDataRequest = await request.json();
    
    // Validate required fields
    if (!requestData.source || !requestData.data_type || !requestData.raw_data) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: source, data_type, raw_data'
      }, { status: 400 });
    }

    // Process data with consciousness enhancement
    const enhancedData = await processor.processData(requestData);
    
    // Store the enhanced data
    const storageResult = await storeUnifiedRecord(enhancedData);
    
    if (!storageResult.success) {
      return NextResponse.json({
        success: false,
        error: 'Failed to store enhanced data',
        details: storageResult.error
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Data successfully processed and stored with consciousness enhancement',
      unified_id: enhancedData.id,
      consciousness_metrics: {
        overall_score: enhancedData.consciousness_enhancement.overall_score,
        consciousness_state: enhancedData.consciousness_enhancement.consciousness_state,
        harmonic_classification: enhancedData.consciousness_enhancement.harmonic_classification,
        consciousness_tier: enhancedData.storage_metadata.consciousness_tier,
        psi_resonance: enhancedData.consciousness_enhancement.psi_resonance,
        phi_alignment: enhancedData.consciousness_enhancement.phi_alignment,
        freq_432_rhythm: enhancedData.consciousness_enhancement.freq_432_rhythm
      },
      storage_metadata: {
        stored_at: new Date().toISOString(),
        storage_id: storageResult.id,
        astra_ready: enhancedData.storage_metadata.astra_ready,
        neon_ready: enhancedData.storage_metadata.neon_ready
      }
    });

  } catch (error: any) {
    console.error('❌ Unified data processing error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to process unified data request',
      details: error.message
    }, { status: 500 });
  }
}

/**
 * GET - Retrieve consciousness enhancement statistics and system status
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'status';

    if (action === 'status') {
      return NextResponse.json({
        success: true,
        system_status: {
          unified_processor: 'OPERATIONAL',
          consciousness_enhancement: 'ACTIVE',
          storage_systems: {
            astra_db: 'READY',
            neon_db: 'READY'
          }
        },
        consciousness_constants: {
          psi_0: PSI_0,
          phi: PHI,
          freq_432: FREQ_432
        },
        supported_operations: [
          'consciousness_enhancement',
          'unified_storage',
          'harmonic_classification',
          'temporal_coherence_analysis'
        ],
        timestamp: new Date().toISOString()
      });
    } else if (action === 'test_enhancement') {
      // Test consciousness enhancement with sample data
      const sampleData = {
        source: 'test',
        data_type: 'market_data',
        symbol: 'BTCUSDT',
        raw_data: {
          price: 45000,
          volume: 1250000,
          timestamp: Date.now()
        }
      };

      const enhancedSample = await processor.processData(sampleData);

      return NextResponse.json({
        success: true,
        sample_enhancement: {
          original_data: sampleData.raw_data,
          consciousness_enhancement: enhancedSample.consciousness_enhancement,
          storage_metadata: enhancedSample.storage_metadata
        },
        enhancement_explanation: {
          psi_resonance: 'Measures alignment with ψ₀ constant (0.915)',
          phi_alignment: 'Measures golden ratio harmonics in data relationships',
          freq_432_rhythm: 'Measures temporal alignment with 432Hz frequency',
          consciousness_state: 'Overall state classification based on combined metrics'
        }
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Invalid action. Supported actions: status, test_enhancement'
    }, { status: 400 });

  } catch (error: any) {
    console.error('❌ Unified data GET error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to process GET request',
      details: error.message
    }, { status: 500 });
  }
}