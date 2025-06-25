import React, { useState } from 'react';

const SmartAuthButton = ({ onAuthChange }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [showEmailInput, setShowEmailInput] = useState(false);

  const handleAuth = async (e) => {
    e.preventDefault();
    if (!email && !showEmailInput) {
      setShowEmailInput(true);
      return;
    }
    
    if (!email) {
      alert('Please enter your email');
      return;
    }

    setIsLoading(true);
    
    // Simulate authentication process
    setTimeout(() => {
      setIsLoading(false);
      onAuthChange(true, { email });
    }, 2000);
  };

  return (
    <div className="auth-form">
      {!showEmailInput ? (
        <button 
          onClick={handleAuth}
          disabled={isLoading}
          className="auth-button primary"
        >
          {isLoading ? (
            <>
              <span className="loading-spinner"></span>
              Initializing Neural Link...
            </>
          ) : (
            <>
              <span className="auth-icon">🧠</span>
              Enter MasterMind OS
            </>
          )}
        </button>
      ) : (
        <form onSubmit={handleAuth} className="email-form">
          <div className="input-group">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your consciousness identifier"
              className="email-input"
              autoFocus
              required
            />
          </div>
          
          <button 
            type="submit"
            disabled={isLoading || !email}
            className="auth-button primary"
          >
            {isLoading ? (
              <>
                <span className="loading-spinner"></span>
                Establishing Connection...
              </>
            ) : (
              <>
                <span className="auth-icon">🚀</span>
                Connect to OS
              </>
            )}
          </button>
          
          <button 
            type="button"
            onClick={() => setShowEmailInput(false)}
            className="auth-button secondary"
          >
            Back
          </button>
        </form>
      )}
    </div>
  );
};

export default SmartAuthButton;