import { NextRequest, NextResponse } from 'next/server';
import { chatAccessError } from '../_boundary';

const PORTAL = 'http://127.0.0.1:8767';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req:NextRequest) {
  const denied = await chatAccessError(req);
  if(denied) return denied;
  const session = req.nextUrl.searchParams.get('session');
  if(!session) return NextResponse.json({ok:false,error:'A session identifier is required.'},{status:400});
  const query = new URLSearchParams({session,project:req.nextUrl.searchParams.get('project') || 'mastermind'});
  try {
    const response = await fetch(`${PORTAL}/chat/session?${query}`,{cache:'no-store'});
    return NextResponse.json(await response.json(),{status:response.status});
  } catch {
    return NextResponse.json({ok:false,error:'The chat service is unavailable. Your saved conversation has not been replaced.'},{status:502});
  }
}
