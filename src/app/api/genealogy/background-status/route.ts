import { closeSync, mkdirSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';

import { getMemoryDb } from '@/lib/db';
import { requireOwner, ownerGateConfigured } from '@/lib/trading/auth';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const LOCAL_HOSTS=new Set(['127.0.0.1','localhost']);
const STRUCTURED_VERSION='segmented-formula-surname-records-v9';
type WorkerKind='name_calibration'|'structured_extraction';

async function gate():Promise<NextResponse|null>{if(!ownerGateConfigured())return null;const result=await requireOwner();return result.ok?null:NextResponse.json({ok:false,error:result.reason},{status:result.status});}
function jobIdFrom(request:NextRequest){const value=Number(request.nextUrl.searchParams.get('jobId')??2);return Number.isSafeInteger(value)&&value>0?value:2;}

function launchWorker(kind:WorkerKind,jobId:number){
  const script=kind==='name_calibration'?'scripts/run-genealogy-name-calibration.mjs':'scripts/run-genealogy-record-extraction.mjs',args=[script,'--job',String(jobId),'--from','1','--to','406'];if(kind==='name_calibration')args.push('--concurrency','1');
  const logRoot=path.join(process.env.LOCALAPPDATA??process.cwd(),'Mastermind','logs');mkdirSync(logRoot,{recursive:true});const stamp=new Date().toISOString().replace(/[:.]/g,'-'),base=`genealogy-${kind}-${stamp}`;
  const stdout=openSync(path.join(logRoot,`${base}.out.log`),'a'),stderr=openSync(path.join(logRoot,`${base}.err.log`),'a');
  try{const child=spawn(process.execPath,args,{cwd:process.cwd(),detached:true,windowsHide:true,stdio:['ignore',stdout,stderr]});child.unref();return child.pid??null;}finally{closeSync(stdout);closeSync(stderr);}
}

async function snapshot(jobId:number){
  const sql=getMemoryDb();const [counts,workerRows]=await Promise.all([
    sql`SELECT
      (SELECT count(*)::int FROM genealogy_pages WHERE job_id=${jobId}) total_pages,
      (SELECT count(DISTINCT page_id)::int FROM genealogy_name_calibration_runs run JOIN genealogy_pages page ON page.id=run.page_id WHERE page.job_id=${jobId}) calibrated_pages,
      (SELECT count(*)::int FROM genealogy_name_readings reading JOIN genealogy_pages page ON page.id=reading.page_id WHERE page.job_id=${jobId}) raw_readings,
      (SELECT count(DISTINCT run.page_id)::int FROM genealogy_record_extraction_runs run JOIN genealogy_pages page ON page.id=run.page_id WHERE page.job_id=${jobId} AND run.prompt_version=${STRUCTURED_VERSION}) structured_pages,
      (SELECT count(*)::int FROM genealogy_records record JOIN genealogy_record_extraction_runs run ON run.id=record.extraction_run_id JOIN genealogy_pages page ON page.id=record.page_id WHERE page.job_id=${jobId} AND run.prompt_version=${STRUCTURED_VERSION}) structured_records,
      (SELECT count(*)::int FROM genealogy_record_people person JOIN genealogy_records record ON record.id=person.record_id JOIN genealogy_record_extraction_runs run ON run.id=record.extraction_run_id JOIN genealogy_pages page ON page.id=record.page_id WHERE page.job_id=${jobId} AND run.prompt_version=${STRUCTURED_VERSION}) structured_people,
      (SELECT count(*)::int FROM genealogy_record_people person JOIN genealogy_records record ON record.id=person.record_id JOIN genealogy_pages page ON page.id=record.page_id WHERE page.job_id=${jobId} AND person.role<>'officiant' AND (person.surname_visual_confidence IS NOT NULL OR person.surname_contextual_confidence IS NOT NULL) AND COALESCE(person.reconstructed_surname,person.surname,person.surname_raw) IS NOT NULL) catalogued_surnames`,
    sql`SELECT * FROM genealogy_background_workers WHERE job_id=${jobId} ORDER BY worker_kind`,
  ]);
  const count=counts[0]??{},total=Number(count.total_pages)||0,byKind=Object.fromEntries(workerRows.map((row)=>[row.worker_kind,row]));
  const make=(kind:WorkerKind,completed:number)=>{const row=byKind[kind]??{},heartbeat=row.heartbeat_at?new Date(row.heartbeat_at).getTime():0,stalled=row.status==='running'&&Date.now()-heartbeat>12*60*1000;return{kind,status:stalled?'stalled':row.status??'idle',currentPage:row.current_page==null?null:Number(row.current_page),completedPages:completed,totalPages:total,percent:total?Math.round(completed/total*1000)/10:0,lastMessage:row.last_message??null,lastError:row.last_error??null,blockedReason:row.blocked_reason??null,heartbeatAt:row.heartbeat_at??null,startedAt:row.started_at??null,finishedAt:row.finished_at??null,processId:row.process_id==null?null:Number(row.process_id)};};
  return{counts:{totalPages:total,calibratedPages:Number(count.calibrated_pages)||0,rawReadings:Number(count.raw_readings)||0,structuredPages:Number(count.structured_pages)||0,structuredRecords:Number(count.structured_records)||0,structuredPeople:Number(count.structured_people)||0,cataloguedSurnames:Number(count.catalogued_surnames)||0},workers:[make('name_calibration',Number(count.calibrated_pages)||0),make('structured_extraction',Number(count.structured_pages)||0)]};
}

export async function GET(request:NextRequest){const denied=await gate();if(denied)return denied;try{const jobId=jobIdFrom(request);return NextResponse.json({ok:true,jobId,...await snapshot(jobId)},{headers:{'Cache-Control':'no-store'}});}catch(error:unknown){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}}

export async function POST(request:NextRequest){
  if(process.env.VERCEL||!LOCAL_HOSTS.has(request.nextUrl.hostname))return NextResponse.json({ok:false,error:'Background workers can only be controlled by the local Mastermind app.'},{status:403});
  const denied=await gate();if(denied)return denied;
  try{
    const body=await request.json(),jobId=Number(body.jobId??2),requested=String(body.worker??'all'),kinds:WorkerKind[]=requested==='all'?['name_calibration','structured_extraction']:requested==='name_calibration'||requested==='structured_extraction'?[requested]:[];
    if(!Number.isSafeInteger(jobId)||jobId<1||!kinds.length)return NextResponse.json({ok:false,error:'A valid worker selection is required.'},{status:400});
    const sql=getMemoryDb(),started:Array<{kind:WorkerKind;processId:number|null}>=[];
    for(const kind of kinds){const rows=await sql`SELECT status,heartbeat_at FROM genealogy_background_workers WHERE job_id=${jobId} AND worker_kind=${kind} LIMIT 1`,current=rows[0],fresh=current?.status==='running'&&Date.now()-new Date(current.heartbeat_at).getTime()<12*60*1000;if(fresh)continue;const processId=launchWorker(kind,jobId);await sql`INSERT INTO genealogy_background_workers(job_id,worker_kind,status,process_id,total_pages,last_message,last_error,blocked_reason,started_at,heartbeat_at,finished_at) VALUES(${jobId},${kind},'starting',${processId},406,'Worker launched from Genealogy interface',NULL,NULL,now(),now(),NULL) ON CONFLICT(job_id,worker_kind) DO UPDATE SET status='starting',process_id=EXCLUDED.process_id,last_message=EXCLUDED.last_message,last_error=NULL,blocked_reason=NULL,started_at=now(),heartbeat_at=now(),finished_at=NULL`;started.push({kind,processId});}
    return NextResponse.json({ok:true,started,...await snapshot(jobId)});
  }catch(error:unknown){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}
}
