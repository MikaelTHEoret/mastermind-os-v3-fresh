'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import NativeCapabilityInputs from './NativeCapabilityInputs';
import NativeBuildPanel from './NativeBuildPanel';
import {nativeApi as api,normalizeSpecification,normalizeSummaries,browserSelection,saveSelection,holdText,
  type Json,type Summary,type SpecificationView,type ProjectionView} from '../lib/native-development/workflow';

type Recipe={recipeId:string;title:string;aliases:string[];mode:string};
type Catalog={available:boolean;recipes:Recipe[];holds:string[]};

const panel:React.CSSProperties={padding:16,border:'1px solid #235465',borderRadius:8,background:'#071821',color:'#e7f2f5',fontFamily:'system-ui,sans-serif',fontSize:14};
const button:React.CSSProperties={border:'1px solid #377888',borderRadius:5,padding:'8px 12px',background:'#143744',color:'#eaffff',cursor:'pointer'};
const field:React.CSSProperties={width:'100%',boxSizing:'border-box',border:'1px solid #38616d',borderRadius:5,padding:9,background:'#0a222d',color:'#fff',font:'inherit'};
const stages:Record<string,string>={needs_specification:'Needs examples and a specification',specified:'Specification saved',reuse_available:'Existing capability can be reused',awaiting_tests:'Ready for isolated tests',awaiting_host_verification:'Tests recorded; activation checks pending',passed:'Tests passed',failed:'Tests failed',held:'Waiting for a requirement',running:'Tests running',active:'Active'};
const when=(value?:string)=>value?new Date(value).toLocaleString():'';

function ResultValue({value,depth=0}:{value:Json;depth?:number}) {
  if(depth>5)return <span>Nested result available in the saved evidence.</span>;
  if(value===null)return <span>None</span>;
  if(Array.isArray(value))return value.length?<ol>{value.slice(0,30).map((item,index)=><li key={index}><ResultValue value={item} depth={depth+1}/></li>)}{value.length>30 && <li>{value.length-30} more items in the saved result</li>}</ol>:<span>None</span>;
  if(typeof value==='object')return <dl style={{margin:'6px 0'}}>{Object.entries(value).slice(0,40).map(([key,item])=><div key={key} style={{marginBottom:6}}><dt style={{fontWeight:600}}>{key.replace(/([a-z])([A-Z])/g,'$1 $2')}</dt><dd style={{marginLeft:12,overflowWrap:'anywhere'}}><ResultValue value={item} depth={depth+1}/></dd></div>)}</dl>;
  return <span style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{String(value)}</span>;
}

