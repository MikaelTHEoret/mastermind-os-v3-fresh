'use client';
import {validateContributionReceipt} from '../../protocol/mastermind-node-exchange/native-contribution.mjs';

const button={padding:'8px 12px',margin:'8px 8px 0 0',background:'#164350',color:'#fff',border:'1px solid #377888',borderRadius:5};
export default function NativeContributionResult({value,disabled,onAction}:{value:unknown;disabled:boolean;onAction:(action:string)=>void}) {
 const result=validateContributionReceipt(value),data=result.data;
 return <section aria-label="Reviewed contribution"><h4>Reviewed contribution</h4>
  <p>Saved observation: {new Date(result.observedAt).toLocaleString()}. Current availability is checked again when you continue.</p>
  {result.action==='catalog'?<>
   {data.choice?<><p>{data.choice.packetAvailable?`${data.choice.moduleId} · version ${data.choice.version}`:'This contribution has no prepared source package.'}</p>
    <p>Selection alone does not verify the source or authorize staging.</p>
    <button type="button" style={button} disabled={disabled||!data.choice.packetAvailable} onClick={()=>onAction('prepare')}>Preview this contribution</button></>:<p>No reviewed contributions are available for this request on this computer.</p>}
   {data.nextCursor&&<button type="button" style={button} disabled={disabled} onClick={()=>onAction('catalog')}>Next contribution</button>}
   {(result.cursor||!data.choice)&&<button type="button" style={button} disabled={disabled} onClick={()=>onAction('catalog-start')}>Start contribution list again</button>}
  </>:<>
   <p>{data.phase==='staged'?'Candidate saved. Behavioral tests and activation remain separate steps.':data.phase==='prepared'?'The import is recorded, but candidate staging has not been verified. Recover its saved state before continuing.':'Preview ready. Staging saves this reviewed source as a candidate for separate testing.'}</p>
   {result.action==='prepare'&&data.phase==='preview'&&<button type="button" style={button} disabled={disabled} onClick={()=>onAction('stage')}>Stage reviewed candidate</button>}
   {result.action==='recover'&&data.phase==='prepared'&&<button type="button" style={button} disabled={disabled} onClick={()=>onAction('stage')}>Finish staging reviewed candidate</button>}
   <button type="button" style={button} disabled={disabled} onClick={()=>onAction('recover')}>Recover saved import</button>
   <button type="button" style={button} disabled={disabled} onClick={()=>onAction('catalog-start')}>Back to contributions</button>
   <details><summary>Source evidence</summary><p>Source revision: {data.sourceCommit}</p><p>Source hash: {data.sourceSha256}</p></details>
  </>}
 </section>;
}
