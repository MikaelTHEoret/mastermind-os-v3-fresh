'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

interface TierInfo {
  id: 'INITIATE' | 'ADEPT' | 'KEEPER' | 'SOVEREIGN';
  name: string;
  glyph: string;
  essence: string;
  ethPrice: string;
  usdcPrice: string;
  kbtPrice: string;
  kbtDiscount: boolean;
  features: string[];
  philosophy: string;
  popular?: boolean;
  ultimate?: boolean;
}

interface UserKBTInfo {
  balance: number;
  earned: number;
  scrollsCreated: number;
  currentTier: string;
  canUpgrade: boolean;
}

const mysticalTiers: TierInfo[] = [
  {
    id: 'INITIATE',
    name: 'INITIATE - Seeker of Knowledge',
    glyph: '🔍',
    essence: 'Begin your journey into the mysteries',
    ethPrice: 'Free',
    usdcPrice: 'Free',
    kbtPrice: 'Free',
    kbtDiscount: false,
    features: [
      'Access to knowledge scrolls',
      'Community forums and learning',
      'Basic AI guidance',
      'Simple calculation tools'
    ],
    philosophy: 'Every master was once a beginner'
  },
  {
    id: 'ADEPT',
    name: 'ADEPT - Practitioner of the Arts',
    glyph: '⚗️',
    essence: 'Transform knowledge through experimentation',
    ethPrice: '0.02 ETH',
    usdcPrice: '50 USDC',
    kbtPrice: '32 KBT',
    kbtDiscount: true,
    features: [
      'Personal AI assistant',
      'Alchemy laboratory access',
      'Scroll creation and minting',
      'Enhanced computational resources',
      'Custom domain subdirectory'
    ],
    philosophy: 'Wisdom emerges through practice'
  },
  {
    id: 'KEEPER',
    name: 'KEEPER - Guardian of Sacred Knowledge',
    glyph: '🗝️',
    essence: 'Protect and expand the mysteries',
    ethPrice: '0.08 ETH',
    usdcPrice: '200 USDC',
    kbtPrice: '128 KBT',
    kbtDiscount: true,
    popular: true,
    features: [
      'Personal sovereign sanctum',
      'Advanced research laboratory',
      'Hardware security integration',
      'Custom mystical domain',
      'Advanced scroll economics',
      'Complete sandbox isolation'
    ],
    philosophy: 'Guardians unlock deeper secrets'
  },
  {
    id: 'SOVEREIGN',
    name: 'SOVEREIGN - Master of Your Domain',
    glyph: '👑',
    essence: 'Shape reality through wisdom',
    ethPrice: '0.2 ETH',
    usdcPrice: '500 USDC',
    kbtPrice: '320 KBT',
    kbtDiscount: true,
    ultimate: true,
    features: [
      'Unlimited sovereign territory',
      'Reality-shaping capabilities',
      'Cosmic-scale laboratories',
      'Temporal mastery controls',
      'Multiversal gateway access',
      'Ultimate digital sovereignty',
      'Custom security protocols'
    ],
    philosophy: 'True power serves wisdom'
  }
];

