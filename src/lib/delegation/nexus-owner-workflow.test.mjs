import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NexusOwnerSession,checkedMaterial} from './nexus-owner-workflow.mjs';
import {digest} from './store.mjs';
const ref={taskId:randomUUID(),project:'mastermind'};
const review={schemaVersion:1,kind:'review',operationId:randomUUID(),taskRef:ref,parentId:'c'.repeat(64),decision:'accepted-as-advice',assessment:'Retained original advice',evidenceRefs:['fixture/source']};
const row=record=>({record:structuredClone(record),artifactId:digest(record),recordedAt:'2026-10-01T00:00:00Z'});
const material={ok:true,viewState:'available',executionAuthorized:false,taskRef:ref,
 basis:{checkpointId:randomUUID(),revision:'294',permissionRevision:'2',permissionScopeSha256:'a'.repeat(64)},
 plans:[{specificationId:'b'.repeat(64),planId:'d'.repeat(64),title:'Compare releases',sourceRefs:['mastermind/build-plan/'+'d'.repeat(64),'mastermind/source-evidence/'+'e'.repeat(64)]}]};
function fixture(){
 const data=new Map(),calls=[],rows=[row(review)];let lost=false,denied=false,unavailable=false;
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const transport={async load(r){calls.push(['load',r]);if(denied)throw Error('Access revoked');if(unavailable)throw Error('Reader offline');return {material:structuredClone(material),artifacts:rows};},
  async save(record){calls.push(['save',record]);if(denied)throw Error('Access revoked');let old=rows.find(r=>r.record.operationId===record.operationId),status=old?'duplicate':'created';if(!old){old=row(record);rows.push(old);}if(lost){lost=false;throw Error('Save reply lost');}return {status,artifact:old,executionAuthorized:false};},
  async recover(r,id){calls.push(['recover',r,id]);if(denied)throw Error('Access revoked');return rows.find(r=>r.record.operationId===id)??null;}};
 const fresh=(overrides={})=>new NexusOwnerSession({ownerKey:'owner-fixture',ref,storage,transport,...overrides});
 return {data,storage,transport,calls,rows,fresh,lose:()=>lost=true,deny:()=>denied=true,offline:()=>unavailable=true};
}
const draft={title:'Release comparison',planIds:[material.plans[0].planId],reviewIds:[digest(review)]};

test('lost save reloads without sending and recovers when plan reader is offline',async()=>{
 const f=fixture(),s=f.fresh();await s.load();const record=s.prepare(draft);f.lose();await assert.rejects(s.save(),/reply lost/);
 assert.equal(f.rows.length,2);assert.deepEqual(s.snapshot().pending,record);const count=f.calls.length;
 const fresh=f.fresh();assert.equal(f.calls.length,count);f.offline();await fresh.recover();
 assert.equal(f.calls.filter(c=>c[0]==='save').length,1);assert.equal(f.rows.length,2);assert.equal(fresh.snapshot().pending,null);assert.equal(f.data.size,0);
 assert.match(fresh.snapshot().message,/verified.*No build/);
});
test('not-found recovery keeps exact identity and explicit retry sends the same body',async()=>{
 const f=fixture(),s=f.fresh();await s.load();const record=s.prepare(draft);const fresh=f.fresh();await fresh.recover();
 assert.deepEqual(fresh.snapshot().pending,record);assert.equal(f.calls.filter(c=>c[0]==='save').length,0);
 await fresh.save();assert.deepEqual(f.calls.find(c=>c[0]==='save')[1],record);assert.equal(f.rows.length,2);
});
test('read revocation clears private choices and preserves uncertain operation',async()=>{
 const f=fixture(),s=f.fresh();await s.load();s.prepare(draft);f.deny();await assert.rejects(s.recover(),/Access revoked/);
 assert.equal(s.snapshot().material,null);assert.deepEqual(s.snapshot().artifacts,[]);assert.ok(s.snapshot().pending);assert.equal(f.rows.length,1);
});
test('wrong saved content and hash cannot clear recovery',async()=>{
 const f=fixture(),s=f.fresh();await s.load();const original=s.prepare(draft);
 f.transport.recover=async()=>row({...original,title:'Other content'});
 await assert.rejects(s.recover(),/does not match/);assert.ok(s.snapshot().pending);assert.equal(f.data.size,1);
 f.transport.recover=async()=>({...row(original),artifactId:'f'.repeat(64)});
 await assert.rejects(s.recover(),/integrity/);assert.equal(f.data.size,1);
});
test('storage failure, corruption, other owner and second tab cannot silently overwrite an operation',async()=>{
 const f=fixture(),s=f.fresh(),second=f.fresh();await s.load();await second.load();const original=s.prepare(draft);
 assert.throws(()=>second.prepare(draft),/Another unfinished/);assert.deepEqual(f.fresh().snapshot().pending,original);
 assert.equal(f.fresh({ownerKey:'different-owner'}).snapshot().pending,null);
 f.data.set(s.key,'{broken');const corrupt=f.fresh();assert.throws(()=>corrupt.prepare(draft),/Recover/);await assert.rejects(corrupt.save(),/cannot be read/);assert.equal(f.calls.filter(c=>c[0]==='save').length,0);
 const g=fixture(),blocked=g.fresh({storage:{...g.storage,setItem(){throw Error('Storage full');}}});await blocked.load();assert.throws(()=>blocked.prepare(draft),/Storage full/);assert.equal(blocked.snapshot().pending,null);
});
test('new proposal only selects owned current plans, accepted reviews and valid predecessors',async()=>{
 const f=fixture(),s=f.fresh();await s.load();
 for(const change of [{planIds:['f'.repeat(64)]},{reviewIds:['f'.repeat(64)]},{parentId:'f'.repeat(64)},{dependencies:{[material.plans[0].planId]:['f'.repeat(64)]}}])assert.throws(()=>s.prepare({...draft,...change}));
 assert.equal(f.data.size,0);assert.equal(f.calls.filter(c=>c[0]==='save').length,0);
 const p=s.prepare(draft);await s.save();await s.load();const revised=s.prepare({...draft,title:'Revised',parentId:digest(p)});
 assert.equal(revised.seriesId,p.seriesId);assert.equal(revised.parentId,digest(p));assert.notEqual(revised.operationId,p.operationId);
});
test('material rejects foreign task, forged execution authority, labels and stale malformed basis',()=>{
 for(const change of [{taskRef:{...ref,taskId:randomUUID()}},{executionAuthorized:true},{basis:{...material.basis,revision:294}},
  {plans:[{...material.plans[0],sourceRefs:['archive/guessed','e'.repeat(64)]}]}])assert.throws(()=>checkedMaterial({...material,...change},ref));
});
test('overlapping requests never send a second effect',async()=>{
 const f=fixture(),s=f.fresh();await s.load();s.prepare(draft);let release;
 const original=f.transport.save;f.transport.save=async r=>{await new Promise(resolve=>release=resolve);return original(r);};
 const first=s.save();await assert.rejects(s.save(),/already in progress/);release();await first;
 assert.equal(f.calls.filter(c=>c[0]==='save').length,1);
});
