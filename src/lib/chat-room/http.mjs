import {RoomError,identifier} from './contract.mjs';
export const ROOM_HEADERS={'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"};
export function roomHandlers({authorizeRequest,authenticate,storeFor,readJson,enabled=false}){
 async function handle(request,{params}){
  try{
   const {taskId,session}=await params;
   identifier(session);
   if(typeof taskId!=='string'||!/^[0-9a-f-]{36}$/.test(taskId))throw new RoomError('ROOM_REFERENCE_INVALID');
   authorizeRequest(request,`/api/chat/rooms/${taskId}/${session}`,request.method==='POST');
   const owner=await authenticate();
   if(!owner.ok)throw new RoomError('OWNER_REQUIRED',owner.status);
   if(enabled!==true)throw new RoomError('ROOM_SERVICE_NOT_ACTIVATED',503);
   const store=await storeFor(owner.userId),ref={taskId,session,project:'mastermind'};
   const output=request.method==='GET'?await store.read(ref):await store.command(ref,await readJson(request,65536));
   return Response.json(output,{headers:ROOM_HEADERS});
  }catch(error){
   const known=error instanceof RoomError||['NodeExchangeHttpError','ContextGatewayError','LocalServiceRequestBodyError'].includes(error?.constructor?.name);
   return Response.json({ok:false,error:known?error.code:'ROOM_UNAVAILABLE',executionAuthorized:false},
    {status:known?error.status:503,headers:ROOM_HEADERS});
  }
 }
 return {GET:handle,POST:handle};
}
