#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';

/**
 * 🤖 MASTERMIND TERMINAL MCP SERVER
 * 
 * Provides Claude Desktop integration with:
 * - Universal LLM Terminal commands
 * - AutoGPT agent creation and management
 * - Memory search across collections
 * - Real-time system monitoring
 */

class MastermindMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'mastermind-terminal',
        version: '1.0.0',
        description: 'Mastermind Terminal Hub with AutoGPT integration'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.mastermindAPI = process.env.MASTERMIND_API_BASE || 'https://mastermind-os-v3-fresh.vercel.app/api';
    this.apiKey = process.env.MASTERMIND_API_KEY || '';

    this.setupToolHandlers();
  }

  setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'mastermind_execute',
            description: 'Execute natural language commands in Mastermind terminal with Universal LLM',
            inputSchema: {
              type: 'object',
              properties: {
                command: {
                  type: 'string',
                  description: 'Natural language command to execute (e.g., "deploy the latest changes", "analyze the codebase")'
                },
                provider: {
                  type: 'string',
                  description: 'Preferred LLM provider (optional): deepseek, groq, openai, claude',
                  enum: ['deepseek', 'groq', 'openai', 'claude', 'auto']
                }
              },
              required: ['command']
            }
          },
          {
            name: 'mastermind_create_agent',
            description: 'Create and deploy AutoGPT agent for autonomous task execution',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Agent name (e.g., "Auth System Developer")'
                },
                objective: {
                  type: 'string',
                  description: 'Clear, specific objective for the agent to accomplish'
                },
                tools: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: ['serena', 'github', 'universal_llm', 'vercel', 'memory_search', 'file_operations', 'web_browser', 'database_ops', 'api_calls', 'image_generation']
                  },
                  description: 'Tools available to the agent'
                },
                cost_budget: {
                  type: 'number',
                  description: 'Cost budget in USD (default: 10.0)'
                },
                llm_provider: {
                  type: 'string',
                  description: 'LLM provider for the agent',
                  enum: ['deepseek', 'groq', 'openai', 'claude']
                },
                deploy_immediately: {
                  type: 'boolean',
                  description: 'Whether to deploy the agent immediately after creation (default: false)'
                }
              },
              required: ['name', 'objective']
            }
          },
          {
            name: 'mastermind_search_memory',
            description: 'Search across all Mastermind memory collections with semantic understanding',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query to find relevant information'
                },
                collection: {
                  type: 'string',
                  description: 'Specific collection to search (optional)',
                  enum: ['all', 'hugging_dynamic_memory', 'system_enhancements', 'fractal_scrolls', 'autogpt_task_memory']
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results (default: 10)'
                },
                min_relevance: {
                  type: 'number',
                  description: 'Minimum relevance score (0-1, default: 0.3)'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'mastermind_get_status',
            description: 'Get comprehensive Mastermind system status and analytics',
            inputSchema: {
              type: 'object',
              properties: {
                include_agents: {
                  type: 'boolean',
                  description: 'Include detailed agent status (default: true)'
                },
                include_executions: {
                  type: 'boolean',
                  description: 'Include recent execution history (default: true)'
                }
              }
            }
          },
          {
            name: 'mastermind_manage_agent',
            description: 'Manage existing AutoGPT agents (deploy, stop, view logs)',
            inputSchema: {
              type: 'object',
              properties: {
                agent_id: {
                  type: 'string',
                  description: 'ID of the agent to manage'
                },
                action: {
                  type: 'string',
                  description: 'Action to perform',
                  enum: ['deploy', 'stop', 'status', 'logs', 'delete']
                }
              },
              required: ['agent_id', 'action']
            }
          }
        ]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'mastermind_execute':
            return await this.executeTerminalCommand(args.command, args.provider);
          
          case 'mastermind_create_agent':
            return await this.createAutoGPTAgent(args);
          
          case 'mastermind_search_memory':
            return await this.searchMemory(args.query, args);
          
          case 'mastermind_get_status':
            return await this.getSystemStatus(args);
          
          case 'mastermind_manage_agent':
            return await this.manageAgent(args.agent_id, args.action);
          
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error executing ${name}: ${error.message}`
            }
          ]
        };
      }
    });
  }

  async executeTerminalCommand(command, provider = 'auto') {
    try {
      const response = await fetch(`${this.mastermindAPI}/mastermind/terminal/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          command,
          provider,
          context: {
            session_id: 'mcp-claude-desktop',
            source: 'claude-desktop-mcp'
          }
        })
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Terminal execution failed');
      }

      return {
        content: [
          {
            type: 'text',
            text: `🚀 **Mastermind Terminal Execution**\n\n**Command:** ${command}\n**Provider:** ${result.metadata?.provider || provider}\n**Cost:** $${result.metadata?.cost_estimate || 0}\n**Response Time:** ${result.metadata?.response_time || 'N/A'}ms\n\n**Result:**\n${result.response}\n\n${result.tool_executions?.length > 0 ? `**Tools Used:** ${result.tool_executions.map(t => t.tool_name).join(', ')}` : ''}`
          }
        ]
      };

    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ **Terminal Execution Failed**\n\nCommand: ${command}\nError: ${error.message}\n\nPlease check the Mastermind Terminal status and try again.`
          }
        ]
      };
    }
  }

  async createAutoGPTAgent(agentConfig) {
    try {
      const response = await fetch(`${this.mastermindAPI}/mastermind/agents/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          name: agentConfig.name,
          description: agentConfig.description || '',
          objective: agentConfig.objective,
          tools: agentConfig.tools || ['universal_llm', 'memory_search'],
          cost_budget: agentConfig.cost_budget || 10.0,
          llm_provider: agentConfig.llm_provider || 'deepseek'
        })
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Agent creation failed');
      }

      let statusText = `🤖 **AutoGPT Agent Created Successfully**\n\n**Name:** ${result.agent.name}\n**ID:** ${result.agent.id}\n**Objective:** ${result.agent.objective}\n**Budget:** $${result.agent.cost_budget}\n**Provider:** ${result.agent.llm_provider}\n**Tools:** ${result.agent.tools.join(', ')}\n**Status:** ${result.agent.status}`;

      // Deploy immediately if requested
      if (agentConfig.deploy_immediately) {
        try {
          const deployResponse = await this.deployAgent(result.agent.id);
          statusText += `\n\n🚀 **Agent Deployed Immediately**\n${deployResponse.deployment_status}`;
        } catch (deployError) {
          statusText += `\n\n⚠️ **Agent created but deployment failed:** ${deployError.message}`;
        }
      } else {
        statusText += `\n\n💡 **Next Steps:** Use \`mastermind_manage_agent\` with action "deploy" to start execution.`;
      }

      return {
        content: [
          {
            type: 'text',
            text: statusText
          }
        ]
      };

    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ **AutoGPT Agent Creation Failed**\n\nName: ${agentConfig.name}\nError: ${error.message}\n\nPlease check your configuration and try again.`
          }
        ]
      };
    }
  }

  async searchMemory(query, options = {}) {
    try {
      const response = await fetch(`${this.mastermindAPI}/mastermind/memory/semantic-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          query,
          filters: {
            collection: options.collection || 'all',
            min_relevance: options.min_relevance || 0.3
          },
          limit: options.limit || 10,
          include_metadata: true
        })
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Memory search failed');
      }

      const resultsText = result.results.map((r, idx) => 
        `**${idx + 1}. [${r.collection}] ${r.title || 'Untitled'}**\n   Relevance: ${Math.round(r.relevance_score * 100)}%\n   ${r.content.substring(0, 300)}${r.content.length > 300 ? '...' : ''}\n   Address: ${r.addressing}\n`
      ).join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `🔍 **Mastermind Memory Search Results**\n\n**Query:** "${query}"\n**Found:** ${result.total_count} results\n**Collection:** ${options.collection || 'all'}\n\n${resultsText}\n\n💡 Use specific addresses or ask for more details on any result.`
          }
        ]
      };

    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ **Memory Search Failed**\n\nQuery: "${query}"\nError: ${error.message}\n\nPlease check the search parameters and try again.`
          }
        ]
      };
    }
  }

  async getSystemStatus(options = {}) {
    try {
      // Get general stats
      const statsResponse = await fetch(`${this.mastermindAPI}/mastermind/terminal/stats`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });
      const statsResult = await statsResponse.json();
      
      let statusText = `📊 **Mastermind System Status**\n\n`;
      
      if (statsResult.success) {
        const stats = statsResult.stats;
        statusText += `**General Status:**\n`;
        statusText += `• Active Sessions: ${stats.active_sessions}\n`;
        statusText += `• Cost Today: $${stats.total_cost_today}\n`;
        statusText += `• LLM Providers: ${stats.llm_providers_online}/${stats.total_providers} online\n`;
        statusText += `• Pending Logs: ${stats.pending_logs}\n\n`;

        if (stats.autogpt_metrics) {
          statusText += `**AutoGPT Status:**\n`;
          statusText += `• Total Agents: ${stats.autogpt_metrics.total_agents_created}\n`;
          statusText += `• Running Agents: ${stats.autogpt_metrics.agents_running}\n`;
          statusText += `• Idle Agents: ${stats.autogpt_metrics.agents_idle}\n`;
          statusText += `• Total Executions: ${stats.autogpt_metrics.total_executions}\n`;
          statusText += `• Success Rate: ${Math.round((stats.autogpt_metrics.successful_executions / Math.max(stats.autogpt_metrics.total_executions, 1)) * 100)}%\n`;
          statusText += `• Avg Cost/Execution: $${stats.autogpt_metrics.average_cost_per_execution}\n\n`;
        }
      }

      // Get agent details if requested
      if (options.include_agents !== false) {
        try {
          const agentsResponse = await fetch(`${this.mastermindAPI}/mastermind/agents`, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
          });
          const agentsResult = await agentsResponse.json();
          
          if (agentsResult.success && agentsResult.agents.length > 0) {
            statusText += `**Active Agents:**\n`;
            agentsResult.agents.forEach(agent => {
              statusText += `• **${agent.name}** (${agent.status}) - Budget: $${agent.cost_budget}, Used: $${agent.cost_used.toFixed(6)}\n`;
            });
            statusText += `\n`;
          }
        } catch (error) {
          statusText += `⚠️ Could not load agent details: ${error.message}\n\n`;
        }
      }

      statusText += `**System operational and ready!** 🚀`;

      return {
        content: [
          {
            type: 'text',
            text: statusText
          }
        ]
      };

    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ **Status Check Failed**\n\nError: ${error.message}\n\nPlease check the Mastermind system connectivity.`
          }
        ]
      };
    }
  }

  async manageAgent(agentId, action) {
    try {
      let response;
      let resultText;

      switch (action) {
        case 'deploy':
          response = await fetch(`${this.mastermindAPI}/mastermind/agents/${agentId}/deploy`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
          });
          const deployResult = await response.json();
          
          if (deployResult.success) {
            resultText = `🚀 **Agent Deployed Successfully**\n\nAgent ID: ${agentId}\nExecution ID: ${deployResult.execution.id}\nEstimated Duration: ${deployResult.estimated_duration}\nStatus: ${deployResult.execution.status}\n\nAgent is now running autonomously!`;
          } else {
            throw new Error(deployResult.error);
          }
          break;

        case 'stop':
          response = await fetch(`${this.mastermindAPI}/mastermind/agents/${agentId}/stop`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
          });
          const stopResult = await response.json();
          
          if (stopResult.success) {
            resultText = `⏸️ **Agent Stopped**\n\nAgent ID: ${agentId}\nStopped At: ${stopResult.stopped_at}\nFinal Status: ${stopResult.final_status}`;
          } else {
            throw new Error(stopResult.error);
          }
          break;

        case 'status':
          response = await fetch(`${this.mastermindAPI}/mastermind/agents/${agentId}`, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
          });
          const statusResult = await response.json();
          
          if (statusResult.success) {
            const agent = statusResult.agent;
            resultText = `📊 **Agent Status**\n\n**Name:** ${agent.name}\n**Status:** ${agent.status}\n**Objective:** ${agent.objective}\n**Budget:** $${agent.cost_budget}\n**Used:** $${agent.cost_used.toFixed(6)}\n**Executions:** ${agent.execution_count}\n**Success Rate:** ${Math.round(agent.success_rate * 100)}%`;
          } else {
            throw new Error(statusResult.error);
          }
          break;

        case 'logs':
          // Get recent execution logs
          response = await fetch(`${this.mastermindAPI}/mastermind/agents/executions?agent_id=${agentId}&limit=1`, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
          });
          const logsResult = await response.json();
          
          if (logsResult.success && logsResult.executions.length > 0) {
            const execution = logsResult.executions[0];
            resultText = `📋 **Agent Logs**\n\nAgent ID: ${agentId}\nExecution: ${execution.id}\nStatus: ${execution.status}\nProgress: ${execution.steps_completed}/${execution.total_steps}\n\n**Recent Logs:**\n${execution.logs.slice(-10).map(log => `• ${log}`).join('\n')}`;
          } else {
            resultText = `📋 **No Recent Logs Found**\n\nAgent ID: ${agentId}\nNo execution history available.`;
          }
          break;

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      };

    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ **Agent Management Failed**\n\nAgent ID: ${agentId}\nAction: ${action}\nError: ${error.message}`
          }
        ]
      };
    }
  }

  async deployAgent(agentId) {
    const response = await fetch(`${this.mastermindAPI}/mastermind/agents/${agentId}/deploy`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    });
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    return {
      deployment_status: `Agent deployed successfully (Execution ID: ${result.execution.id})`
    };
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    console.error('🔗 Mastermind Terminal MCP Server started');
    console.error('🤖 AutoGPT integration active');
    console.error('🔧 Available tools: 5');
    console.error(`🌐 API Endpoint: ${this.mastermindAPI}`);
  }
}

// Start the MCP server
const server = new MastermindMCPServer();
server.start().catch(console.error);