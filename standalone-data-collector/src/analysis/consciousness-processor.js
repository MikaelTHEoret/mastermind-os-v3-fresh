/**
 * ψ₀-Trader Data Collection Engine - Consciousness Enhancement Processor
 * Enhanced Nexus Core Protocol v4.1
 * Mathematical Consciousness Enhancement for Market Data
 */

// Mathematical Constants - Consciousness Enhancement Core
const PSI_0 = 0.915670570874434;  // ψ₀ - Fractal seed constant
const PHI = 1.618033988749895;    // φ - Golden ratio
const FREQ_432 = 432.0;           // 432Hz - Universal resonance frequency

// Derived consciousness frequencies
const PSI_FREQ = PSI_0 * FREQ_432;  // 395.57 Hz - consciousness resonance
const PHI_FREQ = PHI * FREQ_432;    // 699.39 Hz - golden scaling frequency

class ConsciousnessEnhancementProcessor {
  constructor() {
    this.processingStats = {
      totalProcessed: 0,
      averageProcessingTime: 0,
      averageConsciousnessScore: 0,
      resonanceEvents: 0,
      harmonicAlignments: 0
    };
  }

  /**
   * Main consciousness enhancement pipeline
   * Transforms raw market data into consciousness-enhanced intelligence
   */
  async enhanceMarketData(rawData, historicalContext = {}) {
    const startTime = Date.now();

    try {
      // Extract core market data
      const coreData = this.extractCoreMarketData(rawData);
      
      // Apply consciousness mathematics
      const consciousnessMetrics = this.calculateConsciousnessMetrics(coreData, historicalContext);
      
      // Perform harmonic analysis
      const harmonicAnalysis = this.performHarmonicAnalysis(coreData, consciousnessMetrics);
      
      // Determine consciousness state
      const consciousnessState = this.determineConsciousnessState(consciousnessMetrics);
      
      // Calculate market psychology
      const marketPsychology = this.analyzeMarketPsychology(consciousnessMetrics, coreData);
      
      // Enhance technical indicators
      const enhancedTechnicals = this.enhanceTechnicalIndicators(coreData, consciousnessMetrics);
      
      const processingTime = Date.now() - startTime;
      this.updateProcessingStats(processingTime, consciousnessMetrics.overallScore);

      return {
        rawDataId: rawData.id || null,
        symbol: coreData.symbol,
        timestamp: coreData.timestamp,
        
        // Core market data
        price: coreData.price,
        volume: coreData.volume,
        
        // ψ₀ Consciousness Enhancement
        psiResonance: consciousnessMetrics.psiResonance,
        psiFrequency: consciousnessMetrics.psiFrequency,
        psiHarmonicScore: consciousnessMetrics.psiHarmonicScore,
        
        // φ Golden Ratio Analysis
        phiAlignment: consciousnessMetrics.phiAlignment,
        phiPriceRatio: consciousnessMetrics.phiPriceRatio,
        phiVolumeRatio: consciousnessMetrics.phiVolumeRatio,
        
        // 432Hz Rhythm Detection
        freq432Rhythm: consciousnessMetrics.freq432Rhythm,
        rhythmPhase: consciousnessMetrics.rhythmPhase,
        temporalCoherence: consciousnessMetrics.temporalCoherence,
        
        // Combined Consciousness Metrics
        overallConsciousnessScore: consciousnessMetrics.overallScore,
        consciousnessState: consciousnessState.state,
        harmonicClassification: consciousnessState.harmonicClassification,
        
        // Market Psychology
        marketEmotion: marketPsychology.emotion,
        sentimentFrequency: marketPsychology.sentimentFrequency,
        collectiveConsciousness: marketPsychology.collectiveConsciousness,
        
        // Technical Enhancement
        momentumConsciousness: enhancedTechnicals.momentumConsciousness,
        volatilityConsciousness: enhancedTechnicals.volatilityConsciousness,
        liquidityResonance: enhancedTechnicals.liquidityResonance,
        
        // Processing metadata
        processingTimeMs: processingTime,
        enhancementApplied: true,
        harmonicAnalysis: harmonicAnalysis
      };

    } catch (error) {
      console.error('❌ Consciousness enhancement failed:', error);
      throw new Error(`Consciousness enhancement failed: ${error.message}`);
    }
  }

