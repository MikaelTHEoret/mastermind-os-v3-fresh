import type {NativeContract} from '../../components/NativeCapabilityInputs';

export type Json=string|number|boolean|null|Json[]|{[key:string]:Json};
export type TestCase={id:string;capability:string;input:Record<string,Json>;expected?:Json;expectedError?:{type:string;message:string}};
export type Requirements={requirements:string[];compatibility?:string;contracts:NativeContract[];tests:{cases:TestCase[]};sourceReferences?:unknown[]};
export type Candidate={candidateId:string;status:string;identity:{expectedActiveRevision:string|null;manifest:{version:string;id?:string};contracts:NativeContract[]};
  testReceipts:{outcome:string}[];testRuns?:{status:string;completedCases?:number;caseCount?:number;error?:string}[]};
export type Revision={candidateId:string;acceptedAt:string};
export type BuildPlan={viewState?:'available'|'held';planId:string;operationId:string;createdAt?:string;state:string;holds:string[];
  current?:boolean;jobState?:string|null;candidateId?:string|null;sourceReady?:boolean;hasSourceReceipt?:boolean;
  details?:{review?:{requirements?:Requirements}|null};executionAuthorized:false};
export type BuildJob={planId:string;operationId:string;state:string;holds:string[];sourceReady?:boolean;candidateId?:string|null;executionAuthorized:false};
export type HeldSpecification={viewState:'held';specificationId:string;holds:string[];buildPlans:BuildPlan[]};
export type Specification={viewState:'available';specificationId:string;holderId:string;candidateId:string|null;activeRevision:string|null;
  identity:{request:string;title?:string;stage:string;decision:string;moduleId:string|null;missing:string[];expectedActiveRevision?:string|null;
    requirements:Requirements|null;sourceRef:null|{commit:string;path:string};catalogMatches:{name:string;available:boolean;basis:string}[]};
  candidate?:Candidate;revisions?:Revision[];buildPlans:BuildPlan[];
  reuseRuns?:{operationId:string;status:string;startedAt:string;finishedAt?:string;version?:string;holdCode?:string}[];
  events?:{eventId:string;createdAt:string;identity:{kind:string};checkpointDelivery?:{status:string}}[]};
export type SpecificationView=Specification|HeldSpecification;
export type Summary={viewState:'available'|'held';specificationId:string;title:string;createdAt?:string};
export type CandidateProjection={viewState:'available';specificationId:string;planId:string;moduleId:string;candidateId:string;
  activeRevision:string|null;candidate:Candidate;requirements:Requirements;revisions:Revision[];executionAuthorized:false};
export type ProjectionView=CandidateProjection|{viewState:'held';specificationId:string;planId:string;holds:string[]};
export type Selection={version:1;specificationId:string;planId?:string;operationId?:string};
export type NativeEnvelope=Record<string,any> & {ok:boolean;held:boolean};
export const DIGEST=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MODULE=/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
export const STORAGE_KEY='mastermind.native-build-selection.v1';
export const PREPARATIONS_KEY='mastermind.native-build-preparations.v1';
const object=(value:unknown):value is Record<string,any>=>!!value && typeof value==='object' && !Array.isArray(value);
const text=(value:unknown,max=4000):value is string=>typeof value==='string' && value.length<=max;
const strings=(value:unknown,max=100):value is string[]=>Array.isArray(value) && value.length<=max && value.every(item=>text(item));
const digest=(value:unknown):value is string=>typeof value==='string' && DIGEST.test(value);
const revision=(value:unknown)=>value===null || digest(value);
export const holdCodes=(value:unknown):string[]=>Array.isArray(value)
  ?value.filter(item=>typeof item==='string' && /^[A-Z][A-Z0-9_]{1,127}$/.test(item)).slice(0,16):[];
export const holdText=(codes:unknown)=>{const list=holdCodes(codes);return list.length?list.map(code=>code.replace(/_/g,' ').toLowerCase()).join('; '):'The current saved evidence is unavailable.';};

