import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createMastermindCoreOnlyWorker } from '../src/core-worker.mjs';
import { createMastermindCoreWorkerFromEnvironment, runMastermindCoreWorkerProcess } from '../src/run-core-worker.mjs';
import { runMastermindNodeWorkerEntrypoint } from '../src/run-worker.mjs';
import { acquireMastermindNodeWorkerLifetime } from '../src/worker-lifetime.mjs';
import { FileMastermindNodeEffectJournal } from '../src/effect-journal.mjs';
import { CORE_ONLY_WORKER, CORE_WORKER, digestMastermindNodeCommand } from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
import { NODE_ID, NODE_CREDENTIAL, PAIRING_ID, PAIRING_CREDENTIAL, BOOT_ID, lease, command } from './fixtures.mjs';

const AT = '2026-08-15T04:00:02.000Z';
const result = { kind: 'mastermind.core.status', observedAt: AT, services: { mcpHost: 'online', memory: 'online', modules: 'online' }, capabilities: { count: 1, sha256: 'a'.repeat(64) }, activeTurns: 0, complete: true };
const environment = (extra={}) => ({ LOCALAPPDATA: 'C:\\Users\\Fixture\\AppData\\Local', MASTERMIND_MINECRAFT_DATA_DIR: 'E:\\RetainedPortable', MASTERMIND_NODE_WORKER_PROFILE: 'core-only', MASTERMIND_LOCAL_CHILD_ROLE: 'mastermind-node-link-core', ...extra });
const paired = (state='paired') => ({ schemaVersion: 1, state, nodeId: NODE_ID, nodeCredential: NODE_CREDENTIAL,
  pairingId: PAIRING_ID, pairingCredential: state === 'pending' ? PAIRING_CREDENTIAL : null,
  displayName: 'Disposable fixture', createdAt: '2026-08-15T04:00:00.000Z', pairedAt: state === 'paired' ? AT : null });
function coreLease() { const c=command({capability:'mastermind.core.status'}); return lease({...c,commandDigest:digestMastermindNodeCommand(c)}); }
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mm-core-worker-'));
  t.after(async()=>{ assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)); await fs.rm(root,{recursive:true,force:true}); });
  return root;
}

test('fixed core production composition reuses the host vault and portable journal without a control token',()=>{
  let vault, transport, worker; const credential={load(){}};
  const value=createMastermindCoreWorkerFromEnvironment({ environment:environment({MASTERMIND_NODE_EXCHANGE_URL:'https://untrusted.invalid',MASTERMIND_CONTROL_TOKEN:'must-not-forward'}),
    credentialStoreFactory(args){vault=args;return credential;}, transportFactory(args){transport=args;return {};}, workerFactory(args){worker=args;return args;} });
  assert.equal(value,worker);assert.equal(vault.vaultFile,'C:\\Users\\Fixture\\AppData\\Local\\Mastermind\\node-link\\credential-v1.dpapi.json');
  assert.equal(worker.journalRoot,'E:\\RetainedPortable\\state\\node-exchange\\v1');
  assert.equal(worker.credentialStore,credential);assert.deepEqual(Object.keys(transport),['credentialStore']);
  assert.equal(Object.hasOwn(worker,'controlToken'),false);assert.equal(Object.hasOwn(worker,'localAgent'),false);
  assert(vault.dpapiScriptFile.endsWith(path.join('scripts','protect-minecraft-account.ps1')));
});

test('missing explicit profile and unsafe runtime settings deny before constructing credential dependencies',()=>{
  for(const bad of [environment({MASTERMIND_NODE_WORKER_PROFILE:undefined}),environment({MASTERMIND_LOCAL_CHILD_ROLE:'next-web'}),environment({NODE_OPTIONS:'--require untrusted'})]) {
    assert.throws(()=>createMastermindCoreWorkerFromEnvironment({environment:bad,credentialStoreFactory(){throw new Error('must not construct');}}),{code:bad.NODE_OPTIONS?'NODE_CORE_ENVIRONMENT_INVALID':'NODE_CORE_PROFILE_REQUIRED'});
  }
});

test('actual core composition executes and journals one typed read; reconnect replays without family code',async(t)=>{
  const root=await fixture(t);let reads=0,exchanges=0;
  const options={journalRoot:root,credentialStore:{async load(){return paired();}},bootId:BOOT_ID,now:()=>Date.parse(AT),monotonicNow:()=>1,
    coreStatusClient:{async observeStatus(){reads++;return result;}},exchangeTransport:{async pair(){throw new Error('no pairing');},async exchange(request){
      exchanges++;assert.deepEqual(request.worker,CORE_ONLY_WORKER);assert.equal(request.status.familyServer,'unknown');assert.equal(request.status.companion,'unknown');
      return {schemaVersion:2,exchangeId:request.exchangeId,serverTime:AT,nextPollAfterMs:5000,acceptedWorker:CORE_ONLY_WORKER,acknowledgedReceiptIds:request.receipts.map(r=>r.receiptId),lease:coreLease()};
    }}};
  for(const key of ['controlToken','localAgent','executor'])Object.defineProperty(options,key,{get(){throw new Error('family dependency must not be accessed');}});
  const worker=createMastermindCoreOnlyWorker(options);assert.equal(Object.hasOwn(worker,'beginPairing'),false);
  assert.equal((await worker.runOnce()).execution.replayed,false);assert.equal((await worker.runOnce()).execution.replayed,true);
  assert.equal(reads,1);assert.equal(exchanges,2);await worker.stop();
});

