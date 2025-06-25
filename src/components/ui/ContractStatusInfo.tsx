// 🌀 Contract Status Info Component
// Shows users the current deployment status and what to expect

'use client';

import { useState, useEffect } from 'react';
import { Info, AlertTriangle, CheckCircle, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ContractStatusInfoProps {
  isVisible: boolean;
  onClose: () => void;
}

export default function ContractStatusInfo({ isVisible, onClose }: ContractStatusInfoProps) {
  
  if (!isVisible) return null;

  return (
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
      zIndex: 1000,
      padding: '20px'
    }}>
      <div style={{
        background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%)',
        border: '1px solid rgba(0, 255, 255, 0.3)',
        borderRadius: '12px',
        padding: '30px',
        maxWidth: '600px',
        width: '100%',
        color: '#00ffff',
        fontFamily: 'Orbitron, monospace'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px'
        }}>
          <h2 style={{
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '18px'
          }}>
            <Info style={{ width: '20px', height: '20px' }} />
            Smart Contract Deployment Status
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#00ffff',
              cursor: 'pointer',
              fontSize: '20px'
            }}
          >
            ×
          </button>
        </div>

        {/* Current Status */}
        <div style={{
          background: 'rgba(255, 200, 0, 0.1)',
          border: '1px solid rgba(255, 200, 0, 0.3)',
          borderRadius: '8px',
          padding: '15px',
          marginBottom: '20px'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '10px'
          }}>
            <AlertTriangle style={{ width: '16px', height: '16px', color: '#ffc800' }} />
            <span style={{ fontWeight: 'bold', color: '#ffc800' }}>Contract Deployment In Progress</span>
          </div>
          <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.5', opacity: 0.9 }}>
            The ScrollMinter smart contracts are currently being prepared for deployment on Ethereum and Scroll networks. 
            During this phase, the system operates in <strong>demonstration mode</strong> to show you exactly how the minting process will work.
          </p>
        </div>

        {/* What This Means */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ 
            margin: '0 0 15px 0', 
            fontSize: '16px',
            color: '#00ff88'
          }}>
            What This Means:
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <CheckCircle style={{ width: '14px', height: '14px', color: '#00ff88' }} />
              <span style={{ fontSize: '14px' }}>All Web3 integration code is production-ready</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <CheckCircle style={{ width: '14px', height: '14px', color: '#00ff88' }} />
              <span style={{ fontSize: '14px' }}>MetaMask integration works perfectly</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <CheckCircle style={{ width: '14px', height: '14px', color: '#00ff88' }} />
              <span style={{ fontSize: '14px' }}>Transaction simulation provides realistic experience</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AlertTriangle style={{ width: '14px', height: '14px', color: '#ffc800' }} />
              <span style={{ fontSize: '14px' }}>Demo transactions don't cost real ETH</span>
            </div>
          </div>
        </div>

        {/* Network Information */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ 
            margin: '0 0 15px 0', 
            fontSize: '16px',
            color: '#00ff88'
          }}>
            Target Networks:
          </h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{
              background: 'rgba(0, 255, 255, 0.1)',
              border: '1px solid rgba(0, 255, 255, 0.3)',
              borderRadius: '6px',
              padding: '10px',
              fontSize: '12px'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>L1 Ethereum</div>
              <div style={{ opacity: 0.8 }}>Mainnet (Chain ID: 1)</div>
              <div style={{ opacity: 0.8, fontSize: '11px', marginTop: '5px' }}>
                Contract: 0x2C1f...C6D
              </div>
            </div>
            
            <div style={{
              background: 'rgba(0, 255, 255, 0.1)',
              border: '1px solid rgba(0, 255, 255, 0.3)',
              borderRadius: '6px',
              padding: '10px',
              fontSize: '12px'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>L2 Scroll</div>
              <div style={{ opacity: 0.8 }}>Mainnet (Chain ID: 534352)</div>
              <div style={{ opacity: 0.8, fontSize: '11px', marginTop: '5px' }}>
                Contract: 0x421B...034
              </div>
            </div>
          </div>
        </div>

        {/* Demo Mode Features */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ 
            margin: '0 0 15px 0', 
            fontSize: '16px',
            color: '#00ff88'
          }}>
            Demo Mode Features:
          </h3>
          
          <ul style={{ 
            margin: 0, 
            paddingLeft: '20px', 
            fontSize: '14px', 
            lineHeight: '1.6',
            opacity: 0.9
          }}>
            <li>Realistic transaction simulation with hash generation</li>
            <li>Gas estimation and network switching logic</li>
            <li>Proper error handling and user feedback</li>
            <li>All validation and security checks active</li>
            <li>Complete IPFS integration for metadata storage</li>
          </ul>
        </div>

        {/* Next Steps */}
        <div style={{
          background: 'rgba(0, 255, 136, 0.1)',
          border: '1px solid rgba(0, 255, 136, 0.3)',
          borderRadius: '8px',
          padding: '15px'
        }}>
          <h3 style={{ 
            margin: '0 0 10px 0', 
            fontSize: '16px',
            color: '#00ff88'
          }}>
            When Contracts Deploy:
          </h3>
          <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.5', opacity: 0.9 }}>
            Once the smart contracts are deployed to the target networks, the system will automatically 
            switch from demo mode to live blockchain transactions. No code changes will be required.
          </p>
        </div>

        {/* Close Button */}
        <div style={{ textAlign: 'center', marginTop: '25px' }}>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(0, 255, 255, 0.2)',
              border: '1px solid rgba(0, 255, 255, 0.5)',
              borderRadius: '6px',
              color: '#00ffff',
              padding: '10px 20px',
              cursor: 'pointer',
              fontFamily: 'Orbitron, monospace',
              fontSize: '14px'
            }}
          >
            Got It!
          </button>
        </div>
      </div>
    </div>
  );
}
