import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
import nextEnv from '@next/env';
import canonicalTarget from '../../../memory-system/canonical-memory-target.cjs';
import {NeonMemoryStore} from '../src/neon-store.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
export async function captureCheckpointOrderingQuery(){
 const ids=['00000000-0000-8000-8000-000000000011','00000000-0000-8000-8000-000000000012','00000000-0000-8000-8000-000000000013'];
 const calls=[],store=Object.create(NeonMemoryStore.prototype);
 store.sql={async query(statement,parameters){calls.push({statement,parameters});return calls.length===1?ids.map(taskId=>({taskId})):[];}};
 await store.projectState('fixture',20,{householdId:'fixture',actorPlayerId:'00000000-0000-8000-8000-000000000001'});
 if(calls.length!==2 || !calls[1].statement.includes('SELECT DISTINCT ON (task_id)'))throw Error('CHECKPOINT_QUERY_CAPTURE_FAILED');
 const source=readFileSync(path.join(directory,'../src/neon-store.mjs'));
 return{schemaVersion:1,statement:calls[1].statement,parameters:calls[1].parameters,storeSha256:crypto.createHash('sha256').update(source).digest('hex')};
}
export async function runFixture(){
 nextEnv.loadEnvConfig(path.resolve(directory,'../../..'),true,{info(){},error(){}});
 const dsn=canonicalTarget.resolveMemoryUrl({},process.env),input=await captureCheckpointOrderingQuery();
 const result=spawnSync('C:/Python314/python.exe',[path.join(directory,'checkpoint-ordering-fixture.py')],{
  input:JSON.stringify(input),env:{...process.env,NEON_MEMORY_DSN:dsn,PYTHONUTF8:'1'},encoding:'utf8',timeout:30000,maxBuffer:65536,windowsHide:true,
 });
 // Never emit driver stderr, connection strings, or partial child output.
 if(result.error || result.status!==0 || !result.stdout || result.stdout.length>65536)return{ok:false,error:{code:'CHECKPOINT_SQL_FIXTURE_PROCESS_FAILED'}};
 try{return JSON.parse(result.stdout);}catch{return{ok:false,error:{code:'CHECKPOINT_SQL_FIXTURE_INVALID_REPORT'}};}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const result=await runFixture();process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=result.ok?0:1;}
 catch{process.stdout.write(JSON.stringify({ok:false,error:{code:'CHECKPOINT_SQL_FIXTURE_CONFIGURATION_OR_CAPTURE_FAILED'}})+'\n');process.exitCode=1;}
}
