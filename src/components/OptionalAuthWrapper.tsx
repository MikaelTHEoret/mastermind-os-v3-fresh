'use client'
import React from 'react'

export default function OptionalAuthWrapper({ children }: { children: React.ReactNode }) {
  // SSR-safe auth wrapper - no authentication dependencies for build compatibility
  return <>{children}</>
}