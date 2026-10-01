import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

function load(){
 const states=[];let index=0;
 const hooks={...React,useState(initial){const at=index++;if(at>=states.length)states[at]=initial;return [states[at],value=>states[at]=value];}};
 const source=fs.readFileSync(new URL('../../components/DirectModelTurn.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,Date,require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return jsx;if(name.endsWith('.module.css'))return {default:{}};throw Error(name);}});
 return {render(props){index=0;return module.exports.default(props);},states};
}
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
