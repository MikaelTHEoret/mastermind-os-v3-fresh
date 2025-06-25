# 🌀 Sovereign Scrolls Deployment Guide

## Quick Start - Deploy Your Contract

### Option 1: Deploy on Sepolia Testnet (Recommended First)

1. **Get Sepolia ETH**:
   - Go to https://sepoliafaucet.com/
   - Enter your wallet address
   - Get free testnet ETH

2. **Deploy via Remix IDE**:
   - Go to https://remix.ethereum.org/
   - Create new file: `SovereignScrolls.sol`
   - Copy the contract code from `contracts/SovereignScrolls.sol`
   - Compile with Solidity 0.8.19+
   - Deploy to Sepolia testnet
   - Copy the deployed contract address

3. **Update Your Config**:
   ```typescript
   // In src/lib/web3/scroll-contracts.ts
   L1_SEPOLIA: {
     contractAddress: 'YOUR_DEPLOYED_CONTRACT_ADDRESS_HERE',
     // ... rest stays the same
   }
   ```

### Option 2: Deploy via Hardhat (Advanced)

1. **Install Dependencies**:
   ```bash
   npm install --save-dev hardhat @openzeppelin/contracts
   npx hardhat init
   ```

2. **Configure Hardhat**:
   ```javascript
   // hardhat.config.js
   require("@nomicfoundation/hardhat-toolbox");
   
   module.exports = {
     solidity: "0.8.19",
     networks: {
       sepolia: {
         url: "https://rpc.sepolia.org",
         accounts: ["YOUR_PRIVATE_KEY_HERE"] // Never commit this!
       }
     }
   };
   ```

3. **Deploy Script**:
   ```javascript
   // scripts/deploy.js
   async function main() {
     const SovereignScrolls = await ethers.getContractFactory("SovereignScrolls");
     const scrolls = await SovereignScrolls.deploy();
     await scrolls.deployed();
     
     console.log("SovereignScrolls deployed to:", scrolls.address);
   }
   
   main().catch((error) => {
     console.error(error);
     process.exitCode = 1;
   });
   ```

4. **Deploy**:
   ```bash
   npx hardhat run scripts/deploy.js --network sepolia
   ```

## Contract Features

### ✅ What Works Now:
- Standard ERC721 NFT minting
- IPFS metadata storage
- Consciousness-enhanced signatures
- 0.001 ETH minting fee
- Owner controls (withdraw, set fees)

### 🌀 Consciousness Constants:
- ψ₀ = 0.915670570874434 (built into contract)
- φ = 1.618 (golden ratio scaling)
- 432Hz = base harmonic frequency

### 📝 Contract Methods:
```solidity
// Main minting function
function mintScroll(
    address to,
    bytes32 contentHash,
    string memory ipfsCid,
    string memory title
) public payable returns (uint256)

// Simple mint for basic usage
function safeMint(address to, string memory uri) public payable returns (uint256)

// Get scroll data
function getScrollData(uint256 tokenId) public view returns (ScrollData memory)
```

## Testing Your Deployment

1. **Connect to Sepolia in MetaMask**
2. **Use your local app** - it will detect the contract
3. **Try minting a scroll** - should work without demo mode
4. **Check on Sepolia Etherscan** to verify transaction

## Production Deployment

Once tested on Sepolia:

1. **Deploy to Ethereum Mainnet** (costs real ETH)
2. **Deploy to Scroll L2** (cheaper alternative)
3. **Update contract addresses** in your config
4. **Test with small amounts first**

## Contract Verification

After deployment, verify on Etherscan:
1. Go to your contract on Etherscan
2. Click "Contract" tab
3. Click "Verify and Publish"
4. Upload your Solidity code
5. Users can then read the contract easily

## Troubleshooting

- **"Contract not deployed"**: Check the contract address is correct
- **"Insufficient minting fee"**: Ensure you're sending at least 0.001 ETH
- **Gas estimation failed**: Contract might not exist at that address
- **MetaMask rejection**: User cancelled or insufficient funds

Your app is now ready for real blockchain minting! 🌀✨
