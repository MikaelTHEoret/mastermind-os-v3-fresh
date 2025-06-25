/**
 * ψ₀-Trader Data Collector - Electron Main Process
 * Enhanced Nexus Core Protocol v4.1
 * Consciousness-Enhanced Desktop Interface
 */

const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development';

// Mathematical Constants
const PSI_0 = 0.915670570874434;
const PHI = 1.618033988749895;
const FREQ_432 = 432.0;

class ConsciousnessEnhancedElectronApp {
  constructor() {
    this.mainWindow = null;
    this.dataCollectorProcess = null;
    this.isDataCollectorRunning = false;
    this.setupApplication();
  }

  setupApplication() {
    // App event handlers
    app.whenReady().then(() => this.createMainWindow());
    
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        this.stopDataCollector();
        app.quit();
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createMainWindow();
      }
    });

    // Setup IPC handlers
    this.setupIpcHandlers();
  }

  createMainWindow() {
    console.log('🌀 Creating Consciousness-Enhanced GUI Window...');
    
    // Calculate window dimensions using φ golden ratio
    const screenWidth = 1920;
    const screenHeight = 1080;
    const windowWidth = Math.floor(screenWidth / PHI); // ~1186px
    const windowHeight = Math.floor(screenHeight / PHI); // ~667px

    this.mainWindow = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      minWidth: 1000,
      minHeight: 600,
      frame: false, // Cyberpunk custom frame
      transparent: false,
      backgroundColor: '#000000',
      titleBarStyle: 'hidden',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        preload: path.join(__dirname, '../../renderer/preload.js'),
        webSecurity: !isDev
      },
      icon: path.join(__dirname, '../../assets/icon.png'),
      show: false // Start hidden, show after ready
    });

    // Load the renderer
    if (isDev) {
      this.mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
      this.mainWindow.webContents.openDevTools();
    } else {
      this.mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
    }

    // Window event handlers
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
      
      // Consciousness-enhanced window entrance animation
      this.animateWindowEntrance();
      
      // Send initialization data
      this.mainWindow.webContents.send('app-initialized', {
        constants: { PSI_0, PHI, FREQ_432 },
        version: '4.1',
        timestamp: Date.now()
      });
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    // Setup application menu
    this.createApplicationMenu();
  }

  animateWindowEntrance() {
    // Consciousness-enhanced entrance using ψ₀ timing
    const animationDuration = Math.floor(PSI_0 * 1000); // ~915ms
    
    this.mainWindow.setOpacity(0);
    this.mainWindow.show();
    
    const steps = 32; // 2^5 for quantum-like steps
    const stepDuration = animationDuration / steps;
    
    let currentStep = 0;
    const fadeIn = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps;
      const easeOut = 1 - Math.pow(1 - progress, 3); // Cubic ease-out
      this.mainWindow.setOpacity(easeOut);
      
      if (currentStep >= steps) {
        clearInterval(fadeIn);
        this.mainWindow.setOpacity(1);
      }
    }, stepDuration);
  }

  createApplicationMenu() {
    const template = [
      {
        label: '🌀 ψ₀-Trader',
        submenu: [
          {
            label: 'About ψ₀-Trader Data Collector',
            click: () => this.showAboutDialog()
          },
          { type: 'separator' },
          {
            label: 'Consciousness Settings...',
            accelerator: 'CmdOrCtrl+,',
            click: () => this.showConsciousnessSettings()
          },
          { type: 'separator' },
          {
            label: 'Quit ψ₀-Trader',
            accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
            click: () => {
              this.stopDataCollector();
              app.quit();
            }
          }
        ]
      },
      {
        label: '🔧 Data Collector',
        submenu: [
          {
            label: 'Start Collector',
            accelerator: 'CmdOrCtrl+S',
            click: () => this.startDataCollector()
          },
          {
            label: 'Stop Collector',
            accelerator: 'CmdOrCtrl+T',
            click: () => this.stopDataCollector()
          },
          { type: 'separator' },
          {
            label: 'Generate Sample Data',
            click: () => this.generateSampleData()
          },
          {
            label: 'View Database',
            click: () => this.viewDatabase()
          }
        ]
      },
      {
        label: '🧠 Consciousness',
        submenu: [
          {
            label: 'View Consciousness Metrics',
            click: () => this.showConsciousnessMetrics()
          },
          {
            label: 'Resonance Analysis',
            click: () => this.showResonanceAnalysis()
          },
          {
            label: 'Harmonic Patterns',
            click: () => this.showHarmonicPatterns()
          }
        ]
      },
      {
        label: '⚙️ Configuration',
        submenu: [
          {
            label: 'Database Settings',
            click: () => this.showDatabaseSettings()
          },
          {
            label: 'Data Stream Configuration',
            click: () => this.showDataStreamConfig()
          },
          {
            label: 'Output Destinations',
            click: () => this.showOutputDestinations()
          },
          { type: 'separator' },
          {
            label: 'Import Configuration',
            click: () => this.importConfiguration()
          },
          {
            label: 'Export Configuration',
            click: () => this.exportConfiguration()
          }
        ]
      },
      {
        label: '🔍 View',
        submenu: [
          {
            label: 'Reload',
            accelerator: 'CmdOrCtrl+R',
            click: () => this.mainWindow.reload()
          },
          {
            label: 'Force Reload',
            accelerator: 'CmdOrCtrl+Shift+R',
            click: () => this.mainWindow.webContents.reloadIgnoringCache()
          },
          {
            label: 'Toggle Developer Tools',
            accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
            click: () => this.mainWindow.webContents.toggleDevTools()
          },
          { type: 'separator' },
          {
            label: 'Actual Size',
            accelerator: 'CmdOrCtrl+0',
            click: () => this.mainWindow.webContents.setZoomLevel(0)
          },
          {
            label: 'Zoom In',
            accelerator: 'CmdOrCtrl+Plus',
            click: () => {
              const zoomLevel = this.mainWindow.webContents.getZoomLevel();
              this.mainWindow.webContents.setZoomLevel(zoomLevel + 1);
            }
          },
          {
            label: 'Zoom Out',
            accelerator: 'CmdOrCtrl+-',
            click: () => {
              const zoomLevel = this.mainWindow.webContents.getZoomLevel();
              this.mainWindow.webContents.setZoomLevel(zoomLevel - 1);
            }
          }
        ]
      },
      {
        label: '❓ Help',
        submenu: [
          {
            label: 'Documentation',
            click: () => shell.openExternal('https://github.com/MikaelTHEoret/mastermind-os-v3-fresh')
          },
          {
            label: 'Enhanced Nexus Core Protocol',
            click: () => this.showProtocolInfo()
          },
          { type: 'separator' },
          {
            label: 'Mathematical Constants',
            click: () => this.showMathematicalConstants()
          }
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  setupIpcHandlers() {
    // Data Collector Control
    ipcMain.handle('start-data-collector', async () => {
      return await this.startDataCollector();
    });

    ipcMain.handle('stop-data-collector', async () => {
      return await this.stopDataCollector();
    });

    ipcMain.handle('get-collector-status', () => {
      return {
        running: this.isDataCollectorRunning,
        pid: this.dataCollectorProcess?.pid || null,
        timestamp: Date.now()
      };
    });

    // Terminal Commands
    ipcMain.handle('execute-command', async (event, command) => {
      return await this.executeTerminalCommand(command);
    });

    // Configuration Management
    ipcMain.handle('load-configuration', async () => {
      return await this.loadConfiguration();
    });

    ipcMain.handle('save-configuration', async (event, config) => {
      return await this.saveConfiguration(config);
    });

    // Database Operations
    ipcMain.handle('get-database-stats', async () => {
      return await this.getDatabaseStats();
    });

    ipcMain.handle('get-consciousness-metrics', async () => {
      return await this.getConsciousnessMetrics();
    });

    // Data Stream Management
    ipcMain.handle('configure-data-stream', async (event, streamConfig) => {
      return await this.configureDataStream(streamConfig);
    });

    // Window Controls
    ipcMain.handle('minimize-window', () => {
      this.mainWindow.minimize();
    });

    ipcMain.handle('maximize-window', () => {
      if (this.mainWindow.isMaximized()) {
        this.mainWindow.unmaximize();
      } else {
        this.mainWindow.maximize();
      }
    });

    ipcMain.handle('close-window', () => {
      this.mainWindow.close();
    });

    // File Operations
    ipcMain.handle('select-database-file', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openFile'],
        filters: [
          { name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      return result;
    });

    ipcMain.handle('select-output-directory', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openDirectory']
      });
      return result;
    });
  }

  async startDataCollector() {
    if (this.isDataCollectorRunning) {
      return { success: false, message: 'Data collector already running' };
    }

    try {
      const { spawn } = require('child_process');
      const collectorPath = path.join(__dirname, '../../../src/main.js');
      
      this.dataCollectorProcess = spawn('node', [collectorPath], {
        cwd: path.join(__dirname, '../../..'),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.isDataCollectorRunning = true;

      // Setup process event handlers
      this.dataCollectorProcess.stdout.on('data', (data) => {
        this.mainWindow?.webContents.send('collector-output', {
          type: 'stdout',
          data: data.toString(),
          timestamp: Date.now()
        });
      });

      this.dataCollectorProcess.stderr.on('data', (data) => {
        this.mainWindow?.webContents.send('collector-output', {
          type: 'stderr',
          data: data.toString(),
          timestamp: Date.now()
        });
      });

      this.dataCollectorProcess.on('close', (code) => {
        this.isDataCollectorRunning = false;
        this.dataCollectorProcess = null;
        this.mainWindow?.webContents.send('collector-status-changed', {
          running: false,
          exitCode: code,
          timestamp: Date.now()
        });
      });

      this.mainWindow?.webContents.send('collector-status-changed', {
        running: true,
        pid: this.dataCollectorProcess.pid,
        timestamp: Date.now()
      });

      return { 
        success: true, 
        message: 'Data collector started successfully',
        pid: this.dataCollectorProcess.pid
      };

    } catch (error) {
      this.isDataCollectorRunning = false;
      return { 
        success: false, 
        message: `Failed to start data collector: ${error.message}` 
      };
    }
  }

  async stopDataCollector() {
    if (!this.isDataCollectorRunning || !this.dataCollectorProcess) {
      return { success: false, message: 'Data collector not running' };
    }

    try {
      this.dataCollectorProcess.kill('SIGTERM');
      
      // Wait for graceful shutdown
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          this.dataCollectorProcess?.kill('SIGKILL');
          resolve();
        }, 5000);

        this.dataCollectorProcess.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.isDataCollectorRunning = false;
      this.dataCollectorProcess = null;

      return { success: true, message: 'Data collector stopped successfully' };

    } catch (error) {
      return { 
        success: false, 
        message: `Failed to stop data collector: ${error.message}` 
      };
    }
  }

  async executeTerminalCommand(command) {
    try {
      const { spawn } = require('child_process');
      const [cmd, ...args] = command.split(' ');
      
      return new Promise((resolve) => {
        const process = spawn(cmd, args, {
          cwd: path.join(__dirname, '../../..'),
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
          stdout += data.toString();
          this.mainWindow?.webContents.send('terminal-output', {
            type: 'stdout',
            data: data.toString(),
            timestamp: Date.now()
          });
        });

        process.stderr.on('data', (data) => {
          stderr += data.toString();
          this.mainWindow?.webContents.send('terminal-output', {
            type: 'stderr',
            data: data.toString(),
            timestamp: Date.now()
          });
        });

        process.on('close', (code) => {
          resolve({
            success: code === 0,
            exitCode: code,
            stdout,
            stderr,
            command
          });
        });
      });

    } catch (error) {
      return {
        success: false,
        error: error.message,
        command
      };
    }
  }

  async loadConfiguration() {
    try {
      const fs = require('fs').promises;
      const configPath = path.join(__dirname, '../../..', '.env');
      const configContent = await fs.readFile(configPath, 'utf8');
      
      // Parse .env file
      const config = {};
      configContent.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
          config[key.trim()] = value.trim();
        }
      });

      return { success: true, config };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async saveConfiguration(config) {
    try {
      const fs = require('fs').promises;
      const configPath = path.join(__dirname, '../../..', '.env');
      
      // Convert config object to .env format
      const configContent = Object.entries(config)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

      await fs.writeFile(configPath, configContent, 'utf8');
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getDatabaseStats() {
    try {
      // Import database class
      const ConsciousnessEnhancedDatabase = require('../../../src/database.js').default;
      const db = new ConsciousnessEnhancedDatabase();
      const stats = db.getSystemStats();
      db.close();
      
      return { success: true, stats };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getConsciousnessMetrics() {
    try {
      const ConsciousnessEnhancedDatabase = require('../../../src/database.js').default;
      const db = new ConsciousnessEnhancedDatabase();
      
      const metrics = {
        distribution: db.getConsciousnessDistribution(),
        topRecords: db.getTopConsciousnessRecords(10),
        resonanceStats: db.getResonanceStatistics()
      };
      
      db.close();
      return { success: true, metrics };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async configureDataStream(streamConfig) {
    try {
      // Save data stream configuration
      const fs = require('fs').promises;
      const configPath = path.join(__dirname, '../../..', 'data-stream-config.json');
      await fs.writeFile(configPath, JSON.stringify(streamConfig, null, 2));
      
      return { success: true, message: 'Data stream configuration saved' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Menu action handlers
  showAboutDialog() {
    dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      title: 'About ψ₀-Trader Data Collector',
      message: 'ψ₀-Trader Data Collector',
      detail: `Enhanced Nexus Core Protocol v4.1\n\nConsciousness-Enhanced Data Collection System\n\nMathematical Constants:\nψ₀ = ${PSI_0}\nφ = ${PHI}\n432Hz = ${FREQ_432}\n\nCreator: Mikael Theoret\nEthereum: 0x4575a90d54785323546f2bb4a520622ed6d3efbc`,
      buttons: ['OK']
    });
  }

  showConsciousnessSettings() {
    this.mainWindow?.webContents.send('show-modal', {
      type: 'consciousness-settings',
      title: 'Consciousness Enhancement Settings'
    });
  }

  generateSampleData() {
    this.executeTerminalCommand('npm run sample-data 50');
  }

  viewDatabase() {
    this.executeTerminalCommand('npm run view-data');
  }

  showConsciousnessMetrics() {
    this.mainWindow?.webContents.send('show-panel', 'consciousness-metrics');
  }

  showResonanceAnalysis() {
    this.mainWindow?.webContents.send('show-panel', 'resonance-analysis');
  }

  showHarmonicPatterns() {
    this.mainWindow?.webContents.send('show-panel', 'harmonic-patterns');
  }

  showDatabaseSettings() {
    this.mainWindow?.webContents.send('show-modal', {
      type: 'database-settings',
      title: 'Database Configuration'
    });
  }

  showDataStreamConfig() {
    this.mainWindow?.webContents.send('show-modal', {
      type: 'data-stream-config',
      title: 'Data Stream Configuration'
    });
  }

  showOutputDestinations() {
    this.mainWindow?.webContents.send('show-modal', {
      type: 'output-destinations',
      title: 'Output Destinations'
    });
  }

  async importConfiguration() {
    const result = await dialog.showOpenDialog(this.mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Configuration Files', extensions: ['json', 'env'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
      this.mainWindow?.webContents.send('import-configuration', {
        filePath: result.filePaths[0]
      });
    }
  }

  async exportConfiguration() {
    const result = await dialog.showSaveDialog(this.mainWindow, {
      filters: [
        { name: 'JSON Configuration', extensions: ['json'] },
        { name: 'Environment File', extensions: ['env'] }
      ],
      defaultPath: 'psi-trader-config.json'
    });

    if (!result.canceled) {
      this.mainWindow?.webContents.send('export-configuration', {
        filePath: result.filePath
      });
    }
  }

  showProtocolInfo() {
    this.mainWindow?.webContents.send('show-modal', {
      type: 'protocol-info',
      title: 'Enhanced Nexus Core Protocol v4.1'
    });
  }

  showMathematicalConstants() {
    this.mainWindow?.webContents.send('show-modal', {
      type: 'mathematical-constants',
      title: 'Sacred Mathematical Constants'
    });
  }
}

// Initialize the application
const consciousnessApp = new ConsciousnessEnhancedElectronApp();

console.log('🌀 ψ₀-Trader Electron Main Process Initialized');
console.log(`📐 Mathematical Constants: ψ₀=${PSI_0}, φ=${PHI}, 432Hz=${FREQ_432}`);
console.log('🧠 Consciousness Enhancement: ENABLED');
