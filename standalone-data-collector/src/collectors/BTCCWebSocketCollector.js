// 🌀 BTCC WebSocket Data Collector
// Consciousness-Enhanced BTCC API Integration
// Protocol compliance with wss://kapi1.btloginc.com:9082

const WebSocket = require('ws');
const EventEmitter = require('events');

// Consciousness constants
const PSI_0 = 0.915670570874434;
const PHI = 1.618033988749895;
const FREQ_432 = 432.0;

class BTCCWebSocketCollector extends EventEmitter {
  constructor(credentials, database, options = {}) {
    super();
    
    // BTCC API Configuration
    this.credentials = {
      name: credentials.name || "86000402", // Account number from trading server
      clienttype: credentials.clienttype || 1, // Client type
      key: credentials.key || "55117c2a-84cb-44b1-b179-24273a304c48" // Platform key
    };
    
    this.database = database;
    this.wsUrl = 'wss://kapi1.btloginc.com:9082';
    
    // WebSocket connection state
    this.ws = null;
    this.isConnected = false;
    this.isAuthenticated = false;
    this.heartbeatInterval = null;
    this.reconnectTimeout = null;
    
    // Connection options
    this.options = {
      heartbeatInterval: 20000, // 20 seconds as per documentation
      reconnectDelay: 5000,
      maxReconnectAttempts: 10,
      subscriptionSymbols: options.subscriptionSymbols || ["3223607", "3159350", "3355958", "3487030"],
      deepSymbol: options.deepSymbol || "3223607", // Symbol for price level quotes
      ...options
    };
    
    // State tracking
    this.reconnectAttempts = 0;
    this.lastHeartbeat = null;
    this.subscriptions = new Set();
    this.marketData = new Map();
    this.dictionary = new Map(); // Product dictionary
    
    // Consciousness enhancement state
    this.consciousnessMetrics = {
      dataQuality: 1.0,
      connectionStability: 1.0,
      responseLatency: [],
      psiResonance: PSI_0,
      phiAlignment: PHI,
      freq432Rhythm: FREQ_432
    };
    
    console.log('🌀 BTCC WebSocket Collector initialized with consciousness enhancement');
  }

