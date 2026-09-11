import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {executionRequest,canonical,checkedJob,CATALOG,REUSE} from './remote-workflow.mjs';
const TASK='99999999-9999-4999-8999-999999999999',OP='11111111-1111-4111-8111-111111111111',NODE='22222222-2222-4222-8222-222222222222';
const page=()=>({kind:CATALOG,ok:true,schemaVersion:1,taskRef:{taskId:TASK,project:'mastermind'},snapshotId:'a'.repeat(64),entry:{specificationId:'b'.repeat(64),candidateId:'c'.repeat(64),requirementsHash:'d'.repeat(64),capability:'release-inventory.diff',title:'Compare',version:'1.0.0',effectClass:'READ_ONLY',inputSchema:{type:'object'}},nextCursor:null,observedAt:'2026-09-11T04:00:00Z',executionAuthorized:false});
test('generated input submission derives immutable binding and canonical hash from accepted discovery',async()=>{
 const arguments_={after:[],before:[]},request=await executionRequest(page(),arguments_,OP,crypto.webcrypto.subtle);
 assert.equal(request.candidateId,page().entry.candidateId);assert.equal(request.specificationId,page().entry.specificationId);
 assert.equal(request.inputSha256,crypto.createHash('sha256').update(canonical(arguments_)).digest('hex'));
 assert.equal(request.operationId,OP);assert.equal(request.action,'execute');assert.equal(request.grantRef,undefined);
 for(const args of [{x:NaN},{_mastermind_context:{}},{x:'z'.repeat(5000)}])await assert.rejects(executionRequest(page(),args,OP,crypto.webcrypto.subtle));
});
test('reconnect binds the saved operation and rejects another task or coalesced operation',()=>{
 const pending={nodeId:NODE,operationId:OP,capability:CATALOG,body:{input:{schemaVersion:1,taskRef:page().taskRef,snapshotId:null,cursor:null}}};
 const job={jobId:OP,nodeId:NODE,capability:CATALOG,capabilityVersion:1,policyClass:'routine',state:'succeeded',createdAt:'2026-09-11T03:59:00.000Z',expiresAt:'2026-09-11T04:29:00.000Z',lease:null,terminal:{code:'desired-state-reached',finishedAt:'2026-09-11T04:00:00.000Z',result:page()}};
 assert.equal(checkedJob({ok:true,job},pending).jobId,OP);
 assert.throws(()=>checkedJob({ok:true,job:{...job,terminal:{...job.terminal,result:{...page(),taskRef:{taskId:NODE,project:'mastermind'}}}}},pending));
 assert.throws(()=>checkedJob({ok:true,status:'coalesced',job:{...job,jobId:NODE}},pending,true));
});
