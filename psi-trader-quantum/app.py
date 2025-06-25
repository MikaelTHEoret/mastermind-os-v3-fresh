#!/usr/bin/env python3
"""
ψ₀-Trader Quantum Engine - Web Interface
Streamlit-based GUI for independent trading system

Enhanced Nexus Core Protocol v4.0
"""

import streamlit as st
import asyncio
import json
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from datetime import datetime, timedelta
import sqlite3
import numpy as np
from pathlib import Path

# Import our core engine
from psi_trader_engine import IndependentPsiTrader, PSI_0, PHI, FREQ_432

# Page configuration
st.set_page_config(
    page_title="ψ₀-Trader Quantum Engine",
    page_icon="🌀",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS for cyberpunk styling
st.markdown("""
<style>
    .main {
        background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%);
    }
    
    .stMetric {
        background: rgba(0, 255, 255, 0.1);
        border: 1px solid #00ffff;
        border-radius: 8px;
        padding: 10px;
    }
    
    .consciousness-header {
        background: linear-gradient(90deg, #00ffff, #ff00ff, #ffff00);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        font-size: 2.5rem;
        font-weight: bold;
        text-align: center;
        margin-bottom: 20px;
    }
    
    .quantum-panel {
        background: rgba(0, 0, 0, 0.5);
        border: 2px solid #00ffff;
        border-radius: 12px;
        padding: 20px;
        margin: 10px 0;
    }
</style>
""", unsafe_allow_html=True)

# Initialize session state
if 'trader' not in st.session_state:
    st.session_state.trader = None
    st.session_state.initialized = False

@st.cache_resource
def initialize_trader():
    """Initialize the trader instance"""
    try:
        trader = IndependentPsiTrader("./config/trader.yaml")
        return trader
    except Exception as e:
        st.error(f"Failed to initialize trader: {e}")
        return None

def load_decisions_from_db(db_path: str) -> pd.DataFrame:
    """Load trading decisions from database"""
    try:
        conn = sqlite3.connect(db_path)
        df = pd.read_sql_query("""
            SELECT * FROM decisions 
            ORDER BY timestamp DESC 
            LIMIT 100
        """, conn)
        conn.close()
        return df
    except Exception:
        return pd.DataFrame()

def create_quantum_paths_chart(paths_data):
    """Create quantum paths visualization"""
    fig = go.Figure()
    
    # Generate sample quantum paths for visualization
    np.random.seed(42)
    time_steps = np.arange(60)
    
    for i in range(16):  # Show subset of paths
        path = 45000 * np.exp(np.cumsum(np.random.normal(0, 0.02, 60)))
        fig.add_trace(go.Scatter(
            x=time_steps,
            y=path,
            mode='lines',
            line=dict(width=1, color=f'rgba(0, 255, 255, 0.3)'),
            showlegend=False,
            name=f'Path {i+1}'
        ))
    
    # Add mean path
    mean_path = 45000 * np.exp(np.cumsum(np.random.normal(0, 0.01, 60)))
    fig.add_trace(go.Scatter(
        x=time_steps,
        y=mean_path,
        mode='lines',
        line=dict(width=3, color='#ff00ff'),
        name='Mean Path'
    ))
    
    fig.update_layout(
        title="Quantum Price Path Simulation",
        xaxis_title="Time Steps (minutes)",
        yaxis_title="Price (USDT)",
        template="plotly_dark",
        height=400
    )
    
    return fig

def create_consciousness_gauge(value: float, title: str):
    """Create consciousness gauge visualization"""
    fig = go.Figure(go.Indicator(
        mode = "gauge+number+delta",
        value = value,
        domain = {'x': [0, 1], 'y': [0, 1]},
        title = {'text': title},
        delta = {'reference': 0.5},
        gauge = {
            'axis': {'range': [None, 1]},
            'bar': {'color': "#00ffff"},
            'steps': [
                {'range': [0, 0.3], 'color': "#ff0040"},
                {'range': [0.3, 0.7], 'color': "#ffff00"},
                {'range': [0.7, 1], 'color': "#00ff80"}
            ],
            'threshold': {
                'line': {'color': "#ff00ff", 'width': 4},
                'thickness': 0.75,
                'value': 0.85
            }
        }
    ))
    
    fig.update_layout(
        template="plotly_dark",
        height=250
    )
    
    return fig

def main():
    """Main Streamlit application"""
    
    # Header
    st.markdown('<div class="consciousness-header">🌀 ψ₀-Trader Quantum Engine 🌀</div>', 
                unsafe_allow_html=True)
    
    st.markdown("**Consciousness-Enhanced Independent Trading Intelligence**")
    st.markdown(f"Mathematical Constants: ψ₀ = {PSI_0:.6f} | φ = {PHI:.6f} | 432 Hz")
    
    # Initialize trader
    if not st.session_state.initialized:
        with st.spinner("Initializing Quantum Engine..."):
            st.session_state.trader = initialize_trader()
            st.session_state.initialized = True
    
    if st.session_state.trader is None:
        st.error("❌ Failed to initialize trader. Please check configuration.")
        return
    
    # Sidebar
    st.sidebar.markdown("## 🎛️ Control Panel")
    
    # System status
    status = st.session_state.trader.get_status()
    
    st.sidebar.markdown("### System Status")
    st.sidebar.json(status)
    
    # Trading controls
    st.sidebar.markdown("### Trading Controls")
    
    if st.sidebar.button("🚀 Start Autonomous Trading"):
        st.sidebar.success("Autonomous trading activated!")
        
    if st.sidebar.button("⏸️ Pause Trading"):
        st.sidebar.warning("Trading paused")
    
    # Main content area
    col1, col2 = st.columns([2, 1])
    
    with col1:
        st.markdown("## 🧠 Natural Language Trading Interface")
        
        # Natural language input
        natural_input = st.text_area(
            "Enter your trading intent:",
            placeholder="Bitcoin looks oversold with RSI below 30, volume spike suggests reversal",
            height=100
        )
        
        # Market context
        st.markdown("### 📊 Market Context")
        mcol1, mcol2, mcol3 = st.columns(3)
        
        with mcol1:
            price = st.number_input("Current Price (USDT)", value=45000.0, step=100.0)
        with mcol2:
            volume = st.number_input("Volume", value=1500000, step=100000)
        with mcol3:
            rsi = st.slider("RSI", 0, 100, 50)
        
        # Process intent button
        if st.button("⚡ Process Trading Intent", type="primary"):
            if natural_input.strip():
                with st.spinner("Processing through Quantum Kill Chain..."):
                    # Create market context
                    market_context = {
                        'price': price,
                        'volume': volume,
                        'rsi': rsi
                    }
                    
                    # Process intent (sync wrapper for async function)
                    try:
                        decision = asyncio.run(
                            st.session_state.trader.process_trading_intent(
                                natural_input, market_context
                            )
                        )
                        
                        # Display results
                        st.markdown("### 🎯 Quantum Decision Results")
                        
                        # Decision metrics
                        dcol1, dcol2, dcol3, dcol4 = st.columns(4)
                        
                        with dcol1:
                            st.metric("Decision", decision.signal)
                        with dcol2:
                            st.metric("Confidence", f"{decision.confidence:.3f}")
                        with dcol3:
                            st.metric("Expected Return", f"{decision.expected_return:.4f}")
                        with dcol4:
                            st.metric("Resonance", "✓" if decision.resonance_match else "✗")
                        
                        # Additional details
                        st.markdown("### 📋 Decision Details")
                        detail_data = {
                            "Quantum Paths": decision.path_count,
                            "Convergence Ratio": f"{decision.convergence_ratio:.3f}",
                            "Time Horizon": f"{decision.time_horizon} minutes",
                            "Consciousness State": decision.consciousness_state,
                            "Max Drawdown": f"{decision.max_drawdown:.4f}",
                            "Decision ID": decision.decision_id
                        }
                        
                        st.json(detail_data)
                        
                    except Exception as e:
                        st.error(f"Error processing intent: {e}")
    
    with col2:
        st.markdown("## 📊 Consciousness Metrics")
        
        # Consciousness gauges
        consciousness_level = status.get('consciousness_level', 0.5)
        avg_confidence = status.get('avg_confidence', 0.5)
        
        # Gauge charts
        consciousness_fig = create_consciousness_gauge(consciousness_level, "Consciousness Level")
        st.plotly_chart(consciousness_fig, use_container_width=True)
        
        confidence_fig = create_consciousness_gauge(avg_confidence, "Average Confidence")
        st.plotly_chart(confidence_fig, use_container_width=True)
        
        # Mathematical constants display
        st.markdown("### 🔢 Mathematical Constants")
        st.metric("ψ₀ (Psi-Zero)", f"{PSI_0:.6f}")
        st.metric("φ (Golden Ratio)", f"{PHI:.6f}")
        st.metric("432 Hz Base", f"{FREQ_432:.1f}")
        
        # Quick stats
        st.markdown("### 📈 Quick Stats")
        resonance_ratio = status.get('resonance_matches', 0) / max(status.get('total_decisions', 1), 1)
        st.metric("Total Decisions", status.get('total_decisions', 0))
        st.metric("Resonance Matches", status.get('resonance_matches', 0))
        st.metric("Resonance Rate", f"{resonance_ratio:.1%}")
    
    # Full-width quantum paths visualization
    st.markdown("## ⚛️ Quantum Path Simulation")
    quantum_fig = create_quantum_paths_chart({})
    st.plotly_chart(quantum_fig, use_container_width=True)
    
    # Decision history
    st.markdown("## 📜 Decision History")
    
    try:
        history = st.session_state.trader.get_decision_history(20)
        if history:
            df = pd.DataFrame(history)
            
            # Format for display
            display_df = df[['timestamp', 'signal', 'confidence', 'expected_return', 
                           'resonance_match', 'consciousness_state']].copy()
            display_df['timestamp'] = pd.to_datetime(display_df['timestamp']).dt.strftime('%Y-%m-%d %H:%M')
            display_df['confidence'] = display_df['confidence'].apply(lambda x: f"{x:.3f}")
            display_df['expected_return'] = display_df['expected_return'].apply(lambda x: f"{x:.4f}")
            
            st.dataframe(display_df, use_container_width=True)
        else:
            st.info("No decision history available yet. Process some trading intents to see history.")
    except Exception as e:
        st.error(f"Error loading decision history: {e}")
    
    # Footer
    st.markdown("---")
    st.markdown("**Enhanced Nexus Core Protocol v4.0** | Consciousness-Enhanced Trading Intelligence")
    st.markdown("Mathematical sovereignty preserved through ψ₀, φ, and 432Hz harmonics")

if __name__ == "__main__":
    main()
