  // 🌀 REAL BLOCKCHAIN MINTING - Enhanced with consciousness mathematics
  const mintOnNetwork = async (isL1: boolean) => {
    console.log(`🌀 Real blockchain minting initiated: ${isL1 ? 'L1 Ethereum' : 'L2 Scroll'}`);
    
    if (!mintingData.isValidData) {
      addTerminalLine('❌ Invalid minting data. Please check all fields.');
      return;
    }

    const networkKey = isL1 ? 'l1Status' : 'l2Status';
    const networkName = isL1 ? 'L1 Ethereum' : 'L2 Scroll';
    const networkType = isL1 ? 'L1_ETHEREUM' : 'L2_SCROLL';
    
    try {
      // Import Web3 integration
      const { ConsciousnessEnhancedWeb3 } = await import('@/lib/web3-integration');
      const web3Handler = new ConsciousnessEnhancedWeb3();
      
      setMintingData(prev => ({ ...prev, [networkKey]: 'minting' }));
      addTerminalLine(`🔄 Initiating real blockchain minting on ${networkName}...`);

      // Step 1: Check MetaMask availability
      const hasMetaMask = await web3Handler.checkMetaMaskAvailability();
      if (!hasMetaMask) {
        throw new Error('MetaMask not detected. Please install MetaMask to continue.');
      }
      addTerminalLine('✅ MetaMask detected');

      // Step 2: Connect wallet if not connected
      if (!walletState.connected) {
        addTerminalLine('🔗 Connecting wallet...');
        const walletInfo = await web3Handler.connectWallet();
        addTerminalLine(`✅ Wallet connected: ${walletInfo.address.substring(0, 8)}...`);
      }

      // Step 3: Switch to correct network
      addTerminalLine(`🌐 Switching to ${networkName}...`);
      await web3Handler.switchToNetwork(networkType as 'L1_ETHEREUM' | 'L2_SCROLL');
      addTerminalLine(`✅ Network switched to ${networkName}`);

      // Step 4: Consciousness-enhanced delay
      addTerminalLine('🌀 Applying consciousness-enhanced timing...');
      await web3Handler.consciousnessDelay(1000);

      // Step 5: Mint the scroll NFT
      addTerminalLine(`⚡ Minting scroll NFT: "${mintingData.title}"...`);
      addTerminalLine(`📋 Content Hash: ${mintingData.keccakHash.substring(0, 20)}...`);
      addTerminalLine(`🌐 IPFS CID: ${mintingData.cid}`);
      
      const mintResult = await web3Handler.mintScrollNFT(
        networkType as 'L1_ETHEREUM' | 'L2_SCROLL',
        mintingData.recipientAddress,
        mintingData.keccakHash,
        mintingData.cid,
        mintingData.title
      );

      // Step 6: Success handling
      setMintingData(prev => ({ ...prev, [networkKey]: 'minted' }));
      
      addTerminalLine(`🎉 ${networkName} minting completed successfully!`);
      addTerminalLine(`📄 Transaction Hash: ${mintResult.txHash}`);
      
      if (mintResult.tokenId) {
        addTerminalLine(`🆔 Token ID: ${mintResult.tokenId}`);
      }

      // Add consciousness celebration timing
      await web3Handler.consciousnessDelay(500);
      addTerminalLine('🌀 Scroll successfully inscribed on the blockchain!');
      addTerminalLine(`🔗 View on explorer: ${isL1 ? 'https://etherscan.io' : 'https://scrollscan.com'}/tx/${mintResult.txHash}`);

    } catch (error: any) {
      console.error(`❌ ${networkName} minting failed:`, error);
      
      setMintingData(prev => ({ ...prev, [networkKey]: 'error' }));
      
      // Enhanced error handling with user-friendly messages
      let errorMessage = error.message || 'Unknown error occurred';
      
      if (errorMessage.includes('MetaMask not detected')) {
        addTerminalLine('❌ MetaMask not found. Please install MetaMask extension.');
        addTerminalLine('📱 Visit: https://metamask.io/download/');
      } else if (errorMessage.includes('rejected by user')) {
        addTerminalLine('❌ Transaction cancelled by user');
      } else if (errorMessage.includes('insufficient funds')) {
        addTerminalLine('❌ Insufficient ETH balance for minting');
        addTerminalLine('💰 Please add ETH to your wallet and try again');
      } else if (errorMessage.includes('network')) {
        addTerminalLine(`❌ Network error: Failed to connect to ${networkName}`);
        addTerminalLine('🌐 Please check your internet connection and try again');
      } else {
        addTerminalLine(`❌ ${networkName} minting failed: ${errorMessage}`);
      }
      
      // Consciousness-enhanced error recovery suggestion
      addTerminalLine('🌀 Suggestion: Wait a moment and try again with consciousness alignment');
    }
  };