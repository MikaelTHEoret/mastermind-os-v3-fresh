'use client';

import { useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
  Zap, Wallet, Globe, CheckCircle, AlertTriangle, Clock, 
  Copy, ExternalLink, Hash, User, RefreshCw
} from 'lucide-react';
import { getStatusColor } from '@/lib/theme-config';

interface MintingData {
  title: string;
  content: string;
  cid: string;
  hash: string;
  fileId: string;
  validated: boolean;
  l1Status: 'ready' | 'minting' | 'minted' | 'error';
  l2Status: 'ready' | 'minting' | 'minted' | 'error';
  isDemo?: boolean;
  recipientAddress: string;
  keccakHash: string;
  isValidData: boolean;
}

interface WalletState {
  connected: boolean;
  address: string;
  chainId: string;
  balance: string;
}

interface ScrollMinterProps {
  mintingData: MintingData;
  setMintingData: (data: MintingData | ((prev: MintingData) => MintingData)) => void;
  walletState: WalletState;
  connectWallet: () => Promise<boolean>;
  mintOnNetwork: (isL1: boolean) => Promise<void>;
  copyToClipboard: (text: string) => void;
  generateKeccakHash: (data: string) => string;
  isValidEthAddress: (address: string) => boolean;
  theme: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    borderColor: string;
    textColor: string;
    cardBackground: string;
  };
}

