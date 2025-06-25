// Centralized theme configuration for MasterMind OS
export interface ThemeConfig {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: {
    primary: string;
    secondary: string;
    muted: string;
  };
  border: string;
  status: {
    success: string;
    warning: string;
    error: string;
    info: string;
  };
}

// Panel-specific themes
const themes: Record<string, ThemeConfig> = {
  nexus: {
    primary: '#00ffff',
    secondary: '#ff00ff', 
    accent: '#8a2be2',
    background: 'bg-black/80',
    text: {
      primary: 'text-cyan-400',
      secondary: 'text-cyan-100',
      muted: 'text-cyan-300'
    },
    border: 'border-cyan-500/30',
    status: {
      success: '#00ffaa',
      warning: '#ffd700',
      error: '#ff4444',
      info: '#00ffff'
    }
  },
  memory: {
    primary: '#00ffaa',
    secondary: '#00ff88',
    accent: '#44ff88',
    background: 'bg-black/70',
    text: {
      primary: 'text-green-400',
      secondary: 'text-green-100',
      muted: 'text-green-300'
    },
    border: 'border-green-500/30',
    status: {
      success: '#00ffaa',
      warning: '#ffaa00',
      error: '#ff4444',
      info: '#00ff88'
    }
  },
  scrolls: {
    primary: '#06b6d4',
    secondary: '#0891b2',
    accent: '#0e7490',
    background: 'bg-black/80',
    text: {
      primary: 'text-cyan-400',
      secondary: 'text-cyan-100',
      muted: 'text-cyan-300'
    },
    border: 'border-cyan-500/30',
    status: {
      success: '#00ffaa',
      warning: '#ffd700',
      error: '#ff4444',
      info: '#06b6d4'
    }
  },
  analytics: {
    primary: '#ff00ff',
    secondary: '#cc00ff',
    accent: '#8800ff',
    background: 'bg-black/75',
    text: {
      primary: 'text-purple-400',
      secondary: 'text-purple-100',
      muted: 'text-purple-300'
    },
    border: 'border-purple-500/30',
    status: {
      success: '#00ffaa',
      warning: '#ffd700',
      error: '#ff4444',
      info: '#ff00ff'
    }
  },
  enterprise: {
    primary: '#ffd700',
    secondary: '#ff6600',
    accent: '#00ffaa',
    background: 'bg-black/85',
    text: {
      primary: 'text-yellow-400',
      secondary: 'text-yellow-100',
      muted: 'text-yellow-300'
    },
    border: 'border-yellow-500/30',
    status: {
      success: '#00ffaa',
      warning: '#ffd700',
      error: '#ff4444',
      info: '#ffaa00'
    }
  }
};

// Get theme by panel name
export function getTheme(panelName: string): ThemeConfig {
  return themes[panelName] || themes.nexus;
}

// Get status color
export function getStatusColor(status: string, panelName: string = 'nexus'): string {
  const theme = getTheme(panelName);
  switch (status.toLowerCase()) {
    case 'active':
    case 'online':
    case 'success':
    case 'completed':
      return theme.status.success;
    case 'warning':
    case 'pending':
      return theme.status.warning;
    case 'error':
    case 'failed':
    case 'offline':
      return theme.status.error;
    case 'info':
    case 'processing':
    default:
      return theme.status.info;
  }
}

// Get metric color based on value
export function getMetricColor(value: number, threshold: number = 50): string {
  if (value >= threshold * 1.5) return '#00ffaa';
  if (value >= threshold) return '#ffd700';
  if (value >= threshold * 0.5) return '#ffaa00';
  return '#ff4444';
}

// Common styles
export const commonStyles = {
  card: 'bg-black/60 backdrop-blur-sm border border-cyan-500/30 rounded-lg p-4',
  button: 'bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded text-sm font-medium',
  input: 'bg-black/40 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100',
  text: {
    heading: 'text-2xl font-bold text-cyan-400',
    subheading: 'text-lg font-semibold text-cyan-300' as const,
    body: 'text-cyan-100',
    muted: 'text-cyan-300 text-sm'
  }
};

// Animation keyframes
export const animations = {
  pulse: 'animate-pulse',
  spin: 'animate-spin',
  bounce: 'animate-bounce'
};