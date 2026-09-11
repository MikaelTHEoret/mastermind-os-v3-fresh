import {getMemoryDb} from '@/lib/db';
import {requireOwner} from '@/lib/trading/auth';
import {authorizeOwnerRequest,jsonResponse,readNodeJson,NodeExchangeHttpError} from '@/lib/node-exchange/http';
import {LOCAL_FAMILY_OPERATOR_PROFILE} from '@/lib/memory/local-family-profile.mjs';
import {ContributionError,taskRef} from '@/lib/delegation/contract.mjs';
import {ContributionStore} from '@/lib/delegation/store.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{taskId:string}>};
async function access(request:Request,id:string,write:boolean){
 authorizeOwnerRequest(request,'/api/contributions/'+id,write);
 const owner=await requireOwner();
 if(!owner.ok)throw new ContributionError('OWNER_REQUIRED',owner.status);
 const ref=taskRef({taskId:id,project:'mastermind'});
 const sql=getMemoryDb();
 const store=new ContributionStore((query:string,params:unknown[])=>sql.query(query,params),{
  householdId:LOCAL_FAMILY_OPERATOR_PROFILE.householdId,actorPlayerId:LOCAL_FAMILY_OPERATOR_PROFILE.parentPlayerId});
 return {ref,store};
}
function failure(error:unknown){
 const known=error instanceof ContributionError||error instanceof NodeExchangeHttpError;
 return jsonResponse({ok:false,error:known?error.code:'CONTRIBUTION_UNAVAILABLE',executionAuthorized:false},known?error.status:503);
}
export async function GET(request:Request,context:Context){
 try{const {taskId}=await context.params;const {ref,store}=await access(request,taskId,false);
  return jsonResponse({ok:true,artifacts:await store.list(ref),executionAuthorized:false});
 }catch(error){return failure(error);}
}
export async function POST(request:Request,context:Context){
 try{const {taskId}=await context.params;const {store}=await access(request,taskId,true);
  const record=await readNodeJson(request,110000);
  if(!record||typeof record!=='object'||Array.isArray(record)||!('taskRef' in record))throw new ContributionError('CONTRIBUTION_INVALID');
  const ref=taskRef((record as {taskRef:unknown}).taskRef);
  if(ref.taskId!==taskId||ref.project!=='mastermind')throw new ContributionError('CONTRIBUTION_TASK_MISMATCH');
  const result=await store.save(record);
  return jsonResponse({ok:true,...result},result.status==='created'?201:200);
 }catch(error){return failure(error);}
}
