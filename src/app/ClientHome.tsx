'use client'
import { useState, useEffect } from 'react'

export default function ClientHome() {
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(true) }, [])
  if (!ready) return null
  return null  // Dashboard page.tsx handles everything
}
