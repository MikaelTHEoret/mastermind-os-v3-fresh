#!/usr/bin/env node

const { exec, spawn } = require('child_process');
const os = require('os');

/**
 * Kill processes running on a specific port
 * Usage: node kill-port.js [port]
 * Default port: 3000
 */

const port = process.argv[2] || 3000;
const platform = os.platform();

console.log(`🔥 Killing processes on port ${port}...`);

function killPort(port) {
  return new Promise((resolve, reject) => {
    let command;
    
    if (platform === 'win32') {
      // Windows command to find and kill process on port
      command = `for /f "tokens=5" %a in ('netstat -aon ^| find ":${port}"') do taskkill /f /pid %a`;
      
      // Alternative approach for Windows
      exec(`netstat -ano | findstr :${port}`, (error, stdout, stderr) => {
        if (error) {
          console.log(`ℹ️  No processes found on port ${port}`);
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
          console.log(`ℹ️  No processes found on port ${port}`);
          resolve();
          return;
        }
        
        const killPromises = Array.from(pids).map(pid => {
          return new Promise((pidResolve) => {
            exec(`taskkill /f /pid ${pid}`, (killError, killStdout, killStderr) => {
              if (killError) {
                console.log(`⚠️  Could not kill process ${pid}: ${killError.message}`);
              } else {
                console.log(`✅ Killed process ${pid} on port ${port}`);
              }
              pidResolve();
            });
          });
        });
        
        Promise.all(killPromises).then(() => {
          console.log(`🎯 Port ${port} cleanup completed`);
          resolve();
        });
      });
      
    } else {
      // Unix/Linux/macOS command
      command = `lsof -ti:${port} | xargs kill -9`;
      
      exec(`lsof -ti:${port}`, (error, stdout, stderr) => {
        if (error) {
          console.log(`ℹ️  No processes found on port ${port}`);
          resolve();
          return;
        }
        
        const pids = stdout.trim().split('\n').filter(pid => pid);
        
        if (pids.length === 0) {
          console.log(`ℹ️  No processes found on port ${port}`);
          resolve();
          return;
        }
        
        exec(`kill -9 ${pids.join(' ')}`, (killError, killStdout, killStderr) => {
          if (killError) {
            console.log(`⚠️  Error killing processes: ${killError.message}`);
            reject(killError);
          } else {
            console.log(`✅ Killed ${pids.length} process(es) on port ${port}`);
            console.log(`🎯 Port ${port} cleanup completed`);
            resolve();
          }
        });
      });
    }
  });
}

// Additional function to kill common Node.js processes
function killNodeProcesses() {
  return new Promise((resolve) => {
    let command;
    
    if (platform === 'win32') {
      command = 'taskkill /f /im "node.exe" /t';
    } else {
      command = 'pkill -f "next.*dev\\|next.*start"';
    }
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.log(`ℹ️  No additional Node.js processes to kill`);
      } else {
        console.log(`🧹 Cleaned up additional Node.js processes`);
      }
      resolve();
    });
  });
}

// Main execution
async function main() {
  try {
    await killPort(port);
    
    // Optional: Kill any lingering Node.js development processes
    if (process.argv.includes('--clean')) {
      await killNodeProcesses();
    }
    
    console.log(`🚀 Port ${port} is now available for use`);
    process.exit(0);
  } catch (error) {
    console.error(`❌ Error during port cleanup: ${error.message}`);
    process.exit(1);
  }
}

main();
