import { NextRequest, NextResponse } from 'next/server';
import { getIronSession, IronSession } from 'iron-session';
import CryptoJS from 'crypto-js';

// Define session data interface
interface SessionData {
  userId?: string;
  username?: string;
  email?: string;
}

const sessionOptions = {
  password: process.env.SECRET_KEY!,
  cookieName: 'mastermind-session',
  ttl: 60 * 60 * 24 * 7, // 7 days
};

// Contract configurations with proper typing
type NetworkKey = 'L1' | 'L2';

const CONTRACTS: Record<NetworkKey, {
  address: string;
  network: string;
  chainId: string;
  rpcUrl: string;
  explorerUrl: string;
}> = {
  L1: {
    address: '0x2C1f99011c584fDf4882Be484DfD938977D42C6D',
    network: 'ethereum',
    chainId: '0x1',
    rpcUrl: 'https://ethereum.publicnode.com',
    explorerUrl: 'https://etherscan.io/tx/'
  },
  L2: {
    address: '0x421B6FA3370c9B20A98A525301a508bE136C2034',
    network: 'scroll',
    chainId: '0x82750',
    rpcUrl: 'https://rpc.scroll.io/',
    explorerUrl: 'https://scrollscan.com/tx/'
  }
};

const CONTRACT_ABI = [
  "function mint(address recipient, string memory cid, string memory title, bytes32 hash) external payable",
  "event ScrollMinted(address indexed recipient, string cid, string title, bytes32 hash, uint256 timestamp)"
];

export async function POST(request: NextRequest) {
  try {
    const session = await getIronSession<SessionData>(request, new Response(), sessionOptions);
    
    if (!session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      network, 
      recipient, 
      cid, 
      title, 
      hash,
      walletAddress,
      signature // For verification that user owns the wallet
    } = await request.json();

    // Validate required parameters
    if (!network || !recipient || !cid || !title || !hash) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Validate network with type-safe access
    const networkKey = network.toUpperCase() as NetworkKey;
    if (!CONTRACTS[networkKey]) {
      return NextResponse.json(
        { error: 'Invalid network. Use L1 or L2' },
        { status: 400 }
      );
    }

    // Validate address format
    if (!isValidEthereumAddress(recipient)) {
      return NextResponse.json(
        { error: 'Invalid recipient address' },
        { status: 400 }
      );
    }

    // Validate IPFS CID format
    if (!isValidIPFSCID(cid)) {
      return NextResponse.json(
        { error: 'Invalid IPFS CID format' },
        { status: 400 }
      );
    }

    // Validate hash format
    if (!isValidKeccakHash(hash)) {
      return NextResponse.json(
        { error: 'Invalid Keccak256 hash format' },
        { status: 400 }
      );
    }

    const contractConfig = CONTRACTS[networkKey];

    // Create minting transaction data
    const mintingData = {
      contractAddress: contractConfig.address,
      network: contractConfig.network,
      chainId: contractConfig.chainId,
      function: 'mint',
      parameters: {
        recipient,
        cid,
        title,
        hash
      },
      gasEstimate: network.toUpperCase() === 'L1' ? 200000 : 150000,
      explorerUrl: contractConfig.explorerUrl
    };

    // Log the minting attempt
    await logUserActivity(session.userId, 'scroll_mint_prepared', {
      network: contractConfig.network,
      contract: contractConfig.address,
      recipient,
      cid,
      title: title.substring(0, 100), // Limit for logging
      user_wallet: walletAddress,
      timestamp: new Date().toISOString()
    });

    // Return transaction data for frontend to execute
    return NextResponse.json({
      success: true,
      mintingData,
      message: `Minting data prepared for ${contractConfig.network}`,
      instructions: {
        contract: contractConfig.address,
        network: contractConfig.network,
        chainId: contractConfig.chainId,
        rpcUrl: contractConfig.rpcUrl,
        abi: CONTRACT_ABI
      }
    });

  } catch (error) {
    console.error('Minting preparation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to prepare minting' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getIronSession<SessionData>(request, new Response(), sessionOptions);
    
    if (!session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      network, 
      transactionHash, 
      recipient, 
      cid, 
      title,
      gasUsed,
      gasPrice,
      blockNumber 
    } = await request.json();

    if (!network || !transactionHash) {
      return NextResponse.json(
        { error: 'Network and transaction hash are required' },
        { status: 400 }
      );
    }

    const networkKey = network.toUpperCase() as NetworkKey;
    const contractConfig = CONTRACTS[networkKey];
    if (!contractConfig) {
      return NextResponse.json(
        { error: 'Invalid network' },
        { status: 400 }
      );
    }

    // Log successful minting
    await logUserActivity(session.userId, 'scroll_mint_completed', {
      network: contractConfig.network,
      contract: contractConfig.address,
      transaction_hash: transactionHash,
      recipient,
      cid,
      title: title?.substring(0, 100),
      gas_used: gasUsed,
      gas_price: gasPrice,
      block_number: blockNumber,
      explorer_url: contractConfig.explorerUrl + transactionHash,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      message: `Minting completed on ${contractConfig.network}`,
      transactionHash,
      explorerUrl: contractConfig.explorerUrl + transactionHash,
      network: contractConfig.network
    });

  } catch (error) {
    console.error('Minting completion error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to record minting completion' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getIronSession<SessionData>(request, new Response(), sessionOptions);
    
    if (!session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Return user's minting history and available networks
    return NextResponse.json({
      success: true,
      networks: {
        L1: {
          name: 'Ethereum Mainnet',
          contract: CONTRACTS.L1.address,
          chainId: CONTRACTS.L1.chainId,
          explorer: 'https://etherscan.io/',
          status: 'active'
        },
        L2: {
          name: 'Scroll Mainnet',
          contract: CONTRACTS.L2.address,
          chainId: CONTRACTS.L2.chainId,
          explorer: 'https://scrollscan.com/',
          status: 'active'
        }
      },
      gasEstimates: {
        L1: '200,000 gas (~$20-40)',
        L2: '150,000 gas (~$1-5)'
      }
    });

  } catch (error) {
    console.error('Error fetching minting info:', error);
    return NextResponse.json(
      { error: 'Failed to fetch minting information' },
      { status: 500 }
    );
  }
}

// Validation helpers
function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function isValidIPFSCID(cid: string): boolean {
  // Basic IPFS CID validation
  return /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{56}|bafkrei[a-z2-7]{50})$/.test(cid);
}

function isValidKeccakHash(hash: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
}

async function logUserActivity(userId: string, action: string, details: any) {
  try {
    // This would integrate with your audit log system
    console.log(`User Activity: ${userId} - ${action}`, details);
  } catch (error) {
    console.error('Error logging user activity:', error);
  }
}
