'use client';
import {useState} from 'react';

export type ReviewReuseResult={action:'assess'|'accept';specificationId:string;reviewId:string;
 acceptedSpecificationId:string;qualificationId:string;candidateId:string;operationId:string;
 differences?:string[];holds?:string[];exampleCount?:number;coveredCount?:number;suiteCaseCount?:number;
 existingOperationId?:string|null;existingLinkId?:string|null;linkId?:string;replayed:boolean};
const labels:Record<string,string>={
 authority:'Keep the accepted permission statement. The historical review cannot grant new access.',
 acceptanceWorkflow:'Keep the complete accepted testing and recovery procedure.',
 examples:'Keep the accepted descriptive examples, including their original spelling.',
 tests:'Retain the full accepted test suite and attach the verified review examples as additional evidence.',
};
export default function NativeReviewReuseResult({value,disabled,onAccept}:{value:ReviewReuseResult;disabled:boolean;onAccept:()=>void}){
 const [checked,setChecked]=useState<string[]>([]);
 if(value.action==='accept')return <section aria-label="Verified reuse link"><h4>Review connected to the accepted capability</h4>
  <p>The original review and full acceptance record remain preserved. This saved link can be recovered from another session.</p>
  <p>No code was run or activated by this decision. Use Find capabilities to supply inputs through the existing execution checks.</p></section>;
 const fields=value.differences??[],holds=value.holds??[];
 return <section aria-label="Review reuse assessment"><h4>Review evidence checked</h4>
  <p>{value.coveredCount} of {value.exampleCount} examples have verified evidence. The complete {value.suiteCaseCount}-case acceptance suite is retained.</p>
  <p>This is the worker's dated assessment. Saving the decision checks the current version, source and permissions again.</p>
  {holds.length>0?<><p>This review cannot be connected yet:</p><ul>{holds.map(h=><li key={h}>{h==='REVIEW_REUSE_FUNCTIONAL_REQUIREMENTS_CHANGED'?'Functional requirements differ from the accepted module. A new review or implementation is required.':h==='REVIEW_REUSE_EXAMPLE_EVIDENCE_REQUIRED'?'Some examples lack matching verified evidence.':h.replace(/_/g,' ').toLowerCase()}</li>)}</ul></>:
   <><p>{value.existingOperationId?'A matching decision is already saved on the core. Confirm these terms to recover it through this shared task.':'Confirm how the differences will be handled before saving the link.'}</p>
   {fields.map(f=><label key={f} style={{display:'block',margin:'12px 0'}}><input type="checkbox" checked={checked.includes(f)} disabled={disabled}
    onChange={e=>setChecked(old=>e.target.checked?[...old,f]:old.filter(x=>x!==f))}/>{' '}{labels[f]??f}</label>)}
   <button type="button" disabled={disabled||fields.some(f=>!labels[f]||!checked.includes(f))} onClick={onAccept}
    style={{padding:'8px 12px',border:'1px solid currentColor',borderRadius:6}}>{value.existingOperationId?'Recover verified reuse decision':'Save verified reuse decision'}</button></>}
 </section>;
}
