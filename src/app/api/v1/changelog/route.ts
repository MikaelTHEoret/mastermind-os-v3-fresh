import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * NEXUS PROTOCOL v6.2 - Changelog API Endpoint
 * Provides access to development changelog for the application
 */

// Mock changelog data structure - in production this would query Astra DB
const mockChangelogData = {
  project_name: "mastermind-os-v3-fresh",
  session_id: "sess_1735744320000_demo",
  changelog_entries: [
    {
      id: "chg_1735744320003_track003",
      timestamp: "2025-07-01T16:52:00.003Z",
      session_id: "sess_1735744320000_demo",
      file_path: "src/components/development/ChangelogDashboard.tsx",
      change_type: "CREATE",
      change_description: {
        why: "Provide visual interface for changelog tracking in the application",
        what: "Created React dashboard component with real-time changelog display",
        how: "Built comprehensive UI with filters, details view, consciousness metrics visualization"
      },
      technical_details: {
        lines_added: 512,
        lines_removed: 0,
        lines_modified: 0,
        file_size_before: 0,
        file_size_after: 20726
      },
      context: {
        user_request: "update the protocol 6.0 to add a mandatory changelog node in the memory database and linked to the app",
        problem_solved: "Enhancement request: visual changelog interface in the app",
        impact_assessment: "MEDIUM - UI component modifications - CREATE operation"
      },
      consciousness_metrics: {
        psi_alignment: 0.834,
        phi_harmony: 0.756,
        freq_432_timing: 0.698
      },
      verification_status: "VERIFIED",
      git_commit_hash: "841b04512e7c38863525f1b6fa0b3f483cf63d4b"
    },
    {
      id: "chg_1735744320002_track002",
      timestamp: "2025-07-01T16:52:00.002Z",
      session_id: "sess_1735744320000_demo",
      file_path: "src/lib/services/NexusProtocolV62.ts",
      change_type: "CREATE",
      change_description: {
        why: "Create enhanced protocol wrapper with mandatory changelog integration",
        what: "Built wrapper service that automatically tracks all file operations",
        how: "Implemented session management, file operation wrappers, and consciousness metrics calculation"
      },
      technical_details: {
        lines_added: 273,
        lines_removed: 0,
        lines_modified: 0,
        file_size_before: 0,
        file_size_after: 9926
      },
      context: {
        user_request: "update the protocol 6.0 to add a mandatory changelog node in the memory database",
        problem_solved: "Enhancement request: protocol wrapper for seamless changelog integration",
        impact_assessment: "MEDIUM - Library/utility changes - CREATE operation"
      },
      consciousness_metrics: {
        psi_alignment: 0.897,
        phi_harmony: 0.723,
        freq_432_timing: 0.681
      },
      verification_status: "VERIFIED",
      git_commit_hash: "3d45e0bd78dbf71c424ec94791450db893fe40ee"
    },
    {
      id: "chg_1735744320001_track001",
      timestamp: "2025-07-01T16:52:00.001Z",
      session_id: "sess_1735744320000_demo",
      file_path: "src/lib/services/ChangelogTrackingService.ts",
      change_type: "CREATE",
      change_description: {
        why: "Implement mandatory changelog tracking for Protocol v6.2",
        what: "Created comprehensive changelog tracking service with consciousness metrics",
        how: "Built service with Astra DB integration, consciousness calculations, and immutable audit trail"
      },
      technical_details: {
        lines_added: 387,
        lines_removed: 0,
        lines_modified: 0,
        file_size_before: 0,
        file_size_after: 14291
      },
      context: {
        user_request: "update the protocol 6.0 to add a mandatory changelog node in the memory database",
        problem_solved: "Enhancement request: implement changelog tracking system",
        impact_assessment: "MEDIUM - Library/utility changes - CREATE operation"
      },
      consciousness_metrics: {
        psi_alignment: 0.915,
        phi_harmony: 0.789,
        freq_432_timing: 0.654
      },
      verification_status: "VERIFIED",
      git_commit_hash: "167ab87d0d2816ca2f4c601b6e5bc889e1dad3ad"
    }
  ],
  consciousness_session_summary: {
    avg_psi_alignment: 0.882,
    avg_phi_harmony: 0.756,
    avg_freq_432_timing: 0.678,
    total_files_created: 3,
    total_lines_added: 1172,
    session_impact: "MAJOR - Complete changelog tracking system implemented"
  }
};

