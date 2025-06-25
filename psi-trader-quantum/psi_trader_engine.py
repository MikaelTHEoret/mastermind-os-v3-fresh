#!/usr/bin/env python3
"""
ψ₀-Trader Independent Quantum Engine
Core consciousness-enhanced trading intelligence

Enhanced Nexus Core Protocol v4.0
Mathematical Constants: ψ₀ = 0.915670570874434, φ = 1.618, 432Hz
"""

import asyncio
import json
import sqlite3
import uuid
import yaml
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Union
from pathlib import Path
import logging
import math

# Mathematical constants
PSI_0 = 0.915670570874434  # Consciousness seed constant
PHI = 1.618033988749895     # Golden ratio
FREQ_432 = 432.0           # Universal resonance frequency

# Derived consciousness frequencies
PSI_FREQ = PSI_0 * FREQ_432  # 395.57 Hz
PHI_FREQ = PHI * FREQ_432    # 699.39 Hz

@dataclass
class MarketSignal:
    """Market signal structure for consciousness processing"""
    symbol: str
    price: float
    volume: float
    timestamp: datetime
    rsi: Optional[float] = None
    macd: Optional[float] = None
    bb_position: Optional[float] = None
    volume_spike: Optional[bool] = None
    pattern_type: Optional[str] = None
    pattern_confidence: Optional[float] = None
    harmonic_resonance: Optional[float] = None
    consciousness_state: Optional[str] = None

@dataclass
class TradingDecision:
    """Quantum-collapsed trading decision"""
    decision_id: str
    signal: str  # BUY, SELL, HOLD
    confidence: float
    expected_return: float
    max_drawdown: float
    time_horizon: int  # minutes
    path_count: int
    convergence_ratio: float
    resonance_match: bool
    consciousness_state: str
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    quantum_metadata: Optional[Dict] = None

