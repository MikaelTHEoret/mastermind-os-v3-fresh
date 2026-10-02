import {canonical,taskRef,validateRecord} from './contract.mjs';
import {validateNexusInput,nexusReceipt} from '../../../protocol/mastermind-node-exchange/native-nexus.mjs';
const fail=text=>{throw Error(text);};
const copy=v=>JSON.parse(JSON.stringify(v));
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export async function nexusJson(url,options={}){
 const response=await fetch(url,{...options,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'}});
 const text=await response.text();if(text.length>150000)fail('The saved response is too large.');
 let body;try{body=JSON.parse(text);}catch{fail('The connection did not return a readable result.');}
 if(!response.ok||body.ok!==true||body.executionAuthorized!==false){
  const messages={NEXUS_PROPOSAL_SAVE_DISABLED:'New Nexus requests are not enabled yet.',NEXUS_VERIFICATION_EXPIRED_OR_INVALID:'The source check expired or changed. Request a fresh source check; your proposal stays the same.',NODE_NATIVE_BUSY:'This computer is finishing another task. Your request is retained.',OWNER_REQUIRED:'Sign in with the Mastermind owner account.',NEXUS_VERIFICATION_PENDING:'The source check is still waiting for the computer.'};
  fail(messages[body?.error]??'The request could not be verified. Keep the saved request and check again.');
 }
 return body;
}
/** Explicit owner actions only: construction and reload never send or poll. */
export class NexusHostedTransport{
 constructor({ownerKey,nodeId,ref,storage,request=nexusJson}){
  taskRef(ref);if(!uuid(nodeId)||typeof ownerKey!=='string'||!ownerKey||ownerKey.length>200)fail('Choose an owner and computer.');
  this.ref=copy(ref);this.nodeId=nodeId;this.storage=storage;this.request=request;
  this.key=`mastermind-nexus-transport-v1:${encodeURIComponent(ownerKey)}:${nodeId}:${ref.taskId}:${ref.project}`;
  this.url='/api/nexus/'+ref.taskId;this.busy=false;
 }
 read(){
  const raw=this.storage.getItem(this.key);this.expected=raw;if(raw===null)return {version:1,catalog:null,verify:null};
  if(raw.length>150000)fail('Stored recovery is too large; keep it for recovery.');
  let s;try{s=JSON.parse(raw);}catch{fail('Stored recovery cannot be read.');}
  if(!s||Object.keys(s).sort().join(',')!=='catalog,verify,version'||s.version!==1)fail('Stored recovery is invalid.');
  const input=v=>{validateNexusInput(v);if(canonical(v.taskRef)!==canonical(this.ref))fail('Stored recovery belongs to another task.');};
  if(s.verify!==null){input(s.verify);if(s.verify.action!=='verify')fail('Invalid source-check recovery.');}
  if(s.catalog!==null){const c=s.catalog;if(!c||Object.keys(c).sort().join(',')!=='input,pages'||!Array.isArray(c.pages)||c.pages.length>31)fail('Invalid saved-plan recovery.');input(c.input);if(c.input.action!=='catalog')fail('Invalid catalog recovery.');}
  return s;
 }
 write(s){if(this.storage.getItem(this.key)!==this.expected)fail('Another tab changed this request. Reload to recover its current state.');const raw=JSON.stringify(s);this.storage.setItem(this.key,raw);this.expected=raw;}
 async act(fn){if(this.busy)fail('A Nexus request is already in progress.');this.busy=true;try{return await fn();}finally{this.busy=false;}}
 post(body){return this.request(this.url,{method:'POST',body:JSON.stringify(body)});}
 get(input){return this.request(`${this.url}?nodeId=${this.nodeId}&jobId=${input.operationId}`);}
 async checked(transfer,input){
  if(!transfer||canonical(transfer.input)!==canonical(input)||transfer.job?.jobId!==input.operationId||transfer.job?.nodeId!==this.nodeId||transfer.job?.capability!=='mastermind.native.nexus')fail('The worker result belongs to a different request.');
  if(['queued','leased','running'].includes(transfer.job.state))fail('Waiting for the computer. Use the same button to check this request; it will not create another one.');
  if(transfer.job.state!=='succeeded')fail('The computer did not complete this read. The request is retained for inspection.');
  return nexusReceipt(transfer.job.terminal?.result,input);
 }
 newInput(action,proposal=null,snapshotId=null,cursor=null){return validateNexusInput({schemaVersion:1,operationId:crypto.randomUUID(),taskRef:this.ref,action,proposal,snapshotId,cursor});}
 async load(ref){return this.act(async()=>{
  if(canonical(ref)!==canonical(this.ref))fail('Task selection changed.');
  const s=this.read();if(s.catalog===null){s.catalog={input:this.newInput('catalog'),pages:[]};this.write(s);}
  const c=s.catalog;let previous=null,plans=[];
  // Revalidate retained pages and the entire cursor chain before using a cache.
  for(const page of c.pages){const r=await nexusReceipt(page.receipt,page.input);if(page.input.action!=='catalog'||canonical(page.input.taskRef)!==canonical(ref)||page.input.snapshotId!==(previous?.snapshotId??null)||page.input.cursor!==(previous?.nextCursor??null)||previous&&canonical(previous.basis)!==canonical(r.data.basis)||!r.data.choice||r.data.nextCursor===null)fail('The retained saved-plan pages changed.');previous=r.data;plans.push(r.data.choice);}
  if(c.input.snapshotId!==(previous?.snapshotId??null)||c.input.cursor!==(previous?.nextCursor??null))fail('The saved-plan continuation changed.');
  let {transfer}=await this.get(c.input);
  if(transfer===null)({transfer}=await this.post({action:'catalog',nodeId:this.nodeId,input:c.input}));
  const receipt=await this.checked(transfer,c.input),data=receipt.data;
  if(previous&&canonical(previous.basis)!==canonical(data.basis))fail('The task changed while loading plans. Start a new saved-plan read.');
  if(data.choice){if(plans.some(p=>p.planId===data.choice.planId))fail('Repeated saved-plan page.');plans.push(data.choice);}
  if(data.nextCursor!==null){if(plans.length>=32)fail('The saved-plan limit was exceeded.');c.pages.push({input:c.input,receipt});c.input=this.newInput('catalog',null,data.snapshotId,data.nextCursor);this.write(s);fail('More saved plans are available. Load again to continue from this page.');}
  const history=await this.request(this.url);s.catalog=null;this.write(s);
  if(!plans.length)fail('This task has no saved build plans yet.');
  return {material:{ok:true,viewState:'available',executionAuthorized:false,taskRef:ref,basis:data.basis,plans},artifacts:history.artifacts,executionAuthorized:false};
 });}
 async recover(ref,operationId){
  if(canonical(ref)!==canonical(this.ref)||!uuid(operationId))fail('Invalid saved proposal.');
  const {artifact}=await this.request(`${this.url}?operationId=${operationId}`);
  if(artifact){const s=this.read();if(s.verify&&canonical(s.verify.proposal)===canonical(artifact.record)){s.verify=null;this.write(s);}}
  return artifact;
 }
 async save(record){return this.act(async()=>{
  validateRecord(record);if(canonical(record.taskRef)!==canonical(this.ref))fail('Proposal task changed.');
  const existing=await this.recover(this.ref,record.operationId);if(existing)return {status:'duplicate',artifact:existing,executionAuthorized:false};
  const s=this.read();if(s.verify!==null&&canonical(s.verify.proposal)!==canonical(record))fail('Another source check is retained. Recover it first.');
  if(s.verify===null){s.verify=this.newInput('verify',record);this.write(s);}
  let {transfer}=await this.get(s.verify);
  if(transfer===null){const out=await this.post({action:'verify',nodeId:this.nodeId,operationId:s.verify.operationId,record});if(out.artifact)return out;transfer=out.transfer;}
  await this.checked(transfer,s.verify);
  const out=await this.post({action:'save',nodeId:this.nodeId,operationId:s.verify.operationId,record});
  // Keep exact worker identity until a matching completed proposal is known.
  if(out.artifact&&canonical(out.artifact.record)===canonical(record)){s.verify=null;this.write(s);}return out;
 });}
 async renew(record){return this.act(async()=>{
  const s=this.read();if(!s.verify||canonical(s.verify.proposal)!==canonical(record))fail('No matching source check is retained.');
  const {transfer}=await this.get(s.verify);
  if(!transfer||canonical(transfer.input)!==canonical(s.verify)||!['succeeded','failed','expired'].includes(transfer.job?.state))fail('The previous source check is unfinished or unavailable. Keep its request.');
  s.verify=this.newInput('verify',record);this.write(s);
  return 'Fresh source check prepared. Save the retained proposal to request it.';
 });}
 async restart(){return this.act(async()=>{
  const s=this.read();if(s.catalog){const {transfer}=await this.get(s.catalog.input);
   if(transfer&&(!['succeeded','failed','expired'].includes(transfer.job?.state)||canonical(transfer.input)!==canonical(s.catalog.input)))fail('The saved-plan read is still unfinished. Check it before starting another.');
   // A missing job is retained: a lost response may still be in flight.
   if(transfer===null)fail('The previous read could not be found. Check that same request first.');
  }
  s.catalog=null;this.write(s);return 'Ready for a fresh saved-plan read. Load saved plans to request it.';
 });}
}
