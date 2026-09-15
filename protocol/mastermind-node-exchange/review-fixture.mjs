import {reviewContentHash} from './native-review.mjs';
export const reviewText='Add two supplied integers and reject missing inputs.';
export function reviewInput(operationId='22222222-2222-4222-8222-222222222222') {
 const taskRef={taskId:'99999999-9999-4999-8999-999999999999',project:'mastermind'},specificationId='a'.repeat(64);
 return {schemaVersion:1,action:'prepare',taskRef,operationId,parentOperationId:'88888888-8888-4888-8888-888888888888',specificationId,originalRequest:reviewText,
  content:{schemaVersion:1,specificationId,requestSha256:reviewContentHash(reviewText),mode:'create',expectedActiveRevision:null,reuseEvidence:null,
   requirements:{schemaVersion:1,kind:'mastermind.module-requirements',moduleId:'fixture-calculator',version:'1.0.0',taskRef,
    requirements:['Add both supplied integers.','Reject missing inputs.'],effects:{network:false,filesystem:'none',childProcesses:false},
    contracts:[{name:'fixture-calculator.add',effectClass:'READ_ONLY',inputSchema:{type:'object',properties:{left:{type:'integer'},right:{type:'integer'}},required:['left','right'],additionalProperties:false},outputSchema:{type:'integer'}}],
    tests:{schemaVersion:1,cases:[{id:'addition',capability:'fixture-calculator.add',input:{left:2,right:3},expected:5}]}},
   coverage:[{start:0,end:reviewText.length,text:reviewText,requirements:[0,1],status:'covered'}]}};
}
export function reviewReply(input,replayed=false) {
 return {ok:true,schemaVersion:1,operationId:input.operationId,specificationId:input.specificationId,replayed,accepted:false,executionAuthorized:false,
  review:{reviewId:'b'.repeat(64),state:'proposed',holds:[],accepted:false,executionAuthorized:false,current:true,historicalSnapshot:true,operations:[],
   originalRequest:reviewText,content:input.content,contentSha256:reviewContentHash(input.content)}};
}
