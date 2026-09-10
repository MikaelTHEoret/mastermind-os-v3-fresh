// Pure admission/shape policy. Approved credential verification remains server-side.
export const CAPTURE_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
export const CAPTURE_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ROUTES = new Set(['/api/genealogy/acquisition','/api/genealogy/index','/api/genealogy/extract']);
const HEADERS = new Set(['content-type','x-mastermind-capture-client','x-mastermind-capture-secret']);
export function captureOrigin(request){const origin=request.headers.get('origin')??'';return CAPTURE_ORIGIN.test(origin)?origin:null;}
export function captureCredentials(request){
  const clientId=request.headers.get('x-mastermind-capture-client')??'',secret=request.headers.get('x-mastermind-capture-secret')??'';
  return CAPTURE_UUID.test(clientId) && secret.length>=32 && secret.length<=256 && !/[\s\x00-\x1f\x7f]/u.test(secret)?{clientId,secret}:null;
}
export function captureLocal(request,env){
  try{const url=new URL(request.url),host=new URL(`http://${request.headers.get('host')??''}`);
    return !env.VERCEL && url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname)
      && host.hostname===url.hostname && host.port===url.port && !host.username && !host.password
      && host.pathname==='/' && !host.search && !host.hash && !url.username && !url.password;
  }catch{return false;}
}
export function captureRequestAllowed(request){
  const url=new URL(request.url);if(!ROUTES.has(url.pathname) || !captureOrigin(request))return false;
  const acquisition=url.pathname==='/api/genealogy/acquisition',method=request.method.toUpperCase();
  if(method==='OPTIONS'){
    const requested=request.headers.get('access-control-request-method'),raw=request.headers.get('access-control-request-headers')??'';
    const headers=raw.split(',').map(name=>name.trim().toLowerCase()).filter(Boolean);
    if(!(requested==='POST'||acquisition && requested==='GET') || headers.length===0 || headers.length>3
      || new Set(headers).size!==headers.length || !headers.every(name=>HEADERS.has(name)))return false;
    return acquisition && requested==='POST' || ['x-mastermind-capture-client','x-mastermind-capture-secret'].every(name=>headers.includes(name));
  }
  if(method==='GET'){
    const ids=url.searchParams.getAll('clientId'),credentials=captureCredentials(request);
    return acquisition && ids.length===1 && [...url.searchParams.keys()].every(key=>key==='clientId')
      && credentials!==null && ids[0]===credentials.clientId;
  }
  if(method!=='POST' || url.search)return false;
  const type=(request.headers.get('content-type')??'').split(';',1)[0].trim().toLowerCase();
  if(acquisition && type==='application/json')return true; // Handler permits pending registration or checks approved credentials/admin.
  return type==='multipart/form-data' && captureCredentials(request)!==null;
}
export function withCaptureCors(response,request){
  const origin=captureOrigin(request);if(origin)response.headers.set('Access-Control-Allow-Origin',origin);
  response.headers.set('Access-Control-Allow-Headers','Content-Type, X-Mastermind-Capture-Client, X-Mastermind-Capture-Secret');
  response.headers.set('Access-Control-Allow-Methods',new URL(request.url).pathname.endsWith('/acquisition')?'GET, POST, OPTIONS':'POST, OPTIONS');
  response.headers.append('Vary','Origin');response.headers.set('Cache-Control','no-store');return response;
}

export function sameOriginLocalRequest(request){
  const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  return (origin===null || origin===new URL(request.url).origin) && (site===null || site==='same-origin' || site==='none');
}
