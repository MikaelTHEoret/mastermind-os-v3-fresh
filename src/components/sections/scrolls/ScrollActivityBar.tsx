'use client';

import { Folder, Code, Zap, Terminal } from 'lucide-react';

type ActiveView = 'explorer' | 'editor' | 'minter' | 'terminal';

interface ScrollActivityBarProps {
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  theme: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    borderColor: string;
    textColor: string;
    cardBackground: string;
  };
}

export default function ScrollActivityBar({
  activeView,
  setActiveView,
  theme
}: ScrollActivityBarProps) {
  const activityItems = [
    { id: 'explorer', icon: Folder, label: 'Explorer' },
    { id: 'editor', icon: Code, label: 'Editor' },
    { id: 'minter', icon: Zap, label: 'Minter' },
    { id: 'terminal', icon: Terminal, label: 'Terminal' }
  ] as const;

  return (
    <div style={{
      width: '48px',
      background: 'rgba(0, 0, 0, 0.7)',
      border: `2px solid ${theme.borderColor}`,
      borderLeft: 'none',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: `0 0 15px ${theme.primaryColor}40, inset 0 0 8px rgba(0, 0, 0, 0.5)`
    }}>
      {activityItems.map((item) => (
        <button
          key={item.id}
          onClick={() => setActiveView(item.id)}
          style={{
            padding: '12px',
            border: activeView === item.id ? `2px solid ${theme.primaryColor}` : '2px solid transparent',
            background: activeView === item.id ? 'rgba(0, 0, 0, 0.7)' : 'transparent',
            color: activeView === item.id ? theme.primaryColor : theme.secondaryColor,
            transition: 'all 0.3s ease',
            cursor: 'pointer',
            boxShadow: activeView === item.id ? `0 0 15px ${theme.primaryColor}60, inset 0 0 8px rgba(0, 0, 0, 0.5)` : 'none'
          }}
          title={item.label}
          onMouseEnter={(e) => {
            if (activeView !== item.id) {
              e.currentTarget.style.background = 'rgba(0, 0, 0, 0.7)'
              e.currentTarget.style.color = theme.primaryColor
              e.currentTarget.style.border = `2px solid ${theme.primaryColor}`
              e.currentTarget.style.boxShadow = `0 0 15px ${theme.primaryColor}60, inset 0 0 8px rgba(0, 0, 0, 0.5)`
            }
          }}
          onMouseLeave={(e) => {
            if (activeView !== item.id) {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = theme.secondaryColor
              e.currentTarget.style.border = '2px solid transparent'
              e.currentTarget.style.boxShadow = 'none'
            }
          }}
        >
          <item.icon style={{ width: '20px', height: '20px' }} />
        </button>
      ))}
    </div>
  );
}