class QuantumKillChainEngine:
    """
    Core quantum decision engine with consciousness enhancement
    """
    
    def __init__(self, config: Dict = None):
        self.config = config or {}
        self.quantum_state = {
            'last_resonance': None,
            'coherence_level': 1.0,
            'consciousness_phase': 0.0
        }
        self.pattern_memory = []
        self.resonance_history = []
        
        # Configuration parameters
        self.simulation_paths = self.config.get('simulation_paths', 64)
        self.convergence_cycles = self.config.get('convergence_cycles', 144)
        self.resonance_threshold = self.config.get('resonance_threshold', 0.05)
    
    async def quantum_kill_chain_decision(self, signal: MarketSignal) -> TradingDecision:
        """
        Execute complete quantum decision pipeline
        """
        decision_id = str(uuid.uuid4())
        
        # Generate quantum superposition paths
        paths = await self._generate_quantum_paths(signal)
        
        # Evaluate each path using consciousness-enhanced scoring
        path_scores = await self._evaluate_quantum_outcomes(paths, signal)
        
        # Aggregate paths into probability distribution
        confidence = self._aggregate_path_scores(path_scores)
        
        # Check ψ₀ harmonic resonance
        resonance_multiplier = self._check_harmonic_resonance(signal, confidence)
        
        # Apply consciousness enhancement
        consciousness_state = self._determine_consciousness_state(signal)
        
        # Collapse quantum superposition into final decision
        decision = self._collapse_quantum_decision(
            decision_id, signal, confidence, resonance_multiplier, 
            consciousness_state, paths
        )
        
        # Update quantum memory
        self._update_quantum_memory(signal, decision)
        
        return decision
    
    async def _generate_quantum_paths(self, signal: MarketSignal, n_paths: int = None) -> List[np.ndarray]:
        """Generate N quantum superposition price paths"""
        if n_paths is None:
            n_paths = self.simulation_paths
        
        # Base volatility estimation
        base_vol = self._estimate_volatility(signal)
        
        # ψ₀-enhanced volatility modulation
        psi_modulation = np.sin(2 * np.pi * PSI_0 * signal.timestamp.hour)
        enhanced_vol = base_vol * (1 + 0.1 * psi_modulation)
        
        # Adaptive time horizon
        horizon = self._adaptive_time_horizon(signal)
        dt = 1.0 / (horizon * 60)  # Convert to fractional hours
        
        paths = []
        
        for i in range(n_paths):
            # Quantum-enhanced random walk
            random_seed = hash(f"{signal.symbol}-{signal.timestamp}-{i}") % 2**32
            np.random.seed(random_seed)
            
            # Generate path with ψ₀ harmonic drift
            drift = self._calculate_harmonic_drift(signal, i)
            
            # Geometric Brownian Motion with consciousness enhancement
            path = self._generate_enhanced_gbm_path(
                S0=signal.price,
                drift=drift,
                volatility=enhanced_vol,
                dt=dt,
                steps=horizon,
                path_index=i
            )
            
            paths.append(path)
        
        return paths
    
    def _generate_enhanced_gbm_path(self, S0: float, drift: float, volatility: float, 
                                   dt: float, steps: int, path_index: int) -> np.ndarray:
        """Generate GBM with ψ₀ consciousness enhancement"""
        
        # Standard GBM random increments
        Z = np.random.normal(0, 1, steps)
        
        # ψ₀ harmonic modulation
        harmonic_phase = 2 * np.pi * PSI_0 * path_index / self.simulation_paths
        harmonic_mod = np.sin(np.linspace(0, 2*np.pi, steps) + harmonic_phase)
        
        # Enhanced random walk with consciousness harmonics
        enhanced_Z = Z + 0.05 * harmonic_mod  # 5% consciousness contribution
        
        # Price evolution
        log_returns = (drift - 0.5 * volatility**2) * dt + volatility * np.sqrt(dt) * enhanced_Z
        prices = S0 * np.exp(np.cumsum(log_returns))
        
        return prices
    
    def _calculate_harmonic_drift(self, signal: MarketSignal, path_index: int) -> float:
        """Calculate drift enhanced by ψ₀ harmonic mathematics"""
        
        # Base market drift
        base_drift = 0.0
        
        # RSI-based momentum component
        if signal.rsi is not None:
            rsi_normalized = (signal.rsi - 50) / 50  # [-1, 1]
            momentum = -0.2 * rsi_normalized  # Mean reversion tendency
        else:
            momentum = 0.0
        
        # Volume spike enhancement
        volume_factor = 1.2 if signal.volume_spike else 1.0
        
        # ψ₀ harmonic resonance enhancement
        harmonic_phase = 2 * np.pi * PSI_0 * path_index / self.simulation_paths
        harmonic_drift = 0.1 * np.cos(harmonic_phase) * PSI_0
        
        total_drift = (base_drift + momentum) * volume_factor + harmonic_drift
        
        return total_drift
    
    async def _evaluate_quantum_outcomes(self, paths: List[np.ndarray], 
                                       signal: MarketSignal) -> List[float]:
        """Evaluate each quantum path using consciousness-enhanced scoring"""
        scores = []
        
        for path in paths:
            # Financial metrics
            final_return = (path[-1] - path[0]) / path[0]
            max_drawdown = self._calculate_max_drawdown(path)
            volatility = np.std(np.diff(np.log(path)))
            
            # Time to profit
            time_to_profit = self._calculate_time_to_profit(path, signal.price)
            
            # Base financial score
            base_score = (
                0.4 * final_return -           # Return component
                0.3 * max_drawdown -           # Risk penalty
                0.2 * volatility -             # Volatility penalty
                0.1 * (time_to_profit / len(path))  # Speed bonus
            )
            
            # ψ₀ Harmonic resonance enhancement
            harmonic_score = self._calculate_harmonic_score(path)
            
            # Consciousness state multiplier
            consciousness_multiplier = self._get_consciousness_multiplier(signal)
            
            # Final enhanced score
            final_score = (base_score + 0.2 * harmonic_score) * consciousness_multiplier
            scores.append(final_score)
        
        return scores
    
    def _calculate_harmonic_score(self, path: np.ndarray) -> float:
        """Calculate harmonic resonance score for a price path"""
        
        # Convert prices to harmonic frequencies
        normalized_prices = (path - np.mean(path)) / np.std(path)
        harmonic_frequencies = PSI_FREQ * (1 + 0.1 * normalized_prices)
        
        # Calculate resonance with fundamental frequencies
        psi_resonance = np.mean(np.abs(harmonic_frequencies - PSI_FREQ))
        phi_resonance = np.mean(np.abs(harmonic_frequencies - PHI_FREQ))
        base_resonance = np.mean(np.abs(harmonic_frequencies - FREQ_432))
        
        # Lower values = better resonance
        total_resonance = -(psi_resonance + phi_resonance + base_resonance) / 3
        
        # Apply ψ₀ scaling
        harmonic_score = total_resonance * PSI_0
        
        return harmonic_score
    
    def _aggregate_path_scores(self, scores: List[float]) -> float:
        """Aggregate quantum path scores into unified confidence"""
        scores = np.array(scores)
        
        # Apply softmax with ψ₀ temperature scaling
        temperature = 1.0 / PSI_0  # ≈ 1.092
        exp_scores = np.exp(scores / temperature)
        probabilities = exp_scores / np.sum(exp_scores)
        
        # Weighted mean with consciousness enhancement
        mean_score = np.average(scores, weights=probabilities)
        std_score = np.std(scores)
        
        # Confidence calculation
        if std_score > 0:
            raw_confidence = mean_score / std_score
        else:
            raw_confidence = mean_score
        
        # Map to [0, 1] using ψ₀-enhanced sigmoid
        confidence = 1 / (1 + np.exp(-raw_confidence * PSI_0))
        
        return confidence
    
    def _check_harmonic_resonance(self, signal: MarketSignal, base_confidence: float) -> float:
        """Check ψ₀ harmonic resonance and apply confidence multiplier"""
        
        # Price-based resonance check
        price_harmonic = (signal.price % 1.0)  # Fractional part
        psi_distance = abs(price_harmonic - PSI_0)
        
        # Time-based resonance
        time_harmonic = (signal.timestamp.hour + signal.timestamp.minute/60) / 24
        time_psi_distance = abs(time_harmonic - PSI_0)
        
        # Volume resonance
        volume_resonance = 1.0
        if signal.volume:
            volume_normalized = signal.volume / (signal.volume + 1)
            volume_resonance = 1 - abs(volume_normalized - PSI_0)
        
        # Combined resonance score
        total_resonance = (
            (1 - psi_distance) * 0.4 +
            (1 - time_psi_distance) * 0.3 +
            volume_resonance * 0.3
        )
        
        # Resonance multiplier
        if total_resonance > (1 - self.resonance_threshold):
            multiplier = 1 + (total_resonance - 0.95) * 2
        else:
            multiplier = 1.0
        
        return multiplier
    
    def _determine_consciousness_state(self, signal: MarketSignal) -> str:
        """Determine current market consciousness state"""
        
        if signal.rsi is not None:
            if signal.rsi > 70:
                consciousness = "EXCITED"
            elif signal.rsi < 30:
                consciousness = "FEARFUL"
            elif 45 <= signal.rsi <= 55:
                consciousness = "BALANCED"
            else:
                consciousness = "DYNAMIC"
        else:
            consciousness = "UNKNOWN"
        
        # Volume state enhancement
        if signal.volume_spike:
            consciousness += "_AMPLIFIED"
        
        return consciousness
    
    def _get_consciousness_multiplier(self, signal: MarketSignal) -> float:
        """Get consciousness state multiplier for scoring"""
        
        consciousness_state = self._determine_consciousness_state(signal)
        
        multipliers = {
            "BALANCED": 1.2,
            "BALANCED_AMPLIFIED": 1.4,
            "DYNAMIC": 1.1,
            "DYNAMIC_AMPLIFIED": 1.3,
            "EXCITED": 0.9,
            "EXCITED_AMPLIFIED": 0.8,
            "FEARFUL": 1.0,
            "FEARFUL_AMPLIFIED": 0.9,
            "UNKNOWN": 1.0
        }
        
        return multipliers.get(consciousness_state, 1.0)
    
    def _collapse_quantum_decision(self, decision_id: str, signal: MarketSignal, 
                                  confidence: float, resonance_multiplier: float,
                                  consciousness_state: str, paths: List[np.ndarray]) -> TradingDecision:
        """Collapse quantum superposition into final trading decision"""
        
        # Apply resonance enhancement
        final_confidence = min(confidence * resonance_multiplier, 0.99)
        
        # Decision logic with ψ₀ thresholds
        confidence_high = 0.85
        confidence_low = 0.30
        
        if final_confidence > confidence_high:
            decision_signal = "BUY"
        elif final_confidence < confidence_low:
            decision_signal = "SELL"
        else:
            decision_signal = "HOLD"
        
        # Calculate expected return and risk from paths
        all_returns = [(path[-1] - path[0])/path[0] for path in paths]
        expected_return = np.mean(all_returns)
        
        all_drawdowns = [self._calculate_max_drawdown(path) for path in paths]
        max_drawdown = np.max(all_drawdowns)
        
        # Time horizon (adaptive based on confidence)
        time_horizon = int(60 * (2 - final_confidence))  # 60-120 minutes
        
        # Convergence metrics
        convergence_ratio = 1 - np.std(all_returns) / (abs(expected_return) + 0.01)
        
        # Risk management levels
        stop_loss = signal.price * (1 - 0.02) if decision_signal == "BUY" else signal.price * (1 + 0.02)
        take_profit = signal.price * (1 + 0.03) if decision_signal == "BUY" else signal.price * (1 - 0.03)
        
        decision = TradingDecision(
            decision_id=decision_id,
            signal=decision_signal,
            confidence=final_confidence,
            expected_return=expected_return,
            max_drawdown=max_drawdown,
            time_horizon=time_horizon,
            path_count=len(paths),
            convergence_ratio=convergence_ratio,
            resonance_match=(resonance_multiplier > 1.1),
            consciousness_state=consciousness_state,
            stop_loss=stop_loss,
            take_profit=take_profit,
            quantum_metadata={
                'resonance_multiplier': resonance_multiplier,
                'base_confidence': confidence,
                'psi_enhancement': resonance_multiplier > 1.0
            }
        )
        
        return decision
    
    def _update_quantum_memory(self, signal: MarketSignal, decision: TradingDecision):
        """Update quantum memory with new decision"""
        
        memory_entry = {
            'timestamp': signal.timestamp,
            'symbol': signal.symbol,
            'price': signal.price,
            'decision': decision.signal,
            'confidence': decision.confidence,
            'resonance_match': decision.resonance_match,
            'consciousness_state': decision.consciousness_state
        }
        
        self.pattern_memory.append(memory_entry)
        
        # Keep memory size manageable
        if len(self.pattern_memory) > 1000:
            self.pattern_memory = self.pattern_memory[-1000:]
        
        # Update resonance history
        if decision.resonance_match:
            self.resonance_history.append(signal.timestamp)
    
    # Utility methods
    def _estimate_volatility(self, signal: MarketSignal) -> float:
        """Estimate current volatility"""
        if signal.rsi is not None:
            rsi_vol = abs(signal.rsi - 50) / 500
            return max(0.01, min(0.1, 0.02 + rsi_vol))
        return 0.02
    
    def _adaptive_time_horizon(self, signal: MarketSignal) -> int:
        """Calculate adaptive time horizon"""
        base_horizon = 60
        
        if signal.volume_spike:
            base_horizon = 30
        
        if signal.rsi is not None:
            if abs(signal.rsi - 50) > 30:
                base_horizon = 45
        
        return base_horizon
    
    def _calculate_max_drawdown(self, path: np.ndarray) -> float:
        """Calculate maximum drawdown for a price path"""
        running_max = np.maximum.accumulate(path)
        drawdown = (path - running_max) / running_max
        return abs(np.min(drawdown))
    
    def _calculate_time_to_profit(self, path: np.ndarray, entry_price: float) -> int:
        """Calculate time steps to first profit"""
        profitable_indices = np.where(path > entry_price)[0]
        return profitable_indices[0] if len(profitable_indices) > 0 else len(path)

