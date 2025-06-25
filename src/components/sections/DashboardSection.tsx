'use client';

import React, { useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { 
  Settings, 
  User, 
  Key, 
  Activity, 
  Shield,
  Bell,
  Database,
  Cloud,
  Monitor
} from 'lucide-react';
import { getTheme } from '@/lib/theme-config';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import ApiConfigurationDashboard from '../dashboard/api/ApiConfigurationDashboard';

const theme = getTheme('dashboard');

type DashboardTab = 'overview' | 'profile' | 'sources' | 'security' | 'activity';

export default function DashboardSection() {
  const { user } = useUser();
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: Monitor },
    { id: 'profile' as const, label: 'Profile', icon: User },
    { id: 'sources' as const, label: 'API Configuration', icon: Cloud },
    { id: 'security' as const, label: 'Security', icon: Shield },
    { id: 'activity' as const, label: 'Activity', icon: Activity }
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card 
                className="border border-cyan-500/30 bg-black/40 backdrop-blur-sm"
                style={{
                  border: '2px solid #00ffff',
                  borderRadius: '12px',
                  background: 'rgba(0, 0, 0, 0.8)',
                  boxShadow: '0 0 15px rgba(0, 255, 255, 0.3)'
                }}
              >
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div 
                      className="p-2 rounded-lg"
                      style={{
                        background: 'rgba(0, 255, 255, 0.2)',
                        border: '1px solid rgba(0, 255, 255, 0.4)'
                      }}
                    >
                      <User className="w-5 h-5" style={{ color: '#00ffff' }} />
                    </div>
                    <div>
                      <h3 className="font-medium" style={{ color: '#ffffff' }}>Profile</h3>
                      <p className="text-sm" style={{ color: 'rgba(0, 255, 255, 0.7)' }}>Account settings</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card 
                className="border border-green-500/30 bg-black/40 backdrop-blur-sm"
                style={{
                  border: '2px solid #00ffaa',
                  borderRadius: '12px',
                  background: 'rgba(0, 0, 0, 0.8)',
                  boxShadow: '0 0 15px rgba(0, 255, 170, 0.3)'
                }}
              >
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div 
                      className="p-2 rounded-lg"
                      style={{
                        background: 'rgba(0, 255, 170, 0.2)',
                        border: '1px solid rgba(0, 255, 170, 0.4)'
                      }}
                    >
                      <Cloud className="w-5 h-5" style={{ color: '#00ffaa' }} />
                    </div>
                    <div>
                      <h3 className="font-medium" style={{ color: '#ffffff' }}>API Configuration</h3>
                      <p className="text-sm" style={{ color: 'rgba(0, 255, 170, 0.7)' }}>MasterMind & External APIs</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card 
                className="border border-purple-500/30 bg-black/40 backdrop-blur-sm"
                style={{
                  border: '2px solid #ff00ff',
                  borderRadius: '12px',
                  background: 'rgba(0, 0, 0, 0.8)',
                  boxShadow: '0 0 15px rgba(255, 0, 255, 0.3)'
                }}
              >
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div 
                      className="p-2 rounded-lg"
                      style={{
                        background: 'rgba(255, 0, 255, 0.2)',
                        border: '1px solid rgba(255, 0, 255, 0.4)'
                      }}
                    >
                      <Shield className="w-5 h-5" style={{ color: '#ff00ff' }} />
                    </div>
                    <div>
                      <h3 className="font-medium" style={{ color: '#ffffff' }}>Security</h3>
                      <p className="text-sm" style={{ color: 'rgba(255, 0, 255, 0.7)' }}>Access control</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card 
              className="border border-cyan-500/30 bg-black/40 backdrop-blur-sm"
              style={{
                border: '2px solid #00ffff',
                borderRadius: '12px',
                background: 'rgba(0, 0, 0, 0.8)',
                boxShadow: '0 0 15px rgba(0, 255, 255, 0.3)'
              }}
            >
              <CardHeader>
                <CardTitle 
                  className="flex items-center gap-2"
                  style={{ color: '#ffffff' }}
                >
                  <Activity className="w-5 h-5" style={{ color: '#00ffff' }} />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2">
                    <span style={{ color: '#ffffff' }}>Logged into MasterMind OS</span>
                    <span className="text-sm" style={{ color: 'rgba(0, 255, 255, 0.7)' }}>Just now</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span style={{ color: '#ffffff' }}>Accessed Scroll Forge</span>
                    <span className="text-sm" style={{ color: 'rgba(0, 255, 255, 0.7)' }}>5 minutes ago</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span style={{ color: '#ffffff' }}>Updated profile settings</span>
                    <span className="text-sm" style={{ color: 'rgba(0, 255, 255, 0.7)' }}>1 hour ago</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        );

      case 'profile':
        return (
          <div className="space-y-6">
            <Card 
              className="border border-cyan-500/30 bg-black/40 backdrop-blur-sm"
              style={{
                border: '2px solid #00ffff',
                borderRadius: '12px',
                background: 'rgba(0, 0, 0, 0.8)',
                boxShadow: '0 0 15px rgba(0, 255, 255, 0.3)'
              }}
            >
              <CardHeader>
                <CardTitle style={{ color: '#ffffff' }}>Profile Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  {user?.imageUrl && (
                    <img
                      src={user.imageUrl}
                      alt="Profile"
                      className="w-16 h-16 rounded-full"
                      style={{
                        border: '2px solid rgba(0, 255, 255, 0.5)'
                      }}
                    />
                  )}
                  <div>
                    <h3 
                      className="text-lg font-medium"
                      style={{ color: '#ffffff' }}
                    >
                      {user?.firstName} {user?.lastName}
                    </h3>
                    <p style={{ color: 'rgba(0, 255, 255, 0.7)' }}>
                      {user?.primaryEmailAddress?.emailAddress}
                    </p>
                    <Badge 
                      className="mt-2"
                      style={{
                        background: 'rgba(0, 255, 170, 0.2)',
                        color: '#00ffaa',
                        border: '1px solid rgba(0, 255, 170, 0.5)'
                      }}
                    >
                      Verified
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card 
              className="border border-cyan-500/30 bg-black/40 backdrop-blur-sm"
              style={{
                border: '2px solid #00ffff',
                borderRadius: '12px',
                background: 'rgba(0, 0, 0, 0.8)',
                boxShadow: '0 0 15px rgba(0, 255, 255, 0.3)'
              }}
            >
              <CardHeader>
                <CardTitle style={{ color: '#ffffff' }}>Account Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span style={{ color: '#ffffff' }}>Member since</span>
                  <span style={{ color: '#ffffff' }}>
                    {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span style={{ color: '#ffffff' }}>Last sign in</span>
                  <span style={{ color: '#ffffff' }}>
                    {user?.lastSignInAt ? new Date(user.lastSignInAt).toLocaleDateString() : 'Unknown'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span style={{ color: '#ffffff' }}>Account status</span>
                  <Badge 
                    style={{
                      background: 'rgba(0, 255, 170, 0.2)',
                      color: '#00ffaa',
                      border: '1px solid rgba(0, 255, 170, 0.5)'
                    }}
                  >
                    Active
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        );

      case 'sources':
        return <ApiConfigurationDashboard />;

      case 'security':
        return (
          <div className="space-y-6">
            <Card 
              className="border border-red-500/30 bg-black/40 backdrop-blur-sm"
              style={{
                border: '2px solid #ff4444',
                borderRadius: '12px',
                background: 'rgba(0, 0, 0, 0.8)',
                boxShadow: '0 0 15px rgba(255, 68, 68, 0.3)'
              }}
            >
              <CardHeader>
                <CardTitle 
                  className="flex items-center gap-2"
                  style={{ color: '#ffffff' }}
                >
                  <Shield className="w-5 h-5" style={{ color: '#ff4444' }} />
                  Security Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium" style={{ color: '#ffffff' }}>Two-Factor Authentication</h4>
                    <p className="text-sm" style={{ color: 'rgba(255, 68, 68, 0.7)' }}>Add an extra layer of security</p>
                  </div>
                  <Badge 
                    style={{
                      background: 'rgba(255, 68, 68, 0.2)',
                      color: '#ff4444',
                      border: '1px solid rgba(255, 68, 68, 0.5)'
                    }}
                  >
                    Disabled
                  </Badge>
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium" style={{ color: '#ffffff' }}>API Key Encryption</h4>
                    <p className="text-sm" style={{ color: 'rgba(0, 255, 170, 0.7)' }}>All stored API keys are encrypted</p>
                  </div>
                  <Badge 
                    style={{
                      background: 'rgba(0, 255, 170, 0.2)',
                      color: '#00ffaa',
                      border: '1px solid rgba(0, 255, 170, 0.5)'
                    }}
                  >
                    Enabled
                  </Badge>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium" style={{ color: '#ffffff' }}>Session Management</h4>
                    <p className="text-sm" style={{ color: 'rgba(0, 255, 255, 0.7)' }}>Manage active sessions</p>
                  </div>
                  <button
                    style={{
                      padding: '8px 16px',
                      background: 'rgba(0, 255, 255, 0.2)',
                      border: '2px solid #00ffff',
                      borderRadius: '6px',
                      color: '#00ffff',
                      fontFamily: 'Rajdhani, sans-serif',
                      fontSize: '12px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      boxShadow: '0 0 10px rgba(0, 255, 255, 0.3)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(0, 255, 255, 0.3)';
                      e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 255, 255, 0.5)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(0, 255, 255, 0.2)';
                      e.currentTarget.style.boxShadow = '0 0 10px rgba(0, 255, 255, 0.3)';
                    }}
                  >
                    Manage
                  </button>
                </div>
              </CardContent>
            </Card>

            <Card 
              className="border border-yellow-500/30 bg-black/40 backdrop-blur-sm"
              style={{
                border: '2px solid #ffaa00',
                borderRadius: '12px',
                background: 'rgba(0, 0, 0, 0.8)',
                boxShadow: '0 0 15px rgba(255, 170, 0, 0.3)'
              }}
            >
              <CardHeader>
                <CardTitle 
                  className="flex items-center gap-2"
                  style={{ color: '#ffffff' }}
                >
                  <Key className="w-5 h-5" style={{ color: '#ffaa00' }} />
                  Data Privacy
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p 
                  className="text-sm"
                  style={{ color: 'rgba(255, 170, 0, 0.8)' }}
                >
                  Your API keys and personal data are encrypted using industry-standard encryption.
                  All data is stored securely in our Neon database with user-specific encryption keys.
                </p>
                <div className="flex gap-2">
                  <button
                    style={{
                      padding: '8px 16px',
                      background: 'rgba(0, 255, 255, 0.2)',
                      border: '2px solid #00ffff',
                      borderRadius: '6px',
                      color: '#00ffff',
                      fontFamily: 'Rajdhani, sans-serif',
                      fontSize: '12px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      boxShadow: '0 0 10px rgba(0, 255, 255, 0.3)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(0, 255, 255, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(0, 255, 255, 0.2)';
                    }}
                  >
                    Export Data
                  </button>
                  <button
                    style={{
                      padding: '8px 16px',
                      background: 'rgba(255, 68, 68, 0.2)',
                      border: '2px solid #ff4444',
                      borderRadius: '6px',
                      color: '#ff4444',
                      fontFamily: 'Rajdhani, sans-serif',
                      fontSize: '12px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      boxShadow: '0 0 10px rgba(255, 68, 68, 0.3)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 68, 68, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 68, 68, 0.2)';
                    }}
                  >
                    Delete Account
                  </button>
                </div>
              </CardContent>
            </Card>
          </div>
        );

      case 'activity':
        return (
          <div className="space-y-6">
            <Card 
              className="border border-cyan-500/30 bg-black/40 backdrop-blur-sm"
              style={{
                border: '2px solid #00ffff',
                borderRadius: '12px',
                background: 'rgba(0, 0, 0, 0.8)',
                boxShadow: '0 0 15px rgba(0, 255, 255, 0.3)'
              }}
            >
              <CardHeader>
                <CardTitle 
                  className="flex items-center gap-2"
                  style={{ color: '#ffffff' }}
                >
                  <Activity className="w-5 h-5" style={{ color: '#00ffff' }} />
                  Activity Log
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    { action: 'Signed in to MasterMind OS', time: 'Just now', type: 'auth' },
                    { action: 'Configured GitHub API source', time: '10 minutes ago', type: 'config' },
                    { action: 'Accessed Scroll Forge', time: '15 minutes ago', type: 'navigation' },
                    { action: 'Updated profile information', time: '1 hour ago', type: 'profile' },
                    { action: 'Created new scroll document', time: '2 hours ago', type: 'document' },
                    { action: 'Connected Pinata IPFS', time: '1 day ago', type: 'config' }
                  ].map((activity, index) => (
                    <div 
                      key={index} 
                      className="flex items-center justify-between py-3 last:border-b-0"
                      style={{
                        borderBottom: index < 5 ? '1px solid rgba(0, 255, 255, 0.2)' : 'none'
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-2 h-2 rounded-full"
                          style={{
                            background: activity.type === 'auth' ? '#00ffaa' :
                                      activity.type === 'config' ? '#00ffff' :
                                      activity.type === 'navigation' ? '#ff00ff' :
                                      activity.type === 'profile' ? '#ffaa00' :
                                      '#00ffff'
                          }} 
                        />
                        <span style={{ color: '#ffffff' }}>{activity.action}</span>
                      </div>
                      <span className="text-sm" style={{ color: 'rgba(0, 255, 255, 0.7)' }}>{activity.time}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card 
              className="border border-purple-500/30 bg-black/40 backdrop-blur-sm"
              style={{
                border: '2px solid #ff00ff',
                borderRadius: '12px',
                background: 'rgba(0, 0, 0, 0.8)',
                boxShadow: '0 0 15px rgba(255, 0, 255, 0.3)'
              }}
            >
              <CardHeader>
                <CardTitle 
                  className="flex items-center gap-2"
                  style={{ color: '#ffffff' }}
                >
                  <Database className="w-5 h-5" style={{ color: '#ff00ff' }} />
                  Usage Statistics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <div 
                      className="text-2xl font-bold"
                      style={{ color: '#ffffff' }}
                    >
                      127
                    </div>
                    <div 
                      className="text-sm"
                      style={{ color: 'rgba(255, 0, 255, 0.7)' }}
                    >
                      API Calls Today
                    </div>
                  </div>
                  <div className="text-center">
                    <div 
                      className="text-2xl font-bold"
                      style={{ color: '#ffffff' }}
                    >
                      5
                    </div>
                    <div 
                      className="text-sm"
                      style={{ color: 'rgba(255, 0, 255, 0.7)' }}
                    >
                      Sources Configured
                    </div>
                  </div>
                  <div className="text-center">
                    <div 
                      className="text-2xl font-bold"
                      style={{ color: '#ffffff' }}
                    >
                      23
                    </div>
                    <div 
                      className="text-sm"
                      style={{ color: 'rgba(255, 0, 255, 0.7)' }}
                    >
                      Files Managed
                    </div>
                  </div>
                  <div className="text-center">
                    <div 
                      className="text-2xl font-bold"
                      style={{ color: '#ffffff' }}
                    >
                      98.5%
                    </div>
                    <div 
                      className="text-sm"
                      style={{ color: 'rgba(255, 0, 255, 0.7)' }}
                    >
                      Uptime
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div 
      className="h-full flex"
      style={{
        background: 'rgba(0, 0, 0, 0.8)', // Same dark background as Scroll Forge
        color: theme.textColor,
        borderRadius: '12px', // Rounded edges for main container
        border: '2px solid #00ffff', // Bright cyan border like Scroll section
        boxShadow: '0 0 20px rgba(0, 255, 255, 0.4)', // Luminous glow
        overflow: 'hidden' // Ensure rounded corners work properly
      }}
    >
      {/* Sidebar Navigation */}
      <div 
        className="w-64 h-full flex flex-col"
        style={{
          background: 'rgba(0, 0, 0, 0.8)',
          borderRight: '2px solid #00ffff', // Bright cyan border
          padding: '16px'
        }}
      >
        <div className="space-y-2 flex-1">
          <h2 
            className="text-xl font-bold mb-6 flex items-center gap-2"
            style={{ color: '#00ffff' }} // Bright cyan like Scroll section
          >
            <Settings className="w-6 h-6" style={{ color: '#00ffff' }} />
            Dashboard
          </h2>
          
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  justifyContent: 'flex-start',
                  background: isActive ? 'rgba(0, 255, 255, 0.2)' : 'transparent',
                  border: isActive ? '2px solid #00ffff' : '2px solid transparent',
                  borderRadius: '8px',
                  color: isActive ? '#00ffff' : 'rgba(0, 255, 255, 0.7)',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontWeight: '500',
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  boxShadow: isActive ? '0 0 15px rgba(0, 255, 255, 0.4)' : 'none'
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'rgba(0, 255, 255, 0.1)';
                    e.currentTarget.style.color = '#ffffff';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'rgba(0, 255, 255, 0.7)';
                  }
                }}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* User Info */}
        <div 
          className="mt-auto pt-4"
          style={{
            borderTop: '1px solid rgba(0, 255, 255, 0.3)'
          }}
        >
          <div className="flex items-center gap-3">
            {user?.imageUrl && (
              <img
                src={user.imageUrl}
                alt="Profile"
                className="w-8 h-8 rounded-full"
                style={{
                  border: '2px solid rgba(0, 255, 255, 0.5)'
                }}
              />
            )}
            <div className="flex-1 min-w-0">
              <p 
                className="text-sm truncate"
                style={{ color: '#ffffff' }}
              >
                {user?.firstName || 'User'}
              </p>
              <p 
                className="text-xs truncate"
                style={{ color: 'rgba(0, 255, 255, 0.7)' }}
              >
                {user?.primaryEmailAddress?.emailAddress}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div 
        className="flex-1 p-6 overflow-auto h-full"
        style={{
          background: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(8px)'
        }}
      >
        <div className="h-full">
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
}