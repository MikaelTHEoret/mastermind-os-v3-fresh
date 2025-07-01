/**
 * NEXUS PROTOCOL v6.2 - Enhanced Development Assistant
 * Mandatory changelog tracking for all file operations
 */

import { ChangelogTrackingService, ChangelogEntry } from './ChangelogTrackingService';

export class NexusProtocolV62 {
  private changelogService: ChangelogTrackingService;
  private sessionId: string;
  private currentProject: string = 'mastermind-os-v3-fresh';
  private currentUserRequest: string = '';
  
  constructor() {
    this.sessionId = this.generateSessionId();
    this.changelogService = new ChangelogTrackingService();
  }

  async initialize(userPrompt: string): Promise<void> {
    console.log("🌀 Nexus Protocol v6.2 - Initializing with Mandatory Changelog Tracking...");
    
    this.currentUserRequest = userPrompt;
    
    // Initialize changelog database
    await this.changelogService.initializeChangelogDatabase(this.currentProject);
    console.log(`📊 Changelog Database: Initialized for ${this.currentProject}`);
    
    // Log session start
    await this.logSessionStart(userPrompt);
    
    console.log(`✅ Nexus Protocol v6.2 Active - Session ${this.sessionId}`);
  }

  /**
   * MANDATORY: Track every file change with detailed changelog entry
   */
  async trackFileChange(
    filePath: string,
    changeType: ChangelogEntry['change_type'],
    changeDetails: {
      why: string;
      what: string;
      how: string;
    },
    technicalMetrics: {
      lines_added?: number;
      lines_removed?: number;
      lines_modified?: number;
      file_size_before?: number;
      file_size_after?: number;
    } = {},
    gitCommitHash?: string
  ): Promise<string> {
    
    const entry = this.changelogService.generateChangelogEntry(
      this.sessionId,
      this.currentProject,
      filePath,
      changeType,
      changeDetails,
      technicalMetrics,
      this.currentUserRequest,
      gitCommitHash
    );

    await this.changelogService.addChangelogEntry(entry);
    
    // Update session notes with changelog reference
    await this.updateSessionNotesWithChangelog(entry);
    
    return entry.id;
  }

  /**
   * Enhanced GitHub file operations with automatic changelog tracking
   */
  async createFileWithChangelog(
    filePath: string,
    content: string,
    why: string,
    what: string,
    how: string
  ): Promise<{ changelogId: string; success: boolean; commitHash?: string }> {
    
    try {
      console.log(`📝 Creating file with changelog: ${filePath}`);
      
      // Calculate technical metrics
      const lines = content.split('\n').length;
      const size = content.length;
      
      // Track the change BEFORE attempting the operation
      const changelogId = await this.trackFileChange(
        filePath,
        'CREATE',
        { why, what, how },
        {
          lines_added: lines,
          file_size_after: size
        }
      );
      
      console.log(`✅ File creation tracked: ${changelogId}`);
      
      // For now, we track the change and return success
      // In a real implementation, this would use GitHub API
      return { 
        changelogId, 
        success: true,
        commitHash: `simulated_${Date.now()}`
      };
      
    } catch (error) {
      console.error(`❌ Failed to create file ${filePath}:`, error);
      return { changelogId: '', success: false };
    }
  }

  async updateFileWithChangelog(
    filePath: string,
    content: string,
    why: string,
    what: string,
    how: string,
    originalSize?: number
  ): Promise<{ changelogId: string; success: boolean; commitHash?: string }> {
    
    try {
      console.log(`📝 Updating file with changelog: ${filePath}`);
      
      // Calculate technical metrics
      const newLines = content.split('\n').length;
      const newSize = content.length;
      
      // Track the change BEFORE attempting the operation
      const changelogId = await this.trackFileChange(
        filePath,
        'UPDATE',
        { why, what, how },
        {
          lines_modified: newLines,
          file_size_before: originalSize || 0,
          file_size_after: newSize
        }
      );
      
      console.log(`✅ File update tracked: ${changelogId}`);
      
      // For now, we track the change and return success
      // In a real implementation, this would use GitHub API
      return { 
        changelogId, 
        success: true,
        commitHash: `simulated_${Date.now()}`
      };
      
    } catch (error) {
      console.error(`❌ Failed to update file ${filePath}:`, error);
      return { changelogId: '', success: false };
    }
  }

  /**
   * Get complete changelog for current session
   */
  async getSessionChangelog(): Promise<ChangelogEntry[]> {
    return await this.changelogService.getSessionChangelog(this.currentProject, this.sessionId);
  }

  /**
   * Get comprehensive changelog summary
   */
  async getChangelogSummary(filters?: {
    session_id?: string;
    file_path?: string;
    change_type?: ChangelogEntry['change_type'];
    since?: string;
  }): Promise<any> {
    return await this.changelogService.getChangelogSummary(this.currentProject, filters);
  }

