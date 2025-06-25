# 🔗 Mastermind MCP Server Setup
## Claude Desktop Integration Guide

### **What is MCP?**
Model Context Protocol (MCP) allows Claude Desktop to directly access Mastermind OS Terminal Hub functionality, providing seamless integration between Claude and your development workflow.

### **Available Tools**
- `mastermind_execute` - Execute natural language commands in Universal LLM Terminal
- `mastermind_create_agent` - Create and deploy AutoGPT agents
- `mastermind_search_memory` - Search across all memory collections
- `mastermind_get_status` - Get system status and analytics
- `mastermind_manage_agent` - Manage existing agents

### **Setup Instructions**

#### **1. Install MCP Server Dependencies**
```bash
cd scripts
npm install
```

#### **2. Configure Claude Desktop**
Copy the MCP configuration to your Claude Desktop settings:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mastermind-terminal": {
      "command": "node",
      "args": ["./scripts/mastermind-mcp-server.js"],
      "env": {
        "MASTERMIND_API_BASE": "https://mastermind-os-v3-fresh.vercel.app/api",
        "MASTERMIND_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

#### **3. Test the Connection**
1. Restart Claude Desktop
2. Start a new conversation
3. Try: "Use mastermind_get_status to check the system"

### **Usage Examples**

#### **Execute Development Commands**
```
Use mastermind_execute to "create a new React component for user authentication"
```

#### **Create AutoGPT Agent**
```
Use mastermind_create_agent to create an agent named "Auth Developer" with objective "Implement JWT authentication system using Clerk" with tools ["serena", "github", "universal_llm"]
```

#### **Search Project Memory**
```
Use mastermind_search_memory to find "authentication development progress"
```

#### **Get System Status**
```
Use mastermind_get_status with focus_area "agents" to see agent status
```

### **Troubleshooting**

#### **Connection Issues**
- Check that Node.js is installed
- Verify the script path in Claude Desktop config
- Ensure the Mastermind API is accessible

#### **Authentication Issues**
- Update `MASTERMIND_API_KEY` in the configuration
- Check that the API endpoint is correct

#### **Tool Errors**
- Verify Mastermind OS is deployed and running
- Check system status with `mastermind_get_status`

### **Development**
To modify the MCP server:
1. Edit `scripts/mastermind-mcp-server.js`
2. Restart Claude Desktop to reload changes
3. Test with the available tools

### **Security Notes**
- API keys are stored in Claude Desktop's secure configuration
- All communication goes through the deployed Mastermind API
- No local file system access beyond the project directory
