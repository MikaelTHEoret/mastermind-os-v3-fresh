import { NextRequest, NextResponse } from 'next/server';
import { HighVelocitySnipeEngine } from '@/lib/engines/HighVelocitySnipeEngine';
import { CauseEffectAnalysisEngine } from '@/lib/engines/CauseEffectAnalysisEngine';

// Global instances
let snipeEngine: HighVelocitySnipeEngine | null = null;
let causeEffectEngine: CauseEffectAnalysisEngine | null = null;

export async function POST(request: NextRequest) {
  try {
    const { action, symbol, timeframe } = await request.json();

    // Initialize engines if needed
    if (!snipeEngine) {
      snipeEngine = new HighVelocitySnipeEngine();
      await snipeEngine.initializeSnipeEngine();
    }

    if (!causeEffectEngine) {
      causeEffectEngine = new CauseEffectAnalysisEngine();
    }

    if (action === 'start_hunting') {
      // Start hunting for snipe opportunities
      console.log('🎯 Starting high-velocity snipe hunting...');
      
      return NextResponse.json({
        success: true,
        message: 'High-velocity snipe hunting initiated',
        status: 'HUNTING_ACTIVE',
        target_symbols: await snipeEngine.getVolatilityRankings(),
        timestamp: new Date().toISOString()
      });

    } else if (action === 'get_active_snipes') {
      const activeSnipes = await snipeEngine.getActiveSnipes();
      
      return NextResponse.json({
        success: true,
        active_snipes: activeSnipes,
        count: activeSnipes.length,
        timestamp: new Date().toISOString()
      });

    } else if (action === 'analyze_symbol') {
      if (!symbol) {
        return NextResponse.json({
          success: false,
          error: 'Symbol required for analysis'
        }, { status: 400 });
      }

      // Get current market data
      const marketResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/v1/crypto/market-data?symbol=${symbol}`);
      const marketData = await marketResponse.json();

      if (!marketData.success) {
        return NextResponse.json({
          success: false,
          error: 'Failed to get market data for symbol'
        }, { status: 500 });
      }

      // Analyze for snipe opportunities
      const volatilityRankings = await snipeEngine.getVolatilityRankings();
      const causeEffectStats = await snipeEngine.getCauseEffectStats(symbol);
      const indicatorEffectiveness = await causeEffectEngine.getIndicatorEffectiveness(symbol);

      // Fix: Add proper null checking for Map.get() operation
      const volatilityScore = volatilityRankings.get(symbol) ?? 0;

      return NextResponse.json({
        success: true,
        symbol,
        analysis: {
          current_price: marketData.market_data.price,
          volatility_score: volatilityScore,
          cause_effect_stats: causeEffectStats,
          indicator_effectiveness: Object.fromEntries(indicatorEffectiveness),
          snipe_potential: volatilityScore > 0.05 ? 'HIGH' : 'LOW'
        },
        timestamp: new Date().toISOString()
      });

    } else if (action === 'get_cause_effect_insights') {
      if (!symbol) {
        return NextResponse.json({
          success: false,
          error: 'Symbol required for cause-effect analysis'
        }, { status: 400 });
      }

      const correlationMatrix = await causeEffectEngine.getCorrelationMatrix();
      const causeEffectData = await causeEffectEngine.exportCauseEffectData(symbol);

      return NextResponse.json({
        success: true,
        symbol,
        cause_effect_analysis: {
          correlation_matrix: Object.fromEntries(correlationMatrix),
          indicator_effects: causeEffectData.indicator_effects,
          effect_timings: causeEffectData.effect_timings
        },
        timestamp: new Date().toISOString()
      });

    }

    return NextResponse.json({
      success: false,
      error: 'Invalid action specified'
    }, { status: 400 });

  } catch (error) {
    console.error('High-velocity snipe API error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to process snipe request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const action = searchParams.get('action') || 'status';

    if (!snipeEngine) {
      return NextResponse.json({
        success: true,
        status: 'NOT_INITIALIZED',
        message: 'Snipe engine not initialized'
      });
    }

    if (action === 'status') {
      const volatilityRankings = await snipeEngine.getVolatilityRankings();
      const activeSnipes = await snipeEngine.getActiveSnipes();
      
      // Get top 10 most volatile coins
      const topVolatile = Array.from(volatilityRankings.entries())
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10);

      return NextResponse.json({
        success: true,
        status: 'OPERATIONAL',
        engine_stats: {
          total_symbols_monitored: volatilityRankings.size,
          active_snipe_opportunities: activeSnipes.length,
          top_volatile_coins: topVolatile,
          current_focus: topVolatile.slice(0, 5).map(([symbol]) => symbol)
        },
        timestamp: new Date().toISOString()
      });

    } else if (action === 'volatility_rankings') {
      const rankings = await snipeEngine.getVolatilityRankings();
      
      return NextResponse.json({
        success: true,
        volatility_rankings: Object.fromEntries(rankings),
        ranked_list: Array.from(rankings.entries()).sort(([,a], [,b]) => b - a),
        timestamp: new Date().toISOString()
      });

    } else if (action === 'active_snipes') {
      const activeSnipes = await snipeEngine.getActiveSnipes();
      
      return NextResponse.json({
        success: true,
        active_snipes: activeSnipes,
        count: activeSnipes.length,
        high_confidence_snipes: activeSnipes.filter(s => s.confidence > 0.8),
        timestamp: new Date().toISOString()
      });

    } else if (action === 'indicator_effectiveness' && symbol) {
      if (!causeEffectEngine) {
        return NextResponse.json({
          success: false,
          error: 'Cause-effect engine not initialized'
        }, { status: 500 });
      }

      const effectiveness = await causeEffectEngine.getIndicatorEffectiveness(symbol);
      
      return NextResponse.json({
        success: true,
        symbol,
        indicator_effectiveness: Object.fromEntries(effectiveness),
        top_indicators: Array.from(effectiveness.entries())
          .sort(([,a], [,b]) => b - a)
          .slice(0, 5),
        timestamp: new Date().toISOString()
      });

    }

    return NextResponse.json({
      success: false,
      error: 'Invalid action for GET request'
    }, { status: 400 });

  } catch (error) {
    console.error('High-velocity snipe GET error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve snipe data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}