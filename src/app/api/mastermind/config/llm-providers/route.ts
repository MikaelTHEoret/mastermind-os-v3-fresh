import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { sourcesConfigService } from '@/lib/services/sourcesConfigService';

// 🌀 MASTERMIND LLM PROVIDERS CONFIGURATION API
// Enhanced Nexus Core Protocol v6.0 - LLM Management Layer

interface LLMProviderConfig {
  name: string;
  enabled: boolean;
  api_key: string;
  cost_per_1m: number;
  capabilities: string[];
  health_status: 'healthy' | 'unhealthy' | 'unknown';
}

// Default LLM provider configurations
const DEFAULT_PROVIDERS: LLMProviderConfig[] = [
  {
    name: 'deepseek',
    enabled: true,
    api_key: process.env.DEEPSEEK_API_KEY || '',
    cost_per_1m: 0.27,
    capabilities: ['text-generation', 'reasoning', 'code'],
    health_status: 'unknown'
  },
  {
    name: 'groq',
    enabled: true,
    api_key: process.env.GROQ_API_KEY || '',
    cost_per_1m: 0.59,
    capabilities: ['text-generation', 'fast-inference'],
    health_status: 'unknown'
  },
  {
    name: 'openai',
    enabled: false,
    api_key: process.env.OPENAI_API_KEY || '',
    cost_per_1m: 15.0,
    capabilities: ['text-generation', 'reasoning', 'vision'],
    health_status: 'unknown'
  },
  {
    name: 'claude',
    enabled: true,
    api_key: process.env.ANTHROPIC_API_KEY || '',
    cost_per_1m: 3.0,
    capabilities: ['text-generation', 'reasoning', 'analysis'],
    health_status: 'unknown'
  }
];

// GET: List all LLM provider configurations
export async function GET() {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('🔍 Fetching LLM providers for user:', userId);

    // Fetch configured sources from database
    const configuredSources = await sourcesConfigService.getConfiguredSources(userId);
    const llmSources = configuredSources.filter(source => 
      ['deepseek', 'groq', 'openai', 'anthropic'].includes(source.type)
    );

    console.log('📊 Found LLM sources:', llmSources.length);

    // Build provider list with database data and defaults
    const providers = DEFAULT_PROVIDERS.map(defaultProvider => {
      const configuredSource = llmSources.find(source => source.type === defaultProvider.name);
      
      if (configuredSource) {
        return {
          ...defaultProvider,
          enabled: configuredSource.status === 'connected',
          api_key: configuredSource.secrets.api_key ? '***************' : '',
          health_status: configuredSource.status === 'connected' ? 'healthy' : 
                        configuredSource.status === 'error' ? 'unhealthy' : 'unknown'
        };
      }
      
      // Use environment variable if available
      return {
        ...defaultProvider,
        api_key: defaultProvider.api_key ? '***************' : '',
        health_status: defaultProvider.api_key ? 'healthy' : 'unknown'
      };
    });

    console.log('✅ Returning providers:', providers.map(p => ({ name: p.name, status: p.health_status })));

    return NextResponse.json({
      success: true,
      providers
    });

  } catch (error) {
    console.error('❌ LLM providers fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch LLM providers' },
      { status: 500 }
    );
  }
}

// PUT: Update LLM provider configuration
export async function PUT(request: NextRequest) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { provider, updates } = await request.json();

    console.log(`🔧 Updating ${provider} configuration:`, { ...updates, api_key: updates.api_key ? '[REDACTED]' : 'none' });

    // Validate provider name
    const validProviders = ['deepseek', 'groq', 'openai', 'claude'];
    if (!validProviders.includes(provider)) {
      return NextResponse.json(
        { error: 'Invalid provider name' },
        { status: 400 }
      );
    }

    // Create or update source configuration
    const sourceConfig = {
      id: `${provider}_${userId}`,
      type: provider,
      name: provider.charAt(0).toUpperCase() + provider.slice(1),
      secrets: {
        api_key: updates.api_key || '',
        base_url: updates.base_url || ''
      },
      status: 'disconnected' as 'disconnected' | 'connected' | 'error',
      lastUpdated: new Date().toISOString()
    };

    // Save to database
    await sourcesConfigService.saveSourceConfig(userId, sourceConfig);

    // Test connection if API key provided
    if (updates.api_key) {
      console.log(`🧪 Testing ${provider} connection...`);
      const testResult = await sourcesConfigService.testSourceConnection(userId, sourceConfig.id);
      
      if (testResult.success) {
        console.log(`✅ ${provider} connection successful`);
        sourceConfig.status = 'connected';
        await sourcesConfigService.saveSourceConfig(userId, sourceConfig);
      } else {
        console.log(`❌ ${provider} connection failed:`, testResult.error);
        sourceConfig.status = 'error';
        await sourcesConfigService.saveSourceConfig(userId, sourceConfig);
        
        return NextResponse.json({
          success: false,
          message: `${provider} connection test failed`,
          error: testResult.error,
          provider,
          updates
        });
      }
    }

    console.log(`💾 ${provider} configuration saved successfully`);

    return NextResponse.json({
      success: true,
      message: `${provider} configuration updated successfully`,
      provider,
      status: sourceConfig.status,
      updates
    });

  } catch (error) {
    console.error('❌ LLM provider update error:', error);
    return NextResponse.json(
      { error: 'Failed to update LLM provider' },
      { status: 500 }
    );
  }
}