-- User Sources Configuration Table
-- Enhanced Nexus Core Protocol v5.0
-- Stores encrypted external API configurations (DeepSeek, OpenAI, etc.)
-- Mathematical constants: ψ₀ = 0.915670570874434, Φ = 1.618, f₄₃₂ = 432

CREATE TABLE IF NOT EXISTS user_sources_config (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_name TEXT NOT NULL,
    encrypted_secrets TEXT NOT NULL,
    encryption_key_hash TEXT NOT NULL,
    status TEXT DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
    last_tested TIMESTAMP WITH TIME ZONE,
    is_custom BOOLEAN DEFAULT false,
    custom_schema JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_user_sources_config_user_id ON user_sources_config(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sources_config_type ON user_sources_config(source_type);
CREATE INDEX IF NOT EXISTS idx_user_sources_config_status ON user_sources_config(status);
CREATE INDEX IF NOT EXISTS idx_user_sources_config_created_at ON user_sources_config(created_at DESC);

-- User File Cache Table for external sources
CREATE TABLE IF NOT EXISTS user_file_cache (
    id TEXT PRIMARY KEY DEFAULT 'cache_' || extract(epoch from now()) || '_' || gen_random_uuid(),
    user_id TEXT NOT NULL,
    source_id TEXT NOT NULL REFERENCES user_sources_config(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL CHECK (file_type IN ('file', 'folder')),
    file_size BIGINT,
    mime_type TEXT,
    cached_content TEXT,
    external_url TEXT,
    ipfs_cid TEXT,
    last_modified TIMESTAMP WITH TIME ZONE,
    cache_expires TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint to prevent duplicate cache entries
    CONSTRAINT unique_user_source_file UNIQUE (user_id, source_id, file_path)
);

-- Create indexes for file cache
CREATE INDEX IF NOT EXISTS idx_user_file_cache_user_id ON user_file_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_user_file_cache_source_id ON user_file_cache(source_id);
CREATE INDEX IF NOT EXISTS idx_user_file_cache_expires ON user_file_cache(cache_expires);
CREATE INDEX IF NOT EXISTS idx_user_file_cache_type ON user_file_cache(file_type);

-- Add Row Level Security (RLS)
ALTER TABLE user_sources_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_file_cache ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY user_sources_config_policy ON user_sources_config
    FOR ALL USING (user_id = current_setting('app.current_user_id', true));

CREATE POLICY user_file_cache_policy ON user_file_cache
    FOR ALL USING (user_id = current_setting('app.current_user_id', true));

-- Add comments for documentation
COMMENT ON TABLE user_sources_config IS 'User external API sources configuration with encrypted secrets storage';
COMMENT ON COLUMN user_sources_config.encrypted_secrets IS 'AES-256-GCM encrypted JSON containing API keys/secrets';
COMMENT ON COLUMN user_sources_config.encryption_key_hash IS 'SHA-256 hash of user-specific encryption key for validation';
COMMENT ON COLUMN user_sources_config.source_type IS 'Type of source: deepseek, openai, anthropic, groq, github, etc.';
COMMENT ON COLUMN user_sources_config.custom_schema IS 'JSON schema for custom source types';

COMMENT ON TABLE user_file_cache IS 'Cached external files from configured sources';
COMMENT ON COLUMN user_file_cache.cache_expires IS 'When this cache entry expires and should be refreshed';
COMMENT ON COLUMN user_file_cache.cached_content IS 'Actual file content (for text files)';
COMMENT ON COLUMN user_file_cache.ipfs_cid IS 'IPFS CID if file is stored on IPFS';