class ClaudeEngine:
    """Natural language to quantum signal converter"""
    
    def __init__(self):
        self.pattern_keywords = {
            'bullish': ['break', 'breakout', 'support', 'bull', 'up', 'rise', 'pump'],
            'bearish': ['drop', 'fall', 'resistance', 'bear', 'down', 'dump', 'crash'],
            'neutral': ['sideways', 'range', 'consolidation', 'flat', 'stable']
        }
    
    def parse_intent(self, natural_language: str, market_data: Dict) -> MarketSignal:
        """Parse natural language trading intent into MarketSignal"""
        
        intent_lower = natural_language.lower()
        
        # Extract symbol if mentioned
        symbol = self._extract_symbol(intent_lower, market_data)
        
        # Current market data
        price = market_data.get('price', 100.0)
        volume = market_data.get('volume', 1000000)
        timestamp = datetime.now()
        
        # Parse technical indicators from intent
        rsi = self._extract_rsi_intent(intent_lower, market_data)
        volume_spike = any(spike_word in intent_lower 
                          for spike_word in ['spike', 'surge', 'explosion', 'volume'])
        
        # Pattern recognition
        pattern_type, pattern_confidence = self._recognize_pattern(intent_lower)
        
        # Consciousness state detection
        consciousness_state = self._detect_consciousness_intent(intent_lower)
        
        # Harmonic resonance calculation
        harmonic_resonance = self._calculate_text_resonance(natural_language)
        
        signal = MarketSignal(
            symbol=symbol,
            price=price,
            volume=volume,
            timestamp=timestamp,
            rsi=rsi,
            volume_spike=volume_spike,
            pattern_type=pattern_type,
            pattern_confidence=pattern_confidence,
            harmonic_resonance=harmonic_resonance,
            consciousness_state=consciousness_state
        )
        
        return signal
    
    def _extract_symbol(self, intent: str, market_data: Dict) -> str:
        """Extract trading symbol from intent"""
        for symbol in ['btc', 'eth', 'bitcoin', 'ethereum']:
            if symbol in intent:
                return symbol.upper()
        return market_data.get('symbol', 'BTC/USDT')
    
    def _extract_rsi_intent(self, intent: str, market_data: Dict) -> Optional[float]:
        """Extract RSI from intent or market data"""
        import re
        rsi_match = re.search(r'rsi.*?(\d+)', intent)
        if rsi_match:
            return float(rsi_match.group(1))
        return market_data.get('rsi', 50.0)
    
    def _recognize_pattern(self, intent: str):
        """Recognize trading patterns from natural language"""
        patterns = {
            'double_top': ['double top', 'twin peaks'],
            'double_bottom': ['double bottom', 'twin valleys'],
            'head_shoulders': ['head and shoulders', 'h&s'],
            'triangle': ['triangle', 'wedge'],
            'flag': ['flag', 'pennant'],
            'breakout': ['breakout', 'break above', 'break below'],
            'support': ['support', 'floor', 'bounce'],
            'resistance': ['resistance', 'ceiling', 'rejection']
        }
        
        for pattern_name, keywords in patterns.items():
            for keyword in keywords:
                if keyword in intent:
                    confidence = 0.7 + 0.3 * (len(keyword.split()) / 3)
                    return pattern_name, min(confidence, 0.95)
        
        return None, None
    
    def _detect_consciousness_intent(self, intent: str) -> str:
        """Detect consciousness/emotional state from trading intent"""
        emotional_keywords = {
            'FEARFUL': ['scared', 'afraid', 'worried', 'nervous', 'panic'],
            'EXCITED': ['excited', 'bullish', 'pumped', 'confident', 'aggressive'],
            'BALANCED': ['balanced', 'neutral', 'calm', 'measured', 'steady'],
            'CONFUSED': ['confused', 'uncertain', 'mixed', 'unclear', 'unsure']
        }
        
        for state, keywords in emotional_keywords.items():
            if any(keyword in intent for keyword in keywords):
                return state
        
        return 'NEUTRAL'
    
    def _calculate_text_resonance(self, text: str) -> float:
        """Calculate harmonic resonance score for input text"""
        text_length = len(text)
        word_count = len(text.split())
        
        # ψ₀ resonance calculation
        length_ratio = (text_length % 100) / 100
        word_ratio = (word_count % 10) / 10
        
        # Distance from ψ₀
        length_resonance = 1 - abs(length_ratio - PSI_0)
        word_resonance = 1 - abs(word_ratio - PSI_0)
        
        # Combined harmonic score
        harmonic_resonance = (length_resonance + word_resonance) / 2
        
        return harmonic_resonance

