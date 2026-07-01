'use client';
// NexusGraph3D — the reframed body.unity_cockpit: the organism's graph as a navigable 3D space in WebGL
// (Three.js) inside the command center. No Unity, no editor, no manual presence. Two live sources, one renderer:
//   CONCEPT  = /api/concept-graph — the ~11 phenomenon signatures + attraction edges (the meaning-space; the
//              original cockpit spec: clusters placed by attraction). THIS is what 2D surfaces don't show.
//   ARCHITECTURE = /api/painting — the faculty/dep graph (a 3D sibling of the 2D operations map).
// Drag to orbit, scroll to zoom, click a node to inspect.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const C: Record<string,string> = { cyan:'#00ffff', magenta:'#ff00ff', violet:'#8a2be2', gold:'#ffaa00',
  green:'#00ffaa', red:'#ff4444', dim:'rgba(0,255,255,0.35)', card:'rgba(0,15,35,0.85)' };
const mono = 'Orbitron, monospace';
const body = 'Rajdhani, monospace';

// group -> colour (faculties for architecture, domains for concept; cyberpunk tokens, body.visual_standard)
const GRP: Record<string,string> = {
  body:'#00ffff', orch:'#ff00ff', homeo:'#00ffaa', cortex:'#8a2be2', memory:'#ffaa00', law:'#ff4444',
  hands:'#ff8800', identity:'#66ccff', meta:'#aaaaaa', perf:'#00ff66', mc:'#55ff55', auto:'#ff66cc',
  mastermind:'#00ffff', codex:'#8a2be2', harmonic:'#ffaa00', gravity:'#ff4444', ternary:'#00ffaa',
  frequency:'#ff66cc', scroll:'#ff8800', self:'#66ccff', price:'#55ff55', overline:'#ff00ff' };
function hash(s:string){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0)/4294967295; }
const grpColor = (g:string)=> GRP[g] || `hsl(${Math.floor(hash(g)*360)},70%,60%)`;

// normalized shapes the renderer consumes (both sources map into these)
type Node = { id:string; label:string; group:string; weight:number; detail:string };
type Edge = { from:string; to:string; w:number };
type Src = 'concept' | 'architecture';

async function loadGraph(src:Src): Promise<{ nodes:Node[]; edges:Edge[]; core:string }>{
  if (src === 'concept'){
    const d = await fetch('/api/concept-graph').then(r=>r.json());
    if(!d.ok || !d.nodes?.length) throw new Error('concept graph unavailable');
    const maxC = Math.max(...d.nodes.map((n:{clusters:number})=>n.clusters||1));
    const nodes: Node[] = d.nodes.map((n:{id:string;label:string;dom:string;clusters:number;links:number;families:{name:string;weight:number}[]})=>({
      id:n.id, label:n.label||n.id, group:n.dom||'misc', weight:0.35+0.65*((n.clusters||1)/maxC),
      detail:`${n.clusters} clusters · ${n.links} internal links\nfamilies: ${(n.families||[]).map(f=>`${f.name}(${f.weight})`).join(', ')}` }));
    const edges: Edge[] = (d.edges||[]).map((e:{a:string;b:string;w:number})=>({ from:e.a, to:e.b, w:e.w }));
    return { nodes, edges, core: d.core?.label || 'NEXUS' };
  }
  const d = await fetch('/api/painting').then(r=>r.json());
  if(!d.ok || !d.nodes?.length) throw new Error('architecture graph unavailable');
  const A: Record<string,number> = { LIVE:1.0, PROVEN:0.8, SPEC:0.55, CANDIDATE:0.45, vision:0.4 };
  const nodes: Node[] = d.nodes.map((n:{id:string;name?:string;faculty:string;phase:string;status:string;note?:string})=>({
    id:n.id, label:n.name||n.id, group:n.faculty, weight:A[n.status]??0.5,
    detail:`${n.faculty} · phase ${n.phase} · ${n.status}${n.note?'\n'+n.note:''}` }));
  const edges: Edge[] = (d.edges||[]).map((e:{from:string;to:string})=>({ from:e.from, to:e.to, w:1 }));
  return { nodes, edges, core: 'NEXUS' };
}

