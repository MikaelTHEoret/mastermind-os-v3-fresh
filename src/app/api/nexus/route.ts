import {getMemoryDb} from '@/lib/db';
import {requireOwner} from '@/lib/trading/auth';
import {authorizeOwnerRequest,errorResponse,jsonResponse} from '@/lib/node-exchange/http';
import {listOwnerNativeTasks,listOwnerNodes} from '@/lib/node-exchange/store';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 authorizeOwnerRequest(request,'/api/nexus',false);const owner=await requireOwner();
 if(!owner.ok)return jsonResponse({ok:false,error:'OWNER_REQUIRED'},owner.status);
 const sql=getMemoryDb(),[tasks,nodes]=await Promise.all([listOwnerNativeTasks(sql),listOwnerNodes(sql)]);
 return jsonResponse({ok:true,ownerKey:owner.userId,enabled:process.env.MASTERMIND_NEXUS_ENABLED==='1',tasks,nodes,executionAuthorized:false});
}catch(error){return errorResponse(error);}}
