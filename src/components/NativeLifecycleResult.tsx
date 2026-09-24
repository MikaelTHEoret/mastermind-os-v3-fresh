'use client';
import {validateLifecycleReceipt} from '../../protocol/mastermind-node-exchange/native-contribution-lifecycle.mjs';
const button={padding:'8px 12px',margin:'8px 8px 0 0',background:'#164350',color:'#fff',border:'1px solid #377888',borderRadius:5};
export default function NativeLifecycleResult({value,disabled,onAction}:{value:unknown;disabled:boolean;onAction:(action:string)=>void}){
 const receipt=validateLifecycleReceipt(value),d=receipt.data;
 const unsettled=['running','uncertain','interrupted','held'].includes(d.operationState)||['running','interrupted','held'].includes(d.test?.status);
 return <section aria-label="Candidate tests and versions"><h4>{d.moduleId} · version {d.version}</h4>
  <p>Saved observation: {new Date(receipt.observedAt).toLocaleString()}. Availability and permissions are checked again before each action.</p>
  <p>{d.currentlyActive?(d.activeProxyAvailable?'This version is active.':'This version is recorded as active, but its runtime is unavailable.'):'This candidate is saved; another version may be active.'}</p>
  <p>{d.test?`Tests: ${d.test.completedCases} of ${d.test.caseCount} completed · ${d.test.status}.`:'No test run is recorded.'}</p>
  {d.test?.failedCaseId&&<p>Failed case: {d.test.failedCaseId}</p>}
  {unsettled&&<p>This operation needs recovery. It will not be started again automatically.</p>}
  {d.holds.length>0&&<details><summary>Details to resolve</summary><ul>{d.holds.map((h:string)=><li key={h}>{h.replace(/_/g,' ').toLowerCase()}</li>)}</ul></details>}
  <button type="button" style={button} disabled={disabled} onClick={()=>onAction(receipt.lifecycleOperationId?'recover':'inspect')}>Refresh saved progress</button>
  {receipt.lifecycleOperationId&&<button type="button" style={button} disabled={disabled||unsettled} onClick={()=>onAction('inspect')}>Check current version</button>}
  <button type="button" style={button} disabled={disabled||unsettled||d.test!==null||d.recordedOutcome!==null||d.currentlyActive} onClick={()=>onAction('test')}>Run isolated tests</button>
  <button type="button" style={button} disabled={disabled||unsettled||d.recordedOutcome!=='passed'||d.currentlyActive} onClick={()=>onAction('promote')}>Activate tested version</button>
  <button type="button" style={button} disabled={disabled||unsettled||!d.currentlyActive||!d.rollbackAccepted} onClick={()=>onAction('rollback')}>Restore previous version</button>
  <p>Testing executes only the frozen cases. Activation changes the working version; restoring the previous version keeps this candidate and its evidence.</p>
 </section>;
}
