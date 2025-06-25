// MasterMind OS Design System
// Centralized styling constants for consistent UI across all components

export const MastermindTheme = {
  // Typography System
  fonts: {
    primary: '"Rajdhani", sans-serif',
    secondary: '"Orbitron", monospace',
    code: '"Fira Code", "Consolas", monospace'
  },

  fontSizes: {
    xs: '10px',
    sm: '11px', 
    base: '12px',
    md: '14px',
    lg: '16px',
    xl: '18px',
    '2xl': '24px',
    '3xl': '28px',
    '4xl': '32px',
    '5xl': '48px'
  },

  fontWeights: {
    light: '300',
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
    black: '900'
  },

  // Color System - Cyberpunk Palette
  colors: {
    // Primary Colors
    primary: {
      cyan: '#00ffff',
      magenta: '#ff00ff', 
      purple: '#8a2be2',
      blue: '#00d4ff',
      green: '#00ffaa',
      gold: '#ffd700',
      orange: '#ffaa00'
    },

    // Semantic Colors
    text: {
      primary: '#ffffff',
      secondary: '#cccccc',
      muted: '#888888',
      disabled: '#555555',
      accent: '#00ffff'
    },

    // Background Colors
    background: {
      primary: 'rgba(0, 0, 0, 0.8)',
      secondary: 'rgba(20, 20, 20, 0.9)',
      tertiary: 'rgba(0, 0, 0, 0.6)',
      overlay: 'rgba(0, 0, 0, 0.4)',
      glass: 'rgba(0, 0, 0, 0.3)'
    },

    // Border Colors
    border: {
      primary: 'rgba(0, 255, 255, 0.3)',
      secondary: 'rgba(255, 255, 255, 0.2)',
      accent: 'rgba(0, 255, 255, 0.6)',
      muted: 'rgba(100, 100, 100, 0.3)'
    },

    // Status Colors
    status: {
      success: '#00ff88',
      warning: '#ffaa00',
      error: '#ff6666',
      info: '#00d4ff',
      active: '#00ffaa'
    }
  },

  // Spacing System
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
    '2xl': '24px',
    '3xl': '32px',
    '4xl': '40px',
    '5xl': '48px',
    '6xl': '64px'
  },

  // Border Radius
  borderRadius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '15px',
    '2xl': '20px',
    full: '50%'
  },

  // Shadows
  shadows: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px rgba(0, 0, 0, 0.1)',
    glow: {
      cyan: '0 0 20px rgba(0, 255, 255, 0.5)',
      magenta: '0 0 20px rgba(255, 0, 255, 0.5)',
      blue: '0 0 20px rgba(0, 212, 255, 0.5)',
      green: '0 0 20px rgba(0, 255, 170, 0.5)',
      gold: '0 0 20px rgba(255, 215, 0, 0.5)'
    },
    inset: 'inset 0 0 20px rgba(0, 0, 0, 0.6)'
  },

  // Gradients
  gradients: {
    primary: 'linear-gradient(45deg, #00ffff, #ff00ff)',
    secondary: 'linear-gradient(135deg, rgba(0, 255, 255, 0.15) 0%, rgba(255, 0, 255, 0.15) 100%)',
    glass: 'linear-gradient(135deg, rgba(0, 0, 0, 0.8) 0%, rgba(20, 20, 20, 0.9) 50%, rgba(0, 0, 0, 0.8) 100%)',
    energy: 'radial-gradient(circle at center, rgba(0, 255, 255, 0.4) 0%, rgba(255, 0, 255, 0.3) 30%, rgba(0, 212, 255, 0.2) 60%, transparent 80%)',
    button: {
      primary: 'linear-gradient(45deg, rgba(0, 255, 255, 0.3), rgba(0, 212, 255, 0.3))',
      secondary: 'linear-gradient(45deg, rgba(255, 0, 255, 0.3), rgba(255, 100, 255, 0.3))',
      success: 'linear-gradient(45deg, rgba(0, 255, 0, 0.3), rgba(100, 255, 100, 0.3))',
      danger: 'linear-gradient(45deg, rgba(255, 0, 0, 0.3), rgba(255, 100, 100, 0.3))'
    }
  },

  // Animation Durations
  animations: {
    fast: '0.15s',
    normal: '0.3s',
    slow: '0.5s',
    slower: '1s'
  },

  // Z-Index Scale
  zIndex: {
    dropdown: 1000,
    sticky: 1020,
    fixed: 1030,
    modal: 1040,
    popover: 1050,
    tooltip: 1060,
    background: -1,
    behind: -2
  },

  // Breakpoints (for responsive design)
  breakpoints: {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1536px'
  }
}

