import {getMemoryDb} from '@/lib/db';
import {authorizeOwnerRequest,errorResponse,jsonResponse,readNodeJson} from '@/lib/node-exchange/http';
import {enqueueOwnerNativeReviewJob} from '@/lib/node-exchange/store';
import {requireOwner} from '@/lib/trading/auth';

export const runtime='nodejs';
export const dynamic='force-dynamic';
type RouteContext=Readonly<{params:Promise<{nodeId:string}>}>;
export async function POST(request:Request,context:RouteContext):Promise<Response> {
  const {nodeId}=await context.params;
  try {
    authorizeOwnerRequest(request,`/api/nodes/${nodeId}/native-review`,true);
    const owner=await requireOwner();
    if(!owner.ok)return jsonResponse({ok:false,error:{code:'OWNER_REQUIRED',message:owner.reason}},owner.status);
    if(process.env.MASTERMIND_NATIVE_REVIEW_ENABLED!=='true')return jsonResponse({ok:false,error:{code:'NATIVE_REVIEW_UNAVAILABLE',message:'Structured review has not been enabled.'}},503);
    const input=await readNodeJson(request,28672);
    if(((input as {input?:{schemaVersion?:number}})?.input?.schemaVersion??0)>=2&&process.env.MASTERMIND_LOSSLESS_REVIEW_ENABLED!=='true')return jsonResponse({ok:false,error:{code:'LOSSLESS_REVIEW_UNAVAILABLE',message:'Lossless review transport has not been enabled.'}},503);
    if((input as {input?:{schemaVersion?:number}})?.input?.schemaVersion===3&&process.env.MASTERMIND_REVIEW_RECOVERY_ENABLED!=='true')return jsonResponse({ok:false,error:{code:'REVIEW_RECOVERY_UNAVAILABLE',message:'Saved review recovery has not been enabled.'}},503);
    const result=await enqueueOwnerNativeReviewJob(getMemoryDb(),nodeId,input);
    return jsonResponse({ok:true,...result},result.status==='created'?201:200);
  } catch(error){return errorResponse(error);}
}
