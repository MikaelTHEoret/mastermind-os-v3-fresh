import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function compile(file, imports, additions = {}) {
  const source = fs.readFileSync(new URL(file, import.meta.url),'utf8');
  const compiled = ts.transpileModule(source, {fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports:{}};
  vm.runInNewContext(compiled,{
    module,exports:module.exports,URL,URLSearchParams,Set,process:{env:{}},
    require(name){if(Object.hasOwn(imports,name)) return imports[name];throw new Error(`Unexpected import: ${name}`);},
    ...additions,
  });
  return module.exports;
}

const next = {NextResponse:{json:(value,options = {})=>({value,status:options.status || 200})}};
function boundary({environment = {},ownerConfigured = false,ownerAllowed = false} = {}) {
  return compile('../_boundary.ts',{
    'server-only':{},'next/server':next,
    '@/lib/trading/auth':{ownerGateConfigured:()=>ownerConfigured,requireOwner:async()=>ownerAllowed?{ok:true}:{ok:false,status:401}},
  },{process:{env:environment}}).chatAccessError;
}

function request({method='GET',host='127.0.0.1:3000',url=`http://${host}/api/chat/session?session=example`,origin,fetchSite,body} = {}) {
  const headers = new Headers({host});
  if(origin !== undefined) headers.set('origin',origin);
  if(fetchSite !== undefined) headers.set('sec-fetch-site',fetchSite);
  if(body) headers.set('content-type','application/json');
  const req = new Request(url,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
  Object.defineProperty(req,'nextUrl',{value:new URL(url)});
  return req;
}

test('chat access permits local restoration without enabling service controls',async()=>{
  assert.equal(await boundary()(request()),null);
  assert.equal(await boundary()(request({url:'http://localhost:3000/api/chat/session?session=example'})),null);
  assert.equal(await boundary()(request({method:'POST',origin:'http://127.0.0.1:3000',fetchSite:'same-origin'})),null);
});

test('chat access denies deployed, remote, cross-origin, and untrusted write requests',async()=>{
  assert.equal((await boundary({environment:{VERCEL:'1'}})(request())).status,403);
  for(const options of [
    {host:'public.example:3000'}, {host:'127.0.0.1:3001'}, {host:'127.0.0.1:3000@evil.example',url:'http://127.0.0.1:3000/api/chat/session'},
    {origin:'https://evil.example',fetchSite:'cross-site'}, {fetchSite:'same-site'},
    {method:'POST'}, {method:'POST',origin:'http://127.0.0.1:3000'},
    {method:'POST',origin:'http://localhost:3000',fetchSite:'same-origin'},
  ]) assert.equal((await boundary()(request(options))).status,403,JSON.stringify(options));
});

test('chat access retains the configured owner gate',async()=>{
  assert.equal((await boundary({ownerConfigured:true})(request())).status,401);
  assert.equal(await boundary({ownerConfigured:true,ownerAllowed:true})(request()),null);
});

for(const [file,method,path] of [
  ['../route.ts','GET','/models'], ['../route.ts','POST','/chat'],
  ['../session/route.ts','GET','/chat/session'], ['../close/route.ts','POST','/chat/close'],
  ['../sessions/route.ts','GET','/chat/sessions'],
  ['../resume/route.ts','POST','/chat/resume'], ['../recent/route.ts','GET',null],
]) {
  test(`${method} ${file} checks access before reading or forwarding private data`,async()=>{
    let accessed = false;
    const fakeDb = ()=>{accessed=true;throw new Error('Private data must remain inaccessible');};
    const route = compile(file,{
      'next/server':next,
      './_boundary':{chatAccessError:async()=>({status:403})},
      '../_boundary':{chatAccessError:async()=>({status:403})},
      '@/lib/db':{getPrimaryDb:fakeDb},
    },{fetch:fakeDb});
    assert.equal((await route[method](request({method,body:method==='POST'?{session:'example'}:undefined}))).status,403);
    assert.equal(accessed,false);
  });

  if(path) test(`${method} ${file} preserves the upstream error status`,async()=>{
    const calls = [];
    const route = compile(file,{
      'next/server':next,
      './_boundary':{chatAccessError:async()=>null},
      '../_boundary':{chatAccessError:async()=>null},
    },{fetch:async(url,options)=>{calls.push({url,options});return {status:409,json:async()=>({ok:false,error:'turn conflict'})};}});
    const result = await route[method](request({method,body:method==='POST'?{session:'example',turnId:'same-turn'}:undefined}));
    assert.equal(result.status,409);
    assert.equal(result.value.error,'turn conflict');
    assert.equal(new URL(calls[0].url).pathname,path);
    if(method==='POST') assert.equal(JSON.parse(calls[0].options.body).turnId,'same-turn');
  });
}
