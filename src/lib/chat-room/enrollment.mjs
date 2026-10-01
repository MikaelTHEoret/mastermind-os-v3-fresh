import {createHash} from 'node:crypto';
import {RoomError} from './contract.mjs';
import {CATALOG_VERSION} from './providers.mjs';
import {ROOM_HEADERS} from './http.mjs';

const fail=(code,status=400)=>{throw new RoomError(code,status);};
// This is only a proposal for the existing server policy, never activation.
export function prepareEnrollment(env,owner,input,now=Date.now()){
 if(!owner||owner.role!=='parent'||typeof owner.subject!=='string'||!/^user_[A-Za-z0-9]+$/.test(owner.subject)
  ||typeof owner.householdId!=='string'||!owner.householdId||owner.householdId.length>100
  ||typeof owner.actorPlayerId!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(owner.actorPlayerId))fail('ROOM_ENROLLMENT_OWNER_REQUIRED',403);
 if(!input||Object.keys(input).sort().join(',')!=='catalogVersion,geminiFreeTierConfirmed,providers'
  ||input.catalogVersion!==CATALOG_VERSION||typeof input.geminiFreeTierConfirmed!=='boolean'
  ||!Array.isArray(input.providers)||input.providers.length<1||input.providers.length>2
  ||new Set(input.providers).size!==input.providers.length||input.providers.some(p=>!['zai','gemini'].includes(p)))fail('ROOM_ENROLLMENT_INVALID');
 if(input.providers.includes('gemini')!==input.geminiFreeTierConfirmed)fail('ROOM_ENROLLMENT_FREE_TIER_REQUIRED');
 if(!Number.isSafeInteger(now)||now<0)fail('ROOM_ENROLLMENT_TIME_INVALID');
 const providers={};
 for(const name of [...input.providers].sort()){
  const key=env[name==='zai'?'MASTERMIND_ROOM_ZAI_API_KEY':'MASTERMIND_ROOM_GEMINI_API_KEY'];
  if(typeof key!=='string'||key.length<16||key.length>4096||!key.isWellFormed()||/[\r\n]/.test(key)||key.trim()!==key)fail('ROOM_ENROLLMENT_KEY_UNAVAILABLE',409);
  providers[name]={enabled:true,credentialSha256:createHash('sha256').update(key,'utf8').digest('hex'),...(name==='gemini'?{freeTierConfirmed:true}:{})};
 }
 const policy={householdId:owner.householdId,actorPlayerId:owner.actorPlayerId,subject:owner.subject,catalogVersion:CATALOG_VERSION,
  reviewedAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString(),allowPaid:false,providers};
 return {status:'prepared',activated:false,providerRequests:0,policy};
}

export function enrollmentHandler({authorizeRequest,authenticate,identityFor,readJson,environment=()=>process.env,now=Date.now,enabled=false}){
 return async request=>{
  try{
   authorizeRequest(request,'/api/chat/connections/prepare',true);
   const auth=await authenticate();
   if(!auth.ok)fail('OWNER_REQUIRED',auth.status);
   if(!enabled)fail('ROOM_SERVICE_NOT_ACTIVATED',503);
   const identity=await identityFor(auth.userId);
   const input=await readJson(request,2048);
   return Response.json(prepareEnrollment(environment(),{...identity,subject:auth.userId},input,now()),{headers:ROOM_HEADERS});
  }catch(error){
   const known=error instanceof RoomError||['NodeExchangeHttpError','ContextGatewayError','LocalServiceRequestBodyError'].includes(error?.constructor?.name);
   return Response.json({ok:false,error:known?error.code:'ROOM_ENROLLMENT_UNAVAILABLE',activated:false},
    {status:known?error.status:503,headers:ROOM_HEADERS});
  }
 };
}
