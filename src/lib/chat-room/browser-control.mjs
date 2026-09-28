import {checkedObservation} from './observation-client.mjs';
export const controlErrors={
 'room-control-not-enabled':'Enable controls in Mastermind once in the updated extension. The connection then survives restarts.',
 'room-changed':'The saved browser transfer belongs to a different room or turn.',
 'transfer-busy':'The browser is working on this transfer. Check again shortly.',
 'room-save-needs-recovery':'An earlier room save needs its original recovery. No new save was made.',
 'provider-unavailable':'Open the existing Z.ai conversation containing this prompt. It will not be resent.',
 'provider-ambiguous':'More than one Z.ai tab matches. Keep one copy of the intended conversation open.',
 'provider-inspection-incomplete':'A provider page could not be inspected. No potentially wrong conversation was selected.',
 'too-many-provider-tabs':'Too many Z.ai tabs are open for bounded discovery.',
};
export function browserControl(target,ref,turnId,action,{timeout=20000,id=crypto.randomUUID()}={}){
 if(!['discover','status','check','reconnect','pause','disconnect'].includes(action))return Promise.reject(Error('Unsupported browser control.'));
 return new Promise((resolve,reject)=>{
  const cleanup=()=>{target.removeEventListener('message',receive);clearTimeout(timer);};
  const receive=event=>{
   if(event.source!==target||event.origin!==target.location.origin||event.data?.type!=='mastermind-browser-response'||event.data.id!==id)return;
   cleanup();const value=event.data.value;
   if(value?.ok!==true){reject(Error(controlErrors[value?.code]??'Browser connection unavailable. Refresh the website after reloading the extension.'));return;}
   try{if(action==='discover'){
    if(value.version!==1||value.transport!=='mastermind-browser')throw Error('Unsupported browser connection.');resolve(value);
   }else resolve(checkedObservation(value,ref,turnId));}catch(e){reject(e);}
  };
  const timer=setTimeout(()=>{cleanup();reject(Error('No browser response. Reload the updated extension, then refresh this website. No prompt was sent.'));},timeout);
  target.addEventListener('message',receive);
  target.postMessage({type:'mastermind-browser-request',id,action,ref,turnId},target.location.origin);
 });
}
