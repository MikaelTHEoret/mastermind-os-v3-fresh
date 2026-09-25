import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewInput} from '../../../protocol/mastermind-node-exchange/review-fixture.mjs';
import {validateNativeReviewInput,encodeNativeReviewInput} from '../../../protocol/mastermind-node-exchange/native-review-contract.mjs';
import {reuseInput,reuseReceipt} from '../../../protocol/mastermind-node-exchange/review-reuse-fixture.mjs';
import {validateReviewReuseReceipt} from '../../../protocol/mastermind-node-exchange/native-review-reuse.mjs';
import {lifecycleReceipt,validateLifecycleReceipt} from '../../../protocol/mastermind-node-exchange/native-contribution-lifecycle.mjs';
import {id,input,data,local} from './lifecycle-fixture.mjs';

const review=count=>{const r=reviewInput();const base=r.content.requirements.tests.cases[0];r.content.requirements.tests.cases=Array.from({length:count},(_,i)=>({...structuredClone(base),id:`case-${i}`}));return r;};
test('review accepts bounded expanded suites without relaxing byte limits',()=>{
 for(const count of [1,25,26,39,64])assert.equal(encodeNativeReviewInput(review(count)).schemaVersion,2);
 for(const count of [0,65])assert.throws(()=>encodeNativeReviewInput(review(count)));
 const oversized=review(39);oversized.content.requirements.requirements=['x'.repeat(21000)];assert.throws(()=>encodeNativeReviewInput(oversized));
 const legacy=review(1);assert.equal(validateNativeReviewInput(legacy).schemaVersion,1);
});
test('reuse permits larger retained suites but keeps example limits',()=>{
 const i=reuseInput(),r=reuseReceipt(i);
 for(const count of [0,25,26,39,64])assert.equal(validateReviewReuseReceipt({...r,suiteCaseCount:count},i).suiteCaseCount,count);
 for(const count of [-1,65,39.5,true,'39'])assert.throws(()=>validateReviewReuseReceipt({...r,suiteCaseCount:count},i));
 assert.throws(()=>validateReviewReuseReceipt({...r,exampleCount:26,coveredCount:26},i));
});
test('lifecycle progress supports expanded suites and rejects malformed completion',()=>{
 for(const count of [1,25,26,39,64]){
  const d={...data,holds:[],recordedOutcome:'passed',test:{operationId:id(8),status:'passed',caseCount:count,completedCases:count,failedCaseId:null}};
  const result=lifecycleReceipt(local(input,d),input);assert.equal(validateLifecycleReceipt(result,input).data.test.caseCount,count);
  assert.throws(()=>lifecycleReceipt(local(input,{...d,test:{...d.test,completedCases:count-1}}),input));
 }
 for(const count of [0,65,39.5,true,'39'])assert.throws(()=>lifecycleReceipt(local(input,{...data,test:{operationId:id(8),status:'running',caseCount:count,completedCases:0,failedCaseId:null}}),input));
});
