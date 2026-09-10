'use client';

import { useEffect,useRef,useState } from 'react';
import { isLocalNodeControlOrigin } from './node-control-contract.mjs';
import { parseCoreHealth } from '@/lib/live-status/core-health-contract.mjs';
import { createLiveStatusPoller,emptyLiveResource,liveResourceFailed,liveResourcePresentation,liveResourceSucceeded,liveStatusPollDelay } from '@/lib/live-status/live-status.mjs';

type Inventory=ReturnType<typeof parseCoreHealth>;
type Resource={value:Inventory|null;lastGoodAt:number|null;lastAttemptAt:number|null;error:string|null;errorCount:number};
const C={cyan:'#00ffff',green:'#00ffaa',gold:'#ffaa00',red:'#ff4444',dim:'rgba(220,255,255,0.58)'};
const reasons:Record<string,string>={DEPENDENCY_UNAVAILABLE:'A dependency needs attention.',HTTP_ERROR:'The health endpoint returned an error.',TIMEOUT:'The health check timed out.',UNREACHABLE:'The service could not be reached.',INVALID_HEALTH:'The health response could not be verified.',RESPONSE_TOO_LARGE:'The health response exceeded its limit.'};
const metricLabels:Record<string,string>={models:'models',configured:'configured',memoryRows:'fallback index entries',cachedContent:'cached text entries',wired:'retrieval wired',pulses:'saved pulses',modules:'modules',activeModules:'active modules',pendingModules:'pending modules',memoryReachable:'memory reachable',stateReachable:'state reachable',hostReachable:'host reachable',servers:'MCP servers',failedServers:'failed servers',tools:'tools',runs:'open runs',activeTurns:'active turns'};
const refreshGateLabels:Record<string,string>={AUTONOMIC_STOP:'Paused by the stop control.',RESOURCE_CRITICAL:'Waiting for resources.',CHEAP_STEP_FREE_RESOURCE_FLOOR:'Waiting for free memory or disk.',CHAT_ACTIVE_OR_IDLE_STATE_UNAVAILABLE:'Waiting for chat to be idle.',IDLE_AND_WITHIN_RESOURCE_BUDGET:'Within the resource budget.',CHEAP_STEPS_ALLOWED_DESCRIPTOR_RESOURCE_HOLD:'Descriptor work is waiting for resources.',DESCRIPTOR_MODELS_UNAVAILABLE:'Descriptor models are unavailable.',RESOURCE_OR_CHAT_EVIDENCE_UNAVAILABLE:'Waiting for verified resource and chat status.'};

async function readInventory(signal:AbortSignal):Promise<Inventory> {
  const response=await fetch('/api/local-control/core-health',{cache:'no-store',credentials:'same-origin',redirect:'error',signal});
  if(!response.ok || !response.body) throw new Error('Core health could not be refreshed.');
  const reader=response.body.getReader();
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,text='';
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      bytes+=value.byteLength;
      if(bytes>16384){await reader.cancel();throw new Error('Core health response exceeded its limit.');}
      text+=decoder.decode(value,{stream:true});
    }
    return parseCoreHealth(JSON.parse(text+decoder.decode()));
  } finally {reader.releaseLock();}
}