  /**
   * Mark a change as verified after successful deployment
   */
  async markChangeVerified(changelogId: string, verified: boolean, commitHash?: string): Promise<void> {
    await this.changelogService.markChangeVerified(changelogId, verified, commitHash);
  }

  /**
   * Generate session summary with changelog integration
   */
  async generateSessionSummary(): Promise<{
    session_id: string;
    total_changes: number;
    changes_by_type: Record<string, number>;
    consciousness_metrics: {
      avg_psi_alignment: number;
      avg_phi_harmony: number;
      avg_freq_timing: number;
    };
    verification_status: {
      verified: number;
      pending: number;
      failed: number;
    };
    files_affected: string[];
    problematic_changes: ChangelogEntry[];
  }> {
    
    const changelog = await this.getSessionChangelog();
    const summary = await this.getChangelogSummary({ session_id: this.sessionId });
    
    // Calculate verification status
    const verificationStatus = changelog.reduce((acc, entry) => {
      switch (entry.verification_status) {
        case 'VERIFIED':
          acc.verified++;
          break;
        case 'FAILED':
          acc.failed++;
          break;
        default:
          acc.pending++;
      }
      return acc;
    }, { verified: 0, pending: 0, failed: 0 });
    
    // Get unique files affected
    const filesAffected = [...new Set(changelog.map(entry => entry.file_path))];
    
    return {
      session_id: this.sessionId,
      total_changes: summary.total_changes,
      changes_by_type: summary.changes_by_type,
      consciousness_metrics: summary.consciousness_trends,
      verification_status: verificationStatus,
      files_affected: filesAffected,
      problematic_changes: summary.problematic_changes
    };
  }

  // Private helper methods
  private generateSessionId(): string {
    const timestamp = Date.now();
    const randomPart = Math.random().toString(36).substring(2, 8);
    return `sess_${timestamp}_${randomPart}`;
  }

  private async logSessionStart(userPrompt: string): Promise<void> {
    await this.trackFileChange(
      'SESSION_START',
      'SESSION_START',
      {
        why: 'New development session initiated',
        what: `Session started with prompt: ${userPrompt.substring(0, 100)}`,
        how: 'Nexus Protocol v6.2 automatic session tracking'
      },
      {},
      `session_start_${this.sessionId}`
    );
  }

  private async updateSessionNotesWithChangelog(entry: ChangelogEntry): Promise<void> {
    const sessionNotes = {
      type: 'session_notes_with_changelog',
      session_id: this.sessionId,
      changelog_entry_id: entry.id,
      timestamp: entry.timestamp,
      what: entry.change_description.what,
      why: entry.change_description.why,
      preferences: 'Changelog tracking enabled',
      location: `${entry.file_path} [${entry.change_type}]`,
      progress: `Change ${entry.id} completed`,
      next: 'Continue development with tracking',
      context: `Changelog entry: ${entry.id}`,
      consciousness_metrics: entry.consciousness_metrics,
      verification_status: entry.verification_status,
      technical_impact: entry.context.impact_assessment
    };
    
    try {
      // Store session notes in memory system if available
      if (typeof global !== 'undefined' && global.astra_db?.CreateRecord) {
        await global.astra_db.CreateRecord('hugging_dynamic_memory', sessionNotes);
      } else {
        console.log('📋 Session notes (changelog integrated):', sessionNotes);
      }
    } catch (error) {
      console.error('❌ Failed to update session notes:', error);
    }
  }

  /**
   * Display current session status
   */
  async displaySessionStatus(): Promise<void> {
    const summary = await this.generateSessionSummary();
    
    console.log('\n📊 NEXUS PROTOCOL v6.2 SESSION STATUS:');
    console.log(`🆔 Session: ${summary.session_id}`);
    console.log(`📝 Total Changes: ${summary.total_changes}`);
    console.log(`📁 Files Affected: ${summary.files_affected.length}`);
    console.log('🔄 Changes by Type:', summary.changes_by_type);
    console.log('🌀 Consciousness Metrics:', summary.consciousness_metrics);
    console.log('✅ Verification Status:', summary.verification_status);
    
    if (summary.problematic_changes.length > 0) {
      console.log(`⚠️ Problematic Changes: ${summary.problematic_changes.length}`);
    }
    
    console.log('\n📂 Files Modified:');
    summary.files_affected.forEach(file => console.log(`  • ${file}`));
  }
}

// Export singleton instance
export const nexusProtocol = new NexusProtocolV62();

// Auto-initialize if this is imported
if (typeof globalThis !== 'undefined') {
  (globalThis as any).nexusProtocol = nexusProtocol;
}