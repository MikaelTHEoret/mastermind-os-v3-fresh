#!/usr/bin/env node

const { exec } = require('child_process');
const os = require('os');

/**
 * Kill all processes related to the MasterMind OS application
 * This includes Node.js, Next.js, and any development servers
 */

const platform = os.platform();

console.log(`🔥 Killing all MasterMind OS related processes...`);

const processesToKill = [
  'next',
  'node',
  'npm',
  'yarn',
  'pnpm'
];

const portsToClean = [3000, 3001, 4000, 5000, 8000, 8080];

function killProcessesByName(processName) {
  return new Promise((resolve) => {
    let command;
    
    if (platform === 'win32') {
      command = `taskkill /f /im "${processName}.exe" /t`;
    } else {
      command = `pkill -f "${processName}"`;
    }
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.log(`ℹ️  No ${processName} processes found`);
      } else {
        console.log(`✅ Killed ${processName} processes`);
      }
      resolve();
    });
  });
}

function killPort(port) {
  return new Promise((resolve) => {
    let command;
    
    if (platform === 'win32') {
      exec(`netstat -ano | findstr :${port}`, (error, stdout, stderr) => {
        if (error) {
          resolve();
          return;
        }
        
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
        
        if (pids.size === 0) {
          resolve();
          return;
        }
        
        const killPromises = Array.from(pids).map(pid => {
          return new Promise((pidResolve) => {
            exec(`taskkill /f /pid ${pid}`, () => pidResolve());
          });
        });
        
        Promise.all(killPromises).then(() => {
          console.log(`✅ Cleaned port ${port}`);
          resolve();
        });
      });
    } else {
      exec(`lsof -ti:${port}`, (error, stdout, stderr) => {
        if (error) {
          resolve();
          return;
        }
        
        const pids = stdout.trim().split('\n').filter(pid => pid);
        
        if (pids.length === 0) {
          resolve();
          return;
        }
        
        exec(`kill -9 ${pids.join(' ')}`, () => {
          console.log(`✅ Cleaned port ${port}`);
          resolve();
        });
      });
    }
  });
}

function killDevelopmentProcesses() {
  return new Promise((resolve) => {
    const patterns = [
      'next.*dev',
      'next.*start',
      'mastermind',
      'webpack',
      'nodemon'
    ];
    
    let command;
    
    if (platform === 'win32') {
      // For Windows, we'll use a more targeted approach
      const commands = patterns.map(pattern => 
        `for /f "tokens=2" %i in ('tasklist /fi "imagename eq node.exe" /fo csv ^| findstr "${pattern}"') do taskkill /f /pid %i`
      );
      
      command = commands.join(' & ');
    } else {
      command = `pkill -f "${patterns.join('\\|')}"`;
    }
    
    exec(command, (error, stdout, stderr) => {
      if (!error) {
        console.log(`🧹 Cleaned development server processes`);
      }
      resolve();
    });
  });
}

async function main() {
  console.log(`🎯 Platform: ${platform}`);
  
  try {
    // Kill development processes first
    await killDevelopmentProcesses();
    
    // Clean common development ports
    console.log(`🔌 Cleaning development ports...`);
    await Promise.all(portsToClean.map(port => killPort(port)));
    
    // Kill processes by name (more aggressive)
    if (process.argv.includes('--aggressive')) {
      console.log(`⚔️  Aggressive mode: Killing all Node.js processes...`);
      await Promise.all(processesToKill.map(proc => killProcessesByName(proc)));
    }
    
    console.log(`🎉 All MasterMind OS processes have been terminated`);
    console.log(`🚀 Ready for fresh launch!`);
    
    process.exit(0);
  } catch (error) {
    console.error(`❌ Error during cleanup: ${error.message}`);
    process.exit(1);
  }
}

main();
