'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { LogOut, User, Settings } from 'lucide-react'

interface UserButtonProps {
  user: any
  onSignOut: () => void
}

export default function UserButton({ user, onSignOut }: UserButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 border border-zinc-600 rounded-lg hover:bg-zinc-700/50 transition-colors"
      >
        <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-purple-500 rounded-full flex items-center justify-center">
          <User className="h-4 w-4 text-white" />
        </div>
        <span className="text-white text-sm font-medium">{user.displayName || 'User'}</span>
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-48 bg-zinc-800 border border-zinc-600 rounded-lg shadow-lg z-50">
          <div className="p-3 border-b border-zinc-600">
            <p className="text-white font-medium">{user.displayName || 'User'}</p>
            <p className="text-zinc-400 text-sm truncate">{user.primaryEmail}</p>
          </div>
          
          <div className="p-2">
            <button className="w-full flex items-center gap-2 px-3 py-2 text-zinc-300 hover:bg-zinc-700 rounded transition-colors">
              <Settings className="h-4 w-4" />
              Settings
            </button>
            
            <button 
              onClick={() => {
                onSignOut()
                setIsOpen(false)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-red-400 hover:bg-red-900/20 rounded transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}