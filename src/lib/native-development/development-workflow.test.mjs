import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {developmentRequest,checkedRemoteJob} from './remote-workflow.mjs';
import {REVIEW_ARTIFACTS as ART,REVIEW_BUILD_PLAN as BUILD} from '../../../protocol/mastermind-node-exchange/native-development-work.mjs';
import {developmentFixtureReceipt} from '../../../protocol/mastermind-node-exchange/development-fixture.mjs';
const NODE=randomUUID(),PARENT=randomUUID(),TASK=randomUUID(),AT='2026-09-16T00:00:00.000Z';
function fixture(kind=ART,action='prepare'){
 const input={schemaVersion:1,action,operationId:randomUUID(),parentOperationId:PARENT,artifactOperationId:randomUUID(),
 taskRef:{taskId:TASK,project:'mastermind'},specificationId:'a'.repeat(64),reviewId:'b'.repeat(64),...(kind===BUILD?{buildOperationId:randomUUID()}:{})};
 const pending={nodeId:NODE,taskId:TASK,operationId:input.operationId,capability:kind,body:{operationId:input.operationId,input}};
 const job={jobId:input.operationId,nodeId:NODE,capability:kind,capabilityVersion:1,policyClass:'routine',state:'succeeded',createdAt:AT,expiresAt:'2026-09-16T00:30:00.000Z',lease:null,
 terminal:{code:'desired-state-reached',finishedAt:AT,result:developmentFixtureReceipt(kind,input)}};
 return {input,pending,job};
}
test('browser rejects substituted development parents, artifact IDs, authority and build hashes',async()=>{
 for(const kind of [ART,BUILD]){
  const {pending,job}=fixture(kind);assert.equal((await checkedRemoteJob({ok:true,job},pending)).jobId,job.jobId);
  for(const patch of [{parentOperationId:randomUUID()},{artifactOperationId:randomUUID()},{executionAuthorized:true},...(kind===BUILD?[{requestHash:'0'.repeat(64)}]:[])]){
   await assert.rejects(checkedRemoteJob({ok:true,job:{...job,terminal:{...job.terminal,result:{...job.terminal.result,...patch}}}},pending));
  }
  await assert.rejects(checkedRemoteJob({ok:true,job},{...pending,taskId:randomUUID()}));
 }
});
test('publication resume requires recorded absence; build planning requires publication; recovery retains identities',()=>{
 const f=fixture();assert.throws(()=>developmentRequest(f.pending,f.job,BUILD,'prepare'));
 assert.throws(()=>developmentRequest(f.pending,f.job,ART,'resume'));
 for(const state of ['queued','failed'])assert.throws(()=>developmentRequest(f.pending,{...f.job,state},ART,'publish'));
 assert.throws(()=>developmentRequest(f.pending,{...f.job,nodeId:randomUUID()},ART,'publish'));
 f.job.terminal.result.artifactState='prepared';assert.throws(()=>developmentRequest(f.pending,f.job,ART,'resume'));
 f.job.terminal.result.holds=['MATERIALIZER_REF_NOT_PUBLISHED'];
 const resumed=developmentRequest(f.pending,f.job,ART,'resume');assert.equal(resumed.body.input.artifactOperationId,f.input.artifactOperationId);
 const published=fixture(ART,'publish'),planned=developmentRequest(published.pending,published.job,BUILD,'prepare');
 assert.equal(planned.body.input.parentOperationId,PARENT);assert.equal(planned.body.input.artifactOperationId,published.input.artifactOperationId);
 const build=fixture(BUILD);const recovered=developmentRequest(build.pending,build.job,BUILD,'recover');
 assert.equal(recovered.body.input.buildOperationId,build.input.buildOperationId);assert.notEqual(recovered.operationId,build.pending.operationId);
 assert.throws(()=>developmentRequest(build.pending,build.job,BUILD,'prepare'));
});
