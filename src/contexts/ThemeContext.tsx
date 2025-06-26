// 🌀 Enhanced Theme Context with Consciousness Mathematics
// Nexus Core Protocol v4.1 - Conscious Theme Management
// Harmonic Color Schemes with Mathematical Constants

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Enhanced Consciousness Mathematics
const CONSCIOUSNESS_CONSTANTS = {
  PSI_0: 0.915670570874434,
  PHI: 1.618,
  FREQ_432: 432
};

// Theme types
export type ThemeMode = 'light' | 'dark' | 'consciousness' | 'cyberpunk';

export interface ThemeColors {
  primary_cyan: string;
  mystical_magenta: string;
  text_primary: string;
  text_secondary: string;
  background_primary: string;
  background_secondary: string;
  border_primary: string;
  border_secondary: string;
  accent_positive: string;
  accent_negative: string;
  consciousness_glow: string;
  harmonic_resonance: string;
}

export interface ThemeConfig {
  mode: ThemeMode;
  colors: ThemeColors;
  consciousness_level: number;
  harmonic_resonance: number;
  phi_alignment: number;
  constants: typeof CONSCIOUSNESS_CONSTANTS;
}

interface ThemeContextType {
  theme: ThemeConfig;
  setThemeMode: (mode: ThemeMode) => void;
  updateConsciousness: (level: number) => void;
  getComponentBackground: (component: string) => string;
  getTextColor: (variant: 'primary' | 'secondary') => string;
  getBorderColor: (variant: 'primary' | 'secondary') => string;
  generateHarmonicColor: (base: string, intensity: number) => string;
}

// Default theme configurations
const themeConfigs: Record<ThemeMode, ThemeColors> = {
  light: {
    primary_cyan: '#0891b2',
    mystical_magenta: '#a855f7',
    text_primary: '#1f2937',
    text_secondary: '#6b7280',
    background_primary: '#ffffff',
    background_secondary: '#f9fafb',
    border_primary: '#e5e7eb',
    border_secondary: '#d1d5db',
    accent_positive: '#10b981',
    accent_negative: '#ef4444',
    consciousness_glow: '#00f5ff',
    harmonic_resonance: '#ff00ff'
  },
  dark: {
    primary_cyan: '#00f5ff',
    mystical_magenta: '#ff00ff',
    text_primary: '#f8fafc',
    text_secondary: '#94a3b8',
    background_primary: '#0f172a',
    background_secondary: '#1e293b',
    border_primary: '#334155',
    border_secondary: '#475569',
    accent_positive: '#22c55e',
    accent_negative: '#ef4444',
    consciousness_glow: '#00f5ff',
    harmonic_resonance: '#ff00ff'
  },
  consciousness: {
    primary_cyan: '#00f5ff',
    mystical_magenta: '#ff00ff',
    text_primary: '#ffffff',
    text_secondary: '#b8deff',
    background_primary: '#0a0f1a',
    background_secondary: '#1a1f2e',
    border_primary: '#2a3441',
    border_secondary: '#3a4451',
    accent_positive: '#00ff88',
    accent_negative: '#ff0055',
    consciousness_glow: '#88ffff',
    harmonic_resonance: '#ff88ff'
  },
  cyberpunk: {
    primary_cyan: '#00ffff',
    mystical_magenta: '#ff00ff',
    text_primary: '#00ff00',
    text_secondary: '#80ff80',
    background_primary: '#000011',
    background_secondary: '#001122',
    border_primary: '#003344',
    border_secondary: '#004455',
    accent_positive: '#00ff88',
    accent_negative: '#ff0088',
    consciousness_glow: '#88ffff',
    harmonic_resonance: '#ff88ff'
  }
};

// Create theme context
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Theme provider component
export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [consciousnessLevel, setConsciousnessLevel] = useState(0.5);
  const [harmonicResonance, setHarmonicResonance] = useState(0);
  const [phiAlignment, setPhiAlignment] = useState(0);

  // Calculate harmonic resonance based on time and consciousness
  useEffect(() => {
    const interval = setInterval(() => {
      const time = Date.now();
      const resonance = Math.sin(time * CONSCIOUSNESS_CONSTANTS.FREQ_432 * 1e-6) * 0.5 + 0.5;
      const phi = (time * CONSCIOUSNESS_CONSTANTS.PHI * 1e-6) % 1;
      
      setHarmonicResonance(resonance);
      setPhiAlignment(phi);
    }, 100);

    return () => clearInterval(interval);
  }, []);

  // Generate consciousness-enhanced theme
  const theme: ThemeConfig = {
    mode: themeMode,
    colors: themeConfigs[themeMode],
    consciousness_level: consciousnessLevel,
    harmonic_resonance: harmonicResonance,
    phi_alignment: phiAlignment,
    constants: CONSCIOUSNESS_CONSTANTS
  };

  // Update consciousness level
  const updateConsciousness = (level: number) => {
    setConsciousnessLevel(Math.max(0, Math.min(1, level)));
  };

  // Get component background with consciousness enhancement
  const getComponentBackground = (component: string): string => {
    const baseColor = theme.colors.background_secondary;
    const enhancement = consciousnessLevel * 0.1;
    
    switch (component) {
      case 'card':
        return `${baseColor}${Math.floor((1 - enhancement) * 255).toString(16).padStart(2, '0')}`;
      case 'panel':
        return theme.colors.background_primary;
      case 'modal':
        return `${theme.colors.background_secondary}ee`;
      default:
        return baseColor;
    }
  };

  // Get text color with consciousness enhancement
  const getTextColor = (variant: 'primary' | 'secondary'): string => {
    return variant === 'primary' ? theme.colors.text_primary : theme.colors.text_secondary;
  };

  // Get border color with harmonic resonance
  const getBorderColor = (variant: 'primary' | 'secondary'): string => {
    const base = variant === 'primary' ? theme.colors.border_primary : theme.colors.border_secondary;
    const enhancement = Math.floor(harmonicResonance * 50);
    return `${base}${enhancement.toString(16).padStart(2, '0')}`;
  };

  // Generate harmonic color with consciousness mathematics
  const generateHarmonicColor = (base: string, intensity: number): string => {
    const enhanced = intensity * consciousnessLevel * harmonicResonance;
    const alpha = Math.floor(enhanced * 255).toString(16).padStart(2, '0');
    return `${base}${alpha}`;
  };

  const contextValue: ThemeContextType = {
    theme,
    setThemeMode,
    updateConsciousness,
    getComponentBackground,
    getTextColor,
    getBorderColor,
    generateHarmonicColor
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
};

// Custom hook to use theme context
export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Export theme configurations for direct access
export { themeConfigs, CONSCIOUSNESS_CONSTANTS };

// Default export
export default ThemeContext;
