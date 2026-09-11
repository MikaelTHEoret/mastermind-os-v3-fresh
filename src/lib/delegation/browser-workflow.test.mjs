import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {checkedArtifact,checkedAcknowledgement,checkedTasks,contributionJson} from './browser-workflow.mjs';
import {digest} from './store.mjs';
const ref={taskId:randomUUID(),project:'mastermind'};
const record={schemaVersion:1,kind:'assignment',operationId:randomUUID(),taskRef:ref,title:'Review',request:'Find a defect',context:'Source',sourceRefs:['revision/file'],criteria:['Reproduce it'],providers:['grok'],disclosure:'public-material'};
const row={artifactId:digest(record),record,recordedAt:'2026-09-11T00:00:00Z'};
test('acknowledgement binds every field and artifact hash before pending work is cleared',async()=>{
 const body={status:'created',artifact:row,executionAuthorized:false};
 assert.deepEqual(await checkedAcknowledgement(body,record),row);
 await assert.rejects(checkedAcknowledgement(body,{...record,title:'Changed'}));
 await assert.rejects(checkedAcknowledgement({...body,artifact:{...row,artifactId:'f'.repeat(64)}},record));
 await assert.rejects(checkedAcknowledgement({...body,executionAuthorized:true},record));
 await assert.rejects(checkedArtifact(row,{...ref,taskId:randomUUID()}));
 await assert.rejects(checkedArtifact({...row,recordedAt:'invalid'},ref));
});
test('task picker validates identities and retains only the shared project',()=>{
 assert.equal(checkedTasks([{...ref,title:'Task'}]).length,1);
 assert.throws(()=>checkedTasks([{...ref,taskId:'invalid',title:'Task'}]));
 assert.throws(()=>checkedTasks([{...ref,title:{}}]));
});
test('browser transport is bounded and rejects denial or malformed data',async()=>{
 const old=globalThis.fetch;try{
 globalThis.fetch=async()=>Response.json({ok:true,artifacts:[]});
 assert.deepEqual(await contributionJson('/fixture'),{ok:true,artifacts:[]});
 globalThis.fetch=async()=>Response.json({ok:false,error:'DENIED'},{status:403});
 await assert.rejects(contributionJson('/fixture'),/DENIED/);
 let cancelled=false;globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(4400001));},cancel(){cancelled=true;}}));
 await assert.rejects(contributionJson('/fixture'),/exceeds/);assert.equal(cancelled,true);
 }finally{globalThis.fetch=old;}
});
