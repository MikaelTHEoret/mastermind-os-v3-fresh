// Pure coding-source scope grammar. This validates policy metadata, not host/account evidence.
import { exactObject, requiredString, uuid } from './validation.mjs';

export const CODING_SOURCE_POLICY = Object.freeze({ action:'coding.source-work', codingAgent:true,
  delivery:'private-local-branch-no-push', sandbox:'workspace-write', approval:'approve-for-me',
  targetEnforcement:'post-execution-acceptance', activate:false, push:false, deploy:false });
export const CODING_CLI_PROFILE = 'codex-approve-for-me-workspace-write-v1';
export const CODING_LIMITS = Object.freeze({wall_seconds:300,stdout_bytes:2097152,stderr_bytes:262144,
  memory_bytes:2147483648,active_processes:32,max_files:4096,max_file_bytes:8388608,
  max_inventory_bytes:67108864,diff_bytes:2097152});
const MINIMUM = {wall_seconds:1,stdout_bytes:1024,stderr_bytes:1024,memory_bytes:268435456,
  active_processes:2,max_files:1,max_file_bytes:1,max_inventory_bytes:1,diff_bytes:1024};
const HASH=/^[a-f0-9]{64}$/;
const NAME=/^[a-z][a-z0-9_.-]{1,127}$/;
const fail=()=>{throw new TypeError('CODING_SOURCE_SCOPE_INVALID');};
const strict=(value,keys)=>{exactObject(value,keys);if(Object.keys(value).length!==keys.length)fail();return value;};
const hash=(value,field)=>requiredString(value,field,64,HASH);
const utf8Order=(a,b)=>Buffer.compare(Buffer.from(a.path,'utf8'),Buffer.from(b.path,'utf8'));
export function codingRelativePath(value) {
  requiredString(value,'source path',512);
  if(value.startsWith('/') || value.includes('\\') || /[<>:"|?*\u0000-\u001f\u007f\ud800-\udfff]/u.test(value))fail();
  const parts=value.split('/');
  if(parts.length>16 || parts.some(part=>!part || part==='.' || part==='..' || /[. ]$/.test(part)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    || /^\.(?:git|codex|env)/i.test(part) || /^agents\.md$/i.test(part)))fail();
  return value;
}
export function codingLimits(raw) {
  strict(raw,Object.keys(CODING_LIMITS));
  const result={};
  for(const key of Object.keys(CODING_LIMITS)) {
    if(!Number.isSafeInteger(raw[key]) || raw[key]<MINIMUM[key] || raw[key]>CODING_LIMITS[key])fail();
    result[key]=raw[key];
  }
  return result;
}
export function codingTaskBinding(raw) {
  strict(raw,['checkpointId','revision']);
  if(typeof raw.revision!=='string' || !/^[1-9][0-9]*$/.test(raw.revision)
    || !Number.isSafeInteger(Number(raw.revision)))fail();
  return {checkpointId:uuid(raw.checkpointId,'checkpointId'),revision:raw.revision};
}
export function validateCodingSources(raw, helpers) {
  const {canonicalJson,windowsScopePath}=helpers;
  if(!Array.isArray(raw) || raw.length>8)fail();
  const seen=new Set();
  const result=raw.map(value=>{
    const entry=strict(value,['operationId','specificationId','requestSha256','reviewContentSha256','sourceManifestSha256',
      'moduleId','repositoryRoot','baseCommit','allowedTargets','immutableSources','requirementsHash','testSpecHash',
      'taskBinding','hostProfile','runtime','executionPolicy','limits']);
    const operationId=uuid(entry.operationId,'operationId');
    if(seen.has(operationId))fail();seen.add(operationId);
    const moduleId=requiredString(entry.moduleId,'moduleId',128,NAME);
    const repositoryRoot=windowsScopePath(entry.repositoryRoot,'repositoryRoot');
    const baseCommit=requiredString(entry.baseCommit,'baseCommit',64,/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
    if(!Array.isArray(entry.allowedTargets) || entry.allowedTargets.length!==1)fail();
    const target=strict(entry.allowedTargets[0],['path','kind']);
    if(target.kind!=='file' || !codingRelativePath(target.path).endsWith('.py'))fail();
    if(!Array.isArray(entry.immutableSources) || entry.immutableSources.length<2 || entry.immutableSources.length>32)fail();
    const paths=new Set([target.path.toLowerCase()]);
    const immutableSources=entry.immutableSources.map(item=>{
      strict(item,['role','path','sha256']);
      if(!['requirements','tests','reference'].includes(item.role))fail();
      const path=codingRelativePath(item.path), key=path.toLowerCase();
      if(paths.has(key))fail();paths.add(key);
      return {role:item.role,path,sha256:hash(item.sha256,'immutable source hash')};
    }).sort(utf8Order);
    if(immutableSources.filter(item=>item.role==='requirements').length!==1
      || immutableSources.filter(item=>item.role==='tests').length!==1)fail();
    if([...paths].some(path=>[...paths].some(other=>other!==path && path.startsWith(other+'/'))))fail();
    const host=strict(entry.hostProfile,['profileId','profileSha256','accountEvidenceSha256']);
    const hostProfile={profileId:requiredString(host.profileId,'profileId',128,NAME),
      profileSha256:hash(host.profileSha256,'host profile hash'),accountEvidenceSha256:hash(host.accountEvidenceSha256,'account evidence hash')};
    const runtime=strict(entry.runtime,['codexSha256','cliProfile','worktreeRoot','artifactRoot']);
    if(runtime.cliProfile!==CODING_CLI_PROFILE)fail();
    const runtimeView={codexSha256:hash(runtime.codexSha256,'CLI hash'),cliProfile:CODING_CLI_PROFILE,
      worktreeRoot:windowsScopePath(runtime.worktreeRoot,'worktreeRoot'),artifactRoot:windowsScopePath(runtime.artifactRoot,'artifactRoot')};
    const roots=[repositoryRoot,runtimeView.worktreeRoot,runtimeView.artifactRoot].map(path=>path.toLowerCase());
    if(roots.some((path,i)=>roots.some((other,j)=>i!==j && (path===other || path.startsWith(other+'/')))))fail();
    if(canonicalJson(entry.executionPolicy)!==canonicalJson(CODING_SOURCE_POLICY))fail();
    const hashes=Object.fromEntries(['specificationId','requestSha256','reviewContentSha256','sourceManifestSha256',
      'requirementsHash','testSpecHash'].map(key=>[key,hash(entry[key],key)]));
    return {operationId,...hashes,moduleId,repositoryRoot,baseCommit,allowedTargets:[{path:target.path,kind:'file'}],
      immutableSources,taskBinding:codingTaskBinding(entry.taskBinding),hostProfile,runtime:runtimeView,
      executionPolicy:{...CODING_SOURCE_POLICY},limits:codingLimits(entry.limits)};
  });
  return result.sort((a,b)=>a.operationId<b.operationId?-1:a.operationId>b.operationId?1:0);
}

export function validateCodingBinding(value, helpers) {
  const {canonicalJson,windowsScopePath,permissionDigest}=helpers;
  strict(value,['schemaVersion','action','request','requestSha256','repositoryRoot','worktreeRoot','artifactRoot',
    'codexSha256','cliProfile','sandbox','approval','limits','delivery','targetEnforcement']);
  if(value.schemaVersion!==1 || value.action!=='coding.source-work' || value.cliProfile!==CODING_CLI_PROFILE
    || value.sandbox!=='workspace-write' || value.approval!=='approve-for-me'
    || value.delivery!=='private-local-branch-no-push' || value.targetEnforcement!=='post-execution-acceptance')fail();
  const request=strict(value.request,['schemaVersion','operationId','taskRef','baseCommit','instructions','allowedTargets']);
  if(request.schemaVersion!==1 || request.operationId!==uuid(request.operationId,'operationId'))fail();
  strict(request.taskRef,['taskId','project','checkpointId','revision']);
  uuid(request.taskRef.taskId,'taskId');
  requiredString(request.taskRef.project,'project',100,/^[A-Za-z0-9_.-]+$/);
  codingTaskBinding({checkpointId:request.taskRef.checkpointId,revision:request.taskRef.revision});
  requiredString(request.baseCommit,'baseCommit',64,/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
  if(typeof request.instructions!=='string' || !request.instructions.trim() || request.instructions.includes('\0')
    || Buffer.byteLength(request.instructions,'utf8')>20000)fail();
  if(!Array.isArray(request.allowedTargets) || request.allowedTargets.length!==1)fail();
  const target=strict(request.allowedTargets[0],['path','kind']);
  if(target.kind!=='file' || !codingRelativePath(target.path).endsWith('.py'))fail();
  if(hash(value.requestSha256,'worker request hash')!==permissionDigest(request))fail();
  for(const key of ['repositoryRoot','worktreeRoot','artifactRoot'])windowsScopePath(value[key],key);
  hash(value.codexSha256,'CLI hash');codingLimits(value.limits);
  if(Buffer.byteLength(canonicalJson(value),'utf8')>49152)fail();
  // Preserve original binding bytes/Windows separators for the worker's digest.
  return JSON.parse(canonicalJson(value));
}
