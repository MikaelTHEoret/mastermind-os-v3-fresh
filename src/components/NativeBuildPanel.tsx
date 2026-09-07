'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {nativeApi,normalizeBuildPlan,normalizeBuildJob,normalizeProjection,normalizeSpecification,
  browserSelection,saveSelection,planForOperation,uncertainSource,holdText,holdCodes,pendingPreparation,prepareSavedBuild,DIGEST,
  type BuildPlan,type BuildJob,type ProjectionView,type SpecificationView,type Selection} from '../lib/native-development/workflow';

const button:React.CSSProperties={border:'1px solid #377888',borderRadius:5,padding:'8px 12px',background:'#143744',color:'#eaffff',cursor:'pointer'};
const labels:Record<string,string>={prepared:'Source work has not started',started:'Source work is running or awaiting a saved receipt',held:'Source work needs reconciliation',
  awaiting_independent_tests:'Source is ready; isolated tests are a separate step',awaiting_coding_authority:'Awaiting the separate coding permission check',needs_specification:'The request needs reviewed requirements and examples'};
type Props={specification:SpecificationView;canStart:boolean;disabled:boolean;
  onProjection:(planId:string|null,projection:ProjectionView|null)=>void;onChanged:()=>Promise<void>;onBusyChange:(busy:boolean)=>void};

