'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { 
  Home, 
  ScrollText, 
  Settings, 
  User, 
  Zap,
  ChevronDown,
  LogOut,
  Key,
  Shield,
  Palette,
  Bell
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: Home },
  { name: 'Scroll Minter', href: '/scroll-minter', icon: ScrollText, featured: true },
  { name: 'Settings', href: '/settings', icon: Settings },
];

// Mock user data - in production this would come from your auth system
const mockUser = {
  name: 'Mikael Theoret',
  email: 'mikaeltheoret@gmail.com',
  avatar: null,
  role: 'Codex Architect',
  isAuthenticated: true
};

export function Navigation() {
  const pathname = usePathname();
  const [user] = useState(mockUser);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/40 backdrop-blur-md border-b border-cyan-500/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center space-x-2">
            <div className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              ⧉ Mastermind OS
            </div>
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center space-x-4">
            {navigation.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                      : "text-gray-300 hover:text-white hover:bg-white/10",
                    item.featured && "ring-1 ring-purple-500/50 bg-gradient-to-r from-purple-500/10 to-pink-500/10"
                  )}
                >
                  <Icon className={cn(
                    "h-4 w-4",
                    item.featured && "text-purple-400",
                    isActive && "text-cyan-400"
                  )} />
                  <span>{item.name}</span>
                  {item.featured && (
                    <Zap className="h-3 w-3 text-yellow-400 ml-1" />
                  )}
                </Link>
              );
            })}
          </div>

          {/* User Menu */}
          <div className="flex items-center space-x-4">
            {user.isAuthenticated ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center space-x-2 hover:bg-white/10">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user.avatar || undefined} />
                      <AvatarFallback className="bg-gradient-to-r from-cyan-500 to-purple-500 text-white text-sm">
                        {user.name.split(' ').map(n => n[0]).join('')}
                      </AvatarFallback>
                    </Avatar>
                    <div className="hidden sm:block text-left">
                      <div className="text-sm font-medium text-white">{user.name}</div>
                      <div className="text-xs text-gray-400">{user.role}</div>
                    </div>
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent 
                  align="end" 
                  className="w-64 bg-black/90 backdrop-blur-md border-cyan-500/30"
                >
                  <DropdownMenuLabel className="text-cyan-300">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium">{user.name}</p>
                      <p className="text-xs text-gray-400">{user.email}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-cyan-500/30" />
                  
                  <DropdownMenuItem asChild>
                    <Link href="/profile" className="flex items-center space-x-2 text-gray-300 hover:text-cyan-300">
                      <User className="h-4 w-4" />
                      <span>Profile Settings</span>
                    </Link>
                  </DropdownMenuItem>
                  
                  <DropdownMenuItem asChild>
                    <Link href="/profile/secrets" className="flex items-center space-x-2 text-gray-300 hover:text-purple-300">
                      <Key className="h-4 w-4" />
                      <span>API Keys & Secrets</span>
                    </Link>
                  </DropdownMenuItem>
                  
                  <DropdownMenuItem asChild>
                    <Link href="/profile/security" className="flex items-center space-x-2 text-gray-300 hover:text-green-300">
                      <Shield className="h-4 w-4" />
                      <span>Security Settings</span>
                    </Link>
                  </DropdownMenuItem>
                  
                  <DropdownMenuItem asChild>
                    <Link href="/profile/preferences" className="flex items-center space-x-2 text-gray-300 hover:text-orange-300">
                      <Palette className="h-4 w-4" />
                      <span>Preferences</span>
                    </Link>
                  </DropdownMenuItem>
                  
                  <DropdownMenuItem asChild>
                    <Link href="/profile/notifications" className="flex items-center space-x-2 text-gray-300 hover:text-yellow-300">
                      <Bell className="h-4 w-4" />
                      <span>Notifications</span>
                    </Link>
                  </DropdownMenuItem>
                  
                  <DropdownMenuSeparator className="bg-cyan-500/30" />
                  
                  <DropdownMenuItem className="text-red-400 hover:text-red-300 hover:bg-red-500/10">
                    <LogOut className="h-4 w-4 mr-2" />
                    <span>Sign Out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="flex items-center space-x-2">
                <Link href="/auth/signin">
                  <Button variant="ghost" className="text-gray-300 hover:text-cyan-300">
                    Sign In
                  </Button>
                </Link>
                <Link href="/auth/signup">
                  <Button className="bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-700 hover:to-purple-700">
                    Sign Up
                  </Button>
                </Link>
              </div>
            )}

            {/* Mobile menu button */}
            <div className="md:hidden">
              <button className="text-gray-300 hover:text-white p-2">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
