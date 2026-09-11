'use client';
import {useEffect,useRef,useState} from 'react';
import {assignmentPrompt,validateRecord} from '../lib/delegation/contract.mjs';
import {contributionJson as read,checkedArtifact,checkedAcknowledgement,checkedTasks} from '../lib/delegation/browser-workflow.mjs';
type Task={taskId:string;project:string;title:string};
type RecordData={schemaVersion:number;kind:string;operationId:string;taskRef:{taskId:string;project:string};[key:string]:any};
type Artifact={artifactId:string;record:RecordData;recordedAt:string};
const KEY='mastermind-contribution-pending-v1';
const labels:Record<string,string>={chatgpt:'ChatGPT',grok:'Grok',zai:'GLM / Z.ai',other:'Another contributor'};
const field={display:'block',width:'100%',background:'#0c2330',color:'#e4f1f4',border:'1px solid #487481',borderRadius:5,padding:8,marginTop:5,boxSizing:'border-box' as const};
const button={background:'#153f4c',color:'#e4f1f4',border:'1px solid #548c98',borderRadius:5,padding:'8px 12px',cursor:'pointer',marginRight:8,marginTop:8};
export default function ExternalContributions(){
 const [tasks,setTasks]=useState<Task[]>([]),[taskId,setTaskId]=useState(''),[rows,setRows]=useState<Artifact[]>([]);
 const [title,setTitle]=useState(''),[request,setRequest]=useState(''),[context,setContext]=useState(''),[sources,setSources]=useState(''),[criteria,setCriteria]=useState('');
 const [provider,setProvider]=useState('chatgpt'),[model,setModel]=useState(''),[url,setUrl]=useState(''),[response,setResponse]=useState('');
 const [assignmentId,setAssignmentId]=useState(''),[reviewId,setReviewId]=useState(''),[assessment,setAssessment]=useState(''),[evidence,setEvidence]=useState(''),[decision,setDecision]=useState('needs-revision');
 const [pending,setPending]=useState<RecordData|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loaded,setLoaded]=useState(false);
 const acting=useRef(false),selected=useRef(''),alive=useRef(true),generation=useRef(0);
 const assignments=rows.filter(x=>x.record.kind==='assignment');
 const assignment=assignments.find(x=>x.artifactId===assignmentId);
 const chosenProvider=assignment?.record.providers.includes(provider)?provider:assignment?.record.providers[0]??provider;
 const responses=rows.filter(x=>x.record.kind==='response'&&x.record.parentId===assignmentId);
 async function refresh(id:string){
  const ticket=++generation.current;setLoaded(false);setRows([]);
  try{const body=await read('/api/contributions/'+id);
   if(!Array.isArray(body.artifacts)||body.artifacts.length>64)throw Error('Invalid contribution history.');
   if(body.executionAuthorized!==false)throw Error('Invalid history authority.');
   for(const row of body.artifacts)await checkedArtifact(row,{taskId:id,project:'mastermind'});
   if(alive.current&&selected.current===id&&ticket===generation.current){setRows(body.artifacts);setLoaded(true);setError('');}
  }catch(e){if(alive.current&&selected.current===id&&ticket===generation.current)setError(e instanceof Error?e.message:'History unavailable.');}
 }
 useEffect(()=>{
  alive.current=true;
  void (async()=>{try{
   const body=await read('/api/native/tasks');
   const owned=checkedTasks(body.tasks);if(!alive.current)return;setTasks(owned);
   let saved:RecordData|null=null;const raw=localStorage.getItem(KEY);
   if(raw){if(raw.length>110000)throw Error('Saved submission is too large.');saved=validateRecord(JSON.parse(raw));setPending(saved);}
   const id=saved?.taskRef.taskId??owned[0]?.taskId??'';
   if(alive.current){selected.current=id;setTaskId(id);if(id)await refresh(id);}
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Unable to resume.');}})();
  return ()=>{alive.current=false;generation.current++;};
 },[]);
 function choose(id:string){selected.current=id;setTaskId(id);setAssignmentId('');setReviewId('');setResponse('');setError('');void refresh(id);}
 async function submit(record:RecordData){
  if(acting.current)return;acting.current=true;setBusy(true);setError('');setNotice('');
  let retained=false;
  try{
   validateRecord(record);localStorage.setItem(KEY,JSON.stringify(record));setPending(record);retained=true;
   const body=await read('/api/contributions/'+record.taskRef.taskId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record)});
   await checkedAcknowledgement(body,record);
   localStorage.removeItem(KEY);setPending(null);setNotice('Saved to the shared task. External material remains advisory.');
   if(selected.current===record.taskRef.taskId){await refresh(record.taskRef.taskId);if(record.kind==='assignment')setAssignmentId(body.artifact.artifactId);}
  }catch(e){setError((e instanceof Error?e.message:'Save unconfirmed.')+(retained?' The same submission is retained for reconciliation; no automatic retry was sent.':' No request was sent.'));}
  finally{acting.current=false;if(alive.current)setBusy(false);}
 }
 function base(kind:string):RecordData{return {schemaVersion:1,kind,operationId:crypto.randomUUID(),taskRef:{taskId,project:'mastermind'}};}
 const blocked=busy||!!pending||!loaded;
 const lines=(value:string)=>value.split('\n').map(x=>x.trim()).filter(Boolean);
 async function copyPrompt(){
  try{if(!assignment)return;await navigator.clipboard.writeText(assignmentPrompt(assignment,chosenProvider));setNotice('Assignment copied. Review the selected material, then paste it into the chosen chatbot.');}catch{setError('Clipboard unavailable. Open the assignment text below and copy it manually.');}
 }
 return <section aria-label="External contributors" style={{background:'#091c28',border:'1px solid #356b79',borderRadius:10,padding:20,marginTop:20,color:'#e4f1f4',fontFamily:'system-ui,sans-serif'}}>
  <h2 style={{marginTop:0}}>Work with external models</h2>
  <p>Prepare a bounded assignment, collect original responses, then review them. This first connection uses copy and paste; it does not send messages or run returned code.</p>
  {error&&<p role="alert" style={{color:'#ffb6aa'}}>{error}</p>}{notice&&<p role="status" style={{color:'#a8e9c8'}}>{notice}</p>}
  <label>Shared task<select style={field} value={taskId} disabled={busy||!!pending} onChange={e=>choose(e.target.value)}><option value="">Choose a task</option>{tasks.map(t=><option key={t.taskId} value={t.taskId}>{t.title}</option>)}</select></label>
  <button style={button} disabled={busy||!taskId} onClick={()=>void refresh(taskId)}>Refresh saved history</button>
  {pending&&<p>One submission has an unconfirmed outcome. <button style={button} disabled={busy} onClick={()=>void submit(pending)}>Reconcile the same submission</button></p>}
  <details style={{marginTop:16}}><summary>Prepare an assignment</summary>
   <form onSubmit={e=>{e.preventDefault();void submit({...base('assignment'),title,request,context,sourceRefs:lines(sources),criteria:lines(criteria),providers:['chatgpt','grok','zai','other'],disclosure:'selected-material'});}}>
    <label>Title<input style={field} value={title} onChange={e=>setTitle(e.target.value)} maxLength={240}/></label>
    <label>What should the contributor do?<textarea style={field} value={request} onChange={e=>setRequest(e.target.value)} rows={3} maxLength={6000}/></label>
    <label>Selected source material<textarea style={field} value={context} onChange={e=>setContext(e.target.value)} rows={5} maxLength={24000}/></label>
    <label>Source references, one per line<textarea style={field} value={sources} onChange={e=>setSources(e.target.value)} rows={2}/></label>
    <label>Acceptance criteria, one per line<textarea style={field} value={criteria} onChange={e=>setCriteria(e.target.value)} rows={3}/></label>
    <button style={button} disabled={blocked||!title.trim()||!request.trim()||!sources.trim()||!criteria.trim()}>Save assignment</button>
   </form>
  </details>
  <label style={{display:'block',marginTop:16}}>Saved assignment<select style={field} value={assignmentId} disabled={busy} onChange={e=>{setAssignmentId(e.target.value);setReviewId('');setResponse('');}}><option value="">Choose saved work</option>{assignments.map(a=><option key={a.artifactId} value={a.artifactId}>{a.record.title}</option>)}</select></label>
  {assignment&&<>
   <label>Contributor<select style={field} value={chosenProvider} disabled={busy} onChange={e=>setProvider(e.target.value)}>{assignment.record.providers.map((p:string)=><option key={p} value={p}>{labels[p]}</option>)}</select></label>
   <button style={button} disabled={blocked} onClick={()=>void copyPrompt()}>Copy assignment</button>
   <details><summary>Assignment text</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{assignmentPrompt(assignment,chosenProvider)}</pre></details>
   <form onSubmit={e=>{e.preventDefault();void submit({...base('response'),parentId:assignmentId,provider:chosenProvider,model:model.trim()||null,conversationUrl:url.trim()||null,captureMode:'manual',text:response});}}>
    <h3>Retain the original response</h3>
    <label>Model shown by the provider, if known<input style={field} value={model} onChange={e=>setModel(e.target.value)} maxLength={160}/></label>
    <label>Conversation link, if available<input style={field} value={url} onChange={e=>setUrl(e.target.value)} maxLength={1500}/></label>
    <label>Original response<textarea style={field} rows={7} value={response} onChange={e=>setResponse(e.target.value)} maxLength={65536}/></label>
    <button style={button} disabled={blocked||!response.trim()}>Save original response</button>
   </form>
   <h3>Collected contributions</h3>
   {responses.length===0?<p>No responses retained yet.</p>:responses.map(r=><details key={r.artifactId}><summary>{labels[r.record.provider]} · {r.record.model||'Model not recorded'} · {new Date(r.recordedAt).toLocaleString()}</summary><p>Manually imported; provider identity is recorded, not independently verified.</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{r.record.text}</pre>{rows.filter(x=>x.record.kind==='review'&&x.record.parentId===r.artifactId).map(x=><p key={x.artifactId}>{x.record.decision}: {x.record.assessment}</p>)}</details>)}
   <form onSubmit={e=>{e.preventDefault();void submit({...base('review'),parentId:reviewId,decision,assessment,evidenceRefs:lines(evidence)});}}>
    <h3>Record a review</h3>
    <label>Response<select style={field} value={reviewId} onChange={e=>setReviewId(e.target.value)}><option value="">Choose a response</option>{responses.map(r=><option key={r.artifactId} value={r.artifactId}>{labels[r.record.provider]} · {r.record.model||'Unspecified model'}</option>)}</select></label>
    <label>Outcome<select style={field} value={decision} onChange={e=>setDecision(e.target.value)}><option value="needs-revision">Needs revision</option><option value="accepted-as-advice">Useful advice accepted</option><option value="rejected">Rejected</option></select></label>
    <label>Assessment<textarea style={field} value={assessment} onChange={e=>setAssessment(e.target.value)} rows={3}/></label>
    <label>Evidence or test references, one per line<textarea style={field} value={evidence} onChange={e=>setEvidence(e.target.value)} rows={2}/></label>
    <button style={button} disabled={blocked||!reviewId||!assessment.trim()||!evidence.trim()}>Save review</button>
    <p>Accepting advice does not activate code or grant access to the system.</p>
   </form>
  </>}
 </section>;
}
