import {CONTRIBUTION} from '../../../../../../protocol/mastermind-node-exchange/native-contribution.mjs';
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
    authorizeOwnerRequest(request,`/api/nodes/${nodeId}/native-contribution`,true);
    const owner=await requireOwner();
    if(!owner.ok)return jsonResponse({ok:false,error:{code:'OWNER_REQUIRED',message:owner.reason}},owner.status);
    if(process.env.MASTERMIND_NATIVE_CONTRIBUTIONS_ENABLED!=='true')return jsonResponse({ok:false,error:{code:'NATIVE_CONTRIBUTIONS_UNAVAILABLE',message:'Reviewed contribution import has not been enabled.'}},503);
    const input=await readNodeJson(request,2048);
    const result=await enqueueOwnerDevelopmentJob(getMemoryDb(),nodeId,input,CONTRIBUTION);
    return jsonResponse({ok:true,...result},result.status==='created'?201:200);
  } catch(error){return errorResponse(error);}
}
