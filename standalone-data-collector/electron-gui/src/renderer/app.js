/**
 * ψ₀-Trader Data Collector - Electron Renderer Application
 * Enhanced Nexus Core Protocol v4.1
 * Consciousness-Enhanced Desktop Interface Logic
 */

class ConsciousnessEnhancedApp {
  constructor() {
    this.api = window.psiTraderAPI;
    this.currentSection = 'dashboard';
    this.terminalHistory = [];
    this.terminalHistoryIndex = -1;
    this.collectorStatus = { running: false, pid: null };
    this.configuration = {};
    this.realTimeData = {
      recordsPerSecond: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      uptime: 0
    };
    this.dataDestinations = [];
    this.activityStream = [];
    this.updateIntervals = [];
    
    this.init();
  }

  async init() {
    console.log('🌀 Initializing ψ₀-Trader Desktop Interface...');
    
    try {
      // Setup UI event handlers
      this.setupEventHandlers();
      
      // Setup IPC event listeners
      this.setupIPCListeners();
      
      // Load initial configuration
      await this.loadConfiguration();
      
      // Initialize UI state
      this.initializeUI();
      
      // Start real-time updates
      this.startRealTimeUpdates();
      
      console.log('✅ ψ₀-Trader Desktop Interface Ready');
      
    } catch (error) {
      console.error('❌ Failed to initialize application:', error);
      this.showError('Initialization failed', error.message);
    }
  }