export default function NativeDevelopment() {
  const [catalog,setCatalog]=useState<Catalog|null>(null),[history,setHistory]=useState<Summary[]>([]),[selectedView,setSelected]=useState<SpecificationView|null>(null);
  const selected=selectedView?.viewState==='available'?selectedView:null;
  const [sourceBusy,setSourceBusy]=useState(false);
  const [projected,setProjected]=useState<{specificationId:string;planId:string|null;view:ProjectionView|null}|null>(null);
  const [request,setRequest]=useState(''),[recipeId,setRecipeId]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[observed,setObserved]=useState('');
  const [heldStep,setHeldStep]=useState('');
  const [preflight,setPreflight]=useState<{candidateId:string;ready:boolean;reasons:string[]}|null>(null),[rollback,setRollback]=useState(''),[exampleResult,setExampleResult]=useState<Json|undefined>();
  const selection=useRef<string|null>(null),acting=useRef(false),refreshing=useRef(false),alive=useRef(true),generation=useRef(0);

  const refresh=useCallback(async(signal?:AbortSignal)=>{
    if(refreshing.current)return;
    refreshing.current=true;const ticket=++generation.current;
    try {
      const [availability,saved]=await Promise.all([api('wizard_catalog',undefined,signal),api('specifications',undefined,signal)]);
      if(typeof availability.available!=='boolean'||!Array.isArray(availability.holds)||!availability.holds.every((value:unknown)=>typeof value==='string')
        ||!Array.isArray(availability.recipes)||!availability.recipes.every((value:unknown)=>!!value&&typeof value==='object'
          &&typeof (value as Recipe).recipeId==='string'&&typeof (value as Recipe).title==='string'&&Array.isArray((value as Recipe).aliases)
          &&(value as Recipe).aliases.every(alias=>typeof alias==='string'))||!Array.isArray(saved.specifications))throw new Error('The native development catalog returned an incomplete response.');
      const chosen=selection.current || saved.specifications[0]?.specificationId;
      const detail=chosen?await api('specification',{specificationId:chosen},signal):null;
      if(!alive.current || signal?.aborted || ticket!==generation.current || (selection.current && chosen!==selection.current))return;
      setCatalog({available:availability.available,recipes:availability.recipes,holds:availability.holds});setHistory(normalizeSummaries(saved.specifications));
      setSelected(detail?normalizeSpecification(detail.held?{viewState:'held',specificationId:chosen,holds:detail.specification?.holds,buildPlans:detail.specification?.buildPlans}:detail.specification,chosen):null);
      selection.current=chosen ?? null;setObserved(new Date().toISOString());setError('');
    } catch(problem) {
      if(alive.current && !signal?.aborted && ticket===generation.current){
        setCatalog(previous=>previous?{...previous,available:false}:null);
        setError(problem instanceof Error?problem.message:'Native development is unavailable.');
        setProjected(null);if(selection.current)setSelected({viewState:'held',specificationId:selection.current,holds:['NATIVE_SAVED_VIEW_UNAVAILABLE'],buildPlans:[]});
      }
    } finally {if(ticket===generation.current){refreshing.current=false;if(alive.current)setLoading(false);}}
  },[]);

  useEffect(()=>{
    alive.current=true;const controller=new AbortController();
    selection.current=browserSelection()?.specificationId??selection.current;void refresh(controller.signal);
    const timer=setInterval(()=>{if(document.visibilityState==='visible' && !acting.current)void refresh(controller.signal);},10000);
    return ()=>{alive.current=false;controller.abort();generation.current+=1;refreshing.current=false;clearInterval(timer);};
  },[refresh]);

  const choose=async(id:string)=>{
    if(acting.current||sourceBusy)return;
    selection.current=id;setProjected(null);setPreflight(null);setExampleResult(undefined);setRollback('');setHeldStep('');setLoading(true);
    try {saveSelection(window.localStorage,{version:1,specificationId:id});}
    catch {setError('This request can be read, but the browser could not retain this selection for reconnect.');}
    try {const detail=await api('specification',{specificationId:id});if(alive.current && selection.current===id)setSelected(normalizeSpecification(detail.held?{viewState:'held',specificationId:id,holds:detail.specification?.holds,buildPlans:detail.specification?.buildPlans}:detail.specification,id));}
    catch(problem){setError(problem instanceof Error?problem.message:'Saved work is unavailable.');if(selection.current===id)setSelected({viewState:'held',specificationId:id,holds:['NATIVE_SAVED_VIEW_UNAVAILABLE'],buildPlans:[]});}
    finally {if(alive.current)setLoading(false);}
  };

  const act=async(action:string,payload:Record<string,unknown>,message:string)=>{
    if(acting.current||sourceBusy)return;
    acting.current=true;setBusy(true);setError('');setNotice('');setHeldStep('');
    try {
      const result=await api(action,payload);
      if(!alive.current)return;
      if(result.specification){const view=normalizeSpecification(result.held?{viewState:'held',specificationId:result.specification.specificationId,holds:result.specification.holds,buildPlans:result.specification.buildPlans}:result.specification);selection.current=view.specificationId;setSelected(view);setExampleResult(undefined);setRollback('');}
      if(result.preflight&&action==='candidate_preflight'){
        if(typeof result.preflight.ready!=='boolean'||!Array.isArray(result.preflight.reasons)||!result.preflight.reasons.every((value:unknown)=>typeof value==='string'))throw new Error('Activation readiness could not be verified.');
        setPreflight({...result.preflight,candidateId:String(payload.candidateId)});
      }
      if(result.held){setHeldStep('This step is held: '+holdText(result.preflight?.reasons??result.buildJob?.holds??result.specification?.holds));setPreflight(previous=>previous?{...previous,ready:false}:null);setNotice('');await refresh();return;}
      if(action==='call')setExampleResult(result.result as Json);
      if(result.reuse?.status==='completed')setExampleResult(result.reuse.result as Json);
      setNotice(action==='publish_build_events'
        ? result.status==='durable'?'The development history is saved in the shared task continuation.'
          :`${result.delivered ?? 0} events checkpointed; ${result.remaining ?? 'some'} remain saved locally for later delivery.`
        :message);
      await refresh();
    } catch(problem) {
      if(alive.current)setError((problem instanceof Error?problem.message:'The operation could not be confirmed.')+' No automatic retry was sent; refresh the saved status.');
    } finally {acting.current=false;if(alive.current)setBusy(false);}
  };

  const general=projected?.specificationId===selectedView?.specificationId&&!!projected?.planId;
  const projection=general&&projected?.view?.viewState==='available'?projected.view:null;
  const candidate=general?projection?.candidate:selected?.candidate;
  const activeRevision=general?projection?.activeRevision??null:selected?.activeRevision;
  const moduleId=general?projection?.moduleId:selected?.holderId;
  const requirements=general?projection?.requirements:selected?.identity.requirements;
  const testRun=candidate?.testRuns?.at(-1);
  const testStatus=testRun?.status || candidate?.status;
  const currentPreflight=candidate && preflight?.candidateId===candidate.candidateId?preflight:null;
  const running=testStatus==='running';
  const reusing=!general&&selected?.identity.decision==='reuse';
  const active=!!activeRevision && ((!!candidate && activeRevision===candidate.candidateId) || reusing && selected?.identity.expectedActiveRevision===activeRevision);
  const recipes=catalog?.recipes ?? [];
  const canAct=!!catalog?.available && !busy && !sourceBusy && !loading;
  const base=selected && moduleId && candidate?{id:moduleId,candidateId:candidate.candidateId}:null;
  const revisionOptions=(general?projection?.revisions??[]:selected?.revisions??[]).filter(item=>item.candidateId!==activeRevision);
  const successfulExamples=requirements?.tests.cases.filter(item=>!item.expectedError).slice(0,4) ?? [];
  const inputContracts=candidate?.identity.contracts ?? requirements?.contracts ?? [];
  const runInputs=(capability:string,arguments_:Record<string,Json>)=>{
    if(!selected || !active)return;
    void act(reusing?'specification_reuse':'call',reusing
      ?{specificationId:selected.specificationId,operationId:crypto.randomUUID(),capability,arguments:arguments_}
      :{capability,args:[],kwargs:arguments_},reusing?'The existing capability completed this saved request.':'The active isolated capability returned this result.');
  };
  useEffect(()=>{setPreflight(null);},[selected?.specificationId,candidate?.candidateId,activeRevision,testStatus]);

  return <section className="native-development" aria-label="Native development" style={panel}>
    <style>{'.native-development button:disabled{opacity:.45;cursor:not-allowed}.native-development summary{cursor:pointer;padding:6px 0}.native-development button:focus-visible,.native-development summary:focus-visible{outline:2px solid #9be6d7;outline-offset:3px}'}</style>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'}}>
      <h2 style={{margin:0,fontSize:20}}>Build with Mastermind</h2>
      <button type="button" style={button} disabled={busy} onClick={()=>void refresh()}>Refresh status</button>
    </div>
    <p style={{color:'#adc6ce',lineHeight:1.5}}>Describe a capability, review its specification, test a candidate, then activate it. Saved work and version history resume here.</p>
    {error && <p role="alert" style={{color:'#ffaaa1',lineHeight:1.5}}>{error}</p>}
    {heldStep&&<p role="status" style={{color:'#f1cf90',lineHeight:1.5}}>{heldStep}</p>}
    {catalog?.holds?.length ? <ul role="status" style={{color:'#f1cf90'}}>{catalog.holds.map(hold=><li key={hold}>{hold}</li>)}</ul>:null}
    <form onSubmit={event=>{event.preventDefault();void act('specification',{request,...(recipeId?{recipeId}:{})},'The specification is saved. Review its behavior and acceptance examples.');}}>
      <label style={{display:'block',marginBottom:10}}>What should Mastermind do?
        <textarea aria-label="Capability request" maxLength={4000} rows={3} style={{...field,marginTop:5}} value={request} onChange={event=>{setRequest(event.target.value);setRecipeId('');}} placeholder="Describe the outcome and an example of the behavior you need."/>
      </label>
      {!!recipes.length && <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}} aria-label="Reviewed starting specifications">{recipes.map(recipe=><button type="button" key={recipe.recipeId} style={{...button,borderColor:recipeId===recipe.recipeId?'#8bedda':'#377888'}} onClick={()=>{setRecipeId(recipe.recipeId);setRequest(recipe.aliases[0]);}}>{recipe.title}</button>)}</div>}
      <button style={button} disabled={!canAct || !request.trim()} type="submit">{busy?'Saving or working...':'Prepare specification'}</button>
    </form>
    {notice && <p role="status" style={{color:'#9fe4c6'}}>{notice}</p>}
    {!!history.length && <label style={{display:'block',marginTop:18}}>Resume saved work
      <select aria-label="Saved development request" style={{...field,marginTop:5}} value={selectedView?.specificationId ?? ''} disabled={busy||sourceBusy} onChange={event=>void choose(event.target.value)}>
        {history.map(item=><option key={item.specificationId} value={item.specificationId}>{item.title} · {when(item.createdAt)}</option>)}
      </select>
    </label>}
    {selectedView&&<NativeBuildPanel key={selectedView.specificationId} specification={selectedView} canStart={!!catalog?.available&&!loading} disabled={busy}
      onBusyChange={setSourceBusy} onChanged={refresh} onProjection={(planId,view)=>setProjected({specificationId:selectedView.specificationId,planId,view})}/>}
    {selectedView?.viewState==='held'&&<section aria-label="Saved request held" style={{marginTop:14}}><h3>Saved request access is held</h3><p role="status">{holdText(selectedView.holds)}</p><p>Private request details and candidate actions are hidden until current access and source evidence can be verified.</p></section>}
    {selected && <article style={{marginTop:18,borderTop:'1px solid #284956',paddingTop:14}}>
      <h3 style={{margin:'0 0 6px',fontSize:17}}>{selected.identity.title || 'Saved capability request'}</h3>
      <p style={{whiteSpace:'pre-wrap'}}>{selected.identity.request}</p>
      <p role="status" style={{color:active?'#9fe4c6':'#e6ce9d'}}>{active?'This version is active':reusing?'The active version changed. Prepare a fresh request to review it.':stages[testStatus || selected.identity.stage] || testStatus || selected.identity.stage}</p>
      {testRun && <p>{testRun.completedCases ?? 0} of {testRun.caseCount ?? 0} acceptance examples verified.{testRun.error && <span style={{color:'#ffaaa1'}}> {testRun.error}</span>}</p>}
      <p>Approach: {({reuse:'Reuse the existing accepted behavior',extend:'Improve the existing capability',assimilate:'Adapt the reviewed source',create:'Create the missing capability',inspect_existing:'Inspect related capabilities'} as Record<string,string>)[selected.identity.decision]}</p>
      {!!selected.identity.catalogMatches.length && <details><summary>Existing capabilities considered</summary><ul>{selected.identity.catalogMatches.map(match=><li key={match.name}>{match.name} · {match.available?'available':'unavailable'}<p style={{color:'#adc6ce'}}>{match.basis}</p></li>)}</ul></details>}
      {!!selected.identity.missing.length && <ul>{selected.identity.missing.map(item=><li key={item}>{item}</li>)}</ul>}
      {selected.identity.requirements && <>
        <details open><summary>Required behavior</summary>{selected.identity.requirements.compatibility && <p>{selected.identity.requirements.compatibility}</p>}<ul style={{lineHeight:1.6}}>{selected.identity.requirements.requirements.map(item=><li key={item}>{item}</li>)}</ul></details>
        <details><summary>{selected.identity.requirements.tests.cases.length} acceptance examples</summary><ul>{selected.identity.requirements.tests.cases.map(item=><li key={item.id}>{item.id.replace(/-/g,' ')}{item.expectedError?' · invalid input must be rejected':''}</li>)}</ul></details>
      </>}
      <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:14}}>
        {!general && !candidate && selected.identity.stage==='specified' && <button style={button} disabled={!canAct} onClick={()=>void act('specification_stage',{specificationId:selected.specificationId,operationId:crypto.randomUUID()},'The committed source has been staged. It is ready for isolated behavioral tests.')}>Stage reviewed source</button>}
        {base && <button style={button} disabled={!canAct || running} onClick={()=>void act('candidate_test',{...base,operationId:crypto.randomUUID()},'Tests were submitted. Their saved progress will refresh here.')}>{running?'Tests running...':'Run isolated tests'}</button>}
        {base && !active && <button style={button} disabled={!canAct || running} onClick={()=>void act('candidate_preflight',base,'Activation readiness was checked against the current source, task scope and test evidence.')}>Check activation</button>}
        {base && !active && <button style={button} disabled={!canAct || running || !currentPreflight?.ready || candidate?.testReceipts.at(-1)?.outcome!=='passed'} onClick={()=>void act('candidate_promote',{...base,expectedActiveRevision:activeRevision,operationId:crypto.randomUUID()},activeRevision?'The tested revision is active. Its earlier accepted revision remains in history.':'The tested revision is active.')}>Activate tested version</button>}
      </div>
      {currentPreflight && <p role="status" style={{color:currentPreflight.ready?'#9fe4c6':'#f1cf90'}}>{currentPreflight.ready?'Current activation checks pass.':`Activation is held: ${currentPreflight.reasons.map(reason=>reason.replace(/_/g,' ').toLowerCase()).join('; ')}.`}</p>}
      {active && !!successfulExamples.length && <div style={{marginTop:16}}><h4 style={{marginBottom:8}}>Try the active capability</h4><div style={{display:'flex',flexWrap:'wrap',gap:6}}>{successfulExamples.map(example=><button key={example.id} style={button} disabled={!canAct} onClick={()=>runInputs(example.capability,example.input)}>{example.id.replace(/-/g,' ')}</button>)}</div></div>}
      {active && inputContracts.length>0 && <NativeCapabilityInputs key={selected.specificationId+activeRevision} contracts={inputContracts} disabled={!canAct} onRun={runInputs}/>}
      {exampleResult!==undefined && <section aria-label="Capability result" style={{marginTop:12,padding:12,background:'#102c35'}}><ResultValue value={exampleResult}/></section>}
      {!!selected.reuseRuns?.length && <section aria-label="Saved uses" style={{marginTop:14}}><h4>Saved uses of this capability</h4><ul>{selected.reuseRuns.map(run=><li key={run.operationId}>{when(run.finishedAt || run.startedAt)} · {run.status}{run.version?' · version '+run.version:''}{run.holdCode?' · needs reconciliation':''}{run.status==='completed' && <button type="button" style={{...button,marginLeft:8}} disabled={!canAct || !active} onClick={()=>void act('specification_reuse_result',{specificationId:selected.specificationId,operationId:run.operationId},'The verified saved result has been restored.')}>Restore result</button>}</li>)}</ul></section>}
      {!!revisionOptions.length && <div style={{marginTop:16}}><label>Restore an accepted version
        <select aria-label="Accepted version to restore" style={{...field,marginTop:5}} value={rollback} onChange={event=>setRollback(event.target.value)}><option value="">Choose a saved version...</option>{revisionOptions.map(item=><option key={item.candidateId} value={item.candidateId}>Accepted {when(item.acceptedAt)}</option>)}</select>
      </label><button style={{...button,marginTop:8}} disabled={!canAct || !rollback || running} onClick={()=>void act('candidate_rollback',{id:moduleId,candidateId:rollback,expectedActiveRevision:activeRevision,operationId:crypto.randomUUID()},'The selected accepted revision has been restored.')}>Restore selected version</button></div>}
      {!!selected.events?.some(event=>event.checkpointDelivery?.status!=='durable') && <button style={{...button,marginTop:16}} disabled={!canAct || running} onClick={()=>void act('publish_build_events',{id:selected.holderId,limit:5},'Development history delivery checked.')}>Save shared continuation</button>}
      {!!selected.events?.length && <details style={{marginTop:16}}><summary>Saved development history</summary><ol>{selected.events.map(event=><li key={event.eventId}>{event.identity.kind.replace(/\./g,' ').replace(/_/g,' ')} · {when(event.createdAt)}<span style={{color:'#adc6ce'}}> · {event.checkpointDelivery?.status==='durable'?'checkpointed':'saved locally; checkpoint delivery pending'}</span></li>)}</ol></details>}
      {selected.identity.sourceRef && <details style={{marginTop:12,color:'#adc6ce'}}><summary>Source evidence</summary><p style={{overflowWrap:'anywhere'}}>{selected.identity.sourceRef.path}<br/>Private source revision {selected.identity.sourceRef.commit}</p></details>}
    </article>}
    <p style={{margin:'16px 0 0',fontSize:12,color:'#96b2bc'}}>{observed?`Status read ${when(observed)}.`:loading?'Reading the native development service...':'No verified status is available.'}</p>
  </section>;
}
