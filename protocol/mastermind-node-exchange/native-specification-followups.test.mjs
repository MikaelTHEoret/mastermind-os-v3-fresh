import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeSpecificationInput,validateNativeSpecificationReceipt,specificationRequestHash} from './native-specification.mjs';
const input={schemaVersion:1,action:'prepare',taskRef:{taskId:'99999999-9999-4999-8999-999999999999',project:'mastermind'},operationId:'88888888-8888-4888-8888-888888888888',request:'Compare releases',recipeId:null};
const receipt={kind:'mastermind.native.specification',ok:true,schemaVersion:1,taskRef:input.taskRef,operationId:input.operationId,requestHash:specificationRequestHash(input),savedAt:'2026-09-15T00:00:00Z',replayed:false,executionAuthorized:false,specification:{specificationId:'a'.repeat(64),title:'Compare releases',decision:'create',stage:'needs_specification',requirementsHash:null,missingCount:2}};
test('legacy summaries and bounded actual follow-ups coexist; malformed questions fail closed',()=>{
 assert.deepEqual(validateNativeSpecificationReceipt(receipt,input),receipt);
 const detailed={...receipt,specification:{...receipt.specification,missing:['Confirm behavior.','Supply independent cases.']}};
 assert.deepEqual(validateNativeSpecificationReceipt(detailed,input),detailed);
 for(const missing of [null,'question',[],['only one'],['a',{}],['a',' padded '],['a','bad\nline'],['a','x'.repeat(161)]])
  assert.throws(()=>validateNativeSpecificationReceipt({...detailed,specification:{...detailed.specification,missing}},input));
});
test('revision identity includes the original operation and hash; authority fields and self-links are rejected',()=>{
 const revision={...input,operationId:'77777777-7777-4777-8777-777777777777',revisionOf:{operationId:input.operationId,requestHash:receipt.requestHash}};
 assert.deepEqual(validateNativeSpecificationInput(revision),revision);
 assert.notEqual(specificationRequestHash(revision),specificationRequestHash({...revision,revisionOf:{...revision.revisionOf,requestHash:'f'.repeat(64)}}));
 for(const revisionOf of [null,{}, {...revision.revisionOf,grantRef:'caller'}, {...revision.revisionOf,operationId:revision.operationId}])
  assert.throws(()=>validateNativeSpecificationInput({...revision,revisionOf}));
});
