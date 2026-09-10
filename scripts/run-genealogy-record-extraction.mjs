import nextEnv from '@next/env';
import { neon } from '@neondatabase/serverless';

const {loadEnvConfig}=nextEnv;
loadEnvConfig(process.cwd());

function option(name,fallback){const index=process.argv.indexOf(`--${name}`);return index>=0?process.argv[index+1]:fallback;}
const jobId=Number(option('job','2')),from=Number(option('from','1')),to=Number(option('to','406')),base=String(option('base','http://127.0.0.1:3000')).replace(/\/$/,'');
if(!process.env.NEON_MEMORY_URL)throw new Error('NEON_MEMORY_URL is required');
if(![jobId,from,to].every(Number.isFinite))throw new Error('Invalid extraction options');

const sql=neon(process.env.NEON_MEMORY_URL),pages=await sql.query('SELECT id,page_number FROM genealogy_pages WHERE job_id=$1 AND page_number BETWEEN $2 AND $3 ORDER BY page_number',[jobId,Math.min(from,to),Math.max(from,to)]);
let completed=0,cached=0,failed=0,records=0,people=0,relationships=0;

function blockedReason(error){const message=error instanceof Error?error.message:String(error);return /no credits remaining|billing/i.test(message)?'openai_credits':null;}
async function workerState(status,{page=null,message=null,error=null,reason=null,finished=false}={}){
  await sql.query(`INSERT INTO genealogy_background_workers(job_id,worker_kind,status,process_id,current_page,total_pages,completed_pages,cached_pages,records_found,people_found,relationships_found,last_message,last_error,blocked_reason,started_at,heartbeat_at,finished_at,metadata)
    VALUES($1,'structured_extraction',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now(),CASE WHEN $14 THEN now() ELSE NULL END,$15::jsonb)
    ON CONFLICT(job_id,worker_kind) DO UPDATE SET status=EXCLUDED.status,process_id=EXCLUDED.process_id,current_page=EXCLUDED.current_page,total_pages=EXCLUDED.total_pages,completed_pages=EXCLUDED.completed_pages,cached_pages=EXCLUDED.cached_pages,records_found=EXCLUDED.records_found,people_found=EXCLUDED.people_found,relationships_found=EXCLUDED.relationships_found,last_message=EXCLUDED.last_message,last_error=EXCLUDED.last_error,blocked_reason=EXCLUDED.blocked_reason,started_at=CASE WHEN genealogy_background_workers.status IN ('running','starting') THEN genealogy_background_workers.started_at ELSE now() END,heartbeat_at=now(),finished_at=EXCLUDED.finished_at,metadata=EXCLUDED.metadata`,[jobId,status,process.pid,page,pages.length,completed,cached,records,people,relationships,message,error,reason,finished,JSON.stringify({from,to,mode:'chronological-single-worker'})]);
}

async function extract(page){
  for(let attempt=1;attempt<=5;attempt++)try{
    const response=await fetch(`${base}/api/genealogy/extract`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageId:Number(page.id)}),signal:AbortSignal.timeout(600000)}),body=await response.json();
    if(!response.ok)throw new Error(body.error||`Extraction HTTP ${response.status}`);
    completed++;if(body.cached===true)cached++;records+=Number(body.summary?.records||0);people+=Number(body.summary?.people||0);relationships+=Number(body.summary?.relationships||0);
    console.log(JSON.stringify({type:'page',page:Number(page.page_number),records:Number(body.summary?.records||0),people:Number(body.summary?.people||0),relationships:Number(body.summary?.relationships||0),formulas:Number(body.summary?.formulaPatterns||0),visual:Number(body.summary?.visualConfidence??body.summary?.confidence??0),contextual:Number(body.summary?.contextualConfidence??body.summary?.confidence??0),status:body.summary?.status,cached:body.cached===true,completed,total:pages.length,time:new Date().toISOString()}));
    await workerState('running',{page:Number(page.page_number),message:`Page ${page.page_number}: ${Number(body.summary?.records||0)} entries · ${Number(body.summary?.people||0)} people`});
    return;
  }catch(error){
    if(attempt===5){failed++;console.error(JSON.stringify({type:'error',page:Number(page.page_number),attempt,error:error instanceof Error?error.message:String(error),time:new Date().toISOString()}));throw error;}
    await workerState('running',{page:Number(page.page_number),message:`Retry ${attempt}/5 for page ${page.page_number}`,error:error instanceof Error?error.message:String(error)});
    await new Promise((resolve)=>setTimeout(resolve,Math.min(60000,attempt*10000)));
  }
}

console.log(JSON.stringify({type:'start',jobId,from,to,pages:pages.length,mode:'chronological-single-worker',time:new Date().toISOString()}));
try{
  await workerState('running',{message:'Starting chronological structured extraction'});
  for(const page of pages)await extract(page);
  await workerState('complete',{page:Number(pages.at(-1)?.page_number??to),message:'Structured extraction complete',finished:true});
  console.log(JSON.stringify({type:'complete',jobId,completed,cached,failed,records,people,relationships,total:pages.length,time:new Date().toISOString()}));
}catch(error){
  const reason=blockedReason(error);await workerState(reason?'blocked':'stopped',{message:reason==='openai_credits'?'OpenAI credits required before this worker can resume':'Structured extraction stopped',error:error instanceof Error?error.message:String(error),reason,finished:true}).catch(()=>undefined);
  console.error(JSON.stringify({type:'halted',jobId,completed,cached,failed,records,people,relationships,total:pages.length,error:error instanceof Error?error.message:String(error),message:'The run stopped instead of skipping a page. Restarting is safe because completed extractions are cached.',time:new Date().toISOString()}));
  process.exitCode=2;
}
