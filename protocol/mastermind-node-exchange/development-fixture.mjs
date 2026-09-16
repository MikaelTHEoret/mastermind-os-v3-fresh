// Synthetic transport values shared by hosted/browser tests, never runtime state.
import {createHash} from 'node:crypto';
import {reviewCanonical} from './native-review-contract.mjs';
import {REVIEW_ARTIFACTS,developmentLocalRequest} from './native-development-work.mjs';
export function developmentFixtureReceipt(kind,input){
 const common={...input,kind,replayed:false,executionAuthorized:false,historicalSnapshot:true,holds:[],requirementsHash:'e'.repeat(64)};
 if(kind===REVIEW_ARTIFACTS){const published=['publish','reconcile','resume'].includes(input.action);return {...common,
  artifactState:published?'published':'proposed',bindingSha256:'c'.repeat(64),commit:'d'.repeat(40),fileCount:3,
  testSpecHash:'f'.repeat(64),gitVerified:published,gitVerifiedAt:published?'2026-09-16T00:00:00.000Z':null,historicalSnapshot:!published,
  mayAutomaticallyRerun:false,candidateAcceptance:'not-run'};}
 const {action,...binding}=developmentLocalRequest(kind,input);
 return {...common,requestHash:createHash('sha256').update(reviewCanonical(binding)).digest('hex'),planId:'c'.repeat(64),state:'awaiting_coding_authority',
  current:true,decision:'create',moduleId:'fixture-calculator',jobState:'prepared',candidateId:null,hasSourceReceipt:false,workerInvoked:false};
}
