import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
const directory=path.dirname(fileURLToPath(import.meta.url));
nextEnv.loadEnvConfig(path.resolve(directory,'../../..'),true,{info(){},error(){}});
if (!process.env.NEON_MEMORY_URL) throw new Error('The canonical memory target is not configured.');
const result=spawnSync('C:/Python314/python.exe',[path.join(directory,'core-sql-fixture.py'),...process.argv.slice(2)],{
  env:{...process.env,NEON_MEMORY_DSN:process.env.NEON_MEMORY_URL},encoding:'utf8',timeout:120000,maxBuffer:65536,windowsHide:true,
});
if(result.stdout) process.stdout.write(result.stdout);
if(result.error) process.stdout.write(JSON.stringify({ok:false,error:{type:result.error.name,code:result.error.code}})+'\n');
// Never forward arbitrary driver stderr or connection parameters.
process.exitCode=result.status ?? 1;
