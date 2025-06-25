// Create mastermind_api_keys table migration
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?connect_timeout=15&sslmode=require';
const sql = neon(DATABASE_URL);

async function createApiKeysTable() {
  console.log('🌀 Creating mastermind_api_keys table...');
  
  try {
    await sql`
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
        
        CONSTRAINT unique_user_key_name UNIQUE (user_id, name)
      )
    `;
    
    console.log('✅ mastermind_api_keys table created');
    
    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_mastermind_api_keys_user_id ON mastermind_api_keys(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_mastermind_api_keys_api_key ON mastermind_api_keys(api_key)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_mastermind_api_keys_active ON mastermind_api_keys(is_active) WHERE is_active = true`;
    await sql`CREATE INDEX IF NOT EXISTS idx_mastermind_api_keys_created_at ON mastermind_api_keys(created_at DESC)`;
    
    console.log('✅ Indexes created');
    console.log('🎉 Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

createApiKeysTable().catch(console.error);