import { NextRequest,NextResponse } from 'next/server';
import { chatAccessError } from '../_boundary';

export const dynamic='force-dynamic';
export const revalidate=0;
export async function GET(request:NextRequest) {
  const denied=await chatAccessError(request);
  if(denied) return denied;
  const query=new URLSearchParams({project:request.nextUrl.searchParams.get('project') || 'mastermind'});
  try {
    const response=await fetch(`http://127.0.0.1:8767/chat/sessions?${query}`,{cache:'no-store'});
    return NextResponse.json(await response.json(),{status:response.status});
  } catch {
    return NextResponse.json({ok:false,error:'The saved conversation list is unavailable.'},{status:502});
  }
}
