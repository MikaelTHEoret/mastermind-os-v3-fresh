// 🌀 Web3 Integration Test Page
// Development testing page for blockchain integration

'use client';

import { useState, useEffect } from 'react';
import { runWeb3Tests } from '@/test/web3-integration-test';
import { ScrollMintingContract, scrollMinter } from '@/lib/web3/scroll-contracts';

interface TestStatus {
  running: boolean;
  results: any[];
  error?: string;
}

export default function Web3TestPage() {
  const [testStatus, setTestStatus] = useState<TestStatus>({
    running: false,
    results: []
  });
  
  const [contractInfo, setContractInfo] = useState({
    l1Address: '',
    l2Address: '',
    hasWeb3: false,
    isConnected: false
  });

  useEffect(() => {
    // Load contract info
    const info = {
      l1Address: '0x2C1f99011c584fDf4882Be484DfD938977D42C6D',
      l2Address: '0x421B6FA3370c9B20A98A525301a508bE136C2034',
      hasWeb3: typeof window !== 'undefined' && !!(window as any).ethereum,
      isConnected: false
    };
    
    setContractInfo(info);
  }, []);

  const runTests = async () => {
    setTestStatus({ running: true, results: [] });
    
    try {
      const results = await runWeb3Tests();
      setTestStatus({ 
        running: false, 
        results 
      });
    } catch (error: any) {
      setTestStatus({ 
        running: false, 
        results: [], 
        error: error.message 
      });
    }
  };

  const testValidation = () => {
    const validAddress = '0x4575a90d54785323546f2bb4a520622ed6d3efbc';
    const invalidAddress = '0x123';
    const validCID = 'bafkreiabcd1234567890abcdef';
    const invalidCID = 'invalid';
    
    console.log('Address validation tests:');
    console.log(`Valid address (${validAddress}):`, ScrollMintingContract.isValidAddress(validAddress));
    console.log(`Invalid address (${invalidAddress}):`, ScrollMintingContract.isValidAddress(invalidAddress));
    
    console.log('CID validation tests:');
    console.log(`Valid CID (${validCID}):`, ScrollMintingContract.isValidCID(validCID));
    console.log(`Invalid CID (${invalidCID}):`, ScrollMintingContract.isValidCID(invalidCID));
  };

  const simulateMinting = async () => {
    console.log('🔄 Simulating minting process...');
    
    const mockParams = {
      recipientAddress: '0x4575a90d54785323546f2bb4a520622ed6d3efbc',
      title: 'Test Scroll',
      cid: 'bafkreiabcd1234567890abcdef',
      keccakHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    };
    
    console.log('Mock minting parameters:', mockParams);
    console.log('✅ Minting simulation complete');
  };

  return (
    <div style={{ 
      padding: '20px', 
      maxWidth: '800px', 
      margin: '0 auto',
      fontFamily: 'Orbitron, monospace',
      background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%)',
      minHeight: '100vh',
      color: '#00ffff'
    }}>
      <h1 style={{ 
        textAlign: 'center', 
        marginBottom: '30px',
        textShadow: '0 0 10px #00ffff50'
      }}>
        🌀 Web3 Integration Test Console
      </h1>
      
      {/* Contract Information */}
      <div style={{
        background: 'rgba(0, 255, 255, 0.1)',
        border: '1px solid rgba(0, 255, 255, 0.3)',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px'
      }}>
        <h2 style={{ marginBottom: '15px' }}>📋 Contract Configuration</h2>
        <div style={{ display: 'grid', gap: '10px', fontFamily: 'Courier New, monospace', fontSize: '14px' }}>
          <div>L1 Contract: <span style={{ color: '#00ff88' }}>{contractInfo.l1Address}</span></div>
          <div>L2 Contract: <span style={{ color: '#00ff88' }}>{contractInfo.l2Address}</span></div>
          <div>Web3 Available: <span style={{ color: contractInfo.hasWeb3 ? '#00ff88' : '#ff4444' }}>
            {contractInfo.hasWeb3 ? '✅ Yes' : '❌ No'}
          </span></div>
        </div>
      </div>

      {/* Test Controls */}
      <div style={{
        background: 'rgba(0, 255, 255, 0.1)',
        border: '1px solid rgba(0, 255, 255, 0.3)',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px'
      }}>
        <h2 style={{ marginBottom: '15px' }}>🧪 Test Controls</h2>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={runTests}
            disabled={testStatus.running}
            style={{
              padding: '10px 20px',
              background: 'rgba(0, 255, 255, 0.2)',
              border: '1px solid rgba(0, 255, 255, 0.5)',
              borderRadius: '6px',
              color: '#00ffff',
              cursor: 'pointer',
              fontFamily: 'Orbitron, monospace',
              opacity: testStatus.running ? 0.5 : 1
            }}
          >
            {testStatus.running ? '🔄 Running...' : '🚀 Run All Tests'}
          </button>
          
          <button
            onClick={testValidation}
            style={{
              padding: '10px 20px',
              background: 'rgba(0, 255, 255, 0.2)',
              border: '1px solid rgba(0, 255, 255, 0.5)',
              borderRadius: '6px',
              color: '#00ffff',
              cursor: 'pointer',
              fontFamily: 'Orbitron, monospace'
            }}
          >
            🔍 Test Validation
          </button>
          
          <button
            onClick={simulateMinting}
            style={{
              padding: '10px 20px',
              background: 'rgba(0, 255, 255, 0.2)',
              border: '1px solid rgba(0, 255, 255, 0.5)',
              borderRadius: '6px',
              color: '#00ffff',
              cursor: 'pointer',
              fontFamily: 'Orbitron, monospace'
            }}
          >
            ⚡ Simulate Minting
          </button>
        </div>
      </div>

      {/* Test Results */}
      {testStatus.results.length > 0 && (
        <div style={{
          background: 'rgba(0, 255, 255, 0.1)',
          border: '1px solid rgba(0, 255, 255, 0.3)',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <h2 style={{ marginBottom: '15px' }}>📊 Test Results</h2>
          <div style={{ display: 'grid', gap: '10px' }}>
            {testStatus.results.map((result, index) => (
              <div key={index} style={{
                padding: '10px',
                background: result.passed ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255, 68, 68, 0.1)',
                border: `1px solid ${result.passed ? 'rgba(0, 255, 136, 0.3)' : 'rgba(255, 68, 68, 0.3)'}`,
                borderRadius: '4px',
                fontSize: '14px'
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
                  {result.passed ? '✅' : '❌'} {result.name}
                </div>
                <div style={{ opacity: 0.8 }}>{result.message}</div>
              </div>
            ))}
          </div>
          
          {/* Summary */}
          <div style={{ 
            marginTop: '15px', 
            padding: '10px',
            background: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '4px',
            textAlign: 'center'
          }}>
            <strong>
              Summary: {testStatus.results.filter(r => r.passed).length}/{testStatus.results.length} tests passed
            </strong>
          </div>
        </div>
      )}

      {/* Error Display */}
      {testStatus.error && (
        <div style={{
          background: 'rgba(255, 68, 68, 0.1)',
          border: '1px solid rgba(255, 68, 68, 0.3)',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <h2 style={{ marginBottom: '15px', color: '#ff4444' }}>❌ Error</h2>
          <div style={{ fontFamily: 'Courier New, monospace', fontSize: '14px' }}>
            {testStatus.error}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.1)',
        border: '1px solid rgba(255, 255, 255, 0.3)',
        borderRadius: '8px',
        padding: '20px'
      }}>
        <h2 style={{ marginBottom: '15px' }}>📖 Instructions</h2>
        <div style={{ fontSize: '14px', lineHeight: '1.6' }}>
          <p>1. <strong>Run All Tests</strong>: Executes comprehensive validation of the Web3 integration</p>
          <p>2. <strong>Test Validation</strong>: Tests address and CID validation functions (check console)</p>
          <p>3. <strong>Simulate Minting</strong>: Simulates the minting process without blockchain interaction</p>
          <p>4. Open browser DevTools console for detailed logs</p>
          <p>5. To test real minting, use the main Scrolls section with MetaMask connected</p>
        </div>
      </div>
    </div>
  );
}
