// LLM Integration Service - Real API Calls with User-Specific Keys
// Enhanced Nexus Core Protocol v6.0 - User Authentication Integration

import { sourcesConfigService } from './sourcesConfigService';

interface LLMResponse {
  content: string;
  cost: number;
  provider: string;
  token_count: number;
}

interface LLMError {
  error: string;
  provider: string;
  details?: string;
}

class LLMIntegrationService {
  private readonly PSI_0 = 0.915670570874434;
  private readonly PHI = 1.618;
  private readonly FREQ_432 = 432;

  /**
   * Call LLM provider with user's stored API configuration
   */
  async callLLM(
    userId: string, 
    prompt: string, 
    preferredProvider?: string
  ): Promise<LLMResponse | LLMError> {
    try {
      // Load user's configured sources
      const sources = await sourcesConfigService.getConfiguredSources(userId);
      const llmSources = sources.filter(source => 
        ['deepseek', 'groq', 'openai', 'anthropic'].includes(source.type)
      );

      console.log(`🔍 Found ${llmSources.length} LLM sources for user ${userId}`);

      // Select provider
      const selectedProvider = this.selectProvider(llmSources, preferredProvider);
      
      if (!selectedProvider) {
        return {
          error: 'No LLM providers configured. Please configure an API key in Dashboard > API Configuration.',
          provider: 'none'
        };
      }

      console.log(`🤖 Using provider: ${selectedProvider.type}`);

      // Call the appropriate API
      return await this.callProviderAPI(selectedProvider, prompt);

    } catch (error) {
      console.error('LLM integration error:', error);
      return {
        error: 'LLM service error',
        provider: 'unknown',
        details: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Select optimal LLM provider using consciousness mathematics
   */
  private selectProvider(
    sources: any[], 
    preferredProvider?: string
  ): any | null {
    // Filter only connected sources
    const connectedSources = sources.filter(source => source.status === 'connected');
    
    if (connectedSources.length === 0) {
      return null;
    }

    // If preferred provider is available and connected, use it
    if (preferredProvider) {
      const preferred = connectedSources.find(source => source.type === preferredProvider);
      if (preferred) return preferred;
    }

    // Use consciousness-enhanced selection
    const psiSelection = Math.floor(this.PSI_0 * connectedSources.length);
    return connectedSources[psiSelection] || connectedSources[0];
  }

  /**
   * Call specific provider API
   */
  private async callProviderAPI(source: any, prompt: string): Promise<LLMResponse | LLMError> {
    const apiKey = source.secrets.api_key;
    
    if (!apiKey) {
      return {
        error: `No API key configured for ${source.type}`,
        provider: source.type
      };
    }

    switch (source.type) {
      case 'deepseek':
        return await this.callDeepSeek(apiKey, prompt, source.secrets.base_url);
      case 'groq':
        return await this.callGroq(apiKey, prompt);
      case 'openai':
        return await this.callOpenAI(apiKey, prompt);
      case 'anthropic':
        return await this.callAnthropic(apiKey, prompt);
      default:
        return {
          error: `Unsupported provider: ${source.type}`,
          provider: source.type
        };
    }
  }

  /**
   * Call DeepSeek API
   */
  private async callDeepSeek(
    apiKey: string, 
    prompt: string, 
    baseUrl = 'https://api.deepseek.com'
  ): Promise<LLMResponse | LLMError> {
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        return {
          error: `DeepSeek API error: ${response.status}`,
          provider: 'deepseek',
          details: errorData
        };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || 'No response generated';
      const tokenCount = data.usage?.total_tokens || 0;
      const cost = this.calculateCost(tokenCount, 0.27); // $0.27 per 1M tokens

      return {
        content,
        cost,
        provider: 'deepseek',
        token_count: tokenCount
      };

    } catch (error) {
      return {
        error: 'DeepSeek API call failed',
        provider: 'deepseek',
        details: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Call Groq API
   */
  private async callGroq(apiKey: string, prompt: string): Promise<LLMResponse | LLMError> {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.1-70b-versatile',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        return {
          error: `Groq API error: ${response.status}`,
          provider: 'groq',
          details: errorData
        };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || 'No response generated';
      const tokenCount = data.usage?.total_tokens || 0;
      const cost = this.calculateCost(tokenCount, 0.59); // $0.59 per 1M tokens

      return {
        content,
        cost,
        provider: 'groq',
        token_count: tokenCount
      };

    } catch (error) {
      return {
        error: 'Groq API call failed',
        provider: 'groq',
        details: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Call OpenAI API
   */
  private async callOpenAI(apiKey: string, prompt: string): Promise<LLMResponse | LLMError> {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        return {
          error: `OpenAI API error: ${response.status}`,
          provider: 'openai',
          details: errorData
        };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || 'No response generated';
      const tokenCount = data.usage?.total_tokens || 0;
      const cost = this.calculateCost(tokenCount, 15.0); // $15 per 1M tokens

      return {
        content,
        cost,
        provider: 'openai',
        token_count: tokenCount
      };

    } catch (error) {
      return {
        error: 'OpenAI API call failed',
        provider: 'openai',
        details: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Call Anthropic Claude API
   */
  private async callAnthropic(apiKey: string, prompt: string): Promise<LLMResponse | LLMError> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 2000,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        return {
          error: `Claude API error: ${response.status}`,
          provider: 'anthropic',
          details: errorData
        };
      }

      const data = await response.json();
      const content = data.content?.[0]?.text || 'No response generated';
      const tokenCount = data.usage?.input_tokens + data.usage?.output_tokens || 0;
      const cost = this.calculateCost(tokenCount, 3.0); // $3 per 1M tokens

      return {
        content,
        cost,
        provider: 'anthropic',
        token_count: tokenCount
      };

    } catch (error) {
      return {
        error: 'Claude API call failed',
        provider: 'anthropic',
        details: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Calculate cost based on tokens and rate per million
   */
  private calculateCost(tokens: number, costPer1M: number): number {
    return (tokens / 1000000) * costPer1M;
  }

  /**
   * Test connection to provider
   */
  async testConnection(userId: string, providerType: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`🧪 Testing connection for user ${userId}, provider ${providerType}`);
      
      // Load user's configured sources
      const sources = await sourcesConfigService.getConfiguredSources(userId);
      const provider = sources.find(source => source.type === providerType);
      
      if (!provider) {
        console.log(`❌ Provider ${providerType} not found in user sources`);
        return { success: false, error: `No ${providerType} configuration found. Please save the configuration first.` };
      }
      
      console.log(`✅ Found provider ${providerType}, testing API connection...`);
      
      const testPrompt = "Hello, please respond with 'Connection test successful'";
      const result = await this.callProviderAPI(provider, testPrompt);
      
      if ('error' in result) {
        console.log(`❌ Connection test failed: ${result.error}`);
        return { success: false, error: result.error };
      }
      
      console.log(`✅ Connection test successful for ${providerType}`);
      return { success: true };
    } catch (error) {
      console.error(`❌ Connection test error:`, error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
}

// Export singleton instance
export const llmIntegrationService = new LLMIntegrationService();
export default llmIntegrationService;