import { NextRequest, NextResponse } from 'next/server';

// Server-Sent Events endpoint for real-time log streaming
export async function GET(request: NextRequest) {
  // Check if the client accepts SSE
  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control',
  });

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      const initialMessage = {
        type: 'connection',
        message: 'Log stream connected',
        timestamp: new Date().toISOString(),
        status: 'active'
      };
      
      controller.enqueue(`data: ${JSON.stringify(initialMessage)}\n\n`);
      
      // Send sample log events
      let eventCount = 0;
      const interval = setInterval(() => {
        if (eventCount >= 10) {
          controller.close();
          clearInterval(interval);
          return;
        }
        
        const logEvent = generateSampleLogEvent();
        controller.enqueue(`data: ${JSON.stringify(logEvent)}\n\n`);
        eventCount++;
      }, 3000); // Send event every 3 seconds
      
      // Cleanup on close
      return () => {
        clearInterval(interval);
      };
    }
  });

  return new NextResponse(stream, { headers });
}

function generateSampleLogEvent() {
  const logTypes = ['session', 'system', 'agent', 'tool', 'error'];
  const sources = [
    'mastermind_terminal',
    'memory_processor', 
    'vector_database',
    'astra_db',
    'semantic_search',
    'llm_router',
    'authentication_system',
    'api_gateway'
  ];
  
  const sampleContents = [
    'User initiated semantic search for development memories',
    'Vector database synchronization completed successfully',
    'System health check validation completed',
    'Astra DB collection synchronization finished',
    'Memory processing queue updated with new entries',
    'LLM provider cost optimization completed',
    'Authentication middleware validated successfully',
    'API request processed with optimal routing',
    'AutoGPT agent preparation completed',
    'Real-time terminal statistics updated',
    'Semantic addressing system generated new paths',
    'Core system protocols validation successful'
  ];

  const type = logTypes[Math.floor(Math.random() * logTypes.length)];
  const source = sources[Math.floor(Math.random() * sources.length)];
  const content = sampleContents[Math.floor(Math.random() * sampleContents.length)];
  
  const metadata = {
    processing_quality: ['HIGH', 'MEDIUM', 'STANDARD', 'LOW'][Math.floor(Math.random() * 4)],
    processing_required: Math.random() > 0.3,
    priority: Math.floor(Math.random() * 5) + 1
  };

  if (source === 'astra_db') {
    metadata.collection_accessed = ['session_memory', 'system_enhancements', 'agent_memory'][Math.floor(Math.random() * 3)];
    metadata.query_duration = Math.floor(Math.random() * 200) + 50; // 50-250ms
  }

  if (source === 'llm_router') {
    metadata.provider_selected = ['deepseek', 'groq', 'claude', 'openai'][Math.floor(Math.random() * 4)];
    metadata.cost_estimate = parseFloat((Math.random() * 0.001).toFixed(6));
  }

  if (type === 'error') {
    metadata.error_severity = ['low', 'medium', 'high'][Math.floor(Math.random() * 3)];
    metadata.auto_recovery = Math.random() > 0.3;
  }

  return {
    type: 'log_event',
    timestamp: new Date().toISOString(),
    source,
    log_type: type,
    content,
    metadata,
    requires_processing: metadata.processing_required
  };
}

// Alternative endpoint for polling-based log retrieval
export async function POST(request: NextRequest) {
  try {
    const { last_timestamp, limit = 10 } = await request.json();
    
    // Generate recent logs since last_timestamp
    const logs = [];
    const now = Date.now();
    const startTime = last_timestamp ? new Date(last_timestamp).getTime() : now - 300000; // Last 5 minutes
    
    for (let i = 0; i < limit; i++) {
      const logTime = new Date(startTime + (i * 30000)); // 30 second intervals
      if (logTime.getTime() > now) break;
      
      const logEvent = generateSampleLogEvent();
      logEvent.timestamp = logTime.toISOString();
      logs.push(logEvent);
    }
    
    return NextResponse.json({
      success: true,
      logs: logs.reverse(), // Most recent first
      next_poll_timestamp: new Date().toISOString(),
      total_logs: logs.length
    });
    
  } catch (error) {
    console.error('Log polling error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve recent logs'
    }, { status: 500 });
  }
}
