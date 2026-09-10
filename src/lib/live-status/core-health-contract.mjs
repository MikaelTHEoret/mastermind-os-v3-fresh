// Read-only projection of mastermind-client/service_registry.json, local-core profile.
// This list supplies public display identities; lifecycle ownership stays with supervisor.py.
export const CORE_HEALTH_SERVICES = Object.freeze([
  {id:'ollama',label:'Local models',port:11434},
  {id:'embedding_proxy',label:'Embedding bridge',port:11435},
  {id:'mem_server',label:'Semantic memory',port:8765},
  {id:'nexus_state',label:'Nexus state',port:8766},
  {id:'portal_gateway',label:'Portal',port:8767},
  {id:'module_server',label:'Module kernel',port:8770},
  {id:'orchestrator',label:'Orchestrator',port:8771},
  {id:'mcp_host',label:'MCP host',port:8772},
].map(spec=>Object.freeze(spec)));
export const DERIVED_REFRESH_SERVICE = Object.freeze({id:'derived_refresh',label:'Derived memory refresh',port:8793});
export const REFRESH_CYCLE_STATUSES = Object.freeze(['starting','running','planned','paused','partial','complete','failed']);
export const REFRESH_GATE_REASONS = Object.freeze(['AUTONOMIC_STOP','RESOURCE_CRITICAL','CHEAP_STEP_FREE_RESOURCE_FLOOR','CHAT_ACTIVE_OR_IDLE_STATE_UNAVAILABLE','IDLE_AND_WITHIN_RESOURCE_BUDGET','CHEAP_STEPS_ALLOWED_DESCRIPTOR_RESOURCE_HOLD','DESCRIPTOR_MODELS_UNAVAILABLE','RESOURCE_OR_CHAT_EVIDENCE_UNAVAILABLE']);
const STATES = new Set(['healthy','degraded','unavailable']);
const REASONS = new Set(['OK','DEPENDENCY_UNAVAILABLE','HTTP_ERROR','TIMEOUT','UNREACHABLE','INVALID_HEALTH','RESPONSE_TOO_LARGE']);
const METRICS = new Set(['models','configured','memoryRows','cachedContent','wired','pulses','modules','activeModules','pendingModules','memoryReachable','stateReachable','hostReachable','servers','failedServers','tools','runs','activeTurns']);

function parseBackgroundRefresh(row) {
  if(row === undefined || row === null) return null;
  if(row.id!==DERIVED_REFRESH_SERVICE.id || !STATES.has(row.state) || !REASONS.has(row.reason)
    || typeof row.observedAt!=='string' || !Number.isFinite(Date.parse(row.observedAt))
    || !Number.isInteger(row.latencyMs) || row.latencyMs<0 || row.latencyMs>10000) throw new Error('Invalid refresh health.');
  let cycle=null;
  if(row.cycle !== undefined && row.cycle !== null) {
    const input=row.cycle;
    if(!REFRESH_CYCLE_STATUSES.includes(input.status)
      || !(input.startedAt===null || (typeof input.startedAt==='string' && input.startedAt.length<=64 && Number.isFinite(Date.parse(input.startedAt))))
      || ![null,'apply','dry-run'].includes(input.mode)
      || !(input.rowsWritten===null || (Number.isSafeInteger(input.rowsWritten) && input.rowsWritten>=0))
      || !(input.descriptorPaused===null || typeof input.descriptorPaused==='boolean')
      || !(input.gateReason===null || REFRESH_GATE_REASONS.includes(input.gateReason))) throw new Error('Invalid refresh cycle.');
    cycle=Object.freeze({status:input.status,startedAt:input.startedAt,mode:input.mode,rowsWritten:input.rowsWritten,descriptorPaused:input.descriptorPaused,gateReason:input.gateReason});
  }
  return Object.freeze({...DERIVED_REFRESH_SERVICE,state:row.state,reason:row.reason,observedAt:row.observedAt,latencyMs:row.latencyMs,cycle});
}

export function parseCoreHealth(value) {
  if(!value || value.ok !== true || !Array.isArray(value.services) || value.services.length !== CORE_HEALTH_SERVICES.length
    || typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt))) throw new Error('Invalid core health response.');
  const services = CORE_HEALTH_SERVICES.map(spec=>{
    const matches = value.services.filter(row=>row?.id===spec.id);
    const row = matches[0];
    if(matches.length!==1 || !STATES.has(row.state) || !REASONS.has(row.reason)
      || typeof row.observedAt!=='string' || !Number.isFinite(Date.parse(row.observedAt))
      || !Number.isInteger(row.latencyMs) || row.latencyMs<0 || row.latencyMs>10000
      || !row.metrics || typeof row.metrics!=='object' || Array.isArray(row.metrics)) throw new Error('Invalid core service health.');
    const metrics = {};
    for(const [key,metric] of Object.entries(row.metrics)) {
      if(!METRICS.has(key) || !(typeof metric==='boolean' || (Number.isSafeInteger(metric) && metric>=0))) throw new Error('Invalid core health metric.');
      metrics[key] = metric;
    }
    return Object.freeze({...spec,state:row.state,reason:row.reason,observedAt:row.observedAt,latencyMs:row.latencyMs,metrics:Object.freeze(metrics)});
  });
  return Object.freeze({ok:true,observedAt:value.observedAt,services:Object.freeze(services),backgroundRefresh:parseBackgroundRefresh(value.backgroundRefresh)});
}
