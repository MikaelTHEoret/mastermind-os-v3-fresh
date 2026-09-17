'use client';
import {REVIEW_ARTIFACTS,REVIEW_BUILD_PLAN,validateDevelopmentReceipt} from '../../protocol/mastermind-node-exchange/native-development-work.mjs';

const button={padding:'8px 12px',margin:'8px 8px 0 0',background:'#164350',color:'#fff',border:'1px solid #377888',borderRadius:5};
export default function NativeDevelopmentResult({value,disabled,buildSupported,onAction}:{value:unknown;disabled:boolean;buildSupported:boolean;onAction:(kind:string,action:string)=>void}) {
 const r=validateDevelopmentReceipt(value);
 const artifact=r.kind===REVIEW_ARTIFACTS;
 const explanation:Record<string,string>={MATERIALIZER_REF_NOT_PUBLISHED:'The source branch was checked and has not been published.',SPEC_REVIEW_TASK_SNAPSHOT_CHANGED:'The task changed after this review. Review the current requirements again.',SPEC_REVIEW_ACTIVE_REVISION_CHANGED:'The active module changed after this review.'};
 return <section aria-label="Saved development progress">
  <h4>{artifact?(r.artifactState==='published'?'Source package published':r.artifactState==='prepared'?'Publication needs reconciliation':'Source package prepared'):(r.state==='held'?'Build plan needs attention':'Build plan saved')}</h4>
  {artifact?<><p>{r.fileCount} source files retained with the saved requirements and acceptance examples. Candidate tests have not run.</p>
    <p>{r.gitVerifiedAt?`Publication verified on ${new Date(r.gitVerifiedAt).toLocaleString()}.`:'This is a saved record; publication has not been verified by this response.'}</p>
    {r.artifactState==='proposed'&&<button type="button" style={button} disabled={disabled||r.holds.length>0} onClick={()=>onAction(REVIEW_ARTIFACTS,'publish')}>Publish source package</button>}
    <button type="button" style={button} disabled={disabled} onClick={()=>onAction(REVIEW_ARTIFACTS,'reconcile')}>Check publication</button>
    {r.artifactState==='prepared'&&r.holds.length===1&&r.holds[0]==='MATERIALIZER_REF_NOT_PUBLISHED'&&<button type="button" style={button} disabled={disabled} onClick={()=>onAction(REVIEW_ARTIFACTS,'resume')}>Resume publication</button>}
    {r.artifactState==='published'&&r.holds.length===0&&<button type="button" style={button} disabled={disabled||!buildSupported} onClick={()=>onAction(REVIEW_BUILD_PLAN,'prepare')}>Prepare build plan</button>}
    {r.artifactState==='published'&&!buildSupported&&<p>This computer has not enabled build planning.</p>}
  </>:<><p>{r.state==='awaiting_coding_authority'?'Ready for a separately authorized coding step.':'Resolve the items below before coding.'} Coding has not started.</p>
    <p>{r.current?'The recorded plan matched the reviewed source at its last check.':'The saved plan no longer matches the current task or module.'}</p>
    <button type="button" style={button} disabled={disabled||!buildSupported} onClick={()=>onAction(REVIEW_BUILD_PLAN,'recover')}>Recheck build plan</button>
  </>}
  {r.holds.length>0&&<ul>{r.holds.map((code:string)=><li key={code}>{explanation[code]??code.replace(/_/g,' ').toLowerCase()}</li>)}</ul>}
  <p>No capability has been activated by these steps.</p>
 </section>;
}
