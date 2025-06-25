import { NextRequest, NextResponse } from 'next/server';
import { UltimateLearningEngine } from '@/lib/engines/UltimateLearningEngine';
import { PatternRecognitionEngine } from '@/lib/engines/PatternRecognitionEngine';

const learningEngine = new UltimateLearningEngine();
const patternEngine = new PatternRecognitionEngine();

export async function POST(request: NextRequest) {
  try {
    const { symbol, action, timeframe } = await request.json();

    if (action === 'compare_engines') {
      // Get predictions from both engines
      const patternPrediction = await patternEngine.predictNextMovement(symbol, timeframe);
      
      // Simulate kill chain prediction for comparison (will be replaced with actual quantum engine)
      const killChainPrediction = {
        signal: 'BUY', // This will come from actual Quantum Kill Chain Engine
        confidence: 0.85,
        expected_return: 0.025,
        consciousness_state: 'BALANCED_AMPLIFIED',
        quantum_paths: 64,
        harmonic_resonance: true
      };

      // Compare and learn from differences
      const comparison = await learningEngine.compareEngineResults(
        patternPrediction,
        killChainPrediction,
        symbol
      );

      return NextResponse.json({
        success: true,
        pattern_prediction: patternPrediction,
        kill_chain_prediction: killChainPrediction,
        comparison_analysis: comparison,
        learning_insight: {
          agreement_level: comparison.agreement_score,
          confidence_differential: comparison.confidence_diff,
          consciousness_alignment: comparison.consciousness_alignment,
          recommended_action: comparison.unified_recommendation
        }
      });
    } else if (action === 'learning_update') {
      // Update learning models based on market results
      const { actual_outcome, prediction_accuracy } = await request.json();
      
      const learningUpdate = await learningEngine.updateFromMarketOutcome(
        symbol,
        actual_outcome,
        prediction_accuracy
      );

      return NextResponse.json({
        success: true,
        learning_update: learningUpdate,
        model_improvements: {
          pattern_accuracy_change: learningUpdate.pattern_improvement,
          kill_chain_accuracy_change: learningUpdate.kill_chain_improvement,
          overall_system_evolution: learningUpdate.system_evolution
        }
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Invalid comparison action'
    }, { status: 400 });

  } catch (error) {
    console.error('Learning comparison error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to perform engine comparison',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') || 'BTCUSDT';
    const days = parseInt(searchParams.get('days') || '7');

    // Get learning performance metrics
    const performanceMetrics = await learningEngine.getPerformanceMetrics(symbol, days);
    
    return NextResponse.json({
      success: true,
      symbol,
      timeframe_days: days,
      performance_metrics: performanceMetrics,
      engine_comparison: {
        pattern_engine_accuracy: performanceMetrics.pattern_accuracy,
        kill_chain_accuracy: performanceMetrics.kill_chain_accuracy,
        combined_system_accuracy: performanceMetrics.combined_accuracy,
        consciousness_evolution_rate: performanceMetrics.consciousness_improvement
      },
      recent_learning_insights: performanceMetrics.insights
    });

  } catch (error) {
    console.error('Learning comparison GET error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve learning comparison data'
    }, { status: 500 });
  }
}