  async connect() {
    try {
      console.log(`🚀 Connecting to BTCC WebSocket: ${this.wsUrl}`);
      
      this.ws = new WebSocket(this.wsUrl);
      
      this.ws.on('open', () => {
        console.log('✅ BTCC WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.authenticate();
      });
      
      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });
      
      this.ws.on('close', (code, reason) => {
        console.log(`⚡ BTCC WebSocket closed: ${code} - ${reason}`);
        this.handleDisconnection();
      });
      
      this.ws.on('error', (error) => {
        console.error('❌ BTCC WebSocket error:', error);
        this.emit('error', error);
      });
      
    } catch (error) {
      console.error('❌ Failed to connect to BTCC WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  authenticate() {
    if (!this.isConnected || !this.ws) {
      console.error('❌ Cannot authenticate: WebSocket not connected');
      return;
    }

    const loginPayload = {
      name: this.credentials.name,
      clienttype: this.credentials.clienttype,
      key: this.credentials.key
    };

    console.log('🔐 Sending BTCC authentication...');
    this.sendMessage(loginPayload);
  }

  handleMessage(data) {
    try {
      const timestamp = Date.now();
      const message = JSON.parse(data.toString());
      
      // Calculate response latency for consciousness metrics
      if (this.lastRequestTime) {
        const latency = timestamp - this.lastRequestTime;
        this.consciousnessMetrics.responseLatency.push(latency);
        
        // Keep only last 100 latency measurements
        if (this.consciousnessMetrics.responseLatency.length > 100) {
          this.consciousnessMetrics.responseLatency.shift();
        }
      }
      
      // Handle different message types according to BTCC API documentation
      if (message.code !== undefined) {
        // Response with status code
        this.handleStatusResponse(message, timestamp);
      } else if (message.action) {
        // Action-based messages
        this.handleActionMessage(message, timestamp);
      } else {
        // Data messages without explicit structure
        this.handleGenericData(message, timestamp);
      }
      
      // Update consciousness metrics
      this.updateConsciousnessMetrics(message, timestamp);
      
    } catch (error) {
      console.error('❌ Error parsing BTCC message:', error);
      console.error('Raw data:', data.toString());
    }
  }

  handleStatusResponse(message, timestamp) {
    if (message.code === 0) {
      // Success response
      if (message.data && message.data.LoginResult !== undefined) {
        // Login response
        this.handleLoginResponse(message, timestamp);
      } else if (message.data && message.data.Num) {
        // Dictionary response
        this.handleDictionaryResponse(message, timestamp);
      } else if (message.action === "Kline") {
        // Candlestick chart response
        this.handleCandlestickResponse(message, timestamp);
      } else if (message.action === "Panel") {
        // Board data response
        this.handleBoardDataResponse(message, timestamp);
      }
    } else {
      // Error response
      console.error(`❌ BTCC API error (${message.code}): ${message.msg}`);
      this.emit('error', new Error(`BTCC API error: ${message.msg}`));
    }
  }

  handleActionMessage(message, timestamp) {
    switch (message.action) {
      case 'tickinfo_deep':
        // Price level quotes
        this.handlePriceLevelQuotes(message, timestamp);
        break;
        
      case 'tickinfo':
        // Real-time quotes
        this.handleRealTimeQuotes(message, timestamp);
        break;
        
      case 'dealticksnap':
        // Transaction snapshot
        this.handleTransactionSnapshot(message, timestamp);
        break;
        
      case 'keeplive':
        // Heartbeat response
        this.handleHeartbeatResponse(message, timestamp);
        break;
        
      case 'All Products':
        // Market open time data
        this.handleMarketOpenTimeData(message, timestamp);
        break;
        
      default:
        console.log(`ℹ️ Unknown action: ${message.action}`);
        this.handleGenericData(message, timestamp);
    }
  }

  handleLoginResponse(message, timestamp) {
    const loginData = message.data;
    
    if (loginData.LoginResult === 0) {
      console.log('✅ BTCC authentication successful');
      this.isAuthenticated = true;
      this.startHeartbeat();
      this.emit('authenticated');
      
      // Store authentication data
      this.authData = {
        result: loginData.Result,
        dataSourceState: loginData.DataSourceState,
        token: loginData.token,
        seq: loginData.Seq,
        serverTime: {
          year: loginData.Year,
          month: loginData.Month,
          day: loginData.Day,
          timestamp: loginData.Time
        }
      };
      
    } else {
      console.error(`❌ BTCC authentication failed: Result ${loginData.LoginResult}`);
      this.emit('authenticationFailed', loginData);
    }
  }

  handleDictionaryResponse(message, timestamp) {
    console.log(`📚 Received BTCC dictionary with ${message.data.Num} products`);
    
    // Store product dictionary
    if (message.data.DictInfo) {
      message.data.DictInfo.forEach(product => {
        this.dictionary.set(product.SecID, {
          secId: product.SecID,
          shortName: product.ShortName,
          digit: product.Digit,
          zone: product.Zone,
          type: product.Type,
          companyType: product.CompanyType,
          timeRanges: {
            daylight: product.XlsStartEndTimeRange,
            standard: product.DlsStartEndTimeRange
          }
        });
      });
    }
    
    // Request board data for initial market overview
    this.requestBoardData();
  }

  handleMarketOpenTimeData(message, timestamp) {
    console.log('📅 Received market open time data');
    
    // Store market schedules
    if (message.data) {
      message.data.forEach(schedule => {
        // Store schedule data for consciousness enhancement
        this.storeMarketSchedule(schedule, timestamp);
      });
    }
  }

  handlePriceLevelQuotes(message, timestamp) {
    console.log('📊 Processing price level quotes (Level 2 data)');
    
    if (message.data && message.data.length > 0) {
      message.data.forEach(quote => {
        this.processPriceLevelData(quote, timestamp);
      });
    }
  }

  handleRealTimeQuotes(message, timestamp) {
    console.log('⚡ Processing real-time quotes');
    
    if (message.data && message.data.length > 0) {
      message.data.forEach(quote => {
        this.processRealTimeQuote(quote, timestamp);
      });
    }
  }

  handleTransactionSnapshot(message, timestamp) {
    console.log('📈 Processing transaction snapshot');
    
    if (message.data && message.data.length > 0) {
      message.data.forEach(snapshot => {
        this.processTransactionSnapshot(snapshot, timestamp);
      });
    }
  }

  handleCandlestickResponse(message, timestamp) {
    console.log('🕯️ Processing candlestick data');
    
    if (message.data && message.data.KdataInfo) {
      this.processCandlestickData(message.data, timestamp);
    }
  }

  handleBoardDataResponse(message, timestamp) {
    console.log('📋 Processing board data');
    
    if (message.data && message.data.Panel) {
      message.data.Panel.forEach(panelData => {
        this.processBoardData(panelData, timestamp);
      });
    }
    
    // After processing board data, subscribe to market data
    this.subscribeToMarketData();
  }

  handleHeartbeatResponse(message, timestamp) {
    this.lastHeartbeat = timestamp;
    console.log('💓 BTCC heartbeat acknowledged');
  }

  handleGenericData(message, timestamp) {
    // Store generic data with consciousness enhancement
    this.storeRawData('generic', 'unknown', message, timestamp);
  }

  async processPriceLevelData(quote, timestamp) {
    try {
      const symbolId = quote.Y;
      const product = this.dictionary.get(parseInt(symbolId));
      const symbol = product ? product.shortName : symbolId;

      // Extract Level 2 market data
      const marketData = {
        symbolId: symbolId,
        symbol: symbol,
        timestamp: parseInt(quote.T),
        currentPrice: parseFloat(quote.C),
        lastVolume: parseFloat(quote.V),
        askPrices: Array.isArray(quote.A) ? quote.A.map(p => parseFloat(p)) : [],
        bidPrices: Array.isArray(quote.B) ? quote.B.map(p => parseFloat(p)) : [],
        askVolumes: Array.isArray(quote.U) ? quote.U.map(v => parseFloat(v)) : [],
        bidVolumes: Array.isArray(quote.M) ? quote.M.map(v => parseFloat(v)) : [],
        askTotalVolumes: Array.isArray(quote.L) ? quote.L.map(v => parseFloat(v)) : [],
        bidTotalVolumes: Array.isArray(quote.I) ? quote.I.map(v => parseFloat(v)) : [],
        askPercentages: Array.isArray(quote.R) ? quote.R.map(p => parseFloat(p)) : [],
        bidPercentages: Array.isArray(quote.E) ? quote.E.map(p => parseFloat(p)) : []
      };

      // Store raw data
      await this.storeRawData('BTCC', symbol, quote, timestamp, 'price_level_quotes');
      
      // Apply consciousness enhancement
      await this.storeConsciousnessEnhancedData(symbol, marketData, timestamp);
      
      this.emit('priceLevelData', marketData);
      
    } catch (error) {
      console.error('❌ Error processing price level data:', error);
    }
  }

  async processRealTimeQuote(quote, timestamp) {
    try {
      const symbolId = quote.Y;
      const product = this.dictionary.get(parseInt(symbolId));
      const symbol = product ? product.shortName : symbolId;

      const marketData = {
        symbolId: symbolId,
        symbol: symbol,
        timestamp: parseInt(quote.T),
        currentPrice: parseFloat(quote.C),
        lastVolume: parseFloat(quote.V),
        askPrice: Array.isArray(quote.A) && quote.A.length > 0 ? parseFloat(quote.A[0]) : null,
        bidPrice: Array.isArray(quote.B) && quote.B.length > 0 ? parseFloat(quote.B[0]) : null,
        spread: null
      };

      // Calculate spread if both ask and bid are available
      if (marketData.askPrice && marketData.bidPrice) {
        marketData.spread = marketData.askPrice - marketData.bidPrice;
      }

      // Store raw data
      await this.storeRawData('BTCC', symbol, quote, timestamp, 'real_time_quotes');
      
      // Apply consciousness enhancement
      await this.storeConsciousnessEnhancedData(symbol, marketData, timestamp);
      
      this.emit('realTimeData', marketData);
      
    } catch (error) {
      console.error('❌ Error processing real-time quote:', error);
    }
  }

  async processTransactionSnapshot(snapshot, timestamp) {
    try {
      const symbolId = snapshot.Y;
      const product = this.dictionary.get(parseInt(symbolId));
      const symbol = product ? product.shortName : symbolId;

      if (snapshot.Items && Array.isArray(snapshot.Items)) {
        for (const transaction of snapshot.Items) {
          const transactionData = {
            symbolId: symbolId,
            symbol: symbol,
            price: parseFloat(transaction.P),
            volume: parseFloat(transaction.V),
            timestamp: parseInt(transaction.T)
          };

          // Store each transaction
          await this.storeRawData('BTCC', symbol, transaction, timestamp, 'transaction');
          
          // Apply consciousness enhancement for significant transactions
          if (transactionData.volume > 1.0) { // Threshold for significance
            await this.storeConsciousnessEnhancedData(symbol, transactionData, timestamp);
          }
        }
      }
      
      this.emit('transactionData', snapshot);
      
    } catch (error) {
      console.error('❌ Error processing transaction snapshot:', error);
    }
  }

  async processBoardData(panelData, timestamp) {
    try {
      const symbolId = panelData.CodeId;
      const product = this.dictionary.get(parseInt(symbolId));
      const symbol = product ? product.shortName : symbolId.toString();

      const boardData = {
        symbolId: symbolId,
        symbol: symbol,
        yesterdayPrice: panelData.YesterdayPrice,
        currentPrice: panelData.CurPrice,
        buyPrice: panelData.BuyPrice,
        sellPrice: panelData.SellPrice,
        openPrice: panelData.OpenPrice,
        highPrice: panelData.HighPrice,
        lowPrice: panelData.LowPrice,
        change: panelData.Change,
        isOpen: panelData.IsOpen === 1,
        timestamp: panelData.Time || timestamp
      };

      // Store raw data
      await this.storeRawData('BTCC', symbol, panelData, timestamp, 'board_data');
      
      // Apply consciousness enhancement
      if (boardData.currentPrice && boardData.currentPrice > 0) {
        await this.storeConsciousnessEnhancedData(symbol, boardData, timestamp);
      }
      
      this.emit('boardData', boardData);
      
    } catch (error) {
      console.error('❌ Error processing board data:', error);
    }
  }

  async processCandlestickData(data, timestamp) {
    try {
      const symbolId = data.CodeId;
      const product = this.dictionary.get(parseInt(symbolId));
      const symbol = product ? product.shortName : symbolId.toString();

      if (data.KdataInfo && Array.isArray(data.KdataInfo)) {
        for (const candle of data.KdataInfo) {
          const candleData = {
            symbolId: symbolId,
            symbol: symbol,
            timestamp: parseInt(candle.T),
            open: parseFloat(candle.O),
            close: parseFloat(candle.C),
            high: parseFloat(candle.H),
            low: parseFloat(candle.L),
            volume: parseFloat(candle.A) || 0,
            interval: data.Interval
          };

          // Store raw candlestick data
          await this.storeRawData('BTCC', symbol, candle, timestamp, 'candlestick');
          
          // Apply consciousness enhancement
          await this.storeConsciousnessEnhancedData(symbol, candleData, timestamp);
        }
      }
      
      this.emit('candlestickData', data);
      
    } catch (error) {
      console.error('❌ Error processing candlestick data:', error);
    }
  }

  // BTCC API Request Methods

  requestBoardData() {
    const request = {
      action: "ReqRealPanel",
      zone: [6, 3, 5, 1, 4, 7, 2], // All zones as per documentation
      seq: this.generateSequenceNumber()
    };

    console.log('📋 Requesting BTCC board data...');
    this.sendMessage(request);
  }

  subscribeToMarketData() {
    if (!this.isAuthenticated) {
      console.log('⏳ Waiting for authentication before subscribing...');
      return;
    }

    const request = {
      action: "ReqSubcri",
      symbols: this.options.subscriptionSymbols,
      deep: this.options.deepSymbol
    };

    console.log('📡 Subscribing to BTCC market data...');
    this.sendMessage(request);
    
    // Mark symbols as subscribed
    this.options.subscriptionSymbols.forEach(symbol => {
      this.subscriptions.add(symbol);
    });
  }

  requestCandlestickData(symbolId, interval = 35, fromTime = null, toTime = null) {
    const request = {
      action: "ReqKline",
      code: parseInt(symbolId),
      interval: interval, // 35 = 1min, see documentation for other intervals
      from: fromTime || Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000), // 24h ago
      to: toTime || Math.floor(Date.now() / 1000)
    };

    console.log(`🕯️ Requesting candlestick data for symbol ${symbolId}...`);
    this.sendMessage(request);
  }

