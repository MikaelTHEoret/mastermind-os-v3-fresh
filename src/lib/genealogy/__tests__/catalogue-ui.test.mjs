import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {types as postgresTypes} from '@neondatabase/serverless';
const source=fs.readFileSync(new URL('../../../components/GenealogyConsole.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function fixture(responses){
 const state=[],effects=[];let index=0,calls=0;
 const hooks={...React,useState(initial){const i=index++;if(!(i in state))state[i]=initial;return[state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];},useMemo(fn){return fn();},useCallback(fn){return fn;},useEffect(fn){effects.push(fn);}};
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,console,URLSearchParams,fetch:async()=>{const r=responses[calls++];if(r instanceof Error)throw r;return r;},require(id){if(id==='react')return hooks;if(id==='react/jsx-runtime')return jsx;throw Error(id);}});
 return{api:module.exports,state,effects,calls:()=>calls,render(){index=0;return renderToStaticMarkup(module.exports.default());}};
}
const catalogue={ok:true,frontiers:[{id:'durocher-briend-proof',branch:'fixture',person:'Fixture',objective:'Source review',place:'Fixture',priority:'high',rationale:'Fixture',variants:['Fixture'],yearFrom:1800,yearTo:1801}],jobs:[],pages:[],summary:{pages:0,enhanced:0,scan_runs:0,indexed_pages:0,observations:0,needs_review:0}};
const acquisition={ok:true,clients:[],assets:[],summary:{assets:0,bytes:'0'}};
test('real catalogue poll renders owner/upstream denials without trusting an error object',async()=>{
 for(const status of [401,403,503]){
  const f=fixture([Response.json({ok:false,error:{message:'private details'}},{status}),Response.json({ok:false},{status})]);
  f.render();f.effects[0]();await new Promise(r=>setImmediate(r));const html=f.render();
  assert.match(html,/catalogue could not be verified/);assert.match(html,new RegExp(`HTTP ${status}`));assert.doesNotMatch(html,/private details/);assert.equal(f.state[0].frontiers.length,0);assert.equal(f.state[1],null);assert.equal(f.calls(),2);
 }
});
test('invalid success shapes cannot populate catalogue or extension approval controls',()=>{
 const {api}=fixture([]);
 for(const value of [null,[],{}, {ok:true,frontiers:{},jobs:[]},{...catalogue,frontiers:[{}]},{...catalogue,jobs:[{}]},{...catalogue,pages:[{}]},{...catalogue,summary:{pages:0}},{...catalogue,ok:false}])assert.equal(api.normalizeGenealogyCatalogue(value,true,200).ok,false);
 for(const value of [null,{}, {...acquisition,clients:{}},{...acquisition,clients:[{}]},{...acquisition,summary:{assets:0,bytes:{}}}])assert.equal(api.normalizeGenealogyAcquisition(value,true),null);
});
test('verified catalogue and client inventory survive the actual poll/render path',async()=>{
 const f=fixture([Response.json(catalogue),Response.json(acquisition)]);f.render();f.effects[0]();await new Promise(r=>setImmediate(r));const html=f.render();assert.equal(f.state[0].ok,true);assert.equal(f.state[1].ok,true);assert.match(html,/Source review/);assert.doesNotMatch(html,/could not be verified/);
});
test('invalid JSON and network failures clear stale catalogue and approvals',async()=>{
 for(const failure of [new Error('private network detail'),new Response('<html>proxy failure</html>')]){
  const f=fixture([failure,Response.json(acquisition)]);f.state[0]=catalogue;f.state[1]=acquisition;f.render();f.effects[0]();await new Promise(r=>setImmediate(r));const html=f.render();assert.equal(f.state[0].ok,false);assert.match(html,/catalogue could not be verified/);assert.doesNotMatch(html,/private network detail|proxy failure/);
  if(failure instanceof Error)assert.equal(f.state[1],null);
 }
});

test('real Neon BIGSERIAL parser output remains exact for safe IDs and cannot round unsafe coordinates',()=>{
 const {api}=fixture([]),id=postgresTypes.getTypeParser(20)('7');assert.equal(typeof id,'string');
 const job={id,objective:'Fixture',status:'proposed',pages_discovered:0,pages_downloaded:0,pages_scanned:0};
 const page={id,page_number:1,source_url:'https://example.invalid/source',status:'discovered',sha256:null,variant_count:0,scan_count:0,observation_count:0};
 const value={...catalogue,jobs:[job],pages:[page]};const result=api.normalizeGenealogyCatalogue(value,true,200);assert.equal(result.ok,true);assert.equal(result.jobs[0].id,7);assert.equal(result.pages[0].id,7);assert.equal(job.id,'7');
 assert.equal(api.normalizeGenealogyCatalogue({...value,pages:[{...page,index_terms:{}}]},true,200).ok,false);
 for(const id of ['9007199254740993',9007199254740992,'7.0','7e0','07',0,-1,' 7'])assert.equal(api.normalizeGenealogyCatalogue({...value,jobs:[{...job,id}]},true,200).ok,false);
});
