import 'server-only';
import { NextResponse } from 'next/server';
import { ownerGateConfigured, requireOwner } from '@/lib/trading/auth';

const LOCAL_AUTHORITY = /^(?:localhost|127\.0\.0\.1):3000$/i;
const LOCAL_HOSTS = new Set(['localhost','127.0.0.1']);

export async function chatAccessError(request:Request):Promise<NextResponse|null> {
  const denied = (error:string, status = 403) => NextResponse.json({ok:false,error},{status,headers:{'Cache-Control':'no-store'}});
  if(process.env.VERCEL) return denied('Chat and saved conversations are available only from the command center on this PC.');
  const host = request.headers.get('host') || '';
  const url = new URL(request.url);
  if(!LOCAL_AUTHORITY.test(host) || url.protocol !== 'http:' || !LOCAL_HOSTS.has(url.hostname)
    || url.port !== '3000' || url.username || url.password) {
    return denied('Chat accepts requests only from the local command center.');
  }
  const expectedOrigin = `http://${host.toLowerCase()}`;
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if((origin && origin !== expectedOrigin) || (fetchSite && fetchSite !== 'same-origin')) {
    return denied('Cross-origin chat requests are not allowed.');
  }
  if(request.method !== 'GET' && (origin !== expectedOrigin || fetchSite !== 'same-origin')) {
    return denied('Chat changes require a same-origin browser request.');
  }
  if(ownerGateConfigured()) {
    const owner = await requireOwner();
    if(!owner.ok) return denied('Sign in as the command-center owner to use chat.',owner.status);
  }
  return null;
}