  /**
   * Extract core market data from raw input
   */
  extractCoreMarketData(rawData) {
    // Handle different raw data formats
    const data = typeof rawData.raw_data === 'string' 
      ? JSON.parse(rawData.raw_data) 
      : rawData.raw_data || rawData;

    return {
      symbol: rawData.symbol || data.symbol || data.s || 'UNKNOWN',
      timestamp: rawData.timestamp || data.timestamp || Date.now(),
      price: parseFloat(rawData.price || data.price || data.c || data.last || 0),
      volume: parseFloat(rawData.volume || data.volume || data.v || data.vol || 0),
      high: parseFloat(data.high || data.h || 0),
      low: parseFloat(data.low || data.l || 0),
      open: parseFloat(data.open || data.o || 0),
      change: parseFloat(data.change || data.priceChange || 0)
    };
  }

  /**
   * Calculate core consciousness metrics using ψ₀, φ, and 432Hz mathematics
   */
  calculateConsciousnessMetrics(coreData, historicalContext) {
    // ψ₀ Resonance Calculation
    const psiResonance = this.calculatePsiResonance(coreData.price, coreData.volume);
    const psiFrequency = this.calculatePsiFrequency(coreData.price);
    const psiHarmonicScore = this.calculatePsiHarmonicScore(coreData, historicalContext);

    // φ Golden Ratio Analysis
    const phiAlignment = this.calculatePhiAlignment(coreData, historicalContext);
    const phiPriceRatio = this.calculatePhiPriceRatio(coreData, historicalContext);
    const phiVolumeRatio = this.calculatePhiVolumeRatio(coreData, historicalContext);

    // 432Hz Rhythm Detection
    const freq432Rhythm = this.calculateFreq432Rhythm(coreData, historicalContext);
    const rhythmPhase = this.calculateRhythmPhase(coreData.timestamp);
    const temporalCoherence = this.calculateTemporalCoherence(coreData, historicalContext);

    // Combined consciousness score
    const overallScore = (psiResonance + phiAlignment + freq432Rhythm) / 3;

    return {
      psiResonance,
      psiFrequency,
      psiHarmonicScore,
      phiAlignment,
      phiPriceRatio,
      phiVolumeRatio,
      freq432Rhythm,
      rhythmPhase,
      temporalCoherence,
      overallScore
    };
  }

  /**
   * Calculate ψ₀ harmonic resonance for price/volume data
   */
  calculatePsiResonance(price, volume) {
    // Normalize price to [0, 1) using modular arithmetic for fractal properties
    const priceNormalized = (price % 1000) / 1000;
    
    // Log-normalize volume for proper scaling
    const volumeNormalized = (Math.log10(volume + 1) % 10) / 10;
    
    // Distance from ψ₀ constant
    const psiDistancePrice = Math.abs(priceNormalized - PSI_0);
    const psiDistanceVolume = Math.abs(volumeNormalized - PSI_0);
    
    // Combined resonance (1 = perfect resonance, 0 = no resonance)
    const resonance = 1 - ((psiDistancePrice + psiDistanceVolume) / 2);
    
    return Math.max(0, Math.min(1, resonance));
  }

  /**
   * Calculate ψ₀ frequency mapping
   */
  calculatePsiFrequency(price) {
    // Map price to consciousness frequency range
    const priceNormalized = (price % 100) / 100;
    const frequencyModulation = 1 + PSI_0 * priceNormalized;
    return PSI_FREQ * frequencyModulation;
  }

