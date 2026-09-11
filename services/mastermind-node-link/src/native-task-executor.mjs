import {NativeTaskClient} from './native-task-client.mjs';
import {NATIVE_REUSE_CAPABILITY,validateNativeTaskResult} from '../../../protocol/mastermind-node-exchange/native-task.mjs';
import {validateMastermindNodeLease,validateMastermindNodeCommand} from '../../../protocol/mastermind-node-exchange/contract.v2.mjs';
import {MastermindNodeExecutionError} from './executor.mjs';
import {CoreStatusExecutor} from './core-status-client.mjs';

export class NativeTaskExecutor extends CoreStatusExecutor {
  constructor({native = new NativeTaskClient(), ...options}) { super(options); this.native=native; }
  async nativeResult(rawCommand,options,action) {
    const lease=validateMastermindNodeCommand(Object.fromEntries(
      ['jobId','nodeId','capability','capabilityVersion','policyClass','input'].map(key=>[key,rawCommand[key]])));
    if(lease.capability!==NATIVE_REUSE_CAPABILITY)throw new MastermindNodeExecutionError('local-response-invalid','Unsupported native operation.',{retryable:false});
    const reply=await this.native.execute({...lease.input,action},options);
    if(!reply.ok)throw new MastermindNodeExecutionError('recovery-manual-repair','Native operation is held for reconciliation.',{retryable:false});
    const result=reply.reuse;
    return validateNativeTaskResult({kind:NATIVE_REUSE_CAPABILITY,operationId:lease.jobId,
      specificationId:lease.input.specificationId,taskRef:lease.input.taskRef,candidateId:result.candidateId,
      capability:result.capability,inputSha256:result.inputSha256,resultSha256:result.resultSha256,
      result:result.result,replayed:result.replayed});
  }
  async execute(rawLease,options) {
    const lease=validateMastermindNodeLease(rawLease);
    if(lease.capability!==NATIVE_REUSE_CAPABILITY)return super.execute(lease,options);
    if(options.signal?.aborted)throw options.signal.reason;
    if(!Number.isFinite(options.deadlineMs)||this.now()>=options.deadlineMs)throw new MastermindNodeExecutionError('lease-lost','Native task deadline expired.',{retryable:false});
    await options.emit('checking-local-state');
    return this.nativeResult(lease,options,options.recoverOnly ? 'recover' : 'execute');
  }
  async authorizeReceipt(command,options) {
    return this.nativeResult(command,options,'recover');
  }
  async authorizeReplay(lease,options) {
    if(lease.capability===NATIVE_REUSE_CAPABILITY)return this.nativeResult(lease,options,'recover');
  }
}
