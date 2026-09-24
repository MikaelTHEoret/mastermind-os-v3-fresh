import {LIFECYCLE} from '../../../../../../protocol/mastermind-node-exchange/native-contribution-lifecycle.mjs';
import {getMemoryDb} from '@/lib/db';
import {authorizeOwnerRequest,errorResponse,jsonResponse,readNodeJson} from '@/lib/node-exchange/http';
import {enqueueOwnerDevelopmentJob} from '@/lib/node-exchange/store';
import {requireOwner} from '@/lib/trading/auth';

export const runtime='nodejs';
export const dynamic='force-dynamic';
type RouteContext=Readonly<{params:Promise<{nodeId:string}>}>;

export async function POST(request:Request,context:RouteContext):Promise<Response> {
  const {nodeId}=await context.params;
  try {
    authorizeOwnerRequest(request,`/api/nodes/${nodeId}/native-lifecycle`,true);
    const owner=await requireOwner();
    if(!owner.ok)return jsonResponse({ok:false,error:{code:'OWNER_REQUIRED',message:owner.reason}},owner.status);
    if(process.env.MASTERMIND_NATIVE_LIFECYCLE_ENABLED!=='true')return jsonResponse({ok:false,error:{code:'NATIVE_LIFECYCLE_UNAVAILABLE',message:'Candidate lifecycle controls have not been enabled.'}},503);
    const input=await readNodeJson(request,2048);
    const result=await enqueueOwnerDevelopmentJob(getMemoryDb(),nodeId,input,LIFECYCLE);
    return jsonResponse({ok:true,...result},result.status==='created'?201:200);
  } catch(error){return errorResponse(error);}
}
