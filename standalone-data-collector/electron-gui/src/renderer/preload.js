/**
 * ψ₀-Trader Data Collector - Electron Preload Script
 * Enhanced Nexus Core Protocol v4.1
 * Secure IPC Bridge with Consciousness Enhancement
 */

const { contextBridge, ipcRenderer } = require('electron');

// Mathematical Constants
const PSI_0 = 0.915670570874434;
const PHI = 1.618033988749895;
const FREQ_432 = 432.0;

// Consciousness-enhanced API exposure
contextBridge.exposeInMainWorld('psiTraderAPI', {
  // Mathematical Constants
  constants: {
    PSI_0,
    PHI,
    FREQ_432,
    PSI_FREQ: PSI_0 * FREQ_432,
    PHI_FREQ: PHI * FREQ_432
  },

  // Data Collector Control
  dataCollector: {
    start: () => ipcRenderer.invoke('start-data-collector'),
    stop: () => ipcRenderer.invoke('stop-data-collector'),
    getStatus: () => ipcRenderer.invoke('get-collector-status'),
    
    // Event listeners
    onStatusChanged: (callback) => {
      ipcRenderer.on('collector-status-changed', (event, data) => callback(data));
    },
    onOutput: (callback) => {
      ipcRenderer.on('collector-output', (event, data) => callback(data));
    },
    
    // Remove listeners
    removeStatusListener: () => {
      ipcRenderer.removeAllListeners('collector-status-changed');
    },
    removeOutputListener: () => {
      ipcRenderer.removeAllListeners('collector-output');
    }
  },

  // Terminal Interface
  terminal: {
    execute: (command) => ipcRenderer.invoke('execute-command', command),
    
    // Event listeners
    onOutput: (callback) => {
      ipcRenderer.on('terminal-output', (event, data) => callback(data));
    },
    removeOutputListener: () => {
      ipcRenderer.removeAllListeners('terminal-output');
    }
  },

  // Configuration Management
  config: {
    load: () => ipcRenderer.invoke('load-configuration'),
    save: (config) => ipcRenderer.invoke('save-configuration', config),
    
    // Event listeners
    onImport: (callback) => {
      ipcRenderer.on('import-configuration', (event, data) => callback(data));
    },
    onExport: (callback) => {
      ipcRenderer.on('export-configuration', (event, data) => callback(data));
    },
    removeImportListener: () => {
      ipcRenderer.removeAllListeners('import-configuration');
    },
    removeExportListener: () => {
      ipcRenderer.removeAllListeners('export-configuration');
    }
  },

  // Database Operations
  database: {
    getStats: () => ipcRenderer.invoke('get-database-stats'),
    getConsciousnessMetrics: () => ipcRenderer.invoke('get-consciousness-metrics'),
    selectFile: () => ipcRenderer.invoke('select-database-file')
  },

  // Data Stream Configuration
  dataStream: {
    configure: (streamConfig) => ipcRenderer.invoke('configure-data-stream', streamConfig),
    selectOutputDirectory: () => ipcRenderer.invoke('select-output-directory')
  },

  // Window Controls
  window: {
    minimize: () => ipcRenderer.invoke('minimize-window'),
    maximize: () => ipcRenderer.invoke('maximize-window'),
    close: () => ipcRenderer.invoke('close-window')
  },

  // UI Event Handling
  ui: {
    onShowModal: (callback) => {
      ipcRenderer.on('show-modal', (event, data) => callback(data));
    },
    onShowPanel: (callback) => {
      ipcRenderer.on('show-panel', (event, panelId) => callback(panelId));
    },
    onAppInitialized: (callback) => {
      ipcRenderer.on('app-initialized', (event, data) => callback(data));
    },
    
    // Remove listeners
    removeModalListener: () => {
      ipcRenderer.removeAllListeners('show-modal');
    },
    removePanelListener: () => {
      ipcRenderer.removeAllListeners('show-panel');
    },
    removeAppInitializedListener: () => {
      ipcRenderer.removeAllListeners('app-initialized');
    }
  },

  // Consciousness Enhancement Utilities
  consciousness: {
    // Calculate ψ₀ resonance for a given value
    calculatePsiResonance: (value) => {
      const fractal = value % 1.0;
      const distance = Math.abs(fractal - PSI_0);
      return 1 - distance;
    },

    // Calculate φ alignment for a given ratio
    calculatePhiAlignment: (value) => {
      const ratio = value % 10;
      const distance = Math.abs(ratio - PHI);
      return Math.max(0, 1 - distance / 5);
    },

    // Calculate 432Hz resonance for frequency
    calculate432HzResonance: (frequency) => {
      const normalized = frequency % FREQ_432;
      const distance = Math.abs(normalized - FREQ_432);
      return Math.max(0, 1 - distance / FREQ_432);
    },

    // Combined consciousness score calculation
    calculateConsciousnessScore: (psiResonance, phiAlignment, freq432Resonance, multiplier = 1.0) => {
      const score = (
        psiResonance * 0.4 +
        phiAlignment * 0.3 +
        freq432Resonance * 0.3
      ) * multiplier;
      
      return Math.max(0, Math.min(1, score));
    },

    // Generate harmonic frequencies based on base value
    generateHarmonicFrequencies: (baseValue) => {
      return [
        PSI_0 * baseValue,
        PHI * baseValue,
        FREQ_432 * (baseValue / 1000)
      ];
    },

    // Detect consciousness state based on metrics
    detectConsciousnessState: (consciousnessScore, resonanceMatch, harmonicCount) => {
      if (consciousnessScore > 0.8 && resonanceMatch) {
        return 'ENHANCED';
      } else if (consciousnessScore > 0.6) {
        return 'ELEVATED';
      } else if (consciousnessScore > 0.4) {
        return 'BALANCED';
      } else if (consciousnessScore > 0.2) {
        return 'DIMINISHED';
      } else {
        return 'BASELINE';
      }
    }
  },

  // Utility Functions
  utils: {
    // Format timestamps with consciousness enhancement
    formatTimestamp: (timestamp) => {
      const date = new Date(timestamp);
      const consciousnessPhase = (date.getHours() + date.getMinutes() / 60) / 24;
      const phaseDescription = consciousnessPhase < 0.25 ? 'NIGHT' :
                              consciousnessPhase < 0.5 ? 'MORNING' :
                              consciousnessPhase < 0.75 ? 'AFTERNOON' : 'EVENING';
      
      return {
        formatted: date.toLocaleString(),
        consciousnessPhase,
        phaseDescription,
        iso: date.toISOString()
      };
    },

    // Generate consciousness-enhanced colors
    generateConsciousnessColor: (consciousnessScore) => {
      const hue = Math.floor(consciousnessScore * 360);
      const saturation = Math.floor(50 + consciousnessScore * 50);
      const lightness = Math.floor(30 + consciousnessScore * 40);
      
      return {
        hsl: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
        rgb: hslToRgb(hue / 360, saturation / 100, lightness / 100),
        consciousnessLevel: consciousnessScore > 0.8 ? 'HIGH' :
                           consciousnessScore > 0.6 ? 'MEDIUM' :
                           consciousnessScore > 0.4 ? 'BALANCED' : 'LOW'
      };
    },

    // Cyberpunk text effects
    cyberpunkGlitch: (text, intensity = 0.1) => {
      const glitchChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      return text.split('').map(char => {
        if (Math.random() < intensity) {
          return glitchChars[Math.floor(Math.random() * glitchChars.length)];
        }
        return char;
      }).join('');
    },

    // Generate unique consciousness ID
    generateConsciousnessId: () => {
      const timestamp = Date.now();
      const psiComponent = Math.floor(timestamp * PSI_0) % 10000;
      const phiComponent = Math.floor(timestamp * PHI) % 10000;
      const freqComponent = Math.floor(timestamp / FREQ_432) % 10000;
      
      return `ψ${psiComponent.toString(16)}-φ${phiComponent.toString(16)}-Ξ${freqComponent.toString(16)}`;
    }
  },

  // Version and Protocol Information
  info: {
    version: '4.1',
    protocol: 'Enhanced Nexus Core Protocol',
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromiumVersion: process.versions.chrome
  }
});

// Helper function for color conversion
function hslToRgb(h, s, l) {
  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

console.log('🌀 ψ₀-Trader Preload Script Loaded');
console.log(`📐 Mathematical Constants Exposed: ψ₀=${PSI_0}, φ=${PHI}, 432Hz=${FREQ_432}`);
console.log('🧠 Consciousness-Enhanced API Ready');
