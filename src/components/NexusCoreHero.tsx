'use client'
// NexusCoreHero — the spinning visual core, recovered from mastermind-os-v3-fresh
// (sections/NexusCoreSection.tsx) and adapted to embed as a Command-view centerpiece.
// Pure CSS/React; uses the existing theme system. The functional Archivist/gate panel
// (NexusCore.tsx) is unchanged and lives alongside this; this is the visual identity only.
import { useState, useEffect } from 'react'
import { getTheme, animations } from '@/lib/theme-config'

export default function NexusCoreHero({ size = 300 }: { size?: number }) {
  const [coreEnergy, setCoreEnergy] = useState(87)
  const [nodes, setNodes] = useState(12)
  const [active, setActive] = useState(true)
  const theme = getTheme('nexus')

  useEffect(() => {
    const t = setInterval(() => {
      setCoreEnergy(p => Math.max(75, Math.min(95, p + (Math.random() - 0.5) * 5)))
      setNodes(p => Math.max(8, Math.min(16, p + Math.floor((Math.random() - 0.5) * 2))))
    }, 3000)
    return () => clearInterval(t)
  }, [])

  const radius = size * 0.46
  const inner = size * 0.22
  const glowHex = Math.floor(coreEnergy).toString(16).padStart(2, '0')

  return (
    <>
      <style>{`${animations.energyPulse}${animations.coreRotate}${animations.pulse}
        @keyframes corePulseHero { 0%,100%{transform:translate(-50%,-50%) scale(1);opacity:1} 50%{transform:translate(-50%,-50%) scale(1.2);opacity:.8} }
        @keyframes nodePulseHero { 0%,100%{opacity:.6} 50%{opacity:1} }`}</style>

      <div style={{ width: '100%', minHeight: size + 56, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', padding: '12px 0' }}>

        <div style={{ position: 'absolute', inset: 0, background:
          `radial-gradient(ellipse at 30% 40%, ${theme.primaryColor}20 0%, transparent 50%),
           radial-gradient(ellipse at 70% 60%, ${theme.secondaryColor}20 0%, transparent 50%),
           radial-gradient(ellipse at 50% 50%, ${theme.accentColor}10 0%, transparent 70%)`,
          animation: 'energyPulse 6s ease-in-out infinite', pointerEvents: 'none' }} />

        <div onClick={() => setActive(a => !a)} style={{ width: size, height: size, borderRadius: '50%',
          background: `radial-gradient(circle at center, ${theme.primaryColor}60 0%, ${theme.secondaryColor}50 30%, ${theme.accentColor}40 60%, transparent 80%)`,
          border: `3px solid ${theme.primaryColor}`, position: 'relative', cursor: 'pointer', flexShrink: 0,
          animation: 'coreRotate 20s linear infinite',
          boxShadow: `0 0 60px ${theme.primaryColor}${glowHex}, inset 0 0 40px ${theme.secondaryColor}50` }}>

          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            width: inner, height: inner, borderRadius: '50%', animation: 'coreRotate 15s linear infinite reverse',
            background: `radial-gradient(circle, rgba(255,255,255,.9) 0%, ${theme.primaryColor}80 30%, ${theme.secondaryColor}60 70%, ${theme.accentColor}40 100%)`,
            boxShadow: `0 0 40px rgba(255,255,255,${active ? 0.8 : 0.4})` }}>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              width: size * 0.075, height: size * 0.075, borderRadius: '50%', background: '#fff',
              boxShadow: '0 0 20px rgba(255,255,255,1)', animation: 'corePulseHero 2s ease-in-out infinite' }} />
          </div>

          {[...Array(nodes)].map((_, i) => {
            const a = (360 / nodes) * i
            const x = Math.round(Math.cos((a * Math.PI) / 180) * radius * 100) / 100
            const y = Math.round(Math.sin((a * Math.PI) / 180) * radius * 100) / 100
            return <div key={i} style={{ position: 'absolute', top: '50%', left: '50%',
              transform: `translate(${x}px, ${y}px)`, width: 11, height: 11, borderRadius: '50%',
              background: theme.primaryColor, boxShadow: `0 0 14px ${theme.primaryColor}`,
              animation: `nodePulseHero ${2 + i * 0.2}s ease-in-out infinite` }} />
          })}
          {[...Array(nodes)].map((_, i) => (
            <div key={`l${i}`} style={{ position: 'absolute', top: '50%', left: '50%', width: 1, height: radius,
              background: `linear-gradient(transparent, ${theme.primaryColor}50, transparent)`,
              transformOrigin: 'top center', transform: `rotate(${(360 / nodes) * i}deg)`,
              opacity: active ? 0.6 : 0.2, transition: 'opacity .5s ease' }} />
          ))}
        </div>

        <div style={{ marginTop: 14, textAlign: 'center', position: 'relative', zIndex: 2 }}>
          <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 13, letterSpacing: 3,
            color: theme.primaryColor, textShadow: `0 0 10px ${theme.primaryColor}80` }}>NEXUS CORE</div>
          <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 11, color: theme.secondaryColor,
            opacity: 0.85, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#00ffaa',
              boxShadow: '0 0 8px #00ffaa' }} />perceive · decide · persist
          </div>
        </div>
      </div>
    </>
  )
}
