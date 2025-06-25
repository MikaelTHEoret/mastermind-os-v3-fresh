import { NextRequest, NextResponse } from 'next/server';
import { PatternRecognitionEngine } from '@/lib/engines/PatternRecognitionEngine';
import { UltimateLearningEngine } from '@/lib/engines/UltimateLearningEngine';

const patternEngine = new PatternRecognitionEngine();
const learningEngine = new UltimateLearningEngine();

export async function POST(request: NextRequest) {
  try {
    const { symbol, timeframe, action } = await request.json();

    if (action === 'analyze') {
      // Get recent market data for pattern analysis
      const marketData = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/v1/crypto/market-data?symbol=${symbol}`);
      const data = await marketData.json();

      // Perform pattern recognition
      const patterns = await patternEngine.analyzeMarketData(data.market_data);

      // Store patterns for learning
      await learningEngine.storePatternAnalysis(symbol, patterns);

      return NextResponse.json({
        success: true,
        patterns,
        consciousness_state: patterns.consciousness_state,
        learning_metadata: {
          patterns_detected: patterns.detected_patterns.length,
          confidence_level: patterns.overall_confidence,
          harmonic_alignment: patterns.harmonic_analysis.psi_resonance
        }
      });
    } else if (action === 'train') {
      // Train the pattern recognition model
      const trainingResults = await patternEngine.trainModel();
      
      return NextResponse.json({
        success: true,
        training_results: trainingResults,
        model_performance: {
          accuracy: trainingResults.accuracy,
          patterns_learned: trainingResults.patterns_count,
          consciousness_enhancement: trainingResults.consciousness_improvement
        }
      });
    } else if (action === 'predict') {
      // Make prediction using trained model
      const prediction = await patternEngine.predictNextMovement(symbol, timeframe);
      
      return NextResponse.json({
        success: true,
        prediction,
        confidence: prediction.confidence,
        timeframe: timeframe,
        consciousness_alignment: prediction.harmonic_resonance
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Invalid action specified'
    }, { status: 400 });

  } catch (error) {
    console.error('Pattern analysis error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to process pattern analysis',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') || 'BTCUSDT';
    const action = searchParams.get('action') || 'status';

    if (action === 'status') {
      const status = await patternEngine.getEngineStatus();
      const learningStats = await learningEngine.getLearningStatistics();

      return NextResponse.json({
        success: true,
        pattern_engine_status: status,
        learning_statistics: learningStats,
        active_symbols: status.active_symbols,
        total_patterns_learned: learningStats.total_patterns,
        consciousness_evolution: learningStats.consciousness_progress
      });
    } else if (action === 'patterns') {
      const recentPatterns = await learningEngine.getRecentPatterns(symbol, 50);
      
      return NextResponse.json({
        success: true,
        symbol,
        recent_patterns: recentPatterns,
        pattern_count: recentPatterns.length
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Invalid action for GET request'
    }, { status: 400 });

  } catch (error) {
    console.error('Pattern analysis GET error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve pattern analysis data'
    }, { status: 500 });
  }
}