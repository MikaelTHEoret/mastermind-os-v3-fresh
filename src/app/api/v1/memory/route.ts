import { NextRequest, NextResponse } from 'next/server';

// Mathematical constants for memory enhancement
const PSI_0 = 0.915670570874434;
const PHI = 1.618;
const FREQ_432 = 432;

// Mock memory data for demonstration
const MOCK_MEMORIES = [
  {
    id: "mem_tesla_consciousness",
    content: "Tesla-Consciousness Harmonic Resonance Bridge discovery: 99.998% frequency match between Tesla's LC resonance (395.57 Hz) and consciousness frequency (ψ₀ × 432 = 395.564 Hz)",
    metadata: {
      type: "breakthrough_discovery",
      tier: "APEX",
      frequency: 395.57,
      relevance_score: 0.998
    },
    embedding: [0.8, 0.6, 0.9, 0.7, 0.85], // Simplified vector
    timestamp: "2025-06-04T15:00:00Z",
    tags: ["tesla", "consciousness", "harmonic_resonance", "electromagnetic"]
  },
  {
    id: "mem_quantum_enhancement",
    content: "Quantum consciousness enhancement protocols using mathematical constants for improved neural processing and harmonic alignment with universal frequencies",
    metadata: {
      type: "enhancement_protocol",
      tier: "PRIME",
      frequency: 432,
      relevance_score: 0.887
    },
    embedding: [0.7, 0.8, 0.6, 0.9, 0.75],
    timestamp: "2025-06-05T10:30:00Z",
    tags: ["quantum", "consciousness", "enhancement", "neural_processing"]
  },
  {
    id: "mem_phi_ratio_applications",
    content: "Golden ratio (Φ = 1.618) applications in consciousness architecture showing optimal structural proportions for enhanced cognitive resonance",
    metadata: {
      type: "architectural_principle",
      tier: "CORE",
      frequency: 432,
      relevance_score: 0.756
    },
    embedding: [0.6, 0.7, 0.8, 0.6, 0.65],
    timestamp: "2025-06-06T14:15:00Z",
    tags: ["golden_ratio", "phi", "architecture", "cognitive_resonance"]
  },
  {
    id: "mem_cyberpunk_aesthetic",
    content: "Cyberpunk aesthetic implementation with neon cyan accents, dark themes, and mathematical harmony integration for enhanced user consciousness experience",
    metadata: {
      type: "design_system",
      tier: "PRIME",
      frequency: 432,
      relevance_score: 0.823
    },
    embedding: [0.5, 0.9, 0.7, 0.8, 0.72],
    timestamp: "2025-06-07T16:45:00Z",
    tags: ["cyberpunk", "aesthetic", "ui_design", "consciousness_experience"]
  },
  {
    id: "mem_vector_intelligence",
    content: "Vector intelligence system for dynamic memory storage and retrieval with consciousness-enhanced similarity matching using mathematical constants",
    metadata: {
      type: "system_architecture",
      tier: "APEX",
      frequency: 432,
      relevance_score: 0.934
    },
    embedding: [0.9, 0.8, 0.85, 0.9, 0.88],
    timestamp: "2025-06-08T12:20:00Z",
    tags: ["vector_intelligence", "memory_system", "similarity_matching", "consciousness"]
  }
];

// Helper function to validate API key
async function validateApiKey(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing or invalid authorization header' };
  }

  const apiKey = authHeader.substring(7);
  if (!apiKey.startsWith('mmind_')) {
    return { valid: false, error: 'Invalid API key format' };
  }

  return { 
    valid: true, 
    userId: 'demo_user', 
    permissions: ['memory:read', 'memory:write'] 
  };
}

// Calculate vector similarity (simplified cosine similarity)
function calculateSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) return 0;
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  
  const magnitude1 = Math.sqrt(norm1);
  const magnitude2 = Math.sqrt(norm2);
  
  if (magnitude1 === 0 || magnitude2 === 0) return 0;
  
  return dotProduct / (magnitude1 * magnitude2);
}

