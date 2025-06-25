'use client'
import React from 'react'

export default function StackAuthProvider({ children }: { children: React.ReactNode }) {
  // SSR-safe auth provider - no Stack Auth dependencies for build compatibility
  return <>{children}</>
}