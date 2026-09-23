'use client';
import NativeContributionResult from './NativeContributionResult';
import {CONTRIBUTION} from '../../protocol/mastermind-node-exchange/native-contribution.mjs';
import NativeCodingResult from './NativeCodingResult';
import {BUILD_DISPATCH} from '../../protocol/mastermind-node-exchange/native-build-dispatch.mjs';
import NativeDevelopmentResult from './NativeDevelopmentResult';
import {DEVELOPMENT_CAPABILITIES,REVIEW_ARTIFACTS,REVIEW_BUILD_PLAN} from '../../protocol/mastermind-node-exchange/native-development-work.mjs';
import NativeReviewReuseResult,{type ReviewReuseResult} from './NativeReviewReuseResult';
import {REVIEW_REUSE,validateReviewReuseInput,disposition} from '../../protocol/mastermind-node-exchange/native-review-reuse.mjs';
import NativeReviewEditor,{type ReviewContent} from './NativeReviewEditor';
import {NATIVE_REVIEW_CAPABILITY as REVIEW,validateNativeReviewInput,encodeNativeReviewInput,encodeNativeReviewRecovery,nativeReviewContent} from '../../protocol/mastermind-node-exchange/native-review-contract.mjs';
import {useCallback,useEffect,useRef,useState} from 'react';
import NativeCapabilityInputs,{type NativeJson,type NativeSchema} from './NativeCapabilityInputs';
import {parseNodeInventory,isLocalNodeControlOrigin} from './node-control-contract.mjs';
import {CATALOG,REUSE,SPECIFICATION,executionRequest,specificationRequest,checkedRemoteJob,remoteJson,developmentRequest,codingRequest,contributionRequest} from '../lib/native-development/remote-workflow.mjs';
import {validateNativeCatalogReceipt} from '../../protocol/mastermind-node-exchange/native-catalog.mjs';

type Task={taskId:string;project:string;title:string};
type Computer={nodeId:string;displayName:string;connectivity:string;lastExchangeAt?:string|null;worker?:{capabilities:{id:string;version:number}[]}|null};
type Pending={nodeId:string;operationId:string;capability:string;body:Record<string,unknown>;taskId:string};
type Page={kind:string;taskRef:{taskId:string;project:string};snapshotId:string;nextCursor:string|null;observedAt:string;
  entry:null|{specificationId:string;candidateId:string;requirementsHash:string;capability:string;title:string;version:string;inputSchema:NativeSchema}};
