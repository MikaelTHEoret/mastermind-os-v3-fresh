import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// Smart contract configuration
const CONTRACT_ADDRESS = process.env.SOVEREIGN_SUBSCRIPTION_CONTRACT || '';
const CONTRACT_ABI = [
  // Core subscription functions
  "function ascendToTier(uint8 newTier, address paymentToken) external payable",
  "function calculateDiscountedPrice(uint8 tier, address token, address seeker) external view returns (uint256)",
  "function getSeekerInfo(address seeker) external view returns (tuple(address seeker, uint8 currentTier, uint256 ascensionTimestamp, uint256 expiresAt, uint256 wisdomEarned, bytes32 sanctumId, address paymentToken, bool autoRenewal, bool active))",
  "function isSubscriptionActive(address seeker) external view returns (bool)",
  
  // Tier info
  "function getTierInfo(uint8 tier) external view returns (tuple(string name, string glyph, string essence, uint256 ethPrice, uint256 usdcPrice, uint256 kbtPrice, bool requiresPrevious))",
  
  // Events
  "event SovereignAscension(address indexed seeker, uint8 newTier, string tierName, bytes32 sanctumId)",
  "event PaymentProcessed(address indexed seeker, address token, uint256 amount, uint8 tier)"
];

// Token addresses (mainnet)
const TOKEN_ADDRESSES = {
  ETH: ethers.ZeroAddress,
  USDC: '0xA0b86a33E6441051820b05B2E2706D8e8F6c5106', // USDC on mainnet
  DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',  // DAI on mainnet
  KBT: process.env.KBT_TOKEN_ADDRESS || '' // Our KBT token
};

// Tier mapping
const TIER_ENUM = {
  INITIATE: 0,
  ADEPT: 1,
  KEEPER: 2,
  SOVEREIGN: 3
};

interface SubscriptionRequest {
  tier: keyof typeof TIER_ENUM;
  paymentToken: keyof typeof TOKEN_ADDRESSES;
  userAddress: string;
}

interface PriceQuoteRequest {
  tier: keyof typeof TIER_ENUM;
  paymentToken: keyof typeof TOKEN_ADDRESSES;
  userAddress: string;
}

// GET /api/subscription/tiers - Get all tier information
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const userAddress = searchParams.get('address');

    if (action === 'user-info' && userAddress) {
      return getUserSubscriptionInfo(userAddress);
    }

    if (action === 'tiers') {
      return getAllTierInfo();
    }

    if (action === 'price-quote') {
      const tier = searchParams.get('tier') as keyof typeof TIER_ENUM;
      const token = searchParams.get('token') as keyof typeof TOKEN_ADDRESSES;
      
      if (!tier || !token || !userAddress) {
        return NextResponse.json(
          { error: 'Missing required parameters: tier, token, address' },
          { status: 400 }
        );
      }

      return getPriceQuote({ tier, paymentToken: token, userAddress });
    }

    return NextResponse.json({ error: 'Invalid action parameter' }, { status: 400 });

  } catch (error) {
    console.error('Subscription API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/subscription - Create or upgrade subscription
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: SubscriptionRequest = await request.json();
    const { tier, paymentToken, userAddress } = body;

    // Validate inputs
    if (!tier || !paymentToken || !userAddress) {
      return NextResponse.json(
        { error: 'Missing required fields: tier, paymentToken, userAddress' },
        { status: 400 }
      );
    }

    if (!(tier in TIER_ENUM)) {
      return NextResponse.json(
        { error: 'Invalid tier' },
        { status: 400 }
      );
    }

    if (!(paymentToken in TOKEN_ADDRESSES)) {
      return NextResponse.json(
        { error: 'Invalid payment token' },
        { status: 400 }
      );
    }

    // Get price quote
    const priceQuote = await getPriceQuote({ tier, paymentToken, userAddress });
    if (!priceQuote.ok) {
      return priceQuote;
    }

    const priceData = await priceQuote.json();

    // Prepare transaction data for client-side execution
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

    // Encode function call
    const tierEnum = TIER_ENUM[tier];
    const tokenAddress = TOKEN_ADDRESSES[paymentToken];
    
    const txData = contract.interface.encodeFunctionData('ascendToTier', [
      tierEnum,
      tokenAddress
    ]);

    return NextResponse.json({
      success: true,
      transaction: {
        to: CONTRACT_ADDRESS,
        data: txData,
        value: paymentToken === 'ETH' ? priceData.price : '0',
        gasLimit: '300000' // Estimated gas limit
      },
      priceInfo: priceData,
      tier: {
        name: tier,
        enum: tierEnum,
        token: paymentToken,
        tokenAddress
      }
    });

  } catch (error) {
    console.error('Subscription creation error:', error);
    return NextResponse.json(
      { error: 'Failed to create subscription' },
      { status: 500 }
    );
  }
}

