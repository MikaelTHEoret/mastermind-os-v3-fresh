"use client";
import {useEffect,useRef,useState} from 'react';
import {observationLabels,observationErrors} from '../lib/chat-room/observation-client.mjs';
import {browserControl,controlErrors} from '../lib/chat-room/browser-control.mjs';
import styles from './SharedRoomConsole.module.css';
type Ref={taskId:string;session:string};
type Observation={state:string;checkedAt:string;connected?:boolean;lastObservation?:{at:string};diagnostic?:{code:string;at:string};answer?:{text:string;observedAt:string}};
const labels=observationLabels as Record<string,string>,errors={...observationErrors,...controlErrors} as Record<string,string>;
export default function BrowserObservation({room,turnId}:{room:Ref;turnId:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[value,setValue]=useState<Observation|null>(null),[available,setAvailable]=useState(false);
 const generation=useRef(0),working=useRef(false);
 useEffect(()=>{let alive=true;generation.current++;working.current=false;setBusy(false);setValue(null);setError('');setAvailable(false);
  void browserControl(window,room,turnId,'discover',{timeout:2500}).then(()=>{if(alive)setAvailable(true);}).catch(()=>{});
  return()=>{alive=false;generation.current++;};
 // Each room owns its connection; late results cannot appear after navigation.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[room.taskId,room.session,turnId]);
 async function read(action:'status'|'check'|'reconnect'|'pause'|'disconnect'){
  if(working.current)return;working.current=true;setBusy(true);setError('');const ticket=++generation.current;
  try{const result=await browserControl(window,room,turnId,action);if(ticket===generation.current){setAvailable(true);setValue(result as Observation);}}
  catch(e){if(ticket===generation.current){setValue(null);setError(e instanceof Error?e.message:'Browser connection unavailable.');}}
  finally{if(ticket===generation.current){working.current=false;setBusy(false);}}
 }
 return <section className={styles.recovery} aria-label="Browser controls"><h3>Browser controls</h3>
  <p>{available?'Browser extension detected. This room uses its remembered permission; no connection code is needed.':'For first use, reload the updated extension, enable “Control this room from Mastermind” once, then refresh this page.'}</p>
  <div className={styles.actions}>
   <button disabled={busy} onClick={()=>void read('status')}>Read browser status</button>
   <button disabled={busy} onClick={()=>void read('reconnect')}>Find and reconnect conversation</button>
   <button disabled={busy} onClick={()=>void read('check')}>Check existing reply</button>
   <button disabled={busy} onClick={()=>void read('pause')}>Pause browser discussion</button>
   <button disabled={busy} onClick={()=>void read('disconnect')}>Disconnect browser controls</button>
  </div>
  <p>Mastermind finds the matching open Z.ai conversation and checks the original prompt before using it. These controls never send a prompt or save a reply. Pausing cannot undo a prompt already sent.</p>
  {busy&&<p role="status">Checking the saved room and browser connection…</p>}{error&&<p role="alert">{error}</p>}
  {value&&<div role="status"><strong>{value.connected===false?'Browser controls disconnected.':labels[value.state]}</strong><p>Record read: {new Date(value.checkedAt).toLocaleString()}. {value.lastObservation?`Last reply check: ${new Date(value.lastObservation.at).toLocaleString()}.`:'No dated reply check recorded yet.'}</p>
   {value.diagnostic&&<p role="alert">{errors[value.diagnostic.code]??'The last extension action failed.'} Recorded {new Date(value.diagnostic.at).toLocaleString()}.</p>}
   {value.answer&&<><p>Captured draft from {new Date(value.answer.observedAt).toLocaleString()}. Review before saving through the room controls.</p><pre className={styles.code}>{value.answer.text}</pre></>}
  </div>}
 </section>;
}
