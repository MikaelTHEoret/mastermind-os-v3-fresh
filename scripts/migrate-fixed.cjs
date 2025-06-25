// Migration Script: Create User Sources Config Tables
// Run this to create the missing database tables for API configurations

const { neon } = require('@neondatabase/serverless');

// Manually set the database URL since dotenv might not be available
const DATABASE_URL = 'postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?connect_timeout=15&sslmode=require';

const sql = neon(DATABASE_URL);

async function runMigration() {
  console.log('🌀 Running User Sources Config Migration...');
  
  try {
    // Create user_sources_config table
    await sql`
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
      )
    `;
    
    console.log('✅ Created user_sources_config table');
    
    // Create user_file_cache table
    await sql`
      CREATE TABLE IF NOT EXISTS user_file_cache (
        id TEXT PRIMARY KEY DEFAULT 'cache_' || extract(epoch from now()) || '_' || gen_random_uuid(),
        user_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
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
        CONSTRAINT unique_user_source_file UNIQUE (user_id, source_id, file_path)
      )
    `;
    
    console.log('✅ Created user_file_cache table');
    
    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_user_sources_config_user_id ON user_sources_config(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_user_sources_config_type ON user_sources_config(source_type)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_user_sources_config_status ON user_sources_config(status)`;
    
    await sql`CREATE INDEX IF NOT EXISTS idx_user_file_cache_user_id ON user_file_cache(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_user_file_cache_source_id ON user_file_cache(source_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_user_file_cache_expires ON user_file_cache(cache_expires)`;
    
    console.log('✅ Created indexes');
    
    // Enable RLS
    await sql`ALTER TABLE user_sources_config ENABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE user_file_cache ENABLE ROW LEVEL SECURITY`;
    
    console.log('✅ Enabled Row Level Security');
    
    // Drop existing policies if they exist (to avoid errors)
    try {
      await sql`DROP POLICY IF EXISTS user_sources_config_policy ON user_sources_config`;
      await sql`DROP POLICY IF EXISTS user_file_cache_policy ON user_file_cache`;
    } catch (e) {
      // Ignore errors if policies don't exist
    }
    
    // Create RLS policies
    await sql`
      CREATE POLICY user_sources_config_policy ON user_sources_config
      FOR ALL USING (user_id = current_setting('app.current_user_id', true))
    `;
    
    await sql`
      CREATE POLICY user_file_cache_policy ON user_file_cache
      FOR ALL USING (user_id = current_setting('app.current_user_id', true))
    `;
    
    console.log('✅ Created RLS policies');
    
    console.log('🎉 Migration completed successfully!');
    
    // Verify tables exist
    const tables = await sql`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('user_sources_config', 'user_file_cache')
      ORDER BY table_name
    `;
    
    console.log('📋 Verified tables:', tables.map(t => t.table_name));
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration().catch(console.error);