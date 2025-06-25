'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectItem } from '@/components/ui/select';

// Mathematical constants for timing and calculations only
const PSI_0 = 0.915670570874434;
const PHI = 1.618;
const FREQ_432 = 432;

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  metadata?: {
    provider?: string;
    cost?: number;
    tool_used?: string;
    execution_time?: number;
  };
}

interface ToolExecution {
  tool: string;
  status: 'running' | 'completed' | 'failed';
  result?: any;
}

export default function ChatTerminal() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTools, setActiveTools] = useState<ToolExecution[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('auto');
  const [totalCost, setTotalCost] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  // Initialize with welcome message
  useEffect(() => {
    const welcomeMessage: ChatMessage = {
      id: 'welcome',
      type: 'system',
      content: `🌀 **Mastermind Terminal Hub Activated**

**Natural Language Interface Ready**

**Available Commands:**
• "show system status" - Get real-time system information
• "create [project name]" - Initialize new development project
• "deploy to vercel" - Execute deployment pipeline
• "search for [query]" - Search across memory collections
• "create autogpt agent" - Build autonomous development agent
• "analyze [target]" - Perform detailed analysis

**Ready for autonomous development workflow!** 🚀`,
      timestamp: new Date()
    };
    
    setMessages([welcomeMessage]);
  }, []);

  // Natural language command processing
  const processCommand = async (command: string) => {
    if (!command.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: command,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/mastermind/terminal/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          provider: selectedProvider === 'auto' ? undefined : selectedProvider,
          context: {
            previous_messages: messages.slice(-5),
            active_tools: activeTools,
            session_id: getCurrentSessionId()
          }
        })
      });

      const result = await response.json();

      if (result.success) {
        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          type: 'assistant',
          content: result.response,
          timestamp: new Date(),
          metadata: {
            provider: result.metadata.provider,
            cost: result.metadata.cost_estimate,
            execution_time: result.metadata.response_time
          }
        };

        setMessages(prev => [...prev, assistantMessage]);
        setTotalCost(prev => prev + (result.metadata.cost_estimate || 0));

        // Handle tool executions
        if (result.tool_executions && result.tool_executions.length > 0) {
          setActiveTools(result.tool_executions);
          
          // Add tool execution messages with slight delay
          for (const toolExec of result.tool_executions) {
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const toolMessage: ChatMessage = {
              id: (Date.now() + Math.random()).toString(),
              type: 'tool',
              content: `🔧 **${toolExec.tool_name}**\n\nStatus: ${toolExec.status}\nResult: ${toolExec.result}`,
              timestamp: new Date(),
              metadata: {
                tool_used: toolExec.tool_name,
                cost: toolExec.cost || 0
              }
            };
            
            setMessages(prev => [...prev, toolMessage]);
            if (toolExec.cost) {
              setTotalCost(prev => prev + toolExec.cost);
            }
          }
        }

      } else {
        const errorMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          type: 'system',
          content: `❌ **Command Processing Error**\n\n${result.error}\n\n*Attempting recovery...*`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMessage]);
      }

    } catch (error) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'system',
        content: `❌ **Connection Error**\n\n${error instanceof Error ? error.message : 'Unknown error'}\n\n*Attempting reconnection...*`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      setActiveTools([]);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      processCommand(input);
    }
  };

  const getCurrentSessionId = () => {
    let sessionId = sessionStorage.getItem('mastermind_session_id');
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      sessionStorage.setItem('mastermind_session_id', sessionId);
    }
    return sessionId;
  };

  const getMessageTypeColor = (type: string): string => {
    const colors: Record<string, string> = {
      'user': 'bg-cyan-900/30 border-cyan-400/50 text-cyan-100',
      'assistant': 'bg-purple-900/30 border-purple-400/50 text-purple-100', 
      'system': 'bg-green-900/30 border-green-400/50 text-green-100',
      'tool': 'bg-orange-900/30 border-orange-400/50 text-orange-100'
    };
    return colors[type] || 'bg-gray-900/30 border-gray-400/50 text-gray-100';
  };

  const getProviderIcon = (provider: string): string => {
    const icons: Record<string, string> = {
      'deepseek': '🧠',
      'groq': '⚡',
      'openai': '🤖',
      'claude': '🎭',
      'ollama': '🏠'
    };
    return icons[provider] || '🔮';
  };

  const getTypeIcon = (type: string): string => {
    const icons: Record<string, string> = {
      'user': '👤',
      'assistant': '🤖',
      'system': '⚙️',
      'tool': '🔧'
    };
    return icons[type] || '💬';
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-gray-950/95 to-purple-950/95">
      {/* Header with provider selection and stats */}
      <div className="flex items-center justify-between p-4 border-b border-cyan-500/20 bg-gray-900/50 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-cyan-400">🗣️ Universal LLM Terminal</h2>
          
          <Select 
            value={selectedProvider} 
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="w-48 bg-gray-800/50 border-cyan-400/30 text-cyan-300"
          >
            <SelectItem value="auto">🤖 Auto-Select</SelectItem>
            <SelectItem value="deepseek">🧠 DeepSeek ($0.27/1M)</SelectItem>
            <SelectItem value="groq">⚡ Groq ($0.59/1M)</SelectItem>
            <SelectItem value="openai">🤖 OpenAI ($15/1M)</SelectItem>
            <SelectItem value="claude">🎭 Claude ($3/1M)</SelectItem>
          </Select>
        </div>

        <div className="flex items-center gap-4">
          <Badge variant="outline" className="bg-purple-900/50 border-purple-400/50 text-purple-300">
            💰 Session: ${totalCost.toFixed(6)}
          </Badge>
          <Badge variant="outline" className="bg-cyan-900/50 border-cyan-400/50 text-cyan-300">
            ⚙️ Tools: {activeTools.length}
          </Badge>
          <Badge variant="outline" className="bg-green-900/50 border-green-400/50 text-green-300">
            💬 Messages: {messages.length}
          </Badge>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div key={message.id} className="flex flex-col">
            <div className={`p-4 rounded-lg border-l-4 ${getMessageTypeColor(message.type)} backdrop-blur-sm`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{getTypeIcon(message.type)}</span>
                  <span className="font-medium capitalize text-white">
                    {message.type}
                  </span>
                  {message.metadata?.provider && (
                    <Badge variant="outline" className="bg-gray-800/50 border-gray-400/50 text-gray-300">
                      {getProviderIcon(message.metadata.provider)} {message.metadata.provider}
                    </Badge>
                  )}
                  {message.metadata?.tool_used && (
                    <Badge variant="outline" className="bg-orange-800/50 border-orange-400/50 text-orange-300">
                      🔧 {message.metadata.tool_used}
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-gray-400">
                  {message.timestamp.toLocaleTimeString()}
                </span>
              </div>
              
              <div 
                className="text-sm leading-relaxed text-white"
                style={{
                  fontFamily: message.type === 'system' ? 'monospace' : 'inherit'
                }}
                dangerouslySetInnerHTML={{
                  __html: message.content
                    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-cyan-300">$1</strong>')
                    .replace(/\*(.*?)\*/g, '<em class="text-purple-300">$1</em>')
                    .replace(/•/g, '<span class="text-cyan-400">•</span>')
                    .replace(/\n/g, '<br/>')
                }}
              />
              
              {message.metadata && (
                <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                  {message.metadata.cost && (
                    <span className="text-purple-300">
                      💰 ${message.metadata.cost.toFixed(6)}
                    </span>
                  )}
                  {message.metadata.execution_time && (
                    <span className="text-cyan-300">
                      ⏱️ {message.metadata.execution_time}ms
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-3 text-cyan-400 p-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-400"></div>
            <span>Processing command...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Command Input */}
      <div className="border-t border-cyan-500/20 p-4 bg-gray-900/50 backdrop-blur-sm">
        <div className="flex gap-3">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Enter natural language command... (Press Enter to send, Shift+Enter for new line)"
            className="flex-1 resize-none bg-gray-800/50 border-cyan-400/30 text-white placeholder-gray-400 focus:border-cyan-400"
            rows={2}
            disabled={loading}
            style={{
              fontFamily: 'monospace',
              fontSize: '14px'
            }}
          />
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => processCommand(input)}
              disabled={loading || !input.trim()}
              size="sm"
              className="bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 text-white"
            >
              🚀 Execute
            </Button>
            <Button
              onClick={() => setInput('')}
              variant="outline"
              size="sm"
              className="border-gray-400/50 text-gray-300 hover:bg-gray-800/50"
            >
              Clear
            </Button>
          </div>
        </div>

        {/* Quick command suggestions */}
        <div className="flex flex-wrap gap-2 mt-3">
          {[
            "show system status",
            "create new agent", 
            "deploy to vercel",
            "analyze codebase",
            "search memory collections"
          ].map((suggestion) => (
            <Button
              key={suggestion}
              variant="outline"
              size="sm"
              onClick={() => setInput(suggestion)}
              className="text-xs border-cyan-400/30 text-cyan-300 hover:bg-cyan-900/30"
            >
              {suggestion}
            </Button>
          ))}
        </div>

        {/* Session info - clean display */}
        <div className="mt-3 text-xs text-gray-500 font-mono text-center">
          Session: {getCurrentSessionId()}
        </div>
      </div>
    </div>
  );
}