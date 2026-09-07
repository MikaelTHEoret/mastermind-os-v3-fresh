// The existing Module Core bridge: local reads and explicit operator actions only.
import { NextResponse } from 'next/server';
import { chatAccessError } from '../chat/_boundary';
import { LocalServiceRequestBodyError,readBoundedJsonRequestBody } from '@/lib/memory/local-service-auth';

export const dynamic='force-dynamic';
const ROUTES:Record<string,string>={call:'/call',assimilate:'/assimilate',generate:'/generate',build_node:'/build_node',approve:'/approve',dismiss:'/dismiss',reload:'/reload',discover:'/discover',integrate_file:'/integrate_file',specification:'/specification',specification_stage:'/specification_stage',candidate_preflight:'/candidate_preflight',candidate_test:'/candidate_test',candidate_promote:'/candidate_promote',candidate_rollback:'/candidate_rollback',publish_build_events:'/publish_build_events'};
const MODULE_ID=/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const DIGEST=/^[a-f0-9]{64}$/;
ROUTES.specification_reuse='/specification_reuse';
ROUTES.specification_reuse_result='/specification_reuse_result';

function nativeRead(query:URLSearchParams):string|null {
  const action=query.get('action');
  if(!action)return null;
  const routes:Record<string,{path:string;fields:Record<string,RegExp>}>= {
    wizard_catalog:{path:'/wizard_catalog',fields:{}},specifications:{path:'/specifications',fields:{}},
    specification:{path:'/specification',fields:{specificationId:DIGEST}},
    proposal:{path:'/proposal',fields:{id:MODULE_ID}},candidates:{path:'/candidates',fields:{id:MODULE_ID}},
    candidate:{path:'/candidate',fields:{id:MODULE_ID,candidateId:DIGEST}},
    build_events:{path:'/build_events',fields:{id:MODULE_ID}},
  };
  if(!Object.prototype.hasOwnProperty.call(routes,action))throw new Error('Unknown read action');
  const route=routes[action],parameters=new URLSearchParams();
  if(query.size!==1+Object.keys(route.fields).length || query.getAll('action').length!==1)throw new Error('Unexpected read parameters');
  for(const [name,pattern] of Object.entries(route.fields)) {
    const value=query.get(name);
    if(!value || query.getAll(name).length!==1 || !pattern.test(value))throw new Error('Invalid read parameter');
    parameters.set(name,value);
  }
  return route.path+(parameters.size?'?'+parameters.toString():'');
}

function kernelUrl() {
  const url=new URL(process.env.MODULE_CORE_URL || 'http://127.0.0.1:8770');
  if(url.protocol!=='http:' || !['127.0.0.1','localhost'].includes(url.hostname) || url.port!=='8770' || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw new Error('Invalid local module kernel configuration');
  return url.origin;
}

async function kernel(path:string,body?:object) {
  const response=await fetch(`${kernelUrl()}${path}`,{
    ...(body===undefined?{method:'GET'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),
    cache:'no-store',redirect:'error',signal:AbortSignal.timeout(body===undefined?10000:600000),
  });
  if(!response.body) throw new Error('Empty module response');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,text='';
  try {
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
      if(bytes>1024*1024){await reader.cancel();throw new Error('Module response too large');}
      text+=decoder.decode(value,{stream:true});}
    return {status:response.status,ok:response.ok,data:JSON.parse(text+decoder.decode())};
  } finally {reader.releaseLock();}
}

export async function GET(request:Request) {
  const denied=await chatAccessError(request);if(denied)return denied;
  try {
    const query=new URL(request.url).searchParams;
    let readPath:string|null;
    try {readPath=nativeRead(query);} catch {return NextResponse.json({ok:false,error:'Invalid module read request.'},{status:400});}
    if(readPath) {
      const result=await kernel(readPath);
      return NextResponse.json(result.data,{status:result.status});
    }
    if(query.size) return NextResponse.json({ok:false,error:'Unknown module read request.'},{status:400});
    const [modules,status,nodes]=await Promise.all([kernel('/modules'),kernel('/status'),kernel('/nodes').catch(()=>({ok:false,status:502,data:{}}))]);
    if(!modules.ok || !status.ok || !Array.isArray(modules.data.modules) || typeof status.data.modules!=='number') throw new Error('Invalid kernel inventory');
    return NextResponse.json({ok:true,modules:modules.data.modules,status:status.data,nodes:nodes.ok && Array.isArray(nodes.data.nodes)?nodes.data.nodes:[],warnings:nodes.ok?[]:['Node blueprints could not be refreshed.']});
  } catch {
    return NextResponse.json({ok:false,error:'The module kernel could not return a verified response.',modules:[],status:null,nodes:[]},{status:502});
  }
}

export async function POST(request:Request) {
  const denied=await chatAccessError(request);if(denied)return denied;
  let body:Record<string,unknown>;
  try {
    body=JSON.parse(await readBoundedJsonRequestBody(request,{maxBytes:128*1024}));
    if(!body || typeof body!=='object' || Array.isArray(body)) throw new Error('Invalid object');
  } catch(error) {
    return NextResponse.json({ok:false,error:'Invalid or oversized module request.'},{status:error instanceof LocalServiceRequestBodyError?error.status:400});
  }
  const {action,...rest}=body;
  if(typeof action!=='string' || !Object.prototype.hasOwnProperty.call(ROUTES,action)) return NextResponse.json({ok:false,error:'Unknown module action.'},{status:400});
  try {
    const result=await kernel(ROUTES[action],rest);
    return NextResponse.json(result.data,{status:result.status});
  } catch {
    return NextResponse.json({ok:false,error:'The module result could not be confirmed. This request was not automatically retried.'},{status:502});
  }
}

