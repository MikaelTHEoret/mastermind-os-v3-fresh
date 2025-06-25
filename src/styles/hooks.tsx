'use client'
import React, { createContext, useContext, ReactNode, useState } from 'react'
import { MastermindTheme, ComponentStyles, StyleUtils } from './theme'
import { EditorTheme, EditorComponentStyles, EditorUtils } from './editorTheme'

// React hook for accessing theme values
export const useMastermindTheme = () => {
  return {
    theme: MastermindTheme,
    styles: ComponentStyles,
    utils: StyleUtils,
    editor: {
      theme: EditorTheme,
      styles: EditorComponentStyles,
      utils: EditorUtils
    }
  }
}

// Higher-order component for theme injection
export const withMastermindTheme = <P extends object>(
  Component: React.ComponentType<P>
): React.ComponentType<P> => {
  return (props: P) => {
    const themeProps = useMastermindTheme()
    return <Component {...props} {...themeProps} />
  }
}

// Styled component creators
export const createStyledComponent = (baseStyles: any) => 
  (additionalStyles?: any) => StyleUtils.combineStyles(baseStyles, additionalStyles)

// Pre-built styled components
export const StyledComponents = {
  // Button component
  Button: ({ 
    variant = 'primary', 
    size = 'md', 
    children, 
    style = {}, 
    ...props 
  }: {
    variant?: 'primary' | 'secondary' | 'success' | 'danger'
    size?: 'sm' | 'md' | 'lg'
    children: React.ReactNode
    style?: any
    [key: string]: any
  }) => {
    const sizeStyles = {
      sm: { 
        padding: `${MastermindTheme.spacing.sm} ${MastermindTheme.spacing.md}`,
        fontSize: MastermindTheme.fontSizes.sm
      },
      md: { 
        padding: `${MastermindTheme.spacing.md} ${MastermindTheme.spacing.xl}`,
        fontSize: MastermindTheme.fontSizes.base
      },
      lg: { 
        padding: `${MastermindTheme.spacing.lg} ${MastermindTheme.spacing['2xl']}`,
        fontSize: MastermindTheme.fontSizes.md
      }
    }

    const buttonStyle = StyleUtils.combineStyles(
      ComponentStyles.button.base,
      ComponentStyles.button[variant],
      sizeStyles[size],
      style
    )

    return (
      <button style={buttonStyle} {...props}>
        {children}
      </button>
    )
  },

  // Panel component
  Panel: ({ 
    variant = 'base', 
    children, 
    style = {}, 
    ...props 
  }: {
    variant?: 'base' | 'glass'
    children: React.ReactNode
    style?: any
    [key: string]: any
  }) => {
    const panelStyle = StyleUtils.combineStyles(
      ComponentStyles.panel[variant],
      style
    )

    return (
      <div style={panelStyle} {...props}>
        {children}
      </div>
    )
  },

  // Text components
  Heading: ({ 
    level = 1, 
    children, 
    style = {}, 
    glow = true,
    ...props 
  }: {
    level?: 1 | 2 | 3 | 4 | 5 | 6
    children: React.ReactNode
    style?: any
    glow?: boolean
    [key: string]: any
  }) => {
    const sizeMap = {
      1: MastermindTheme.fontSizes['5xl'],
      2: MastermindTheme.fontSizes['4xl'],
      3: MastermindTheme.fontSizes['3xl'],
      4: MastermindTheme.fontSizes['2xl'],
      5: MastermindTheme.fontSizes.xl,
      6: MastermindTheme.fontSizes.lg
    }

    const headingStyle = StyleUtils.combineStyles(
      ComponentStyles.text.heading,
      {
        fontSize: sizeMap[level],
        textShadow: glow ? MastermindTheme.shadows.glow.cyan : 'none'
      },
      style
    )

    const Tag = `h${level}` as keyof JSX.IntrinsicElements

    return (
      <Tag style={headingStyle} {...props}>
        {children}
      </Tag>
    )
  },

  // Text component
  Text: ({ 
    variant = 'body', 
    children, 
    style = {}, 
    ...props 
  }: {
    variant?: 'heading' | 'subheading' | 'body' | 'accent'
    children: React.ReactNode
    style?: any
    [key: string]: any
  }) => {
    const textStyle = StyleUtils.combineStyles(
      ComponentStyles.text[variant],
      style
    )

    return (
      <span style={textStyle} {...props}>
        {children}
      </span>
    )
  },

  // Input component
  Input: ({ 
    style = {}, 
    onFocus,
    onBlur,
    ...props 
  }: {
    style?: any
    onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void
    onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void
    [key: string]: any
  }) => {
    const [focused, setFocused] = useState(false)

    const inputStyle = StyleUtils.combineStyles(
      ComponentStyles.input.base,
      focused ? ComponentStyles.input.focused : {},
      style
    )

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setFocused(true)
      onFocus?.(e)
    }

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setFocused(false)
      onBlur?.(e)
    }

    return (
      <input 
        style={inputStyle} 
        onFocus={handleFocus}
        onBlur={handleBlur}
        {...props} 
      />
    )
  }
}

// Theme provider context (optional for more complex theme switching)
interface ThemeContextType {
  theme: typeof MastermindTheme
  styles: typeof ComponentStyles
  utils: typeof StyleUtils
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export const MastermindThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const value = {
    theme: MastermindTheme,
    styles: ComponentStyles,
    utils: StyleUtils
  }

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useThemeContext = () => {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useThemeContext must be used within a MastermindThemeProvider')
  }
  return context
}

export default useMastermindTheme