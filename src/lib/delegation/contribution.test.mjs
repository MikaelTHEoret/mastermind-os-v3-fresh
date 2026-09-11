import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRecord,validateParent,assignmentPrompt,canonical} from './contract.mjs';
import {ContributionStore,digest} from './store.mjs';
const ref={taskId:'4196249c-dcbd-41cc-9e6f-8b87b7b2cdda',project:'mastermind'};
const owner={householdId:'fixture',actorPlayerId:'8619c07c-fd41-4914-b83c-21d75cae502f'};
const assignment=()=>({schemaVersion:1,kind:'assignment',operationId:randomUUID(),taskRef:ref,title:'Review a parser',request:'Find a reproducible defect.',context:'Public source café 📚',sourceRefs:['public/revision/file.py'],criteria:['Show a failing input.'],providers:['chatgpt','grok'],disclosure:'public-material'});
const row=record=>({artifactId:digest(record),record,recordedAt:'2026-09-11T00:00:00.000Z'});
const response=parent=>({schemaVersion:1,kind:'response',operationId:randomUUID(),taskRef:ref,parentId:parent.artifactId,provider:'grok',model:null,conversationUrl:'https://grok.com/c/fixture',captureMode:'manual',text:' Original response\nwith café and code.\n'});
function memoryQuery(){
 const records=new Map();let allowed=true,active=true,writes=0;
 const query=async(sql,args)=>{
  if(sql.includes('SELECT t.task_id::text'))return allowed&&(!args[4]||active)?[{taskId:ref.taskId}]:[];
  if(sql.includes('INSERT INTO')){if(!allowed||!active)return [];const record=JSON.parse(args[8]);const key=record.kind+':'+record.operationId;if(records.has(key)||records.size>=64)return [];records.set(key,row(record));writes++;return [{artifactId:digest(record)}];}
  if(!allowed)return [];
  if(sql.includes('a.kind=$5'))return [...records.values()].filter(r=>r.record.kind===args[4]&&r.record.operationId===args[5]);
  if(sql.includes('a.artifact_id=$5'))return [...records.values()].filter(r=>r.artifactId===args[4]);
  return [...records.values()];
 };
 return {query,records,get writes(){return writes;},revoke(){allowed=false;},complete(){active=false;}};
}
test('same submission recovers after controller reconstruction without duplicated writes',async()=>{
 const db=memoryQuery(),first=new ContributionStore(db.query,owner),a=assignment();
 const saved=await first.save(a);assert.equal(saved.status,'created');
 const fresh=new ContributionStore(db.query,owner);assert.equal((await fresh.save(a)).status,'duplicate');
 assert.equal(db.writes,1);assert.deepEqual((await fresh.list(ref))[0].record,a);
 await assert.rejects(fresh.save({...a,title:'Changed request'}),{code:'CONTRIBUTION_OPERATION_CONFLICT'});
 assert.equal(db.writes,1);
});
test('original response is immutable and acceptance remains a separate advisory record',async()=>{
 const db=memoryQuery(),store=new ContributionStore(db.query,owner);
 const a=(await store.save(assignment())).artifact,r=response(a),saved=(await store.save(r)).artifact;
 const review={schemaVersion:1,kind:'review',operationId:randomUUID(),taskRef:ref,parentId:saved.artifactId,decision:'accepted-as-advice',assessment:'One supported finding.',evidenceRefs:['test-receipt/fixture']};
 const accepted=await store.save(review);assert.equal(accepted.executionAuthorized,false);
 assert.equal((await store.get(ref,saved.artifactId)).record.text,r.text);assert.equal(db.writes,3);
});
test('revoked owner cannot write or recover retained contributions',async()=>{
 const db=memoryQuery(),store=new ContributionStore(db.query,owner),a=(await store.save(assignment())).artifact;
 db.revoke();await assert.rejects(store.list(ref),{code:'CONTRIBUTION_TASK_ACCESS_DENIED'});
 await assert.rejects(store.get(ref,a.artifactId),{code:'CONTRIBUTION_UNAVAILABLE'});
 await assert.rejects(store.save(response(a)),{code:'CONTRIBUTION_TASK_ACCESS_DENIED'});assert.equal(db.writes,1);
});
test('completed task is readable but no longer accepts external work',async()=>{
 const db=memoryQuery(),store=new ContributionStore(db.query,owner),a=(await store.save(assignment())).artifact;
 db.complete();assert.equal((await store.list(ref)).length,1);
 await assert.rejects(store.save(response(a)),{code:'CONTRIBUTION_TASK_ACCESS_DENIED'});
});
test('missing, foreign-task, wrong-kind and unassigned-provider parents fail before save',async()=>{
 const a=row(assignment()),r=response(a);
 assert.throws(()=>validateParent(r,null));
 assert.throws(()=>validateParent({...r,taskRef:{...ref,taskId:randomUUID()}},a));
 assert.throws(()=>validateParent({...r,provider:'zai'},a));
 assert.throws(()=>validateParent(r,row(r)));
 const db=memoryQuery(),store=new ContributionStore(db.query,owner);
 await assert.rejects(store.save(r));assert.equal(db.writes,0);
});
test('invalid URLs, forged capture modes, authority fields and oversized responses fail',()=>{
 const a=row(assignment()),r=response(a);
 for(const change of [{conversationUrl:'javascript:alert(1)'},{conversationUrl:'https://user:secret@grok.com/c/x'},
  {conversationUrl:'https://grok.com/c/x?token=secret'},{conversationUrl:'https://chatgpt.com/c/x'},
  {captureMode:'verified-browser'},{executionAuthorized:true},{text:'x'.repeat(65537)},{text:'\ud800'}]){
  assert.throws(()=>validateRecord({...r,...change}));
 }
 assert.throws(()=>validateRecord({...assignment(),providers:['chatgpt','chatgpt']}));
});
test('export binds the exact assignment, criteria and selected evidence without automatic delivery',()=>{
 const a=row(assignment()),text=assignmentPrompt(a,'chatgpt');
 assert.ok(text.includes(a.artifactId)&&text.includes(a.record.context)&&text.includes('Show a failing input.'));
 assert.ok(text.includes('Do not execute changes'));assert.throws(()=>assignmentPrompt(a,'zai'));
 assert.equal(canonical(a.record),canonical(Object.fromEntries(Object.entries(a.record).reverse())));
});
test('altered stored bytes fail integrity verification before disclosure',async()=>{
 const db=memoryQuery(),store=new ContributionStore(db.query,owner),a=assignment();await store.save(a);
 db.records.get('assignment:'+a.operationId).record.context='corrupted';
 await assert.rejects(store.list(ref),{code:'CONTRIBUTION_STORED_HASH_MISMATCH'});
});