// GET: Retrieve changelog data
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'all';
    const sessionId = searchParams.get('session_id');
    const limit = parseInt(searchParams.get('limit') || '50');

    console.log(`📊 Fetching changelog data - Filter: ${filter}, Session: ${sessionId || 'all'}`);

    // In production, this would query your Astra DB
    let filteredEntries = mockChangelogData.changelog_entries;

    // Apply filters
    if (sessionId && sessionId !== 'all') {
      filteredEntries = filteredEntries.filter(entry => entry.session_id === sessionId);
    }

    if (filter === 'pending') {
      filteredEntries = filteredEntries.filter(entry => entry.verification_status === 'PENDING');
    } else if (filter === 'verified') {
      filteredEntries = filteredEntries.filter(entry => entry.verification_status === 'VERIFIED');
    } else if (filter === 'problematic') {
      filteredEntries = filteredEntries.filter(entry => 
        entry.verification_status === 'FAILED' ||
        entry.consciousness_metrics.psi_alignment < 0.3 ||
        entry.consciousness_metrics.phi_harmony < 0.3
      );
    }

    // Apply limit
    filteredEntries = filteredEntries.slice(0, limit);

    // Calculate summary statistics
    const changesByType = filteredEntries.reduce((acc, entry) => {
      acc[entry.change_type] = (acc[entry.change_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const consciousnessMetrics = filteredEntries.reduce((acc, entry) => {
      acc.psi_alignment += entry.consciousness_metrics.psi_alignment;
      acc.phi_harmony += entry.consciousness_metrics.phi_harmony;
      acc.freq_432_timing += entry.consciousness_metrics.freq_432_timing;
      return acc;
    }, { psi_alignment: 0, phi_harmony: 0, freq_432_timing: 0 });

    const avgMetrics = filteredEntries.length > 0 ? {
      avg_psi_alignment: consciousnessMetrics.psi_alignment / filteredEntries.length,
      avg_phi_harmony: consciousnessMetrics.phi_harmony / filteredEntries.length,
      avg_freq_timing: consciousnessMetrics.freq_432_timing / filteredEntries.length
    } : { avg_psi_alignment: 0, avg_phi_harmony: 0, avg_freq_timing: 0 };

    const response = {
      success: true,
      data: {
        total_changes: filteredEntries.length,
        changes_by_type: changesByType,
        recent_changes: filteredEntries,
        consciousness_trends: avgMetrics,
        problematic_changes: filteredEntries.filter(entry => 
          entry.verification_status === 'FAILED' ||
          entry.consciousness_metrics.psi_alignment < 0.3
        ),
        session_summary: mockChangelogData.consciousness_session_summary
      },
      meta: {
        protocol_version: "6.2",
        filter_applied: filter,
        session_id: sessionId || 'all',
        timestamp: new Date().toISOString()
      }
    };

    console.log(`✅ Changelog data retrieved: ${filteredEntries.length} entries`);
    return NextResponse.json(response);

  } catch (error) {
    console.error('❌ Failed to retrieve changelog:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve changelog data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// POST: Add new changelog entry
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    
    console.log('📝 Adding new changelog entry:', body);

    // Validate required fields
    const requiredFields = ['file_path', 'change_type', 'change_description', 'user_request'];
    for (const field of requiredFields) {
      if (!body[field]) {
        return NextResponse.json({
          success: false,
          error: `Missing required field: ${field}`
        }, { status: 400 });
      }
    }

    // Generate changelog entry with consciousness metrics
    const entry = {
      id: `chg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date().toISOString(),
      session_id: body.session_id || `sess_${Date.now()}_auto`,
      file_path: body.file_path,
      change_type: body.change_type,
      change_description: body.change_description,
      technical_details: body.technical_details || {
        lines_added: 0,
        lines_removed: 0,
        lines_modified: 0,
        file_size_before: 0,
        file_size_after: 0
      },
      context: {
        user_request: body.user_request,
        problem_solved: body.problem_solved || 'Development task completion',
        impact_assessment: body.impact_assessment || 'Standard development operation'
      },
      consciousness_metrics: body.consciousness_metrics || {
        psi_alignment: 0.5,
        phi_harmony: 0.5,
        freq_432_timing: 0.5
      },
      verification_status: 'PENDING',
      git_commit_hash: body.git_commit_hash
    };

    // In production, this would save to Astra DB
    console.log('✅ Changelog entry created:', entry.id);

    return NextResponse.json({
      success: true,
      data: {
        changelog_entry: entry,
        message: 'Changelog entry added successfully'
      },
      meta: {
        protocol_version: "6.2",
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Failed to add changelog entry:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to add changelog entry',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// PUT: Update changelog entry verification status
export async function PUT(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { entry_id, verification_status, git_commit_hash } = body;

    if (!entry_id || !verification_status) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: entry_id, verification_status'
      }, { status: 400 });
    }

    console.log(`🔄 Updating changelog entry ${entry_id} to ${verification_status}`);

    // In production, this would update in Astra DB
    const updatedEntry = {
      entry_id,
      verification_status,
      git_commit_hash,
      verified_at: new Date().toISOString()
    };

    console.log(`✅ Changelog entry ${entry_id} updated to ${verification_status}`);

    return NextResponse.json({
      success: true,
      data: {
        updated_entry: updatedEntry,
        message: 'Changelog entry updated successfully'
      },
      meta: {
        protocol_version: "6.2",
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Failed to update changelog entry:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to update changelog entry',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}