test('a family lease or expanded worker echo is rejected before any core observation',async(t)=>{
  for(const accepted of [CORE_ONLY_WORKER,CORE_WORKER]) {
    const root=await fixture(t);let reads=0;
    const worker=createMastermindCoreOnlyWorker({journalRoot:root,credentialStore:{async load(){return paired();}},coreStatusClient:{async observeStatus(){reads++;return result;}},
      exchangeTransport:{async pair(){},async exchange(req){return {schemaVersion:2,exchangeId:req.exchangeId,serverTime:AT,nextPollAfterMs:5000,acceptedWorker:accepted,acknowledgedReceiptIds:[],lease:lease()};}}});
    await assert.rejects(worker.runOnce());assert.equal(reads,0);await worker.stop();
  }
});

test('pending enrollment is held without pairing or credential updates',async(t)=>{
  const root=await fixture(t);let calls=0;
  const worker=createMastermindCoreOnlyWorker({journalRoot:root,credentialStore:{async load(){return paired('pending');},async markPaired(){calls++;}},
    exchangeTransport:{async pair(){calls++;},async exchange(){calls++;}}});
  await assert.rejects(worker.runOnce(),{code:'NODE_CORE_EXISTING_PAIRING_REQUIRED'});assert.equal(calls,0);await worker.stop();
});

test('retained family receipts hold before exchange and remain byte-identical',async(t)=>{
  const root=await fixture(t);const journal=new FileMastermindNodeEffectJournal(root);await journal.initialize();await journal.selectNode(NODE_ID);
  const family=lease();await journal.begin(family);await journal.appendReceipt(family,BOOT_ID,{state:'accepted',stage:'journaled',code:'accepted',retryable:false,result:null});
  const before=await journal.listPendingReceipts();let exchanges=0;
  const worker=createMastermindCoreOnlyWorker({journalRoot:root,journal,credentialStore:{async load(){return paired();}},exchangeTransport:{async pair(){},async exchange(){exchanges++;}}});
  await assert.rejects(worker.runOnce(),{code:'NODE_RECEIPT_CAPABILITY_RECONCILIATION_REQUIRED'});
  assert.equal(exchanges,0);assert.deepEqual(await journal.listPendingReceipts(),before);await worker.stop();
});

test('core process acquires the common lifetime before composition and releases on stop',async()=>{
  const processObject=new EventEmitter();processObject.argv=['node','run-core-worker.mjs'];processObject.env=environment();
  const events=[];let releaseWait;const waiting=new Promise(r=>{releaseWait=r;});
  const running=runMastermindCoreWorkerProcess({processObject,writeDiagnostic(){throw new Error('not expected');},lifetimeFactory:async()=>{events.push('lease');return {release:async()=>{events.push('release');}};},
    credentialStoreFactory(){events.push('credential');return {};},transportFactory(){return {};},workerFactory(){return {async start(){events.push('start');},async wait(){await waiting;},async stop(){events.push('stop');releaseWait();}};}});
  await new Promise(r=>setImmediate(r));processObject.emit('SIGTERM');assert.equal(await running,0);
  assert.deepEqual(events,['lease','credential','start','stop','release']);
});

test('both production entrypoints deny a busy lifetime before touching credentials or starting a worker',async()=>{
  for(const run of [runMastermindCoreWorkerProcess,runMastermindNodeWorkerEntrypoint]){
    const processObject=new EventEmitter();processObject.argv=['node','fixed-entrypoint'];processObject.env=environment({MASTERMIND_LOCAL_CONTROL_ENABLED:'true',MASTERMIND_CONTROL_URL:'http://127.0.0.1:43100',MASTERMIND_CONTROL_TOKEN:'a'.repeat(64),MASTERMIND_LOCAL_CHILD_ROLE:run===runMastermindCoreWorkerProcess?'mastermind-node-link-core':'mastermind-node-link'});
    const lines=[];const code=await run({processObject,writeDiagnostic:line=>lines.push(line),lifetimeFactory:async()=>{throw Object.assign(new Error('private details must not appear'),{code:'NODE_WORKER_LIFETIME_UNAVAILABLE'});},credentialStoreFactory(){throw new Error('must not construct');}});
    assert.equal(code,1);assert.match(lines[0],/NODE_WORKER_LIFETIME_UNAVAILABLE/);assert(!lines[0].includes('private details'));
  }
});

test('OS lifetime excludes a second process and becomes available after owner release',async(t)=>{
  const root=await fixture(t);const owned=await acquireMastermindNodeWorkerLifetime(root);
  const moduleUrl=new URL('../src/worker-lifetime.mjs',import.meta.url).href;
  const script=`import {acquireMastermindNodeWorkerLifetime as acquire} from ${JSON.stringify(moduleUrl)};try{const lease=await acquire(${JSON.stringify(root)});await lease.release();process.stdout.write('acquired');}catch(error){process.stdout.write(error.code);process.exitCode=2;}`;
  try {
    const blocked=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:10000,windowsHide:true});
    assert.equal(blocked.status,2);assert.equal(blocked.stdout,'NODE_WORKER_LIFETIME_UNAVAILABLE');
  } finally {await owned.release();}
  const accepted=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(accepted.status,0);assert.equal(accepted.stdout,'acquired');
});
