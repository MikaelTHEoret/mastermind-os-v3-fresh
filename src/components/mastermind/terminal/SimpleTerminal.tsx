'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
}

export default function SimpleTerminal() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      content: input,
      role: 'user',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/mastermind/terminal/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: input,
          model: 'gpt-4',
        }),
      });

      const data = await response.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: data.result || 'Command executed successfully',
        role: 'assistant',
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        role: 'assistant',
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col" style={{
      background: 'rgba(0, 0, 0, 0.6)',
      color: '#ffffff',
      fontFamily: 'Courier New, monospace'
    }}>
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center',
            color: '#888888',
            padding: '64px 0',
            fontSize: '14px'
          }}>
            <p>Terminal ready. Enter commands below.</p>
          </div>
        )}
        
        {messages.map((message) => (
          <div key={message.id} className="space-y-1">
            <div style={{
              fontSize: '11px',
              color: '#666666',
              fontFamily: 'Courier New, monospace'
            }}>
              [{message.timestamp.toLocaleTimeString()}] {message.role}
            </div>
            <div style={{
              whiteSpace: 'pre-wrap',
              color: message.role === 'user' ? '#00ffff' : '#00ff00',
              fontFamily: 'Courier New, monospace',
              fontSize: '13px'
            }}>
              {message.role === 'user' && '$ '}
              {message.content}
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div style={{
            color: '#ffff00',
            fontSize: '13px',
            fontFamily: 'Courier New, monospace',
            animation: 'pulse 1.5s infinite'
          }}>
            Processing command...
          </div>
        )}
      </div>

      {/* Input Area */}
      <div style={{
        borderTop: '1px solid rgba(0, 255, 255, 0.2)',
        padding: '16px',
        background: 'rgba(0, 255, 255, 0.02)'
      }}>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="flex-1 flex items-center">
            <span style={{
              color: '#00ffff',
              marginRight: '8px',
              fontSize: '14px',
              fontFamily: 'Courier New, monospace'
            }}>
              $
            </span>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter command or message..."
              style={{
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(0, 255, 255, 0.3)',
                color: '#ffffff',
                fontFamily: 'Courier New, monospace',
                fontSize: '13px'
              }}
              className="placeholder-gray-500"
              disabled={isLoading}
            />
          </div>
          <Button 
            type="submit" 
            disabled={isLoading || !input.trim()}
            style={{
              background: isLoading || !input.trim() ? 'rgba(0, 255, 255, 0.2)' : 'rgba(0, 255, 255, 0.4)',
              border: '1px solid rgba(0, 255, 255, 0.5)',
              color: '#ffffff',
              fontFamily: 'Courier New, monospace',
              fontSize: '12px',
              transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => {
              if (!isLoading && input.trim()) {
                (e.target as HTMLButtonElement).style.background = 'rgba(0, 255, 255, 0.6)';
              }
            }}
            onMouseOut={(e) => {
              if (!isLoading && input.trim()) {
                (e.target as HTMLButtonElement).style.background = 'rgba(0, 255, 255, 0.4)';
              }
            }}
          >
            Execute
          </Button>
        </form>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}