export default function ScrollMinter({
  mintingData,
  setMintingData,
  walletState,
  connectWallet,
  mintOnNetwork,
  copyToClipboard,
  generateKeccakHash,
  isValidEthAddress,
  theme
}: ScrollMinterProps) {
  const { user } = useUser();

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ready': return <Clock className="h-4 w-4" />;
      case 'minting': return <RefreshCw className="h-4 w-4 animate-spin" />;
      case 'minted': return <CheckCircle className="h-4 w-4" />;
      case 'error': return <AlertTriangle className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: 'rgba(0, 0, 0, 0.8)' // Match ScrollEditor background
    }}>
      
      {/* Content - Scrollable Full Height with responsive padding */}
      <div style={{ 
        flex: 1, 
        padding: '16px', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '16px',
        overflowY: 'auto',
        minHeight: 0,  // Important: allows flex child to shrink
        width: '100%'
      }}>
        {/* Demo Mode Warning */}
        {mintingData.isDemo && (
          <div style={{
            padding: '12px',
            background: 'rgba(255, 200, 0, 0.1)',
            border: '1px solid rgba(255, 200, 0, 0.3)',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Badge 
              variant="outline" 
              style={{ 
                fontSize: '10px', 
                border: `1px solid rgba(255, 200, 0, 0.5)`, 
                color: 'rgba(255, 200, 0, 1)',
                background: 'rgba(255, 200, 0, 0.1)',
                padding: '2px 6px'
              }}
            >
              DEMO
            </Badge>
            <div>
              <p style={{ color: getStatusColor('warning'), fontSize: '14px', fontWeight: '500' }}>🎮 Demo Mode Active</p>
              <p style={{ color: getStatusColor('warning'), fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>
                Sign in and connect wallet for real blockchain deployment
              </p>
            </div>
          </div>
        )}

        {/* Wallet Status Badge */}
        {walletState.connected && (
          <div style={{
            padding: '8px 12px',
            background: 'rgba(0, 255, 170, 0.1)',
            border: '1px solid rgba(0, 255, 170, 0.3)',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Badge 
              variant="outline" 
              style={{ 
                fontSize: '10px', 
                border: `1px solid rgba(0, 255, 170, 0.5)`, 
                color: 'rgba(0, 255, 170, 1)',
                background: 'rgba(0, 255, 170, 0.1)',
                padding: '2px 6px'
              }}
            >
              WALLET
            </Badge>
            <span style={{ color: 'rgba(0, 255, 170, 1)', fontSize: '12px', fontFamily: 'Courier New, monospace' }}>
              {walletState.address.substring(0, 8)}...{walletState.address.substring(36)}
            </span>
          </div>
        )}
        
        {/* Minting Form - Clean layout without box background */}
        <div style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          maxWidth: '100%',
          boxSizing: 'border-box'
        }}>
          
          {/* Recipient Address */}
          <div>
            <Label 
              htmlFor="recipient" 
              style={{ 
                display: 'block',
                fontSize: '14px',
                fontWeight: '500',
                marginBottom: '8px',
                color: theme.primaryColor,
                fontFamily: 'Rajdhani, sans-serif'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <User style={{ width: '16px', height: '16px' }} />
                Recipient ETH Address
              </div>
            </Label>
            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              <Input
                id="recipient"
                value={mintingData.recipientAddress}
                onChange={(e) => setMintingData(prev => ({ ...prev, recipientAddress: e.target.value }))}
                placeholder="0x4575a90d54785323546f2bb4a520622ed6d3efbc"
                style={{
                  flex: 1,
                  width: '100%',
                  background: 'rgba(0, 0, 0, 0.5)',
                  border: `1px solid ${
                    mintingData.recipientAddress && !isValidEthAddress(mintingData.recipientAddress) 
                      ? getStatusColor('error') : theme.borderColor
                  }`,
                  borderRadius: '8px',
                  color: theme.textColor,
                  fontFamily: 'Courier New, monospace',
                  fontSize: '12px',
                  minWidth: 0
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(mintingData.recipientAddress)}
                style={{
                  width: '32px',
                  height: '32px',
                  padding: 0,
                  background: 'transparent',
                  border: 'none',
                  color: theme.primaryColor
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 255, 255, 0.2)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <Copy style={{ width: '14px', height: '14px' }} />
              </Button>
            </div>
            {mintingData.recipientAddress && !isValidEthAddress(mintingData.recipientAddress) && (
              <p style={{ color: getStatusColor('error'), fontSize: '12px', marginTop: '4px' }}>
                Invalid Ethereum address
              </p>
            )}
          </div>

          {/* Scroll Title */}
          <div>
            <Label 
              htmlFor="title" 
              style={{ 
                display: 'block',
                fontSize: '14px',
                fontWeight: '500',
                marginBottom: '8px',
                color: theme.primaryColor,
                fontFamily: 'Rajdhani, sans-serif'
              }}
            >
              Scroll Title
            </Label>
            <Input
              id="title"
              value={mintingData.title}
              onChange={(e) => setMintingData(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Your scroll title..."
              style={{
                width: '100%',
                background: 'rgba(0, 0, 0, 0.5)',
                border: `1px solid ${theme.borderColor}`,
                borderRadius: '8px',
                color: theme.textColor,
                fontFamily: 'Rajdhani, sans-serif'
              }}
            />
          </div>

          {/* IPFS CID */}
          <div>
            <Label 
              htmlFor="cid" 
              style={{ 
                display: 'block',
                fontSize: '14px',
                fontWeight: '500',
                marginBottom: '8px',
                color: theme.primaryColor,
                fontFamily: 'Rajdhani, sans-serif'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Globe style={{ width: '16px', height: '16px' }} />
                IPFS CID
              </div>
            </Label>
            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              <Input
                id="cid"
                value={mintingData.cid}
                onChange={(e) => setMintingData(prev => ({ ...prev, cid: e.target.value }))}
                placeholder="bafkrei..."
                style={{
                  flex: 1,
                  width: '100%',
                  background: 'rgba(0, 0, 0, 0.5)',
                  border: `1px solid ${
                    mintingData.cid && !mintingData.cid.startsWith('bafkrei') 
                      ? getStatusColor('error') : theme.borderColor
                  }`,
                  borderRadius: '8px',
                  color: theme.textColor,
                  fontFamily: 'Courier New, monospace',
                  fontSize: '12px',
                  minWidth: 0
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(mintingData.cid)}
                style={{
                  width: '32px',
                  height: '32px',
                  padding: 0,
                  background: 'transparent',
                  border: 'none',
                  color: theme.primaryColor
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 255, 255, 0.2)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <Copy style={{ width: '14px', height: '14px' }} />
              </Button>
              {mintingData.cid && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(`https://ipfs.io/ipfs/${mintingData.cid}`, '_blank')}
                  style={{
                    width: '32px',
                    height: '32px',
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    color: theme.primaryColor
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 255, 255, 0.2)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <ExternalLink style={{ width: '14px', height: '14px' }} />
                </Button>
              )}
            </div>
            {mintingData.cid && !mintingData.cid.startsWith('bafkrei') && (
              <p style={{ color: getStatusColor('error'), fontSize: '12px', marginTop: '4px' }}>
                Invalid IPFS CID format
              </p>
            )}
          </div>

          {/* Keccak256 Hash */}
          <div>
            <Label 
              htmlFor="hash" 
              style={{ 
                display: 'block',
                fontSize: '14px',
                fontWeight: '500',
                marginBottom: '8px',
                color: theme.primaryColor,
                fontFamily: 'Rajdhani, sans-serif'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Hash style={{ width: '16px', height: '16px' }} />
                Keccak256 Hash
              </div>
            </Label>
            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              <Input
                id="hash"
                value={mintingData.keccakHash}
                onChange={(e) => setMintingData(prev => ({ ...prev, keccakHash: e.target.value }))}
                placeholder="0x..."
                style={{
                  flex: 1,
                  width: '100%',
                  background: 'rgba(0, 0, 0, 0.5)',
                  border: `1px solid ${theme.borderColor}`,
                  borderRadius: '8px',
                  color: theme.textColor,
                  fontFamily: 'Courier New, monospace',
                  fontSize: '12px',
                  minWidth: 0
                }}
                readOnly
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const hash = generateKeccakHash(mintingData.content);
                  setMintingData(prev => ({ ...prev, keccakHash: hash }));
                }}
                style={{
                  width: '32px',
                  height: '32px',
                  padding: 0,
                  background: 'transparent',
                  border: 'none',
                  color: theme.primaryColor
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 255, 255, 0.2)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <RefreshCw style={{ width: '14px', height: '14px' }} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(mintingData.keccakHash)}
                style={{
                  width: '32px',
                  height: '32px',
                  padding: 0,
                  background: 'transparent',
                  border: 'none',
                  color: theme.primaryColor
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 255, 255, 0.2)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <Copy style={{ width: '14px', height: '14px' }} />
              </Button>
            </div>
            <p style={{ color: theme.secondaryColor, fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>
              Auto-computed from file content
            </p>
          </div>

          {/* Validation Status */}
          <div style={{
            padding: '12px',
            borderRadius: '8px',
            border: `1px solid ${
              mintingData.isValidData 
                ? getStatusColor('success')
                : getStatusColor('error')
            }`,
            background: mintingData.isValidData 
              ? 'rgba(0, 255, 170, 0.1)' 
              : 'rgba(255, 68, 68, 0.1)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {mintingData.isValidData ? (
                <CheckCircle style={{ width: '16px', height: '16px', color: getStatusColor('success') }} />
              ) : (
                <AlertTriangle style={{ width: '16px', height: '16px', color: getStatusColor('error') }} />
              )}
              <span style={{ 
                color: mintingData.isValidData ? getStatusColor('success') : getStatusColor('error'),
                fontSize: '14px',
                fontFamily: 'Rajdhani, sans-serif'
              }}>
                {mintingData.isValidData ? 'All fields valid - Ready to mint!' : 'Please fill all fields correctly'}
              </span>
            </div>
          </div>

          {/* Minting Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
            <button
              onClick={() => mintOnNetwork(true)}
              disabled={mintingData.l1Status === 'minting' || !mintingData.isValidData}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '12px 16px',
                borderRadius: '8px',
                border: `1px solid ${mintingData.isValidData ? theme.borderColor : 'rgba(128, 128, 128, 0.5)'}`,
                background: mintingData.isValidData ? 'rgba(0, 255, 255, 0.2)' : 'rgba(128, 128, 128, 0.2)',
                color: mintingData.isValidData ? theme.primaryColor : 'rgba(128, 128, 128, 1)',
                transition: 'all 0.3s ease',
                cursor: mintingData.isValidData ? 'pointer' : 'not-allowed',
                fontFamily: 'Orbitron, monospace',
                fontSize: '12px',
                fontWeight: '600',
                opacity: mintingData.l1Status === 'minting' || !mintingData.isValidData ? 0.5 : 1
              }}
              onMouseEnter={(e) => {
                if (mintingData.isValidData && mintingData.l1Status !== 'minting') {
                  e.currentTarget.style.background = 'rgba(0, 255, 255, 0.3)'
                  e.currentTarget.style.boxShadow = `0 0 15px ${theme.primaryColor}40`
                }
              }}
              onMouseLeave={(e) => {
                if (mintingData.isValidData) {
                  e.currentTarget.style.background = 'rgba(0, 255, 255, 0.2)'
                  e.currentTarget.style.boxShadow = 'none'
                }
              }}
            >
              {getStatusIcon(mintingData.l1Status)}
              <span>Mint on L1 Ethereum</span>
            </button>
            
            <button
              onClick={() => mintOnNetwork(false)}
              disabled={mintingData.l2Status === 'minting' || !mintingData.isValidData}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '12px 16px',
                borderRadius: '8px',
                border: `1px solid ${mintingData.isValidData ? theme.borderColor : 'rgba(128, 128, 128, 0.5)'}`,
                background: mintingData.isValidData ? 'rgba(0, 255, 255, 0.2)' : 'rgba(128, 128, 128, 0.2)',
                color: mintingData.isValidData ? theme.primaryColor : 'rgba(128, 128, 128, 1)',
                transition: 'all 0.3s ease',
                cursor: mintingData.isValidData ? 'pointer' : 'not-allowed',
                fontFamily: 'Orbitron, monospace',
                fontSize: '12px',
                fontWeight: '600',
                opacity: mintingData.l2Status === 'minting' || !mintingData.isValidData ? 0.5 : 1
              }}
              onMouseEnter={(e) => {
                if (mintingData.isValidData && mintingData.l2Status !== 'minting') {
                  e.currentTarget.style.background = 'rgba(0, 255, 255, 0.3)'
                  e.currentTarget.style.boxShadow = `0 0 15px ${theme.primaryColor}40`
                }
              }}
              onMouseLeave={(e) => {
                if (mintingData.isValidData) {
                  e.currentTarget.style.background = 'rgba(0, 255, 255, 0.2)'
                  e.currentTarget.style.boxShadow = 'none'
                }
              }}
            >
              {getStatusIcon(mintingData.l2Status)}
              <span>Mint on L2 Scroll</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}