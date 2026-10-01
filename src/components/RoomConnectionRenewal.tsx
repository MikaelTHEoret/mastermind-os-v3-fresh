"use client";
import {useState} from 'react';
import styles from './SharedRoomConsole.module.css';

export default function RoomConnectionRenewal({connection,locked,act,refresh}:{connection:any;locked:boolean;
 act:(action:string,fields:Record<string,unknown>)=>Promise<unknown>;refresh:()=>Promise<void>}){
 const [review,setReview]=useState(false),[free,setFree]=useState(false);
 const offer=connection?.renewal;
 return <details><summary>Connection status and renewal</summary>
  <p>{connection?.expiresAt?`Connection review expires ${new Date(connection.expiresAt).toLocaleString()}.`:'No current connection review is available for this room.'}</p>
  <p>Configuration is checked when the room loads and before each send. Provider quota and availability are only known when a request is made.</p>
  {connection?.checkedAt&&<p>Checked: {new Date(connection.checkedAt).toLocaleString()}</p>}
  <button disabled={locked} onClick={()=>void refresh()}>Refresh connection status</button>
  {offer?<>
   <p>Renew this room’s {offer.providers.join(' and ')} connections for up to 24 hours without a deployment. This sends no prompt, changes no key and enables no paid model. Other rooms keep their own reviews.</p>
   <p>Server pricing review is valid until {new Date(offer.catalogReviewUntil).toLocaleString()}; renewal cannot extend it.</p>
   <label className={styles.check}><input type="checkbox" disabled={locked} checked={review} onChange={e=>setReview(e.target.checked)}/>I reviewed the selected providers and want to renew this room’s free-model connections.</label>
   {offer.geminiFreeTierRequired&&<label className={styles.check}><input type="checkbox" disabled={locked} checked={free} onChange={e=>setFree(e.target.checked)}/>I checked that this Gemini project still uses the Free tier.</label>}
   <button disabled={locked||!review||(offer.geminiFreeTierRequired&&!free)} onClick={()=>void act('renew-connection',{
    scopeDigest:offer.scopeDigest,reviewConfirmed:review,geminiFreeTierConfirmed:offer.geminiFreeTierRequired&&free})}>Renew this room for 24 hours</button>
  </>:<p>Renewal needs an enabled server connection, unchanged credentials and a current catalog review. Renewing cannot resolve a provider rate limit or an uncertain send.</p>}
 </details>;
}