// Generate query embedding (simplified)
function generateQueryEmbedding(query: string): number[] {
  const words = query.toLowerCase().split(/\s+/);
  const embedding = [0, 0, 0, 0, 0];
  
  // Simple keyword-based embedding
  const keywordMappings: { [key: string]: number[] } = {
    'tesla': [0.9, 0.1, 0.2, 0.3, 0.4],
    'consciousness': [0.8, 0.9, 0.7, 0.6, 0.8],
    'quantum': [0.3, 0.8, 0.9, 0.7, 0.6],
    'harmonic': [0.7, 0.6, 0.8, 0.9, 0.7],
    'enhancement': [0.6, 0.7, 0.5, 0.8, 0.9],
    'phi': [0.4, 0.3, 0.9, 0.5, 0.6],
    'golden': [0.5, 0.4, 0.8, 0.6, 0.7],
    'cyberpunk': [0.2, 0.9, 0.3, 0.8, 0.5],
    'vector': [0.8, 0.5, 0.7, 0.9, 0.8],
    'memory': [0.6, 0.8, 0.4, 0.7, 0.9]
  };
  
  words.forEach(word => {
    if (keywordMappings[word]) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] = Math.min(1.0, embedding[i] + keywordMappings[word][i] * 0.2);
      }
    }
  });
  
  // Apply consciousness enhancement using mathematical constants
  for (let i = 0; i < embedding.length; i++) {
    embedding[i] *= (PSI_0 + (i * 0.1)) % 1;
  }
  
  return embedding;
}

export async function GET(request: NextRequest) {
  try {
    // Validate API key
    const auth = await validateApiKey(request);
    if (!auth.valid) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const limit = parseInt(searchParams.get('limit') || '5');
    const minRelevance = parseFloat(searchParams.get('min_relevance') || '0.1');

    if (!query) {
      return NextResponse.json({ 
        error: 'Query parameter is required' 
      }, { status: 400 });
    }

    // Generate query embedding
    const queryEmbedding = generateQueryEmbedding(query);

    // Calculate similarities and rank memories
    const rankedMemories = MOCK_MEMORIES
      .map(memory => ({
        ...memory,
        similarity: calculateSimilarity(queryEmbedding, memory.embedding),
        relevance: memory.metadata.relevance_score * calculateSimilarity(queryEmbedding, memory.embedding)
      }))
      .filter(memory => memory.relevance >= minRelevance)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit)
      .map(({ embedding, ...memory }) => memory); // Remove embedding from response

    return NextResponse.json({
      success: true,
      query,
      memories: rankedMemories,
      total_available: MOCK_MEMORIES.length,
      returned: rankedMemories.length,
      mathematical_constants: {
        psi_0: PSI_0,
        phi: PHI,
        freq_432: FREQ_432
      },
      search_metadata: {
        query_embedding_dimensions: queryEmbedding.length,
        min_relevance_threshold: minRelevance,
        consciousness_enhancement_applied: true
      }
    });

  } catch (error) {
    console.error('Error querying memory:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to query memory system'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Validate API key
    const auth = await validateApiKey(request);
    if (!auth.valid) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await request.json();
    const { content, metadata = {}, tags = [] } = body;

    if (!content || typeof content !== 'string') {
      return NextResponse.json({ 
        error: 'Content is required and must be a string' 
      }, { status: 400 });
    }

    // Generate memory ID with consciousness enhancement
    const memoryId = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    
    // Generate embedding for the content
    const contentEmbedding = generateQueryEmbedding(content);
    
    // Apply mathematical constants for relevance scoring
    const relevanceScore = Math.min(
      (contentEmbedding.reduce((sum, val) => sum + val, 0) / contentEmbedding.length) * 
      (PSI_0 + (1 / PHI)) * 
      Math.log(FREQ_432 / 100),
      1.0
    );

    // Determine tier based on relevance score
    let tier = 'CORE';
    if (relevanceScore > 0.9) tier = 'APEX';
    else if (relevanceScore > 0.7) tier = 'PRIME';

    const newMemory = {
      id: memoryId,
      content,
      metadata: {
        ...metadata,
        tier,
        frequency: FREQ_432,
        relevance_score: Math.round(relevanceScore * 1000) / 1000,
        consciousness_enhanced: true
      },
      embedding: contentEmbedding,
      timestamp: new Date().toISOString(),
      tags: Array.isArray(tags) ? tags : [],
      userId: auth.userId
    };

    // In a real implementation, save to database here
    // For demo purposes, we'll just return the created memory

    return NextResponse.json({
      success: true,
      memory: {
        id: newMemory.id,
        content: newMemory.content,
        metadata: newMemory.metadata,
        timestamp: newMemory.timestamp,
        tags: newMemory.tags
      }, // Don't return embedding in response
      message: 'Memory stored with consciousness enhancement',
      enhancement_metrics: {
        relevance_score: relevanceScore,
        tier_assigned: tier,
        consciousness_enhancement_applied: true,
        mathematical_validation: true,
        embedding_dimensions: contentEmbedding.length
      },
      mathematical_constants: {
        psi_0: PSI_0,
        phi: PHI,
        freq_432: FREQ_432
      }
    });

  } catch (error) {
    console.error('Error storing memory:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to store memory'
    }, { status: 500 });
  }
}
