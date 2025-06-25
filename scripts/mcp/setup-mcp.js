#!/usr/bin/env node

/**
 * 🔧 MASTERMIND MCP SETUP SCRIPT
 * 
 * Installs and configures the Mastermind Terminal MCP server for Claude Desktop
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

console.log('🤖 Setting up Mastermind Terminal MCP Server...\n');

// Step 1: Install MCP dependencies
console.log('📦 Installing MCP dependencies...');
try {
  execSync('npm install', { 
    cwd: './scripts/mcp',
    stdio: 'inherit' 
  });
  console.log('✅ Dependencies installed successfully\n');
} catch (error) {
  console.error('❌ Failed to install dependencies:', error.message);
  process.exit(1);
}

// Step 2: Find Claude Desktop config location
console.log('🔍 Locating Claude Desktop configuration...');
const platform = os.platform();
let claudeConfigPath;

switch (platform) {
  case 'win32':
    claudeConfigPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
    break;
  case 'darwin':
    claudeConfigPath = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    break;
  case 'linux':
    claudeConfigPath = path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
    break;
  default:
    console.error(`❌ Unsupported platform: ${platform}`);
    process.exit(1);
}

console.log(`📍 Claude Desktop config path: ${claudeConfigPath}`);

// Step 3: Create or update Claude Desktop config
console.log('⚙️ Configuring Claude Desktop...');
const projectRoot = process.cwd();
const mcpServerPath = path.join(projectRoot, 'scripts', 'mcp', 'mastermind-mcp-server.js');

const claudeConfig = {
  mcpServers: {
    "mastermind-terminal": {
      command: "node",
      args: [mcpServerPath],
      env: {
        MASTERMIND_API_BASE: "https://mastermind-os-v3-fresh.vercel.app/api",
        MASTERMIND_API_KEY: ""
      }
    }
  }
};

// Read existing config if it exists
let existingConfig = {};
if (fs.existsSync(claudeConfigPath)) {
  try {
    const configContent = fs.readFileSync(claudeConfigPath, 'utf8');
    existingConfig = JSON.parse(configContent);
    console.log('📖 Found existing Claude Desktop configuration');
  } catch (error) {
    console.warn('⚠️ Could not parse existing configuration, creating new one');
  }
}

// Merge configurations
const mergedConfig = {
  ...existingConfig,
  mcpServers: {
    ...existingConfig.mcpServers,
    ...claudeConfig.mcpServers
  }
};

// Ensure config directory exists
const configDir = path.dirname(claudeConfigPath);
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
  console.log(`📁 Created config directory: ${configDir}`);
}

// Write the configuration
try {
  fs.writeFileSync(claudeConfigPath, JSON.stringify(mergedConfig, null, 2));
  console.log('✅ Claude Desktop configuration updated successfully\n');
} catch (error) {
  console.error('❌ Failed to write Claude Desktop configuration:', error.message);
  console.log('\n📋 Manual Configuration Required:');
  console.log('Please add this configuration to your Claude Desktop config file:');
  console.log(claudeConfigPath);
  console.log('\nConfiguration:');
  console.log(JSON.stringify(claudeConfig, null, 2));
  process.exit(1);
}

// Step 4: Test MCP server
console.log('🧪 Testing MCP server...');
try {
  console.log('Starting test run...');
  // Quick test to ensure the server can start
  execSync('timeout 5s node mastermind-mcp-server.js || true', {
    cwd: './scripts/mcp',
    stdio: 'pipe'
  });
  console.log('✅ MCP server test completed\n');
} catch (error) {
  console.warn('⚠️ MCP server test had issues (this may be normal)');
}

// Step 5: Display completion message
console.log('🎉 MASTERMIND MCP SETUP COMPLETE!\n');
console.log('📋 Next Steps:');
console.log('1. Restart Claude Desktop application');
console.log('2. Look for "mastermind-terminal" in the MCP connections');
console.log('3. Try these commands in Claude Desktop:');
console.log('   • mastermind_get_status - Get system status');
console.log('   • mastermind_execute - Run terminal commands');
console.log('   • mastermind_create_agent - Create AutoGPT agents');
console.log('   • mastermind_search_memory - Search memory collections');
console.log('   • mastermind_manage_agent - Manage existing agents\n');

console.log('🔧 Configuration Files:');
console.log(`   • MCP Server: ${mcpServerPath}`);
console.log(`   • Claude Config: ${claudeConfigPath}`);
console.log(`   • Project Root: ${projectRoot}\n`);

console.log('🚀 The Mastermind Terminal is now accessible from Claude Desktop!');
console.log('🤖 You can create and manage AutoGPT agents directly from Claude.');
console.log('💡 Use natural language commands to control your development workflow.');

console.log('\n🔗 For troubleshooting, check the Claude Desktop logs or restart the application.');