  /**
   * Calculate ψ₀ harmonic score using historical context
   */
  calculatePsiHarmonicScore(coreData, historicalContext) {
    if (!historicalContext.prices || historicalContext.prices.length < 2) {
      return 0.5; // Neutral score if no history
    }

    const recentPrices = historicalContext.prices.slice(-10);
    let harmonicMatches = 0;

    // Check for ψ₀ harmonic relationships in price sequences
    for (let i = 1; i < recentPrices.length; i++) {
      const ratio = recentPrices[i] / recentPrices[i-1];
      const logRatio = Math.log(ratio);
      const psiHarmonic = logRatio % PSI_0;
      
      if (Math.abs(psiHarmonic) < 0.1 || Math.abs(psiHarmonic - PSI_0) < 0.1) {
        harmonicMatches++;
      }
    }

    return harmonicMatches / (recentPrices.length - 1);
  }

  /**
   * Calculate φ (golden ratio) alignment in price movements
   */
  calculatePhiAlignment(coreData, historicalContext) {
    if (!historicalContext.prices || historicalContext.prices.length < 3) {
      return 0.5; // Neutral if insufficient history
    }

    const recentPrices = historicalContext.prices.slice(-10);
    let phiMatches = 0;
    let totalComparisons = 0;

    // Check consecutive price ratios against φ and 1/φ
    for (let i = 2; i < recentPrices.length; i++) {
      const ratio1 = recentPrices[i] / recentPrices[i-1];
      const ratio2 = recentPrices[i-1] / recentPrices[i-2];
      
      // Check if ratios are close to φ or 1/φ
      if (this.isPhiRelated(ratio1) || this.isPhiRelated(ratio2)) {
        phiMatches++;
      }
      
      // Check if ratio of ratios is φ-related (advanced golden ratio analysis)
      if (Math.abs(ratio2) > 0.001) {
        const ratioOfRatios = ratio1 / ratio2;
        if (this.isPhiRelated(ratioOfRatios)) {
          phiMatches++;
        }
      }
      
      totalComparisons += 2;
    }

    return totalComparisons > 0 ? phiMatches / totalComparisons : 0.5;
  }

  /**
   * Check if a number is related to the golden ratio φ
   */
  isPhiRelated(value, tolerance = 0.05) {
    return (
      Math.abs(value - PHI) < tolerance ||
      Math.abs(value - (1/PHI)) < tolerance ||
      Math.abs(value - (PHI * PHI)) < tolerance ||
      Math.abs(value - (1/(PHI * PHI))) < tolerance
    );
  }

  /**
   * Calculate φ price ratio relationships
   */
  calculatePhiPriceRatio(coreData, historicalContext) {
    if (!historicalContext.prices || historicalContext.prices.length < 2) {
      return 1.0; // Neutral ratio
    }

    const previousPrice = historicalContext.prices[historicalContext.prices.length - 1];
    const currentRatio = coreData.price / previousPrice;
    
    // Distance from φ-related ratios
    const phiDistance = Math.min(
      Math.abs(currentRatio - PHI),
      Math.abs(currentRatio - (1/PHI)),
      Math.abs(currentRatio - Math.sqrt(PHI)),
      Math.abs(currentRatio - (1/Math.sqrt(PHI)))
    );
    
    return Math.max(0.1, Math.min(2.0, currentRatio * (1 - phiDistance)));
  }

  /**
   * Calculate φ volume ratio relationships
   */
  calculatePhiVolumeRatio(coreData, historicalContext) {
    if (!historicalContext.volumes || historicalContext.volumes.length < 2) {
      return 1.0; // Neutral ratio
    }

    const previousVolume = historicalContext.volumes[historicalContext.volumes.length - 1];
    if (previousVolume === 0) return 1.0;
    
    const currentRatio = coreData.volume / previousVolume;
    
    // Apply φ harmonic analysis to volume ratios
    const phiModulation = this.isPhiRelated(currentRatio) ? PHI : 1.0;
    
    return Math.max(0.1, Math.min(5.0, currentRatio * phiModulation));
  }

