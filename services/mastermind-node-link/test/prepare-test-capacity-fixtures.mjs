import fs from 'node:fs';
import {reviewInput} from '../../../protocol/mastermind-node-exchange/review-fixture.mjs';
import {reviewCanonical,validateNativeReviewInput} from '../../../protocol/mastermind-node-exchange/native-review-contract.mjs';
import {reuseInput,reuseReceipt} from '../../../protocol/mastermind-node-exchange/review-reuse-fixture.mjs';
import {validateReviewReuseReceipt} from '../../../protocol/mastermind-node-exchange/native-review-reuse.mjs';
import {validateLifecycleReceipt} from '../../../protocol/mastermind-node-exchange/native-contribution-lifecycle.mjs';
import {id,input,data} from './lifecycle-fixture.mjs';
const fixture={reviews:[],reuse:[],lifecycle:[]};
for(const count of [0,1,25,26,39,64,65]){
 const i=reviewInput(),base=i.content.requirements.tests.cases[0];i.content.requirements.tests.cases=Array.from({length:count},(_,n)=>({...structuredClone(base),id:`case-${n}`}));
 const encoded={...i,schemaVersion:2,content:reviewCanonical(i.content)};
 fixture.reviews.push({name:`count-${count}`,input:encoded,valid:count>=1&&count<=64});
 const reuse=reuseInput();fixture.reuse.push({name:`count-${count}`,input:reuse,result:{...reuseReceipt(reuse),suiteCaseCount:count},valid:count<=64});
 fixture.lifecycle.push({name:`count-${count}`,input,result:{...input,kind:'mastermind.native.contribution-lifecycle',observedAction:'inspect',observedAt:'2026-09-24T18:00:00.000Z',recoveryOnly:false,data:{...data,holds:[],recordedOutcome:'passed',test:{operationId:id(8),status:'passed',caseCount:count,completedCases:count,failedCaseId:null}}},valid:count>=1&&count<=64});
}
for(const count of [-1,39.5,true,'39']){
 for(const name of ['reuse','lifecycle']){const r=structuredClone(fixture[name].find(r=>r.name==='count-39'));r.name=`invalid-${JSON.stringify(count)}`;r.valid=false;if(name==='reuse')r.result.suiteCaseCount=count;else r.result.data.test.caseCount=count;fixture[name].push(r);}
}
let r=structuredClone(fixture.reuse.find(r=>r.name==='count-39'));r.name='examples-still-25';r.valid=false;r.result.exampleCount=26;r.result.coveredCount=26;fixture.reuse.push(r);
r=structuredClone(fixture.reviews.find(r=>r.name==='count-39'));r.name='oversized';r.valid=false;const c=JSON.parse(r.input.content);c.requirements.requirements=['x'.repeat(21000)];r.input.content=reviewCanonical(c);fixture.reviews.push(r);
for(const [name,validate] of [['reviews',r=>validateNativeReviewInput(r.input)],['reuse',r=>validateReviewReuseReceipt(r.result,r.input)],['lifecycle',r=>validateLifecycleReceipt(r.result,r.input)]])for(const r of fixture[name]){let ok=true;try{validate(r);}catch{ok=false;}if(ok!==r.valid)throw Error(`JS expectation mismatch: ${name}/${r.name}`);}
fs.writeFileSync(new URL('./test-capacity-fixtures.json',import.meta.url),JSON.stringify(fixture),{flag:'wx'});
console.log(`Frozen ${Object.values(fixture).reduce((n,rows)=>n+rows.length,0)} cross-language boundary fixtures.`);
