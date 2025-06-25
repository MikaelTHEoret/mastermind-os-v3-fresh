// Temporary non-encrypted version for debugging
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { neon } from '@neondatabase/serverless';

export async function POST(request: NextRequest) {
  try {
    console.log('🧪 DEBUG: Testing basic database save without encryption...');
    
    const { userId } = await auth();
    console.log('👤 DEBUG User ID:', userId);
    
    if (!userId) {
      return NextResponse.json({ error: 'No user authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { source } = body;
    
    console.log('📄 DEBUG Source data:', source);
    
    // Test basic database connection
    const databaseUrl = process.env.DATABASE_URL;
    console.log('🔌 DEBUG Database URL exists:', !!databaseUrl);
    
    if (!databaseUrl) {
      return NextResponse.json({ error: 'No database URL' }, { status: 500 });
    }
    
    const sql = neon(databaseUrl);
    
    // Test basic query
    console.log('🧪 Testing basic database query...');
    const testResult = await sql`SELECT 1 as test`;
    console.log('✅ Basic query successful:', testResult);
    
    // Set RLS context
    console.log('🔐 Setting RLS context...');
    await sql`SELECT set_config('app.current_user_id', ${userId}, true)`;
    
    // Try to insert without encryption for debug
    console.log('💾 Attempting insert without encryption...');
    const debugInsert = await sql`
      INSERT INTO user_sources_config (
        id, user_id, source_type, source_name, 
        encrypted_secrets, encryption_key_hash, status
      ) VALUES (
        ${source.id + '_debug'}, ${userId}, ${source.type}, ${source.name + ' (Debug)'},
        ${JSON.stringify(source.secrets)}, 'debug_hash', ${source.status}
      )
      ON CONFLICT (id) DO UPDATE SET
        source_name = EXCLUDED.source_name,
        encrypted_secrets = EXCLUDED.encrypted_secrets,
        updated_at = NOW()
    `;
    
    console.log('✅ Debug insert successful');
    
    // Clean up debug record
    await sql`DELETE FROM user_sources_config WHERE id = ${source.id + '_debug'}`;
    
    return NextResponse.json({
      status: 'success',
      message: 'DEBUG: Basic database operations working',
      userId,
      databaseConnected: true,
      testResult
    });

  } catch (error) {
    console.error('❌ DEBUG: Database test failed:', error);
    return NextResponse.json({
      error: 'DEBUG: Database test failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}