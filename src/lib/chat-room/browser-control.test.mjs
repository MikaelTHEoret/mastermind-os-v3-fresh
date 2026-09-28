import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserControl} from './browser-control.mjs';
function fixture(){
 const handlers=new Set(),ref={taskId:'task',session:'room'},turn='turn';
 const target={location:{origin:'https://mastermind-core.com'},addEventListener:(_n,f)=>handlers.add(f),removeEventListener:(_n,f)=>handlers.delete(f),postMessage(message,origin){this.sent={message,origin};}};
 const reply=(value,extra={})=>{for(const handler of handlers)handler({source:target,origin:target.location.origin,data:{type:'mastermind-browser-response',id:target.sent.message.id,value},...extra});};
 const value={ok:true,version:1,ref,turnId:turn,state:'observing',checkedAt:'2026-09-27T12:00:00Z'};
 return {target,ref,turn,reply,value,handlers};
}
test('no code or extension identifier is required to send a bounded room control',async()=>{const f=fixture();const p=browserControl(f.target,f.ref,f.turn,'reconnect');assert.equal(f.target.sent.message.action,'reconnect');assert.equal(f.target.sent.message.ref,f.ref);f.reply(f.value);assert.equal((await p).state,'observing');assert.equal(f.handlers.size,0);});
test('foreign source/origin and unrelated responses are ignored',async()=>{const f=fixture();const p=browserControl(f.target,f.ref,f.turn,'status');f.reply(f.value,{source:{}});f.reply(f.value,{origin:'https://evil.example'});assert.equal(f.handlers.size,1);f.reply(f.value);await p;});
test('another turn response fails rather than appearing in selected room',async()=>{const f=fixture();const p=browserControl(f.target,f.ref,f.turn,'status');f.reply({...f.value,turnId:'other'});await assert.rejects(p,/different or invalid/);});
test('unsupported provider send is refused locally',async()=>{const f=fixture();await assert.rejects(browserControl(f.target,f.ref,f.turn,'send'));assert.equal(f.target.sent,undefined);});
test('timeout removes listener and has no retry',async()=>{const f=fixture();const p=browserControl(f.target,f.ref,f.turn,'check',{timeout:5});await assert.rejects(p,/No browser response/);assert.equal(f.handlers.size,0);});
test('explicit grant is required; discovery is not permission',async()=>{const f=fixture();const p=browserControl(f.target,f.ref,f.turn,'status');f.reply({ok:false,code:'room-control-not-enabled'});await assert.rejects(p,/once in the updated extension/);});