// Helper function to get user subscription info
async function getUserSubscriptionInfo(userAddress: string) {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

    const [seekerInfo, isActive] = await Promise.all([
      contract.getSeekerInfo(userAddress),
      contract.isSubscriptionActive(userAddress)
    ]);

    const tierNames = ['INITIATE', 'ADEPT', 'KEEPER', 'SOVEREIGN'];
    const currentTierName = tierNames[seekerInfo.currentTier] || 'INITIATE';

    return NextResponse.json({
      success: true,
      subscription: {
        userAddress,
        currentTier: currentTierName,
        tierEnum: seekerInfo.currentTier,
        ascensionTimestamp: seekerInfo.ascensionTimestamp.toString(),
        expiresAt: seekerInfo.expiresAt.toString(),
        wisdomEarned: seekerInfo.wisdomEarned.toString(),
        sanctumId: seekerInfo.sanctumId,
        paymentToken: seekerInfo.paymentToken,
        autoRenewal: seekerInfo.autoRenewal,
        active: isActive,
        isExpired: Date.now() > Number(seekerInfo.expiresAt) * 1000
      }
    });

  } catch (error) {
    console.error('Error fetching user subscription:', error);
    return NextResponse.json(
      { error: 'Failed to fetch subscription info' },
      { status: 500 }
    );
  }
}

// Helper function to get all tier information
async function getAllTierInfo() {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

    const tiers = [];
    for (let i = 0; i < 4; i++) {
      const tierInfo = await contract.getTierInfo(i);
      tiers.push({
        enum: i,
        name: tierInfo.name,
        glyph: tierInfo.glyph,
        essence: tierInfo.essence,
        ethPrice: ethers.formatEther(tierInfo.ethPrice),
        usdcPrice: ethers.formatUnits(tierInfo.usdcPrice, 6),
        kbtPrice: ethers.formatEther(tierInfo.kbtPrice),
        requiresPrevious: tierInfo.requiresPrevious
      });
    }

    return NextResponse.json({
      success: true,
      tiers,
      tokenAddresses: TOKEN_ADDRESSES
    });

  } catch (error) {
    console.error('Error fetching tier info:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tier information' },
      { status: 500 }
    );
  }
}

// Helper function to get price quote with discounts
async function getPriceQuote({ tier, paymentToken, userAddress }: PriceQuoteRequest) {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

    const tierEnum = TIER_ENUM[tier];
    const tokenAddress = TOKEN_ADDRESSES[paymentToken];

    const [price, tierInfo] = await Promise.all([
      contract.calculateDiscountedPrice(tierEnum, tokenAddress, userAddress),
      contract.getTierInfo(tierEnum)
    ]);

    // Format price based on token
    let formattedPrice: string;
    let decimals: number;
    
    switch (paymentToken) {
      case 'ETH':
      case 'KBT':
      case 'DAI':
        formattedPrice = ethers.formatEther(price);
        decimals = 18;
        break;
      case 'USDC':
        formattedPrice = ethers.formatUnits(price, 6);
        decimals = 6;
        break;
      default:
        throw new Error('Unsupported token');
    }

    // Calculate savings for KBT payments
    let savings = null;
    if (paymentToken === 'KBT') {
      const ethPrice = await contract.calculateDiscountedPrice(tierEnum, TOKEN_ADDRESSES.ETH, userAddress);
      const ethFormatted = ethers.formatEther(ethPrice);
      const currentEthPrice = 2500; // $2500 per ETH (could be fetched from oracle)
      const usdValue = parseFloat(ethFormatted) * currentEthPrice;
      const kbtUsdValue = parseFloat(formattedPrice) * (currentEthPrice / 50); // Assuming KBT ~= ETH/50
      savings = {
        percentage: 20,
        usdAmount: usdValue - kbtUsdValue,
        originalEthPrice: ethFormatted
      };
    }

    return NextResponse.json({
      success: true,
      price: price.toString(),
      formattedPrice,
      decimals,
      token: paymentToken,
      tokenAddress,
      tier: {
        name: tierInfo.name,
        glyph: tierInfo.glyph,
        essence: tierInfo.essence
      },
      savings,
      gasEstimate: '300000' // Estimated gas for transaction
    });

  } catch (error) {
    console.error('Error getting price quote:', error);
    return NextResponse.json(
      { error: 'Failed to get price quote' },
      { status: 500 }
    );
  }
}

// PUT /api/subscription - Update subscription settings
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { userAddress, autoRenewal } = body;

    // Here you would update subscription settings
    // For now, return success
    return NextResponse.json({
      success: true,
      message: 'Subscription settings updated',
      userAddress,
      autoRenewal
    });

  } catch (error) {
    console.error('Subscription update error:', error);
    return NextResponse.json(
      { error: 'Failed to update subscription' },
      { status: 500 }
    );
  }
}

// DELETE /api/subscription - Cancel subscription
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userAddress = searchParams.get('address');

    if (!userAddress) {
      return NextResponse.json(
        { error: 'User address required' },
        { status: 400 }
      );
    }

    // Here you would handle subscription cancellation
    // This might involve calling a contract function or just updating settings
    
    return NextResponse.json({
      success: true,
      message: 'Subscription cancelled',
      userAddress,
      refundPeriod: '7 days',
      dataExportAvailable: true
    });

  } catch (error) {
    console.error('Subscription cancellation error:', error);
    return NextResponse.json(
      { error: 'Failed to cancel subscription' },
      { status: 500 }
    );
  }
}