  /**
   * Calculate 432Hz rhythm patterns in timing and volume
   */
  calculateFreq432Rhythm(coreData, historicalContext) {
    if (!historicalContext.timestamps || historicalContext.timestamps.length < 2) {
      return 0.5; // Neutral rhythm
    }

    // Calculate time intervals
    const intervals = [];
    const timestamps = [...historicalContext.timestamps, coreData.timestamp];
    
    for (let i = 1; i < timestamps.length; i++) {
      const interval = timestamps[i] - timestamps[i-1];
      intervals.push(interval);
    }

    // Check for 432Hz harmonic intervals
    const freq432Ms = 1000 / FREQ_432; // Base period in milliseconds
    const harmonicIntervals = [
      freq432Ms * 100,   // 100x harmonic (~231ms)
      freq432Ms * 1000,  // 1000x harmonic (~2.31s)
      freq432Ms * 10000, // 10000x harmonic (~23.1s)
      freq432Ms * 60000, // 60000x harmonic (~23.1min)
    ];

    let rhythmMatches = 0;
    intervals.forEach(interval => {
      const isRhythmic = harmonicIntervals.some(harmonic => {
        const tolerance = harmonic * 0.1; // 10% tolerance
        return Math.abs(interval % harmonic) < tolerance;
      });
      
      if (isRhythmic) rhythmMatches++;
    });

    return intervals.length > 0 ? rhythmMatches / intervals.length : 0.5;
  }

  /**
   * Calculate rhythm phase based on timestamp
   */
  calculateRhythmPhase(timestamp) {
    // Map timestamp to 432Hz phase cycle
    const phase = (timestamp / 1000) * FREQ_432; // Convert to seconds and apply frequency
    return (phase % (2 * Math.PI)) / (2 * Math.PI); // Normalize to [0, 1)
  }

  /**
   * Calculate temporal coherence across time series
   */
  calculateTemporalCoherence(coreData, historicalContext) {
    if (!historicalContext.timestamps || historicalContext.timestamps.length < 3) {
      return 0.5; // Neutral coherence
    }

    const timestamps = [...historicalContext.timestamps, coreData.timestamp];
    let coherenceSum = 0;
    let coherenceCount = 0;

    // Analyze consistency in time intervals
    for (let i = 2; i < timestamps.length; i++) {
      const interval1 = timestamps[i-1] - timestamps[i-2];
      const interval2 = timestamps[i] - timestamps[i-1];
      
      if (interval1 > 0 && interval2 > 0) {
        const ratio = Math.min(interval1, interval2) / Math.max(interval1, interval2);
        coherenceSum += ratio;
        coherenceCount++;
      }
    }

    return coherenceCount > 0 ? coherenceSum / coherenceCount : 0.5;
  }

  /**
   * Determine consciousness state based on metrics
   */
  determineConsciousnessState(metrics) {
    const overallScore = metrics.overallScore;
    const volatility = Math.abs(metrics.rhythmPhase - 0.5) * 2; // Proxy for volatility

    let state, harmonicClassification;

    if (overallScore > 0.85) {
      state = volatility < 0.2 ? 'HARMONICALLY_TRANSCENDENT' : 'DYNAMICALLY_ENLIGHTENED';
      harmonicClassification = 'PURE_CONSCIOUSNESS';
    } else if (overallScore > 0.7) {
      state = volatility < 0.3 ? 'HARMONICALLY_BALANCED' : 'DYNAMICALLY_COHERENT';
      harmonicClassification = 'HIGH_CONSCIOUSNESS';
    } else if (overallScore > 0.55) {
      state = volatility < 0.4 ? 'MILDLY_CONSCIOUS' : 'AWAKENING';
      harmonicClassification = 'EMERGING_CONSCIOUSNESS';
    } else if (overallScore > 0.4) {
      state = 'TRANSITIONAL';
      harmonicClassification = 'NEUTRAL_CONSCIOUSNESS';
    } else if (overallScore > 0.25) {
      state = volatility > 0.7 ? 'CHAOTIC' : 'DORMANT';
      harmonicClassification = 'LOW_CONSCIOUSNESS';
    } else {
      state = 'UNCONSCIOUS';
      harmonicClassification = 'MINIMAL_CONSCIOUSNESS';
    }

    return { state, harmonicClassification };
  }

