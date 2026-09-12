import {getMemoryDb} from '@/lib/db';
import {requireOwner} from '@/lib/trading/auth';
import {gatewayForAuthenticatedOwner} from '@/lib/mastermind-context/gateway';
import {authorizeOwnerRequest,readNodeJson} from '@/lib/node-exchange/http';
import {RoomStore} from '@/lib/chat-room/store.mjs';
import {roomHandlers} from '@/lib/chat-room/http.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
const handlers=roomHandlers({authorizeRequest:authorizeOwnerRequest,authenticate:requireOwner,readJson:readNodeJson,
 enabled:process.env.MASTERMIND_SHARED_ROOMS_ENABLED==='true',
 storeFor:async(subject:string)=>{
  const gateway=await gatewayForAuthenticatedOwner(subject);
  const sql=getMemoryDb();
  return new RoomStore((query:string,params:unknown[])=>sql.query(query,params),{...gateway.identity,subject});
 }});
export const GET=handlers.GET;
export const POST=handlers.POST;
