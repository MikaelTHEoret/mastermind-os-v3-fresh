'use client';

import { useCallback, useEffect, useState } from 'react';

const C={cyan:'#6ff2ff',gold:'#ffe1a0',green:'#7fffc8',magenta:'#c79bff',red:'#ff7c8b',text:'#dffaff',dim:'rgba(150,215,235,0.62)',panel:'rgba(5,11,24,.9)'};
const mono="'Orbitron','Segoe UI',monospace",body="'Rajdhani','Segoe UI',sans-serif";

export type GenealogyPanelNode={id:string;name:string;coherence:number|null;review_status?:string;root:string;metadata?:Record<string,unknown>};
type SearchPerson={id:string;label:string;branch:string;proof_strength:number;review_status:string;metadata:Record<string,unknown>};
type ResearchNote={id:number;kind:string;status:string;title:string;body:string;source_url:string|null;confidence:number;tags:string[]};
type ArchiveMatch={record_id:number;event_type:string;event_date_text:string|null;event_year:number|null;location_text:string|null;confidence:number;page_id:number;page_number:number|null;source_url:string;archive:string;role:string;name_raw:string;reconstructed_name:string|null;surname_raw:string|null;reconstructed_surname:string|null};
type PreservedMedia={id:number;media_index:number;title:string|null;media_format:string|null;asset_sha256:string;media_type:string;byte_size:number;preserved_at:string};
type Suggestion={priority:'critical'|'high'|'normal';title:string;reason:string;query:string};
type Dossier={ok:boolean;node:Record<string,unknown>;notes:ResearchNote[];assertions:Array<{id:number;predicate:string;value_text:string|null;place_text:string|null;confidence:number;status:string}>;archiveMatches:ArchiveMatch[];preservedMedia:PreservedMedia[];suggestions:Suggestion[];error?:string};
type Metrics={generations:number;visible_people:number;proof_gaps:number;convergent_ancestors:number;research_scaffolds:number;notes:number;preserved_media:number;people_with_media:number;unique_media_assets:number;branches:Record<string,number>};
type ImportInfo={filename:string;summary?:Record<string,unknown>};

const button=(active=false)=>({cursor:'pointer',border:`1px solid ${active?C.cyan:`${C.cyan}44`}`,borderRadius:4,background:active?`${C.cyan}18`:'rgba(4,12,24,.5)',color:active?C.cyan:C.dim,fontFamily:mono,fontSize:8,letterSpacing:1,padding:'5px 8px'} as const);
const datePlace=(metadata:Record<string,unknown>)=>{
  const fact=(metadata.birth??metadata.baptism??{}) as {date?:string;place?:string};
  return [fact.date,fact.place].filter(Boolean).join(' · ')||'date and place unresolved';
};