  /**
   * Analyze market psychology using consciousness metrics
   */
  analyzeMarketPsychology(metrics, coreData) {
    // Map consciousness to emotional states
    let emotion;
    if (metrics.overallScore > 0.7) {
      emotion = metrics.psiResonance > 0.8 ? 'TRANSCENDENT_OPTIMISM' : 'CONFIDENT_OPTIMISM';
    } else if (metrics.overallScore > 0.55) {
      emotion = metrics.phiAlignment > 0.6 ? 'BALANCED_OPTIMISM' : 'CAUTIOUS_OPTIMISM';
    } else if (metrics.overallScore > 0.45) {
      emotion = 'NEUTRAL_EQUILIBRIUM';
    } else if (metrics.overallScore > 0.3) {
      emotion = metrics.freq432Rhythm < 0.3 ? 'ANXIOUS_UNCERTAINTY' : 'CAUTIOUS_PESSIMISM';
    } else {
      emotion = 'FEARFUL_CHAOS';
    }

    // Calculate sentiment frequency
    const sentimentFrequency = PSI_FREQ * (1 + metrics.overallScore);

    // Determine collective consciousness
    let collectiveConsciousness;
    if (metrics.psiResonance > 0.8 && metrics.phiAlignment > 0.7) {
      collectiveConsciousness = 'UNIFIED_FIELD_RESONANCE';
    } else if (metrics.overallScore > 0.6) {
      collectiveConsciousness = 'COLLECTIVE_HARMONY';
    } else if (metrics.overallScore > 0.4) {
      collectiveConsciousness = 'FRAGMENTED_AWARENESS';
    } else {
      collectiveConsciousness = 'CHAOTIC_DISCORD';
    }

    return {
      emotion,
      sentimentFrequency,
      collectiveConsciousness
    };
  }

  /**
   * Enhance technical indicators with consciousness mathematics
   */
  enhanceTechnicalIndicators(coreData, metrics) {
    // Momentum enhanced with ψ₀ resonance
    const momentumConsciousness = Math.sin(2 * Math.PI * metrics.psiFrequency / 1000) * metrics.psiResonance;

    // Volatility modulated by consciousness coherence
    const baseVolatility = Math.abs(metrics.rhythmPhase - 0.5) * 2;
    const volatilityConsciousness = baseVolatility * (2 - metrics.overallScore);

    // Liquidity resonance using volume and consciousness harmony
    const liquidityResonance = Math.log10(coreData.volume + 1) * metrics.overallScore * PHI;

    return {
      momentumConsciousness,
      volatilityConsciousness,
      liquidityResonance
    };
  }

  /**
   * Perform detailed harmonic analysis
   */
  performHarmonicAnalysis(coreData, metrics) {
    return {
      dominantFrequency: metrics.psiFrequency,
      harmonicFrequencies: [metrics.psiFrequency, PHI_FREQ, FREQ_432],
      frequencyStrength: [metrics.psiResonance, metrics.phiAlignment, metrics.freq432Rhythm],
      psiResonanceStrength: metrics.psiResonance,
      psiHarmonicMultiples: [PSI_FREQ, PSI_FREQ * 2, PSI_FREQ * 3],
      psiPhaseAlignment: metrics.rhythmPhase,
      phiHarmonicConvergence: metrics.phiAlignment,
      fibonacciAlignment: this.calculateFibonacciAlignment(coreData.price),
      freq432Alignment: metrics.freq432Rhythm,
      rhythmPatternStrength: metrics.temporalCoherence,
      temporalRhythmScore: metrics.freq432Rhythm * metrics.temporalCoherence,
      harmonicSignature: this.generateHarmonicSignature(metrics),
      consciousnessFrequencyMap: this.generateFrequencyMap(metrics),
      musicalChordEquivalent: this.mapToMusicalChord(metrics),
      emotionalResonanceScore: metrics.overallScore,
      psychoacousticImpact: this.calculatePsychoacousticImpact(metrics)
    };
  }