function schema(value:unknown,depth=0):boolean {
  if(!object(value)||depth>6)return false;
  if(['title','description'].some(key=>value[key]!==undefined&&!text(value[key])))return false;
  if(value.type!==undefined && !(text(value.type,30)||strings(value.type,8)))return false;
  if(value.required!==undefined && !strings(value.required,64))return false;
  if(value.enum!==undefined && (!Array.isArray(value.enum)||value.enum.length>100))return false;
  if(value.properties!==undefined && (!object(value.properties)||Object.keys(value.properties).length>64||!Object.values(value.properties).every(child=>schema(child,depth+1))))return false;
  return value.items===undefined || schema(value.items,depth+1);
}
function contracts(value:unknown):value is NativeContract[] {
  return Array.isArray(value)&&value.length<=64&&value.every(item=>object(item)&&text(item.name,180)&&schema(item.inputSchema)
    &&(item.description===undefined||text(item.description)));
}
function requirements(value:unknown):value is Requirements {
  return object(value)&&strings(value.requirements)&&contracts(value.contracts)&&object(value.tests)
    &&Array.isArray(value.tests.cases)&&value.tests.cases.length<=200&&value.tests.cases.every((item:unknown)=>object(item)
      &&text(item.id,180)&&text(item.capability,180)&&object(item.input)
      &&(item.expectedError===undefined||object(item.expectedError)&&text(item.expectedError.type)&&text(item.expectedError.message)))
    &&(value.compatibility===undefined||text(value.compatibility));
}
function candidate(value:unknown):value is Candidate {
  return object(value)&&digest(value.candidateId)&&text(value.status,128)&&object(value.identity)
    &&revision(value.identity.expectedActiveRevision)&&object(value.identity.manifest)&&text(value.identity.manifest.version,128)
    &&contracts(value.identity.contracts)&&Array.isArray(value.testReceipts)&&value.testReceipts.every((item:unknown)=>object(item)&&text(item.outcome,128))
    &&(value.testRuns===undefined||Array.isArray(value.testRuns)&&value.testRuns.every((item:unknown)=>object(item)&&text(item.status,128)
      &&['completedCases','caseCount'].every(key=>item[key]===undefined||Number.isSafeInteger(item[key])&&item[key]>=0)
      &&(item.error===undefined||text(item.error))));
}
function revisions(value:unknown):value is Revision[] {
  return Array.isArray(value)&&value.length<=100&&value.every(item=>object(item)&&digest(item.candidateId)&&text(item.acceptedAt,100));
}
export function normalizeBuildPlan(value:unknown,expectedId?:string):BuildPlan|null {
  if(!object(value)||!digest(value.planId)||expectedId!==undefined&&value.planId!==expectedId
      ||!text(value.operationId,36)||!UUID.test(value.operationId)||!text(value.state,128)||value.executionAuthorized!==false)return null;
  const held=value.viewState==='held'||value.viewState===undefined&&value.details===undefined&&value.current===false;
  const result:BuildPlan={planId:value.planId,operationId:value.operationId,state:value.state,holds:holdCodes(value.holds),executionAuthorized:false,
    viewState:held?'held':'available'};
  // A disclosure hold must never retain prior private review/source details.
  if(held)return result;
  if(value.current!==undefined)result.current=value.current===true;
  if(text(value.createdAt,100))result.createdAt=value.createdAt;
  if(value.jobState===null||text(value.jobState,128))result.jobState=value.jobState;
  if(revision(value.candidateId))result.candidateId=value.candidateId;
  result.sourceReady=value.sourceReady===true;
  result.hasSourceReceipt=value.hasSourceReceipt===true;
  if(object(value.details)&&object(value.details.review)&&requirements(value.details.review.requirements))result.details={review:{requirements:value.details.review.requirements}};
  return result;
}
export function normalizeBuildJob(value:unknown,planId:string,operationId:string):BuildJob|null {
  if(!object(value)||value.planId!==planId||value.operationId!==operationId||!text(value.state,128)||value.executionAuthorized!==false)return null;
  return {planId,operationId,state:value.state,holds:holdCodes(value.holds),sourceReady:value.sourceReady===true,
    candidateId:revision(value.candidateId)?value.candidateId:null,executionAuthorized:false};
}
export function normalizeSpecification(value:unknown,expectedId?:string):SpecificationView {
  const id=object(value)&&digest(value.specificationId)?value.specificationId:expectedId;
  if(!id||!DIGEST.test(id)||expectedId!==undefined&&id!==expectedId)throw new Error('The saved request identity could not be verified.');
  const plans=object(value)&&Array.isArray(value.buildPlans)?value.buildPlans.slice(0,8).map(item=>normalizeBuildPlan(item)).filter((item):item is BuildPlan=>!!item):[];
  const held=(codes:unknown):HeldSpecification=>({viewState:'held',specificationId:id,holds:holdCodes(codes),buildPlans:plans});
  if(!object(value)||value.viewState==='held'||value.state==='held'&&!value.identity)return held(object(value)?value.holds:[]);
  if(value.buildPlans!==undefined&&(!Array.isArray(value.buildPlans)||value.buildPlans.length>8||value.buildPlans.length!==plans.length))return held(['NATIVE_BUILD_HISTORY_UNAVAILABLE']);
  const identity=value.identity;
  if(!object(identity)||!text(identity.request)||!text(identity.stage,128)||!text(identity.decision,128)
    ||!text(value.holderId,128)||!MODULE.test(value.holderId)||!revision(value.activeRevision)||!revision(value.candidateId)
    ||!strings(identity.missing)||!Array.isArray(identity.catalogMatches)||!identity.catalogMatches.every((x:unknown)=>object(x)&&text(x.name,180)&&typeof x.available==='boolean'&&text(x.basis))
    ||identity.requirements!==null&&!requirements(identity.requirements)
    ||value.candidate!==undefined&&!candidate(value.candidate)
    ||value.revisions!==undefined&&!revisions(value.revisions))return held(['NATIVE_SAVED_VIEW_UNAVAILABLE']);
  if(value.candidate&&value.candidate.candidateId!==value.candidateId)return held(['NATIVE_CANDIDATE_IDENTITY_CHANGED']);
  return {...value,viewState:'available',specificationId:id,buildPlans:plans,
    identity:{...identity,title:text(identity.title,400)?identity.title:undefined,
      sourceRef:object(identity.sourceRef)&&text(identity.sourceRef.path)&&text(identity.sourceRef.commit,64)?identity.sourceRef:null},
    reuseRuns:Array.isArray(value.reuseRuns)?value.reuseRuns.filter((x:unknown)=>object(x)&&text(x.operationId,36)&&UUID.test(x.operationId)&&text(x.status,128)&&text(x.startedAt,100)
      &&['finishedAt','version','holdCode'].every(key=>x[key]===undefined||text(x[key],180))).slice(-20):[],
    events:Array.isArray(value.events)?value.events.filter((x:unknown)=>object(x)&&text(x.eventId,128)&&text(x.createdAt,100)&&object(x.identity)&&text(x.identity.kind,180)
      &&(x.checkpointDelivery===undefined||object(x.checkpointDelivery)&&text(x.checkpointDelivery.status,128))).slice(-30):[] } as Specification;
}
export function normalizeSummaries(value:unknown):Summary[] {
  if(!Array.isArray(value))throw new Error('The saved request list is unavailable.');
  return value.slice(0,100).filter(item=>object(item)&&digest(item.specificationId)).map(item=>({specificationId:item.specificationId,
    viewState:item.viewState==='held'?'held':'available',title:item.viewState==='held'?'Saved request — access held':text(item.title,400)?item.title:'Saved capability request',
    createdAt:text(item.createdAt,100)?item.createdAt:undefined}));
}
export function normalizeProjection(value:unknown,specificationId:string,planId:string):ProjectionView {
  const held=(holds:unknown):ProjectionView=>({viewState:'held',specificationId,planId,holds:holdCodes(holds)});
  if(!object(value)||value.specificationId!==specificationId||value.planId!==planId)return held(['NATIVE_CANDIDATE_IDENTITY_CHANGED']);
  if(value.viewState==='held')return held(value.holds);
  if(value.viewState!=='available'||!text(value.moduleId,128)||!MODULE.test(value.moduleId)||!digest(value.candidateId)
    ||!revision(value.activeRevision)||!candidate(value.candidate)||value.candidate.candidateId!==value.candidateId
    ||value.candidate.identity.manifest.id!==value.moduleId
    ||!requirements(value.requirements)||!revisions(value.revisions)||value.executionAuthorized!==false)return held(['NATIVE_CANDIDATE_VIEW_UNAVAILABLE']);
  return {viewState:'available',specificationId,planId,moduleId:value.moduleId,candidateId:value.candidateId,
    activeRevision:value.activeRevision,candidate:value.candidate,requirements:value.requirements,revisions:value.revisions,executionAuthorized:false};
}

