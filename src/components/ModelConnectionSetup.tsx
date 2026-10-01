"use client";
import {useRef,useState} from 'react';
import styles from './SharedRoomConsole.module.css';

export default function ModelConnectionSetup(){
 const [zai,setZai]=useState(true),[gemini,setGemini]=useState(false),[free,setFree]=useState(false);
 const [busy,setBusy]=useState(false),[policy,setPolicy]=useState(''),[error,setError]=useState('');
 const running=useRef(false);
 function clear(){setPolicy('');setError('');}
 async function prepare(){
  if(running.current||(!zai&&!gemini)||(gemini&&!free))return;
  running.current=true;setBusy(true);clear();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
   const response=await fetch('/api/chat/connections/prepare',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,
    headers:{'Content-Type':'application/json'},body:JSON.stringify({catalogVersion:'2026-10-01-v1',providers:[...(zai?['zai']:[]),...(gemini?['gemini']:[])],geminiFreeTierConfirmed:gemini&&free})});
   if(!response.ok){setError(response.status===401||response.status===403?'Sign in as the Mastermind owner to prepare setup.':'Setup could not be prepared. Check that the selected keys are saved in Production and included in this deployment.');return;}
   const result=await response.json();
   if(result.status!=='prepared'||result.activated!==false||result.providerRequests!==0||result.policy?.allowPaid!==false)throw Error('Invalid proposal');
   setPolicy(JSON.stringify(result.policy,null,2));
  }catch{setError('Setup could not be checked. No activation was requested; you can try preparing again.');}
  finally{clearTimeout(timer);running.current=false;setBusy(false);}
 }
 return <details><summary>Set up direct model connections</summary>
  <p>Use API keys already saved in this website’s private Production settings. This checks their presence and prepares an account binding; it does not test a key with its provider, activate a connection, or send a prompt.</p>
  <label className={styles.check}><input type="checkbox" checked={zai} disabled={busy} onChange={e=>{clear();setZai(e.target.checked);}}/>Set up Z.ai for its free model</label>
  <label className={styles.check}><input type="checkbox" checked={gemini} disabled={busy} onChange={e=>{clear();setGemini(e.target.checked);setFree(false);}}/>Set up Gemini</label>
  {gemini&&<label className={styles.check}><input type="checkbox" checked={free} disabled={busy} onChange={e=>{clear();setFree(e.target.checked);}}/>I checked that this key’s Google AI Studio project uses the Free tier.</label>}
  <p>Paid models stay disabled. The prepared binding expires after 24 hours. Provider pricing and the account tier must be reviewed before activation.</p>
  <button disabled={busy||(!zai&&!gemini)||(gemini&&!free)} onClick={()=>void prepare()}>{busy?'Checking saved keys…':'Prepare connection setup'}</button>
  {error&&<p role="alert">{error}</p>}
  {policy&&<><p role="status">Setup prepared. No connection was activated. Finish the reviewed server configuration before asking a model.</p>
   <details><summary>Technical setup details</summary><label>Prepared server policy<textarea readOnly value={policy} rows={10}/></label></details></>}
 </details>;
}
