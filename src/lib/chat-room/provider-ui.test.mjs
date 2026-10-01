import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

function load(component='DirectModelTurn'){
 const states=[];let index=0;
 const hooks={...React,useState(initial){const at=index++;if(at>=states.length)states[at]=initial;return [states[at],value=>states[at]=value];}};
 const source=fs.readFileSync(new URL('../../components/'+component+'.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,Date,require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return jsx;if(name.endsWith('.module.css'))return {default:{}};throw Error(name);}});
 return {render(props){index=0;return module.exports.default(props);},states};
}

test('room renewal requires a separate review and Gemini tier confirmation; only renewal action is sent',()=>{
 const ui=load('RoomConnectionRenewal'),calls=[];
 const props={connection:{expiresAt:null,checkedAt:'2026-10-01T00:00:00Z',renewal:{scopeDigest:'scope',providers:['gemini'],geminiFreeTierRequired:true,catalogReviewUntil:'2026-10-31T00:00:00Z'}},locked:false,
  act:async(...args)=>calls.push(args),refresh:async()=>{}};
 const tree=()=>flatten(ui.render(props));const renew=()=>tree().find(e=>e.type==='button'&&e.props.children==='Renew this room for 24 hours');
 assert.equal(renew().props.disabled,true);
 tree().filter(e=>e.type==='input')[0].props.onChange({target:{checked:true}});assert.equal(renew().props.disabled,true);
 tree().filter(e=>e.type==='input')[1].props.onChange({target:{checked:true}});assert.equal(renew().props.disabled,false);
 renew().props.onClick();assert.equal(calls.length,1);assert.equal(calls[0][0],'renew-connection');
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])),{scopeDigest:'scope',reviewConfirmed:true,geminiFreeTierConfirmed:true});
 props.locked=true;assert.equal(renew().props.disabled,true);
 assert.match(renderToStaticMarkup(ui.render(props)),/Provider quota and availability are only known/);
});
test('connection status exposes no renewal when unavailable, and refresh never sends to a provider',()=>{
 const ui=load('RoomConnectionRenewal');let refreshes=0;
 const tree=ui.render({connection:{renewal:null},locked:false,act:async()=>assert.fail('mutation'),refresh:async()=>refreshes++});
 const buttons=flatten(tree).filter(e=>e.type==='button');assert.equal(buttons.length,1);buttons[0].props.onClick();assert.equal(refreshes,1);
 assert.match(renderToStaticMarkup(tree),/Renewing cannot resolve a provider rate limit/);
});
test('rate limit and timeout messages explain uncertain outcomes without a retry control',()=>{
 for(const [code,phrase] of [['RATE_LIMITED',/rate or quota limit/],['PROVIDER_TIMEOUT',/may still have processed/],['PROVIDER_REJECTED',/Check model access/]]){
  const ui=load(),tree=ui.render({...prepared,turn:{status:'unknown',provider:{state:'unknown',code}}});
  assert.match(renderToStaticMarkup(tree),phrase);assert.equal(flatten(tree).filter(e=>e.type==='button').length,1);
 }
});
function flatten(element,out=[]){
 if(element==null||typeof element!=='object')return out;
 if(Array.isArray(element)){element.forEach(x=>flatten(x,out));return out;}
 out.push(element);flatten(element.props?.children,out);return out;
}
const prepared={turn:{status:'prepared'},quote:{maxOutputTokens:1024,paid:false,estimatedUsdMicros:0},
 model:{label:'Free fixture',privacy:'Provider data notice'},locked:false,paused:false,act:async()=>{},refresh:async()=>{}};
const ask=tree=>flatten(tree).find(e=>e.type==='button'&&e.props.children==='Ask this model once');
test('free direct-send requires prompt sharing; no paid approval is silently set',()=>{
 const ui=load(),calls=[],props={...prepared,act:async(...args)=>calls.push(args)};
 assert.equal(ask(ui.render(props)).props.disabled,true);
 flatten(ui.render(props)).find(e=>e.type==='input').props.onChange({target:{checked:true}});
 const button=ask(ui.render(props));assert.equal(button.props.disabled,false);button.props.onClick();
 assert.equal(calls.length,1);assert.equal(calls[0][0],'provider-send');assert.equal(calls[0][1].approval.paidApproved,false);
 assert.match(renderToStaticMarkup(ui.render(props)),/Provider data notice/);
});
test('paid reply has a separate opt-in and truthful estimate; paused and locked rooms cannot send',()=>{
 const ui=load(),props={...prepared,quote:{...prepared.quote,paid:true,estimatedUsdMicros:8000}};
 ui.states.push(true,false,false);assert.equal(ask(ui.render(props)).props.disabled,true);
 flatten(ui.render(props)).filter(e=>e.type==='input')[1].props.onChange({target:{checked:true}});
 assert.equal(ask(ui.render(props)).props.disabled,false);
 for(const held of [{paused:true},{locked:true},{turn:{status:'prepared',steeringPending:true}}])assert.equal(ask(ui.render({...props,...held})).props.disabled,true);
 assert.match(renderToStaticMarkup(ui.render(props)),/estimate, not a provider billing cap/);
});
test('unavailable connection exposes no send button; only prepared turn can be discarded',()=>{
 const ui=load();const tree=ui.render({...prepared,quote:null,model:{reason:'Needs credential'}});
 assert.equal(ask(tree),undefined);assert.match(renderToStaticMarkup(tree),/Needs credential/);
});
test('unknown receipt offers a read-only check; provider text renders safely and binds reviewed hash',()=>{
 const ui=load(),calls=[];let reads=0;
 const unknown=ui.render({...prepared,turn:{status:'unknown',provider:{state:'unknown',code:'PROVIDER_TIMEOUT'}},refresh:async()=>reads++});
 const buttons=flatten(unknown).filter(e=>e.type==='button');assert.equal(buttons.length,1);buttons[0].props.onClick();assert.equal(reads,1);
 const props={...prepared,turn:{status:'awaiting-reply',provider:{state:'draft',text:'<script>bad()</script>',textSha256:'a'.repeat(64),complete:false}},act:async(...args)=>calls.push(args)};
 let tree=ui.render(props);assert.equal(flatten(tree).find(e=>e.type==='button').props.disabled,true);
 assert.match(renderToStaticMarkup(tree),/&lt;script&gt;/);assert.match(renderToStaticMarkup(tree),/partial and pauses/);
 flatten(tree).find(e=>e.type==='input').props.onChange({target:{checked:true}});tree=ui.render(props);
 flatten(tree).find(e=>e.type==='button').props.onClick();assert.equal(calls[0][0],'provider-review');assert.equal(calls[0][1].responseSha256,'a'.repeat(64));assert.equal(calls[0][1].reviewed,true);
});
