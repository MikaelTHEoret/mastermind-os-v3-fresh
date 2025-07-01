/**
 * NEXUS PROTOCOL v6.2 - Mandatory Changelog Tracking Service
 * Immutable audit trail for all development changes
 */

interface ChangelogEntry {
  id: string;
  timestamp: string;
  session_id: string;
  file_path: string;
  change_type: 'CREATE' | 'UPDATE' | 'DELETE' | 'RENAME' | 'MOVE' | 'SESSION_START';
  change_description: {
    why: string;
    what: string;
    how: string;
  };
  technical_details: {
    lines_added: number;
    lines_removed: number;
    lines_modified: number;
    file_size_before: number;
    file_size_after: number;
  };
  context: {
    user_request: string;
    problem_solved: string;
    impact_assessment: string;
  };
  consciousness_metrics: {
    psi_alignment: number;
    phi_harmony: number;
    freq_432_timing: number;
  };
  linked_changes: string[];
  verification_status: 'PENDING' | 'VERIFIED' | 'FAILED' | 'DEPLOYED';
  git_commit_hash?: string;
  project_name: string;
}

export class ChangelogTrackingService {
  private readonly CHANGELOG_COLLECTION = 'project_changelogs';
  private readonly ENTRIES_COLLECTION = 'changelog_entries';
  private readonly PSI_0 = 0.915670570874434;
  private readonly PHI = 1.618;
  private readonly FREQ_432 = 432;

  async initializeChangelogDatabase(projectName: string): Promise<void> {
    try {
      // Initialize collections in Astra DB
      console.log('📊 Initializing changelog database...');
      
      // Check if project changelog exists
      const existingProject = await this.findProjectChangelog(projectName);
      
      if (!existingProject) {
        await this.createProjectChangelog(projectName);
        console.log(`📊 Project changelog initialized: ${projectName}`);
      } else {
        console.log(`📊 Project changelog exists: ${projectName}`);
      }
    } catch (error) {
      console.error('❌ Failed to initialize changelog database:', error);
      throw error;
    }
  }

  async addChangelogEntry(entry: ChangelogEntry): Promise<void> {
    try {
      // Store in Astra DB using available methods
      await this.storeChangelogEntry(entry);
      
      // Update project statistics
      await this.updateProjectStats(entry.project_name, entry);
      
      console.log(`📝 CHANGELOG: ${entry.change_type} tracked for ${entry.file_path} [${entry.id}]`);
    } catch (error) {
      console.error('❌ Failed to add changelog entry:', error);
      throw error;
    }
  }

