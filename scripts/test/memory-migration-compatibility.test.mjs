import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { assertLegacyBootstrapTarget } from '../lib/memory-migration-compatibility.mjs';

const older = { owner_replay:false,task_permissions:false,permission_columns:false,negotiated_nodes:false,worker_column:false };
const source=await fs.readFile(new URL('../apply-memory-migrations.mjs',import.meta.url),'utf8');
const compiled=ts.transpileModule(source.replace('main().catch(', 'globalThis.__completion = main().catch('),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText;
async function runFixture(state) {
  const evidence={queries:0,migrationReads:0,transactions:0,statements:0,logs:[],exitCode:0};
  const sql=async()=>{evidence.queries++;return evidence.queries===1?[state]:[{events:true,players:true,lifecycle:true,nodes:true,node_jobs:true,context_tasks:true,genealogy_assets:true}];};
  sql.transaction=async(fn)=>{evidence.transactions++;return Promise.all(fn({query:async()=>{evidence.statements++;return [];}}));};
  const module={exports:{}};
  const sandbox={exports:module.exports,module,process:{env:{NEON_MEMORY_URL:'disposable-driver-fixture'},cwd:()=>'.',exitCode:0},
    console:{log(value){evidence.logs.push(value);},error(value){evidence.logs.push(value);}},
    require(id){
      if(id==='node:crypto')return crypto;
      if(id==='node:fs/promises')return {readFile:async(relative,...args)=>{evidence.migrationReads++;return fs.readFile(new URL('../../'+relative,import.meta.url),...args);}};
      if(id==='@neondatabase/serverless')return {neon:()=>sql};
      if(id==='@next/env')return {loadEnvConfig(){}};
      if(id==='./lib/memory-migration-compatibility.mjs')return {assertLegacyBootstrapTarget};
      throw new Error('Unexpected import '+id);
    }};
  vm.runInNewContext(compiled,sandbox);await sandbox.__completion;evidence.exitCode=sandbox.process.exitCode;return evidence;
}

test('every newer019/020/021 marker stops the real runner before reading or applying any migration', async()=>{
  for(const marker of Object.keys(older)){
    const result=await runFixture({...older,[marker]:true});
    assert.equal(result.queries,1);assert.equal(result.transactions,0);assert.equal(result.statements,0);assert.equal(result.migrationReads,0);
    assert.equal(result.exitCode,1);assert.match(result.logs.join('\n'),/MEMORY_MIGRATION_SCOPED_OWNER_REQUIRED/);
    assert.match(result.logs.join('\n'),/run-canonical-schema\.mjs/);
  }
});

test('unknown schema probe fails closed before any write',async()=>{
  const result=await runFixture({});assert.equal(result.transactions,0);assert.equal(result.migrationReads,0);
  assert.match(result.logs.join('\n'),/MEMORY_MIGRATION_TARGET_UNVERIFIED/);
});

test('a genuinely older target retains the original reviewed18 migration bootstrap using a fake driver',async()=>{
  const result=await runFixture(older);
  assert.equal(result.transactions,18);assert.equal(result.migrationReads,18);assert(result.statements>18);
  assert.equal(result.exitCode,0);assert.match(result.logs.join('\n'),/schema ready: true/);
});
