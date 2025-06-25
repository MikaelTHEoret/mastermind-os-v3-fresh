'use client';

import { useState } from 'react';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';

export function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {isLogin ? (
          <LoginForm 
            onToggleMode={() => setIsLogin(false)}
            showRegister={true}
          />
        ) : (
          <RegisterForm 
            onToggleMode={() => setIsLogin(true)}
            showLogin={true}
          />
        )}
      </div>
    </div>
  );
}