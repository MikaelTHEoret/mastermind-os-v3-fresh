'use client';
import {useEffect,useRef,useState} from 'react';
import {ValueField,type NativeJson,type NativeSchema} from './NativeCapabilityInputs';
import {reviewCanonical,validateNativeReviewInput} from '../../protocol/mastermind-node-exchange/native-review-contract.mjs';
export type ReviewContent={schemaVersion:number;specificationId:string;requestSha256:string;mode:string;expectedActiveRevision:string|null;reuseEvidence:unknown;
 requirements:{moduleId:string;version:string;requirements:string[];contracts:{name:string;inputSchema:NativeSchema;outputSchema:NativeSchema}[];
 tests:{schemaVersion:number;cases:{id:string;capability:string;input:NativeJson;expected?:NativeJson;expectedError?:{type:string;message:string}}[]}};
 coverage:{start:number;end:number;text:string;requirements:number[];status:string}[]};
const field={width:'100%',boxSizing:'border-box' as const,background:'#fff',color:'#172b35',colorScheme:'light',padding:10,font:'inherit'};
const button={background:'#164350',color:'#fff',padding:10,border:'1px solid #64828e',margin:'8px 0'};
export default function NativeReviewEditor({specificationId,parentOperationId,taskRef,request,disabled,onSave}:{specificationId:string;parentOperationId:string;
 taskRef:{taskId:string;project:string};request:string;disabled:boolean;onSave:(content:ReviewContent)=>Promise<void>}) {
 const [content,setReviewContent]=useState<ReviewContent|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const ticket=useRef(0),active=useRef(false);
 const key='mastermind.review-draft.v1.'+parentOperationId;
 const input=(c:ReviewContent)=>({schemaVersion:1,action:'prepare',taskRef,operationId:'00000000-0000-4000-8000-000000000000',specificationId,parentOperationId,originalRequest:request,content:c});
 async function checked(c:ReviewContent,draft=false) {
   const candidate=structuredClone(c);
   if(draft&&Array.isArray(candidate?.requirements?.requirements))candidate.requirements.requirements=candidate.requirements.requirements.map(text=>typeof text==='string'&&!text.trim()?'Unfinished requirement':text);
   validateNativeReviewInput(input(candidate));
   const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(reviewCanonical(request)));
   if(Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')!==c.requestSha256)throw Error('This review belongs to a different saved description.');
   const characters=Array.from(request);
   if(c.coverage.some(s=>characters.slice(s.start,s.end).join('')!==s.text))throw Error('A source passage does not match the saved description.');
   return c;
 }
 useEffect(()=>{const current=++ticket.current;void(async()=>{try{const raw=localStorage.getItem(key);if(raw&&raw.length<=32768){const c=await checked(JSON.parse(raw),true);if(current===ticket.current)setReviewContent(c);}}catch{if(current===ticket.current)setError('The unsent review could not be restored. Load its prepared file again.');}})();return()=>{ticket.current++;};},[key]); // The saved operation fixes the request and task.
 function update(c:ReviewContent){setReviewContent(c);try{localStorage.setItem(key,JSON.stringify(c));setError('');}catch{setError('These edits could not be saved in this browser. Keep this page open.');}}
 async function load(file?:File){if(!file)return;const current=++ticket.current;setBusy(true);setError('');try{
   if(file.size>16384)throw Error('Choose a prepared review of 16 KB or less.');
   const c=await checked(JSON.parse(await file.text()));if(current===ticket.current)update(c);
 }catch(e){if(current===ticket.current)setError(e instanceof Error?e.message:'The review could not be loaded.');}finally{if(current===ticket.current)setBusy(false);}}
 async function save(){if(active.current||disabled||busy||!content)return;active.current=true;setBusy(true);setError('');try{await onSave(await checked(content));}catch{setError('The review could not be submitted. Its saved operation must be recovered before submitting a different review.');}finally{active.current=false;setBusy(false);}}
 const locked=disabled||busy;
 return <section aria-label="Review requirements and examples"><h4>Review requirements and examples</h4>
  <p>Load a prepared review for this saved request, then inspect its behavior and test cases. Saving records a proposal; testing and activation are separate steps.</p>
  <label>Prepared review file<input type="file" accept=".json,application/json" disabled={locked} onChange={e=>void load(e.currentTarget.files?.[0])}/></label>
  {error&&<p role="alert">{error}</p>}
  {content&&<><p>{content.requirements.moduleId} · {content.requirements.version} · {content.mode}</p>
   {content.requirements.requirements.map((text,i)=><label key={i} style={{display:'block',marginTop:12}}>Requirement {i+1}<textarea style={field} rows={3} value={text} disabled={locked} maxLength={4000} onChange={e=>{const next=structuredClone(content);next.requirements.requirements[i]=e.target.value;update(next);}}/></label>)}
   <h5>Coverage of the saved request</h5>{content.coverage.map((span,i)=><div key={i}><blockquote>{span.text}</blockquote><p>Requirements {span.requirements.map(n=>n+1).join(', ')}</p>
    <label><input type="checkbox" checked={span.status==='covered'} disabled={locked} onChange={e=>{const next=structuredClone(content);next.coverage[i].status=e.target.checked?'covered':'uncertain';update(next);}}/>These requirements cover this passage</label></div>)}
   <h5>Acceptance examples</h5>{content.requirements.tests.cases.map((test,i)=>{const contract=content.requirements.contracts.find(c=>c.name===test.capability);return <fieldset key={test.id} disabled={locked}><legend>Example {i+1} · {test.capability}</legend>
    {contract&&<ValueField name="Supplied inputs" schema={contract.inputSchema} value={test.input} disabled={locked} onChange={v=>{const next=structuredClone(content);next.requirements.tests.cases[i].input=v;update(next);}}/>}
    {contract&&Object.prototype.hasOwnProperty.call(test,'expected')&&<ValueField name="Expected result" schema={contract.outputSchema} value={test.expected} disabled={locked} onChange={v=>{const next=structuredClone(content);next.requirements.tests.cases[i].expected=v;update(next);}}/>}
    {test.expectedError&&<p>Must reject with {test.expectedError.type}: {test.expectedError.message}</p>}
   </fieldset>;})}
   <button type="button" style={button} disabled={locked} onClick={()=>void save()}>Save review proposal</button>
  </>}
 </section>;
}
