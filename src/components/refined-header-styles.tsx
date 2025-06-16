// Refined Header Styles - Balanced Intensity
export const refinedHeaderStyles = {
  header: {
    height: '64px',
    background: 'rgba(0, 0, 0, 0.6)', // More transparent
    border: '1px solid rgba(0, 255, 255, 0.3)', // Thinner, subtle border
    borderBottom: '1px solid rgba(0, 255, 255, 0.4)', // Subtle accent
    boxShadow: '0 2px 20px rgba(0, 255, 255, 0.2)', // Softer glow
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    position: 'relative' as const,
    zIndex: 20,
    backdropFilter: 'blur(8px)', // Add sophistication
  },
  
  navigationButton: {
    inactive: {
      padding: '6px 12px', // Slightly smaller
      border: '1px solid transparent',
      background: 'transparent',
      color: 'rgba(0, 255, 255, 0.7)', // Softer text
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '11px',
      fontFamily: 'Orbitron, monospace',
      fontWeight: '500', // Less bold
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      transition: 'all 0.3s ease',
      textTransform: 'uppercase' as const,
      position: 'relative' as const,
    },
    
    active: {
      border: '1px solid rgba(0, 255, 255, 0.6)', // Subtle active border
      background: 'rgba(0, 255, 255, 0.1)', // Very subtle background
      color: '#00ffff',
      boxShadow: '0 0 10px rgba(0, 255, 255, 0.3)', // Gentle glow
    },
    
    hover: {
      background: 'rgba(0, 255, 255, 0.08)',
      border: '1px solid rgba(0, 255, 255, 0.4)',
      color: '#00ffff',
      boxShadow: '0 0 8px rgba(0, 255, 255, 0.25)',
    }
  }
}

// Content Panel Styles - Strategic Information Layout
export const refinedPanelStyles = {
  // Primary content containers
  primaryPanel: {
    background: 'rgba(0, 0, 0, 0.4)', // More transparent
    border: '1px solid rgba(0, 255, 255, 0.25)', // Subtle border
    borderRadius: '8px',
    padding: '20px',
    backdropFilter: 'blur(12px)',
    boxShadow: '0 4px 25px rgba(0, 0, 0, 0.3)',
  },
  
  // Secondary information panels (like your HUD references)
  infoPanel: {
    background: 'rgba(0, 20, 40, 0.6)', // Dark blue tint
    border: '1px solid rgba(0, 255, 255, 0.2)',
    borderRadius: '6px',
    padding: '12px',
    backdropFilter: 'blur(8px)',
  },
  
  // Highlight panels for important info
  accentPanel: {
    background: 'linear-gradient(135deg, rgba(0, 255, 255, 0.1), rgba(255, 0, 255, 0.05))',
    border: '1px solid rgba(0, 255, 255, 0.4)',
    borderRadius: '8px',
    padding: '16px',
    boxShadow: '0 0 15px rgba(0, 255, 255, 0.2)', // Strategic glow
  },
  
  // Input field styles
  input: {
    background: 'rgba(0, 20, 40, 0.8)',
    border: '1px solid rgba(0, 255, 255, 0.3)',
    borderRadius: '4px',
    padding: '8px 12px',
    color: '#00ffff',
    fontSize: '14px',
    fontFamily: 'Rajdhani, sans-serif',
    
    focus: {
      border: '1px solid rgba(0, 255, 255, 0.6)',
      boxShadow: '0 0 8px rgba(0, 255, 255, 0.3)',
      outline: 'none',
    }
  },
  
  // Button refinements
  button: {
    primary: {
      background: 'linear-gradient(135deg, rgba(0, 255, 255, 0.2), rgba(0, 255, 255, 0.1))',
      border: '1px solid rgba(0, 255, 255, 0.5)',
      color: '#00ffff',
      padding: '8px 16px',
      borderRadius: '6px',
      fontSize: '13px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      
      hover: {
        background: 'linear-gradient(135deg, rgba(0, 255, 255, 0.3), rgba(0, 255, 255, 0.15))',
        boxShadow: '0 0 12px rgba(0, 255, 255, 0.4)',
        transform: 'translateY(-1px)',
      }
    }
  }
}

// Typography Refinements
export const refinedTypography = {
  title: {
    fontSize: '28px', // Slightly smaller
    fontWeight: '600', // Less bold
    color: '#00ffff',
    fontFamily: 'Orbitron, monospace',
    textShadow: '0 0 20px rgba(0, 255, 255, 0.5)', // Softer glow
    marginBottom: '12px',
  },
  
  subtitle: {
    fontSize: '14px',
    color: 'rgba(0, 255, 255, 0.8)',
    fontFamily: 'Rajdhani, sans-serif',
    fontWeight: '400',
    marginBottom: '8px',
  },
  
  bodyText: {
    fontSize: '13px',
    color: 'rgba(255, 255, 255, 0.9)',
    fontFamily: 'Rajdhani, sans-serif',
    lineHeight: '1.5',
  },
  
  monospace: {
    fontFamily: 'Courier New, monospace',
    fontSize: '12px',
    color: 'rgba(0, 255, 255, 0.7)',
  }
}

// Information Hierarchy Layout (like your HUD references)
export const hudLayoutStyles = {
  // Three-column layout for organized information
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 2fr 1fr', // Left sidebar, main content, right sidebar
    gap: '16px',
    height: '100%',
    padding: '16px',
  },
  
  // Status indicators
  statusBar: {
    display: 'flex',
    gap: '12px',
    padding: '8px 12px',
    background: 'rgba(0, 0, 0, 0.5)',
    border: '1px solid rgba(0, 255, 255, 0.2)',
    borderRadius: '20px', // Pill shape like in references
    fontSize: '11px',
    color: 'rgba(0, 255, 255, 0.8)',
  },
  
  // Metric cards (like your analytics reference)
  metricCard: {
    background: 'rgba(0, 20, 40, 0.6)',
    border: '1px solid rgba(0, 255, 255, 0.25)',
    borderRadius: '8px',
    padding: '12px',
    textAlign: 'center' as const,
    
    value: {
      fontSize: '24px',
      fontWeight: '600',
      color: '#00ffff',
      fontFamily: 'Orbitron, monospace',
    },
    
    label: {
      fontSize: '11px',
      color: 'rgba(255, 255, 255, 0.7)',
      textTransform: 'uppercase' as const,
      marginTop: '4px',
    }
  },
  
  // Progress indicators
  progressBar: {
    background: 'rgba(0, 0, 0, 0.6)',
    borderRadius: '10px',
    height: '6px',
    overflow: 'hidden',
    
    fill: {
      background: 'linear-gradient(90deg, #00ffff, #ff00ff)',
      height: '100%',
      borderRadius: '10px',
      transition: 'width 0.5s ease',
    }
  }
}
