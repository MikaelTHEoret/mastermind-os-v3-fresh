// src/lib/clerk-config.ts
// Enhanced Cyberpunk Theming for Clerk Authentication

export const clerkAppearance = {
  baseTheme: undefined,
  variables: {
    // Color Palette - Cyberpunk Dark Theme
    colorPrimary: '#00ffff',           // Electric cyan primary
    colorPrimaryText: '#000000',       // Black text on cyan buttons
    colorBackground: '#0f0322',        // Deep purple background
    colorInputBackground: '#1a0b3d',   // Dark purple inputs
    colorInputText: '#ffffff',         // White input text
    colorText: '#ffffff',              // White primary text
    colorTextSecondary: '#b0c4de',     // Light blue secondary text
    colorSuccess: '#00ffaa',           // Neon green success
    colorDanger: '#ff4444',            // Red danger/error
    colorWarning: '#ffd700',           // Gold warning
    colorNeutral: '#666666',           // Gray neutral
    
    // Spacing and Layout
    spacingUnit: '1rem',
    borderRadius: '0.75rem',           // Rounded corners
    
    // Typography
    fontFamily: '"Orbitron", "Rajdhani", monospace',
    fontWeight: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    fontSize: {
      xs: '0.75rem',
      sm: '0.875rem',
      base: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
    },
  },
  elements: {
    // Main Modal Container
    modalContent: {
      background: 'linear-gradient(135deg, #0f0322 0%, #1a0b3d 50%, #2d1b69 100%)',
      border: '2px solid #00ffff',
      borderRadius: '1rem',
      boxShadow: '0 0 50px rgba(0, 255, 255, 0.3), inset 0 0 20px rgba(0, 255, 255, 0.1)',
      backdropFilter: 'blur(20px)',
      color: '#ffffff',
    },
    
    // Modal Backdrop
    modalBackdrop: {
      background: 'rgba(15, 3, 34, 0.95)',
      backdropFilter: 'blur(10px)',
    },
    
    // Header/Title Styling
    headerTitle: {
      color: '#00ffff',
      fontFamily: '"Orbitron", monospace',
      fontSize: '1.75rem',
      fontWeight: '700',
      textShadow: '0 0 10px rgba(0, 255, 255, 0.8)',
      marginBottom: '1.5rem',
    },
    
    headerSubtitle: {
      color: '#b0c4de',
      fontFamily: '"Rajdhani", sans-serif',
      fontSize: '1rem',
      marginBottom: '1rem',
    },
    
    // Form Elements
    formButtonPrimary: {
      background: 'linear-gradient(135deg, #00ffff 0%, #0099cc 100%)',
      color: '#000000',
      border: 'none',
      borderRadius: '0.75rem',
      padding: '0.875rem 2rem',
      fontSize: '1rem',
      fontWeight: '600',
      fontFamily: '"Orbitron", monospace',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      boxShadow: '0 4px 15px rgba(0, 255, 255, 0.4)',
      '&:hover': {
        background: 'linear-gradient(135deg, #00ccff 0%, #0077aa 100%)',
        boxShadow: '0 6px 25px rgba(0, 255, 255, 0.6)',
        transform: 'translateY(-2px)',
      },
      '&:active': {
        transform: 'translateY(0)',
      },
    },
    
    formButtonSecondary: {
      background: 'transparent',
      color: '#00ffff',
      border: '2px solid #00ffff',
      borderRadius: '0.75rem',
      padding: '0.875rem 2rem',
      fontSize: '1rem',
      fontWeight: '600',
      fontFamily: '"Orbitron", monospace',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      '&:hover': {
        background: 'rgba(0, 255, 255, 0.1)',
        boxShadow: '0 0 20px rgba(0, 255, 255, 0.5)',
      },
    },
    
    // Input Fields
    formFieldInput: {
      background: 'rgba(26, 11, 61, 0.8)',
      border: '2px solid #4a5568',
      borderRadius: '0.75rem',
      color: '#ffffff',
      padding: '1rem 1.25rem',
      fontSize: '1rem',
      fontFamily: '"Rajdhani", sans-serif',
      transition: 'all 0.3s ease',
      '&:focus': {
        outline: 'none',
        borderColor: '#00ffff',
        boxShadow: '0 0 0 3px rgba(0, 255, 255, 0.2), 0 0 15px rgba(0, 255, 255, 0.3)',
        background: 'rgba(26, 11, 61, 1)',
      },
      '&::placeholder': {
        color: '#9ca3af',
      },
    },
    
    // Input Labels
    formFieldLabel: {
      color: '#00ffff',
      fontSize: '0.875rem',
      fontWeight: '600',
      fontFamily: '"Orbitron", monospace',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      marginBottom: '0.5rem',
    },
    
    // Error Messages
    formFieldErrorText: {
      color: '#ff4444',
      fontSize: '0.875rem',
      fontFamily: '"Rajdhani", sans-serif',
      marginTop: '0.5rem',
    },
    
    // Links
    formFieldAction: {
      color: '#00ffff',
      textDecoration: 'none',
      fontSize: '0.875rem',
      fontFamily: '"Rajdhani", sans-serif',
      transition: 'all 0.3s ease',
      '&:hover': {
        color: '#00ccff',
        textShadow: '0 0 5px rgba(0, 255, 255, 0.8)',
      },
    },
    
    // Social Buttons (OAuth)
    socialButtonsBlockButton: {
      background: 'rgba(26, 11, 61, 0.8)',
      border: '2px solid #4a5568',
      borderRadius: '0.75rem',
      color: '#ffffff',
      padding: '0.875rem 1.5rem',
      fontSize: '1rem',
      fontFamily: '"Rajdhani", sans-serif',
      transition: 'all 0.3s ease',
      '&:hover': {
        borderColor: '#00ffff',
        background: 'rgba(26, 11, 61, 1)',
        boxShadow: '0 0 15px rgba(0, 255, 255, 0.3)',
      },
    },
    
    // Footer
    footer: {
      background: 'transparent',
      borderTop: '1px solid rgba(0, 255, 255, 0.2)',
      paddingTop: '1.5rem',
      marginTop: '2rem',
    },
    
    footerActionText: {
      color: '#b0c4de',
      fontSize: '0.875rem',
      fontFamily: '"Rajdhani", sans-serif',
    },
    
    footerActionLink: {
      color: '#00ffff',
      textDecoration: 'none',
      fontWeight: '600',
      transition: 'all 0.3s ease',
      '&:hover': {
        color: '#00ccff',
        textShadow: '0 0 5px rgba(0, 255, 255, 0.8)',
      },
    },
    
    // Divider
    dividerLine: {
      background: 'rgba(0, 255, 255, 0.3)',
      height: '1px',
    },
    
    dividerText: {
      color: '#b0c4de',
      fontSize: '0.875rem',
      fontFamily: '"Rajdhani", sans-serif',
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
    },
    
    // User Button (when signed in)
    userButtonAvatarBox: {
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      border: '2px solid #00ffff',
      boxShadow: '0 0 15px rgba(0, 255, 255, 0.5)',
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      '&:hover': {
        boxShadow: '0 0 25px rgba(0, 255, 255, 0.8)',
        transform: 'scale(1.05)',
      },
    },
    
    // User Button Popover
    userButtonPopoverCard: {
      background: 'linear-gradient(135deg, #0f0322 0%, #1a0b3d 50%, #2d1b69 100%)',
      border: '2px solid #00ffff',
      borderRadius: '1rem',
      boxShadow: '0 0 30px rgba(0, 255, 255, 0.4), inset 0 0 20px rgba(0, 255, 255, 0.1)',
      backdropFilter: 'blur(20px)',
      color: '#ffffff',
      padding: '1.5rem',
    },
    
    userButtonPopoverActionButton: {
      background: 'rgba(26, 11, 61, 0.6)',
      border: '1px solid rgba(0, 255, 255, 0.3)',
      borderRadius: '0.5rem',
      color: '#ffffff',
      padding: '0.75rem 1rem',
      fontSize: '0.875rem',
      fontFamily: '"Rajdhani", sans-serif',
      width: '100%',
      textAlign: 'left',
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      marginBottom: '0.5rem',
      '&:hover': {
        background: 'rgba(0, 255, 255, 0.1)',
        borderColor: '#00ffff',
        boxShadow: '0 0 10px rgba(0, 255, 255, 0.3)',
      },
    },
    
    // Profile Page (when clicking "Manage account")
    profilePage: {
      background: 'linear-gradient(135deg, #0f0322 0%, #1a0b3d 50%, #2d1b69 100%)',
      color: '#ffffff',
      fontFamily: '"Rajdhani", sans-serif',
    },
    
    profileSectionTitle: {
      color: '#00ffff',
      fontFamily: '"Orbitron", monospace',
      fontSize: '1.5rem',
      fontWeight: '700',
      textShadow: '0 0 10px rgba(0, 255, 255, 0.8)',
      marginBottom: '1rem',
    },
    
    // Navigation in Profile
    navbar: {
      background: 'rgba(26, 11, 61, 0.8)',
      border: '1px solid rgba(0, 255, 255, 0.3)',
      borderRadius: '0.75rem',
    },
    
    navbarButton: {
      color: '#ffffff',
      fontFamily: '"Rajdhani", sans-serif',
      padding: '0.75rem 1rem',
      borderRadius: '0.5rem',
      transition: 'all 0.3s ease',
      '&:hover': {
        background: 'rgba(0, 255, 255, 0.1)',
        color: '#00ffff',
      },
      '&[data-active]': {
        background: 'rgba(0, 255, 255, 0.2)',
        color: '#00ffff',
        fontWeight: '600',
      },
    },
    
    // Cards in Profile
    card: {
      background: 'rgba(26, 11, 61, 0.6)',
      border: '1px solid rgba(0, 255, 255, 0.3)',
      borderRadius: '0.75rem',
      padding: '1.5rem',
      marginBottom: '1rem',
      boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3)',
    },
  },
  layout: {
    socialButtonsPlacement: 'bottom' as const,
    socialButtonsVariant: 'blockButton' as const,
    logoPlacement: 'inside' as const,
  },
};

// User Button styling for the main app
export const userButtonAppearance = {
  elements: {
    userButtonAvatarBox: 'border-2 border-cyan-400 rounded-full shadow-lg shadow-cyan-500/50 hover:shadow-cyan-500/80 hover:scale-105 transition-all duration-300',
    userButtonPopoverCard: 'bg-gradient-to-br from-indigo-950 via-purple-900 to-purple-950 border-2 border-cyan-400 rounded-xl shadow-2xl shadow-cyan-500/30 backdrop-blur-xl',
    userButtonPopoverActionButton: 'text-white hover:bg-cyan-500/20 hover:text-cyan-300 rounded-lg transition-all duration-200 font-rajdhani',
    userButtonPopoverActionButtonIcon: 'text-cyan-400',
    userButtonPopoverFooter: 'border-t border-cyan-500/30 pt-4 mt-4',
  },
};
