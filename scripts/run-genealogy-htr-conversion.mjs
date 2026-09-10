import nextEnv from '@next/env';
import { neon } from '@neondatabase/serverless';

const {loadEnvConfig}=nextEnv;
loadEnvConfig(process.cwd());

function option(name,fallback){const index=process.argv.indexOf(`--${name}`);return index>=0?process.argv[index+1]:fallback;}
const jobId=Number(option('job','2')),base=String(option('base','http://127.0.0.1:3000')).replace(/\/$/,'');
if(!process.env.NEON_MEMORY_URL)throw new Error('NEON_MEMORY_URL is required');
if(!Number.isSafeInteger(jobId)||jobId<1)throw new Error('A valid genealogy job is required');

const sql=neon(process.env.NEON_MEMORY_URL);
const pages=await sql.query(`SELECT DISTINCT page.id,page.page_number FROM genealogy_pages page JOIN genealogy_page_assets pa ON pa.page_id=page.id AND pa.role='original' WHERE page.job_id=$1 ORDER BY page.page_number NULLS LAST,page.id`,[jobId]);
const [model]=await sql.query(`SELECT id FROM genealogy_htr_models WHERE model_key='brittany-parish-v1' AND status='ready' AND weights_path IS NOT NULL LIMIT 1`);
if(!model)throw new Error('The Brittany HTR base model is not ready');
const completedRows=await sql.query(`SELECT DISTINCT run.page_id FROM genealogy_htr_page_runs run JOIN genealogy_pages page ON page.id=run.page_id WHERE page.job_id=$1 AND ((run.model_id=$2 AND run.status IN ('needs_review','complete')) OR (run.model_id IS NULL AND run.status IN ('needs_review','complete') AND run.line_count=0))`,[jobId,model.id]);
const completePageIds=new Set(completedRows.map((row)=>String(row.page_id)));
let completed=completePageIds.size,failed=0,linesDetected=0,consecutiveFailures=0;

function alreadyComplete(pageId){return completePageIds.has(String(pageId));}

async function state(status,{page=null,stage='idle',message=null,error=null,finished=false}={}){
  await sql.query(`INSERT INTO genealogy_htr_archive_workers(job_id,status,process_id,current_page,stage,total_pages,completed_pages,failed_pages,lines_detected,stop_requested,last_message,last_error,started_at,heartbeat_at,finished_at,metadata,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10,$11,now(),now(),CASE WHEN $12 THEN now() ELSE NULL END,$13::jsonb,now())
    ON CONFLICT(job_id) DO UPDATE SET status=EXCLUDED.status,process_id=EXCLUDED.process_id,current_page=EXCLUDED.current_page,stage=EXCLUDED.stage,total_pages=EXCLUDED.total_pages,completed_pages=EXCLUDED.completed_pages,failed_pages=EXCLUDED.failed_pages,lines_detected=EXCLUDED.lines_detected,last_message=EXCLUDED.last_message,last_error=EXCLUDED.last_error,started_at=CASE WHEN genealogy_htr_archive_workers.status IN ('starting','running','pausing') THEN genealogy_htr_archive_workers.started_at ELSE now() END,heartbeat_at=now(),finished_at=EXCLUDED.finished_at,metadata=EXCLUDED.metadata,updated_at=now()`,[jobId,status,process.pid,page,stage,pages.length,completed,failed,linesDetected,message,error,finished,JSON.stringify({mode:'sequential-local-htr',modelId:String(model.id)})]);
}

async function pauseRequested(){const [row]=await sql.query(`SELECT stop_requested FROM genealogy_htr_archive_workers WHERE job_id=$1`,[jobId]);return row?.stop_requested===true;}

async function call(action,pageId,timeoutMs){const response=await fetch(`${base}/api/genealogy/htr`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,pageId,jobId}),signal:AbortSignal.timeout(timeoutMs)});const payload=await response.json();if(!response.ok)throw new Error(payload.error||`${action} returned HTTP ${response.status}`);return payload;}

