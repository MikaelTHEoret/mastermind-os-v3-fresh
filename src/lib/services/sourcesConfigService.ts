import { createClient } from '@neondatabase/serverless';
import crypto from 'crypto';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

interface ConfiguredSource {
  id: string;
  type: string;
  name: string;
  secrets: { [key: string]: string };
  status: 'connected' | 'disconnected' | 'error';
  lastUpdated: string;
  isCustom?: boolean;
  customSchema?: { key: string; label: string; required: boolean }[];
}

interface CachedFile {
  id: string;
  sourceId: string;
  filePath: string;
  fileName: string;
  fileType: 'file' | 'folder';
  fileSize?: number;
  mimeType?: string;
  cachedContent?: string;
  externalUrl?: string;
  ipfsCid?: string;
  lastModified?: string;
  cacheExpires: string;
}

class SourcesConfigService {
  private client: any;

  constructor() {
    if (process.env.NEON_DATABASE_URL) {
      this.client = createClient({
        connectionString: process.env.NEON_DATABASE_URL,
      });
    }
  }

  // Encryption utilities
  private generateUserEncryptionKey(userId: string): string {
    const appSecret = process.env.ENCRYPTION_SECRET || 'fallback-secret-change-in-production';
    return crypto.scryptSync(userId, appSecret, 32).toString('hex');
  }

