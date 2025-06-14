// Clerk Configuration - MasterMind OS Cyberpunk Theme
// Enhanced Nexus Core Protocol v3.0

export const clerkAppearance = {
  variables: {
    // Color scheme - Cyberpunk colors
    colorPrimary: '#00ffff',
    colorDanger: '#ff4444',
    colorSuccess: '#00ffaa',
    colorWarning: '#ffd700',
    colorNeutral: '#888888',
    
    // Background colors
    colorBackground: 'rgba(10, 5, 30, 0.95)',
    colorInputBackground: 'rgba(0, 255, 255, 0.1)',
    colorInputText: '#00ffff',
    
    // Border and spacing
    borderRadius: '15px',
    spacingUnit: '1rem',
    
    // Typography
    fontFamily: '"Orbitron", "Rajdhani", monospace',
    fontFamilyButtons: '"Orbitron", monospace',
    fontSize: '14px',
    fontWeight: {
      normal: 400,
      medium: 600,
      bold: 700,
    }
  },
  elements: {
    // Modal and card styling
    modalContent: {
      background: 'linear-gradient(145deg, rgba(10, 5, 30, 0.98) 0%, rgba(20, 10, 40, 0.98) 100%)',
      border: '2px solid rgba(0, 255, 255, 0.4)',
      borderRadius: '20px',
      backdropFilter: 'blur(20px)',
      boxShadow: '0 0 50px rgba(0, 255, 255, 0.3), inset 0 0 20px rgba(0, 255, 255, 0.1)',
      color: '#00ffff'
    },
    modalCloseButton: {
      color: '#ff4444',
      background: 'rgba(255, 68, 68, 0.2)',
      border: '1px solid rgba(255, 68, 68, 0.3)',
      borderRadius: '50%',
      width: '32px',
      height: '32px',
      '&:hover': {
        background: 'rgba(255, 68, 68, 0.4)',
        boxShadow: '0 0 12px rgba(255, 68, 68, 0.5)'
      }
    },
    
    // Form elements
    card: {
      background: 'linear-gradient(145deg, rgba(10, 5, 30, 0.95) 0%, rgba(20, 10, 40, 0.95) 100%)',
      border: '2px solid rgba(0, 255, 255, 0.4)',
      borderRadius: '20px',
      backdropFilter: 'blur(20px)',
      boxShadow: '0 0 30px rgba(0, 255, 255, 0.2)'
    },
    headerTitle: {
      color: '#00ffff',
      fontFamily: '"Orbitron", monospace',
      fontSize: '24px',
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: '20px'
    },
    headerSubtitle: {
      color: '#888',
      fontFamily: '"Rajdhani", sans-serif',
      fontSize: '16px',
      textAlign: 'center'
    },
    
    // Input fields
    formFieldInput: {
      background: 'rgba(0, 255, 255, 0.1)',
      border: '1px solid rgba(0, 255, 255, 0.3)',
      borderRadius: '12px',
      color: '#00ffff',
      padding: '12px 16px',
      fontSize: '14px',
      fontFamily: '"Rajdhani", sans-serif',
      '&:focus': {
        borderColor: 'rgba(0, 255, 255, 0.6)',
        boxShadow: '0 0 12px rgba(0, 255, 255, 0.3)',
        outline: 'none'
      },
      '&::placeholder': {
        color: 'rgba(0, 255, 255, 0.5)'
      }
    },
    formFieldLabel: {
      color: '#00ffff',
      fontFamily: '"Rajdhani", sans-serif',
      fontSize: '14px',
      fontWeight: '600',
      marginBottom: '8px'
    },
    
    // Buttons
    formButtonPrimary: {
      background: 'linear-gradient(45deg, rgba(0, 255, 255, 0.3), rgba(255, 0, 255, 0.3))',
      border: '2px solid rgba(0, 255, 255, 0.5)',
      borderRadius: '25px',
      color: '#00ffff',
      fontSize: '14px',
      fontWeight: '600',
      fontFamily: '"Orbitron", monospace',
      padding: '12px 24px',
      textTransform: 'uppercase',
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      '&:hover': {
        background: 'linear-gradient(45deg, rgba(0, 255, 255, 0.5), rgba(255, 0, 255, 0.5))',
        boxShadow: '0 0 20px rgba(0, 255, 255, 0.5)',
        transform: 'translateY(-2px)'
      },
      '&:focus': {
        outline: 'none',
        boxShadow: '0 0 20px rgba(0, 255, 255, 0.7)'
      }
    },
    formButtonSecondary: {
      background: 'rgba(136, 136, 136, 0.2)',
      border: '1px solid rgba(136, 136, 136, 0.4)',
      borderRadius: '15px',
      color: '#888',
      fontSize: '14px',
      fontFamily: '"Rajdhani", sans-serif',
      padding: '10px 20px',
      '&:hover': {
        background: 'rgba(136, 136, 136, 0.3)',
        color: '#aaa'
      }
    },
    
    // UserButton styling
    userButtonBox: {
      width: '36px',
      height: '36px'
    },
    userButtonAvatarBox: {
      width: '32px',
      height: '32px',
      border: '2px solid rgba(0, 255, 255, 0.4)',
      borderRadius: '50%'
    },
    userButtonPopoverCard: {
      background: 'linear-gradient(145deg, rgba(10, 5, 30, 0.98) 0%, rgba(20, 10, 40, 0.98) 100%)',
      border: '2px solid rgba(0, 255, 255, 0.4)',
      borderRadius: '15px',
      backdropFilter: 'blur(20px)',
      boxShadow: '0 0 30px rgba(0, 255, 255, 0.3)',
      padding: '15px'
    },
    userButtonPopoverActionButton: {
      color: '#00ffff',
      background: 'rgba(0, 255, 255, 0.1)',
      border: '1px solid rgba(0, 255, 255, 0.3)',
      borderRadius: '10px',
      padding: '10px 15px',
      fontSize: '13px',
      fontFamily: '"Rajdhani", sans-serif',
      margin: '3px 0',
      '&:hover': {
        background: 'rgba(0, 255, 255, 0.2)',
        boxShadow: '0 0 12px rgba(0, 255, 255, 0.4)',
        transform: 'translateX(3px)'
      }
    },
    userButtonPopoverActionButtonText: {
      color: '#00ffff'
    },
    userButtonPopoverActionButtonIcon: {
      color: '#00ffff'
    },
    
    // User profile modal (dashboard)
    userProfileModal: {
      background: 'linear-gradient(145deg, rgba(10, 5, 30, 0.98) 0%, rgba(20, 10, 40, 0.98) 100%)',
      border: '2px solid rgba(0, 255, 255, 0.4)',
      borderRadius: '20px',
      backdropFilter: 'blur(20px)',
      boxShadow: '0 0 50px rgba(0, 255, 255, 0.3)'
    },
    userProfile: {
      background: 'linear-gradient(145deg, rgba(10, 5, 30, 0.98) 0%, rgba(20, 10, 40, 0.98) 100%)',
      color: '#00ffff'
    },
    profileSectionTitle: {
      color: '#00ffff',
      fontFamily: '"Orbitron", monospace',
      fontSize: '18px',
      fontWeight: '700',
      borderBottom: '1px solid rgba(0, 255, 255, 0.3)',
      paddingBottom: '10px',
      marginBottom: '15px'
    },
    profileSectionContent: {
      background: 'rgba(0, 255, 255, 0.05)',
      border: '1px solid rgba(0, 255, 255, 0.2)',
      borderRadius: '12px',
      padding: '15px'
    },
    
    // Links and text
    link: {
      color: '#00ffff',
      textDecoration: 'none',
      '&:hover': {
        color: '#00ffaa',
        textShadow: '0 0 8px rgba(0, 255, 170, 0.5)'
      }
    },
    text: {
      color: '#00ffff',
      fontFamily: '"Rajdhani", sans-serif'
    },
    
    // Footer
    footer: {
      background: 'rgba(0, 0, 0, 0.3)',
      borderTop: '1px solid rgba(0, 255, 255, 0.2)',
      color: '#888'
    },
    footerActionText: {
      color: '#888'
    },
    footerActionLink: {
      color: '#00ffff',
      '&:hover': {
        color: '#00ffaa'
      }
    },
    
    // Dividers and separators
    dividerLine: {
      background: 'rgba(0, 255, 255, 0.3)',
      height: '1px'
    },
    dividerText: {
      color: '#888',
      fontSize: '12px'
    },
    
    // Alert and error messages
    alertText: {
      color: '#ff4444',
      fontSize: '13px',
      fontFamily: '"Rajdhani", sans-serif'
    },
    
    // Loading states
    spinner: {
      color: '#00ffff',
      width: '20px',
      height: '20px'
    },
    
    // Form validation
    formFieldInputShowPasswordButton: {
      color: '#888',
      '&:hover': {
        color: '#00ffff'
      }
    },
    formFieldSuccessText: {
      color: '#00ffaa'
    },
    formFieldErrorText: {
      color: '#ff4444'
    },
    formFieldWarningText: {
      color: '#ffd700'
    }
  }
}

// Environment configuration helper
export function getClerkConfig() {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  const secretKey = process.env.CLERK_SECRET_KEY
  
  if (!publishableKey) {
    throw new Error('Missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY')
  }
  
  return {
    publishableKey,
    secretKey,
    appearance: clerkAppearance
  }
}