async function callWithRetry(action,pageId,timeoutMs,attempts=3){
  let lastError;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{return await call(action,pageId,timeoutMs);}
    catch(error){
      lastError=error;
      if(attempt<attempts){
        await state('running',{page:Number(pages.find((item)=>Number(item.id)===Number(pageId))?.page_number??null),stage:action==='segment'?'segmenting':'recognizing',message:`${action==='segment'?'Line detection':'Handwriting reading'} retry ${attempt+1}/${attempts}`});
        await new Promise((resolve)=>setTimeout(resolve,750*attempt));
      }
    }
  }
  throw lastError;
}

console.log(JSON.stringify({type:'start',jobId,pages:pages.length,completed,time:new Date().toISOString()}));
try{
  await state('running',{stage:'selecting',message:`Archive conversion started · ${completed}/${pages.length} pages already complete`});
  for(const page of pages){
    if(alreadyComplete(page.id))continue;
    if(await pauseRequested()){
      await state('paused',{page:Number(page.page_number),stage:'paused',message:`Paused before page ${page.page_number}`,finished:true});
      console.log(JSON.stringify({type:'paused',page:Number(page.page_number),completed,total:pages.length,time:new Date().toISOString()}));
      process.exit(0);
    }
    try{
      await state('running',{page:Number(page.page_number),stage:'segmenting',message:`Page ${page.page_number} · detecting handwriting lines`});
      const segment=await callWithRetry('segment',Number(page.id),30*60*1000,2);
      linesDetected+=Number(segment.lineCount)||0;
      if(Number(segment.lineCount)>0){
        await state('running',{page:Number(page.page_number),stage:'recognizing',message:`Page ${page.page_number} · reading ${segment.lineCount} lines`});
        const recognized=await callWithRetry('recognize',Number(page.id),30*60*1000,3);
        completePageIds.add(String(page.id));completed++;consecutiveFailures=0;
        await state('running',{page:Number(page.page_number),stage:'saving',message:`Page ${page.page_number} converted · ${recognized.lineCount??0} lines · ${recognized.meanConfidence==null?'unrated':`${Math.round(Number(recognized.meanConfidence)*100)}% raw confidence`}`});
        console.log(JSON.stringify({type:'page',page:Number(page.page_number),lines:Number(recognized.lineCount)||0,confidence:recognized.meanConfidence??null,completed,total:pages.length,time:new Date().toISOString()}));
      }else{
        completePageIds.add(String(page.id));completed++;consecutiveFailures=0;
        await state('running',{page:Number(page.page_number),stage:'saving',message:`Page ${page.page_number} complete · no handwriting lines detected`});
        console.log(JSON.stringify({type:'blank',page:Number(page.page_number),completed,total:pages.length,time:new Date().toISOString()}));
      }
    }catch(error){
      failed++;consecutiveFailures++;
      const message=error instanceof Error?error.message:String(error);
      await state('running',{page:Number(page.page_number),stage:'failed',message:`Page ${page.page_number} failed after local retries · recorded for visual review and continuing`,error:message});
      console.error(JSON.stringify({type:'error',page:Number(page.page_number),error:message,consecutiveFailures,time:new Date().toISOString()}));
    }
  }
  await state('complete',{page:Number(pages.at(-1)?.page_number??null),stage:'complete',message:`Archive conversion complete · ${completed} pages · ${failed} failures`,finished:true});
  console.log(JSON.stringify({type:'complete',completed,failed,total:pages.length,time:new Date().toISOString()}));
}catch(error){
  const message=error instanceof Error?error.message:String(error);
  await state('failed',{stage:'failed',message:'Archive conversion stopped',error:message,finished:true}).catch(()=>undefined);
  console.error(JSON.stringify({type:'halted',completed,failed,total:pages.length,error:message,time:new Date().toISOString()}));
  process.exitCode=2;
}