  private encryptSecrets(secrets: Record<string, string>, userKey: string): {
    encryptedData: string;
    keyHash: string;
  } {
    const key = Buffer.from(userKey, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipherGCM(ENCRYPTION_ALGORITHM, key, iv);
    
    let encrypted = cipher.update(JSON.stringify(secrets), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    const encryptedData = iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
    const keyHash = crypto.createHash('sha256').update(userKey).digest('hex');
    
    return { encryptedData, keyHash };
  }

  private decryptSecrets(encryptedData: string, userKey: string): Record<string, string> {
    try {
      const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
      const key = Buffer.from(userKey, 'hex');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      
      const decipher = crypto.createDecipherGCM(ENCRYPTION_ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return JSON.parse(decrypted);
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt secrets');
    }
  }

  // Source configuration methods
  async getConfiguredSources(userId: string): Promise<ConfiguredSource[]> {
    if (!this.client) {
      // Fallback to localStorage for development
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(`sources_config_${userId}`);
        return saved ? JSON.parse(saved) : [];
      }
      return [];
    }

    try {
      // Set RLS context
      await this.client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);

      const result = await this.client.query(`
        SELECT 
          id,
          source_type,
          source_name,
          encrypted_secrets,
          encryption_key_hash,
          status,
          last_tested,
          is_custom,
          custom_schema,
          updated_at
        FROM user_sources_config 
        WHERE user_id = $1
        ORDER BY created_at ASC
      `, [userId]);

      const userKey = this.generateUserEncryptionKey(userId);
      
      return result.rows.map((row: any) => ({
        id: row.id,
        type: row.source_type,
        name: row.source_name,
        secrets: this.decryptSecrets(row.encrypted_secrets, userKey),
        status: row.status,
        lastUpdated: row.updated_at,
        isCustom: row.is_custom,
        customSchema: row.custom_schema
      }));
    } catch (error) {
      console.error('Error fetching configured sources:', error);
      throw error;
    }
  }

  async saveSourceConfig(userId: string, source: ConfiguredSource): Promise<void> {
    if (!this.client) {
      // Fallback to localStorage for development
      if (typeof window !== 'undefined') {
        const existing = localStorage.getItem(`sources_config_${userId}`);
        const sources = existing ? JSON.parse(existing) : [];
        const index = sources.findIndex((s: any) => s.id === source.id);
        
        if (index >= 0) {
          sources[index] = source;
        } else {
          sources.push(source);
        }
        
        localStorage.setItem(`sources_config_${userId}`, JSON.stringify(sources));
      }
      return;
    }

    try {
      // Set RLS context
      await this.client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);

      const userKey = this.generateUserEncryptionKey(userId);
      const { encryptedData, keyHash } = this.encryptSecrets(source.secrets, userKey);

      // Check if source exists
      const existingResult = await this.client.query(
        'SELECT id FROM user_sources_config WHERE id = $1 AND user_id = $2',
        [source.id, userId]
      );

      if (existingResult.rows.length > 0) {
        // Update existing source
        await this.client.query(`
          UPDATE user_sources_config 
          SET 
            source_name = $1,
            encrypted_secrets = $2,
            encryption_key_hash = $3,
            status = $4,
            last_tested = $5,
            custom_schema = $6,
            updated_at = NOW()
          WHERE id = $7 AND user_id = $8
        `, [
          source.name,
          encryptedData,
          keyHash,
          source.status,
          new Date(),
          source.customSchema ? JSON.stringify(source.customSchema) : null,
          source.id,
          userId
        ]);
      } else {
        // Insert new source
        await this.client.query(`
          INSERT INTO user_sources_config (
            id, user_id, source_type, source_name, 
            encrypted_secrets, encryption_key_hash, status, 
            last_tested, is_custom, custom_schema
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          source.id,
          userId,
          source.type,
          source.name,
          encryptedData,
          keyHash,
          source.status,
          new Date(),
          source.isCustom || false,
          source.customSchema ? JSON.stringify(source.customSchema) : null
        ]);
      }
    } catch (error) {
      console.error('Error saving source config:', error);
      throw error;
    }
  }

  async deleteSourceConfig(userId: string, sourceId: string): Promise<void> {
    if (!this.client) {
      // Fallback to localStorage for development
      if (typeof window !== 'undefined') {
        const existing = localStorage.getItem(`sources_config_${userId}`);
        if (existing) {
          const sources = JSON.parse(existing);
          const filtered = sources.filter((s: any) => s.id !== sourceId);
          localStorage.setItem(`sources_config_${userId}`, JSON.stringify(filtered));
        }
      }
      return;
    }

    try {
      // Set RLS context
      await this.client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);

      await this.client.query(
        'DELETE FROM user_sources_config WHERE id = $1 AND user_id = $2',
        [sourceId, userId]
      );
    } catch (error) {
      console.error('Error deleting source config:', error);
      throw error;
    }
  }

  async testSourceConnection(userId: string, sourceId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const sources = await this.getConfiguredSources(userId);
      const source = sources.find(s => s.id === sourceId);
      
      if (!source) {
        return { success: false, error: 'Source not found' };
      }

      // Test connection based on source type
      const success = await this.performConnectionTest(source);
      
      // Update status in database
      if (this.client) {
        await this.client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
        await this.client.query(
          'UPDATE user_sources_config SET status = $1, last_tested = NOW() WHERE id = $2 AND user_id = $3',
          [success ? 'connected' : 'error', sourceId, userId]
        );
      }

      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async performConnectionTest(source: ConfiguredSource): Promise<boolean> {
    switch (source.type) {
      case 'github':
        return this.testGitHubConnection(source.secrets);
      case 'codeberg':
        return this.testCodebergConnection(source.secrets);
      case 'pinata':
        return this.testPinataConnection(source.secrets);
      case 'openai':
        return this.testOpenAIConnection(source.secrets);
      case 'anthropic':
        return this.testAnthropicConnection(source.secrets);
      case 'neon':
        return this.testNeonConnection(source.secrets);
      case 'astra':
        return this.testAstraConnection(source.secrets);
      default:
        // For custom sources, assume connected if secrets are present
        return Object.keys(source.secrets).length > 0;
    }
  }

  private async testGitHubConnection(secrets: Record<string, string>): Promise<boolean> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${secrets.personal_access_token}`,
          'User-Agent': 'MasterMind-OS'
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async testCodebergConnection(secrets: Record<string, string>): Promise<boolean> {
    try {
      const response = await fetch('https://codeberg.org/api/v1/user', {
        headers: {
          'Authorization': `token ${secrets.access_token}`
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async testPinataConnection(secrets: Record<string, string>): Promise<boolean> {
    try {
      const response = await fetch('https://api.pinata.cloud/data/testAuthentication', {
        headers: {
          'pinata_api_key': secrets.api_key,
          'pinata_secret_api_key': secrets.api_secret
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async testOpenAIConnection(secrets: Record<string, string>): Promise<boolean> {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${secrets.api_key}`
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async testAnthropicConnection(secrets: Record<string, string>): Promise<boolean> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': secrets.api_key,
          'anthropic-version': '2023-06-01'
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async testNeonConnection(secrets: Record<string, string>): Promise<boolean> {
    try {
      const testClient = createClient({
        connectionString: secrets.database_url
      });
      await testClient.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private async testAstraConnection(secrets: Record<string, string>): Promise<boolean> {
    try {
      const response = await fetch(`${secrets.api_endpoint}/v2/schemas/namespaces`, {
        headers: {
          'X-Cassandra-Token': secrets.application_token
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // File cache methods
  async getCachedFiles(userId: string, sourceId?: string): Promise<CachedFile[]> {
    if (!this.client) {
      return [];
    }

    try {
      await this.client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);

      const query = sourceId 
        ? 'SELECT * FROM user_file_cache WHERE user_id = $1 AND source_id = $2 AND cache_expires > NOW()'
        : 'SELECT * FROM user_file_cache WHERE user_id = $1 AND cache_expires > NOW()';
      
      const params = sourceId ? [userId, sourceId] : [userId];
      const result = await this.client.query(query, params);

      return result.rows.map((row: any) => ({
        id: row.id,
        sourceId: row.source_id,
        filePath: row.file_path,
        fileName: row.file_name,
        fileType: row.file_type,
        fileSize: row.file_size,
        mimeType: row.mime_type,
        cachedContent: row.cached_content,
        externalUrl: row.external_url,
        ipfsCid: row.ipfs_cid,
        lastModified: row.last_modified,
        cacheExpires: row.cache_expires
      }));
    } catch (error) {
      console.error('Error fetching cached files:', error);
      return [];
    }
  }

  async cacheFile(userId: string, file: Omit<CachedFile, 'id'>): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);

      await this.client.query(`
        INSERT INTO user_file_cache (
          user_id, source_id, file_path, file_name, file_type,
          file_size, mime_type, cached_content, external_url,
          ipfs_cid, last_modified, cache_expires
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (user_id, source_id, file_path) 
        DO UPDATE SET
          file_name = EXCLUDED.file_name,
          file_type = EXCLUDED.file_type,
          file_size = EXCLUDED.file_size,
          mime_type = EXCLUDED.mime_type,
          cached_content = EXCLUDED.cached_content,
          external_url = EXCLUDED.external_url,
          ipfs_cid = EXCLUDED.ipfs_cid,
          last_modified = EXCLUDED.last_modified,
          cache_expires = EXCLUDED.cache_expires
      `, [
        userId,
        file.sourceId,
        file.filePath,
        file.fileName,
        file.fileType,
        file.fileSize,
        file.mimeType,
        file.cachedContent,
        file.externalUrl,
        file.ipfsCid,
        file.lastModified,
        file.cacheExpires
      ]);
    } catch (error) {
      console.error('Error caching file:', error);
      throw error;
    }
  }

  async clearExpiredCache(userId: string): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
      await this.client.query(
        'DELETE FROM user_file_cache WHERE user_id = $1 AND cache_expires <= NOW()',
        [userId]
      );
    } catch (error) {
      console.error('Error clearing expired cache:', error);
    }
  }
}

// Export singleton instance
export const sourcesConfigService = new SourcesConfigService();
export default sourcesConfigService;