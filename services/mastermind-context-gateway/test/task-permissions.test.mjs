import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePermissionScope, PURE_MODULE_POLICY, permissionDigest, permissionGrantRef, validateModuleAuthorization, authorizeModuleFromTask, windowsScopePath } from '../src/task-permissions.mjs';
import { MastermindContextGateway } from '../src/context-gateway.mjs';
import { NeonMemoryStore } from '../src/neon-store.mjs';

const TASK='00000000-0000-8000-8000-000000000002', ACTOR='00000000-0000-8000-8000-000000000001';
const entry = (moduleId = 'core.release_inventory') => ({ moduleId, repositoryRoot:'C:/core', candidateRoot:`C:/candidates/${moduleId}`,
  operations:['module.generate','module.test','module.promote','module.rollback','module.call'], capabilities:[`${moduleId}.inspect`] });
function fixture() {
  const scope=validatePermissionScope({schemaVersion:1,status:'active',executionPolicy:{...PURE_MODULE_POLICY},modules:[entry(),entry('core.source_time_preview')]});
  const digest=permissionDigest(scope), grantRef=permissionGrantRef(TASK,1,digest);
  const task={taskId:TASK,project:'mastermind',state:'active',permissionScope:scope,permissionRevision:'1',permissionScopeSha256:digest};
  const input=validateModuleAuthorization({taskId:TASK,project:'mastermind',grantRef,operation:'module.call',moduleId:entry().moduleId,
    repositoryRoot:'C:/core',entrypoint:`${entry().candidateRoot}/candidate.py`,capabilities:entry().capabilities,isolationProfile:PURE_MODULE_POLICY.isolationProfile});
  return {scope,digest,grantRef,task,input};
}

test('canonical exact scopes retain multiple modules and produce stable revision-bound grant references', () => {
  const {scope,digest,grantRef,task,input}=fixture();
  assert.equal(scope.modules.length,2);
  assert.equal(permissionDigest(validatePermissionScope({...scope,modules:[...scope.modules].reverse()})),digest);
  assert.match(grantRef,/^task-grant\/[a-f0-9-]+\/1\/[a-f0-9]{64}$/);
  const authorized=authorizeModuleFromTask(task,input);
  assert.equal(authorized.authorized,true);
  assert.equal(authorized.requiresHostPathResolution,true);
  assert.deepEqual(authorized.executionPolicy,PURE_MODULE_POLICY);
});

test('missing, replaced, revoked, corrupt and inactive task grants fail closed', () => {
  const {task,input}=fixture();
  for(const [change,reason] of [[{permissionScope:null},'TASK_PERMISSION_REQUIRED'],[{permissionRevision:'2'},'PERMISSION_REVISION_CHANGED'],
    [{permissionScopeSha256:'0'.repeat(64)},'PERMISSION_INTEGRITY_FAILED'],[{state:'blocked'},'ACTIVE_TASK_REQUIRED'],[{project:'other'},'OWNED_TASK_REQUIRED']]) {
    assert.equal(authorizeModuleFromTask({...task,...change},input).reason,reason);
  }
  const revoked=validatePermissionScope({...task.permissionScope,status:'revoked'});
  assert.equal(authorizeModuleFromTask({...task,permissionScope:revoked,permissionScopeSha256:permissionDigest(revoked)},input).reason,'PERMISSION_REVOKED');
});

test('scope cannot authorize another module, effect, root, capability set or isolation profile', () => {
  const {task,input}=fixture();
  for(const [change,reason] of [[{moduleId:'core.other'},'MODULE_OPERATION_OUTSIDE_SCOPE'],[{operation:'module.reconstruct'},'MODULE_OPERATION_OUTSIDE_SCOPE'],
    [{repositoryRoot:'C:/other'},'MODULE_PATH_OUTSIDE_SCOPE'],[{entrypoint:`${entry().candidateRoot}-other/code.py`},'MODULE_PATH_OUTSIDE_SCOPE'],
    [{capabilities:['core.release_inventory.other']},'EXACT_CAPABILITIES_REQUIRED'],[{isolationProfile:'unisolated'},'ISOLATION_PROFILE_REQUIRED']]) {
    assert.equal(authorizeModuleFromTask(task,{...input,...change}).reason,reason);
  }
});

