import { CORE_HEALTH_SERVICES, DERIVED_REFRESH_SERVICE, REFRESH_CYCLE_STATUSES, REFRESH_GATE_REASONS, parseCoreHealth } from './core-health-contract.mjs';

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 2500;
const count = value=>Number.isSafeInteger(value) && value>=0 ? value : undefined;
const size = value=>Array.isArray(value) ? value.length : undefined;
function invalid(code='INVALID_HEALTH'){const error=new Error(code);error.code=code;return error;}

async function boundedJson(response) {
  const declared = response.headers.get('content-length');
  if(declared!==null && (!/^\d+$/.test(declared) || Number(declared)>MAX_BYTES)) {
    await response.body?.cancel(); throw invalid('RESPONSE_TOO_LARGE');
  }
  if(!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) throw invalid();
  const reader = response.body.getReader();
  let total=0, text='';
  const decoder = new TextDecoder('utf-8',{fatal:true});
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      total+=value.byteLength;
      if(total>MAX_BYTES){await reader.cancel();throw invalid('RESPONSE_TOO_LARGE');}
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
    return JSON.parse(text);
  } catch(error){if(error.code==='RESPONSE_TOO_LARGE') throw error;throw invalid();}
  finally {reader.releaseLock();}
}

function publicHealth(spec,data) {
  if(!data || typeof data!=='object' || Array.isArray(data)) throw invalid();
  if(spec.id==='ollama') {
    if(!Array.isArray(data.models)) throw invalid();
    return {metrics:{models:data.models.length},degraded:data.models.length===0};
  }
  if(data.ok!==true) throw invalid();
  if(spec.id==='derived_refresh') {
    if(data.service!=='derived_refresh' || !data.lastCycle || !REFRESH_CYCLE_STATUSES.includes(data.lastCycle.status)) throw invalid();
    const report=data.lastCycle;
    const timestamp=report.startedAt ?? report.observedAt;
    const layers=['bloom_paths','core_affinity','intent_quality_act_descriptors'].map(key=>report.layers?.[key]).filter(Boolean);
    const writes=layers.map(layer=>count(layer.written));
    const descriptor=report.layers?.intent_quality_act_descriptors;
    return {metrics:{},degraded:report.status==='failed',cycle:{
      status:report.status,
      startedAt:typeof timestamp==='string' && timestamp.length<=64 && Number.isFinite(Date.parse(timestamp))?timestamp:null,
      mode:['apply','dry-run'].includes(report.mode)?report.mode:null,
      rowsWritten:layers.length && writes.every(value=>value!==undefined)?count(writes.reduce((sum,value)=>sum+value,0)) ?? null:null,
      descriptorPaused:descriptor?descriptor.status==='paused':null,
      gateReason:REFRESH_GATE_REASONS.includes(report.resourceGate?.reason)?report.resourceGate.reason:null,
    }};
  }
  let metrics={},degraded=false,unavailable=false;
  switch(spec.id) {
    case 'embedding_proxy': metrics={configured:data.configured===true};degraded=data.configured!==true;break;
    case 'mem_server':
      metrics={memoryRows:count(data.count),cachedContent:count(data.content_cache),wired:data.wired===true};
      degraded=data.wired!==true || data.degraded===true;
      unavailable=data.ready===false;
      break;
    case 'nexus_state': metrics={pulses:count(data.pulses)};break;
    case 'portal_gateway':
      metrics={memoryReachable:data.downstream?.mem_server===true,stateReachable:data.downstream?.nexus_state===true,hostReachable:data.downstream?.mcp_host===true};
      degraded=Object.values(metrics).some(value=>!value);break;
    case 'module_server': metrics={modules:count(data.modules),activeModules:size(data.live),pendingModules:size(data.pending_gate)};break;
    case 'mcp_host':
      metrics={servers:size(data.servers_up),failedServers:data.failed && typeof data.failed==='object'?Object.keys(data.failed).length:0,tools:count(data.tools),runs:count(data.runs),activeTurns:count(data.activeTurns)};
      degraded=(metrics.servers ?? 0)===0 || metrics.failedServers>0;break;
  }
  return {metrics:Object.fromEntries(Object.entries(metrics).filter(([,value])=>value!==undefined)),degraded,unavailable};
}

export async function readCoreHealth({fetcher=fetch,timeoutMs=TIMEOUT_MS}={}) {
  if(!Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>TIMEOUT_MS) throw new Error('Invalid health timeout.');
  const probes=await Promise.all([...CORE_HEALTH_SERVICES,DERIVED_REFRESH_SERVICE].map(async spec=>{
    const started=Date.now();
    const controller=new AbortController();
    let timer;
    try {
      const result=await Promise.race([
        (async()=>{
          // The caller cannot supply a host, port, path, redirect, or request body.
          const path=spec.id==='ollama'?'/api/tags':'/health';
          const response=await fetcher(`http://127.0.0.1:${spec.port}${path}`,{method:'GET',cache:'no-store',redirect:'error',signal:controller.signal});
          if(!response.ok){await response.body?.cancel();throw invalid('HTTP_ERROR');}
          return publicHealth(spec,await boundedJson(response));
        })(),
        new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(invalid('TIMEOUT'));},timeoutMs);}),
      ]);
      return {...spec,state:result.unavailable?'unavailable':result.degraded?'degraded':'healthy',reason:result.unavailable || result.degraded?'DEPENDENCY_UNAVAILABLE':'OK',metrics:result.metrics,...(result.cycle?{cycle:result.cycle}:{}),observedAt:new Date().toISOString(),latencyMs:Math.min(10000,Date.now()-started)};
    } catch(error) {
      const reason=['HTTP_ERROR','TIMEOUT','INVALID_HEALTH','RESPONSE_TOO_LARGE'].includes(error.code)?error.code:'UNREACHABLE';
      return {...spec,state:'unavailable',reason,metrics:{},observedAt:new Date().toISOString(),latencyMs:Math.min(10000,Date.now()-started)};
    } finally {clearTimeout(timer);controller.abort();}
  }));
  return parseCoreHealth({ok:true,observedAt:new Date().toISOString(),services:probes.slice(0,CORE_HEALTH_SERVICES.length),backgroundRefresh:probes[CORE_HEALTH_SERVICES.length]});
}

let cached=null, pending=null;
export async function cachedCoreHealth() {
  if(cached && Date.now()-Date.parse(cached.observedAt)<2000) return cached;
  if(!pending) pending=readCoreHealth().then(value=>{cached=value;return value;}).finally(()=>{pending=null;});
  return pending;
}
