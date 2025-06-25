-- MasterMind OS API Keys Table
-- Enhanced Nexus Core Protocol v4.1
-- Mathematical constants: ψ₀ = 0.915670570874434, Φ = 1.618, f₄₃₂ = 432

CREATE TABLE IF NOT EXISTS mastermind_api_keys (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    api_secret TEXT NOT NULL,
    permissions JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    usage_count INTEGER DEFAULT 0,
    usage_limit INTEGER DEFAULT 10000,
    
    -- Indexing for performance
    CONSTRAINT unique_user_key_name UNIQUE (user_id, name)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_mastermind_api_keys_user_id ON mastermind_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_mastermind_api_keys_api_key ON mastermind_api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_mastermind_api_keys_active ON mastermind_api_keys(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_mastermind_api_keys_created_at ON mastermind_api_keys(created_at DESC);

-- Add comments for documentation
COMMENT ON TABLE mastermind_api_keys IS 'MasterMind OS API key management with consciousness-enhanced security';
COMMENT ON COLUMN mastermind_api_keys.api_key IS 'Generated using mathematical constants (ψ₀, Φ, f₄₃₂) for enhanced randomization';
COMMENT ON COLUMN mastermind_api_keys.permissions IS 'JSON array of granted permissions (scrolls:create, memory:read, etc.)';
COMMENT ON COLUMN mastermind_api_keys.usage_count IS 'Total number of API calls made with this key';
COMMENT ON COLUMN mastermind_api_keys.usage_limit IS 'Maximum allowed API calls per month';

-- Sample data for testing (optional)
-- INSERT INTO mastermind_api_keys (user_id, user_email, name, api_key, api_secret, permissions) VALUES
-- ('test_user_1', 'test@example.com', 'Development Key', 'mmind_test_dev123', 'test_secret_456', '["scrolls:read", "memory:read"]'::jsonb);