export default function NexusGraph3D(){
  const mountRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<Node|null>(null);
  const [info, setInfo] = useState<string>('loading graph…');
  const [source, setSource] = useState<Src>('concept');
  const selRef = useRef<(n:Node|null)=>void>(()=>{}); selRef.current = setSel;

  useEffect(()=>{
    const mount = mountRef.current; if(!mount) return;
    let raf = 0, disposed = false;
    const W = ()=> mount.clientWidth || 800, H = ()=> mount.clientHeight || 600;
    setSel(null);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, W()/H(), 0.1, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
    renderer.setSize(W(), H()); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio||1));
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;cursor:grab';

    const target = new THREE.Vector3(0,0,0);
    let radius = 320, theta = 0.6, phi = 1.15, autoRot = true;
    const place = ()=>{ camera.position.set(
      target.x + radius*Math.sin(phi)*Math.cos(theta),
      target.y + radius*Math.cos(phi),
      target.z + radius*Math.sin(phi)*Math.sin(theta)); camera.lookAt(target); };
    place();

    const nodeMeshes: THREE.Mesh[] = [];
    const group = new THREE.Group(); scene.add(group);

    loadGraph(source).then(({nodes,edges})=>{
      if(disposed) return;
      setInfo(`${nodes.length} nodes · ${edges.length} edges · ${source==='concept'?'concept / meaning graph (the signatures, by attraction)':'architecture graph (faculties + deps)'}`);

      // group centroids on a Fibonacci sphere
      const groups = Array.from(new Set(nodes.map(n=>n.group)));
      const cen: Record<string,THREE.Vector3> = {};
      const gr = Math.PI*(3-Math.sqrt(5)); const R = nodes.length>20?150:95;
      groups.forEach((f,i)=>{ const y=1-(i/Math.max(1,groups.length-1))*2; const r=Math.sqrt(Math.max(0,1-y*y));
        const a=gr*i; cen[f]=new THREE.Vector3(Math.cos(a)*r*R, y*R, Math.sin(a)*r*R); });

      const pos: Record<string,THREE.Vector3> = {};
      nodes.forEach(n=>{ const c=cen[n.group]||new THREE.Vector3();
        pos[n.id]=new THREE.Vector3(c.x+(hash(n.id+'x')-0.5)*60, c.y+(hash(n.id+'y')-0.5)*60, c.z+(hash(n.id+'z')-0.5)*60); });

      // light 3D force relaxation (repulsion + weighted edge springs + group cohesion), fixed iters -> stable
      const ids = nodes.map(n=>n.id);
      for(let it=0; it<90; it++){
        const F: Record<string,THREE.Vector3> = {}; ids.forEach(i=>F[i]=new THREE.Vector3());
        for(let a=0;a<ids.length;a++) for(let b=a+1;b<ids.length;b++){
          const pa=pos[ids[a]], pb=pos[ids[b]]; const dx=pa.clone().sub(pb); const dl=dx.length()||0.01;
          const rep=1600/(dl*dl); dx.multiplyScalar(rep/dl); F[ids[a]].add(dx); F[ids[b]].sub(dx); }
        edges.forEach(e=>{ const pa=pos[e.from],pb=pos[e.to]; if(!pa||!pb) return;
          const dx=pa.clone().sub(pb); const dl=dx.length()||0.01; const rest=70-40*e.w; const k=0.02*(dl-rest)*(0.4+e.w);
          dx.multiplyScalar(-k/dl); F[e.from].add(dx); F[e.to].sub(dx); });
        nodes.forEach(n=>{ const c=cen[n.group]; if(c) F[n.id].add(c.clone().sub(pos[n.id]).multiplyScalar(0.015)); });
        ids.forEach(i=>pos[i].add(F[i].multiplyScalar(0.85).clampLength(0,12)));
      }

      // edges (opacity by weight)
      edges.forEach(e=>{ const a=pos[e.from],b=pos[e.to]; if(!a||!b) return;
        const eg=new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute([a.x,a.y,a.z,b.x,b.y,b.z],3));
        group.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color:0x2ad6ff, transparent:true, opacity:0.10+0.30*e.w }))); });

      // nodes (emissive sphere + additive halo, size by weight, colour by group)
      nodes.forEach(n=>{ const col=new THREE.Color(grpColor(n.group)); const a=n.weight;
        const core=new THREE.Mesh(new THREE.SphereGeometry(3.4+a*3.4,16,16), new THREE.MeshBasicMaterial({ color:col }));
        core.position.copy(pos[n.id]); (core.userData as {n:Node}).n=n; group.add(core); nodeMeshes.push(core);
        const halo=new THREE.Mesh(new THREE.SphereGeometry(8+a*6,16,16),
          new THREE.MeshBasicMaterial({ color:col, transparent:true, opacity:0.12*a, blending:THREE.AdditiveBlending, depthWrite:false }));
        halo.position.copy(pos[n.id]); group.add(halo); });

      // central core
      group.add(new THREE.Mesh(new THREE.SphereGeometry(6,24,24), new THREE.MeshBasicMaterial({ color:0x00ffff, transparent:true, opacity:0.9 })));
      group.add(new THREE.Mesh(new THREE.SphereGeometry(16,24,24),
        new THREE.MeshBasicMaterial({ color:0x00ffff, transparent:true, opacity:0.08, blending:THREE.AdditiveBlending, depthWrite:false })));
    }).catch((e)=>{ if(!disposed) setInfo(String(e?.message||e)); });

    // interaction
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
    let dragging=false, moved=false, px=0, py=0;
    const dom = renderer.domElement;
    const onDown=(e:MouseEvent)=>{ dragging=true; moved=false; px=e.clientX; py=e.clientY; autoRot=false; dom.style.cursor='grabbing'; };
    const onMove=(e:MouseEvent)=>{ if(!dragging) return; const dx=e.clientX-px, dy=e.clientY-py; px=e.clientX; py=e.clientY;
      if(Math.abs(dx)+Math.abs(dy)>2) moved=true; theta-=dx*0.005; phi=Math.max(0.15,Math.min(Math.PI-0.15, phi-dy*0.005)); place(); };
    const onUp=(e:MouseEvent)=>{ dragging=false; dom.style.cursor='grab';
      if(!moved){ const r=dom.getBoundingClientRect(); ndc.x=((e.clientX-r.left)/r.width)*2-1; ndc.y=-((e.clientY-r.top)/r.height)*2+1;
        ray.setFromCamera(ndc,camera); const hit=ray.intersectObjects(nodeMeshes,false)[0];
        if(hit){ const n=(hit.object.userData as {n:Node}).n; selRef.current(n); target.copy(hit.object.position); radius=110; place(); }
        else { selRef.current(null); } } };
    const onWheel=(e:WheelEvent)=>{ e.preventDefault(); radius=Math.max(50,Math.min(900, radius*(1+Math.sign(e.deltaY)*0.1))); place(); };
    dom.addEventListener('mousedown',onDown); window.addEventListener('mousemove',onMove); window.addEventListener('mouseup',onUp);
    dom.addEventListener('wheel',onWheel,{passive:false});

    const onResize=()=>{ camera.aspect=W()/H(); camera.updateProjectionMatrix(); renderer.setSize(W(),H()); };
    window.addEventListener('resize',onResize);

    const loop=()=>{ if(disposed) return; raf=requestAnimationFrame(loop); if(autoRot){ theta+=0.0016; place(); } renderer.render(scene,camera); };
    loop();

    return ()=>{ disposed=true; cancelAnimationFrame(raf);
      dom.removeEventListener('mousedown',onDown); window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp);
      dom.removeEventListener('wheel',onWheel); window.removeEventListener('resize',onResize);
      renderer.dispose(); scene.traverse(o=>{ const m=o as THREE.Mesh; if(m.geometry) m.geometry.dispose();
        const mat=m.material as THREE.Material|THREE.Material[]; if(Array.isArray(mat)) mat.forEach(x=>x.dispose()); else if(mat) mat.dispose(); });
      if(renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); };
  },[source]);

  const Tog = ({s,label}:{s:Src;label:string}) => (
    <span onClick={()=>setSource(s)} style={{cursor:'pointer',fontFamily:mono,fontSize:10,letterSpacing:1,padding:'2px 8px',
      borderRadius:4,border:`1px solid ${source===s?C.cyan:C.dim}`,color:source===s?C.cyan:C.dim,
      textShadow:source===s?`0 0 6px ${C.cyan}`:'none'}}>{label}</span>);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:8,height:'100%',minHeight:640}}>
      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <span style={{fontFamily:mono,color:C.cyan,fontSize:12,letterSpacing:2}}>◬ NEXUS GRAPH</span>
        <Tog s="concept" label="CONCEPT"/><Tog s="architecture" label="ARCHITECTURE"/>
        <span style={{fontFamily:body,fontSize:11,color:C.dim}}>{info}</span>
      </div>
      <div style={{position:'relative',flex:1,minHeight:560,border:`1px solid ${C.cyan}30`,borderRadius:8,background:'#04060d',overflow:'hidden'}}>
        <div ref={mountRef} style={{position:'absolute',inset:0}}/>
        <div style={{position:'absolute',bottom:10,left:12,fontFamily:body,fontSize:10,color:C.dim,pointerEvents:'none'}}>drag to orbit · scroll to zoom · click a node to inspect</div>
        {sel && <div style={{position:'absolute',top:10,right:12,width:270,background:C.card,border:`1px solid ${grpColor(sel.group)}66`,
          borderRadius:8,padding:'10px 12px',fontFamily:body}}>
          <div style={{fontFamily:mono,fontSize:12,color:grpColor(sel.group),letterSpacing:1,textShadow:`0 0 6px ${grpColor(sel.group)}`}}>{sel.label}</div>
          <div style={{fontSize:11,color:C.dim,marginTop:2}}>{sel.id} · {sel.group}</div>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.65)',marginTop:6,lineHeight:1.45,maxHeight:200,overflow:'auto',whiteSpace:'pre-wrap'}}>{sel.detail}</div>
        </div>}
      </div>
    </div>
  );
}
