"use client"

import { useState, useEffect } from 'react'
import { SignInButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs'
import { User, Settings, HelpCircle } from 'lucide-react'
import { userButtonAppearance } from '@/lib/clerk-config'
import { AuthSetupHelper } from '@/components/auth/AuthSetupHelper'

export default function UserSystem() {
  const [showSetupHelper, setShowSetupHelper] = useState(false)
  const [isClerkConfigured, setIsClerkConfigured] = useState(false)

  useEffect(() => {
    // Check if Clerk environment variables are configured
    const hasPublishableKey = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    setIsClerkConfigured(hasPublishableKey)
  }, [])

  const handleSetupClick = () => {
    setShowSetupHelper(true)
  }

  const handleSetupComplete = () => {
    setShowSetupHelper(false)
    // Refresh the page to check for new environment variables
    window.location.reload()
  }

  return (
    <>
      <div className="relative">
        <div className="flex items-center gap-3">
          
          {/* When user is signed in */}
          <SignedIn>
            <div className="bg-cyan-500/15 border-2 border-cyan-400/40 rounded-full p-1 backdrop-blur-sm">
              <UserButton 
                afterSignOutUrl="/"
                userProfileMode="modal"
                appearance={userButtonAppearance}
              />
            </div>
          </SignedIn>

          {/* When user is not signed in */}
          <SignedOut>
            <div className="flex items-center gap-2">
              {isClerkConfigured ? (
                // Show sign-in button when Clerk is configured
                <SignInButton mode="modal">
                  <button className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border-2 border-cyan-500/50 rounded-full text-cyan-400 text-sm font-semibold cursor-pointer transition-all duration-300 backdrop-blur-sm font-orbitron uppercase tracking-wide hover:from-cyan-500/40 hover:to-purple-500/40 hover:shadow-lg hover:shadow-cyan-500/50 hover:-translate-y-0.5 active:translate-y-0">
                    <User className="w-4 h-4" />
                    <span>SIGN IN</span>
                  </button>
                </SignInButton>
              ) : (
                // Show setup button when Clerk is not configured
                <button
                  onClick={handleSetupClick}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-2 border-amber-500/50 rounded-full text-amber-400 text-sm font-semibold cursor-pointer transition-all duration-300 backdrop-blur-sm font-orbitron uppercase tracking-wide hover:from-amber-500/40 hover:to-orange-500/40 hover:shadow-lg hover:shadow-amber-500/50 hover:-translate-y-0.5 active:translate-y-0"
                >
                  <Settings className="w-4 h-4" />
                  <span>SETUP AUTH</span>
                </button>
              )}
              
              {/* Help button */}
              <button
                onClick={handleSetupClick}
                className="inline-flex items-center justify-center w-10 h-10 bg-gray-700/50 border border-gray-600/50 rounded-full text-gray-400 hover:text-cyan-400 hover:border-cyan-400/50 transition-all duration-300 backdrop-blur-sm"
                title="Authentication Setup Help"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
            </div>
          </SignedOut>

        </div>
      </div>

      {/* Auth Setup Helper Modal */}
      {showSetupHelper && (
        <AuthSetupHelper onSetupComplete={handleSetupComplete} />
      )}
    </>
  )
}
