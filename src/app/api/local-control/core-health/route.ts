import { NextRequest,NextResponse } from 'next/server';
import { chatAccessError } from '../../chat/_boundary';
import { cachedCoreHealth } from '@/lib/live-status/core-health.mjs';

export const dynamic='force-dynamic';
export const revalidate=0;
export async function GET(request:NextRequest) {
  const denied=await chatAccessError(request);
  if(denied) return denied;
  if(request.nextUrl.search) return NextResponse.json({ok:false,error:'Core health does not accept endpoint or query overrides.'},{status:400});
  return NextResponse.json(await cachedCoreHealth(),{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