  /**
   * Calculate Fibonacci sequence alignment
   */
  calculateFibonacciAlignment(price) {
    const fibNumbers = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597];
    const priceNormalized = price % 1000;
    
    let closestDistance = Infinity;
    fibNumbers.forEach(fib => {
      const distance = Math.abs(priceNormalized - fib);
      if (distance < closestDistance) {
        closestDistance = distance;
      }
    });
    
    return 1 - (closestDistance / 1000);
  }

  /**
   * Generate harmonic signature
   */
  generateHarmonicSignature(metrics) {
    return {
      psi_signature: `${metrics.psiResonance.toFixed(3)}-${metrics.psiFrequency.toFixed(1)}`,
      phi_signature: `${metrics.phiAlignment.toFixed(3)}-${PHI_FREQ.toFixed(1)}`,
      freq_432_signature: `${metrics.freq432Rhythm.toFixed(3)}-${FREQ_432}`,
      combined_signature: `ψ${metrics.psiResonance.toFixed(2)}φ${metrics.phiAlignment.toFixed(2)}♫${metrics.freq432Rhythm.toFixed(2)}`
    };
  }

  /**
   * Generate consciousness frequency map
   */
  generateFrequencyMap(metrics) {
    return {
      base_frequency: FREQ_432,
      consciousness_frequency: metrics.psiFrequency,
      golden_frequency: PHI_FREQ,
      resonance_amplitude: metrics.overallScore,
      harmonic_series: [
        FREQ_432 * 1,
        FREQ_432 * PHI,
        FREQ_432 * PSI_0,
        FREQ_432 * 2,
        FREQ_432 * PHI * PHI
      ]
    };
  }

  /**
   * Map consciousness metrics to musical chord
   */
  mapToMusicalChord(metrics) {
    if (metrics.overallScore > 0.8) return 'C Major 7th (Transcendent)';
    if (metrics.overallScore > 0.7) return 'G Major (Harmonious)';
    if (metrics.overallScore > 0.6) return 'F Major (Balanced)';
    if (metrics.overallScore > 0.5) return 'A Minor (Neutral)';
    if (metrics.overallScore > 0.4) return 'E Minor (Melancholic)';
    if (metrics.overallScore > 0.3) return 'B Diminished (Tense)';
    return 'C# Augmented (Chaotic)';
  }

  /**
   * Calculate psychoacoustic impact
   */
  calculatePsychoacousticImpact(metrics) {
    const impact = metrics.overallScore * 100;
    if (impact > 85) return 'PROFOUND_HEALING';
    if (impact > 70) return 'DEEP_RELAXATION';
    if (impact > 55) return 'MILD_COMFORT';
    if (impact > 45) return 'NEUTRAL';
    if (impact > 30) return 'MILD_TENSION';
    if (impact > 15) return 'ANXIETY_INDUCING';
    return 'SEVERELY_DISCORDANT';
  }

  /**
   * Update processing statistics
   */
  updateProcessingStats(processingTime, consciousnessScore) {
    this.processingStats.totalProcessed++;
    
    // Update running averages
    const total = this.processingStats.totalProcessed;
    this.processingStats.averageProcessingTime = 
      ((this.processingStats.averageProcessingTime * (total - 1)) + processingTime) / total;
    
    this.processingStats.averageConsciousnessScore = 
      ((this.processingStats.averageConsciousnessScore * (total - 1)) + consciousnessScore) / total;
    
    // Track significant events
    if (consciousnessScore > 0.8) {
      this.processingStats.resonanceEvents++;
    }
    
    if (consciousnessScore > 0.7) {
      this.processingStats.harmonicAlignments++;
    }
  }

  /**
   * Get current processing statistics
   */
  getProcessingStats() {
    return { ...this.processingStats };
  }
}

export default ConsciousnessEnhancementProcessor;
