import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { neon } from '@neondatabase/serverless';

export async function POST(request: NextRequest) {
  console.log('🔥 SIMPLE TEST: Starting basic database test...');
  
  try {
    // 1. Test authentication
    const { userId } = await auth();
    console.log('👤 User ID:', userId);
    if (!userId) {
      return NextResponse.json({ error: 'No auth' }, { status: 401 });
    }

    // 2. Test environment variable
    const dbUrl = process.env.DATABASE_URL;
    console.log('🔌 DB URL exists:', !!dbUrl);
    if (!dbUrl) {
      return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 });
    }

    // 3. Test basic database connection
    const sql = neon(dbUrl);
    console.log('🧪 Testing basic query...');
    await sql`SELECT 1`;
    console.log('✅ Basic query works');

    // 4. Test RLS context
    console.log('🔐 Setting RLS context...');
    await sql`SELECT set_config('app.current_user_id', ${userId}, true)`;
    console.log('✅ RLS context set');

    // 5. Test simple insert (no encryption)
    console.log('💾 Testing simple insert...');
    const testId = 'simple_test_' + Date.now();
    await sql`
      INSERT INTO user_sources_config (
        id, user_id, source_type, source_name, 
        encrypted_secrets, encryption_key_hash, status
      ) VALUES (
        ${testId}, ${userId}, 'test', 'Simple Test',
        ${'{"test": "data"}'), 'test_hash', 'disconnected'
      )
    `;
    console.log('✅ Insert successful');

    // 6. Test retrieval
    console.log('📖 Testing retrieval...');
    const result = await sql`
      SELECT * FROM user_sources_config WHERE id = ${testId}
    `;
    console.log('✅ Retrieval successful:', result);

    // 7. Cleanup
    console.log('🧹 Cleaning up...');
    await sql`DELETE FROM user_sources_config WHERE id = ${testId}`;
    console.log('✅ Cleanup complete');

    return NextResponse.json({
      success: true,
      message: 'All basic database operations successful',
      userId,
      testRecord: result[0]
    });

  } catch (error) {
    console.error('❌ SIMPLE TEST FAILED:', error);
    console.error('❌ Error type:', typeof error);
    console.error('❌ Error message:', error instanceof Error ? error.message : 'Unknown');
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack');
    
    return NextResponse.json({
      error: 'Simple test failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      type: typeof error,
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}