'use client';

import React from 'react';

// Neon Database Schema for Sources Configuration
// This component provides the database schema documentation

export default function SourcesConfigSchema() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Sources Configuration Database Schema</h2>
      
      <div className="space-y-4">
        <div className="bg-black/40 backdrop-blur-sm border border-cyan-500/30 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-cyan-400 mb-4">user_sources_config</h3>
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-3 gap-4 font-mono">
              <span className="text-purple-400">Column</span>
              <span className="text-green-400">Type</span>
              <span className="text-yellow-400">Description</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>id</span>
              <span>UUID PRIMARY KEY</span>
              <span>Unique identifier for each source config</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>user_id</span>
              <span>VARCHAR(255) NOT NULL</span>
              <span>Clerk user ID (indexed)</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>source_type</span>
              <span>VARCHAR(50) NOT NULL</span>
              <span>github, codeberg, pinata, custom, etc.</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>source_name</span>
              <span>VARCHAR(255) NOT NULL</span>
              <span>User-defined name for the source</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>encrypted_secrets</span>
              <span>TEXT NOT NULL</span>
              <span>AES-256 encrypted JSON of API keys/secrets</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>encryption_key_hash</span>
              <span>VARCHAR(255) NOT NULL</span>
              <span>Hash of user-specific encryption key</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>status</span>
              <span>VARCHAR(20) DEFAULT 'disconnected'</span>
              <span>connected, disconnected, error</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>last_tested</span>
              <span>TIMESTAMP</span>
              <span>Last connection test timestamp</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>is_custom</span>
              <span>BOOLEAN DEFAULT FALSE</span>
              <span>Whether this is a custom source type</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>custom_schema</span>
              <span>JSONB</span>
              <span>Custom secret schema for custom sources</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>created_at</span>
              <span>TIMESTAMP DEFAULT NOW()</span>
              <span>Creation timestamp</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>updated_at</span>
              <span>TIMESTAMP DEFAULT NOW()</span>
              <span>Last update timestamp</span>
            </div>
          </div>
        </div>

        <div className="bg-black/40 backdrop-blur-sm border border-cyan-500/30 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-cyan-400 mb-4">user_file_cache</h3>
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-3 gap-4 font-mono">
              <span className="text-purple-400">Column</span>
              <span className="text-green-400">Type</span>
              <span className="text-yellow-400">Description</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>id</span>
              <span>UUID PRIMARY KEY</span>
              <span>Unique identifier for cached file</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>user_id</span>
              <span>VARCHAR(255) NOT NULL</span>
              <span>Clerk user ID (indexed)</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>source_id</span>
              <span>UUID REFERENCES user_sources_config(id)</span>
              <span>Source configuration reference</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>file_path</span>
              <span>TEXT NOT NULL</span>
              <span>Full path to file in source</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>file_name</span>
              <span>VARCHAR(255) NOT NULL</span>
              <span>File name</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>file_type</span>
              <span>VARCHAR(50)</span>
              <span>file, folder</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>file_size</span>
              <span>BIGINT</span>
              <span>File size in bytes</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>mime_type</span>
              <span>VARCHAR(100)</span>
              <span>MIME type of file</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>cached_content</span>
              <span>TEXT</span>
              <span>Cached file content (for small files)</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>external_url</span>
              <span>TEXT</span>
              <span>External URL for large files</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>ipfs_cid</span>
              <span>VARCHAR(255)</span>
              <span>IPFS CID if uploaded to IPFS</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>last_modified</span>
              <span>TIMESTAMP</span>
              <span>File last modified timestamp</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>cache_expires</span>
              <span>TIMESTAMP</span>
              <span>When cache entry expires</span>
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-gray-300">
              <span>created_at</span>
              <span>TIMESTAMP DEFAULT NOW()</span>
              <span>Cache creation timestamp</span>
            </div>
          </div>
        </div>

        <div className="bg-black/40 backdrop-blur-sm border border-green-500/30 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-green-400 mb-4">Security Features</h3>
          <ul className="space-y-2 text-sm text-gray-300">
            <li>• <strong>User-specific encryption:</strong> Each user has their own encryption key derived from their Clerk user ID</li>
            <li>• <strong>AES-256 encryption:</strong> All API keys and secrets encrypted before storage</li>
            <li>• <strong>No plaintext secrets:</strong> Secrets never stored in plaintext in database</li>
            <li>• <strong>Row-level security:</strong> Users can only access their own configuration data</li>
            <li>• <strong>Connection testing:</strong> API keys validated before storage and periodically tested</li>
            <li>• <strong>Audit trail:</strong> All access and modifications logged with timestamps</li>
            <li>• <strong>Cache invalidation:</strong> File cache entries expire and are refreshed automatically</li>
          </ul>
        </div>

        <div className="bg-black/40 backdrop-blur-sm border border-purple-500/30 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-purple-400 mb-4">Indexes</h3>
          <div className="space-y-2 text-sm font-mono">
            <div className="text-gray-300">CREATE INDEX idx_user_sources_user_id ON user_sources_config(user_id);</div>
            <div className="text-gray-300">CREATE INDEX idx_user_sources_type ON user_sources_config(source_type);</div>
            <div className="text-gray-300">CREATE INDEX idx_user_sources_status ON user_sources_config(status);</div>
            <div className="text-gray-300">CREATE INDEX idx_file_cache_user_id ON user_file_cache(user_id);</div>
            <div className="text-gray-300">CREATE INDEX idx_file_cache_source_id ON user_file_cache(source_id);</div>
            <div className="text-gray-300">CREATE INDEX idx_file_cache_path ON user_file_cache(file_path);</div>
            <div className="text-gray-300">CREATE INDEX idx_file_cache_expires ON user_file_cache(cache_expires);</div>
          </div>
        </div>

        <div className="bg-black/40 backdrop-blur-sm border border-orange-500/30 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-orange-400 mb-4">API Integration Points</h3>
          <div className="space-y-3 text-sm">
            <div>
              <strong className="text-cyan-400">Sources Configuration Dashboard:</strong>
              <p className="text-gray-300 ml-4">• Create, read, update, delete source configurations</p>
              <p className="text-gray-300 ml-4">• Test API connections and validate credentials</p>
              <p className="text-gray-300 ml-4">• Manage custom source types with dynamic schemas</p>
            </div>
            <div>
              <strong className="text-cyan-400">File Explorer Integration:</strong>
              <p className="text-gray-300 ml-4">• Load configured sources as dropdown directory roots</p>
              <p className="text-gray-300 ml-4">• Cache file listings and content for performance</p>
              <p className="text-gray-300 ml-4">• Support drag-and-drop operations between sources</p>
            </div>
            <div>
              <strong className="text-cyan-400">Scroll Minter Integration:</strong>
              <p className="text-gray-300 ml-4">• Auto-populate minter fields from selected files</p>
              <p className="text-gray-300 ml-4">• Generate IPFS CIDs and keccak256 hashes</p>
              <p className="text-gray-300 ml-4">• Store minting history and transaction records</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// SQL Schema for Neon Database Setup