const TierCard: React.FC<{
  tier: TierInfo;
  userKBT: UserKBTInfo;
  onSelect: (tierId: string) => void;
  isSelected: boolean;
}> = ({ tier, userKBT, onSelect, isSelected }) => {
  const canAffordWithKBT = userKBT.balance >= parseInt(tier.kbtPrice.split(' ')[0] || '0');
  const isCurrentTier = userKBT.currentTier === tier.id;

  return (
    <Card 
      className={`
        relative transition-all duration-300 cursor-pointer
        ${isSelected ? 'ring-2 ring-purple-500 ring-offset-2' : ''}
        ${tier.popular ? 'border-yellow-500 border-2' : ''}
        ${tier.ultimate ? 'border-purple-500 border-2 bg-gradient-to-br from-purple-900/20 to-indigo-900/20' : ''}
        ${isCurrentTier ? 'bg-green-900/20 border-green-500' : ''}
        hover:scale-105 hover:shadow-xl hover:shadow-purple-500/25
      `}
      onClick={() => onSelect(tier.id)}
    >
      {tier.popular && (
        <Badge className="absolute -top-2 left-1/2 transform -translate-x-1/2 bg-yellow-500 text-black">
          MOST POPULAR
        </Badge>
      )}
      {tier.ultimate && (
        <Badge className="absolute -top-2 left-1/2 transform -translate-x-1/2 bg-purple-500">
          ULTIMATE SOVEREIGNTY
        </Badge>
      )}
      {isCurrentTier && (
        <Badge className="absolute -top-2 right-4 bg-green-500">
          CURRENT TIER
        </Badge>
      )}

      <CardHeader className="text-center">
        <div className="text-6xl mb-2">{tier.glyph}</div>
        <CardTitle className="text-lg font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
          {tier.name}
        </CardTitle>
        <CardDescription className="text-purple-300 italic">
          {tier.essence}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Pricing */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">ETH/USDC:</span>
            <span className="font-bold">{tier.ethPrice}</span>
          </div>
          {tier.kbtDiscount && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">KBT (20% off!):</span>
              <div className="flex items-center gap-2">
                <span className={`font-bold ${canAffordWithKBT ? 'text-green-400' : 'text-red-400'}`}>
                  {tier.kbtPrice}
                </span>
                {canAffordWithKBT && <span className="text-xs text-green-400">✓ Affordable</span>}
              </div>
            </div>
          )}
        </div>

        {/* Features */}
        <div className="space-y-2">
          <h4 className="font-semibold text-purple-300">Mystical Abilities:</h4>
          <ul className="space-y-1">
            {tier.features.map((feature, index) => (
              <li key={index} className="text-sm text-gray-300 flex items-center gap-2">
                <span className="text-purple-400">•</span>
                {feature}
              </li>
            ))}
          </ul>
        </div>

        {/* Philosophy */}
        <div className="pt-2 border-t border-purple-800/30">
          <p className="text-xs text-purple-200 italic text-center">
            "{tier.philosophy}"
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

const KBTEarningDisplay: React.FC<{ userKBT: UserKBTInfo }> = ({ userKBT }) => {
  return (
    <Card className="bg-gradient-to-r from-yellow-900/30 to-purple-900/30 border-yellow-500/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-2xl">💎</span>
          The Sovereign Economy
        </CardTitle>
        <CardDescription>
          Create scrolls → Earn KBT → Ascend the tiers → Achieve sovereignty
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <div className="text-3xl font-bold text-yellow-400">{userKBT.balance}</div>
            <div className="text-sm text-gray-400">Current KBT Balance</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-purple-400">{userKBT.scrollsCreated}</div>
            <div className="text-sm text-gray-400">Scrolls Created</div>
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="font-semibold text-yellow-300">KBT Earning Examples:</h4>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>📜 Create 1 ULTIMATE scroll:</span>
              <span className="text-green-400">+262 KBT</span>
            </div>
            <div className="flex justify-between">
              <span>⚗️ Monthly ADEPT costs:</span>
              <span className="text-blue-400">32 KBT</span>
            </div>
            <div className="flex justify-between">
              <span>🗝️ Monthly KEEPER costs:</span>
              <span className="text-purple-400">128 KBT</span>
            </div>
            <div className="flex justify-between">
              <span>👑 Monthly SOVEREIGN costs:</span>
              <span className="text-yellow-400">320 KBT</span>
            </div>
          </div>
        </div>

        <div className="text-center text-green-400 font-semibold">
          🌟 Active scroll creators can achieve free SOVEREIGN access! 🌟
        </div>
      </CardContent>
    </Card>
  );
};

export default function SovereignTierSelection() {
  const [selectedTier, setSelectedTier] = useState<string>('ADEPT');
  const [paymentMethod, setPaymentMethod] = useState<'ETH' | 'USDC' | 'KBT'>('ETH');
  const [userKBT, setUserKBT] = useState<UserKBTInfo>({
    balance: 245,
    earned: 845,
    scrollsCreated: 3,
    currentTier: 'INITIATE',
    canUpgrade: true
  });

  const handleAscension = async (tierId: string) => {
    console.log(`Ascending to ${tierId} with ${paymentMethod}`);
    // Here we would integrate with the smart contract
    // For now, just update the UI
    setUserKBT(prev => ({ ...prev, currentTier: tierId }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-violet-900 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
            🌌 The Path to Sovereignty 🌌
          </h1>
          <p className="text-xl text-purple-200 italic">
            "Knowledge is the beginning, Wisdom is the journey, Sovereignty is the destination"
          </p>
        </div>

        {/* KBT Economy Display */}
        <KBTEarningDisplay userKBT={userKBT} />

        {/* Tier Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {mysticalTiers.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              userKBT={userKBT}
              onSelect={setSelectedTier}
              isSelected={selectedTier === tier.id}
            />
          ))}
        </div>

        {/* Payment Method Selection */}
        <Card className="bg-gray-800/50 border-purple-500/50">
          <CardHeader>
            <CardTitle>Choose Your Payment Method</CardTitle>
            <CardDescription>
              Ascend to {mysticalTiers.find(t => t.id === selectedTier)?.name}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {(['ETH', 'USDC', 'KBT'] as const).map((method) => (
                <Button
                  key={method}
                  variant={paymentMethod === method ? 'default' : 'outline'}
                  onClick={() => setPaymentMethod(method)}
                  className="relative"
                >
                  {method}
                  {method === 'KBT' && (
                    <Badge className="absolute -top-2 -right-2 bg-yellow-500 text-black text-xs">
                      20% OFF
                    </Badge>
                  )}
                </Button>
              ))}
            </div>

            <Button 
              className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-bold py-3 text-lg"
              onClick={() => handleAscension(selectedTier)}
            >
              ⚡ Begin Ascension with {paymentMethod} ⚡
            </Button>
          </CardContent>
        </Card>

        {/* Ascension Progress */}
        <Card className="bg-gradient-to-r from-indigo-900/30 to-purple-900/30 border-indigo-500/50">
          <CardHeader>
            <CardTitle>Your Ascension Journey</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {mysticalTiers.map((tier, index) => {
                const isCompleted = mysticalTiers.findIndex(t => t.id === userKBT.currentTier) >= index;
                const isCurrent = tier.id === userKBT.currentTier;
                
                return (
                  <div key={tier.id} className={`flex items-center gap-3 ${isCurrent ? 'text-yellow-400' : isCompleted ? 'text-green-400' : 'text-gray-500'}`}>
                    <span className="text-2xl">{tier.glyph}</span>
                    <span className="flex-1">{tier.name}</span>
                    {isCompleted && <span className="text-green-400">✓</span>}
                    {isCurrent && <span className="text-yellow-400 animate-pulse">← Current</span>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
