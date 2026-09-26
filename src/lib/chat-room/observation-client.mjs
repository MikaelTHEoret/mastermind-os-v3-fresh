const states=new Set(['reviewed','send-intent','observing','uncertain','captured','saved']);
export const observationLabels={reviewed:'Prompt reviewed; not sent', 'send-intent':'Send outcome needs checking',observing:'Waiting for a complete reply',uncertain:'Delivery or capture needs checking',captured:'Reply captured; not saved to the room',saved:'Extension recorded a saved reply; refresh the room to verify'};
export const observationErrors={
 'connection-not-paired':'Connect this turn in the extension again. Access may have expired.',
 'room-changed':'Open the original room in its connected Mastermind tab.',
 'transfer-changed':'The connected turn changed. Recover its original record before continuing.',
 'room-save-needs-recovery':'An earlier room save needs recovery in the extension. No new save was made.',
 'transfer-busy':'The extension is working on this transfer. Check again when it finishes.',
 'page-layout-changed':'The provider page layout changed. Automatic capture stopped; the existing reply has not been resent.',
 'tab-unavailable':'The original provider tab is unavailable. Reopen the existing conversation; do not send the prompt again.',
 'model-changed':'The selected provider model changed. Check the original conversation.',
 'conversation-changed':'The original conversation no longer matches this transfer.',
 'storage-unavailable':'The browser could not save observation progress.',
 'observation-failed':'The reply check failed. Inspect the original conversation and extension diagnostic.',
};
export function checkedObservation(value,ref,turnId){
 if(value?.ok!==true)throw Error(observationErrors[value?.code]??'Browser connection unavailable. Check its code, permissions and original room tab.');
 if(value.version!==1||value.ref?.taskId!==ref.taskId||value.ref?.session!==ref.session||value.turnId!==turnId||!states.has(value.state)||!Number.isFinite(Date.parse(value.checkedAt)))throw Error('The browser returned a different or invalid transfer.');
 if(value.answer&&(value.state!=='captured'||typeof value.answer.text!=='string'||new TextEncoder().encode(value.answer.text).length>48000||!Number.isFinite(Date.parse(value.answer.observedAt))||!/^[a-f0-9]{64}$/.test(value.answer.sha256)))throw Error('The captured reply is invalid.');
 return value;
}
export function requestObservation(runtime,extensionId,ref,turnId,action){
 if(!/^[a-p]{32}$/.test(extensionId)||!runtime?.sendMessage)return Promise.reject(Error('Enter the connection code shown by the updated extension in Chrome.'));
 if(!['status','check'].includes(action))return Promise.reject(Error('Unsupported browser action.'));
 return new Promise((resolve,reject)=>{
  let finished=false;
  const timer=setTimeout(()=>{finished=true;reject(Error('The browser did not answer. No prompt was sent; read status before checking again.'));},20000);
  try{runtime.sendMessage(extensionId,{version:1,ref,turnId,action},value=>{
   const error=runtime.lastError;if(finished)return;finished=true;clearTimeout(timer);
   if(error){reject(Error('Browser connection unavailable. Connect this turn in the updated extension first.'));return;}
   try{resolve(checkedObservation(value,ref,turnId));}catch(e){reject(e);}
  });}catch{finished=true;clearTimeout(timer);reject(Error('Browser connection unavailable.'));}
 });
}