export function readSelection(storage:Pick<Storage,'getItem'>):Selection|null {
  try {const raw=storage.getItem(STORAGE_KEY);if(!raw||raw.length>512)return null;const value=JSON.parse(raw);
    if(!object(value)||value.version!==1||!digest(value.specificationId)||Object.keys(value).some(key=>!['version','specificationId','planId','operationId'].includes(key))
      ||value.planId!==undefined&&!digest(value.planId)||value.operationId!==undefined&&(!text(value.operationId,36)||!UUID.test(value.operationId)))return null;
    return value as Selection;
  } catch{return null;}
}
export function browserSelection():Selection|null {try{return readSelection(window.localStorage);}catch{return null;}}
export function saveSelection(storage:Pick<Storage,'getItem'|'setItem'>,value:Selection):void {
  const raw=JSON.stringify(value);
  if(!readSelection({getItem:()=>raw}))throw new Error('The saved selection identity could not be verified.');
  try {storage.setItem(STORAGE_KEY,raw);if(storage.getItem(STORAGE_KEY)!==raw)throw Error();}
  catch {throw new Error('This browser could not save the operation identity. No new plan was requested.');}
}
export function planForOperation(plans:BuildPlan[],selection:Selection|null):BuildPlan|undefined {
  return plans.find(plan=>selection?.planId===plan.planId)||plans.find(plan=>selection?.operationId===plan.operationId);
}
export function uncertainSource(plans:BuildPlan[]):boolean {
  return plans.some(plan=>['started','held'].includes(plan.jobState??'')&&!plan.sourceReady&&!plan.hasSourceReceipt);
}

