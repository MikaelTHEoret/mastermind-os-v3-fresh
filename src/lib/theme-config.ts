// Theme Configuration
// Enhanced Nexus Core Protocol v3.0 - Cyberpunk Aesthetic System

export const themeConfig = {
  // Core Cyberpunk Color Palette
  colors: {
    primary: {
      cyan: '#00ffff',
      magenta: '#ff00ff', 
      yellow: '#ffff00',
      electric: '#00e5ff',
      neon: '#ff1744',
      bright: '#ffea00'
    },
    background: {
      dark: '#0a0a0a',
      space: '#030712',
      circuit: '#1a1a2e',
      deep: '#16213e'
    },
    accent: {
      glow: '#00ffff80',
      pulse: '#ff00ff40',
      energy: '#ffff0060'
    }
  },

  // Typography System
  fonts: {
    display: 'Orbitron',
    body: 'Rajdhani',
    mono: 'Fira Code'
  },

  // Animation Presets
  animations: {
    glow: 'animate-pulse',
    float: 'animate-bounce',
    spin: 'animate-spin',
    fade: 'animate-fade-in'
  },

  // Component Themes
  components: {
    card: {
      background: 'bg-gray-900/80',
      border: 'border-cyan-500/30',
      glow: 'shadow-lg shadow-cyan-500/20'
    },
    button: {
      primary: 'bg-cyan-500 hover:bg-cyan-400 text-black',
      secondary: 'bg-magenta-500 hover:bg-magenta-400 text-white',
      accent: 'bg-yellow-500 hover:bg-yellow-400 text-black'
    },
    input: {
      base: 'bg-gray-800 border-cyan-500/30 text-cyan-100',
      focus: 'focus:border-cyan-400 focus:ring-cyan-400/20'
    }
  },

  // Layout Configuration
  layout: {
    maxWidth: 'max-w-7xl',
    spacing: {
      section: 'py-20',
      component: 'p-6',
      tight: 'p-4'
    }
  },

  // Special Effects
  effects: {
    hologram: 'backdrop-blur-sm bg-gradient-to-r from-cyan-500/10 to-magenta-500/10',
    circuit: 'bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900',
    energy: 'animate-pulse bg-gradient-to-r from-cyan-400 to-magenta-400'
  }
};

export default themeConfig;