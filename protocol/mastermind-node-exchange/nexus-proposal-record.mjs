// Advisory immutable proposals. Neither persistence nor dependency edges grant execution.
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const revision=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,14})$/.test(v);
const list=(v,max,valid,min=1)=>Array.isArray(v)&&v.length>=min&&v.length<=max&&v.every(valid)&&new Set(v).size===v.length;
export function validNexusProposal(r,common){
 if(!object(r)||r.schemaVersion!==1||r.kind!=='nexus-proposal'||!uuid(r.operationId)
  ||!exact(r.taskRef,['taskId','project'])||!uuid(r.taskRef.taskId)||typeof r.taskRef.project!=='string'||!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(r.taskRef.project))return false;
 if(!exact(r,[...common,'seriesId','parentId','basis','title','dependencyMeaning','nodes','sourceRefs','reviewIds'])||Object.hasOwn(r,'submission'))return false;
 if(!uuid(r.seriesId)||(r.parentId!==null&&!sha(r.parentId))||r.dependencyMeaning!=='source-ready-for-review')return false;
 if(!exact(r.basis,['checkpointId','revision','permissionRevision','permissionScopeSha256'])||!uuid(r.basis.checkpointId)
  ||!revision(r.basis.revision)||!revision(r.basis.permissionRevision)||!sha(r.basis.permissionScopeSha256))return false;
 const text=(v,max)=>typeof v==='string'&&v.isWellFormed()&&v.trim().length>0&&new TextEncoder().encode(v).length<=max&&!/[\x00-\x1f\x7f]/.test(v);
 if(!text(r.title,240)||!list(r.sourceRefs,12,x=>text(x,512))||!list(r.reviewIds,12,sha))return false;
 if(!Array.isArray(r.nodes)||r.nodes.length<1||r.nodes.length>32)return false;
 const plans=new Set();
 for(const n of r.nodes){
  if(!exact(n,['specificationId','planId','dependsOn'])||!sha(n.specificationId)||!sha(n.planId)||plans.has(n.planId)||!list(n.dependsOn,32,sha,0))return false;
  plans.add(n.planId);
 }
 // Cycles remain valid *proposals*: the readiness assessor holds them.
 return r.nodes.every(n=>n.dependsOn.every(p=>plans.has(p)));
}

export function proposalHeads(rows){
 const proposals=rows.filter(r=>r.record.kind==='nexus-proposal');
 const superseded=new Set(proposals.map(r=>r.record.parentId).filter(Boolean));
 return proposals.filter(r=>!superseded.has(r.artifactId));
}

// Lossless projection to the accepted advisory runtime contract; never a worker request.
export function readinessInput(record){
 if(!validNexusProposal(record,['schemaVersion','kind','operationId','taskRef']))throw new Error('NEXUS_PROPOSAL_INVALID');
 return {proposal:{schemaVersion:1,kind:'mastermind.nexus-build-dependency-proposal',
  taskRef:{...record.taskRef,checkpointId:record.basis.checkpointId,revision:record.basis.revision},
  dependencyMeaning:record.dependencyMeaning,nodes:record.nodes.map(({planId,dependsOn})=>({planId,dependsOn:[...dependsOn]}))},
  references:record.nodes.map(({specificationId,planId})=>({specificationId,planId}))};
}