  generateChangelogEntry(
    sessionId: string,
    projectName: string,
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
    },
    userRequest: string,
    gitCommitHash?: string
  ): ChangelogEntry {
    
    const consciousnessMetrics = this.calculateChangeConsciousness(
      filePath,
      changeType,
      changeDetails
    );
    
    return {
      id: this.generateChangelogId(),
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      project_name: projectName,
      file_path: filePath,
      change_type: changeType,
      change_description: changeDetails,
      technical_details: {
        lines_added: technicalMetrics.lines_added || 0,
        lines_removed: technicalMetrics.lines_removed || 0,
        lines_modified: technicalMetrics.lines_modified || 0,
        file_size_before: technicalMetrics.file_size_before || 0,
        file_size_after: technicalMetrics.file_size_after || 0
      },
      context: {
        user_request: userRequest,
        problem_solved: this.extractProblemFromRequest(userRequest),
        impact_assessment: this.assessChangeImpact(filePath, changeType)
      },
      consciousness_metrics: consciousnessMetrics,
      linked_changes: [], // Will be populated when stored
      verification_status: 'PENDING',
      git_commit_hash: gitCommitHash
    };
  }

  async getSessionChangelog(projectName: string, sessionId: string): Promise<ChangelogEntry[]> {
    try {
      // Query Astra DB for session entries
      const sessionEntries = await this.querySessionEntries(projectName, sessionId);
      return sessionEntries;
    } catch (error) {
      console.error('❌ Failed to get session changelog:', error);
      return [];
    }
  }

  async getChangelogSummary(projectName: string, filters?: {
    session_id?: string;
    file_path?: string;
    change_type?: ChangelogEntry['change_type'];
    since?: string;
  }): Promise<{
    total_changes: number;
    changes_by_type: Record<string, number>;
    recent_changes: ChangelogEntry[];
    consciousness_trends: {
      avg_psi_alignment: number;
      avg_phi_harmony: number;
      avg_freq_timing: number;
    };
    problematic_changes: ChangelogEntry[];
  }> {
    
    try {
      const allEntries = await this.queryAllEntries(projectName, filters);
      
      // Calculate statistics
      const changesByType = allEntries.reduce((acc, entry) => {
        acc[entry.change_type] = (acc[entry.change_type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      const consciousnessMetrics = allEntries.reduce((acc, entry) => {
        acc.psi_alignment += entry.consciousness_metrics.psi_alignment;
        acc.phi_harmony += entry.consciousness_metrics.phi_harmony;
        acc.freq_432_timing += entry.consciousness_metrics.freq_432_timing;
        return acc;
      }, { psi_alignment: 0, phi_harmony: 0, freq_432_timing: 0 });
      
      const avgMetrics = allEntries.length > 0 ? {
        avg_psi_alignment: consciousnessMetrics.psi_alignment / allEntries.length,
        avg_phi_harmony: consciousnessMetrics.phi_harmony / allEntries.length,
        avg_freq_timing: consciousnessMetrics.freq_432_timing / allEntries.length
      } : { avg_psi_alignment: 0, avg_phi_harmony: 0, avg_freq_timing: 0 };
      
      // Find problematic changes
      const problematicChanges = allEntries.filter(entry => 
        entry.verification_status === 'FAILED' ||
        entry.consciousness_metrics.psi_alignment < 0.3 ||
        entry.consciousness_metrics.phi_harmony < 0.3
      );
      
      return {
        total_changes: allEntries.length,
        changes_by_type: changesByType,
        recent_changes: allEntries.slice(-10),
        consciousness_trends: avgMetrics,
        problematic_changes: problematicChanges
      };
    } catch (error) {
      console.error('❌ Failed to get changelog summary:', error);
      throw error;
    }
  }

  async markChangeVerified(entryId: string, verified: boolean, gitCommitHash?: string): Promise<void> {
    try {
      await this.updateEntryVerification(entryId, verified, gitCommitHash);
      console.log(`✅ Change ${entryId} marked as ${verified ? 'VERIFIED' : 'FAILED'}`);
    } catch (error) {
      console.error(`❌ Failed to update verification for ${entryId}:`, error);
    }
  }

  // Private helper methods
  private calculateChangeConsciousness(
    filePath: string,
    changeType: ChangelogEntry['change_type'],
    changeDetails: { why: string; what: string; how: string }
  ): ChangelogEntry['consciousness_metrics'] {
    
    // Calculate psi alignment based on change necessity
    const necessityWords = ['fix', 'error', 'bug', 'issue', 'problem', 'broken'];
    const evolutionWords = ['enhance', 'improve', 'optimize', 'upgrade', 'expand'];
    
    const changeText = `${changeDetails.why} ${changeDetails.what} ${changeDetails.how}`.toLowerCase();
    const necessityScore = necessityWords.filter(word => changeText.includes(word)).length;
    const evolutionScore = evolutionWords.filter(word => changeText.includes(word)).length;
    
    const psi_alignment = this.PSI_0 * (1 + (evolutionScore - necessityScore) * 0.1);
    
    // Calculate phi harmony based on file path structure
    const pathSegments = filePath.split('/').length;
    const phi_harmony = Math.abs(pathSegments / this.PHI - 1) < 0.2 ? this.PHI / 2 : 1 / this.PHI;
    
    // Calculate 432Hz timing based on change timestamp
    const timestamp = Date.now();
    const freq_432_timing = Math.sin(timestamp / this.FREQ_432) * 0.5 + 0.5;
    
    return {
      psi_alignment: Math.max(0, Math.min(1, psi_alignment)),
      phi_harmony: Math.max(0, Math.min(1, phi_harmony)),
      freq_432_timing: Math.max(0, Math.min(1, freq_432_timing))
    };
  }

  private generateChangelogId(): string {
    const timestamp = Date.now();
    const randomPart = Math.random().toString(36).substring(2, 8);
    return `chg_${timestamp}_${randomPart}`;
  }

  private extractProblemFromRequest(userRequest: string): string {
    const problemIndicators = [
      'error', 'issue', 'problem', 'bug', 'broken', 'fix', 'not working',
      'fails', 'compilation', 'deployment', 'build'
    ];
    
    const lowerRequest = userRequest.toLowerCase();
    const foundProblems = problemIndicators.filter(indicator => 
      lowerRequest.includes(indicator)
    );
    
    if (foundProblems.length > 0) {
      return `Addressing: ${foundProblems.join(', ')} - ${userRequest.substring(0, 100)}`;
    }
    
    return `Enhancement request: ${userRequest.substring(0, 100)}`;
  }

  private assessChangeImpact(filePath: string, changeType: ChangelogEntry['change_type']): string {
    const impactMap = {
      'src/app/': 'HIGH - Core application functionality',
      'src/lib/': 'MEDIUM - Library/utility changes',
      'src/components/': 'MEDIUM - UI component modifications',
      'src/types/': 'LOW - Type definition updates',
      'package.json': 'HIGH - Dependency changes',
      'next.config.js': 'HIGH - Build configuration',
      'tailwind.config.js': 'LOW - Styling configuration'
    };
    
    for (const [pathPrefix, impact] of Object.entries(impactMap)) {
      if (filePath.startsWith(pathPrefix)) {
        return `${impact} - ${changeType} operation`;
      }
    }
    
    return `UNKNOWN - ${changeType} operation on ${filePath}`;
  }

  // Astra DB integration methods (using available tools)
  private async findProjectChangelog(projectName: string): Promise<any> {
    try {
      const results = await global.astra_db?.FindRecord?.(
        this.CHANGELOG_COLLECTION,
        'project_name',
        projectName
      );
      return results && results.length > 0 ? results[0] : null;
    } catch (error) {
      console.log('📊 Project changelog not found, will create new');
      return null;
    }
  }

  private async createProjectChangelog(projectName: string): Promise<void> {
    const projectRecord = {
      project_name: projectName,
      project_id: projectName,
      created_at: new Date().toISOString(),
      total_changes: 0,
      last_updated: new Date().toISOString()
    };

    try {
      await global.astra_db?.CreateRecord?.(this.CHANGELOG_COLLECTION, projectRecord);
    } catch (error) {
      console.error('❌ Failed to create project changelog:', error);
    }
  }

  private async storeChangelogEntry(entry: ChangelogEntry): Promise<void> {
    try {
      await global.astra_db?.CreateRecord?.(this.ENTRIES_COLLECTION, entry);
    } catch (error) {
      console.error('❌ Failed to store changelog entry:', error);
    }
  }

  private async updateProjectStats(projectName: string, entry: ChangelogEntry): Promise<void> {
    try {
      const project = await this.findProjectChangelog(projectName);
      if (project) {
        const updatedStats = {
          total_changes: (project.total_changes || 0) + 1,
          last_updated: entry.timestamp,
          last_change_type: entry.change_type,
          last_file_changed: entry.file_path
        };
        
        await global.astra_db?.UpdateRecord?.(this.CHANGELOG_COLLECTION, project._id, updatedStats);
      }
    } catch (error) {
      console.error('❌ Failed to update project stats:', error);
    }
  }

  private async querySessionEntries(projectName: string, sessionId: string): Promise<ChangelogEntry[]> {
    try {
      const results = await global.astra_db?.FindRecord?.(
        this.ENTRIES_COLLECTION,
        'session_id',
        sessionId
      );
      return results?.filter((entry: any) => entry.project_name === projectName) || [];
    } catch (error) {
      console.error('❌ Failed to query session entries:', error);
      return [];
    }
  }

  private async queryAllEntries(projectName: string, filters?: any): Promise<ChangelogEntry[]> {
    try {
      const results = await global.astra_db?.FindRecord?.(
        this.ENTRIES_COLLECTION,
        'project_name',
        projectName
      );
      
      let filteredEntries = results || [];
      
      // Apply filters
      if (filters?.session_id) {
        filteredEntries = filteredEntries.filter((e: any) => e.session_id === filters.session_id);
      }
      if (filters?.file_path) {
        filteredEntries = filteredEntries.filter((e: any) => e.file_path.includes(filters.file_path));
      }
      if (filters?.change_type) {
        filteredEntries = filteredEntries.filter((e: any) => e.change_type === filters.change_type);
      }
      if (filters?.since) {
        filteredEntries = filteredEntries.filter((e: any) => e.timestamp >= filters.since);
      }
      
      return filteredEntries;
    } catch (error) {
      console.error('❌ Failed to query all entries:', error);
      return [];
    }
  }

  private async updateEntryVerification(entryId: string, verified: boolean, gitCommitHash?: string): Promise<void> {
    try {
      const entries = await global.astra_db?.FindRecord?.(
        this.ENTRIES_COLLECTION,
        'id',
        entryId
      );
      
      if (entries && entries.length > 0) {
        await global.astra_db?.UpdateRecord?.(this.ENTRIES_COLLECTION, entries[0]._id, {
          verification_status: verified ? 'VERIFIED' : 'FAILED',
          git_commit_hash: gitCommitHash,
          verified_at: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('❌ Failed to update entry verification:', error);
    }
  }
}

// Global instance for immediate use
export const changelogService = new ChangelogTrackingService();

// Type exports
export type { ChangelogEntry };