test('malformed, widened and ambiguous grants never normalize into authorization', () => {
  const {scope}=fixture();
  for(const change of [{executionPolicy:{...PURE_MODULE_POLICY,network:true}},{executionPolicy:{...PURE_MODULE_POLICY,effectClass:'LOCAL_REVERSIBLE_WRITE'}},
    {modules:[entry(),entry()]},{modules:[{...entry(),operations:['module.shell']}]},{modules:[{...entry(),capabilities:['inspect']}]},
    {modules:[]},{unexpected:true}]) assert.throws(()=>validatePermissionScope({...scope,...change}));
  for(const path of ['C:/', 'C:/work/../secret','C:/work/./code','C:/work:stream/code','C:/work*/code','C:/work./code','//server/share/code','C:/work//code']) {
    assert.throws(()=>windowsScopePath(path,'path'),undefined,path);
  }
  assert.equal(windowsScopePath('c:\\work\\code.py','path'),'C:/work/code.py');
});

test('module authorization always reads the exact currently owned task and never accepts caller scope', async () => {
  const {task,input}=fixture(); const calls=[];
  const gateway=new MastermindContextGateway({identity:{householdId:'fixture',actorPlayerId:ACTOR},store:{
    authorizeOperator:async()=>{calls.push('auth');return true;},taskById:async(...args)=>{calls.push(args);return task;}}});
  assert.equal((await gateway.clientAuthorizeModule(input)).authorized,true);
  assert.deepEqual(calls,['auth',[TASK,'mastermind','fixture',ACTOR]]);
  await assert.rejects(gateway.clientAuthorizeModule({...input,authorized:true}),{code:'INVALID_ARGUMENT'});
  assert.equal(calls.length,2);
});

test('owner permission commands require exact revisions and retain checkpoint identity for replay', async () => {
  const {scope}=fixture(),calls=[];
  const gateway=new MastermindContextGateway({identity:{householdId:'fixture',actorPlayerId:ACTOR},store:{authorizeOperator:async()=>true,setTaskPermissions:async(command)=>{calls.push(command);return {status:'applied'};}}});
  const command={taskId:TASK,project:'mastermind',checkpointId:ACTOR,expectedRevision:7,expectedPermissionRevision:0,scope};
  await gateway.clientSetTaskPermissions(command); await gateway.clientSetTaskPermissions(command);
  assert.deepEqual(calls[0],calls[1]);
  assert.equal(calls[0].scopeSha256,permissionDigest(scope));
  await assert.rejects(gateway.clientSetTaskPermissions({...command,expectedRevision:undefined}));
  assert.equal(calls.length,2);
});

test('uninstalled permission schema is readable as absent and mutations hold with a typed failure', async () => {
  const store=Object.create(NeonMemoryStore.prototype),calls=[];
  store.sql={query:async(statement)=>{calls.push(statement);if(statement.includes('set_mastermind'))throw Object.assign(Error('function does not exist'),{code:'42883'});return[];}};
  await store.taskById(TASK,'mastermind','fixture',ACTOR);
  assert.match(calls[0],/to_jsonb\(t\)->'permission_scope'/);
  await assert.rejects(store.setTaskPermissions({}),{code:'TASK_PERMISSIONS_UNAVAILABLE'});
});

test('native subprocess seam cannot set permissions or invoke arbitrary gateway methods', () => {
  const script=fileURLToPath(new URL('../scripts/client-task-adapter.mjs',import.meta.url));
  for(const action of ['clientSetTaskPermissions','setPermissions','constructor','__proto__']) {
    const result=spawnSync(process.execPath,[script],{input:JSON.stringify({action,arguments:{}}),encoding:'utf8',timeout:10000});
    assert.equal(result.status,1);
    assert.equal(JSON.parse(result.stdout).error.code,'ACTION_NOT_ALLOWED');
  }
});