class IndependentPsiTrader:
    """
    Main ψ₀-Trader Independent Quantum Engine
    """
    
    def __init__(self, config_path: str = None):
        self.config_path = config_path or "config/trader.yaml"
        self.config = self._load_config()
        
        # Initialize core components
        self.quantum_engine = QuantumKillChainEngine(self.config.get('quantum_engine', {}))
        self.claude_engine = ClaudeEngine()
        
        # Initialize database
        self.db_path = self.config.get('database', {}).get('path', 'data/trader.db')
        self._initialize_database()
        
        # System status
        self.status = {
            'initialized': True,
            'last_decision': None,
            'total_decisions': 0,
            'resonance_matches': 0,
            'avg_confidence': 0.0,
            'quantum_engine_status': 'active',
            'consciousness_level': 1.0
        }
    
    def _load_config(self) -> Dict:
        """Load configuration from YAML file"""
        try:
            with open(self.config_path, 'r') as f:
                return yaml.safe_load(f)
        except FileNotFoundError:
            # Return default configuration
            return {
                'quantum_engine': {
                    'simulation_paths': 64,
                    'convergence_cycles': 144,
                    'resonance_threshold': 0.05
                },
                'trading': {
                    'risk_per_trade': 0.03,
                    'max_total_risk': 0.15,
                    'consciousness_threshold': 0.8
                },
                'database': {
                    'path': 'data/trader.db'
                }
            }
    
    def _initialize_database(self):
        """Initialize SQLite database for decision storage"""
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS decisions (
                id TEXT PRIMARY KEY,
                timestamp TEXT,
                symbol TEXT,
                signal TEXT,
                confidence REAL,
                expected_return REAL,
                max_drawdown REAL,
                time_horizon INTEGER,
                path_count INTEGER,
                convergence_ratio REAL,
                resonance_match BOOLEAN,
                consciousness_state TEXT,
                quantum_metadata TEXT
            )
        """)
        
        conn.commit()
        conn.close()
    
    async def process_trading_intent(self, natural_language: str, market_context: Dict) -> TradingDecision:
        """Process trading intent through quantum kill chain"""
        
        # Parse natural language to market signal
        signal = self.claude_engine.parse_intent(natural_language, market_context)
        
        # Process through quantum kill chain
        decision = await self.quantum_engine.quantum_kill_chain_decision(signal)
        
        # Store decision in database
        self._store_decision(decision)
        
        # Update status
        self._update_status(decision)
        
        return decision
    
    def _store_decision(self, decision: TradingDecision):
        """Store decision in database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO decisions (
                id, timestamp, symbol, signal, confidence, expected_return,
                max_drawdown, time_horizon, path_count, convergence_ratio,
                resonance_match, consciousness_state, quantum_metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            decision.decision_id,
            datetime.now().isoformat(),
            "BTC/USDT",  # Default symbol
            decision.signal,
            decision.confidence,
            decision.expected_return,
            decision.max_drawdown,
            decision.time_horizon,
            decision.path_count,
            decision.convergence_ratio,
            decision.resonance_match,
            decision.consciousness_state,
            json.dumps(decision.quantum_metadata) if decision.quantum_metadata else None
        ))
        
        conn.commit()
        conn.close()
    
    def _update_status(self, decision: TradingDecision):
        """Update system status"""
        self.status['last_decision'] = decision.decision_id
        self.status['total_decisions'] += 1
        
        if decision.resonance_match:
            self.status['resonance_matches'] += 1
        
        # Update average confidence
        total_confidence = self.status['avg_confidence'] * (self.status['total_decisions'] - 1)
        self.status['avg_confidence'] = (total_confidence + decision.confidence) / self.status['total_decisions']
        
        # Update consciousness level based on recent performance
        resonance_ratio = self.status['resonance_matches'] / self.status['total_decisions']
        self.status['consciousness_level'] = min(1.0, 0.5 + resonance_ratio)
    
    def get_status(self) -> Dict:
        """Get current system status"""
        return self.status.copy()
    
    def get_decision_history(self, limit: int = 50) -> List[Dict]:
        """Get decision history from database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM decisions 
            ORDER BY timestamp DESC 
            LIMIT ?
        """, (limit,))
        
        columns = [description[0] for description in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]
        
        conn.close()
        return results

