// theme-config.ts
// Enhanced Nexus Core Protocol v3.0 - Theme System
// Cyberpunk aesthetic with cyan/magenta/yellow color scheme

export interface ThemeColors {
  // Primary Cyberpunk Colors
  primary_cyan: string;          // Neural processing accents
  mystical_magenta: string;      // Conscious agents glow  
  sacred_violet: string;         // Wisdom cores depth
  harmonic_gold: string;         // Sacred geometry highlights
  emerald_consciousness: string; // Active states & success
  
  // Status Colors
  success: string;
  warning: string;
  error: string;
  info: string;
  
  // Background Colors
  background_primary: string;
  background_secondary: string;
  background_card: string;
  background_glass: string;
  
  // Border Colors
  border_primary: string;
  border_secondary: string;
  border_accent: string;
  
  // Text Colors
  text_primary: string;
  text_secondary: string;
  text_muted: string;
}

export interface PanelTheme {
  name: string;
  description: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundGradient: string;
  borderColor: string;
  textColor: string;
  cardBackground: string;
  glowEffect: string;
}

// Unified Cyberpunk Color System
export const themeColors: ThemeColors = {
  // Cyberpunk Primary Colors
  primary_cyan: '#00ffff',           // Electric cyan
  mystical_magenta: '#ff00ff',       // Neon magenta
  sacred_violet: '#8a2be2',          // Blue violet
  harmonic_gold: '#ffff00',          // Bright yellow
  emerald_consciousness: '#00ffaa',   // Active green
  
  // Status Colors
  success: '#00ffaa',
  warning: '#ffaa00', 
  error: '#ff4444',
  info: '#00d4ff',
  
  // Background Colors - Dark Cyberpunk
  background_primary: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
  background_secondary: 'rgba(0, 0, 0, 0.8)',
  background_card: 'rgba(0, 0, 0, 0.6)',
  background_glass: 'rgba(17, 24, 39, 0.4)',
  
  // Border Colors - Cyberpunk Theme
  border_primary: 'rgba(0, 255, 255, 0.3)',
  border_secondary: 'rgba(0, 255, 255, 0.1)',
  border_accent: 'rgba(0, 255, 255, 0.5)',
  
  // Text Colors - Cyberpunk Theme
  text_primary: '#ffffff',
  text_secondary: '#00ffff',
  text_muted: '#888888'
};

