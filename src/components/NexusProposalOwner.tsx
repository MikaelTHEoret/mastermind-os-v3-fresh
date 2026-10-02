'use client';
import {useEffect,useRef,useState} from 'react';
import {NexusOwnerSession} from '@/lib/delegation/nexus-owner-workflow.mjs';
import {proposalHeads} from '@/lib/delegation/nexus-proposal.mjs';

type Ref={taskId:string;project:string};
type Transport={load:(ref:Ref)=>Promise<any>;save:(record:any)=>Promise<any>;recover:(ref:Ref,operationId:string)=>Promise<any>;renew?:(record:any)=>Promise<string>;restart?:()=>Promise<string>};
type Props={ownerKey:string;task:Ref&{title:string};transport?:Transport};
const field={background:'#122333',color:'#f5f8ff',border:'1px solid #6d8299',borderRadius:4,padding:8};

// Installed only by the authenticated owner composition; creation stays gated.
export default function NexusProposalOwner(props:Props){
 if(!props.transport)return <section aria-label="Nexus proposals"><h2>Plan work with Nexus</h2><p>The saved-plan connection is being prepared. No proposal can be submitted yet.</p></section>;
 return <OwnerForm key={`${props.ownerKey}:${props.task.taskId}:${props.task.project}`} {...props} transport={props.transport}/>;
}
function OwnerForm({ownerKey,task,transport}:Props&{transport:Transport}){
 const connection=useRef(transport);
 const [session,setSession]=useState<NexusOwnerSession|null>(null);
 const [state,setState]=useState<any>(null);
 const [title,setTitle]=useState(''),[plans,setPlans]=useState<string[]>([]),[reviews,setReviews]=useState<string[]>([]);
 const [dependencies,setDependencies]=useState<Record<string,string[]>>({}),[parent,setParent]=useState('');
 useEffect(()=>{
  const current=new NexusOwnerSession({ownerKey,ref:{taskId:task.taskId,project:task.project},storage:{getItem:(key:string)=>window.localStorage.getItem(key),setItem:(key:string,value:string)=>window.localStorage.setItem(key,value),removeItem:(key:string)=>window.localStorage.removeItem(key)},transport:connection.current});
  setSession(current);setState(current.snapshot());
 },[ownerKey,task.taskId,task.project]);
 if(!session||!state)return <p role="status">Restoring proposal recovery…</p>;
 const locked=state.busy||!!state.pending;
 const act=async(fn:()=>Promise<unknown>)=>{const work=fn();setState(session.snapshot());try{await work;}catch{/* Session retains the original pending operation and error. */}setState(session.snapshot());};
 const toggle=(list:string[],id:string)=>list.includes(id)?list.filter(x=>x!==id):[...list,id];
 const clear=()=>{setTitle('');setPlans([]);setReviews([]);setDependencies({});setParent('');};
 const prepare=()=>{try{session.prepare({title,planIds:plans,dependencies,reviewIds:reviews,parentId:parent||null});setState(session.snapshot());}catch(e){setState({...session.snapshot(),message:e instanceof Error?e.message:'Cannot prepare proposal.'});}};
 return <section aria-label="Nexus proposals" style={{color:'#f5f8ff',background:'#0b1d2a',padding:16}}>
  <h2>Plan work with Nexus</h2><p>{task.title}</p>
  <p>Combine saved build plans and accepted advice. Dependencies mean source ready for review. Saving does not authorize coding, testing or activation.</p>
  <p>Saved plans retain their original source review. A new proposal does not renew a plan’s permission to execute.</p>
  <p role="status" aria-live="polite">{state.message}</p>
  <button disabled={locked} onClick={()=>{clear();void act(()=>session.load());}}>Load saved plans and history</button>
  {transport.restart?<button disabled={locked} onClick={()=>{clear();void act(()=>session.restartPlans());}}>Start a fresh plan read</button>:null}
  {state.pending?<div><h3>Unfinished proposal</h3><p>{state.pending.title}</p>
   <p>The exact proposal is retained across reloads. Neither reload nor checking a result sends it.</p>
   <button disabled={state.busy} onClick={()=>void act(()=>session.recover())}>Check existing save</button>{' '}
   <button disabled={state.busy} onClick={()=>void act(()=>session.save())}>Save the retained proposal</button>
   {transport.renew?<button disabled={state.busy} onClick={()=>void act(()=>session.renewVerification())}>Prepare a fresh source check</button>:null}
  </div>:null}
  {state.material&&!state.pending?<form onSubmit={e=>{e.preventDefault();prepare();}}>
   <label>Proposal history <select style={field} value={parent} disabled={locked} onChange={e=>{clear();setParent(e.target.value);}}><option value="">Start a new proposal</option>
    {proposalHeads(state.artifacts).map((row:any)=><option key={row.artifactId} value={row.artifactId}>Revise: {row.record.title}</option>)}</select></label>
   <p><label>Proposal title <input required style={field} value={title} disabled={locked} onChange={e=>setTitle(e.target.value)}/></label></p>
   <fieldset disabled={locked}><legend>Saved build plans</legend>{state.material.plans.map((plan:any)=><div key={plan.planId}>
    <label><input type="checkbox" checked={plans.includes(plan.planId)} onChange={()=>{setPlans(toggle(plans,plan.planId));setDependencies({});}}/>{plan.title}</label>
    {plans.includes(plan.planId)?<fieldset><legend>Wait for source from</legend>{state.material.plans.filter((p:any)=>plans.includes(p.planId)&&p.planId!==plan.planId).map((p:any)=><label key={p.planId} style={{display:'block'}}><input type="checkbox" checked={(dependencies[plan.planId]??[]).includes(p.planId)} onChange={()=>setDependencies({...dependencies,[plan.planId]:toggle(dependencies[plan.planId]??[],p.planId)})}/>{p.title}</label>)}</fieldset>:null}
   </div>)}</fieldset>
   <fieldset disabled={locked}><legend>Accepted advice to include</legend>{state.artifacts.filter((r:any)=>r.record.kind==='review'&&r.record.decision==='accepted-as-advice').map((r:any)=><label key={r.artifactId} style={{display:'block'}}><input type="checkbox" checked={reviews.includes(r.artifactId)} onChange={()=>setReviews(toggle(reviews,r.artifactId))}/>{r.record.assessment}</label>)}</fieldset>
   <button disabled={locked||!plans.length||!reviews.length||!title.trim()} type="submit">Prepare proposal for saving</button>
  </form>:null}
 </section>;
}
