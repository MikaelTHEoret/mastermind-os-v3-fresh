import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './nexus-recovery-fixture.json' with {type:'json'};
import {checkedMaterial,proposalNode} from './nexus-owner-workflow.mjs';
import {validateRecord} from './contract.mjs';
import {readinessInput} from './nexus-proposal.mjs';
import {validNativeChoice,nexusReceipt,validateNexusReceipt} from '../../../protocol/mastermind-node-exchange/native-nexus.mjs';
const choice=fixture.material.plans.find(p=>p.kind==='native-candidate-v1');
test('real Python native catalog agrees with JS owner and proposal validators',async()=>{
 assert.equal(validNativeChoice(choice),true);
 checkedMaterial({...fixture.material,plans:[choice]},fixture.material.taskRef);
 validateRecord(fixture.proposal);
 await nexusReceipt(fixture.receipt,fixture.request);
 assert.throws(()=>readinessInput(fixture.proposal),/NOT_CODING_READINESS/);
});
test('native references cannot claim a coding ID, dependencies or altered source address',()=>{
 for(const change of [{planId:'a'.repeat(64)},{recoveryId:'not-a-hash'},
  {sourceRefs:['mastermind/build-plan/'+'a'.repeat(64),choice.sourceRefs[1]]},
  {recovery:{...choice.recovery,hostReceiptsVerifiedNow:true,recordedAccepted:false}}])
  assert.equal(validNativeChoice({...choice,...change}),false);
 assert.throws(()=>proposalNode(choice,{[choice.recoveryId]:['a'.repeat(64)]}));
 const p=structuredClone(fixture.proposal);p.nodes[0].dependsOn=[choice.recoveryId];assert.throws(()=>validateRecord(p));
});
test('version-one receipt refuses native observations and mixed input versions',()=>{
 const receipt={...fixture.receipt,data:{...fixture.receipt.data,choice,nextCursor:null}};
 validateNexusReceipt(receipt,fixture.request);
 assert.throws(()=>validateNexusReceipt({...receipt,schemaVersion:1},{...fixture.request,schemaVersion:1}));
 assert.throws(()=>validateNexusReceipt(receipt,{...fixture.request,schemaVersion:1}));
});
