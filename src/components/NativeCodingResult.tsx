'use client';
import {validateBuildDispatchReceipt} from '../../protocol/mastermind-node-exchange/native-build-dispatch.mjs';

const button={padding:'8px 12px',margin:'8px 8px 0 0',background:'#164350',color:'#fff',border:'1px solid #377888',borderRadius:5};
export default function NativeCodingResult({value,disabled,onAction}:{value:unknown;disabled:boolean;onAction:(action:string)=>void}) {
 const r=validateBuildDispatchReceipt(value);
 const ready=r.observedAction==='preflight'&&r.ok&&r.state==='ready_for_separate_dispatch'&&r.holds.length===0;
 const explanation:Record<string,string>={
  BUILD_DISTINCT_CODING_AUTHORITY_REQUIRED:'Coding needs its own authorization for this saved plan.',
  SPEC_REVIEW_TASK_SNAPSHOT_CHANGED:'The task changed. Review the current requirements before coding.',
  SPEC_REVIEW_ACTIVE_REVISION_CHANGED:'The active capability changed. Review its current version.',
  TASK_BUILD_DISPATCH_RECONCILIATION_REQUIRED:'The last coding response was uncertain. Recover the saved operation before continuing.'
 };
 return <section aria-label="Saved coding progress">
  <h4>{r.sourceReady?'Source ready for independent tests':r.state==='started'?'Coding request recorded':ready?'Coding readiness checked':'Coding status saved'}</h4>
  <p>{r.sourceReady?'Source preparation finished. Independent tests and activation remain separate steps.':r.startAccepted?'The coding request was accepted. Check progress to see its outcome.':ready?'The saved plan passed its readiness check. Starting work will check its authorization again.':r.state==='started'?'The saved operation has started; its completion has not been verified.':'Review the saved status and any unresolved items below.'}</p>
  <p>This is a saved observation. Refreshing this page restores it without starting coding again.</p>
  {r.holds.length>0&&<ul>{r.holds.map((code:string)=><li key={code}>{explanation[code]??code.replace(/_/g,' ').toLowerCase()}</li>)}</ul>}
  {ready&&<button type="button" style={button} disabled={disabled} onClick={()=>onAction('start')}>Start coding</button>}
  {!r.sourceReady&&r.state!=='started'&&<button type="button" style={button} disabled={disabled} onClick={()=>onAction('preflight')}>Recheck coding readiness</button>}
  <button type="button" style={button} disabled={disabled} onClick={()=>onAction('status')}>Check coding progress</button>
  <button type="button" style={button} disabled={disabled} onClick={()=>onAction('recover')}>Recover saved coding work</button>
  <p>No capability has been tested or activated by this handoff.</p>
 </section>;
}
