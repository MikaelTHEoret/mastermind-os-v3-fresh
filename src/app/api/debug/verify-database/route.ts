import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    
    if (!databaseUrl) {
      return NextResponse.json({
        error: 'DATABASE_URL not found in environment',
        status: 'failed'
      }, { status: 500 });
    }

    const sql = neon(databaseUrl);
    
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
    
    let tablesCreated = false;
    
    if (!tableExists[0].exists) {
      console.log('📝 Creating user_sources_config table...');
      
      try {
        // Read migration file
        const migrationPath = path.join(process.cwd(), 'database', 'migrations', 'create_user_sources_config_table.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        
        // Execute migration with proper Neon non-interactive transaction syntax
        const statements = migrationSQL.split(';').filter(stmt => stmt.trim());
        
        // Use Neon's transaction function with array of queries (non-interactive)
        const migrationResults = await sql.transaction(
          statements.map(statement => sql`${sql.unsafe(statement.trim())}`)
        );
        
        tablesCreated = true;
        console.log('✅ Tables created successfully');
      } catch (migrationError) {
        console.error('❌ Migration failed:', migrationError);
        return NextResponse.json({
          error: 'Failed to create tables',
          details: migrationError instanceof Error ? migrationError.message : 'Unknown error',
          status: 'failed'
        }, { status: 500 });
      }
    } else {
      console.log('✅ Tables already exist');
    }
    
    // Test table operations
    console.log('🧪 Testing table operations...');
    
    const testUserId = 'test_user_' + Date.now();
    const testSourceId = 'test_source_' + Date.now();
    
    try {
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
      
      return NextResponse.json({
        status: 'success',
        message: 'Database verification complete',
        details: {
          connection: 'successful',
          tablesExisted: tableExists[0].exists,
          tablesCreated,
          operationsTest: 'successful'
        }
      });
      
    } catch (operationError) {
      console.error('❌ Table operations failed:', operationError);
      return NextResponse.json({
        error: 'Table operations failed',
        details: operationError instanceof Error ? operationError.message : 'Unknown error',
        status: 'partial_success'
      }, { status: 500 });
    }
    
  } catch (error) {
    console.error('❌ Database verification failed:', error);
    return NextResponse.json({
      error: 'Database verification failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      status: 'failed'
    }, { status: 500 });
  }
}