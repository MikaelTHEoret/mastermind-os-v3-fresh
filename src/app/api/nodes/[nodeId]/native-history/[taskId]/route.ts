import {getMemoryDb} from '@/lib/db';
import {authorizeOwnerRequest,errorResponse,jsonResponse} from '@/lib/node-exchange/http';
import {getLatestOwnerNativeJob} from '@/lib/node-exchange/store';
import {requireOwner} from '@/lib/trading/auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{nodeId:string;taskId:string}>}) {
 const {nodeId,taskId}=await context.params;
 try {
  authorizeOwnerRequest(request,`/api/nodes/${nodeId}/native-history/${taskId}`,false);
  const owner=await requireOwner();
  if(!owner.ok)return jsonResponse({ok:false,error:{code:'OWNER_REQUIRED',message:owner.reason}},owner.status);
  return jsonResponse({ok:true,saved:await getLatestOwnerNativeJob(getMemoryDb(),nodeId,taskId)});
 }catch(error){return errorResponse(error);}
}
