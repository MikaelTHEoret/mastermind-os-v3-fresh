'use client'

import { useState } from 'react'
import { X, User, Calendar, Trophy, Target } from 'lucide-react'

interface User {
  id: string
  username: string
  email: string
  role: 'admin' | 'developer' | 'user'
  avatar?: string
  joinDate: string
  lastActive: string
  scrollsMinted: number
  organizationId?: string
}

interface UserDashboardProps {
  user: User
  onClose: () => void
}

export default function UserDashboard({ user, onClose }: UserDashboardProps) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f0f23] border border-cyan-500/30 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-cyan-500/20">
          <h2 className="text-2xl font-bold text-cyan-400 font-mono">
            📊 User Dashboard
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* User Info */}
        <div className="flex items-center gap-4 mb-6 p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
          <div className="w-16 h-16 bg-cyan-500/20 rounded-full flex items-center justify-center text-2xl">
            {user.avatar || '👤'}
          </div>
          <div>
            <h3 className="text-xl font-bold text-cyan-300">{user.username}</h3>
            <p className="text-gray-400">{user.email}</p>
            <span className="inline-block px-2 py-1 bg-cyan-500/20 text-cyan-300 text-xs rounded mt-1">
              {user.role.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gradient-to-br from-yellow-500/20 to-yellow-600/20 border border-yellow-500/30 rounded-lg p-4 text-center">
            <Trophy className="h-8 w-8 text-yellow-400 mx-auto mb-2" />
            <div className="text-2xl font-bold text-yellow-400">{user.scrollsMinted}</div>
            <div className="text-xs text-gray-400">Scrolls Minted</div>
          </div>

          <div className="bg-gradient-to-br from-green-500/20 to-green-600/20 border border-green-500/30 rounded-lg p-4 text-center">
            <Target className="h-8 w-8 text-green-400 mx-auto mb-2" />
            <div className="text-2xl font-bold text-green-400">{Math.floor(Math.random() * 50 + 10)}</div>
            <div className="text-xs text-gray-400">KBT Tokens</div>
          </div>

          <div className="bg-gradient-to-br from-purple-500/20 to-purple-600/20 border border-purple-500/30 rounded-lg p-4 text-center">
            <User className="h-8 w-8 text-purple-400 mx-auto mb-2" />
            <div className="text-2xl font-bold text-purple-400">{Math.floor(Math.random() * 100 + 50)}</div>
            <div className="text-xs text-gray-400">Reputation</div>
          </div>

          <div className="bg-gradient-to-br from-cyan-500/20 to-cyan-600/20 border border-cyan-500/30 rounded-lg p-4 text-center">
            <Calendar className="h-8 w-8 text-cyan-400 mx-auto mb-2" />
            <div className="text-2xl font-bold text-cyan-400">
              {Math.floor((Date.now() - new Date(user.joinDate).getTime()) / (1000 * 60 * 60 * 24))}
            </div>
            <div className="text-xs text-gray-400">Days Active</div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-black/30 border border-cyan-500/20 rounded-lg p-4">
          <h4 className="text-lg font-bold text-cyan-400 mb-4">📈 Recent Activity</h4>
          <div className="space-y-3">
            {[
              { action: 'Logged In', item: 'MasterMind OS v3', time: 'Just now' },
              { action: 'Account Created', item: 'Welcome to the platform!', time: 'Today' },
              { action: 'Ready to Mint', item: 'Start creating scrolls', time: 'Today' },
            ].map((activity, index) => (
              <div key={index} className="flex justify-between items-center p-3 bg-cyan-500/5 rounded-lg">
                <div>
                  <span className="text-cyan-400 font-semibold">{activity.action}</span>
                  <span className="text-gray-400 ml-2">{activity.item}</span>
                </div>
                <span className="text-gray-500 text-sm">{activity.time}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mt-6">
          <button className="flex-1 px-4 py-2 bg-cyan-500/20 border border-cyan-500/40 rounded-lg text-cyan-400 hover:bg-cyan-500/30 transition-colors">
            🔧 Account Settings
          </button>
          <button className="flex-1 px-4 py-2 bg-yellow-500/20 border border-yellow-500/40 rounded-lg text-yellow-400 hover:bg-yellow-500/30 transition-colors">
            📜 View Scrolls
          </button>
        </div>
      </div>
    </div>
  )
}