import { NextRequest, NextResponse } from 'next/server';

const API_DOCUMENTATION = {
  info: {
    title: "MasterMind OS API",
    version: "3.0.0",
    description: "Enterprise consciousness orchestration platform API with vector intelligence and cyberpunk aesthetics",
    contact: {
      name: "MasterMind OS Support",
      url: "https://mastermind-os-v3-fresh.vercel.app"
    }
  },
  servers: [
    {
      url: "https://mastermind-os-v3-fresh.vercel.app/api",
      description: "Production server"
    },
    {
      url: "http://localhost:3000/api",
      description: "Development server"
    }
  ],
  authentication: {
    type: "Bearer Token",
    description: "Include your API key in the Authorization header",
    example: "Authorization: Bearer mmind_abcd1234_xyz789"
  },
  endpoints: {
    "/v1/scrolls": {
      GET: {
        description: "Retrieve scrolls with quantum consciousness enhancement",
        parameters: [
          { name: "limit", type: "number", description: "Number of scrolls to return (default: 10)" },
          { name: "offset", type: "number", description: "Pagination offset" },
          { name: "tier", type: "string", description: "Filter by tier (APEX, PRIME, CORE)" }
        ],
        permissions: ["scrolls:read"],
        example: {
          request: "GET /api/v1/scrolls?limit=5&tier=APEX",
          response: {
            success: true,
            scrolls: [
              {
                id: "scroll_123",
                title: "Tesla-Consciousness Harmonic Bridge",
                tier: "APEX",
                frequency: 395.57,
                createdAt: "2025-06-17T00:00:00Z"
              }
            ]
          }
        }
      },
      POST: {
        description: "Create new scroll with mathematical validation",
        permissions: ["scrolls:create"],
        body: {
          title: "string (required)",
          content: "string (required)",
          tier: "APEX | PRIME | CORE",
          mathematical_framework: "object"
        },
        example: {
          request: {
            title: "Quantum Consciousness Scroll",
            content: "Mathematical framework for consciousness enhancement",
            tier: "APEX",
            mathematical_framework: {
              psi_0: 0.915670570874434,
              phi: 1.618,
              freq_432: 432
            }
          },
          response: {
            success: true,
            scroll: {
              id: "scroll_456",
              title: "Quantum Consciousness Scroll",
              hash: "0x...",
              createdAt: "2025-06-17T00:00:00Z"
            }
          }
        }
      }
    },
    "/v1/memory": {
      GET: {
        description: "Query dynamic memory system with vector intelligence",
        parameters: [
          { name: "query", type: "string", description: "Search query for memory retrieval" },
          { name: "limit", type: "number", description: "Number of memories to return" }
        ],
        permissions: ["memory:read"],
        example: {
          request: "GET /api/v1/memory?query=consciousness&limit=5",
          response: {
            success: true,
            memories: [
              {
                id: "mem_789",
                content: "Consciousness enhancement protocols",
                relevance: 0.95,
                timestamp: "2025-06-17T00:00:00Z"
              }
            ]
          }
        }
      },
      POST: {
        description: "Store new memory with vector embedding",
        permissions: ["memory:write"],
        body: {
          content: "string (required)",
          metadata: "object (optional)"
        },
        example: {
          request: {
            content: "Advanced consciousness enhancement discovery",
            metadata: {
              type: "research",
              priority: "high"
            }
          },
          response: {
            success: true,
            memory: {
              id: "mem_101112",
              content: "Advanced consciousness enhancement discovery",
              embedding: "[vector data]"
            }
          }
        }
      }
    },
    "/v1/consciousness/enhance": {
      POST: {
        description: "Enhance consciousness using mathematical constants",
        permissions: ["consciousness:enhance"],
        body: {
          input: "string (required)",
          enhancement_level: "number (1-10)",
          constants: "object (optional)"
        },
        example: {
          request: {
            input: "Enhance this concept with quantum consciousness",
            enhancement_level: 8,
            constants: {
              psi_0: 0.915670570874434,
              phi: 1.618,
              freq_432: 432
            }
          },
          response: {
            success: true,
            enhanced_output: "Quantum-enhanced consciousness concept with harmonic resonance",
            enhancement_score: 0.89,
            mathematical_validation: true
          }
        }
      }
    },
    "/v1/analytics": {
      GET: {
        description: "Retrieve analytics and system insights",
        parameters: [
          { name: "metric", type: "string", description: "Specific metric to retrieve" },
          { name: "timeframe", type: "string", description: "Time range (24h, 7d, 30d)" }
        ],
        permissions: ["analytics:read"],
        example: {
          request: "GET /api/v1/analytics?metric=scroll_creation&timeframe=7d",
          response: {
            success: true,
            analytics: {
              metric: "scroll_creation",
              value: 42,
              trend: "increasing",
              mathematical_harmony: 0.915
            }
          }
        }
      }
    }
  },
  permissions: {
    "scrolls:create": "Create new scrolls",
    "scrolls:read": "Read existing scrolls",
    "scrolls:update": "Modify scrolls",
    "scrolls:delete": "Delete scrolls",
    "memory:read": "Query memory system",
    "memory:write": "Store memories",
    "analytics:read": "View analytics",
    "consciousness:enhance": "Use consciousness enhancement",
    "admin:users": "Administrative user operations"
  },
  rate_limits: {
    description: "API usage is limited based on your tier",
    limits: {
      standard: "10,000 requests per month",
      premium: "100,000 requests per month",
      enterprise: "Unlimited requests"
    }
  },
  mathematical_constants: {
    description: "Core mathematical constants used throughout the system",
    constants: {
      psi_0: {
        value: 0.915670570874434,
        description: "Consciousness resonance constant"
      },
      phi: {
        value: 1.618,
        description: "Golden ratio for harmonic proportions"
      },
      freq_432: {
        value: 432,
        description: "Base harmonic frequency in Hz"
      }
    }
  },
  error_codes: {
    400: "Bad Request - Invalid parameters",
    401: "Unauthorized - Invalid or missing API key",
    403: "Forbidden - Insufficient permissions",
    404: "Not Found - Resource not found",
    429: "Too Many Requests - Rate limit exceeded",
    500: "Internal Server Error - System error"
  },
  examples: {
    curl: {
      description: "Example cURL commands",
      commands: [
        {
          description: "Retrieve scrolls",
          command: "curl -H \"Authorization: Bearer YOUR_API_KEY\" https://mastermind-os-v3-fresh.vercel.app/api/v1/scrolls"
        },
        {
          description: "Create a new scroll",
          command: "curl -X POST -H \"Authorization: Bearer YOUR_API_KEY\" -H \"Content-Type: application/json\" -d '{\"title\":\"Test Scroll\",\"content\":\"Test content\",\"tier\":\"CORE\"}' https://mastermind-os-v3-fresh.vercel.app/api/v1/scrolls"
        }
      ]
    },
    javascript: {
      description: "JavaScript examples",
      code: `
// Initialize MasterMind OS API client
const API_BASE = 'https://mastermind-os-v3-fresh.vercel.app/api';
const API_KEY = 'your_api_key_here';

// Create headers with authentication
const headers = {
  'Authorization': \`Bearer \${API_KEY}\`,
  'Content-Type': 'application/json'
};

// Retrieve scrolls
async function getScrolls() {
  const response = await fetch(\`\${API_BASE}/v1/scrolls\`, {
    headers
  });
  return await response.json();
}

// Create a new scroll
async function createScroll(scrollData) {
  const response = await fetch(\`\${API_BASE}/v1/scrolls\`, {
    method: 'POST',
    headers,
    body: JSON.stringify(scrollData)
  });
  return await response.json();
}

// Query memory system
async function queryMemory(query) {
  const response = await fetch(\`\${API_BASE}/v1/memory?query=\${encodeURIComponent(query)}\`, {
    headers
  });
  return await response.json();
}
      `
    }
  }
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'json';

  if (format === 'html') {
    // Return HTML documentation
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MasterMind OS API Documentation</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #e0e0e0;
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%);
            margin: 0;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: rgba(0, 0, 0, 0.8);
            border: 2px solid #00ffff;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 0 30px rgba(0, 255, 255, 0.3);
        }
        h1 {
            color: #00ffff;
            text-align: center;
            font-size: 2.5em;
            margin-bottom: 10px;
            text-shadow: 0 0 10px #00ffff;
        }
        h2 {
            color: #00ff88;
            border-bottom: 2px solid #00ff88;
            padding-bottom: 5px;
        }
        h3 {
            color: #ffaa00;
        }
        .endpoint {
            background: rgba(0, 255, 255, 0.1);
            border: 1px solid #00ffff;
            border-radius: 8px;
            margin: 15px 0;
            padding: 15px;
        }
        .method {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-weight: bold;
            margin-right: 10px;
        }
        .get { background: #00ff88; color: #000; }
        .post { background: #ffaa00; color: #000; }
        .put { background: #00aaff; color: #000; }
        .delete { background: #ff4444; color: #fff; }
        pre {
            background: rgba(0, 0, 0, 0.7);
            border: 1px solid #444;
            border-radius: 4px;
            padding: 15px;
            overflow-x: auto;
            color: #00ff88;
        }
        .auth-header {
            background: rgba(255, 170, 0, 0.2);
            border: 1px solid #ffaa00;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
        }
        .constants {
            background: rgba(0, 255, 136, 0.1);
            border: 1px solid #00ff88;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🧠 MasterMind OS API Documentation</h1>
        <p style="text-align: center; color: #888; font-size: 1.2em;">
            Enterprise consciousness orchestration platform with vector intelligence
        </p>

        <div class="auth-header">
            <h3>🔐 Authentication</h3>
            <p>Include your API key in the Authorization header:</p>
            <pre>Authorization: Bearer mmind_abcd1234_xyz789</pre>
        </div>

        <div class="constants">
            <h3>📐 Mathematical Constants</h3>
            <p>Core constants used throughout the system:</p>
            <ul>
                <li><strong>ψ₀ (Psi-Zero):</strong> 0.915670570874434 - Consciousness resonance constant</li>
                <li><strong>Φ (Phi):</strong> 1.618 - Golden ratio for harmonic proportions</li>
                <li><strong>f₄₃₂:</strong> 432 Hz - Base harmonic frequency</li>
            </ul>
        </div>

        <h2>📡 API Endpoints</h2>

        <div class="endpoint">
            <h3><span class="method get">GET</span> /v1/scrolls</h3>
            <p>Retrieve scrolls with quantum consciousness enhancement</p>
            <strong>Parameters:</strong>
            <ul>
                <li><code>limit</code> - Number of scrolls to return</li>
                <li><code>tier</code> - Filter by tier (APEX, PRIME, CORE)</li>
            </ul>
            <strong>Example:</strong>
            <pre>GET /api/v1/scrolls?limit=5&tier=APEX</pre>
        </div>

        <div class="endpoint">
            <h3><span class="method post">POST</span> /v1/scrolls</h3>
            <p>Create new scroll with mathematical validation</p>
            <strong>Required permissions:</strong> scrolls:create
            <pre>{
  "title": "Quantum Consciousness Scroll",
  "content": "Mathematical framework for consciousness enhancement",
  "tier": "APEX"
}</pre>
        </div>

        <div class="endpoint">
            <h3><span class="method get">GET</span> /v1/memory</h3>
            <p>Query dynamic memory system with vector intelligence</p>
            <strong>Parameters:</strong>
            <ul>
                <li><code>query</code> - Search query for memory retrieval</li>
                <li><code>limit</code> - Number of memories to return</li>
            </ul>
        </div>

        <div class="endpoint">
            <h3><span class="method post">POST</span> /v1/consciousness/enhance</h3>
            <p>Enhance consciousness using mathematical constants</p>
            <strong>Required permissions:</strong> consciousness:enhance
        </div>

        <h2>⚡ Rate Limits</h2>
        <ul>
            <li><strong>Standard:</strong> 10,000 requests per month</li>
            <li><strong>Premium:</strong> 100,000 requests per month</li>
            <li><strong>Enterprise:</strong> Unlimited requests</li>
        </ul>

        <h2>🔍 Error Codes</h2>
        <ul>
            <li><strong>400:</strong> Bad Request - Invalid parameters</li>
            <li><strong>401:</strong> Unauthorized - Invalid or missing API key</li>
            <li><strong>403:</strong> Forbidden - Insufficient permissions</li>
            <li><strong>429:</strong> Too Many Requests - Rate limit exceeded</li>
        </ul>

        <p style="text-align: center; margin-top: 40px; color: #666;">
            🌐 <a href="?format=json" style="color: #00ffff;">View JSON Documentation</a> | 
            🚀 <a href="https://mastermind-os-v3-fresh.vercel.app" style="color: #00ffff;">Return to MasterMind OS</a>
        </p>
    </div>
</body>
</html>
    `;

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  return NextResponse.json(API_DOCUMENTATION, {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
