#!/usr/bin/env node

const { exec, spawn } = require('child_process');
const path = require('path');
const os = require('os');

/**
 * MasterMind OS Smart Launcher
 * Automatically kills existing processes and launches fresh development server
 */

const platform = os.platform();
const projectDir = path.resolve(__dirname, '..');

console.log(`🧠 MasterMind OS Smart Launcher`);
console.log(`📍 Project Directory: ${projectDir}`);
console.log(`🖥️  Platform: ${platform}`);
console.log(`⚡ Starting clean launch sequence...`);

class ProcessManager {
  constructor() {
    this.isWindows = platform === 'win32';
    this.killTimeout = 5000; // 5 seconds timeout for killing processes
  }

  async killPort(port) {
    console.log(`🔥 Killing processes on port ${port}...`);
    
    return new Promise((resolve) => {
      if (this.isWindows) {
        exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
          if (error) {
            console.log(`ℹ️  No processes found on port ${port}`);
            resolve();
            return;
          }

          const pids = this.extractPidsFromNetstat(stdout);
          this.killProcesses(pids).then(() => {
            console.log(`✅ Port ${port} cleaned`);
            resolve();
          });
        });
      } else {
        exec(`lsof -ti:${port}`, (error, stdout) => {
          if (error) {
            console.log(`ℹ️  No processes found on port ${port}`);
            resolve();
            return;
          }

          const pids = stdout.trim().split('\n').filter(pid => pid);
          this.killProcesses(pids).then(() => {
            console.log(`✅ Port ${port} cleaned`);
            resolve();
          });
        });
      }
    });
  }

  extractPidsFromNetstat(stdout) {
    const lines = stdout.trim().split('\n');
    const pids = new Set();
    
    lines.forEach(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5) {
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && !isNaN(parseInt(pid))) {
          pids.add(pid);
        }
      }
    });
    
    return Array.from(pids);
  }

  async killProcesses(pids) {
    if (pids.length === 0) return;

    const killPromises = pids.map(pid => this.killSingleProcess(pid));
    await Promise.all(killPromises);
  }

  killSingleProcess(pid) {
    return new Promise((resolve) => {
      const command = this.isWindows ? `taskkill /f /pid ${pid}` : `kill -9 ${pid}`;
      
      exec(command, (error) => {
        if (error) {
          console.log(`⚠️  Could not kill process ${pid}`);
        } else {
          console.log(`🗡️  Killed process ${pid}`);
        }
        resolve();
      });
    });
  }

  async killDevelopmentProcesses() {
    console.log(`🧹 Cleaning development processes...`);
    
    return new Promise((resolve) => {
      const patterns = [
        'next.*dev',
        'next.*start',
        'node.*mastermind',
        'webpack-dev-server'
      ];

      let command;
      
      if (this.isWindows) {
        // Windows: Find Node processes that match our patterns
        command = `wmic process where "name='node.exe'" get commandline,processid /format:csv`;
      } else {
        command = `ps aux | grep -E "${patterns.join('|')}" | grep -v grep | awk '{print $2}'`;
      }

      exec(command, (error, stdout) => {
        if (error) {
          console.log(`ℹ️  No development processes found`);
          resolve();
          return;
        }

        if (this.isWindows) {
          this.parseWindowsProcesses(stdout, patterns).then(resolve);
        } else {
          const pids = stdout.trim().split('\n').filter(pid => pid);
          this.killProcesses(pids).then(() => {
            console.log(`✅ Development processes cleaned`);
            resolve();
          });
        }
      });
    });
  }

  async parseWindowsProcesses(stdout, patterns) {
    const lines = stdout.split('\n');
    const pidsToKill = [];

    lines.forEach(line => {
      const parts = line.split(',');
      if (parts.length >= 3) {
        const commandLine = parts[1] || '';
        const pid = parts[2] || '';
        
        const matchesPattern = patterns.some(pattern => {
          const regex = new RegExp(pattern, 'i');
          return regex.test(commandLine);
        });

        if (matchesPattern && pid && !isNaN(parseInt(pid))) {
          pidsToKill.push(pid.trim());
        }
      }
    });

    if (pidsToKill.length > 0) {
      await this.killProcesses(pidsToKill);
      console.log(`✅ Development processes cleaned`);
    } else {
      console.log(`ℹ️  No development processes found`);
    }
  }

  async launchDevelopmentServer() {
    console.log(`🚀 Launching MasterMind OS development server...`);
    
    return new Promise((resolve, reject) => {
      const npmCmd = this.isWindows ? 'npm.cmd' : 'npm';
      
      const devProcess = spawn(npmCmd, ['run', 'dev'], {
        cwd: projectDir,
        stdio: 'inherit',
        shell: this.isWindows
      });

      // Give the process a moment to start
      setTimeout(() => {
        if (devProcess.pid) {
          console.log(`✅ Development server launched (PID: ${devProcess.pid})`);
          console.log(`🌐 Available at: http://localhost:3000`);
          console.log(`🎯 Press Ctrl+C to stop the server`);
          resolve(devProcess);
        } else {
          reject(new Error('Failed to start development server'));
        }
      }, 2000);

      devProcess.on('error', (error) => {
        console.error(`❌ Failed to start development server: ${error.message}`);
        reject(error);
      });

      devProcess.on('exit', (code) => {
        if (code !== 0) {
          console.log(`⚠️  Development server exited with code ${code}`);
        }
      });
    });
  }
}

async function main() {
  const manager = new ProcessManager();
  
  try {
    // Step 1: Clean existing processes
    await manager.killDevelopmentProcesses();
    
    // Step 2: Clean common ports
    await manager.killPort(3000);
    await manager.killPort(3001);
    
    // Step 3: Wait a moment for cleanup
    console.log(`⏳ Waiting for cleanup to complete...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 4: Launch development server
    await manager.launchDevelopmentServer();
    
  } catch (error) {
    console.error(`❌ Launch failed: ${error.message}`);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n🛑 Shutting down MasterMind OS launcher...`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`\n🛑 Terminating MasterMind OS launcher...`);
  process.exit(0);
});

main();