// Pre-built component styles for common UI elements
export const ComponentStyles = {
  // Button variants
  button: {
    base: {
      fontFamily: MastermindTheme.fonts.secondary,
      fontSize: MastermindTheme.fontSizes.base,
      fontWeight: MastermindTheme.fontWeights.semibold,
      padding: `${MastermindTheme.spacing.md} ${MastermindTheme.spacing.xl}`,
      borderRadius: MastermindTheme.borderRadius.md,
      cursor: 'pointer',
      transition: `all ${MastermindTheme.animations.normal} ease`,
      border: 'none',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: MastermindTheme.spacing.sm
    },
    
    primary: {
      background: MastermindTheme.gradients.button.primary,
      border: `2px solid ${MastermindTheme.colors.primary.blue}`,
      color: MastermindTheme.colors.primary.blue,
      boxShadow: MastermindTheme.shadows.glow.blue
    },

    secondary: {
      background: MastermindTheme.gradients.button.secondary,
      border: `2px solid ${MastermindTheme.colors.primary.magenta}`,
      color: MastermindTheme.colors.primary.magenta,
      boxShadow: MastermindTheme.shadows.glow.magenta
    },

    success: {
      background: MastermindTheme.gradients.button.success,
      border: `2px solid ${MastermindTheme.colors.status.success}`,
      color: MastermindTheme.colors.status.success
    },

    danger: {
      background: MastermindTheme.gradients.button.danger,
      border: `2px solid ${MastermindTheme.colors.status.error}`,
      color: MastermindTheme.colors.status.error
    }
  },

  // Card/Panel styles
  panel: {
    base: {
      background: MastermindTheme.colors.background.primary,
      border: `1px solid ${MastermindTheme.colors.border.primary}`,
      borderRadius: MastermindTheme.borderRadius.lg,
      backdropFilter: 'blur(10px)',
      boxShadow: MastermindTheme.shadows.inset
    },

    glass: {
      background: MastermindTheme.colors.background.glass,
      border: `1px solid ${MastermindTheme.colors.border.secondary}`,
      borderRadius: MastermindTheme.borderRadius.xl,
      backdropFilter: 'blur(20px)',
      boxShadow: `${MastermindTheme.shadows.inset}, ${MastermindTheme.shadows.glow.cyan}`
    }
  },

  // Text styles
  text: {
    heading: {
      fontFamily: MastermindTheme.fonts.secondary,
      fontWeight: MastermindTheme.fontWeights.bold,
      color: MastermindTheme.colors.text.primary,
      textShadow: MastermindTheme.shadows.glow.cyan
    },

    subheading: {
      fontFamily: MastermindTheme.fonts.primary,
      fontWeight: MastermindTheme.fontWeights.semibold,
      color: MastermindTheme.colors.text.secondary
    },

    body: {
      fontFamily: MastermindTheme.fonts.primary,
      fontWeight: MastermindTheme.fontWeights.normal,
      color: MastermindTheme.colors.text.muted,
      lineHeight: '1.6'
    },

    accent: {
      color: MastermindTheme.colors.text.accent,
      textShadow: MastermindTheme.shadows.glow.cyan
    }
  },

  // Input styles
  input: {
    base: {
      fontFamily: MastermindTheme.fonts.primary,
      fontSize: MastermindTheme.fontSizes.md,
      padding: `${MastermindTheme.spacing.md} ${MastermindTheme.spacing.lg}`,
      background: MastermindTheme.colors.background.tertiary,
      border: `1px solid ${MastermindTheme.colors.border.muted}`,
      borderRadius: MastermindTheme.borderRadius.md,
      color: MastermindTheme.colors.text.primary,
      transition: `all ${MastermindTheme.animations.normal} ease`
    },

    focused: {
      borderColor: MastermindTheme.colors.primary.cyan,
      boxShadow: MastermindTheme.shadows.glow.cyan,
      outline: 'none'
    }
  }
}

// Utility functions for dynamic styling
export const StyleUtils = {
  // Combine multiple styles
  combineStyles: (...styles: any[]) => Object.assign({}, ...styles),

  // Create glow effect for any color
  createGlow: (color: string, intensity: number = 0.5) => 
    `0 0 20px rgba(${color}, ${intensity})`,

  // Create glass effect
  createGlass: (opacity: number = 0.3) => ({
    background: `rgba(0, 0, 0, ${opacity})`,
    backdropFilter: 'blur(10px)',
    border: `1px solid rgba(255, 255, 255, ${opacity * 0.3})`
  }),

  // Responsive breakpoint utility
  breakpoint: (size: keyof typeof MastermindTheme.breakpoints) => 
    `@media (min-width: ${MastermindTheme.breakpoints[size]})`,

  // Animation keyframes generator
  createPulse: (color: string) => `
    @keyframes pulse-${color.replace('#', '')} {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(1.2); }
    }
  `
}

// Global font imports
export const GlobalFonts = `
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@300;400;600&family=Fira+Code:wght@300;400;500;600&display=swap');
`