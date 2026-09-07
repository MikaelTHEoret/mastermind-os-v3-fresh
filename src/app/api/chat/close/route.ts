import { NextRequest, NextResponse } from 'next/server';
import { chatAccessError } from '../_boundary';

const PORTAL = 'http://127.0.0.1:8767';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req:NextRequest) {
  const denied = await chatAccessError(req);
  if(denied) return denied;
  try {
    const body = await req.json();
    const response = await fetch(`${PORTAL}/chat/close`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
    });
    return NextResponse.json(await response.json(),{status:response.status});
  } catch {
    return NextResponse.json({ok:false,error:'The chat service could not confirm that the conversation was closed. Try again before starting a new session.'},{status:502});
  }
}