  setupEventHandlers() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const section = e.currentTarget.dataset.section;
        this.switchSection(section);
      });
    });

    // Window controls
    document.getElementById('minimizeBtn')?.addEventListener('click', () => {
      this.api.window.minimize();
    });

    document.getElementById('maximizeBtn')?.addEventListener('click', () => {
      this.api.window.maximize();
    });

    document.getElementById('closeBtn')?.addEventListener('click', () => {
      this.api.window.close();
    });

    // Data collector controls
    document.getElementById('startCollectorBtn')?.addEventListener('click', () => {
      this.startDataCollector();
    });

    document.getElementById('stopCollectorBtn')?.addEventListener('click', () => {
      this.stopDataCollector();
    });

    // Terminal
    const terminalInput = document.getElementById('terminalInput');
    if (terminalInput) {
      terminalInput.addEventListener('keydown', (e) => {
        this.handleTerminalKeydown(e);
      });
    }

    // Terminal suggestions
    document.querySelectorAll('.suggestion-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const command = e.target.dataset.command;
        this.executeTerminalCommand(command);
      });
    });

    // Clear terminal
    document.getElementById('clearTerminalBtn')?.addEventListener('click', () => {
      this.clearTerminal();
    });

    // Dashboard actions
    document.getElementById('refreshDashboardBtn')?.addEventListener('click', () => {
      this.refreshDashboard();
    });

    // Stream configuration
    document.getElementById('saveStreamConfigBtn')?.addEventListener('click', () => {
      this.saveStreamConfiguration();
    });

    document.getElementById('addDestinationBtn')?.addEventListener('click', () => {
      this.addDataDestination();
    });

    // Database actions
    document.getElementById('browseDatabaseBtn')?.addEventListener('click', () => {
      this.browseDatabaseFile();
    });

    // Configuration actions
    document.getElementById('saveConfigBtn')?.addEventListener('click', () => {
      this.saveConfiguration();
    });

    document.getElementById('resetConfigBtn')?.addEventListener('click', () => {
      this.resetConfiguration();
    });

    // Range inputs
    document.querySelectorAll('input[type="range"]').forEach(range => {
      range.addEventListener('input', (e) => {
        const valueSpan = e.target.nextElementSibling;
        if (valueSpan && valueSpan.classList.contains('range-value')) {
          valueSpan.textContent = e.target.value;
        }
      });
    });

    // Database type switching
    document.getElementById('databaseType')?.addEventListener('change', (e) => {
      this.switchDatabaseType(e.target.value);
    });

    // Activity filters
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.filterActivityStream(e.target.dataset.filter);
      });
    });
  }

  setupIPCListeners() {
    // Application initialization
    this.api.ui.onAppInitialized((data) => {
      console.log('🌀 App initialized with data:', data);
      this.updateConsciousnessIndicator(data.constants);
    });

    // Data collector status changes
    this.api.dataCollector.onStatusChanged((status) => {
      this.updateCollectorStatus(status);
    });

    // Data collector output
    this.api.dataCollector.onOutput((output) => {
      this.addTerminalOutput(output, 'collector');
    });

    // Terminal output
    this.api.terminal.onOutput((output) => {
      this.addTerminalOutput(output, 'main');
    });

    // Configuration import/export
    this.api.config.onImport((data) => {
      this.importConfiguration(data.filePath);
    });

    this.api.config.onExport((data) => {
      this.exportConfiguration(data.filePath);
    });

    // Modal handling
    this.api.ui.onShowModal((modalData) => {
      this.showModal(modalData);
    });

    this.api.ui.onShowPanel((panelId) => {
      this.switchSection(panelId);
    });
  }

  async loadConfiguration() {
    try {
      const result = await this.api.config.load();
      if (result.success) {
        this.configuration = result.config;
        this.applyConfigurationToUI();
      }
    } catch (error) {
      console.error('Failed to load configuration:', error);
    }
  }

  initializeUI() {
    // Initialize consciousness constants display
    this.updateMathematicalConstants();
    
    // Initialize collector status
    this.updateCollectorStatus({ running: false });
    
    // Initialize dashboard
    this.refreshDashboard();
    
    // Initialize data destinations
    this.initializeDataDestinations();
    
    // Set initial section
    this.switchSection('dashboard');
  }

  updateMathematicalConstants() {
    const constants = this.api.constants;
    
    // Update sidebar constants
    const constantElements = document.querySelectorAll('.constant');
    constantElements.forEach((el, index) => {
      const symbol = el.querySelector('.constant-symbol');
      const value = el.querySelector('.constant-value');
      
      switch (index) {
        case 0:
          symbol.textContent = 'ψ₀';
          value.textContent = constants.PSI_0.toString();
          break;
        case 1:
          symbol.textContent = 'φ';
          value.textContent = constants.PHI.toString();
          break;
        case 2:
          symbol.textContent = '432Hz';
          value.textContent = constants.FREQ_432.toString();
          break;
      }
    });

    // Update configuration form
    const psiZeroInput = document.getElementById('psiZero');
    const phiInput = document.getElementById('phi');
    const freq432Input = document.getElementById('freq432');
    
    if (psiZeroInput) psiZeroInput.value = constants.PSI_0;
    if (phiInput) phiInput.value = constants.PHI;
    if (freq432Input) freq432Input.value = constants.FREQ_432;
  }

  updateConsciousnessIndicator(constants) {
    const orb = document.getElementById('consciousnessOrb');
    const label = document.getElementById('consciousnessLabel');
    
    if (orb && label) {
      // Animate the orb based on consciousness state
      const consciousnessLevel = this.calculateSystemConsciousness(constants);
      const color = this.generateConsciousnessColor(consciousnessLevel);
      
      orb.style.background = color.hsl;
      orb.style.boxShadow = `0 0 8px ${color.hsl}`;
      
      label.textContent = `CONSCIOUSNESS ${color.consciousnessLevel}`;
    }
  }

  calculateSystemConsciousness(constants) {
    // Simple consciousness calculation based on mathematical harmony
    const psiResonance = this.api.consciousness.calculatePsiResonance(Date.now() % 1000 / 1000);
    const phiAlignment = this.api.consciousness.calculatePhiAlignment(Date.now() % 10000 / 1000);
    const freq432Resonance = this.api.consciousness.calculate432HzResonance(432);
    
    return this.api.consciousness.calculateConsciousnessScore(
      psiResonance, phiAlignment, freq432Resonance, 1.0
    );
  }

  generateConsciousnessColor(consciousnessScore) {
    return this.api.utils.generateConsciousnessColor(consciousnessScore);
  }

  switchSection(sectionId) {
    // Update navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
    });
    
    document.querySelector(`[data-section="${sectionId}"]`)?.classList.add('active');
    
    // Update content sections
    document.querySelectorAll('.content-section').forEach(section => {
      section.classList.remove('active');
    });
    
    document.getElementById(`${sectionId}-section`)?.classList.add('active');
    
    this.currentSection = sectionId;
    
    // Section-specific initialization
    switch (sectionId) {
      case 'dashboard':
        this.refreshDashboard();
        break;
      case 'terminal':
        this.focusTerminal();
        break;
      case 'consciousness':
        this.refreshConsciousnessMetrics();
        break;
      case 'database':
        this.refreshDatabaseStats();
        break;
    }
  }

  async startDataCollector() {
    try {
      const result = await this.api.dataCollector.start();
      
      if (result.success) {
        this.addTerminalOutput({
          type: 'stdout',
          data: `✅ Data collector started successfully (PID: ${result.pid})\n`,
          timestamp: Date.now()
        }, 'collector');
      } else {
        this.addTerminalOutput({
          type: 'stderr',
          data: `❌ Failed to start data collector: ${result.message}\n`,
          timestamp: Date.now()
        }, 'collector');
      }
    } catch (error) {
      console.error('Error starting data collector:', error);
      this.showError('Start Failed', error.message);
    }
  }

  async stopDataCollector() {
    try {
      const result = await this.api.dataCollector.stop();
      
      if (result.success) {
        this.addTerminalOutput({
          type: 'stdout',
          data: `🛑 Data collector stopped successfully\n`,
          timestamp: Date.now()
        }, 'collector');
      } else {
        this.addTerminalOutput({
          type: 'stderr',
          data: `❌ Failed to stop data collector: ${result.message}\n`,
          timestamp: Date.now()
        }, 'collector');
      }
    } catch (error) {
      console.error('Error stopping data collector:', error);
      this.showError('Stop Failed', error.message);
    }
  }

  updateCollectorStatus(status) {
    this.collectorStatus = status;
    
    const statusLight = document.getElementById('collectorStatusLight');
    const statusText = document.getElementById('collectorStatusText');
    
    if (statusLight && statusText) {
      statusLight.className = 'status-light';
      
      if (status.running) {
        statusLight.classList.add('running');
        statusText.textContent = `RUNNING (PID: ${status.pid})`;
      } else if (status.exitCode !== undefined) {
        statusLight.classList.add('error');
        statusText.textContent = `STOPPED (EXIT: ${status.exitCode})`;
      } else {
        statusText.textContent = 'STOPPED';
      }
    }

    // Update dashboard status badge
    const systemStatusBadge = document.getElementById('systemStatusBadge');
    if (systemStatusBadge) {
      systemStatusBadge.textContent = status.running ? 'ACTIVE' : 'IDLE';
      systemStatusBadge.className = 'status-badge';
      if (status.running) {
        systemStatusBadge.style.background = 'var(--status-success)';
      } else {
        systemStatusBadge.style.background = 'var(--status-warning)';
      }
    }
  }

  handleTerminalKeydown(e) {
    const terminalInput = e.target;
    
    if (e.key === 'Enter') {
      const command = terminalInput.value.trim();
      if (command) {
        this.executeTerminalCommand(command);
        
        // Add to history
        this.terminalHistory.push(command);
        this.terminalHistoryIndex = this.terminalHistory.length;
        
        terminalInput.value = '';
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.terminalHistoryIndex > 0) {
        this.terminalHistoryIndex--;
        terminalInput.value = this.terminalHistory[this.terminalHistoryIndex];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.terminalHistoryIndex < this.terminalHistory.length - 1) {
        this.terminalHistoryIndex++;
        terminalInput.value = this.terminalHistory[this.terminalHistoryIndex];
      } else {
        this.terminalHistoryIndex = this.terminalHistory.length;
        terminalInput.value = '';
      }
    }
  }

  async executeTerminalCommand(command) {
    // Add command to terminal output
    this.addTerminalOutput({
      type: 'command',
      data: command,
      timestamp: Date.now()
    }, 'main');

    try {
      const result = await this.api.terminal.execute(command);
      
      if (!result.success) {
        this.addTerminalOutput({
          type: 'stderr',
          data: `Error: ${result.error}\n`,
          timestamp: Date.now()
        }, 'main');
      }
    } catch (error) {
      this.addTerminalOutput({
        type: 'stderr',
        data: `Failed to execute command: ${error.message}\n`,
        timestamp: Date.now()
      }, 'main');
    }
  }

  addTerminalOutput(output, tab = 'main') {
    const terminalOutput = document.getElementById('terminalOutput');
    if (!terminalOutput) return;

    const line = document.createElement('div');
    line.className = 'terminal-line';
    
    if (output.type === 'command') {
      line.innerHTML = `
        <span class="prompt">🌀 ψ₀-Trader $</span>
        <span class="output">${this.escapeHtml(output.data)}</span>
      `;
    } else {
      line.classList.add(output.type === 'stderr' ? 'error' : 'success');
      line.innerHTML = `<span class="output">${this.escapeHtml(output.data)}</span>`;
    }

    terminalOutput.appendChild(line);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;

    // Limit terminal output lines
    const lines = terminalOutput.querySelectorAll('.terminal-line');
    if (lines.length > 1000) {
      lines[0].remove();
    }
  }

  clearTerminal() {
    const terminalOutput = document.getElementById('terminalOutput');
    if (terminalOutput) {
      terminalOutput.innerHTML = `
        <div class="terminal-line welcome">
          <span class="prompt">🌀 ψ₀-Trader $</span>
          <span class="output">Enhanced Nexus Core Protocol v4.1 - Terminal Cleared</span>
        </div>
      `;
    }
  }

  focusTerminal() {
    const terminalInput = document.getElementById('terminalInput');
    if (terminalInput) {
      terminalInput.focus();
    }
  }

  async refreshDashboard() {
    try {
      // Get database stats
      const dbStats = await this.api.database.getStats();
      if (dbStats.success) {
        this.updateDashboardStats(dbStats.stats);
      }

      // Get consciousness metrics
      const consciousnessMetrics = await this.api.database.getConsciousnessMetrics();
      if (consciousnessMetrics.success) {
        this.updateConsciousnessMetrics(consciousnessMetrics.metrics);
      }

      // Update activity stream
      this.refreshActivityStream();

    } catch (error) {
      console.error('Failed to refresh dashboard:', error);
    }
  }

  updateDashboardStats(stats) {
    const totalRecordsEl = document.getElementById('totalRecords');
    const avgConsciousnessScoreEl = document.getElementById('avgConsciousnessScore');
    const resonanceMatchesEl = document.getElementById('resonanceMatches');
    const databaseSizeEl = document.getElementById('databaseSize');

    if (totalRecordsEl) totalRecordsEl.textContent = stats.total_records || 0;
    if (avgConsciousnessScoreEl) {
      avgConsciousnessScoreEl.textContent = (stats.avg_consciousness_score || 0).toFixed(3);
    }
    if (resonanceMatchesEl) resonanceMatchesEl.textContent = stats.resonance_matches || 0;
    if (databaseSizeEl) {
      databaseSizeEl.textContent = `${(stats.database_size_mb || 0).toFixed(1)} MB`;
    }
  }

  updateConsciousnessMetrics(metrics) {
    // Update consciousness score display
    const consciousnessScore = metrics.topRecords?.[0]?.consciousness_score || 0;
    const consciousnessScoreDisplay = document.getElementById('consciousnessScoreDisplay');
    if (consciousnessScoreDisplay) {
      consciousnessScoreDisplay.textContent = consciousnessScore.toFixed(3);
    }

    // Update consciousness bars
    this.updateConsciousnessBars(consciousnessScore);

    // Update consciousness circle color
    const circle = document.getElementById('consciousnessCircle');
    if (circle) {
      const color = this.generateConsciousnessColor(consciousnessScore);
      circle.style.background = `conic-gradient(
        from 0deg,
        ${color.hsl} 0deg,
        var(--accent-phi) 120deg,
        var(--accent-freq) 240deg,
        ${color.hsl} 360deg
      )`;
    }
  }

  updateConsciousnessBars(consciousnessScore) {
    // Simulate individual component scores
    const psiResonance = Math.random() * 0.3 + consciousnessScore * 0.4;
    const phiAlignment = Math.random() * 0.3 + consciousnessScore * 0.3;
    const freqRhythm = Math.random() * 0.3 + consciousnessScore * 0.3;

    const psiBar = document.getElementById('psiBar');
    const phiBar = document.getElementById('phiBar');
    const freqBar = document.getElementById('freqBar');

    if (psiBar) psiBar.style.width = `${(psiResonance * 100)}%`;
    if (phiBar) phiBar.style.width = `${(phiAlignment * 100)}%`;
    if (freqBar) freqBar.style.width = `${(freqRhythm * 100)}%`;
  }

  refreshActivityStream() {
    // Simulate activity stream data
    const activities = [
      {
        type: 'market',
        title: 'BTC/USDT Price Update',
        meta: 'Consciousness Score: 0.856 • 2 minutes ago',
        timestamp: Date.now() - 2 * 60 * 1000
      },
      {
        type: 'news',
        title: 'Bullish Market Sentiment Detected',
        meta: 'Harmonic Analysis: Strong • 5 minutes ago',
        timestamp: Date.now() - 5 * 60 * 1000
      },
      {
        type: 'social',
        title: 'Twitter Sentiment Shift',
        meta: 'Engagement Score: 0.742 • 8 minutes ago',
        timestamp: Date.now() - 8 * 60 * 1000
      }
    ];

    this.activityStream = activities;
    this.renderActivityStream();
  }

  renderActivityStream(filter = 'all') {
    const activityStreamEl = document.getElementById('activityStream');
    if (!activityStreamEl) return;

    const filteredActivities = filter === 'all' 
      ? this.activityStream 
      : this.activityStream.filter(item => item.type === filter);

    activityStreamEl.innerHTML = filteredActivities.map(activity => `
      <div class="activity-item">
        <div class="activity-type ${activity.type}"></div>
        <div class="activity-content">
          <div class="activity-title">${activity.title}</div>
          <div class="activity-meta">${activity.meta}</div>
        </div>
      </div>
    `).join('');
  }

  filterActivityStream(filter) {
    this.renderActivityStream(filter);
  }

  async refreshConsciousnessMetrics() {
    try {
      const result = await this.api.database.getConsciousnessMetrics();
      if (result.success) {
        this.renderConsciousnessDashboard(result.metrics);
      }
    } catch (error) {
      console.error('Failed to refresh consciousness metrics:', error);
    }
  }

  renderConsciousnessDashboard(metrics) {
    // Render consciousness distribution chart
    this.renderDistributionChart(metrics.distribution);
    
    // Render frequency spectrum
    this.renderFrequencySpectrum();
    
    // Render high-consciousness events
    this.renderConsciousnessEvents(metrics.topRecords);
  }

  renderDistributionChart(distribution) {
    const chartEl = document.getElementById('distributionChart');
    if (!chartEl || !distribution) return;

    chartEl.innerHTML = distribution.map(bucket => {
      const barHeight = Math.max(bucket.count * 2, 4);
      return `
        <div class="distribution-bar" style="height: ${barHeight}px; background: var(--accent-freq);">
          <span class="bar-label">${bucket.score_range}</span>
          <span class="bar-value">${bucket.count}</span>
        </div>
      `;
    }).join('');
  }

  renderFrequencySpectrum() {
    const spectrumEl = document.getElementById('frequencySpectrum');
    if (!spectrumEl) return;

    // Simulate frequency spectrum data
    const frequencies = [
      { freq: '395.57Hz', label: 'ψ₀ Resonance', intensity: 0.8 },
      { freq: '699.39Hz', label: 'φ Scaling', intensity: 0.6 },
      { freq: '432Hz', label: 'Base Rhythm', intensity: 0.9 }
    ];

    spectrumEl.innerHTML = frequencies.map(freq => `
      <div class="frequency-item">
        <div class="frequency-bar" style="height: ${freq.intensity * 100}px;"></div>
        <div class="frequency-label">${freq.freq}</div>
        <div class="frequency-description">${freq.label}</div>
      </div>
    `).join('');
  }

  renderConsciousnessEvents(topRecords) {
    const eventsEl = document.getElementById('consciousnessEvents');
    if (!eventsEl || !topRecords) return;

    eventsEl.innerHTML = topRecords.slice(0, 10).map(record => {
      const timestamp = this.api.utils.formatTimestamp(record.timestamp);
      return `
        <div class="consciousness-event">
          <div class="event-score">${record.consciousness_score.toFixed(3)}</div>
          <div class="event-details">
            <div class="event-type">${record.data_type.toUpperCase()}</div>
            <div class="event-symbol">${record.symbol || 'N/A'}</div>
            <div class="event-time">${timestamp.formatted}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  async refreshDatabaseStats() {
    try {
      const result = await this.api.database.getStats();
      if (result.success) {
        this.updateDatabaseDisplay(result.stats);
      }
    } catch (error) {
      console.error('Failed to refresh database stats:', error);
    }
  }

  updateDatabaseDisplay(stats) {
    const totalTablesEl = document.getElementById('totalTables');
    const totalDbRecordsEl = document.getElementById('totalDbRecords');
    const dbSizeEl = document.getElementById('dbSize');
    const lastUpdatedEl = document.getElementById('lastUpdated');

    if (totalTablesEl) totalTablesEl.textContent = stats.total_tables || 0;
    if (totalDbRecordsEl) totalDbRecordsEl.textContent = stats.total_records || 0;
    if (dbSizeEl) dbSizeEl.textContent = `${(stats.database_size_mb || 0).toFixed(1)} MB`;
    if (lastUpdatedEl) {
      lastUpdatedEl.textContent = stats.last_updated 
        ? new Date(stats.last_updated).toLocaleString() 
        : 'Never';
    }
  }

  async browseDatabaseFile() {
    try {
      const result = await this.api.database.selectFile();
      if (!result.canceled && result.filePaths.length > 0) {
        const databasePathEl = document.getElementById('databasePath');
        if (databasePathEl) {
          databasePathEl.value = result.filePaths[0];
        }
      }
    } catch (error) {
      console.error('Failed to browse database file:', error);
    }
  }

  switchDatabaseType(type) {
    // Hide all config sections
    document.getElementById('sqliteConfig')?.classList.add('hidden');
    document.getElementById('postgresConfig')?.classList.add('hidden');
    document.getElementById('astraConfig')?.classList.add('hidden');

    // Show relevant config section
    switch (type) {
      case 'sqlite':
        document.getElementById('sqliteConfig')?.classList.remove('hidden');
        break;
      case 'postgresql':
        document.getElementById('postgresConfig')?.classList.remove('hidden');
        break;
      case 'astra':
        document.getElementById('astraConfig')?.classList.remove('hidden');
        break;
    }
  }

  async saveStreamConfiguration() {
    try {
      const config = this.collectStreamConfiguration();
      const result = await this.api.dataStream.configure(config);
      
      if (result.success) {
        this.showSuccess('Configuration Saved', 'Data stream configuration saved successfully');
      } else {
        this.showError('Save Failed', result.error);
      }
    } catch (error) {
      console.error('Failed to save stream configuration:', error);
      this.showError('Save Failed', error.message);
    }
  }

  collectStreamConfiguration() {
    return {
      webhookEnabled: document.getElementById('webhookEnabled')?.checked || false,
      webhookPort: document.getElementById('webhookPort')?.value || 3001,
      rateLimit: document.getElementById('rateLimit')?.value || 100,
      sampleDataEnabled: document.getElementById('sampleDataEnabled')?.checked || false,
      sampleInterval: document.getElementById('sampleInterval')?.value || 30,
      sampleBatchSize: document.getElementById('sampleBatchSize')?.value || 5,
      consciousnessEnabled: document.getElementById('consciousnessEnabled')?.checked || true,
      enhancementLevel: document.getElementById('enhancementLevel')?.value || 'medium',
      resonanceThreshold: document.getElementById('resonanceThreshold')?.value || 0.05,
      patternRecognitionEnabled: document.getElementById('patternRecognitionEnabled')?.checked || true,
      destinations: this.dataDestinations
    };
  }

  initializeDataDestinations() {
    this.dataDestinations = [
      {
        id: 'sqlite_primary',
        name: 'SQLite Primary',
        type: 'sqlite',
        path: './data/psi-trader-collector.db',
        enabled: true,
        dataTypes: ['market', 'news', 'social']
      },
      {
        id: 'json_export',
        name: 'JSON Export',
        type: 'file',
        path: './exports/',
        enabled: false,
        dataTypes: ['market']
      }
    ];

    this.renderDataDestinations();
  }

  renderDataDestinations() {
    const destinationListEl = document.getElementById('destinationList');
    if (!destinationListEl) return;

    destinationListEl.innerHTML = this.dataDestinations.map(dest => `
      <div class="destination-item" data-id="${dest.id}">
        <div class="destination-header">
          <div class="destination-info">
            <h4>${dest.name}</h4>
            <span class="destination-type">${dest.type.toUpperCase()}</span>
          </div>
          <div class="destination-controls">
            <div class="toggle-switch">
              <input type="checkbox" id="dest_${dest.id}" ${dest.enabled ? 'checked' : ''}>
              <label for="dest_${dest.id}"></label>
            </div>
            <button class="remove-btn" onclick="app.removeDataDestination('${dest.id}')">×</button>
          </div>
        </div>
        <div class="destination-details">
          <div class="destination-path">${dest.path}</div>
          <div class="destination-types">Types: ${dest.dataTypes.join(', ')}</div>
        </div>
      </div>
    `).join('');
  }

  addDataDestination() {
    const newDestination = {
      id: this.api.utils.generateConsciousnessId(),
      name: 'New Destination',
      type: 'sqlite',
      path: './data/new-destination.db',
      enabled: true,
      dataTypes: ['market']
    };

    this.dataDestinations.push(newDestination);
    this.renderDataDestinations();
  }

  removeDataDestination(id) {
    this.dataDestinations = this.dataDestinations.filter(dest => dest.id !== id);
    this.renderDataDestinations();
  }

  applyConfigurationToUI() {
    // Apply loaded configuration to UI elements
    Object.entries(this.configuration).forEach(([key, value]) => {
      const element = document.getElementById(key);
      if (element) {
        if (element.type === 'checkbox') {
          element.checked = value === 'true';
        } else {
          element.value = value;
        }
      }
    });
  }

  async saveConfiguration() {
    try {
      const config = this.collectConfiguration();
      const result = await this.api.config.save(config);
      
      if (result.success) {
        this.showSuccess('Configuration Saved', 'System configuration saved successfully');
      } else {
        this.showError('Save Failed', result.error);
      }
    } catch (error) {
      console.error('Failed to save configuration:', error);
      this.showError('Save Failed', error.message);
    }
  }

  collectConfiguration() {
    const config = {};
    
    // Collect all form inputs
    document.querySelectorAll('input, select, textarea').forEach(element => {
      if (element.id) {
        if (element.type === 'checkbox') {
          config[element.id] = element.checked.toString();
        } else {
          config[element.id] = element.value;
        }
      }
    });

    return config;
  }

  resetConfiguration() {
    if (confirm('Are you sure you want to reset all configuration to defaults?')) {
      // Reset to default values
      this.configuration = {};
      this.applyConfigurationToUI();
      this.showSuccess('Configuration Reset', 'All settings reset to defaults');
    }
  }

  startRealTimeUpdates() {
    // Update real-time statistics
    const updateRealTimeStats = () => {
      this.updateRealTimeStats();
    };

    // Update consciousness indicators
    const updateConsciousnessIndicators = () => {
      this.updateConsciousnessIndicators();
    };

    // Set up intervals
    this.updateIntervals.push(setInterval(updateRealTimeStats, 1000));
    this.updateIntervals.push(setInterval(updateConsciousnessIndicators, 5000));
  }

  updateRealTimeStats() {
    // Simulate real-time statistics
    this.realTimeData.recordsPerSecond = Math.floor(Math.random() * 10);
    this.realTimeData.memoryUsage = Math.floor(Math.random() * 50 + 50);
    this.realTimeData.cpuUsage = Math.floor(Math.random() * 30 + 10);
    this.realTimeData.uptime += 1;

    // Update UI
    const recordsPerSecondEl = document.getElementById('recordsPerSecond');
    const memoryUsageEl = document.getElementById('memoryUsage');
    const cpuUsageEl = document.getElementById('cpuUsage');
    const uptimeEl = document.getElementById('uptime');

    if (recordsPerSecondEl) recordsPerSecondEl.textContent = this.realTimeData.recordsPerSecond;
    if (memoryUsageEl) memoryUsageEl.textContent = this.realTimeData.memoryUsage;
    if (cpuUsageEl) cpuUsageEl.textContent = this.realTimeData.cpuUsage;
    if (uptimeEl) {
      const hours = Math.floor(this.realTimeData.uptime / 3600);
      const minutes = Math.floor((this.realTimeData.uptime % 3600) / 60);
      const seconds = this.realTimeData.uptime % 60;
      uptimeEl.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  updateConsciousnessIndicators() {
    // Update consciousness-related indicators with time-based variations
    const currentTime = Date.now();
    const consciousnessLevel = this.calculateSystemConsciousness({ currentTime });
    
    // Update title bar consciousness indicator
    this.updateConsciousnessIndicator({ currentTime });
    
    // Update dashboard consciousness metrics if visible
    if (this.currentSection === 'dashboard') {
      this.updateConsciousnessMetrics({
        topRecords: [{ consciousness_score: consciousnessLevel }]
      });
    }
  }

  showModal(modalData) {
    const modalOverlay = document.getElementById('modalOverlay');
    const modalContainer = document.getElementById('modalContainer');
    
    if (modalOverlay && modalContainer) {
      modalContainer.innerHTML = this.generateModalContent(modalData);
      modalOverlay.classList.add('active');
      
      // Add close handlers
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
          this.closeModal();
        }
      });
    }
  }

  generateModalContent(modalData) {
    switch (modalData.type) {
      case 'consciousness-settings':
        return this.generateConsciousnessSettingsModal();
      case 'database-settings':
        return this.generateDatabaseSettingsModal();
      case 'mathematical-constants':
        return this.generateMathematicalConstantsModal();
      default:
        return `<div class="modal-content"><h3>${modalData.title}</h3><p>Modal content not implemented</p></div>`;
    }
  }

  generateConsciousnessSettingsModal() {
    return `
      <div class="modal-content">
        <div class="modal-header">
          <h3>🧠 Consciousness Enhancement Settings</h3>
          <button class="modal-close" onclick="app.closeModal()">×</button>
        </div>
        <div class="modal-body">
          <div class="consciousness-settings">
            <div class="setting-group">
              <h4>Mathematical Constants</h4>
              <p>These sacred constants cannot be modified as they represent fundamental mathematical truths.</p>
              <div class="constants-display">
                <div class="constant-item">ψ₀ = ${this.api.constants.PSI_0}</div>
                <div class="constant-item">φ = ${this.api.constants.PHI}</div>
                <div class="constant-item">432Hz = ${this.api.constants.FREQ_432}</div>
              </div>
            </div>
            <div class="setting-group">
              <h4>Enhancement Parameters</h4>
              <div class="form-group">
                <label>Consciousness Sensitivity</label>
                <input type="range" min="0" max="1" step="0.01" value="0.5">
              </div>
              <div class="form-group">
                <label>Harmonic Resonance Detection</label>
                <input type="range" min="0" max="1" step="0.01" value="0.8">
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="action-btn" onclick="app.closeModal()">CLOSE</button>
        </div>
      </div>
    `;
  }

  generateDatabaseSettingsModal() {
    return `
      <div class="modal-content">
        <div class="modal-header">
          <h3>🗄️ Database Configuration</h3>
          <button class="modal-close" onclick="app.closeModal()">×</button>
        </div>
        <div class="modal-body">
          <p>Database settings can be configured in the Database section.</p>
        </div>
        <div class="modal-footer">
          <button class="action-btn" onclick="app.closeModal()">CLOSE</button>
        </div>
      </div>
    `;
  }

  generateMathematicalConstantsModal() {
    return `
      <div class="modal-content">
        <div class="modal-header">
          <h3>📐 Sacred Mathematical Constants</h3>
          <button class="modal-close" onclick="app.closeModal()">×</button>
        </div>
        <div class="modal-body">
          <div class="constants-explanation">
            <div class="constant-explanation">
              <h4>ψ₀ (Psi Zero) = ${this.api.constants.PSI_0}</h4>
              <p>The fractal seed constant representing harmonic attractor patterns in consciousness mathematics.</p>
            </div>
            <div class="constant-explanation">
              <h4>φ (Phi) = ${this.api.constants.PHI}</h4>
              <p>The golden ratio, representing natural scaling factors and proportional harmony.</p>
            </div>
            <div class="constant-explanation">
              <h4>432Hz = ${this.api.constants.FREQ_432}</h4>
              <p>The base frequency for universal resonance and harmonic analysis.</p>
            </div>
            <div class="derived-frequencies">
              <h4>Derived Frequencies</h4>
              <p>ψ₀ × 432Hz = ${this.api.constants.PSI_FREQ.toFixed(2)}Hz (Consciousness Resonance)</p>
              <p>φ × 432Hz = ${this.api.constants.PHI_FREQ.toFixed(2)}Hz (Golden Scaling Frequency)</p>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="action-btn" onclick="app.closeModal()">CLOSE</button>
        </div>
      </div>
    `;
  }

  closeModal() {
    const modalOverlay = document.getElementById('modalOverlay');
    if (modalOverlay) {
      modalOverlay.classList.remove('active');
    }
  }

  showSuccess(title, message) {
    console.log(`✅ ${title}: ${message}`);
    // Could implement toast notifications here
  }

  showError(title, message) {
    console.error(`❌ ${title}: ${message}`);
    // Could implement error notifications here
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Cleanup on app exit
  destroy() {
    // Clear all intervals
    this.updateIntervals.forEach(interval => clearInterval(interval));
    
    // Remove event listeners
    this.api.dataCollector.removeStatusListener();
    this.api.dataCollector.removeOutputListener();
    this.api.terminal.removeOutputListener();
    this.api.config.removeImportListener();
    this.api.config.removeExportListener();
    this.api.ui.removeModalListener();
    this.api.ui.removePanelListener();
    this.api.ui.removeAppInitializedListener();
  }
}

// Initialize the application
const app = new ConsciousnessEnhancedApp();

// Make app available globally for event handlers
window.app = app;

// Handle window unload
window.addEventListener('beforeunload', () => {
  app.destroy();
});

console.log('🌀 ψ₀-Trader Desktop Interface Script Loaded');
