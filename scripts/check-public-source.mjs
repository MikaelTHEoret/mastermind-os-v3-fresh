// Public, synthetic-only test selection. Never invoke live SQL fixtures or workers.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function assertPublicEnvironment(root, env=process.env) {
for(const name of ['NEON_MEMORY_URL','NEON_MEMORY_DSN','NEON_PRIMARY_URL','DATABASE_URL',
 'CLERK_SECRET_KEY','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','OWNER_CLERK_USER_ID',
 'OPENAI_API_KEY','NEXUS_LLM_API_KEY','OLLAMA_EMBED_TOKEN','ENCRYPTION_KEY','SECRET_KEY']){
 if(env[name])throw Error('PUBLIC_SOURCE_CHECKS_REQUIRE_UNCONFIGURED_OPERATOR_ENVIRONMENT');
}
for(const name of ['.env','.env.local','.env.development','.env.development.local',
 '.env.test','.env.test.local','.env.production','.env.production.local']){
 if(fs.existsSync(path.join(root,name)))throw Error('PUBLIC_SOURCE_CHECKS_REFUSE_LOCAL_ENV_FILES');
}
}

export function runPublicSourceChecks(root=process.cwd()) {
assertPublicEnvironment(root);
const directories=['src','services/mastermind-context-gateway/test','services/mastermind-node-link',
 'protocol','scripts/test','memory-system'];
const files=directories.flatMap(directory=>fs.readdirSync(path.join(root,directory),{recursive:true,withFileTypes:true})
 .filter(entry=>entry.isFile() && /\.test\.(?:mjs|cjs)$/.test(entry.name))
 .map(entry=>path.relative(root,path.join(entry.parentPath??entry.path,entry.name)))).sort();
const normalized=new Set(files.map(file=>file.replaceAll('\\','/')));
for(const required of ['src/lib/genealogy/__tests__/capture-boundary.test.mjs',
 'src/lib/genealogy/__tests__/catalogue-ui.test.mjs',
 'services/mastermind-context-gateway/test/checkpoint-ordering.test.mjs',
 'services/mastermind-context-gateway/test/hosted-api-boundary.test.mjs',
 'src/lib/node-exchange/__tests__/node-control-ui.test.mjs']){
 if(!normalized.has(required))throw Error('PUBLIC_SOURCE_TEST_CLOSURE_INCOMPLETE');
}
if(files.length===0 || files.length>200 || new Set(files).size!==files.length)throw Error('PUBLIC_SOURCE_TEST_INVENTORY_INVALID');
console.log(JSON.stringify({kind:'public-source-fixtures',fileCount:files.length,liveDatabaseFixture:false}));
const result=spawnSync(process.execPath,['--test','--test-concurrency=2',...files],{
 cwd:root,env:process.env,stdio:'inherit',timeout:240000,windowsHide:true,
});
if(result.error)console.error('PUBLIC_SOURCE_FIXTURE_PROCESS_FAILED');
return result.status??1;
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 process.exitCode=runPublicSourceChecks();
}
