// Extended theme for editor-style panels and windows
import { MastermindTheme } from './theme'

export const EditorTheme = {
  // Editor-specific color palette
  editor: {
    background: {
      primary: 'rgba(15, 20, 25, 0.95)',      // Dark blue-black with transparency
      secondary: 'rgba(25, 30, 35, 0.9)',     // Slightly lighter variant
      panel: 'rgba(20, 25, 30, 0.85)',        // Panel background
      sidebar: 'rgba(12, 18, 22, 0.92)',      // Sidebar darker
      overlay: 'rgba(0, 0, 0, 0.6)'           // Modal overlay
    },
    
    border: {
      primary: 'rgba(0, 200, 255, 0.4)',      // Bright cyan borders
      secondary: 'rgba(0, 180, 255, 0.25)',   // Softer cyan
      accent: 'rgba(0, 220, 255, 0.6)',       // Bright accent
      subtle: 'rgba(100, 120, 140, 0.3)',     // Subtle borders
      glow: 'rgba(0, 200, 255, 0.8)'          // Glowing effect
    },

    text: {
      primary: '#e8f4f8',                     // Light blue-white
      secondary: '#b8d4e0',                   // Muted blue-white
      muted: '#8898a8',                       // Darker muted
      accent: '#00d4ff',                      // Bright cyan
      selection: 'rgba(0, 200, 255, 0.2)'    // Text selection
    },

    syntax: {
      keyword: '#5ccfe6',                     // Light cyan
      string: '#bae67e',                      // Light green
      number: '#ffcc66',                      // Golden yellow
      comment: '#5c6773',                     // Muted gray
      function: '#ffb454',                    // Orange
      variable: '#d4bfff'                     // Light purple
    }
  }
}

