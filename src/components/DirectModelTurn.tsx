"use client";
import {useState} from 'react';
import styles from './SharedRoomConsole.module.css';

export type ModelOption={id:string;label:string;paid:boolean;ready:boolean;reason:string;privacy:string};
export default function DirectModelTurn({turn,quote,model,locked,paused,act,refresh}:{
 turn:any;quote:any;model?:ModelOption;locked:boolean;paused:boolean;
 act:(action:string,fields?:Record<string,unknown>)=>Promise<unknown>;refresh:()=>Promise<void>;
}){
 const [share,setShare]=useState(false),[paid,setPaid]=useState(false),[reviewed,setReviewed]=useState(false);
 const receipt=turn.provider;
 return <div aria-label="Direct model connection">
  {turn.status==='prepared'?<>
   <p>{model?.label??'Selected API model'} · {model?.paid?'Optional paid model':'Free-tier model'}</p>
   <p>{model?.privacy}</p>
   {!quote?<p role="status">{model?.reason??'This connection needs server setup.'} Refresh the room after setup.</p>:<>
    <p>One text reply, up to {quote.maxOutputTokens} output tokens. No automatic fallback or next turn.</p>
    {quote.paid&&<p>Estimated cost: ${(quote.estimatedUsdMicros/1000000).toFixed(4)} USD. This is an estimate, not a provider billing cap.</p>}
    <label className={styles.check}><input type="checkbox" checked={share} onChange={e=>setShare(e.target.checked)}/>I reviewed the exact prompt above and approve sharing it with this provider.</label>
    {quote.paid&&<label className={styles.check}><input type="checkbox" checked={paid} onChange={e=>setPaid(e.target.checked)}/>Use this paid model for this one reply.</label>}
    <button disabled={locked||paused||turn.steeringPending||!share||(quote.paid&&!paid)} onClick={()=>void act('provider-send',{approval:{quote,shareApproved:share,paidApproved:quote.paid&&paid}})}>Ask this model once</button>
   </>}
   <button disabled={locked} onClick={()=>void act('cancel')}>Discard prepared turn</button>
  </>:receipt?.state==='draft'?<>
   <p role="status">Reply received. Review it before saving to the room.</p>
   {!receipt.complete&&<p className={styles.notice}>The provider stopped before a complete reply. Saving preserves it as partial and pauses the room.</p>}
   <pre className={styles.prompt}>{receipt.text}</pre>
   <label className={styles.check}><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed this exact response.</label>
   <button disabled={locked||!reviewed} onClick={()=>void act('provider-review',{responseSha256:receipt.textSha256,reviewed:true})}>Save reviewed {receipt.complete?'reply':'partial reply'} to room</button>
  </>:<>
   <p role="status">{receipt?.state==='unknown'?'The request outcome needs reconciliation.':'The send is reserved or in progress.'}</p>
   <p>Refresh checks the saved result; it never sends again. If the request was interrupted and no result arrives, this turn stays unresolved.</p>
   {receipt?.code&&<p>Observation: {receipt.code}</p>}
   {receipt?.at&&<p>Started: {new Date(receipt.at).toLocaleString()}</p>}
   <button disabled={locked} onClick={()=>void refresh()}>Check saved result</button>
  </>}
 </div>;
}
