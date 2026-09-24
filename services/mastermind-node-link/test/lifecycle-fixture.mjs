import {LIFECYCLE,lifecycleLocalRequest} from '../../../protocol/mastermind-node-exchange/native-contribution-lifecycle.mjs';
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const input={schemaVersion:1,action:'inspect',taskRef:{taskId:id(1),project:'mastermind'},specificationId:'a'.repeat(64),importOperationId:id(2),candidateId:'b'.repeat(64),operation:null,lifecycleOperationId:null,expectedActiveRevision:null,operationId:id(3)};
export const data={operationState:'inspection',moduleId:'development.packet',version:'1.1.0',activeRevision:'c'.repeat(64),currentlyActive:false,activeProxyAvailable:false,recordedOutcome:null,test:null,rollbackRevision:'c'.repeat(64),rollbackAccepted:true,holds:['NATIVE_TESTS_NOT_STARTED']};
export const local=(i=input,d=data,recover=false)=>({...lifecycleLocalRequest(i,recover),kind:LIFECYCLE,observedAt:'2026-09-24T18:00:00.000Z',executionAuthorized:false,mayAutomaticallyRerun:false,historicalSnapshot:true,...d});
