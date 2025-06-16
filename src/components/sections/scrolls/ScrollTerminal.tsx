'use client';

import { useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { Terminal } from 'lucide-react';

interface ScrollTerminalProps {
  terminalOutput: string[];
  terminalInput: string;
  setTerminalInput: (input: string) => void;
  handleTerminalCommand: (command: string) => void;
  theme: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    borderColor: string;
    textColor: string;
    cardBackground: string;
  };
}

export default function ScrollTerminal({
  terminalOutput,
  terminalInput,
  setTerminalInput,
  handleTerminalCommand,
  theme
}: ScrollTerminalProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(0, 0, 0, 0.8)', // Match ScrollEditor background
      border: `2px solid ${theme.borderColor}`,
      borderLeft: 'none',
      height: '100%',
      boxShadow: `0 0 20px ${theme.primaryColor}60, inset 0 0 10px rgba(0, 0, 0, 0.5)`
    }}>
      {/* Header */}
      <div style={{
        padding: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        borderBottom: `2px solid ${theme.borderColor}`,
        background: 'rgba(0, 0, 0, 0.8)'
      }}>
        <Terminal style={{ width: '16px', height: '16px', color: theme.primaryColor }} />
        <span style={{ 
          color: theme.primaryColor, 
          fontWeight: '500',
          fontFamily: 'Orbitron, monospace'
        }}>
          Terminal
        </span>
      </div>
      
      {/* Output Area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px',
        fontFamily: 'Courier New, monospace',
        fontSize: '14px',
        background: 'rgba(0, 0, 0, 0.8)',
        color: theme.primaryColor
      }}>
        {terminalOutput.map((line, index) => (
          <div key={index} style={{ marginBottom: '4px' }}>
            {line}
          </div>
        ))}
      </div>
      
      {/* Input Area */}
      <div style={{
        padding: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        borderTop: `2px solid ${theme.borderColor}`,
        background: 'rgba(0, 0, 0, 0.8)'
      }}>
        <span style={{ 
          color: theme.primaryColor,
          fontFamily: 'Courier New, monospace',
          fontSize: '14px'
        }}>
          $
        </span>
        <input
          type="text"
          value={terminalInput}
          onChange={(e) => setTerminalInput(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              handleTerminalCommand(terminalInput);
            }
          }}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: theme.primaryColor,
            fontFamily: 'Courier New, monospace',
            fontSize: '14px'
          }}
          placeholder="Enter command..."
        />
      </div>
    </div>
  );
}