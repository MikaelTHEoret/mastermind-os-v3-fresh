'use client';
import {useEffect,useMemo,useState} from 'react';
import NexusProposalOwner from './NexusProposalOwner';
import {NexusHostedTransport,nexusJson} from '@/lib/delegation/nexus-hosted-transport.mjs';
import {checkedTasks} from '@/lib/delegation/browser-workflow.mjs';
import {parseNodeInventory} from './node-control-contract.mjs';
type Task={taskId:string;project:string;title:string};
type Node={nodeId:string;displayName:string;connectivity:string;lastExchangeAt?:string|null;worker?:{capabilities:{id:string;version:number}[]}|null};
const field={background:'#122333',color:'#f5f8ff',border:'1px solid #6d8299',padding:8};
export default function NexusHostedOwner(){
 const [owner,setOwner]=useState(''),[tasks,setTasks]=useState<Task[]>([]),[nodes,setNodes]=useState<Node[]>([]);
 const [taskId,setTaskId]=useState(''),[nodeId,setNodeId]=useState(''),[message,setMessage]=useState('Checking the Nexus connection…');
 useEffect(()=>{let current=true;void(async()=>{try{
  const r=await nexusJson('/api/nexus');if(typeof r.ownerKey!=='string'||!r.ownerKey||r.ownerKey.length>200)throw Error('Owner connection unavailable.');
  const ts=checkedTasks(r.tasks),inventory=parseNodeInventory({ok:true,nodes:r.nodes});
  if(!inventory.ok)throw Error('Computer list unavailable.');const ns=inventory.nodes;
  if(!current)return;setOwner(r.ownerKey);setTasks(ts);setNodes(ns);setTaskId(ts[0]?.taskId??'');setNodeId(ns[0]?.nodeId??'');
  setMessage(r.enabled?'Choose a task and computer. Reads and saves start only when you request them.':'New Nexus requests are not enabled yet. Existing saved proposals can still be recovered.');
 }catch{if(current){setOwner('');setMessage('Sign in as the Mastermind owner to connect Nexus. The connection may also be unavailable.');}}})();return()=>{current=false;};},[]);
 const task=tasks.find(t=>t.taskId===taskId);
 const node=nodes.find(n=>n.nodeId===nodeId),supported=node?.worker?.capabilities.some(c=>c.id==='mastermind.native.nexus'&&c.version===1);
 const transport=useMemo(()=>owner&&task&&nodeId?new NexusHostedTransport({ownerKey:owner,nodeId,ref:{taskId:task.taskId,project:task.project},storage:{getItem:(k:string)=>window.localStorage.getItem(k),setItem:(k:string,v:string)=>window.localStorage.setItem(k,v),removeItem:(k:string)=>window.localStorage.removeItem(k)}}):null,[owner,task,nodeId]);
 return <section style={{background:'#0b1d2a',color:'#f5f8ff',padding:16,marginBottom:16}} aria-label="Nexus connection">
  <h2>Nexus planning</h2><p role="status">{message}</p>
  {owner?<><label>Task <select style={field} value={taskId} onChange={e=>setTaskId(e.target.value)}>{tasks.map(t=><option key={t.taskId} value={t.taskId}>{t.title}</option>)}</select></label>{' '}
  <label>Computer <select style={field} value={nodeId} onChange={e=>setNodeId(e.target.value)}>{nodes.map(n=><option key={n.nodeId} value={n.nodeId}>{n.displayName} · {n.connectivity}</option>)}</select></label>
  <p>Unfinished proposals stay with their original task and computer. Return to that selection to recover them.</p></>:null}
  {node?<p>{supported?'This computer advertises Nexus reads.':'This computer has not advertised Nexus reads yet; new reads will wait for a compatible worker.'} Last contact: {node.lastExchangeAt?new Date(node.lastExchangeAt).toLocaleString():'not yet recorded'}.</p>:null}
  {task&&transport?<NexusProposalOwner key={`${owner}:${nodeId}:${taskId}`} ownerKey={`${owner}:${nodeId}`} task={task} transport={transport}/>:null}
 </section>;
}