// Editor-specific component styles
export const EditorComponentStyles = {
  // Main editor window
  editorWindow: {
    base: {
      background: EditorTheme.editor.background.primary,
      border: `1px solid ${EditorTheme.editor.border.primary}`,
      borderRadius: '12px',
      backdropFilter: 'blur(20px)',
      boxShadow: `
        0 0 30px rgba(0, 200, 255, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.1),
        0 8px 32px rgba(0, 0, 0, 0.3)
      `,
      overflow: 'hidden'
    }
  },

  // Side panel (like file explorer)
  sidePanel: {
    base: {
      background: EditorTheme.editor.background.sidebar,
      borderRight: `1px solid ${EditorTheme.editor.border.secondary}`,
      backdropFilter: 'blur(15px)',
      boxShadow: 'inset -1px 0 0 rgba(0, 200, 255, 0.1)'
    }
  },

  // Content area
  contentArea: {
    base: {
      background: EditorTheme.editor.background.panel,
      border: 'none',
      backdropFilter: 'blur(10px)',
      fontFamily: MastermindTheme.fonts.code,
      fontSize: MastermindTheme.fontSizes.md,
      color: EditorTheme.editor.text.primary,
      lineHeight: '1.6'
    }
  },

  // Tab bar
  tabBar: {
    base: {
      background: EditorTheme.editor.background.secondary,
      borderBottom: `1px solid ${EditorTheme.editor.border.subtle}`,
      display: 'flex',
      alignItems: 'center',
      padding: '0',
      minHeight: '40px'
    },

    tab: {
      base: {
        padding: '8px 16px',
        background: 'transparent',
        border: 'none',
        borderRight: `1px solid ${EditorTheme.editor.border.subtle}`,
        color: EditorTheme.editor.text.secondary,
        fontFamily: MastermindTheme.fonts.primary,
        fontSize: MastermindTheme.fontSizes.sm,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      },

      active: {
        background: EditorTheme.editor.background.panel,
        color: EditorTheme.editor.text.primary,
        borderBottom: `2px solid ${EditorTheme.editor.border.accent}`,
        position: 'relative'
      },

      hover: {
        background: 'rgba(0, 200, 255, 0.1)',
        color: EditorTheme.editor.text.primary
      }
    }
  },

  // File tree item
  fileTreeItem: {
    base: {
      padding: '6px 12px',
      color: EditorTheme.editor.text.secondary,
      fontFamily: MastermindTheme.fonts.primary,
      fontSize: MastermindTheme.fontSizes.sm,
      cursor: 'pointer',
      transition: 'all 0.15s ease',
      borderRadius: '4px',
      margin: '1px 4px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },

    hover: {
      background: 'rgba(0, 200, 255, 0.15)',
      color: EditorTheme.editor.text.primary
    },

    selected: {
      background: 'rgba(0, 200, 255, 0.25)',
      color: EditorTheme.editor.text.accent,
      boxShadow: `inset 0 0 0 1px ${EditorTheme.editor.border.accent}`
    }
  },

  // Search/input fields
  editorInput: {
    base: {
      background: 'rgba(0, 0, 0, 0.3)',
      border: `1px solid ${EditorTheme.editor.border.subtle}`,
      borderRadius: '6px',
      padding: '8px 12px',
      color: EditorTheme.editor.text.primary,
      fontFamily: MastermindTheme.fonts.primary,
      fontSize: MastermindTheme.fontSizes.sm,
      transition: 'all 0.2s ease'
    },

    focused: {
      border: `1px solid ${EditorTheme.editor.border.accent}`,
      boxShadow: `0 0 0 2px rgba(0, 200, 255, 0.2)`,
      background: 'rgba(0, 0, 0, 0.5)'
    }
  },

  // Status bar
  statusBar: {
    base: {
      background: EditorTheme.editor.background.secondary,
      borderTop: `1px solid ${EditorTheme.editor.border.subtle}`,
      padding: '8px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontSize: MastermindTheme.fontSizes.xs,
      color: EditorTheme.editor.text.muted
    }
  },

  // Button variants for editor
  editorButton: {
    primary: {
      background: `linear-gradient(135deg, ${EditorTheme.editor.border.accent}, ${EditorTheme.editor.border.primary})`,
      border: `1px solid ${EditorTheme.editor.border.accent}`,
      color: EditorTheme.editor.text.primary,
      padding: '6px 12px',
      borderRadius: '6px',
      fontFamily: MastermindTheme.fonts.primary,
      fontSize: MastermindTheme.fontSizes.sm,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      boxShadow: `0 2px 8px rgba(0, 200, 255, 0.3)`
    },

    secondary: {
      background: 'rgba(0, 200, 255, 0.1)',
      border: `1px solid ${EditorTheme.editor.border.secondary}`,
      color: EditorTheme.editor.text.secondary,
      padding: '6px 12px',
      borderRadius: '6px',
      fontFamily: MastermindTheme.fonts.primary,
      fontSize: MastermindTheme.fontSizes.sm,
      cursor: 'pointer',
      transition: 'all 0.2s ease'
    }
  }
}

// Utility functions for editor styling
export const EditorUtils = {
  // Create editor panel with glow effect
  createEditorPanel: (customStyles = {}) => ({
    ...EditorComponentStyles.editorWindow.base,
    ...customStyles
  }),

  // Create file tree styling
  createFileTree: () => ({
    background: EditorTheme.editor.background.sidebar,
    padding: '8px 0',
    overflowY: 'auto' as const,
    maxHeight: '100%'
  }),

  // Create tab styling
  createTab: (isActive = false, isHovered = false) => ({
    ...EditorComponentStyles.tabBar.tab.base,
    ...(isActive ? EditorComponentStyles.tabBar.tab.active : {}),
    ...(isHovered && !isActive ? EditorComponentStyles.tabBar.tab.hover : {})
  }),

  // Create syntax highlighting
  createSyntaxHighlight: (type: keyof typeof EditorTheme.editor.syntax) => ({
    color: EditorTheme.editor.syntax[type]
  })
}

export default EditorTheme