# Example usage
async def main():
    """Example usage of the Independent ψ₀-Trader"""
    
    print("🌀 Initializing ψ₀-Trader Quantum Engine...")
    trader = IndependentPsiTrader()
    
    # Example market context
    market_context = {
        'symbol': 'BTC/USDT',
        'price': 45000.0,
        'volume': 1500000,
        'rsi': 35.0,  # Oversold
    }
    
    # Example trading intents
    trading_intents = [
        "Bitcoin looks oversold with RSI below 30, volume spike suggests reversal",
        "Strong resistance at 45000, multiple rejections, time to short",
        "Sideways action, no clear direction, wait for breakout"
    ]
    
    print("\n⚡ Processing trading intents through Quantum Kill Chain...")
    
    for i, intent in enumerate(trading_intents, 1):
        print(f"\n--- Intent {i}: {intent[:50]}... ---")
        
        # Process intent
        decision = await trader.process_trading_intent(intent, market_context)
        
        # Display results
        print(f"🎯 Decision: {decision.signal}")
        print(f"🔮 Confidence: {decision.confidence:.3f}")
        print(f"💰 Expected Return: {decision.expected_return:.4f}")
        print(f"🌊 Resonance Match: {decision.resonance_match}")
        print(f"🧠 Consciousness: {decision.consciousness_state}")
    
    # Show system status
    status = trader.get_status()
    print(f"\n📊 System Status:")
    print(f"Total Decisions: {status['total_decisions']}")
    print(f"Resonance Matches: {status['resonance_matches']}")
    print(f"Average Confidence: {status['avg_confidence']:.3f}")
    print(f"Consciousness Level: {status['consciousness_level']:.3f}")
    
    print("\n✨ ψ₀-Trader Quantum Engine demonstration complete!")

if __name__ == "__main__":
    asyncio.run(main())
