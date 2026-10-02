import {getMemoryDb} from '@/lib/db';
import {requireOwner} from '@/lib/trading/auth';
import {authorizeOwnerRequest,jsonResponse,readNodeJson,NodeExchangeHttpError} from '@/lib/node-exchange/http';
import {OWNER_NODE_PROFILE,getOwnerNexusJob,enqueueOwnerDevelopmentJob,NodeExchangeServiceError} from '@/lib/node-exchange/store';
import {ContributionError,taskRef} from '@/lib/delegation/contract.mjs';
import {NexusHostedService} from '@/lib/delegation/nexus-hosted-service.mjs';
import {NEXUS} from '../../../../../protocol/mastermind-node-exchange/native-nexus.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
type Context={params:Promise<{taskId:string}>};
async function access(request:Request,id:string,write:boolean){
 authorizeOwnerRequest(request,'/api/nexus/'+id,write,['operationId','nodeId','jobId']);const owner=await requireOwner();
 if(!owner.ok)throw new ContributionError('OWNER_REQUIRED',owner.status);
 const ref=taskRef({taskId:id,project:'mastermind'}),sql=getMemoryDb(),profile=OWNER_NODE_PROFILE;
 const service=new NexusHostedService((query:string,params:unknown[])=>sql.query(query,params),{
  householdId:profile.householdId,actorPlayerId:profile.parentPlayerId,clerkSubject:owner.userId},{
  enabled:process.env.MASTERMIND_NEXUS_ENABLED==='1',ledger:{
   read:(nodeId:string,jobId:string,task:{taskId:string;project:string})=>getOwnerNexusJob(sql,nodeId,jobId,task,profile),
   enqueue:async(nodeId:string,input:any)=>{const {job}=await enqueueOwnerDevelopmentJob(sql,nodeId,{operationId:input.operationId,input},NEXUS,profile);return {input,job};}
  }});
 return {ref,service};
}
function failure(error:unknown){const known=error instanceof ContributionError||error instanceof NodeExchangeHttpError||error instanceof NodeExchangeServiceError;return jsonResponse({ok:false,error:known?error.code:'NEXUS_UNAVAILABLE',executionAuthorized:false},known?error.status:503);}
export async function GET(request:Request,context:Context){try{
 const {taskId}=await context.params,{ref,service}=await access(request,taskId,false),q=new URL(request.url).searchParams;
 if([...q.keys()].some(k=>!['operationId','nodeId','jobId'].includes(k))||[...q.keys()].some(k=>q.getAll(k).length!==1))throw new ContributionError('NEXUS_REQUEST_INVALID',400);
 return jsonResponse({ok:true,...await service.read(ref,{operationId:q.get('operationId'),nodeId:q.get('nodeId'),jobId:q.get('jobId')})});
}catch(error){return failure(error);}}
export async function POST(request:Request,context:Context){try{
 const {taskId}=await context.params,{ref,service}=await access(request,taskId,true),body=await readNodeJson(request,18000);
 return jsonResponse({ok:true,...await service.write(ref,body)});
}catch(error){return failure(error);}}
