"use client"

import { useState, useEffect } from 'react'
import { Settings, Copy, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react'

export default function AuthSetupHelper() {
  const [showSetup, setShowSetup] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [hasEnvVars, setHasEnvVars] = useState(false)

  // Check if environment variables are configured
  useEffect(() => {
    const publicKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    setHasEnvVars(!!publicKey && publicKey !== 'your_publishable_key_here')
  }, [])

  const envVars = [
    {
      name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
      value: 'pk_test_cHJpbWFyeS1rYW5nYXJvby01MS5jbGVyay5hY2NvdW50cy5kZXYk',
      description: 'Clerk publishable key (safe for client-side)'
    },
    {
      name: 'CLERK_SECRET_KEY', 
      value: 'sk_test_tMkstZauUBT7doefmbAhuYhrrCr6VjIjNeGThb7dCS',
      description: 'Clerk secret key (server-side only, keep secure)'
    }
  ]

  const copyToClipboard = async (text: string, name: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(name)
    setTimeout(() => setCopied(null), 2000)
  }

  if (hasEnvVars) {
    return null // Don't show setup helper if environment is already configured
  }

  return (
    <>
      {/* Setup Button */}
      <button
        onClick={() => setShowSetup(true)}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          background: 'linear-gradient(45deg, rgba(255, 215, 0, 0.3), rgba(255, 165, 0, 0.3))',
          border: '2px solid rgba(255, 215, 0, 0.5)',
          borderRadius: '50%',
          width: '60px',
          height: '60px',
          color: '#ffd700',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          zIndex: 1000,
          backdropFilter: 'blur(10px)',
          boxShadow: '0 0 20px rgba(255, 215, 0, 0.3)',
          transition: 'all 0.3s ease'
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.transform = 'scale(1.1)'
          e.currentTarget.style.boxShadow = '0 0 30px rgba(255, 215, 0, 0.5)'
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.boxShadow = '0 0 20px rgba(255, 215, 0, 0.3)'
        }}
        title="Setup Authentication"
      >
        <Settings style={{ width: '24px', height: '24px' }} />
      </button>

      {/* Setup Modal */}
      {showSetup && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000,
          backdropFilter: 'blur(10px)'
        }}>
          <div style={{
            background: 'linear-gradient(145deg, rgba(10, 5, 30, 0.98) 0%, rgba(20, 10, 40, 0.98) 100%)',
            border: '2px solid rgba(255, 215, 0, 0.4)',
            borderRadius: '20px',
            padding: '30px',
            maxWidth: '800px',
            width: '90%',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 0 50px rgba(255, 215, 0, 0.3)',
            maxHeight: '90vh',
            overflowY: 'auto',
            color: '#ffd700'
          }}>
            {/* Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '25px',
              borderBottom: '1px solid rgba(255, 215, 0, 0.3)',
              paddingBottom: '15px'
            }}>
              <div style={{
                fontFamily: 'Orbitron, monospace',
                fontSize: '20px',
                fontWeight: '700',
                color: '#ffd700',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <Settings style={{ width: '24px', height: '24px' }} />
                Authentication Setup
              </div>
              <button
                onClick={() => setShowSetup(false)}
                style={{
                  background: 'rgba(255, 68, 68, 0.2)',
                  border: '1px solid rgba(255, 68, 68, 0.3)',
                  borderRadius: '50%',
                  width: '30px',
                  height: '30px',
                  color: '#ff4444',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                ❌
              </button>
            </div>

            {/* Status Alert */}
            <div style={{
              background: 'rgba(255, 215, 0, 0.1)',
              border: '1px solid rgba(255, 215, 0, 0.3)',
              borderRadius: '12px',
              padding: '15px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              <AlertCircle style={{ width: '20px', height: '20px', color: '#ffd700' }} />
              <div>
                <div style={{ fontWeight: '600', fontSize: '14px' }}>
                  Authentication Not Configured
                </div>
                <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
                  Add environment variables to enable full authentication features
                </div>
              </div>
            </div>

            {/* Instructions */}
            <div style={{ marginBottom: '25px' }}>
              <h3 style={{ color: '#ffd700', fontSize: '18px', fontFamily: 'Orbitron, monospace', marginBottom: '15px' }}>
                🚀 Quick Setup Instructions
              </h3>
              <div style={{ fontSize: '14px', lineHeight: '1.6', color: '#00ffff', fontFamily: 'Rajdhani, sans-serif' }}>
                <p style={{ marginBottom: '10px' }}>
                  <strong>For Vercel Deployment:</strong>
                </p>
                <ol style={{ paddingLeft: '20px', marginBottom: '15px' }}>
                  <li>Go to your Vercel project dashboard</li>
                  <li>Navigate to <strong>Settings → Environment Variables</strong></li>
                  <li>Add the variables below for <strong>Production</strong> environment</li>
                  <li>Redeploy your application</li>
                </ol>
                
                <p style={{ marginBottom: '10px' }}>
                  <strong>For Local Development:</strong>
                </p>
                <ol style={{ paddingLeft: '20px' }}>
                  <li>Create a <code>.env.local</code> file in your project root</li>
                  <li>Add the variables below to the file</li>
                  <li>Restart your development server</li>
                </ol>
              </div>
            </div>

            {/* Environment Variables */}
            <div style={{ marginBottom: '25px' }}>
              <h3 style={{ color: '#ffd700', fontSize: '16px', fontFamily: 'Orbitron, monospace', marginBottom: '15px' }}>
                📋 Environment Variables
              </h3>
              
              {envVars.map((envVar, index) => (
                <div key={index} style={{
                  background: 'rgba(0, 255, 255, 0.1)',
                  border: '1px solid rgba(0, 255, 255, 0.3)',
                  borderRadius: '12px',
                  padding: '15px',
                  marginBottom: '15px'
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px'
                  }}>
                    <div style={{
                      fontFamily: 'Courier New, monospace',
                      fontSize: '14px',
                      fontWeight: '600',
                      color: '#00ffff'
                    }}>
                      {envVar.name}
                    </div>
                    <button
                      onClick={() => copyToClipboard(`${envVar.name}=${envVar.value}`, envVar.name)}
                      style={{
                        background: 'rgba(0, 255, 255, 0.2)',
                        border: '1px solid rgba(0, 255, 255, 0.4)',
                        borderRadius: '8px',
                        color: '#00ffff',
                        padding: '4px 8px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      {copied === envVar.name ? (
                        <CheckCircle style={{ width: '14px', height: '14px' }} />
                      ) : (
                        <Copy style={{ width: '14px', height: '14px' }} />
                      )}
                      {copied === envVar.name ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div style={{
                    fontFamily: 'Courier New, monospace',
                    fontSize: '12px',
                    color: '#888',
                    background: 'rgba(0, 0, 0, 0.3)',
                    padding: '8px',
                    borderRadius: '6px',
                    marginBottom: '8px',
                    wordBreak: 'break-all'
                  }}>
                    {envVar.value}
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: '#888',
                    fontFamily: 'Rajdhani, sans-serif'
                  }}>
                    {envVar.description}
                  </div>
                </div>
              ))}
            </div>

            {/* Links */}
            <div style={{
              display: 'flex',
              gap: '15px',
              marginTop: '20px',
              borderTop: '1px solid rgba(255, 215, 0, 0.3)',
              paddingTop: '15px'
            }}>
              <a
                href="https://vercel.com/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 16px',
                  background: 'rgba(0, 255, 255, 0.2)',
                  border: '1px solid rgba(0, 255, 255, 0.4)',
                  borderRadius: '10px',
                  color: '#00ffff',
                  textDecoration: 'none',
                  fontSize: '12px',
                  fontFamily: 'Rajdhani, sans-serif',
                  transition: 'all 0.3s ease'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 255, 255, 0.3)'
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 255, 255, 0.2)'
                }}
              >
                <ExternalLink style={{ width: '14px', height: '14px' }} />
                Vercel Dashboard
              </a>
              
              <a
                href="https://clerk.com/docs"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 16px',
                  background: 'rgba(255, 215, 0, 0.2)',
                  border: '1px solid rgba(255, 215, 0, 0.4)',
                  borderRadius: '10px',
                  color: '#ffd700',
                  textDecoration: 'none',
                  fontSize: '12px',
                  fontFamily: 'Rajdhani, sans-serif',
                  transition: 'all 0.3s ease'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 215, 0, 0.3)'
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 215, 0, 0.2)'
                }}
              >
                <ExternalLink style={{ width: '14px', height: '14px' }} />
                Clerk Documentation
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}