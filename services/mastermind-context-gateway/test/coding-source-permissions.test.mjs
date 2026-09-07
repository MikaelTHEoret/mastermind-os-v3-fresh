import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {validatePermissionScope,canonicalJson,permissionDigest,permissionGrantRef,validateModuleAuthorization,
  authorizeModuleFromTask,validateCodingSourceCheck,codingSourceScopeFromTask} from '../src/task-permissions.mjs';
import {MastermindContextGateway} from '../src/context-gateway.mjs';
import {NeonMemoryStore} from '../src/neon-store.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/coding-source-permissions-v2.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
const fresh=()=>structuredClone(fixture);
function setup(){
 const f=fresh(),scope=validatePermissionScope({...f.v1,schemaVersion:2,codingSources:[f.codingEntry]});
 const task={taskId:f.taskId,project:f.project,state:'active',revision:'8',checkpointId:f.codingEntry.taskBinding.checkpointId,
  permissionScope:scope,permissionRevision:'2',permissionScopeSha256:permissionDigest(scope)};
 const grantRef=permissionGrantRef(task.taskId,task.permissionRevision,task.permissionScopeSha256);
 const request={schemaVersion:1,operationId:f.codingEntry.operationId,taskRef:{taskId:task.taskId,project:task.project,
  ...f.codingEntry.taskBinding},baseCommit:f.codingEntry.baseCommit,instructions:'Synthetic reviewed source request.\nKeep immutable cases.',
  allowedTargets:f.codingEntry.allowedTargets};
 const workerBinding={schemaVersion:1,action:'coding.source-work',request,requestSha256:permissionDigest(request),
  repositoryRoot:f.codingEntry.repositoryRoot,...f.codingEntry.runtime,sandbox:'workspace-write',approval:'approve-for-me',
  limits:f.codingEntry.limits,delivery:'private-local-branch-no-push',targetEnforcement:'post-execution-acceptance'};
 const input=validateCodingSourceCheck({taskId:task.taskId,project:task.project,grantRef,operationId:request.operationId,workerBinding});
 return {f,scope,task,input};
}

test('v1 canonical bytes and digest are unchanged; v2 adds a distinct source effect only',()=>{
 const f=fresh(),v1=validatePermissionScope(f.v1);
 assert.equal(canonicalJson(v1),f.v1Canonical);
 assert.equal(permissionDigest(v1),crypto.createHash('sha256').update(f.v1Canonical).digest('hex'));
 assert.equal(Object.hasOwn(v1,'codingSources'),false);
 const {scope}=setup();assert.deepEqual(scope.executionPolicy,v1.executionPolicy);
 assert.equal(scope.executionPolicy.codingAgent,false);assert.equal(scope.codingSources[0].executionPolicy.codingAgent,true);
});

test('existing module calls remain authorized through a current v2 grant with the unchanged pure policy',()=>{
 const {scope,task,input}=setup(),module=scope.modules[0];
 const request=validateModuleAuthorization({taskId:task.taskId,project:task.project,grantRef:input.grantRef,
  operation:'module.call',moduleId:module.moduleId,repositoryRoot:module.repositoryRoot,
  entrypoint:module.candidateRoot+'/candidate.py',capabilities:module.capabilities,isolationProfile:scope.executionPolicy.isolationProfile});
 const result=authorizeModuleFromTask(task,request);
 assert.equal(result.authorized,true);assert.deepEqual(result.executionPolicy,fixture.v1.executionPolicy);
});