type Preparation={specificationId:string;operationId:string};
function preparations(storage:Pick<Storage,'getItem'>):Preparation[] {
  try {
    const raw=storage.getItem(PREPARATIONS_KEY);if(raw===null)return [];
    if(raw.length>2048)throw Error();const data=JSON.parse(raw);
    if(!object(data)||data.version!==1||Object.keys(data).length!==2||!Array.isArray(data.entries)||data.entries.length>8
      ||data.entries.some((row:unknown)=>!object(row)||Object.keys(row).length!==2||!digest(row.specificationId)||!text(row.operationId,36)||!UUID.test(row.operationId))
      ||new Set(data.entries.map((row:Preparation)=>row.specificationId)).size!==data.entries.length)throw Error();
    return data.entries;
  }catch {throw new Error('The saved preparation record is unavailable. No new operation was created.');}
}
export function pendingPreparation(storage:Pick<Storage,'getItem'>,specificationId:string):Preparation|null {
  return preparations(storage).find(row=>row.specificationId===specificationId)??null;
}
function writePreparations(storage:Pick<Storage,'getItem'|'setItem'>,entries:Preparation[]) {
  const raw=JSON.stringify({version:1,entries});
  try {storage.setItem(PREPARATIONS_KEY,raw);if(storage.getItem(PREPARATIONS_KEY)!==raw)throw Error();}
  catch {throw new Error('This browser could not retain the preparation identity. No new plan was requested.');}
}
export async function prepareSavedBuild(storage:Pick<Storage,'getItem'|'setItem'>,specificationId:string,
  request:(action:string,body:Record<string,unknown>)=>Promise<NativeEnvelope>,createId:()=>string):Promise<{selection:Selection;plan:BuildPlan|null;holds:string[]}> {
  if(!digest(specificationId))throw new Error('The saved request identity is unavailable.');
  const pending=preparations(storage);let entry=pending.find(row=>row.specificationId===specificationId);
  if(!entry) {
    if(pending.length>=8)throw new Error('Resume the pending saved preparations before preparing more work.');
    const operationId=createId();if(!UUID.test(operationId))throw new Error('A valid operation identity could not be created.');
    entry={specificationId,operationId};writePreparations(storage,[...pending,entry]);
  }
  const selected:Selection={version:1,...entry};
  saveSelection(storage,selected); // Restore this exact request even if creation never replies.
  const checked=await request('specification',{specificationId});
  const view=normalizeSpecification(checked.held?{viewState:'held',specificationId,holds:checked.specification?.holds,buildPlans:checked.specification?.buildPlans}:checked.specification,specificationId);
  if(checked.held||view.viewState==='held')return {selection:selected,plan:null,holds:view.viewState==='held'?view.holds:['BUILD_CURRENT_OWNER_PROOF_UNAVAILABLE']};
  const previous=planForOperation(view.buildPlans,selected);
  if(!previous&&uncertainSource(view.buildPlans))return {selection:selected,plan:null,holds:['BUILD_SOURCE_OPERATION_REQUIRES_RECONCILIATION']};
  const result=previous?null:await request('specification_build_plan',{specificationId,operationId:entry.operationId});
  const plan=previous??normalizeBuildPlan(result?.held?{...result.buildPlan,viewState:'held'}:result?.buildPlan);
  if(!plan||plan.operationId!==entry.operationId)throw new Error('The prepared plan could not be confirmed. Resume this saved preparation.');
  selected.planId=plan.planId;saveSelection(storage,selected);
  // Read fresh records before removing this one; preserve other saved requests.
  writePreparations(storage,preparations(storage).filter(row=>row.specificationId!==specificationId||row.operationId!==entry!.operationId));
  return {selection:selected,plan,holds:plan.holds};
}