export default function CoreServiceStatus() {
  const [resource,setResource]=useState<Resource>(()=>emptyLiveResource() as Resource);
  const [now,setNow]=useState(()=>Date.now());
  const [visibility,setVisibility]=useState<DocumentVisibilityState>('visible');
  const refreshRef=useRef<(()=>void)|null>(null);
  useEffect(()=>{
    if(!isLocalNodeControlOrigin(window.location.origin)) {
      setResource(previous=>liveResourceFailed(previous,'Core health is available on the local command center only.',Date.now()) as Resource);
      return;
    }
    setVisibility(document.visibilityState);
    const poller=createLiveStatusPoller({
      run:async(signal:AbortSignal)=>{
        const controller=new AbortController();
        const abort=()=>controller.abort();
        signal.addEventListener('abort',abort,{once:true});
        const timeout=window.setTimeout(abort,7000);
        try {
          const inventory=await readInventory(controller.signal);
          if(!signal.aborted) setResource(previous=>liveResourceSucceeded(previous,inventory,Date.parse(inventory.observedAt)) as Resource);
        } catch {
          if(!signal.aborted) setResource(previous=>liveResourceFailed(previous,'Core health could not be refreshed. Last verified results are retained.',Date.now()) as Resource);
        } finally {window.clearTimeout(timeout);signal.removeEventListener('abort',abort);}
      },
      getDelay:()=>liveStatusPollDelay(document.visibilityState),
    });
    const refresh=()=>{setVisibility(document.visibilityState);poller.refresh();};
    refreshRef.current=refresh;
    const clock=window.setInterval(()=>setNow(Date.now()),1000);
    window.addEventListener('focus',refresh);window.addEventListener('online',refresh);
    document.addEventListener('visibilitychange',refresh);
    poller.start();
    return ()=>{
      refreshRef.current=null;poller.stop();window.clearInterval(clock);
      window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);
      document.removeEventListener('visibilitychange',refresh);
    };
  },[]);
  const presentation=liveResourcePresentation(resource,now,visibility);
  const stale=presentation.stale || presentation.failed;
  const services=resource.value?.services ?? [];
  const healthy=services.filter(service=>service.state==='healthy').length;
  const background=resource.value?.backgroundRefresh;
  return <section aria-labelledby="core-service-heading" style={{border:`1px solid ${C.cyan}45`,borderRadius:8,padding:14,background:'rgba(0,15,35,0.78)'}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
      <h2 id="core-service-heading" style={{color:C.cyan,fontFamily:'Orbitron, monospace',fontSize:12,margin:0}}>MASTERMIND CORE · READ ONLY</h2>
      <span role="status" style={{color:stale?C.gold:healthy===8?C.green:C.gold,fontSize:12}}>{services.length?`${healthy}/8 responding${stale?' · STALE':''}`:presentation.failed?'UNAVAILABLE':'CHECKING'}</span>
      <button type="button" onClick={()=>refreshRef.current?.()} style={{background:'transparent',color:C.cyan,border:`1px solid ${C.cyan}55`,borderRadius:5,padding:'6px 10px',cursor:'pointer'}}>Refresh core health</button>
    </div>
    <p style={{color:C.dim,fontSize:12,lineHeight:1.5}}>Memory, models and orchestration. These checks show service health; they do not verify every feature or memory freshness.</p>
    {resource.error && <p role="status" style={{color:C.gold,fontSize:12}}>{resource.error}</p>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:9}}>
      {services.map(service=>{
        const color=stale?C.gold:service.state==='healthy'?C.green:service.state==='degraded'?C.gold:C.red;
        return <article key={service.id} aria-label={service.label} style={{border:`1px solid ${color}35`,borderRadius:6,padding:10}}>
          <div style={{color:C.cyan,fontSize:13}}>{service.label}</div>
          <div style={{color,fontSize:11,marginTop:4}}>{stale?'STALE · ':''}{service.state==='healthy'?'RESPONDING':service.state==='degraded'?'NEEDS ATTENTION':'UNAVAILABLE'}</div>
          {service.reason!=='OK' && <div style={{color:C.dim,fontSize:11,marginTop:4}}>{reasons[service.reason]}</div>}
          {service.id==='mem_server' && <div style={{color:C.dim,fontSize:11,marginTop:4}}>The counts below describe the fallback snapshot.</div>}
          <div style={{color:C.dim,fontSize:11,marginTop:6}}>{Object.entries(service.metrics).map(([key,value])=>`${metricLabels[key]}: ${typeof value==='boolean'?(value?'yes':'no'):Number(value).toLocaleString()}`).join(' · ')}</div>
          <div style={{color:C.dim,fontSize:10,marginTop:6}}>Checked {new Date(service.observedAt).toLocaleTimeString()}</div>
        </article>;
      })}
    </div>
    <section aria-label="Background memory upkeep" style={{borderTop:`1px solid ${C.cyan}35`,marginTop:14,paddingTop:12}}>
      <h3 style={{color:C.cyan,fontSize:12,margin:'0 0 6px'}}>BACKGROUND · DERIVED MEMORY REFRESH</h3>
      <div role="status" style={{color:stale?C.gold:background?.state==='healthy'?C.green:C.gold,fontSize:12}}>
        {stale?'STALE · ':''}{!background?'NOT YET CHECKED':background.state==='unavailable'?'INACTIVE OR UNREACHABLE':background.state==='degraded'?'NEEDS ATTENTION':'WORKER RESPONDING'}
      </div>
      <p style={{color:C.dim,fontSize:11,margin:'6px 0'}}>Optional upkeep is separate from the eight core services. This is the worker’s cached last-cycle report.</p>
      {background?.cycle && <div style={{color:C.dim,fontSize:11,lineHeight:1.6}}>
        <div>Last cycle: {background.cycle.status.toUpperCase()}{background.cycle.mode==='dry-run'?' · PREVIEW':''}{background.cycle.rowsWritten!==null?` · ${background.cycle.rowsWritten.toLocaleString()} rows updated`:''}</div>
        {background.cycle.gateReason && <div>{refreshGateLabels[background.cycle.gateReason]}</div>}
        {background.cycle.descriptorPaused && <div>Descriptor work paused.</div>}
        {background.cycle.startedAt && <div>Cycle started {new Date(background.cycle.startedAt).toLocaleString()}</div>}
      </div>}
      {background && <div style={{color:C.dim,fontSize:10,marginTop:6}}>Checked {new Date(background.observedAt).toLocaleTimeString()}</div>}
    </section>
  </section>;
}
