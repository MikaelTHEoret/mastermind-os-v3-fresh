import {reviewContentHash} from './native-review.mjs';
import {REVIEW_REUSE,disposition} from './native-review-reuse.mjs';
export const reuseOperation='12121212-1212-4212-8212-121212121212';
export const fields=['acceptanceWorkflow','authority','examples','tests'];
export function reuseInput(operationId='22222222-2222-4222-8222-222222222222',action='assess'){
 const input={schemaVersion:1,action,taskRef:{taskId:'99999999-9999-4999-8999-999999999999',project:'mastermind'},operationId,
 parentOperationId:'77777777-7777-4777-8777-777777777777',specificationId:'a'.repeat(64),reviewId:'b'.repeat(64),acceptedSpecificationId:null,qualificationId:null,decisions:[]};
 if(action==='accept'){const q=reuseReply({...input,action:'assess'});input.acceptedSpecificationId=q.qualification.acceptedSpecificationId;input.qualificationId=q.qualificationId;input.decisions=fields.map(field=>({field,disposition:disposition(field)}));}
 return input;
}
export function reuseReply(input,replayed=false){
 if(input.action==='accept'||input.action==='recover')return {ok:true,operationId:input.operationId,specificationId:input.specificationId,reviewId:input.reviewId,
 acceptedSpecificationId:input.acceptedSpecificationId,qualificationId:input.qualificationId??input.expectedQualificationId,candidateId:'c'.repeat(64),linkId:'f'.repeat(64),
 replayed,reuseLinkAccepted:true,reviewAccepted:false,executionAuthorized:false};
 const assessment={specificationId:input.specificationId,reviewId:input.reviewId,candidateId:'c'.repeat(64),
 taskRef:input.taskRef??reuseInput().taskRef,cases:Array.from({length:8},()=>({evidence:'accepted-suite'})),acceptedSuiteCaseCount:14,executionAuthorized:false,accepted:false};
 const qualification={specificationId:input.specificationId,reviewId:input.reviewId,acceptedSpecificationId:'d'.repeat(64),
 evidence:{assessment,assessmentId:reviewContentHash(assessment)},differences:fields.map(field=>({field})),holds:[],reviewAccepted:false,executionAuthorized:false};
 return {ok:true,qualification,qualificationId:reviewContentHash(qualification),existingLink:{operationId:reuseOperation,linkId:'f'.repeat(64)},executionAuthorized:false};
}
export function reuseReceipt(input){
 const r=reuseReply(input);const common={kind:REVIEW_REUSE,schemaVersion:1,action:input.action,taskRef:input.taskRef,operationId:input.operationId,specificationId:input.specificationId,reviewId:input.reviewId,candidateId:'c'.repeat(64),replayed:false,executionAuthorized:false};
 return input.action==='accept'?{...common,acceptedSpecificationId:r.acceptedSpecificationId,qualificationId:r.qualificationId,linkId:r.linkId,reuseLinkAccepted:true,reviewAccepted:false}:
 {...common,acceptedSpecificationId:r.qualification.acceptedSpecificationId,qualificationId:r.qualificationId,differences:fields,holds:[],exampleCount:8,coveredCount:8,suiteCaseCount:14,existingOperationId:reuseOperation,existingLinkId:'f'.repeat(64)};
}