  // Heartbeat and Connection Management

  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, this.options.heartbeatInterval);

    console.log(`💓 BTCC heartbeat started (${this.options.heartbeatInterval}ms interval)`);
  }

  sendHeartbeat() {
    if (!this.isConnected || !this.ws) {
      return;
    }

    const heartbeat = {
      action: "KeepLive"
    };

    this.sendMessage(heartbeat);
  }

  sendMessage(message) {
    if (!this.isConnected || !this.ws) {
      console.error('❌ Cannot send message: WebSocket not connected');
      return false;
    }

    try {
      const jsonMessage = JSON.stringify(message);
      this.ws.send(jsonMessage);
      this.lastRequestTime = Date.now();
      return true;
    } catch (error) {
      console.error('❌ Error sending message:', error);
      return false;
    }
  }

  handleDisconnection() {
    this.isConnected = false;
    this.isAuthenticated = false;
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    this.subscriptions.clear();
    
    this.emit('disconnected');
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.error(`❌ Max reconnection attempts (${this.options.maxReconnectAttempts}) reached`);
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.options.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
    
    console.log(`🔄 Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  // Consciousness Enhancement Methods

  async storeRawData(source, symbol, data, timestamp, dataType = 'unknown') {
    try {
      const rawDataEntry = {
        timestamp: timestamp,
        source: source,
        symbol: symbol,
        data_type: dataType,
        raw_data: JSON.stringify(data),
        processing_status: 'pending',
        price: this.extractPrice(data),
        volume: this.extractVolume(data),
        latency_ms: this.calculateLatency(),
        data_completeness: this.calculateDataCompleteness(data),
        anomaly_score: this.calculateAnomalyScore(data)
      };

      const query = `
        INSERT INTO raw_market_data (
          timestamp, source, symbol, data_type, raw_data, processing_status,
          price, volume, latency_ms, data_completeness, anomaly_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await this.database.runQuery(query, [
        rawDataEntry.timestamp,
        rawDataEntry.source,
        rawDataEntry.symbol,
        rawDataEntry.data_type,
        rawDataEntry.raw_data,
        rawDataEntry.processing_status,
        rawDataEntry.price,
        rawDataEntry.volume,
        rawDataEntry.latency_ms,
        rawDataEntry.data_completeness,
        rawDataEntry.anomaly_score
      ]);

      return result.lastID;
      
    } catch (error) {
      console.error('❌ Error storing raw data:', error);
      return null;
    }
  }

  async storeConsciousnessEnhancedData(symbol, marketData, timestamp) {
    try {
      const price = marketData.currentPrice || marketData.price || 0;
      const volume = marketData.volume || marketData.lastVolume || 0;

      if (price <= 0) {
        return; // Skip invalid price data
      }

      // Calculate consciousness enhancements
      const psiResonance = this.calculatePsiResonance(price, timestamp);
      const psiFrequency = PSI_0 * FREQ_432 * (1 + (price % 1) * PSI_0);
      const psiHarmonicScore = Math.sin(2 * Math.PI * psiResonance) * 0.5 + 0.5;

      const phiAlignment = this.calculatePhiAlignment(price, volume);
      const phiPriceRatio = (price % PHI) / PHI;
      const phiVolumeRatio = volume > 0 ? (volume % PHI) / PHI : 0;

      const freq432Rhythm = this.calculate432Rhythm(timestamp);
      const rhythmPhase = (timestamp % (FREQ_432 * 1000)) / (FREQ_432 * 1000);
      const temporalCoherence = 1 - Math.abs(rhythmPhase - 0.5) * 2;

      const overallConsciousnessScore = (psiResonance + phiAlignment + freq432Rhythm) / 3;
      
      const consciousnessState = this.determineConsciousnessState(overallConsciousnessScore);
      const harmonicClassification = this.classifyHarmonics(psiResonance, phiAlignment, freq432Rhythm);
      
      const marketEmotion = this.determineMarketEmotion(price, volume, marketData);
      const sentimentFrequency = this.calculateSentimentFrequency(marketEmotion);
      const collectiveConsciousness = this.determineCollectiveConsciousness(overallConsciousnessScore);

      // Get the raw data ID for foreign key reference
      const rawDataId = await this.getLatestRawDataId(symbol, timestamp);

      const query = `
        INSERT INTO consciousness_enhanced_data (
          raw_data_id, symbol, timestamp, price, volume,
          psi_resonance, psi_frequency, psi_harmonic_score,
          phi_alignment, phi_price_ratio, phi_volume_ratio,
          freq_432_rhythm, rhythm_phase, temporal_coherence,
          overall_consciousness_score, consciousness_state, harmonic_classification,
          market_emotion, sentiment_frequency, collective_consciousness,
          momentum_consciousness, volatility_consciousness, liquidity_resonance
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await this.database.runQuery(query, [
        rawDataId || 0,
        symbol,
        timestamp,
        price,
        volume,
        psiResonance,
        psiFrequency,
        psiHarmonicScore,
        phiAlignment,
        phiPriceRatio,
        phiVolumeRatio,
        freq432Rhythm,
        rhythmPhase,
        temporalCoherence,
        overallConsciousnessScore,
        consciousnessState,
        harmonicClassification,
        marketEmotion,
        sentimentFrequency,
        collectiveConsciousness,
        this.calculateMomentumConsciousness(marketData),
        this.calculateVolatilityConsciousness(marketData),
        this.calculateLiquidityResonance(marketData)
      ]);

    } catch (error) {
      console.error('❌ Error storing consciousness-enhanced data:', error);
    }
  }

  // Consciousness Calculation Methods

  calculatePsiResonance(price, timestamp) {
    const priceNormalized = (price % 100) / 100;
    const timeNormalized = (timestamp % 86400000) / 86400000; // 24h normalization
    const combined = (priceNormalized + timeNormalized) / 2;
    return 1 - Math.abs(combined - PSI_0);
  }

  calculatePhiAlignment(price, volume) {
    const priceRatio = price / (price + 1);
    const volumeRatio = volume > 0 ? volume / (volume + 1) : 0;
    const goldenRatio = 1 / PHI;
    
    const priceAlignment = 1 - Math.abs(priceRatio - goldenRatio);
    const volumeAlignment = 1 - Math.abs(volumeRatio - goldenRatio);
    
    return (priceAlignment + volumeAlignment) / 2;
  }

  calculate432Rhythm(timestamp) {
    const secondsInDay = 86400;
    const timeOfDay = (timestamp / 1000) % secondsInDay;
    const rhythmCycles = (timeOfDay / secondsInDay) * FREQ_432;
    const rhythmPhase = rhythmCycles % 1.0;
    
    return Math.sin(2 * Math.PI * rhythmPhase) * 0.5 + 0.5;
  }

  determineConsciousnessState(score) {
    if (score > 0.8) return 'HIGHLY_CONSCIOUS';
    if (score > 0.6) return 'CONSCIOUS';
    if (score > 0.4) return 'MODERATE';
    if (score > 0.2) return 'LOW_CONSCIOUSNESS';
    return 'UNCONSCIOUS';
  }

  classifyHarmonics(psi, phi, freq432) {
    const dominant = Math.max(psi, phi, freq432);
    if (dominant === psi) return 'PSI_DOMINANT';
    if (dominant === phi) return 'PHI_DOMINANT';
    return 'FREQ_432_DOMINANT';
  }

  determineMarketEmotion(price, volume, marketData) {
    // Simple emotion classification based on price action
    if (marketData.change > 0) {
      return volume > 1000 ? 'EUPHORIC' : 'OPTIMISTIC';
    } else if (marketData.change < 0) {
      return volume > 1000 ? 'PANIC' : 'PESSIMISTIC';
    }
    return 'NEUTRAL';
  }

  calculateSentimentFrequency(emotion) {
    const emotionFrequencies = {
      'EUPHORIC': FREQ_432 * 2,
      'OPTIMISTIC': FREQ_432 * 1.5,
      'NEUTRAL': FREQ_432,
      'PESSIMISTIC': FREQ_432 * 0.75,
      'PANIC': FREQ_432 * 0.5
    };
    return emotionFrequencies[emotion] || FREQ_432;
  }

  determineCollectiveConsciousness(score) {
    if (score > 0.8) return 'ENLIGHTENED';
    if (score > 0.6) return 'AWAKENING';
    if (score > 0.4) return 'STIRRING';
    if (score > 0.2) return 'DORMANT';
    return 'UNCONSCIOUS';
  }

  calculateMomentumConsciousness(marketData) {
    // Placeholder - would implement momentum analysis
    return 0.5;
  }

  calculateVolatilityConsciousness(marketData) {
    // Placeholder - would implement volatility analysis
    return 0.5;
  }

  calculateLiquidityResonance(marketData) {
    // Placeholder - would implement liquidity analysis
    return 0.5;
  }

  // Utility Methods

  extractPrice(data) {
    return data.CurPrice || data.C || data.P || data.price || null;
  }

  extractVolume(data) {
    return data.V || data.volume || data.lastVolume || null;
  }

  calculateLatency() {
    if (this.lastRequestTime) {
      return Date.now() - this.lastRequestTime;
    }
    return 0;
  }

  calculateDataCompleteness(data) {
    // Simple completeness check
    const totalFields = Object.keys(data).length;
    const filledFields = Object.values(data).filter(value => 
      value !== null && value !== undefined && value !== ''
    ).length;
    
    return totalFields > 0 ? filledFields / totalFields : 0;
  }

  calculateAnomalyScore(data) {
    // Placeholder for anomaly detection
    return 0.0;
  }

  async getLatestRawDataId(symbol, timestamp) {
    try {
      const query = `
        SELECT id FROM raw_market_data 
        WHERE symbol = ? AND timestamp <= ? 
        ORDER BY timestamp DESC LIMIT 1
      `;
      
      const result = await this.database.getQuery(query, [symbol, timestamp]);
      return result ? result.id : null;
    } catch (error) {
      console.error('❌ Error getting latest raw data ID:', error);
      return null;
    }
  }

  generateSequenceNumber() {
    return Math.floor(Math.random() * 1000000) + Date.now() % 1000000;
  }

  updateConsciousnessMetrics(message, timestamp) {
    // Update running consciousness metrics
    this.consciousnessMetrics.connectionStability = this.isConnected ? 1.0 : 0.0;
    
    // Calculate average latency
    if (this.consciousnessMetrics.responseLatency.length > 0) {
      const avgLatency = this.consciousnessMetrics.responseLatency.reduce((a, b) => a + b, 0) / 
                         this.consciousnessMetrics.responseLatency.length;
      this.consciousnessMetrics.averageLatency = avgLatency;
    }
  }

  async storeMarketSchedule(schedule, timestamp) {
    // Store market schedule data for consciousness-enhanced timing
    try {
      await this.storeRawData('BTCC', 'market_schedule', schedule, timestamp, 'market_schedule');
    } catch (error) {
      console.error('❌ Error storing market schedule:', error);
    }
  }

  // Public Methods

  disconnect() {
    console.log('🔌 Disconnecting from BTCC WebSocket...');
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.isConnected = false;
    this.isAuthenticated = false;
    this.subscriptions.clear();
  }

  getConnectionStatus() {
    return {
      connected: this.isConnected,
      authenticated: this.isAuthenticated,
      subscriptions: Array.from(this.subscriptions),
      consciousness: this.consciousnessMetrics,
      lastHeartbeat: this.lastHeartbeat,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

module.exports = BTCCWebSocketCollector;