export default function NativeBuildPanel({specification,canStart,disabled,onProjection,onChanged,onBusyChange}:Props) {
  const [plan,setPlan]=useState<BuildPlan|null>(null),[job,setJob]=useState<BuildJob|null>(null);
  const [saved,setSaved]=useState<Selection|null>(null),[busy,setBusy]=useState(false),[reading,setReading]=useState(false);
  const [holds,setHolds]=useState<string[]>([]),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [actionHolds,setActionHolds]=useState<string[]>([]);
  const [ready,setReady]=useState<string|null>(null),[sourceVerified,setSourceVerified]=useState(false),[observed,setObserved]=useState('');
  const current=useRef({specification,canStart,disabled,onProjection,onChanged,onBusyChange});current.current={specification,canStart,disabled,onProjection,onChanged,onBusyChange};
  const selection=useRef<Selection|null>(null),planRef=useRef<BuildPlan|null>(null),alive=useRef(false),acting=useRef(false),readingRef=useRef(false),generation=useRef(0);
  const save=useCallback((value:Selection)=>{try{saveSelection(window.localStorage,value);}catch {throw new Error('This browser could not save the operation identity. No new plan was requested.');}selection.current=value;setSaved(value);},[]);
  const display=useCallback((value:BuildPlan)=>{planRef.current=value;setPlan(value);setHolds(value.holds);},[]);

  const refresh=useCallback(async(signal?:AbortSignal)=>{
    const selected=selection.current;if(!selected?.planId||readingRef.current)return;
    readingRef.current=true;setReading(true);const ticket=++generation.current;
    const same=()=>alive.current&&!signal?.aborted&&ticket===generation.current&&selection.current?.planId===selected.planId;
    try {
      const result=await nativeApi('specification_build_plan',{specificationId:selected.specificationId,planId:selected.planId},signal);
      const next=normalizeBuildPlan(result.held?{...result.buildPlan,viewState:'held'}:result.buildPlan,selected.planId);
      if(!next||selected.operationId&&next.operationId!==selected.operationId)throw new Error('The saved build identity could not be verified.');
      if(!same())return;
      display(next);setJob(null);setError('');setObserved(new Date().toLocaleTimeString());
      if(result.held||next.viewState==='held'){setReady(null);setSourceVerified(false);setJob(null);setMessage('Current saved evidence is held. Reconciliation remains available.');current.current.onProjection(selected.planId,null);}
      else if(next.candidateId) {
        const response=await nativeApi('specification_build_candidate',{specificationId:selected.specificationId,planId:selected.planId},signal);
        if(!same())return;
        const projection=normalizeProjection(response.held?{viewState:'held',specificationId:selected.specificationId,planId:selected.planId,holds:response.candidateProjection?.holds}:response.candidateProjection,selected.specificationId,selected.planId);
        current.current.onProjection(selected.planId,projection);
        if(response.held||projection.viewState==='held'){setSourceVerified(false);setHolds(projection.viewState==='held'?projection.holds:[]);setMessage('Candidate disclosure is held until current evidence can be verified.');}
      } else current.current.onProjection(selected.planId,null);
    } catch(problem) {
      if(same()){setError(problem instanceof Error?problem.message:'The saved build is unavailable.');setReady(null);setSourceVerified(false);setJob(null);
        current.current.onProjection(selected.planId,null);}
    } finally {if(ticket===generation.current){readingRef.current=false;if(alive.current)setReading(false);}}
  },[display]);

  useEffect(()=>{
    alive.current=true;const controller=new AbortController();
    let previous=browserSelection();
    try {const pending=pendingPreparation(window.localStorage,specification.specificationId);if(pending)previous={version:1,...pending};}
    catch {setError('A saved preparation could not be read. New preparation will stay held until that record is available.');}
    const retained=previous?.specificationId===specification.specificationId?previous:null;
    const found=planForOperation(specification.buildPlans,retained);
    const last=retained?.operationId&&!retained.planId?undefined:specification.buildPlans.at(-1);
    const selected=found??last;
    const value=retained?.planId?retained:selected?{version:1 as const,specificationId:specification.specificationId,planId:selected.planId,operationId:selected.operationId}:retained??{version:1 as const,specificationId:specification.specificationId};
    try {saveSelection(window.localStorage,value);}
    catch {setError('Saved status can be read, but this browser could not retain the selection for reconnect.');}
    selection.current=value;setSaved(value);
    if(selected)display(selected);
    current.current.onProjection(value?.planId??null,null);
    if(value?.planId)void refresh(controller.signal);
    const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!acting.current&&!current.current.disabled)void refresh(controller.signal);},10000);
    return()=>{alive.current=false;generation.current++;readingRef.current=false;controller.abort();clearInterval(timer);current.current.onBusyChange(false);};
    // The parent keys this component by the saved request; each mount has one identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[refresh,display]);

  const choose=async(planId:string)=>{
    if(acting.current)return;
    const next=specification.buildPlans.find(item=>item.planId===planId);if(!next)return;
    try {save({version:1,specificationId:specification.specificationId,planId,operationId:next.operationId});}
    catch(problem){setError((problem as Error).message);return;}
    generation.current++;readingRef.current=false;display(next);setJob(null);setReady(null);setSourceVerified(false);setMessage('');setActionHolds([]);
    onProjection(planId,null);await refresh();
  };

  const prepare=async()=>{
    if(acting.current||disabled||!canStart||specification.viewState!=='available')return;
    acting.current=true;setBusy(true);onBusyChange(true);setError('');setMessage('');
    try {
      const result=await prepareSavedBuild(window.localStorage,specification.specificationId,nativeApi,()=>crypto.randomUUID());
      if(!alive.current)return;
      selection.current=result.selection;setSaved(result.selection);setHolds(result.holds);
      const next=result.plan;if(!next){setMessage('Preparation is held. The same saved operation will be retained.');return;}
      display(next);setJob(null);setReady(null);setSourceVerified(false);
      onProjection(next.planId,null);setMessage(next.holds.length?'The plan is saved with requirements still held. No source work started.':'The plan is saved. Source work has not started.');
      await onChanged();await refresh();
    } catch(problem) {if(alive.current){try{const pending=pendingPreparation(window.localStorage,specification.specificationId);if(pending){selection.current={version:1,...pending};setSaved(selection.current);}}catch{}setError((problem instanceof Error?problem.message:'Preparation could not be confirmed.')+' No coding attempt was started by preparation.');}}
    finally {acting.current=false;if(alive.current){setBusy(false);onBusyChange(false);}}
  };

  const act=async(action:string)=>{
    const selected=selection.current,next=planRef.current;
    if(acting.current||disabled||!selected?.planId||!next)return;
    if(action==='specification_build_start'&&(!canStart||ready!==next.planId||(job?.state??next.jobState)!=='prepared'))return;
    acting.current=true;setBusy(true);onBusyChange(true);setError('');setMessage('');
    // A lost start response must not leave a start button armed by old preflight.
    if(action==='specification_build_start'){setReady(null);setJob({planId:next.planId,operationId:next.operationId,state:'held',holds:['BUILD_RECONCILE_WITHOUT_RERUN'],executionAuthorized:false});}
    try {
      const result=await nativeApi(action,{specificationId:selected.specificationId,planId:selected.planId});
      if(!alive.current||selection.current?.planId!==selected.planId)return;
      const status=normalizeBuildJob(result.buildJob,next.planId,next.operationId);
      if(status)setJob(status);
      const reasons=holdCodes(result.preflight?.holds??status?.holds??[]);setActionHolds(reasons);
      if(result.held){setReady(null);setSourceVerified(false);setMessage('This step is held. Saved work remains available for reconciliation.');}
      else if(action==='specification_build_preflight'){
        const pass=result.preflight?.planId===next.planId&&result.preflight?.state==='ready_for_separate_dispatch'&&result.preflight?.workerInvoked===false
          &&result.preflight?.executionAuthorized===false&&Array.isArray(result.preflight.holds)&&result.preflight.holds.length===0;
        setReady(pass?next.planId:null);setMessage(pass?'Current source-work checks pass. Starting remains a separate action.':'Source-work checks did not confirm readiness.');
      } else if(action==='specification_build_result'){
        const pass=!!result.source&&status?.sourceReady===true;setSourceVerified(pass);
        setMessage(pass?'The saved source result is verified. Isolated tests and activation remain separate.':'No verified source result is available yet.');
      } else if(action==='specification_build_candidate_stage'){
        const pass=result.activated===false&&result.behavioralTests==='pending'&&typeof result.candidate?.candidateId==='string'&&DIGEST.test(result.candidate.candidateId);
        setMessage(pass?'The source candidate is staged. Run its independent isolated tests below.':'Staging did not confirm a candidate; read the saved status.');
      } else setMessage(status?.sourceReady?'The source receipt was reconciled. Read its verified result before staging.':'The saved operation was checked. Its current status is shown below.');
      await onChanged();await refresh();
    } catch(problem) {if(alive.current){setReady(null);setSourceVerified(false);setError((problem instanceof Error?problem.message:'The operation could not be confirmed.')+' No automatic retry was sent; the original outcome is uncertain. Reconcile this saved build.');}}
    finally {acting.current=false;if(alive.current){setBusy(false);onBusyChange(false);}}
  };

  const state=job?.state??plan?.jobState??plan?.state;
  const pending=!!saved?.operationId&&!saved.planId;
  const available=specification.viewState==='available';
  const mayPrepare=canStart&&available&&!uncertainSource(specification.buildPlans)&&!busy&&!disabled;
  const mayStart=canStart&&available&&!busy&&!disabled&&!reading&&ready===plan?.planId&&state==='prepared'&&!holds.length;
  const requirements=available&&plan?.viewState==='available'?plan.details?.review?.requirements:null;
  return <section aria-label="Saved source build" style={{marginTop:16,padding:14,border:'1px solid #38616d',borderRadius:6}}>
    <h4 style={{margin:'0 0 8px'}}>Build from this saved request</h4>
    <p>Preparation checks the reviewed requirements and source permission. It does not run a coding agent. Saved source work, isolated tests and activation have separate results.</p>
    {specification.buildPlans.length>0&&<label>Saved build plan<select aria-label="Saved build plan" style={{display:'block',width:'100%',margin:'6px 0 10px',padding:8,background:'#0a222d',color:'#fff'}} disabled={busy||disabled} value={saved?.planId??''} onChange={event=>void choose(event.target.value)}>
      {!saved?.planId&&<option value="">Choose saved work...</option>}{specification.buildPlans.map((item,index)=><option key={item.planId} value={item.planId}>Build {index+1}{item.createdAt?' · '+new Date(item.createdAt).toLocaleString():''}</option>)}</select></label>}
    <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
      <button type="button" style={button} disabled={!mayPrepare} onClick={()=>void prepare()}>{pending?'Resume saved preparation':plan?'Prepare updated plan':'Prepare build plan'}</button>
      {saved?.planId&&<button type="button" style={button} disabled={busy||disabled||reading} onClick={()=>void refresh()}>Read saved build</button>}
      {plan&&<>
        <button type="button" style={button} disabled={!canStart||!available||busy||disabled||reading||state!=='prepared'} onClick={()=>void act('specification_build_preflight')}>Check source-work readiness</button>
        <button type="button" style={button} disabled={!mayStart} onClick={()=>void act('specification_build_start')}>Start saved source work</button>
        <button type="button" style={button} disabled={busy||disabled} onClick={()=>void act('specification_build_reconcile')}>Reconcile saved operation</button>
        <button type="button" style={button} disabled={busy||disabled} onClick={()=>void act('specification_build_result')}>Read source result</button>
        <button type="button" style={button} disabled={!canStart||!available||busy||disabled||!sourceVerified||!!plan.candidateId} onClick={()=>void act('specification_build_candidate_stage')}>Stage verified source</button>
      </>}
    </div>
    {state&&<p role="status">{labels[state]??'Saved plan: '+state.replace(/_/g,' ')}</p>}
    {!!holds.length&&<p role="status" style={{color:'#f1cf90'}}>Held: {holdText(holds)}</p>}
    {!!actionHolds.length&&<p role="status" style={{color:'#f1cf90'}}>Last requested step held: {holdText(actionHolds)}</p>}
    {error&&<p role="alert" style={{color:'#ffaaa1'}}>{error}</p>}
    {message&&<p role="status">{message}</p>}
    {requirements&&<details><summary>Reviewed behavior for this build</summary><ul>{requirements.requirements.map((item,index)=><li key={index}>{item}</li>)}</ul><p>{requirements.tests.cases.length} saved acceptance examples. Source creation does not mark these isolated tests as passed.</p></details>}
    <p style={{fontSize:12,color:'#96b2bc'}}>Only status reads refresh every 10 seconds while this screen is visible.{observed?' Last read '+observed+'.':''} Reconciliation never automatically starts another attempt.</p>
  </section>;
}
