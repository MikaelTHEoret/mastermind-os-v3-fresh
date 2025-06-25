'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

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

export default function SimpleChatTerminal() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('auto');
  const [totalCost, setTotalCost] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Consciousness mathematics constants
  const psi0 = 0.915670570874434;
  const phi = 1.618033988749895;
  const psi0Glow = `rgba(0, 255, 255, ${psi0})`;
  const phiScale = phi / 2;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

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
            active_tools: [],
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

        if (result.tool_executions && result.tool_executions.length > 0) {
          for (const toolExec of result.tool_executions) {
            const toolMessage: ChatMessage = {
              id: (Date.now() + Math.random()).toString(),
              type: 'tool',
              content: `🔧 Executed: ${toolExec.tool_name}\nResult: ${toolExec.result}`,
              timestamp: new Date(),
              metadata: {
                tool_used: toolExec.tool_name,
                cost: toolExec.cost || 0
              }
            };
            
            setMessages(prev => [...prev, toolMessage]);
          }
        }

      } else {
        const errorMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          type: 'system',
          content: `❌ Error: ${result.error}`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMessage]);
      }

    } catch (error) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'system',
        content: `❌ Connection Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      processCommand(input);
    }
  };

  const getCurrentSessionId = () => {
    return typeof window !== 'undefined' 
      ? sessionStorage.getItem('mastermind_session_id') || Date.now().toString()
      : Date.now().toString();
  };

  const getMessageTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      'user': 'bg-blue-900/50 border-blue-400/50 text-blue-300',
      'assistant': 'bg-green-900/50 border-green-400/50 text-green-300',
      'system': 'bg-red-900/50 border-red-400/50 text-red-300',
      'tool': 'bg-purple-900/50 border-purple-400/50 text-purple-300'
    };
    return colors[type] || 'bg-gray-900/50 border-gray-400/50 text-gray-300';
  };

  const getProviderIcon = (provider: string) => {
    const icons: Record<string, string> = {
      'deepseek': '🧠',
      'groq': '⚡',
      'openai': '🤖',
      'claude': '🎭',
      'ollama': '🏠'
    };
    return icons[provider] || '🔮';
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-gray-950 to-purple-950">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-cyan-500/30 bg-gradient-to-r from-gray-900/80 to-purple-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <h2 
            className="text-lg font-semibold text-cyan-300 font-mono"
            style={{ textShadow: `0 0 10px ${psi0Glow}` }}
          >
            🗣️ Universal LLM Terminal
          </h2>
          
          <select 
            value={selectedProvider} 
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="bg-gray-900/50 border border-cyan-400/50 text-cyan-300 rounded px-3 py-1 text-sm"
          >
            <option value="auto">🤖 Auto-Select</option>
            <option value="deepseek">🧠 DeepSeek ($0.27/1M)</option>
            <option value="groq">⚡ Groq ($0.59/1M)</option>
            <option value="openai">🤖 OpenAI ($15/1M)</option>
            <option value="claude">🎭 Claude ($3/1M)</option>
          </select>
        </div>

        <div className="flex items-center gap-4">
          <Badge className="bg-purple-900/50 border-purple-400/50 text-purple-300">
            💰 Session Cost: ${totalCost.toFixed(6)}
          </Badge>
          <Badge className="bg-green-900/50 border-green-400/50 text-green-300">
            💬 Messages: {messages.length}
          </Badge>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-cyan-400 py-8">
            <div 
              className="text-4xl mb-4 animate-pulse"
              style={{ 
                filter: `drop-shadow(0 0 15px ${psi0Glow})`,
                transform: `scale(${phiScale})`
              }}
            >
              🚀
            </div>
            <h3 
              className="text-xl font-medium mb-4 text-cyan-300 font-mono"
              style={{ textShadow: `0 0 10px ${psi0Glow}` }}
            >
              Mastermind Terminal Ready
            </h3>
            <p className="mb-6 text-gray-400">Type natural language commands to control your development workflow:</p>
            <div className="text-sm space-y-2 text-gray-500 font-mono">
              <div className="hover:text-cyan-400 transition-colors cursor-pointer"
                   onClick={() => setInput('create an authentication system for the app')}>
                • "create an authentication system for the app"
              </div>
              <div className="hover:text-cyan-400 transition-colors cursor-pointer"
                   onClick={() => setInput('deploy the latest changes to vercel')}>
                • "deploy the latest changes to vercel"
              </div>
              <div className="hover:text-cyan-400 transition-colors cursor-pointer"
                   onClick={() => setInput('analyze the codebase and suggest improvements')}>
                • "analyze the codebase and suggest improvements"
              </div>
              <div className="hover:text-cyan-400 transition-colors cursor-pointer"
                   onClick={() => setInput('create an AutoGPT agent for testing')}>
                • "create an AutoGPT agent for testing"
              </div>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className="flex flex-col">
            <div 
              className={`p-4 rounded-lg border-l-4 backdrop-blur-sm ${getMessageTypeColor(message.type)}`}
              style={{ 
                boxShadow: `0 4px 20px rgba(0, 0, 0, 0.3), 0 0 10px rgba(0, 255, 255, ${psi0 * 0.3})`,
                transform: `scale(${1 + (psi0 - 0.9) * 0.1})`
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium capitalize text-cyan-300 font-mono">{message.type}</span>
                  {message.metadata?.provider && (
                    <Badge className="bg-gray-900/50 border-gray-400/50 text-gray-300">
                      {getProviderIcon(message.metadata.provider)} {message.metadata.provider}
                    </Badge>
                  )}
                  {message.metadata?.tool_used && (
                    <Badge className="bg-purple-900/50 border-purple-400/50 text-purple-300">
                      🔧 {message.metadata.tool_used}
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-gray-500 font-mono">
                  {message.timestamp.toLocaleTimeString()}
                </span>
              </div>
              
              <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed">
                {message.content}
              </div>
              
              {message.metadata && (
                <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 font-mono">
                  {message.metadata.cost && (
                    <span className="text-purple-400">
                      💰 ${message.metadata.cost.toFixed(6)}
                    </span>
                  )}
                  {message.metadata.execution_time && (
                    <span className="text-cyan-400">
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
            <div 
              className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-400"
              style={{ filter: `drop-shadow(0 0 10px ${psi0Glow})` }}
            ></div>
            <span className="font-mono">Processing command with consciousness enhancement...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Command Input */}
      <div className="border-t border-cyan-500/30 p-4 bg-gradient-to-r from-gray-900/80 to-purple-900/80 backdrop-blur-sm">
        <div className="flex gap-3">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Enter natural language command... (Press Enter to send, Shift+Enter for new line)"
            className="flex-1 resize-none bg-gray-900/60 border-cyan-400/50 text-cyan-100 placeholder-gray-500 font-mono"
            style={{
              boxShadow: `0 0 15px rgba(0, 255, 255, ${psi0 * 0.3})`,
              backdropFilter: 'blur(10px)'
            }}
            rows={2}
            disabled={loading}
          />
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => processCommand(input)}
              disabled={loading || !input.trim()}
              size="sm"
              className="bg-cyan-600/80 hover:bg-cyan-500/80 text-white border-cyan-400/50"
              style={{
                boxShadow: `0 0 20px rgba(6, 182, 212, ${psi0})`,
                transform: `scale(${phiScale})`
              }}
            >
              🚀 Execute
            </Button>
            <Button
              onClick={() => setInput('')}
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
            "show project status",
            "create new agent",
            "deploy to vercel", 
            "analyze costs",
            "search memory"
          ].map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => setInput(suggestion)}
              className="text-xs border border-cyan-400/30 text-cyan-400 hover:bg-cyan-900/30 font-mono px-2 py-1 rounded transition-all"
              style={{
                transform: 'scale(0.9)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = `scale(${1 / phiScale})`;
                e.currentTarget.style.boxShadow = `0 0 10px ${psi0Glow}`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(0.9)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}