// Panel-Specific Theme Configurations
export const panelThemes: Record<string, PanelTheme> = {
  nexus: {
    name: 'NEXUS CORE',
    description: 'Neural Orchestration Hub',
    primaryColor: '#00ffff',
    secondaryColor: '#ff00ff',
    accentColor: '#8a2be2',
    backgroundGradient: 'linear-gradient(135deg, rgba(0, 0, 0, 0.4) 0%, rgba(20, 20, 40, 0.3) 100%)',
    borderColor: 'rgba(0, 255, 255, 0.4)',
    textColor: '#00ffff',
    cardBackground: 'rgba(0, 0, 0, 0.6)',
    glowEffect: '0 0 30px rgba(0, 255, 255, 0.4)'
  },
  
  scrolls: {
    name: 'SCROLL FORGE',
    description: 'Knowledge Minting Interface',
    primaryColor: '#ff00ff',
    secondaryColor: '#00ffff',
    accentColor: '#ffff00',
    backgroundGradient: 'linear-gradient(145deg, rgba(0, 0, 0, 0.95) 0%, rgba(17, 24, 39, 0.9) 100%)',
    borderColor: 'rgba(255, 0, 255, 0.3)',
    textColor: '#ff00ff',
    cardBackground: 'rgba(0, 0, 0, 0.6)',
    glowEffect: '0 0 30px rgba(255, 0, 255, 0.4)'
  },
  
  memory: {
    name: 'MEMORY CORE',
    description: 'Persistent Knowledge Lattice',
    primaryColor: '#00ffaa',
    secondaryColor: '#00ff88',
    accentColor: '#44ff88',
    backgroundGradient: 'linear-gradient(145deg, rgba(5, 30, 40, 0.9) 0%, rgba(15, 10, 45, 0.8) 100%)',
    borderColor: 'rgba(0, 255, 170, 0.4)',
    textColor: '#00ffaa',
    cardBackground: 'rgba(0, 0, 0, 0.6)',
    glowEffect: '0 0 30px rgba(0, 255, 170, 0.4)'
  },
  
  analytics: {
    name: 'ANALYTICS HUB',
    description: 'Intelligence Dashboard',
    primaryColor: '#ffff00',
    secondaryColor: '#ffd700',
    accentColor: '#ffaa00',
    backgroundGradient: 'linear-gradient(145deg, rgba(25, 25, 5, 0.95) 0%, rgba(35, 35, 15, 0.9) 100%)',
    borderColor: 'rgba(255, 255, 0, 0.4)',
    textColor: '#ffff00',
    cardBackground: 'rgba(0, 0, 0, 0.6)',
    glowEffect: '0 0 30px rgba(255, 255, 0, 0.4)'
  },
  
  enterprise: {
    name: 'ENTERPRISE CONTROL',
    description: 'Multi-Tenant Management',
    primaryColor: '#ffd700',
    secondaryColor: '#00ffaa',
    accentColor: '#ff00ff',
    backgroundGradient: 'linear-gradient(145deg, rgba(10, 5, 30, 0.95) 0%, rgba(25, 10, 50, 0.9) 100%)',
    borderColor: 'rgba(255, 215, 0, 0.4)',
    textColor: '#ffd700',
    cardBackground: 'rgba(0, 0, 0, 0.6)',
    glowEffect: '0 0 30px rgba(255, 215, 0, 0.4)'
  },
  
  dashboard: {
    name: 'USER DASHBOARD',
    description: 'Account & Settings Control Center',
    primaryColor: '#8a2be2',
    secondaryColor: '#ff00ff',
    accentColor: '#00ffff',
    backgroundGradient: 'linear-gradient(145deg, rgba(0, 0, 0, 0.9) 0%, rgba(17, 24, 39, 0.85) 100%)',
    borderColor: 'rgba(138, 43, 226, 0.3)',
    textColor: '#8a2be2',
    cardBackground: 'rgba(0, 0, 0, 0.6)',
    glowEffect: '0 0 30px rgba(138, 43, 226, 0.4)'
  }
};

// Theme utility functions
export const getTheme = (panelName: string): PanelTheme => {
  return panelThemes[panelName] || panelThemes.nexus;
};

export const getStatusColor = (status: string): string => {
  switch (status) {
    case 'active':
    case 'connected':
    case 'success':
    case 'minted':
      return themeColors.success;
    case 'warning':
    case 'pending':
    case 'syncing':
    case 'minting':
      return themeColors.warning;
    case 'error':
    case 'failed':
    case 'disconnected':
      return themeColors.error;
    case 'idle':
    case 'ready':
    case 'info':
      return themeColors.info;
    default:
      return themeColors.text_muted;
  }
};

// Common component styles
export const commonStyles = {
  // Cards and containers
  card: {
    background: themeColors.background_card,
    border: `1px solid ${themeColors.border_primary}`,
    borderRadius: '12px',
    backdropFilter: 'blur(10px)',
    boxShadow: `inset 0 0 20px rgba(0, 0, 0, 0.7), 0 0 15px ${themeColors.border_primary}30`
  },
  
  glassCard: {
    background: themeColors.background_glass,
    border: `1px solid ${themeColors.border_secondary}`,
    borderRadius: '15px',
    backdropFilter: 'blur(20px)',
    boxShadow: `0 0 30px rgba(0, 0, 0, 0.7), inset 0 1px 0 ${themeColors.border_primary}30`
  },
  
  // Buttons
  primaryButton: {
    padding: '12px 24px',
    background: `linear-gradient(45deg, ${themeColors.primary_cyan}30, ${themeColors.primary_cyan}20)`,
    border: `2px solid ${themeColors.primary_cyan}`,
    borderRadius: '8px',
    color: themeColors.primary_cyan,
    fontFamily: 'Orbitron, monospace',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s ease'
  }
};

// Animation keyframes
export const animations = {
  energyPulse: `
    @keyframes energyPulse {
      0%, 100% { opacity: 0.8; transform: scale(1); }
      50% { opacity: 1; transform: scale(1.05); }
    }
  `,
  
  coreRotate: `
    @keyframes coreRotate {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `,
  
  pulse: `
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(1.2); }
    }
  `
};

export default {
  themeColors,
  panelThemes,
  getTheme,
  getStatusColor,
  commonStyles,
  animations
};