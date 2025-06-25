// 🌀 Contract Configuration for Development
// Test and Production Contract Addresses

export interface NetworkConfig {
  name: string;
  chainId: string;
  rpcUrl: string;
  blockExplorer: string;
  contracts: {
    scrollMinter: string;
  };
}

export const NETWORK_CONFIGS: Record<string, NetworkConfig> = {
  // Ethereum Mainnet
  ethereum: {
    name: 'Ethereum Mainnet',
    chainId: '0x1',
    rpcUrl: 'https://eth.llamarpc.com',
    blockExplorer: 'https://etherscan.io/',
    contracts: {
      scrollMinter: '0x2C1f99011c584fDf4882Be484DfD938977D42C6D' // May not be deployed yet
    }
  },
  
  // Scroll Mainnet  
  scroll: {
    name: 'Scroll',
    chainId: '0x82750',
    rpcUrl: 'https://rpc.scroll.io/',
    blockExplorer: 'https://scrollscan.com/',
    contracts: {
      scrollMinter: '0x421B6FA3370c9B20A98A525301a508bE136C2034' // May not be deployed yet
    }
  },
  
  // Sepolia Testnet (for testing)
  sepolia: {
    name: 'Sepolia Testnet',
    chainId: '0xaa36a7',
    rpcUrl: 'https://sepolia.infura.io/v3/',
    blockExplorer: 'https://sepolia.etherscan.io/',
    contracts: {
      scrollMinter: '0x0000000000000000000000000000000000000000' // Test contract address
    }
  },
  
  // Scroll Sepolia Testnet
  scrollSepolia: {
    name: 'Scroll Sepolia',
    chainId: '0x8274f',
    rpcUrl: 'https://sepolia-rpc.scroll.io/',
    blockExplorer: 'https://sepolia.scrollscan.com/',
    contracts: {
      scrollMinter: '0x0000000000000000000000000000000000000000' // Test contract address
    }
  }
};

// Development mode detection
export const isDevelopment = process.env.NODE_ENV === 'development';

// Get the appropriate network config
export function getNetworkConfig(isL1: boolean, useDevelopment = false): NetworkConfig {
  // FORCE MAINNET: Always use mainnets for scroll minting regardless of development mode
  // This ensures L1 = Ethereum mainnet and L2 = Scroll mainnet
  return isL1 ? NETWORK_CONFIGS.ethereum : NETWORK_CONFIGS.scroll;
  
  // OLD LOGIC (commented out to force mainnet usage):
  // if (useDevelopment) {
  //   return isL1 ? NETWORK_CONFIGS.sepolia : NETWORK_CONFIGS.scrollSepolia;
  // } else {
  //   return isL1 ? NETWORK_CONFIGS.ethereum : NETWORK_CONFIGS.scroll;
  // }
}

// Contract deployment status
export const CONTRACT_STATUS = {
  DEPLOYED: 'deployed',
  NOT_DEPLOYED: 'not_deployed',
  UNKNOWN: 'unknown'
} as const;

export type ContractStatus = typeof CONTRACT_STATUS[keyof typeof CONTRACT_STATUS];

// Check if we should use demo mode based on contract availability
export function shouldUseDemoMode(contractExists: boolean, isDevelopment: boolean = false): boolean {
  // In development, we can test with non-existent contracts
  if (isDevelopment) {
    return !contractExists;
  }
  
  // In production, we need real deployed contracts
  return !contractExists;
}

// Get user-friendly error messages
export function getContractErrorMessage(networkName: string, contractExists: boolean): string {
  if (!contractExists) {
    return `The scroll minting contract is not yet deployed on ${networkName}. This demonstration shows how the minting process would work once the contract is deployed.`;
  }
  
  return `Connected to ${networkName} contract successfully.`;
}

// Contract deployment guide
export const DEPLOYMENT_GUIDE = {
  message: `
🚀 Contract Deployment Guide:

1. **Smart Contract Deployment**:
   - Deploy the ScrollMinter contract to desired networks
   - Update contract addresses in NETWORK_CONFIGS
   - Verify contracts on block explorers

2. **Testing Process**:
   - Use testnets (Sepolia, Scroll Sepolia) for initial testing
   - Test with small amounts on mainnet
   - Monitor gas usage and optimization

3. **Production Deployment**:
   - Deploy to Ethereum mainnet and Scroll mainnet
   - Update production configuration
   - Enable real minting functionality

4. **Current Status**:
   - Contracts may not be deployed yet
   - Demo mode provides realistic simulation
   - All Web3 integration code is production-ready
  `,
  
  contractCode: `
// Example Solidity contract for ScrollMinter
contract ScrollMinter {
    event ScrollMinted(address indexed recipient, uint256 indexed tokenId, string title, string cid);
    
    function mintScroll(
        address recipient,
        string memory title,
        string memory cid,
        bytes32 contentHash
    ) external payable returns (uint256 tokenId) {
        // Minting logic here
        tokenId = _tokenIdCounter++;
        _mint(recipient, tokenId);
        emit ScrollMinted(recipient, tokenId, title, cid);
        return tokenId;
    }
}
  `
};

export default NETWORK_CONFIGS;