const KEY='mastermind.remote-native.pending.v1';
const DRAFT_KEY=KEY+'.draft';
const REVIEW_EDIT_KEY=KEY+'.review-edit';
const terminal=(state?:string)=>['succeeded','failed','expired'].includes(state??'');
const style={padding:16,marginBottom:16,border:'1px solid #377888',borderRadius:8,color:'#eaffff',background:'#09242d',fontFamily:'system-ui,sans-serif'};
const button={padding:'8px 12px',margin:'8px 8px 0 0',background:'#164350',color:'#fff',border:'1px solid #377888',borderRadius:5};
const field={display:'block',width:'100%',boxSizing:'border-box' as const,background:'#fff',color:'#172b35',colorScheme:'light',border:'1px solid #64828e',borderRadius:5,padding:10,fontFamily:'system-ui,sans-serif',fontSize:16,lineHeight:1.5};
function Result({value,depth=0}:{value:unknown;depth?:number}) {
 if(depth>5)return <span>Further nested records are saved with the result.</span>;
 if(Array.isArray(value))return <ul>{value.slice(0,30).map((item,i)=><li key={i}><Result value={item} depth={depth+1}/></li>)}</ul>;
 if(value&&typeof value==='object')return <dl>{Object.entries(value).slice(0,40).map(([key,item])=><div key={key}><dt>{key.replace(/([a-z])([A-Z])/g,'$1 $2')}</dt><dd><Result value={item} depth={depth+1}/></dd></div>)}</dl>;
 return <span>{value===null?'None':String(value)}</span>;
}
export default function RemoteNativeWork() {
 const [local,setLocal]=useState(true),[tasks,setTasks]=useState<Task[]>([]),[nodes,setNodes]=useState<Computer[]>([]);
 const [taskId,setTaskId]=useState(''),[nodeId,setNodeId]=useState(''),[page,setPage]=useState<Page|null>(null);
 const [pending,setPending]=useState<Pending|null>(null),[job,setJob]=useState<{jobId:string;nodeId:string;state:string;createdAt:string;terminal?:{result:unknown;code:string}|null}|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[ready,setReady]=useState(false);
 const [requestText,setRequestText]=useState('');
 const [editing,setEditing]=useState(false);
 const [reviewEditing,setReviewEditing]=useState(false);
 const acting=useRef(false),alive=useRef(true),currentOperation=useRef<string|null>(null);
 const task=tasks.find(t=>t.taskId===taskId),node=nodes.find(n=>n.nodeId===nodeId);
 const supported=node?.worker?.capabilities.some(c=>c.id===CATALOG&&c.version===1);
 const wizardSupported=node?.worker?.capabilities.some(c=>c.id===SPECIFICATION&&c.version===1);
 const linkSupported=node?.worker?.capabilities.some(c=>c.id===REVIEW_REUSE&&c.version===1);
 const reviewWorkerVersion=node?.worker?.capabilities.find(c=>c.id===REVIEW)?.version??1;
 const reviewVersion=Math.min(reviewWorkerVersion,2);
 const reviewSupported=node?.worker?.capabilities.some(c=>c.id===REVIEW&&[1,2,3].includes(c.version));
 const artifactsSupported=node?.worker?.capabilities.some(c=>c.id===REVIEW_ARTIFACTS&&c.version===1);
 const buildSupported=node?.worker?.capabilities.some(c=>c.id===REVIEW_BUILD_PLAN&&c.version===1);
 const contributionSupported=node?.worker?.capabilities.some(c=>c.id===CONTRIBUTION&&c.version===1);
 const codingSupported=node?.worker?.capabilities.some(c=>c.id===BUILD_DISPATCH&&c.version===1);
 const blocked=busy||!!pending&&!terminal(job?.state);
 const savedSpecification=pending?.capability===SPECIFICATION&&job?.state==='succeeded';
 const savedRequest=savedSpecification?(pending.body.input as {request:string}).request:'';
 const savedReview=pending?.capability===REVIEW&&job?.state==='succeeded';
 function restoreDraft(saved:Pending) {
   try{const raw=localStorage.getItem(DRAFT_KEY);if(!raw||raw.length>12000)return;
     const draft=JSON.parse(raw);if(draft.operationId===saved.operationId&&typeof draft.text==='string'&&draft.text.length<=4000){setRequestText(draft.text);setEditing(true);}
   }catch{setError('The unsent revision could not be restored. The submitted request is still saved.');}
 }
 const receive=useCallback(async(envelope:unknown,saved:Pending,enqueue=false)=>{
   const checked=await checkedRemoteJob(envelope,saved,enqueue);if(!alive.current||currentOperation.current!==saved.operationId)return;
   setJob(previous=>terminal(previous?.state)&&!terminal(checked.state)?previous:checked);setError('');
   if(saved.capability===REVIEW&&checked.state==='succeeded')try{setReviewEditing(localStorage.getItem(REVIEW_EDIT_KEY)===saved.operationId);}catch{setError('The saved review is available, but its edit state could not be restored.');}
   if(checked.state==='succeeded'&&checked.terminal&&saved.capability===CATALOG){validateNativeCatalogReceipt(checked.terminal.result,saved.body.input);setPage(checked.terminal.result);}
 },[]);
 const recover=useCallback(async(saved:Pending,signal?:AbortSignal)=>{
   try{await receive(await remoteJson(`/api/nodes/${saved.nodeId}/jobs/${saved.operationId}`,{signal}),saved);}
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
       const raw=localStorage.getItem(KEY);if(raw&&raw.length<=32768){const saved=JSON.parse(raw);
         if(saved&&['nodeId','operationId','capability','body','taskId'].every(k=>Object.prototype.hasOwnProperty.call(saved,k))
           &&/^[a-f0-9-]{36}$/.test(saved.operationId)&&[CATALOG,REUSE,SPECIFICATION,REVIEW,REVIEW_REUSE,BUILD_DISPATCH,CONTRIBUTION,...DEVELOPMENT_CAPABILITIES].includes(saved.capability)
           &&computers.some((n:Computer)=>n.nodeId===saved.nodeId)&&owned.tasks.some((t:Task)=>t.taskId===saved.taskId)){
           currentOperation.current=saved.operationId;setPending(saved);setNodeId(saved.nodeId);setTaskId(saved.taskId);if(saved.capability===SPECIFICATION){setRequestText(saved.body?.input?.request??'');restoreDraft(saved);}await recover(saved,control.signal);
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
 function clearSelection(){try{localStorage.removeItem(KEY);}catch{setError('The saved request could not be cleared. Keep this task selected until browser storage is available.');return false;}currentOperation.current=null;setPending(null);setJob(null);setPage(null);setError('');setRequestText('');setEditing(false);setReviewEditing(false);return true;}
 function editRequest(value:string) {
   setRequestText(value);
   if(savedSpecification&&pending)try{localStorage.setItem(DRAFT_KEY,JSON.stringify({operationId:pending.operationId,text:value}));}
   catch{setError('This unsent revision could not be saved in this browser. Keep the page open or copy your edits.');}
 }
 async function submit(saved:Pending) {
   localStorage.setItem(KEY,JSON.stringify(saved));currentOperation.current=saved.operationId;setPending(saved);setJob(null);setEditing(false);setReviewEditing(false);
   try{const suffix=saved.capability===CONTRIBUTION?'native-contribution':saved.capability===BUILD_DISPATCH?'review-build-dispatch':saved.capability===REVIEW_ARTIFACTS?'review-artifacts':saved.capability===REVIEW_BUILD_PLAN?'review-build-plan':saved.capability===REVIEW_REUSE?'review-reuse':saved.capability===REVIEW?'native-review':saved.capability===CATALOG?'native-catalog':saved.capability===SPECIFICATION?'native-specification':'native-tasks';
     await receive(await remoteJson(`/api/nodes/${saved.nodeId}/${suffix}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(saved.body)}),saved,true);
   }catch{setError('Submission could not be confirmed. Refresh this saved request before starting another.');}
 }
 async function resumeShared(reviewOnly=false) {
   if(acting.current||!task)return;acting.current=true;setBusy(true);setError('');
   try {
     const data=await remoteJson(`/api/nodes/${nodeId}/native-history/${taskId}${reviewOnly?'/review':''}`);
     if(data.saved===null){setError('No saved native work was found for this task and computer.');return;}
     const saved=data.saved?.request;
     if(!saved||saved.nodeId!==nodeId||saved.taskId!==taskId||reviewOnly&&saved.capability!==REVIEW||![CATALOG,REUSE,SPECIFICATION,REVIEW,REVIEW_REUSE,BUILD_DISPATCH,CONTRIBUTION,...DEVELOPMENT_CAPABILITIES].includes(saved.capability))throw Error();
     const checked=await checkedRemoteJob({ok:true,job:data.saved.job},saved);
     localStorage.setItem(KEY,JSON.stringify(saved));currentOperation.current=saved.operationId;setPending(saved);setPage(null);setJob(checked);
     setEditing(false);setReviewEditing(saved.capability===REVIEW&&checked.state==='succeeded'&&localStorage.getItem(REVIEW_EDIT_KEY)===saved.operationId);if(saved.capability===SPECIFICATION){setRequestText(saved.body.input.request);restoreDraft(saved);}
     if(checked.state==='succeeded'&&checked.terminal&&saved.capability===CATALOG)setPage(checked.terminal.result);
   }catch{setJob(null);setPage(null);setError('Shared task history could not be verified.');}
   finally{acting.current=false;setBusy(false);}
 }
 async function retrySaved() {
   if(acting.current||!pending)return;acting.current=true;setBusy(true);setError('');
   try{await submit(pending);}catch{setError('The saved request could not be resubmitted.');}
   finally{acting.current=false;setBusy(false);}
 }
 async function recoverSavedReview() {
   if(acting.current||blocked||!pending||pending.capability!==REVIEW||reviewWorkerVersion!==3||!['failed','expired'].includes(job?.state??''))return;
   acting.current=true;setBusy(true);setError('');
   try {
     const operationId=crypto.randomUUID(),input=encodeNativeReviewRecovery(pending.body.input,operationId);
     await submit({...pending,operationId,body:{operationId,input}});
   }catch{setError('The saved review could not be recovered. Refresh its status before trying again.');}
   finally{acting.current=false;setBusy(false);}
 }
 async function discover(next=false) {
   if(acting.current||!task||!supported)return;acting.current=true;setBusy(true);setError('');
   try{const operationId=crypto.randomUUID();const input={schemaVersion:1,taskRef:{taskId:task.taskId,project:task.project},snapshotId:next?page?.snapshotId:null,cursor:next?page?.nextCursor:null};
     setPage(null);await submit({nodeId,operationId,capability:CATALOG,taskId,body:{operationId,input}});
   }catch{setError('The discovery request could not be saved.');}finally{acting.current=false;setBusy(false);}
 }
 async function prepareSpecification() {
   if(acting.current||!task||!wizardSupported||blocked||reviewEditing||(savedSpecification&&(!editing||requestText===savedRequest)))return;acting.current=true;setBusy(true);setError('');
   try {
     const revisionOf=savedSpecification?{operationId:pending!.operationId,requestHash:(job!.terminal!.result as {requestHash:string}).requestHash}:undefined;
     const operationId=crypto.randomUUID(),body=specificationRequest({taskId:task.taskId,project:task.project},requestText,operationId,revisionOf);
     setPage(null);await submit({nodeId,operationId,capability:SPECIFICATION,taskId,body});
   }catch{setError('This request could not be saved. Use a shorter description without leading or trailing spaces; the full request must fit the supported byte limit.');}
   finally{acting.current=false;setBusy(false);}
 }
 async function reuseReview(accept=false) {
   if(acting.current||blocked||!linkSupported||!pending||job?.state!=='succeeded')return;
   if(!accept&&pending.capability!==REVIEW||accept&&pending.capability!==REVIEW_REUSE)return;
   acting.current=true;setBusy(true);setError('');
   try {
     const result=job.terminal?.result as ReviewReuseResult;
     if(accept&&(result.action!=='assess'||result.holds?.length))throw Error();
     const prior=pending.body.input as {taskRef:unknown;specificationId:string};
     const operationId=accept?(result.existingOperationId??crypto.randomUUID()):crypto.randomUUID();
     const input=validateReviewReuseInput({schemaVersion:1,action:accept?'accept':'assess',taskRef:prior.taskRef,
       operationId,parentOperationId:pending.operationId,specificationId:prior.specificationId,reviewId:result.reviewId,
       acceptedSpecificationId:accept?result.acceptedSpecificationId:null,qualificationId:accept?result.qualificationId:null,
       decisions:accept?(result.differences??[]).map(field=>({field,disposition:disposition(field)})):[]});
     await submit({nodeId,operationId,capability:REVIEW_REUSE,taskId,body:{operationId,input}});
   }catch{setError('The reuse decision could not be saved. Keep the current request and refresh its status before retrying.');}
   finally{acting.current=false;setBusy(false);}
 }
 async function develop(kind:string,action:string) {
   if(acting.current||blocked||editing||reviewEditing||!pending||!job||!(kind===REVIEW_ARTIFACTS?artifactsSupported:buildSupported))return;
   acting.current=true;setBusy(true);setError('');
   try {await submit(developmentRequest(pending,job,kind,action));}
   catch {setError('This development step could not be saved. Refresh the current result before continuing.');}
   finally{acting.current=false;setBusy(false);}
 }
 async function contribute(action:string) {
   if(acting.current||blocked||editing||reviewEditing||!contributionSupported||!pending||!job)return;
   acting.current=true;setBusy(true);setError('');
   try {const saved=await contributionRequest(pending,job,action);
     if(!alive.current||currentOperation.current!==pending.operationId)return;
     await submit(saved);
   }
   catch {setError('This contribution step could not be saved. Refresh the original request before continuing.');}
   finally{acting.current=false;setBusy(false);}
 }
 async function code(action:string) {
   if(acting.current||blocked||editing||reviewEditing||!codingSupported||!pending||!job)return;
   acting.current=true;setBusy(true);setError('');
   try {await submit(codingRequest(pending,job,action));}
   catch {setError('This coding step could not be saved. Recover the current result before continuing.');}
   finally{acting.current=false;setBusy(false);}
 }
 async function saveReview(content:ReviewContent) {
   if(acting.current||!reviewSupported||!(savedSpecification||savedReview&&reviewEditing)||!pending||!task)return;acting.current=true;setBusy(true);setError('');
   try {const prior=pending.body.input as {taskRef:unknown;parentOperationId:string;originalRequest:string};const operationId=crypto.randomUUID();const input=(reviewVersion===2?encodeNativeReviewInput:validateNativeReviewInput)({schemaVersion:1,action:'prepare',taskRef:prior.taskRef,operationId,parentOperationId:savedReview?prior.parentOperationId:pending.operationId,specificationId:content.specificationId,originalRequest:savedReview?prior.originalRequest:savedRequest,content});
     await submit({nodeId,operationId,capability:REVIEW,taskId,body:{operationId,input}});
   } finally{acting.current=false;setBusy(false);}
 }
 async function run(capability:string,arguments_:Record<string,NativeJson>) {
   if(acting.current||!page?.entry||page.entry.capability!==capability)return;acting.current=true;setBusy(true);setError('');
   try{const operationId=crypto.randomUUID(),body=await executionRequest(page,arguments_,operationId);await submit({nodeId,operationId,capability:REUSE,taskId,body});}
   catch{setError('These inputs exceed the supported request or could not be saved. Reduce the supplied records and try again.');}
   finally{acting.current=false;setBusy(false);}
 }
 if(local)return null;
 return <section style={style}><h3>Work on a connected computer</h3>
  <p>Choose an active task and describe what you want to accomplish, or discover an accepted capability to use.</p>
  {error&&<p role="alert">{error}</p>}
  <label>Task <select style={field} disabled={blocked||editing||reviewEditing} value={taskId} onChange={e=>{if(clearSelection())setTaskId(e.target.value);}}>{tasks.map(t=><option key={t.taskId} value={t.taskId}>{t.title}</option>)}</select></label>{' '}
  <label>Computer <select style={field} disabled={blocked||editing||reviewEditing} value={nodeId} onChange={e=>{if(clearSelection())setNodeId(e.target.value);}}>{nodes.map(n=><option key={n.nodeId} value={n.nodeId}>{n.displayName} · {n.connectivity}</option>)}</select></label>
  {ready&&!supported&&<p>This computer has not enabled native capability discovery.</p>}
  {node&&<p>Computer status: {node.connectivity}{node.lastExchangeAt?` · last contact ${new Date(node.lastExchangeAt).toLocaleString()}`:' · no contact recorded'}.</p>}
  <form onSubmit={e=>{e.preventDefault();void prepareSpecification();}}>
    <h4>Ask the Wizard</h4>
    <label>What would you like to accomplish?<textarea value={requestText} disabled={blocked||reviewEditing} readOnly={!!savedSpecification&&!editing} rows={6} maxLength={4000} onChange={e=>editRequest(e.target.value)} style={field}/></label>
    <p>Describe the result and any examples or source references. The Wizard saves a specification; it does not run or activate code.</p>
    {ready&&!wizardSupported&&<p>This computer has not enabled Wizard requests yet.</p>}
    {wizardSupported&&node?.connectivity!=='online'&&<p>The computer is offline. An accepted request will wait in the queue until it reconnects or expires.</p>}
    {savedSpecification&&<><p>{editing?'Add your answers and corrections to the description above. Saving creates a linked revision; the original request remains in history.':'This is the saved description. Choose Revise saved request to add answers or corrections.'}</p>
      {!editing&&<button type="button" style={button} disabled={blocked} onClick={()=>setEditing(true)}>Revise saved request</button>}
      {editing&&<button type="button" style={button} disabled={blocked} onClick={()=>{try{localStorage.removeItem(DRAFT_KEY);setRequestText(savedRequest);setEditing(false);setError('');}catch{setError('The draft could not be cleared.');}}}>Discard unsent edits</button>}</>}
    <button style={button} disabled={blocked||reviewEditing||!ready||!task||!wizardSupported||!requestText.trim()||!!savedSpecification&&(!editing||requestText===savedRequest)}>{savedSpecification?'Save revised request':'Save Wizard request'}</button>
  </form>
  {savedSpecification&&!editing&&contributionSupported&&<button type="button" style={button} disabled={blocked} onClick={()=>void contribute('catalog')}>Find reviewed contributions</button>}
  {savedSpecification&&!editing&&reviewSupported&&<NativeReviewEditor wireVersion={reviewVersion} key={pending!.operationId} parentOperationId={pending!.operationId}
    specificationId={(job!.terminal!.result as {specification:{specificationId:string}}).specification.specificationId}
    taskRef={(pending!.body.input as {taskRef:{taskId:string;project:string}}).taskRef} request={savedRequest} disabled={blocked} onSave={saveReview}/>}
  {pending?.capability===REVIEW&&<p>This saved review is a proposal. Its receipt records the worker's review at that time; it does not authorize a build or activation.</p>}
  {savedReview&&!reviewEditing&&linkSupported&&<button type="button" style={button} disabled={blocked} onClick={()=>void reuseReview()}>Check accepted reuse evidence</button>}
  {savedReview&&!reviewEditing&&['create','extend'].includes(nativeReviewContent(pending!.body.input).mode)&&artifactsSupported&&<button type="button" style={button} disabled={blocked} onClick={()=>void develop(REVIEW_ARTIFACTS,'prepare')}>Prepare source package</button>}
  {savedReview&&!reviewEditing&&<button type="button" style={button} disabled={blocked||!reviewSupported} onClick={()=>{try{localStorage.setItem(REVIEW_EDIT_KEY,pending!.operationId);setReviewEditing(true);}catch{setError('The review draft could not be saved in this browser.');}}}>Revise review proposal</button>}
  {savedReview&&reviewEditing&&<><p>Edit a new review. The saved proposal and its result remain in history.</p>
    <NativeReviewEditor wireVersion={reviewVersion} key={'revision-'+pending!.operationId} draftId={pending!.operationId} parentOperationId={(pending!.body.input as {parentOperationId:string}).parentOperationId}
      specificationId={(pending!.body.input as {specificationId:string}).specificationId}
      initialContent={nativeReviewContent(pending!.body.input)}
      taskRef={(pending!.body.input as {taskRef:{taskId:string;project:string}}).taskRef}
      request={(pending!.body.input as {originalRequest:string}).originalRequest} disabled={blocked||!reviewSupported} onSave={saveReview}/>
    <button type="button" style={button} disabled={blocked} onClick={()=>{try{localStorage.removeItem(REVIEW_EDIT_KEY);localStorage.removeItem('mastermind.review-draft.v1.'+pending!.operationId);setReviewEditing(false);}catch{setError('The review draft could not be discarded.');}}}>Discard unsent review edits</button>
  </>}
  <div><button style={button} disabled={blocked||editing||reviewEditing||!task||!nodeId} onClick={()=>void resumeShared()}>Resume saved work</button>
    <button style={button} disabled={blocked||editing||reviewEditing||!task||!nodeId} onClick={()=>void resumeShared(true)}>Resume latest review</button>
    <button style={button} disabled={blocked||editing||reviewEditing||!task||!supported} onClick={()=>void discover()}>Find capabilities</button>
    {page?.nextCursor&&<button style={button} disabled={blocked} onClick={()=>void discover(true)}>Next capability</button>}
    {pending&&<button style={button} disabled={busy} onClick={()=>void recover(pending)}>Refresh saved status</button>}
    {pending?.capability===REVIEW&&reviewWorkerVersion===3&&['failed','expired'].includes(job?.state??'')&&(pending.body.input as {schemaVersion:number}).schemaVersion!==3&&<><p>The delivery ended before a result was received. Recovering checks for the original saved review on this computer.</p><button style={button} disabled={blocked} onClick={()=>void recoverSavedReview()}>Recover saved review</button></>}
    {pending&&error&&!job&&<button style={button} disabled={busy} onClick={()=>void retrySaved()}>Retry the same saved submission</button>}</div>
  {job&&<p role="status">{job.state==='queued'?'Queued — waiting for the computer':job.state==='running'||job.state==='leased'?'Working':job.state==='succeeded'?(pending?.capability===SPECIFICATION?'Request saved':pending?.capability===BUILD_DISPATCH?'Coding status saved':'Completed'):job.state==='expired'?'Request expired':`Held or failed: ${job.terminal?.code??'review required'}`} · submitted {new Date(job.createdAt).toLocaleString()}</p>}
  {page&&(page.entry?<><h4>{page.entry.title} · {page.entry.version}</h4><small>Verified on the computer at {new Date(page.observedAt).toLocaleString()}. Execution checks the current version and permissions again.</small>
    <NativeCapabilityInputs key={page.entry.specificationId+page.entry.capability} contracts={[{name:page.entry.capability,inputSchema:page.entry.inputSchema}]} disabled={blocked} onRun={(cap,args)=>void run(cap,args)}/></>:<p>No accepted reuse capability was found for this task.</p>)}
  {job?.state==='succeeded'&&pending?.capability===REUSE&&<Result value={(job.terminal?.result as {result?:unknown})?.result}/>}
  {job?.state==='succeeded'&&pending?.capability===SPECIFICATION&&<WizardResult value={job.terminal?.result}/>}
  {job?.state==='succeeded'&&pending&&DEVELOPMENT_CAPABILITIES.includes(pending.capability)&&<NativeDevelopmentResult value={job.terminal?.result} disabled={blocked||!artifactsSupported} buildSupported={!!buildSupported} codingSupported={!!codingSupported} onCoding={()=>void code('preflight')} onAction={(kind,action)=>void develop(kind,action)}/>}
  {job?.state==='succeeded'&&pending?.capability===CONTRIBUTION&&<NativeContributionResult value={job.terminal?.result} disabled={blocked||!contributionSupported} onAction={action=>void contribute(action)}/>}
  {pending?.capability===CONTRIBUTION&&['failed','expired'].includes(job?.state??'')&&['stage','recover'].includes((pending.body.input as {action:string}).action)&&<button type="button" style={button} disabled={blocked||!contributionSupported} onClick={()=>void contribute('recover')}>Recover saved import</button>}
  {job?.state==='succeeded'&&pending?.capability===BUILD_DISPATCH&&<NativeCodingResult value={job.terminal?.result} disabled={blocked||!codingSupported} onAction={action=>void code(action)}/>}
  {job?.state==='succeeded'&&pending?.capability===REVIEW_REUSE&&<NativeReviewReuseResult key={pending.operationId} value={job.terminal?.result as ReviewReuseResult} disabled={blocked||!linkSupported} onAccept={()=>void reuseReview(true)}/>}
  {job?.state==='succeeded'&&pending?.capability===REVIEW&&<ReviewResult input={{originalRequest:(pending.body.input as {originalRequest:string}).originalRequest,content:nativeReviewContent(pending.body.input)}} value={job.terminal?.result}/>}
 </section>;
}

function ReviewResult({input,value}:{input:{originalRequest:string;content:ReviewContent};value:unknown}) {
 const result=value as {state:string;holds:string[]};
 const explanation:Record<string,string>={SPEC_REVIEW_TASK_SNAPSHOT_CHANGED:'The task checkpoint changed after this review.',SPEC_REVIEW_ACTIVE_REVISION_CHANGED:'The active module changed after this review.',SPEC_REVIEW_ARTIFACT_MODE_UNSUPPORTED:'This proposal needs the reuse or assimilation acceptance path.'};
 return <section aria-label="Saved review proposal"><h4>{result.state==='held'?'Review saved with unresolved items':'Review proposal saved'}</h4>
  <h5>Original request</h5><p style={{whiteSpace:'pre-wrap'}}>{input.originalRequest}</p>
  <h5>Saved requirements</h5><ol>{input.content.requirements.requirements.map((text,i)=><li key={i}>{text}</li>)}</ol>
  <p>{input.content.requirements.tests.cases.length} acceptance examples retained. No candidate has been tested or activated by this review.</p>
  {result.holds.length>0&&<ul>{result.holds.map(code=><li key={code}>{explanation[code]??code.replace(/_/g,' ').toLowerCase()}</li>)}</ul>}
 </section>;
}

function WizardResult({value}:{value:unknown}) {
 const result=value as {savedAt:string;specification:{title:string;decision:string;stage:string;missingCount:number;missing?:string[]}};
 const s=result.specification;
 const decisions:Record<string,string>={reuse:'Use an existing capability',extend:'Extend an existing capability',assimilate:'Adapt supplied material',create:'Create a capability',inspect_existing:'Inspect existing capabilities'};
 return <section aria-label="Saved Wizard specification"><h4>{s.title}</h4>
   <p>{s.stage==='needs_specification'?`More specification is needed (${s.missingCount} unresolved item${s.missingCount===1?'':'s'}).`:s.stage==='reuse_available'?'An existing capability is available for review.':'Specification saved for review.'}</p>
   <p>Suggested direction: {decisions[s.decision]}.</p><p>Saved {new Date(result.savedAt).toLocaleString()}. No code execution or activation was authorised.</p>
   {s.stage==='needs_specification'&&(s.missing?<><h5>What needs clarification</h5><ol>{s.missing.map((question,i)=><li key={i}>{question}</li>)}</ol><p>Use Revise saved request to add answers. Find capabilities lets you inspect accepted behavior before deciding how to proceed. Answers remain a draft until requirements and tests are reviewed.</p></>:<p>This older saved receipt contains only the number of unresolved items. Its detailed questions are unavailable here; they have not been guessed. A revised request will ask a compatible worker for details.</p>)}
 </section>;
}
