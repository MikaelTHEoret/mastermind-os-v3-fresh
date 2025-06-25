'use client';

import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import ChatTerminal from './terminal/ChatTerminal';
import LogProcessor from './terminal/LogProcessor';
import SemanticSearch from './terminal/SemanticSearch';
import AgentManager from './terminal/AgentManager';
import ConfigDashboard from './terminal/ConfigDashboard';

export default function MastermindTerminal() {
  const [isClient, setIsClient] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');

  // Handle client-side mounting
  useEffect(() => {
    setIsClient(true);
  }, []);

  const getTabIcon = (tab: string) => {
    const icons: Record<string, string> = {
      'chat': '🗣️',
      'logs': '📊',
      'search': '🔍',
      'agents': '🤖',
      'config': '⚙️'
    };
    return icons[tab] || '📄';
  };

  const getTabBadge = (tab: string) => {
    switch (tab) {
      case 'agents':
        return 0; // Will be populated from API
      case 'logs':
        return 2; // Will be populated from API
      default:
        return null;
    }
  };

  // Don't render until client is ready
  if (!isClient) {
    return (
      <div className="h-full flex items-center justify-center" style={{
        background: 'rgba(0, 0, 0, 0.8)',
        color: '#00ffff'
      }}>
        <div className="text-center">
          <div style={{
            width: '32px',
            height: '32px',
            border: '2px solid transparent',
            borderTop: '2px solid #00ffff',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 8px'
          }}></div>
          <div style={{
            fontSize: '14px',
            fontFamily: 'Courier New, monospace'
          }}>
            Loading Terminal...
          </div>
        </div>
        <style jsx>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="h-full" style={{
      background: 'rgba(0, 0, 0, 0.4)',
      color: '#ffffff'
    }}>
      {/* Terminal Content */}
      <div className="h-full">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full">
          <div style={{
            background: 'rgba(0, 255, 255, 0.05)',
            borderBottom: '1px solid rgba(0, 255, 255, 0.2)',
            padding: '0 24px'
          }}>
            <TabsList style={{
              width: '100%',
              justifyContent: 'flex-start',
              background: 'transparent',
              border: 'none',
              padding: '8px 0'
            }}>
              {[
                { id: 'chat', label: 'Universal Chat' },
                { id: 'logs', label: 'Log Processor' },
                { id: 'search', label: 'Memory Search' },
                { id: 'agents', label: 'Agent Manager' },
                { id: 'config', label: 'Configuration' }
              ].map((tab) => {
                const badge = getTabBadge(tab.id);
                return (
                  <TabsTrigger 
                    key={tab.id} 
                    value={tab.id} 
                    style={{
                      position: 'relative',
                      background: activeTab === tab.id ? 'rgba(0, 255, 255, 0.1)' : 'transparent',
                      color: activeTab === tab.id ? '#00ffff' : '#888888',
                      border: `1px solid ${activeTab === tab.id ? 'rgba(0, 255, 255, 0.3)' : 'transparent'}`,
                      borderRadius: '6px',
                      padding: '8px 16px',
                      fontSize: '12px',
                      fontFamily: 'Courier New, monospace',
                      transition: 'all 0.3s ease',
                      cursor: 'pointer'
                    }}
                    onMouseOver={(e) => {
                      if (activeTab !== tab.id) {
                        const target = e.target as HTMLElement;
                        target.style.color = '#00ffff';
                        target.style.background = 'rgba(0, 255, 255, 0.05)';
                      }
                    }}
                    onMouseOut={(e) => {
                      if (activeTab !== tab.id) {
                        const target = e.target as HTMLElement;
                        target.style.color = '#888888';
                        target.style.background = 'transparent';
                      }
                    }}
                  >
                    {getTabIcon(tab.id)} {tab.label}
                    {badge && badge > 0 && (
                      <span style={{
                        marginLeft: '8px',
                        background: '#ff0000',
                        color: '#ffffff',
                        borderRadius: '50%',
                        padding: '2px 6px',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        minWidth: '18px',
                        height: '18px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        {badge}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          <div style={{
            height: 'calc(100% - 60px)',
            background: 'rgba(0, 0, 0, 0.2)'
          }}>
            <TabsContent value="chat" className="h-full m-0">
              <ChatTerminal />
            </TabsContent>

            <TabsContent value="logs" className="h-full m-0">
              <LogProcessor />
            </TabsContent>

            <TabsContent value="search" className="h-full m-0">
              <SemanticSearch />
            </TabsContent>

            <TabsContent value="agents" className="h-full m-0">
              <AgentManager />
            </TabsContent>

            <TabsContent value="config" className="h-full m-0">
              <ConfigDashboard />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}