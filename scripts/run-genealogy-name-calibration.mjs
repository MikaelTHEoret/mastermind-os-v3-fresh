import nextEnv from '@next/env';
import { neon } from '@neondatabase/serverless';

const {loadEnvConfig}=nextEnv;
loadEnvConfig(process.cwd());

function option(name,fallback){const index=process.argv.indexOf(`--${name}`);return index>=0?process.argv[index+1]:fallback;}
const jobId=Number(option('job','2')),from=Number(option('from','1')),to=Number(option('to','406')),concurrency=Math.min(4,Math.max(1,Number(option('concurrency','2')))),base=String(option('base','http://127.0.0.1:3000')).replace(/\/$/,'');
if(!process.env.NEON_MEMORY_URL)throw new Error('NEON_MEMORY_URL is required');
if(![jobId,from,to,concurrency].every(Number.isFinite))throw new Error('Invalid calibration options');

const sql=neon(process.env.NEON_MEMORY_URL),pages=await sql.query('SELECT id,page_number FROM genealogy_pages WHERE job_id=$1 AND page_number BETWEEN $2 AND $3 ORDER BY page_number',[jobId,Math.min(from,to),Math.max(from,to)]);
let cursor=0,completed=0,failed=0,lastLexiconAt=0,lexiconPromise=null;

function blockedReason(error){const message=error instanceof Error?error.message:String(error);return /no credits remaining|billing/i.test(message)?'openai_credits':null;}
async function workerState(status,{page=null,message=null,error=null,reason=null,finished=false}={}){
  await sql.query(`INSERT INTO genealogy_background_workers(job_id,worker_kind,status,process_id,current_page,total_pages,completed_pages,cached_pages,last_message,last_error,blocked_reason,started_at,heartbeat_at,finished_at,metadata)
    VALUES($1,'name_calibration',$2,$3,$4,$5,$6,0,$7,$8,$9,now(),now(),CASE WHEN $10 THEN now() ELSE NULL END,$11::jsonb)
    ON CONFLICT(job_id,worker_kind) DO UPDATE SET status=EXCLUDED.status,process_id=EXCLUDED.process_id,current_page=EXCLUDED.current_page,total_pages=EXCLUDED.total_pages,completed_pages=EXCLUDED.completed_pages,last_message=EXCLUDED.last_message,last_error=EXCLUDED.last_error,blocked_reason=EXCLUDED.blocked_reason,started_at=CASE WHEN genealogy_background_workers.status IN ('running','starting') THEN genealogy_background_workers.started_at ELSE now() END,heartbeat_at=now(),finished_at=EXCLUDED.finished_at,metadata=EXCLUDED.metadata`,[jobId,status,process.pid,page,pages.length,completed,message,error,reason,finished,JSON.stringify({from,to,concurrency})]);
}

async function rebuildLexicon(){
  if(lexiconPromise)return lexiconPromise;
  lexiconPromise=(async()=>{const response=await fetch(`${base}/api/genealogy/name-lexicon`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId}),signal:AbortSignal.timeout(120000)});const body=await response.json();if(!response.ok)throw new Error(body.error||`Lexicon HTTP ${response.status}`);lastLexiconAt=completed;console.log(JSON.stringify({type:'lexicon',completed,entries:body.lexiconEntries,readings:body.readings,calibratedPages:body.calibratedPages,time:new Date().toISOString()}));})();
  try{return await lexiconPromise;}finally{lexiconPromise=null;}
}

async function calibrate(page){
  for(let attempt=1;attempt<=5;attempt++)try{
    const response=await fetch(`${base}/api/genealogy/name-calibrate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageId:Number(page.id)}),signal:AbortSignal.timeout(180000)}),body=await response.json();
    if(!response.ok)throw new Error(body.error||`Calibration HTTP ${response.status}`);
    completed++;console.log(JSON.stringify({type:'page',page:Number(page.page_number),readings:Array.isArray(body.readings)?body.readings.length:0,mean:Number(body.run?.mean_confidence||0),cached:body.cached===true,completed,total:pages.length,time:new Date().toISOString()}));
    await workerState('running',{page:Number(page.page_number),message:`Page ${page.page_number}: ${Array.isArray(body.readings)?body.readings.length:0} visual name readings`});
    if(completed-lastLexiconAt>=20)await rebuildLexicon();return;
  }catch(error){if(attempt===5){failed++;console.error(JSON.stringify({type:'error',page:Number(page.page_number),attempt,error:error instanceof Error?error.message:String(error),time:new Date().toISOString()}));throw error;}await workerState('running',{page:Number(page.page_number),message:`Retry ${attempt}/5 for page ${page.page_number}`,error:error instanceof Error?error.message:String(error)});await new Promise((resolve)=>setTimeout(resolve,Math.min(60000,attempt*10000)));}
}

async function worker(){while(true){const index=cursor++;if(index>=pages.length)return;await calibrate(pages[index]);}}

console.log(JSON.stringify({type:'start',jobId,from,to,concurrency,pages:pages.length,time:new Date().toISOString()}));
try{
  await workerState('running',{message:'Starting archive-wide name calibration'});
  await Promise.all(Array.from({length:concurrency},()=>worker()));
  if(completed>lastLexiconAt)await rebuildLexicon();
  await workerState('complete',{page:Number(pages.at(-1)?.page_number??to),message:'Name calibration complete',finished:true});
  console.log(JSON.stringify({type:'complete',jobId,completed,failed,total:pages.length,time:new Date().toISOString()}));
}catch(error){
  const reason=blockedReason(error);await workerState(reason?'blocked':'stopped',{message:reason==='openai_credits'?'OpenAI credits required before this worker can resume':'Name calibration stopped',error:error instanceof Error?error.message:String(error),reason,finished:true}).catch(()=>undefined);
  console.error(JSON.stringify({type:'halted',jobId,completed,failed,total:pages.length,error:error instanceof Error?error.message:String(error),message:'The run stopped instead of skipping pages. Restarting is safe because completed calibrations are cached.',time:new Date().toISOString()}));
  process.exitCode=2;
}