export default function GenealogyResearchPanel({node,metrics,importInfo,onNavigate,onGraphChanged}:{node:GenealogyPanelNode|null;metrics?:Metrics;importInfo?:ImportInfo;onNavigate:(id:string)=>void;onGraphChanged:()=>void}){
  const [query,setQuery]=useState('');
  const [results,setResults]=useState<SearchPerson[]>([]);
  const [searching,setSearching]=useState(false);
  const [dossier,setDossier]=useState<Dossier|null>(null);
  const [loading,setLoading]=useState(false);
  const [activity,setActivity]=useState('');
  const [showNote,setShowNote]=useState(false);
  const [kind,setKind]=useState('clue'),[title,setTitle]=useState(''),[noteBody,setNoteBody]=useState(''),[sourceUrl,setSourceUrl]=useState('');

  useEffect(()=>{
    if(query.trim().length<2){setResults([]);return;}
    let cancelled=false;setSearching(true);
    const timer=window.setTimeout(async()=>{try{const response=await fetch(`/api/genealogy/graph/search?q=${encodeURIComponent(query.trim())}`,{cache:'no-store'}),result=await response.json();if(!cancelled)setResults(response.ok?result.results??[]:[]);}finally{if(!cancelled)setSearching(false);}},250);
    return()=>{cancelled=true;window.clearTimeout(timer);};
  },[query]);

  const loadDossier=useCallback(async()=>{
    if(!node||node.id==='ROOT'){setDossier(null);return;}
    setLoading(true);
    try{const response=await fetch(`/api/genealogy/research/dossier?nodeId=${encodeURIComponent(node.id)}`,{cache:'no-store'}),result=await response.json();if(!response.ok)throw new Error(result.error||'Dossier unavailable');setDossier(result);setActivity('');}
    catch(error){setActivity(error instanceof Error?error.message:String(error));}
    finally{setLoading(false);}
  },[node]);
  useEffect(()=>{loadDossier().catch(()=>undefined);},[loadDossier]);

  async function setRoot(person:SearchPerson){
    setActivity(`Re-rooting the view on ${person.label}…`);
    const response=await fetch('/api/genealogy/graph',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({rootNodeId:person.id})}),result=await response.json();
    if(!response.ok){setActivity(result.error||'Unable to change the tree root');return;}
    setQuery('');setResults([]);setActivity(`${person.label} is now the centre of the research tree.`);onGraphChanged();
  }

  async function saveNote(){
    if(!node||!title.trim())return;setActivity('Saving research note…');
    const response=await fetch('/api/genealogy/research/dossier',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nodeId:node.id,kind,title,body:noteBody,sourceUrl:sourceUrl||null,confidence:kind==='proof'?0.9:kind==='hypothesis'?0.35:0.55})}),result=await response.json();
    if(!response.ok){setActivity(result.error||'Unable to save note');return;}
    setTitle('');setNoteBody('');setSourceUrl('');setShowNote(false);setActivity('Finding saved to this person.');await loadDossier();onGraphChanged();
  }

  async function advanceNote(note:ResearchNote,status:string){
    const response=await fetch('/api/genealogy/research/dossier',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:note.id,status})});
    if(response.ok)await loadDossier();
  }

  const metadata=node?.metadata??{};
  return <aside style={{position:'absolute',top:58,right:14,bottom:58,width:380,maxWidth:'43vw',zIndex:6,display:'flex',flexDirection:'column',background:`linear-gradient(160deg,${C.panel},rgba(5,10,22,.84))`,border:`1px solid ${C.cyan}33`,borderRadius:9,boxShadow:'0 0 34px rgba(80,70,180,.24)',backdropFilter:'blur(14px)',overflow:'hidden'}}>
    <div style={{padding:'11px 12px',borderBottom:`1px solid ${C.cyan}22`}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'baseline'}}><span style={{fontFamily:mono,fontSize:9,letterSpacing:2,color:C.cyan}}>ANCESTRAL RESEARCH</span><span style={{fontFamily:body,fontSize:10,color:C.dim}}>{metrics?`${metrics.visible_people} people · ${metrics.generations} generations`:''}</span></div>
      <input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Find a person, surname or place…" style={{boxSizing:'border-box',width:'100%',marginTop:9,padding:'8px 10px',borderRadius:5,border:`1px solid ${C.cyan}44`,background:'rgba(1,7,18,.8)',color:C.text,fontFamily:body,fontSize:13,outline:'none'}}/>
      {(searching||results.length>0)&&<div style={{maxHeight:190,overflowY:'auto',marginTop:5,display:'flex',flexDirection:'column',gap:4}}>
        {searching&&<div style={{fontFamily:body,fontSize:11,color:C.dim,padding:5}}>searching the active GEDCOM…</div>}
        {results.map((person)=>{const m=person.metadata??{};return <div key={person.id} style={{padding:'7px 8px',border:`1px solid ${C.cyan}22`,borderRadius:4,background:'rgba(80,120,200,.05)'}}>
          <div onClick={()=>{onNavigate(person.id);setQuery('');setResults([]);}} style={{cursor:'pointer',fontFamily:body,fontSize:13,color:C.text}}>{person.label}</div>
          <div style={{fontFamily:body,fontSize:10.5,color:C.dim}}>{datePlace(m)} · {Math.round(Number(person.proof_strength)*100)}% imported support</div>
          <button onClick={()=>setRoot(person)} style={{...button(),marginTop:5}}>CENTRE TREE HERE</button>
        </div>;})}
      </div>}
    </div>

    <div style={{overflowY:'auto',padding:10,display:'flex',flexDirection:'column',gap:8}}>
      {(!node||node.id==='ROOT')&&<>
        <section style={{padding:10,border:`1px solid ${C.gold}33`,borderRadius:6,background:'rgba(255,225,160,.035)'}}>
          <div style={{fontFamily:mono,fontSize:11,color:C.gold,letterSpacing:1}}>{String(importInfo?.summary?.root??'FAMILY RESEARCH CORE')}</div>
          <div style={{fontFamily:body,fontSize:11.5,color:C.dim,marginTop:5,lineHeight:1.45}}>{importInfo?.filename??'Import a GEDCOM to begin.'}</div>
        </section>
        {metrics&&<section style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
          {[['PRESERVED MEDIA',metrics.preserved_media,C.green],['PROOF GAPS',metrics.proof_gaps,C.gold],['CONVERGENCES',metrics.convergent_ancestors,C.magenta],['SCAFFOLD LINKS',metrics.research_scaffolds,C.gold],['RESEARCH NOTES',metrics.notes,C.green],['VISIBLE PEOPLE',metrics.visible_people,C.cyan]].map(([label,value,color])=><div key={String(label)} style={{padding:9,border:`1px solid ${String(color)}33`,borderRadius:5,background:'rgba(80,120,200,.035)'}}><div style={{fontFamily:mono,fontSize:8,letterSpacing:1,color:String(color)}}>{label}</div><div style={{fontFamily:body,fontSize:20,color:C.text}}>{String(value)}</div></div>)}
        </section>}
        <div style={{fontFamily:body,fontSize:12,color:C.dim,lineHeight:1.5,padding:4}}>Search for yourself or your father and choose <span style={{color:C.cyan}}>Centre tree here</span>. The orrery will then calculate every visible ancestral path from that person, including repeated ancestors.</div>
      </>}

      {node&&node.id!=='ROOT'&&<>
        <section style={{padding:10,border:`1px solid ${C.cyan}33`,borderLeft:`3px solid ${C.cyan}`,borderRadius:6,background:'rgba(70,150,220,.045)'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{fontFamily:mono,fontSize:12,letterSpacing:1,color:C.text}}>{node.name}</span><span style={{fontFamily:mono,fontSize:8,color:node.coherence&&node.coherence>=.7?C.green:C.gold}}>{Math.round((node.coherence??0)*100)}% PROOF</span></div>
          <div style={{fontFamily:body,fontSize:11.5,color:C.dim,marginTop:5}}>{datePlace(metadata)}</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:7}}><span style={button()}>{node.review_status??'imported'}</span>{Boolean(metadata.research_scaffold_path)&&<span style={{...button(),borderColor:`${C.gold}88`,color:C.gold}}>RESEARCH SCAFFOLD</span>}{Number(metadata.pedigree_paths??0)>1&&<span style={button(true)}>{String(metadata.pedigree_paths)} ANCESTRAL PATHS</span>}<span style={button()}>{String(metadata.source_refs??0)} SOURCE REFS</span></div>
        </section>

        {loading&&<div style={{fontFamily:body,fontSize:12,color:C.dim}}>assembling evidence and archive matches…</div>}
        {dossier&&dossier.suggestions.length>0&&<section><div style={{fontFamily:mono,fontSize:8,letterSpacing:1.5,color:C.magenta,margin:'2px 2px 6px'}}>RESEARCH NEXT</div>{dossier.suggestions.map((item,index)=><div key={`${item.title}-${index}`} style={{padding:'8px 9px',marginBottom:5,border:`1px solid ${item.priority==='critical'?C.red:item.priority==='high'?C.gold:C.cyan}33`,borderLeft:`2px solid ${item.priority==='critical'?C.red:item.priority==='high'?C.gold:C.cyan}`,borderRadius:5,background:'rgba(100,70,160,.04)'}}><div style={{fontFamily:body,fontWeight:600,fontSize:12.5,color:C.text}}>{item.title}</div><div style={{fontFamily:body,fontSize:11,color:C.dim,lineHeight:1.4,marginTop:2}}>{item.reason}</div></div>)}</section>}

        {dossier&&dossier.preservedMedia.length>0&&<section><div style={{fontFamily:mono,fontSize:8,letterSpacing:1.5,color:C.green,margin:'2px 2px 6px'}}>PRESERVED GEDCOM MEDIA · {dossier.preservedMedia.length}</div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>{dossier.preservedMedia.slice(0,12).map((media)=>{const href=`/api/genealogy/assets/${media.asset_sha256}`;return <a key={media.id} href={href} target="_blank" rel="noreferrer" title={media.title??'Preserved GEDCOM image'} style={{display:'block',minWidth:0,textDecoration:'none',border:`1px solid ${C.green}35`,borderRadius:5,overflow:'hidden',background:'rgba(30,150,110,.04)'}}><img src={href} loading="lazy" alt={media.title??`Preserved genealogy image ${media.media_index+1}`} style={{display:'block',width:'100%',height:94,objectFit:'cover',background:'rgba(0,0,0,.35)'}}/><div style={{padding:'5px 6px',fontFamily:body,fontSize:10,color:C.dim,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{media.title||`Image ${media.media_index+1}`}</div></a>;})}</div>{dossier.preservedMedia.length>12&&<div style={{fontFamily:body,fontSize:10.5,color:C.dim,marginTop:5}}>Showing 12 of {dossier.preservedMedia.length} preserved images.</div>}</section>}

        {dossier&&dossier.archiveMatches.length>0&&<section><div style={{fontFamily:mono,fontSize:8,letterSpacing:1.5,color:C.green,margin:'2px 2px 6px'}}>ARCHIVE TRANSLATOR MATCHES · {dossier.archiveMatches.length}</div>{dossier.archiveMatches.slice(0,8).map((match)=><a key={`${match.record_id}-${match.role}`} href={match.source_url} target="_blank" rel="noreferrer" style={{display:'block',textDecoration:'none',padding:'8px 9px',marginBottom:5,border:`1px solid ${C.green}2f`,borderRadius:5,background:'rgba(40,180,130,.035)'}}><div style={{fontFamily:body,fontSize:12.5,color:C.green}}>{match.reconstructed_name||match.name_raw} · {match.event_type}</div><div style={{fontFamily:body,fontSize:10.5,color:C.dim}}>{match.event_date_text||match.event_year||'date unresolved'} · {match.location_text||'place unresolved'} · page {match.page_number??'?'}</div></a>)}</section>}

        <section><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,margin:'2px 2px 6px'}}><span style={{fontFamily:mono,fontSize:8,letterSpacing:1.5,color:C.gold}}>FINDINGS & CLUES · {dossier?.notes?.length??0}</span><button onClick={()=>setShowNote((value)=>!value)} style={button(true)}>{showNote?'CANCEL':'+ NOTE'}</button></div>
          {showNote&&<div style={{display:'flex',flexDirection:'column',gap:6,padding:9,border:`1px solid ${C.gold}33`,borderRadius:5}}>
            <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{['clue','finding','hypothesis','conflict','task','proof'].map((value)=><button key={value} onClick={()=>setKind(value)} style={button(kind===value)}>{value.toUpperCase()}</button>)}</div>
            <input value={title} onChange={(event)=>setTitle(event.target.value)} placeholder="Short finding or question" style={{padding:7,border:`1px solid ${C.cyan}33`,borderRadius:4,background:'rgba(1,7,18,.8)',color:C.text,fontFamily:body}}/>
            <textarea value={noteBody} onChange={(event)=>setNoteBody(event.target.value)} placeholder="What we know, what is uncertain, and why it matters…" rows={4} style={{padding:7,border:`1px solid ${C.cyan}33`,borderRadius:4,background:'rgba(1,7,18,.8)',color:C.text,fontFamily:body,resize:'vertical'}}/>
            <input value={sourceUrl} onChange={(event)=>setSourceUrl(event.target.value)} placeholder="Optional source or archive URL" style={{padding:7,border:`1px solid ${C.cyan}33`,borderRadius:4,background:'rgba(1,7,18,.8)',color:C.text,fontFamily:body}}/>
            <button disabled={!title.trim()} onClick={saveNote} style={{...button(true),opacity:title.trim()?1:.45}}>SAVE TO PERSON</button>
          </div>}
          {dossier?.notes?.map((note)=><div key={note.id} style={{padding:'8px 9px',marginTop:5,border:`1px solid ${note.kind==='conflict'?C.red:note.kind==='proof'?C.green:C.gold}30`,borderRadius:5,background:'rgba(255,225,160,.025)'}}><div style={{display:'flex',justifyContent:'space-between',gap:7}}><span style={{fontFamily:body,fontSize:12.5,color:C.text}}>{note.title}</span><span style={{fontFamily:mono,fontSize:7.5,color:C.dim}}>{note.kind.toUpperCase()} · {note.status}</span></div>{note.body&&<div style={{fontFamily:body,fontSize:11,color:C.dim,lineHeight:1.4,marginTop:3,whiteSpace:'pre-wrap'}}>{note.body}</div>}<div style={{display:'flex',gap:5,marginTop:5}}>{note.status!=='supported'&&<button onClick={()=>advanceNote(note,'supported')} style={button()}>SUPPORT</button>}{note.status!=='rejected'&&<button onClick={()=>advanceNote(note,'rejected')} style={button()}>REJECT</button>}</div></div>)}
        </section>
      </>}
      {activity&&<div role="status" style={{padding:8,border:`1px solid ${C.cyan}33`,borderRadius:5,fontFamily:body,fontSize:11.5,color:C.cyan}}>{activity}</div>}
    </div>
  </aside>;
}