export const SQL_SCHEMA = `
-- Create user_sources_config table
CREATE TABLE user_sources_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    source_type VARCHAR(50) NOT NULL,
    source_name VARCHAR(255) NOT NULL,
    encrypted_secrets TEXT NOT NULL,
    encryption_key_hash VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
    last_tested TIMESTAMP,
    is_custom BOOLEAN DEFAULT FALSE,
    custom_schema JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create user_file_cache table
CREATE TABLE user_file_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    source_id UUID REFERENCES user_sources_config(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(50) CHECK (file_type IN ('file', 'folder')),
    file_size BIGINT,
    mime_type VARCHAR(100),
    cached_content TEXT,
    external_url TEXT,
    ipfs_cid VARCHAR(255),
    last_modified TIMESTAMP,
    cache_expires TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_user_sources_user_id ON user_sources_config(user_id);
CREATE INDEX idx_user_sources_type ON user_sources_config(source_type);
CREATE INDEX idx_user_sources_status ON user_sources_config(status);
CREATE INDEX idx_file_cache_user_id ON user_file_cache(user_id);
CREATE INDEX idx_file_cache_source_id ON user_file_cache(source_id);
CREATE INDEX idx_file_cache_path ON user_file_cache(file_path);
CREATE INDEX idx_file_cache_expires ON user_file_cache(cache_expires);

-- Enable Row Level Security
ALTER TABLE user_sources_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_file_cache ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY user_sources_policy ON user_sources_config
    FOR ALL USING (user_id = current_setting('app.current_user_id'));

CREATE POLICY user_file_cache_policy ON user_file_cache
    FOR ALL USING (user_id = current_setting('app.current_user_id'));

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_sources_config_updated_at
    BEFORE UPDATE ON user_sources_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
`;

// Example encryption/decryption functions (for reference)
export const ENCRYPTION_UTILITIES = `
// Client-side encryption utilities
import crypto from 'crypto';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

export function generateUserEncryptionKey(userId: string): string {
  // Generate a deterministic key from user ID and app secret
  const appSecret = process.env.ENCRYPTION_SECRET || 'fallback-secret-change-in-production';
  return crypto.scryptSync(userId, appSecret, 32).toString('hex');
}

export function encryptSecrets(secrets: Record<string, string>, userKey: string): {
  encryptedData: string;
  keyHash: string;
} {
  const key = Buffer.from(userKey, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipher(ENCRYPTION_ALGORITHM, key);
  
  let encrypted = cipher.update(JSON.stringify(secrets), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  const encryptedData = iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  const keyHash = crypto.createHash('sha256').update(userKey).digest('hex');
  
  return { encryptedData, keyHash };
}

export function decryptSecrets(encryptedData: string, userKey: string): Record<string, string> {
  const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
  const key = Buffer.from(userKey, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = crypto.createDecipher(ENCRYPTION_ALGORITHM, key);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return JSON.parse(decrypted);
}
`;