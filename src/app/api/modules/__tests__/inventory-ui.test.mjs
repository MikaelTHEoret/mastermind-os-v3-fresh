import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const fixtureModule = {id:'fixture', name:'Fixture module', kind:'tool', status:'ready', description:'Fixture only',
  gate:'approved', enabled:true, capabilities:['fixture.read'], dependencies:[]};
function load(response) {
  const state=[], effects=[];let index=0, calls=0;
  const hooks={...React, useState(initial){const i=index++;if(!(i in state))state[i]=initial;return[state[i],value=>{state[i]=value;}];},
    useRef(value){return{current:value};},useCallback(value){return value;},useEffect(effect){effects.push(effect);}};
  const module={exports:{}};
  const source=fs.readFileSync(new URL('../../../../components/ModuleLoader.tsx',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(compiled,{module,exports:module.exports,console,setInterval(){return 1;},clearInterval(){},
    fetch:async()=>{calls++; if(response instanceof Error)throw response;return response;},
    require(id){if(id==='react')return hooks;if(id==='react/jsx-runtime')return jsx;if(id==='./NativeDevelopment')return {default:()=>null,__esModule:true};throw Error(id);}});
  return{module:module.exports,state,effects,calls:()=>calls,render(){index=0;return renderToStaticMarkup(module.exports.default());}};
}

test('the real inventory poll keeps the shell renderable after owner and upstream denials', async()=>{
  for(const status of [401,403,503]) {
    const f=load(Response.json({ok:false,error:{code:'OWNER_GATE_NOT_CONFIGURED',message:'not an inventory'}},{status}));
    f.render();f.effects[0]();await new Promise(resolve=>setImmediate(resolve));
    const html=f.render();assert.match(html,/could not be verified/);assert.match(html,new RegExp(`HTTP ${status}`));
    assert.equal(f.calls(),1);assert.equal(f.state[0].ok,false);assert.equal(f.state[0].modules.length,0);
    assert.doesNotMatch(html,/not an inventory/);
  }
});

test('malformed success inventories cannot supply live controls or break array rendering',()=>{
  const f=load(null), normalize=f.module.normalizeModuleInventory;
  for(const value of [null,[],{}, {ok:true}, {ok:true,modules:{}}, {ok:true,modules:[{}]},
    {ok:true,modules:[{...fixtureModule,capabilities:null}]}, {ok:true,modules:[fixtureModule],nodes:{}},
    {ok:true,modules:[fixtureModule],nodes:[{}]}, {ok:false,modules:[fixtureModule]}]) {
    const result=normalize(value,true,200);assert.equal(result.ok,false);assert.equal(result.modules.length,0);
  }
});

test('verified inventories preserve module and blueprint fields without trusting error-shaped HTTP results',()=>{
  const f=load(null), normalize=f.module.normalizeModuleInventory;
  const payload={ok:true,modules:[fixtureModule],nodes:[{id:'blueprint',faculty:'core',in_registry:false}]};
  const result=normalize(payload,true,200);assert.equal(result.ok,true);assert.equal(result.modules[0],fixtureModule);assert.equal(result.nodes[0].id,'blueprint');
  assert.equal(normalize(payload,false,503).ok,false);
});

test('network and invalid-JSON poll failures retain a visible bounded unavailable state',async()=>{
  for(const response of [new Error('private connection detail'),new Response('<html>upstream error</html>')]) {
    const f=load(response);f.render();f.effects[0]();await new Promise(resolve=>setImmediate(resolve));
    const html=f.render();assert.match(html,/could not be verified/);assert.doesNotMatch(html,/private connection detail|upstream error/);
    assert.equal(f.state[0].modules.length,0);
  }
});
