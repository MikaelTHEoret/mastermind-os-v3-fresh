"use client";
import {useEffect,useRef,useState} from 'react';
import {requestObservation,observationLabels,observationErrors} from '../lib/chat-room/observation-client.mjs';
import styles from './SharedRoomConsole.module.css';
type Ref={taskId:string;session:string};
type Observation={state:string;checkedAt:string;lastObservation?:{at:string};diagnostic?:{code:string;at:string};answer?:{text:string;observedAt:string;sha256:string}};
const labels=observationLabels as Record<string,string>,errors=observationErrors as Record<string,string>;
export default function BrowserObservation({room,turnId}:{room:Ref;turnId:string}){
 const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[value,setValue]=useState<Observation|null>(null);
 const generation=useRef(0),working=useRef(false);
 useEffect(()=>{generation.current++;working.current=false;setValue(null);setError('');setBusy(false);return()=>{generation.current++;};},[room.taskId,room.session,turnId]);
 async function read(action:'status'|'check'){
  if(working.current)return;working.current=true;setBusy(true);setError('');const ticket=++generation.current;
  try{
   const runtime=(window as unknown as {chrome?:{runtime?:unknown}}).chrome?.runtime;
   const result=await requestObservation(runtime,code.trim(),room,turnId,action);
   if(ticket===generation.current)setValue(result as Observation);
  }catch(e){if(ticket===generation.current){setValue(null);setError(e instanceof Error?e.message:'Browser connection unavailable.');}}
  finally{if(ticket===generation.current){working.current=false;setBusy(false);}}
 }
 return <details className={styles.recovery}><summary>Browser connection and reply recovery</summary>
  <p>In the updated extension, choose “Connect this turn’s status”, then paste its connection code here. Use the original Mastermind tab. The connection expires after 30 minutes.</p>
  <label>Browser connection code<input value={code} autoComplete="off" spellCheck={false} maxLength={32} disabled={busy} onChange={e=>{setCode(e.target.value);setValue(null);setError('');}}/></label>
  <div className={styles.actions}><button disabled={busy||!code.trim()} onClick={()=>void read('status')}>Read connection status</button><button disabled={busy||!code.trim()} onClick={()=>void read('check')}>Check existing reply</button></div>
  <p>These controls never send a prompt or save a reply. Checking works with the transfer page closed. A reply may need a second check after a few seconds to confirm that it stopped changing.</p>
  {busy&&<p role="status">Checking this turn’s browser record…</p>}{error&&<p role="alert">{error}</p>}
  {value&&<div role="status"><strong>{labels[value.state]}</strong><p>Record read: {new Date(value.checkedAt).toLocaleString()}. {value.lastObservation?`Last reply check: ${new Date(value.lastObservation.at).toLocaleString()}.`:'No dated reply check recorded yet.'}</p>
   {value.diagnostic&&<p role="alert">{errors[value.diagnostic.code]??'The last extension action failed.'} Recorded {new Date(value.diagnostic.at).toLocaleString()}.</p>}
   {value.answer&&<><p>Captured draft from {new Date(value.answer.observedAt).toLocaleString()}. Compare with the provider before saving through the existing room controls.</p><pre className={styles.code}>{value.answer.text}</pre></>}
  </div>}
 </details>;
}