test('scope eligibility never asserts CLI account proof or execution permission',()=>{
 const {task,input}=setup(),value=codingSourceScopeFromTask(task,input);
 assert.equal(value.scopeAuthorized,true);assert.equal(value.executionAuthorized,false);
 assert.equal(Object.hasOwn(value,'authorized'),false);
 assert.equal(value.requiresTrustedHostProfileProof,true);assert.equal(value.requiresExactReviewedPlanProof,true);
 assert.equal(value.requiresHostPathResolution,true);assert.equal(value.bindingSha256,permissionDigest(input.workerBinding));
 assert.match(value.authorityRef,/^coding-authority\//);assert.ok(!value.authorityRef.startsWith('task-grant/'));
});

test('module-only scope, old grants, foreign owner and task advancement cannot admit source work',()=>{
 const {task,input,f}=setup();
 const v1=validatePermissionScope(f.v1);
 const old={...task,permissionScope:v1,permissionScopeSha256:permissionDigest(v1)};
 assert.equal(codingSourceScopeFromTask(old,input).scopeAuthorized,false);
 for(const change of [{taskId:f.actorId},{project:'other'},{state:'completed'},{revision:'9'},
  {checkpointId:f.actorId},{permissionRevision:'3'},{permissionScopeSha256:'0'.repeat(64)}]) {
  const value=codingSourceScopeFromTask({...task,...change},input);assert.equal(value.scopeAuthorized,false);assert.equal(value.executionAuthorized,false);
 }
 const revoked=validatePermissionScope({...task.permissionScope,status:'revoked'});
 assert.equal(codingSourceScopeFromTask({...task,permissionScope:revoked,permissionScopeSha256:permissionDigest(revoked)},input).reason,'PERMISSION_REVOKED');
});

test('new fields and widened source/runtime policies cannot normalize into grants',()=>{
 const {scope}=setup();
 for(const mutate of [s=>s.executionPolicy.codingAgent=true,s=>s.codingSources[0].approved=true,
  s=>s.codingSources[0].hostProfile.accountRef='caller-account',s=>s.codingSources[0].executionPolicy.push=true,
  s=>s.codingSources[0].executionPolicy.activate=true,s=>s.codingSources[0].runtime.cliProfile='disable-sandbox',
  s=>s.codingSources[0].limits.memory_bytes=2147483649,s=>s.codingSources[0].limits.wall_seconds=true,
  s=>s.codingSources[0].limits.wall_seconds=1.5,s=>s.codingSources.push(s.codingSources[0]),
  s=>s.codingSources[0].moduleId='other.module',s=>s.codingSources[0].repositoryRoot='C:/other',
  s=>s.codingSources[0].runtime.worktreeRoot=s.codingSources[0].repositoryRoot+'/worktrees']) {
  const changed=structuredClone(scope);mutate(changed);assert.throws(()=>validatePermissionScope(changed));
 }
});

test('only a single canonical Python file and distinct immutable requirements/cases are supported',()=>{
 const {scope}=setup();
 for(const mutate of [s=>s.allowedTargets[0].kind='directory',s=>s.allowedTargets[0].path='candidate.js',
  s=>s.allowedTargets.push({path:'second.py',kind:'file'}),s=>s.allowedTargets[0].path='../candidate.py',
  s=>s.allowedTargets[0].path='.git/config.py',s=>s.immutableSources[0].path=s.allowedTargets[0].path.toUpperCase(),
  s=>s.immutableSources[1].role='requirements',s=>s.immutableSources[0].path='spec//requirements.json']) {
  const changed=structuredClone(scope);mutate(changed.codingSources[0]);assert.throws(()=>validatePermissionScope(changed));
 }
 const valid=structuredClone(scope);valid.codingSources[0].allowedTargets[0].path='modules/Épreuve [stable]/candidate.py';
 assert.equal(validatePermissionScope(valid).codingSources[0].allowedTargets[0].path,valid.codingSources[0].allowedTargets[0].path);
});

test('changed worker roots, source targets, base commit and limits hold despite a valid task grant',()=>{
 const {task,input}=setup();
 for(const mutate of [b=>b.repositoryRoot='C:/other',b=>b.worktreeRoot='C:/other-jobs',b=>b.artifactRoot='C:/other-artifacts',
  b=>b.codexSha256='0'.repeat(64),b=>b.limits.wall_seconds=299,b=>b.request.baseCommit='f'.repeat(40),
  b=>b.request.allowedTargets[0].path='candidate.py']){
  const changed=structuredClone(input);mutate(changed.workerBinding);
  changed.workerBinding.requestSha256=permissionDigest(changed.workerBinding.request);
  assert.equal(codingSourceScopeFromTask(task,validateCodingSourceCheck(changed)).scopeAuthorized,false);
 }
});

test('request text still requires independent reviewed-plan proof after constraint eligibility',()=>{
 const {task,input}=setup();input.workerBinding.request.instructions='A caller tries to substitute unrelated instructions.';
 input.workerBinding.requestSha256=permissionDigest(input.workerBinding.request);
 const result=codingSourceScopeFromTask(task,validateCodingSourceCheck(input));
 assert.equal(result.executionAuthorized,false);assert.equal(result.requiresExactReviewedPlanProof,true);
});

test('host-only eligibility reads the exact owned task and rejects caller approval before reading',async()=>{
 const {task,input,f}=setup(),calls=[];
 const gateway=new MastermindContextGateway({identity:{householdId:'fixture',actorPlayerId:f.actorId},store:{
  authorizeOperator:async()=>{calls.push('owner');return true;},taskById:async(...args)=>{calls.push(args);return task;}}});
 const result=await gateway.clientCheckCodingSource(input);assert.equal(result.scopeAuthorized,true);
 assert.deepEqual(calls,['owner',[task.taskId,task.project,'fixture',f.actorId]]);
 await assert.rejects(gateway.clientCheckCodingSource({...input,approved:true}),{code:'INVALID_ARGUMENT'});
 assert.equal(calls.length,2);
});

test('v2 permission delivery retains exact command bytes and missing SQL never falls back',async()=>{
 const {task,scope,f}=setup(),calls=[];
 const store=Object.create(NeonMemoryStore.prototype);
 store.sql={query:async(query,args)=>{calls.push({query,args});return [{status:'applied',taskId:task.taskId,
  checkpointId:task.checkpointId,revision:'8',permissionRevision:'2',currentPermissionRevision:'2',scopeSha256:permissionDigest(scope)}];}};
 const command={taskId:task.taskId,project:task.project,checkpointId:task.checkpointId,householdId:'fixture',actorPlayerId:f.actorId,
  expectedRevision:7,expectedPermissionRevision:1,scopeCanonical:canonicalJson(scope),scopeSha256:permissionDigest(scope)};
 await store.setTaskPermissions(command);await store.setTaskPermissions(command);
 assert.deepEqual(calls[0],calls[1]);assert.match(calls[0].query,/set_mastermind_context_task_permissions_v2/);
 const failed=[];store.sql={query:async(query)=>{failed.push(query);throw Object.assign(new Error('synthetic unavailable'),{code:'42883'});}};
 await assert.rejects(store.setTaskPermissions(command),{code:'TASK_PERMISSIONS_UNAVAILABLE',status:503});
 assert.equal(failed.length,1);assert.match(failed[0],/permissions_v2/);
});

test('the bounded native CLI adds only eligibility and still has no grant action',()=>{
 const text=fs.readFileSync(new URL('../scripts/client-task-adapter.mjs',import.meta.url),'utf8');
 assert.match(text,/checkCodingSource:'clientCheckCodingSource'/);
 assert.doesNotMatch(text,/clientSetTaskPermissions|setTaskPermissions|setPermissions:/);
});

test('v2 retains strict module uniqueness and Windows root grammar',()=>{
 const {scope}=setup();
 for(const mutate of [s=>s.modules.push(structuredClone(s.modules[0])),
  s=>s.modules[0].operations.push(s.modules[0].operations[0]),
  s=>s.modules[0].capabilities.push(s.modules[0].capabilities[0]),
  s=>s.modules[0].repositoryRoot='C:/source/../outside',
  s=>s.modules[0].candidateRoot='C:/candidates//outside',
  s=>s.modules[0].candidateRoot='C:/candidates./outside',
  s=>s.modules[0].candidateRoot='C:/candidates:stream/outside']) {
  const changed=structuredClone(scope);mutate(changed);assert.throws(()=>validatePermissionScope(changed));
 }
});
