'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import NativeCapabilityInputs,{type NativeJson,type NativeSchema} from './NativeCapabilityInputs';
import {parseNodeInventory,isLocalNodeControlOrigin} from './node-control-contract.mjs';
import {CATALOG,REUSE,executionRequest,checkedJob,remoteJson} from '../lib/native-development/remote-workflow.mjs';
import {validateNativeCatalogReceipt} from '../../protocol/mastermind-node-exchange/native-catalog.mjs';

type Task={taskId:string;project:string;title:string};
type Computer={nodeId:string;displayName:string;connectivity:string;worker?:{capabilities:{id:string;version:number}[]}|null};
type Pending={nodeId:string;operationId:string;capability:string;body:Record<string,unknown>;taskId:string};
type Page={kind:string;taskRef:{taskId:string;project:string};snapshotId:string;nextCursor:string|null;observedAt:string;
  entry:null|{specificationId:string;candidateId:string;requirementsHash:string;capability:string;title:string;version:string;inputSchema:NativeSchema}};
const KEY='mastermind.remote-native.pending.v1';
const terminal=(state?:string)=>['succeeded','failed','expired'].includes(state??'');
const style={padding:16,marginBottom:16,border:'1px solid #377888',borderRadius:8,color:'#eaffff',background:'#09242d',fontFamily:'system-ui,sans-serif'};
const button={padding:'8px 12px',margin:'8px 8px 0 0',background:'#164350',color:'#fff',border:'1px solid #377888',borderRadius:5};
function Result({value,depth=0}:{value:unknown;depth?:number}) {
 if(depth>5)return <span>Further nested records are saved with the result.</span>;
 if(Array.isArray(value))return <ul>{value.slice(0,30).map((item,i)=><li key={i}><Result value={item} depth={depth+1}/></li>)}</ul>;
 if(value&&typeof value==='object')return <dl>{Object.entries(value).slice(0,40).map(([key,item])=><div key={key}><dt>{key.replace(/([a-z])([A-Z])/g,'$1 $2')}</dt><dd><Result value={item} depth={depth+1}/></dd></div>)}</dl>;
 return <span>{value===null?'None':String(value)}</span>;
}
export default function RemoteNativeWork() {
 const [local,setLocal]=useState(true),[tasks,setTasks]=useState<Task[]>([]),[nodes,setNodes]=useState<Computer[]>([]);
 const [taskId,setTaskId]=useState(''),[nodeId,setNodeId]=useState(''),[page,setPage]=useState<Page|null>(null);
 const [pending,setPending]=useState<Pending|null>(null),[job,setJob]=useState<{state:string;createdAt:string;terminal?:{result:unknown;code:string}|null}|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[ready,setReady]=useState(false);
 const acting=useRef(false),alive=useRef(true),currentOperation=useRef<string|null>(null);
 const task=tasks.find(t=>t.taskId===taskId),node=nodes.find(n=>n.nodeId===nodeId);
 const supported=node?.worker?.capabilities.some(c=>c.id===CATALOG&&c.version===1);
 const blocked=busy||!!pending&&!terminal(job?.state);
 const receive=useCallback((envelope:unknown,saved:Pending,enqueue=false)=>{
   const checked=checkedJob(envelope,saved,enqueue);if(!alive.current||currentOperation.current!==saved.operationId)return;
   setJob(previous=>terminal(previous?.state)&&!terminal(checked.state)?previous:checked);setError('');
   if(checked.state==='succeeded'&&checked.terminal&&saved.capability===CATALOG){validateNativeCatalogReceipt(checked.terminal.result,saved.body.input);setPage(checked.terminal.result);}
 },[]);
 const recover=useCallback(async(saved:Pending,signal?:AbortSignal)=>{
   try{receive(await remoteJson(`/api/nodes/${saved.nodeId}/jobs/${saved.operationId}`,{signal}),saved);}
   catch{if(alive.current&&!signal?.aborted&&currentOperation.current===saved.operationId){setJob(null);setPage(null);setError('The saved status is unavailable. Keep this request and try refreshing; it has not been started again.');}}
 },[receive]);
 useEffect(()=>{
   alive.current=true;const control=new AbortController();
   const isLocal=isLocalNodeControlOrigin(location.origin);setLocal(isLocal);
   if(!isLocal)void (async()=>{
     try{
       const [inventory,owned]=await Promise.all([remoteJson('/api/nodes',{signal:control.signal}),remoteJson('/api/native/tasks',{signal:control.signal})]);
       const computers=parseNodeInventory(inventory).nodes;
       if(!Array.isArray(owned.tasks)||owned.tasks.length>32||owned.tasks.some((t:Task)=>!t||typeof t.taskId!=='string'||typeof t.title!=='string'||typeof t.project!=='string'))throw Error();
       if(!alive.current)return;
       setTasks(owned.tasks);setNodes(computers);setTaskId(owned.tasks[0]?.taskId??'');setNodeId(computers[0]?.nodeId??'');setReady(true);
       const raw=localStorage.getItem(KEY);if(raw&&raw.length<=8192){const saved=JSON.parse(raw);
         if(saved&&['nodeId','operationId','capability','body','taskId'].every(k=>Object.prototype.hasOwnProperty.call(saved,k))
           &&/^[a-f0-9-]{36}$/.test(saved.operationId)&&[CATALOG,REUSE].includes(saved.capability)
           &&computers.some((n:Computer)=>n.nodeId===saved.nodeId)&&owned.tasks.some((t:Task)=>t.taskId===saved.taskId)){
           currentOperation.current=saved.operationId;setPending(saved);setNodeId(saved.nodeId);setTaskId(saved.taskId);await recover(saved,control.signal);
         }
       }
     }catch{if(alive.current&&!control.signal.aborted)setError('Remote native work is not available yet. The computer, task permissions or hosted setup could not be verified.');}
   })();
   return()=>{alive.current=false;control.abort();};
 },[recover]);
 useEffect(()=>{
   if(!pending||terminal(job?.state)||!ready)return;
   const control=new AbortController();let timer:ReturnType<typeof setTimeout>;
   const poll=async()=>{await recover(pending,control.signal);if(!control.signal.aborted)timer=setTimeout(poll,5000);};
   timer=setTimeout(poll,5000);return()=>{control.abort();clearTimeout(timer);};
 },[pending,job?.state,ready,recover]);
 function clearSelection(){currentOperation.current=null;setPending(null);setJob(null);setPage(null);setError('');}
 async function submit(saved:Pending) {
   localStorage.setItem(KEY,JSON.stringify(saved));currentOperation.current=saved.operationId;setPending(saved);setJob(null);
   try{const suffix=saved.capability===CATALOG?'native-catalog':'native-tasks';
     receive(await remoteJson(`/api/nodes/${saved.nodeId}/${suffix}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(saved.body)}),saved,true);
   }catch{setError('Submission could not be confirmed. Refresh this saved request before starting another.');}
 }
 async function resumeShared() {
   if(acting.current||!task)return;acting.current=true;setBusy(true);setError('');
   try {
     const data=await remoteJson(`/api/nodes/${nodeId}/native-history/${taskId}`);
     if(data.saved===null){setError('No saved native work was found for this task and computer.');return;}
     const saved=data.saved?.request;
     if(!saved||saved.nodeId!==nodeId||saved.taskId!==taskId||![CATALOG,REUSE].includes(saved.capability))throw Error();
     const checked=checkedJob({ok:true,job:data.saved.job},saved);
     localStorage.setItem(KEY,JSON.stringify(saved));currentOperation.current=saved.operationId;setPending(saved);setPage(null);setJob(checked);
     if(checked.state==='succeeded'&&checked.terminal&&saved.capability===CATALOG)setPage(checked.terminal.result);
   }catch{setJob(null);setPage(null);setError('Shared task history could not be verified.');}
   finally{acting.current=false;setBusy(false);}
 }
 async function retrySaved() {
   if(acting.current||!pending)return;acting.current=true;setBusy(true);setError('');
   try{await submit(pending);}catch{setError('The saved request could not be resubmitted.');}
   finally{acting.current=false;setBusy(false);}
 }
 async function discover(next=false) {
   if(acting.current||!task||!supported)return;acting.current=true;setBusy(true);setError('');
   try{const operationId=crypto.randomUUID();const input={schemaVersion:1,taskRef:{taskId:task.taskId,project:task.project},snapshotId:next?page?.snapshotId:null,cursor:next?page?.nextCursor:null};
     setPage(null);await submit({nodeId,operationId,capability:CATALOG,taskId,body:{operationId,input}});
   }catch{setError('The discovery request could not be saved.');}finally{acting.current=false;setBusy(false);}
 }
 async function run(capability:string,arguments_:Record<string,NativeJson>) {
   if(acting.current||!page?.entry||page.entry.capability!==capability)return;acting.current=true;setBusy(true);setError('');
   try{const operationId=crypto.randomUUID(),body=await executionRequest(page,arguments_,operationId);await submit({nodeId,operationId,capability:REUSE,taskId,body});}
   catch{setError('These inputs exceed the supported request or could not be saved. Reduce the supplied records and try again.');}
   finally{acting.current=false;setBusy(false);}
 }
 if(local)return null;
 return <section style={style}><h3>Work on a connected computer</h3>
  <p>Choose an active task, discover an accepted capability, then run it with your inputs.</p>
  {error&&<p role="alert">{error}</p>}
  <label>Task <select disabled={blocked} value={taskId} onChange={e=>{setTaskId(e.target.value);clearSelection();}}>{tasks.map(t=><option key={t.taskId} value={t.taskId}>{t.title}</option>)}</select></label>{' '}
  <label>Computer <select disabled={blocked} value={nodeId} onChange={e=>{setNodeId(e.target.value);clearSelection();}}>{nodes.map(n=><option key={n.nodeId} value={n.nodeId}>{n.displayName} · {n.connectivity}</option>)}</select></label>
  {ready&&!supported&&<p>This computer has not enabled native capability discovery.</p>}
  <div><button style={button} disabled={busy||!task||!nodeId} onClick={()=>void resumeShared()}>Resume saved work</button>
    <button style={button} disabled={blocked||!task||!supported} onClick={()=>void discover()}>Find capabilities</button>
    {page?.nextCursor&&<button style={button} disabled={blocked} onClick={()=>void discover(true)}>Next capability</button>}
    {pending&&<button style={button} disabled={busy} onClick={()=>void recover(pending)}>Refresh saved status</button>}
    {pending&&error&&!job&&<button style={button} disabled={busy} onClick={()=>void retrySaved()}>Retry the same saved submission</button>}</div>
  {job&&<p role="status">{job.state==='queued'?'Queued — waiting for the computer':job.state==='running'||job.state==='leased'?'Working':job.state==='succeeded'?'Completed':job.state==='expired'?'Request expired':`Held or failed: ${job.terminal?.code??'review required'}`} · submitted {new Date(job.createdAt).toLocaleString()}</p>}
  {page&&(page.entry?<><h4>{page.entry.title} · {page.entry.version}</h4><small>Verified on the computer at {new Date(page.observedAt).toLocaleString()}. Execution checks the current version and permissions again.</small>
    <NativeCapabilityInputs key={page.entry.specificationId+page.entry.capability} contracts={[{name:page.entry.capability,inputSchema:page.entry.inputSchema}]} disabled={blocked} onRun={(cap,args)=>void run(cap,args)}/></>:<p>No accepted reuse capability was found for this task.</p>)}
  {job?.state==='succeeded'&&pending?.capability===REUSE&&<Result value={(job.terminal?.result as {result?:unknown})?.result}/>}
 </section>;
}
