'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface WalletState {
  connected: boolean;
  address: string;
  chainId: string;
  balance: string;
}

interface WalletContextType {
  walletState: WalletState;
  connectWallet: () => Promise<boolean>;
  disconnectWallet: () => void;
  checkWalletConnection: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [walletState, setWalletState] = useState<WalletState>({
    connected: false,
    address: '',
    chainId: '',
    balance: ''
  });

  const checkWalletConnection = async () => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        const ethereum = (window as any).ethereum;
        const accounts = await ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
          const chainId = await ethereum.request({ method: 'eth_chainId' });
          setWalletState({
            connected: true,
            address: accounts[0],
            chainId,
            balance: '0'
          });
        }
      } catch (error) {
        console.error('Error checking wallet connection:', error);
      }
    }
  };

  const connectWallet = async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      alert('No Web3 wallet detected. Please install MetaMask.');
      return false;
    }

    try {
      const ethereum = (window as any).ethereum;
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      const chainId = await ethereum.request({ method: 'eth_chainId' });
      
      setWalletState({
        connected: true,
        address: accounts[0],
        chainId,
        balance: '0'
      });
      
      return true;
    } catch (error: any) {
      console.error('Wallet connection failed:', error);
      return false;
    }
  };

  const disconnectWallet = () => {
    setWalletState({
      connected: false,
      address: '',
      chainId: '',
      balance: ''
    });
  };

  // L1/L2 Network switching logic
  const switchToNetwork = async (chainId: string) => {
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      return false;
    }

    try {
      const ethereum = (window as any).ethereum;
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId }],
      });
      
      setWalletState(prev => ({ ...prev, chainId }));
      return true;
    } catch (error: any) {
      if (error.code === 4902) {
        // Chain not added to wallet, try to add it
        try {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [getNetworkConfig(chainId)],
          });
          setWalletState(prev => ({ ...prev, chainId }));
          return true;
        } catch (addError) {
          console.error('Failed to add network:', addError);
          return false;
        }
      }
      console.error('Failed to switch network:', error);
      return false;
    }
  };

  const getNetworkConfig = (chainId: string) => {
    switch (chainId) {
      case '0x1': // Ethereum mainnet
        return {
          chainId: '0x1',
          chainName: 'Ethereum Mainnet',
          nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
          },
          rpcUrls: ['https://mainnet.infura.io/v3/'],
          blockExplorerUrls: ['https://etherscan.io/'],
        };
      case '0x82750': // Scroll mainnet
        return {
          chainId: '0x82750',
          chainName: 'Scroll',
          nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
          },
          rpcUrls: ['https://rpc.scroll.io/'],
          blockExplorerUrls: ['https://scrollscan.com/'],
        };
      default:
        throw new Error(`Unsupported chain ID: ${chainId}`);
    }
  };

  // Auto-connect on component mount
  useEffect(() => {
    checkWalletConnection();
    
    // Listen for account changes
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      const ethereum = (window as any).ethereum;
      
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length === 0) {
          disconnectWallet();
        } else {
          setWalletState(prev => ({ ...prev, address: accounts[0] }));
        }
      };
      
      const handleChainChanged = (chainId: string) => {
        setWalletState(prev => ({ ...prev, chainId }));
      };
      
      ethereum.on('accountsChanged', handleAccountsChanged);
      ethereum.on('chainChanged', handleChainChanged);
      
      return () => {
        ethereum.removeListener('accountsChanged', handleAccountsChanged);
        ethereum.removeListener('chainChanged', handleChainChanged);
      };
    }
  }, []);

  return (
    <WalletContext.Provider value={{
      walletState,
      connectWallet,
      disconnectWallet,
      checkWalletConnection
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
