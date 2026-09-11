import {canonical,validateRecord,digestId,taskRef} from './contract.mjs';
export async function checkedArtifact(value,ref){
 if(!value||typeof value!=='object')throw Error('Invalid saved artifact.');
 const record=validateRecord(value.record);digestId(value.artifactId);
 if(canonical(record.taskRef)!==canonical(ref)||typeof value.recordedAt!=='string'||!Number.isFinite(Date.parse(value.recordedAt)))throw Error('Invalid saved artifact binding.');
 const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(record)));
 const hash=Array.from(new Uint8Array(raw),b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==value.artifactId)throw Error('Saved artifact failed its integrity check.');
 return {...value,record};
}
export async function checkedAcknowledgement(body,record){
 if(body.executionAuthorized!==false||!['created','duplicate'].includes(body.status))throw Error('Invalid save acknowledgement.');
 const row=await checkedArtifact(body.artifact,record.taskRef);
 if(canonical(row.record)!==canonical(record))throw Error('Saved response did not match the submission.');
 return row;
}
export function checkedTasks(value){
 if(!Array.isArray(value)||value.length>32)throw Error('Task list unavailable.');
 return value.map(t=>{
  taskRef({taskId:t.taskId,project:t.project});
  if(typeof t.title!=='string'||!t.title.trim()||t.title.length>1000)throw Error('Invalid shared task.');
  return {taskId:t.taskId,project:t.project,title:t.title};
 }).filter(t=>t.project==='mastermind');
}
export async function contributionJson(url,init){
 const r=await fetch(url,{...init,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!r.body)throw Error('The shared record is unavailable.');
 const reader=r.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
  if(size>4400000)throw Error('The shared response exceeds this profile.');chunks.push(value);
 }}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 const data=new Uint8Array(size);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.byteLength;}
 const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
 if(!r.ok||body?.ok!==true)throw Error(typeof body?.error==='string'?body.error:'The shared record is unavailable.');
 return body;
}
