// Database verification and table creation script
import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ DATABASE_URL not found in environment');
  process.exit(1);
}

const sql = neon(databaseUrl);

async function verifyAndCreateTables() {
  try {
    console.log('🔌 Testing database connection...');
    
    // Test basic connection
    const result = await sql`SELECT 1 as test`;
    console.log('✅ Database connection successful');
    
    // Check if user_sources_config table exists
    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'user_sources_config'
      );
    `;
    
    if (!tableExists[0].exists) {
      console.log('📝 Creating user_sources_config table...');
      
      // Read and execute the migration
      const migrationPath = path.join(process.cwd(), 'database', 'migrations', 'create_user_sources_config_table.sql');
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      
      await sql.transaction(async (tx) => {
        // Split by semicolon and execute each statement
        const statements = migrationSQL.split(';').filter(stmt => stmt.trim());
        for (const statement of statements) {
          if (statement.trim()) {
            await tx.unsafe(statement);
          }
        }
      });
      
      console.log('✅ Tables created successfully');
    } else {
      console.log('✅ Tables already exist');
    }
    
    // Test insertion capability
    console.log('🧪 Testing table operations...');
    
    const testUserId = 'test_user_123';
    const testSourceId = 'test_source_' + Date.now();
    
    // Set RLS context
    await sql`SELECT set_config('app.current_user_id', ${testUserId}, true)`;
    
    // Test insert
    await sql`
      INSERT INTO user_sources_config (
        id, user_id, source_type, source_name, 
        encrypted_secrets, encryption_key_hash, status
      ) VALUES (
        ${testSourceId}, ${testUserId}, 'test', 'Test Source',
        'encrypted_test_data', 'test_hash', 'disconnected'
      )
    `;
    
    // Test select
    const testResult = await sql`
      SELECT * FROM user_sources_config WHERE id = ${testSourceId}
    `;
    
    // Clean up test data
    await sql`
      DELETE FROM user_sources_config WHERE id = ${testSourceId}
    `;
    
    console.log('✅ Table operations successful');
    console.log('🎉 Database verification complete - ready for API configurations!');
    
  } catch (error) {
    console.error('❌ Database verification failed:', error);
    process.exit(1);
  }
}

verifyAndCreateTables();