const READS:Record<string,string[]>={wizard_catalog:[],specifications:[],specification:['specificationId'],
  specification_build_plan:['specificationId','planId'],specification_build_candidate:['specificationId','planId']};
export async function nativeApi(action:string,body?:Record<string,unknown>,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<NativeEnvelope> {
  const fields=READS[action];const isRead=fields!==undefined&&fields.every(key=>typeof body?.[key]==='string')
    &&Object.keys(body??{}).length===fields.length;
  const query=new URLSearchParams({action});if(isRead)for(const key of fields)query.set(key,String(body![key]));
  const controller=new AbortController();const abort=()=>controller.abort();
  if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,isRead?15000:action==='call'||action==='specification_reuse'?600000:30000);
  try {
  const response=await fetcher(isRead?`/api/modules?${query}`:'/api/modules',isRead?{cache:'no-store',signal:controller.signal}
    :{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...body}),signal:controller.signal});
  let result:unknown;try {result=await response.json();}catch {throw new Error('The saved result could not be verified. Read its status before continuing.');}
  if(response.status===404&&(action==='wizard_catalog'||action==='specifications'))throw new Error('Native development has not been activated on this worker yet.');
  if(!object(result)||(!response.ok&&response.status!==409))throw new Error(`The saved result is unavailable (HTTP ${response.status}).`);
  const innerHeld=['specification','buildPlan','candidateProjection'].some(key=>object(result[key])&&result[key].viewState==='held');
  return {...result,ok:response.ok&&result.ok!==false,held:!response.ok||result.ok===false||innerHeld} as NativeEnvelope;
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
