'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

type Fam = { name: string; weight: number };
type GNode = { id: string; n: number; label: string; clusters: number; links: number; families: Fam[]; dom: string };
type GEdge = { a: string; b: string; w: number };
type Graph = { ok: boolean; error?: string; core: { label: string }; nodes: GNode[]; edges: GEdge[]; domains: string[] };

const DOM_COLOR: Record<string, number> = {
  mastermind: 0x00ffff, memory: 0x8a2be2, codex: 0xffaa00, harmonic: 0xff00ff,
  gravity: 0x00ffaa, 'fractal-address': 0x3aa0ff, scroll: 0xff7733, 'recovered-vision': 0xff5599,
};
const colorOf = (dom: string) => DOM_COLOR[dom] ?? 0xffffff;
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

// deterministic 3D force layout: fibonacci-sphere seed -> repel all, attract along weighted edges, center pull.
function layout(nodes: GNode[], edges: GEdge[]): Map<string, THREE.Vector3> {
  const pos = new Map<string, THREE.Vector3>(); const N = nodes.length;
  nodes.forEach((nd, i) => {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / N), theta = Math.PI * (1 + Math.sqrt(5)) * i;
    pos.set(nd.id, new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)).multiplyScalar(14));
  });
  const idx = new Map(nodes.map((n, i) => [n.id, i] as const));
  for (let it = 0; it < 400; it++) {
    const f = nodes.map(() => new THREE.Vector3());
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const d = new THREE.Vector3().subVectors(pos.get(nodes[i].id)!, pos.get(nodes[j].id)!);
      const len = d.length() || 0.01; d.multiplyScalar(60 / (len * len) / len); f[i].add(d); f[j].sub(d);
    }
    for (const e of edges) {
      const i = idx.get(e.a)!, j = idx.get(e.b)!;
      const d = new THREE.Vector3().subVectors(pos.get(e.b)!, pos.get(e.a)!);
      const len = d.length() || 0.01; d.multiplyScalar((len - 9) * 0.02 * (0.4 + e.w) / len); f[i].add(d); f[j].sub(d);
    }
    nodes.forEach((nd, i) => { const p = pos.get(nd.id)!; f[i].addScaledVector(p, -0.01); p.addScaledVector(f[i], 0.85); });
  }
  return pos;
}

function labelSprite(text: string, color: number): THREE.Sprite {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const ctx = cv.getContext('2d')!;
  ctx.font = 'bold 44px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#000'; ctx.shadowBlur = 8; ctx.fillStyle = hex(color);
  ctx.fillText(text, cv.width / 2, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv); tex.needsUpdate = true;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set(8, 2, 1); return spr;
}

export default function ConceptGraph() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<GNode | null>(null);
  const [err, setErr] = useState('');
  const [meta, setMeta] = useState<{ nodes: number; edges: number } | null>(null);

  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    let raf = 0; let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000); camera.position.set(0, 8, 40);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    scene.add(new THREE.AmbientLight(0x223355, 1.4));
    const pl = new THREE.PointLight(0x00ffff, 2, 240); scene.add(pl);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 1),
      new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00aaff, emissiveIntensity: 1.4, wireframe: true, transparent: true, opacity: 0.9 }));
    scene.add(core);
    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
    const meshes: THREE.Mesh[] = []; const meshNode = new Map<THREE.Object3D, GNode>();
    let camTarget = new THREE.Vector3(0, 0, 0);

    function size() {
      const w = mount!.clientWidth || 800, h = mount!.clientHeight || 540;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    renderer.setClearColor(0x000000, 0); mount.appendChild(renderer.domElement); size();

    fetch('/api/concept-graph', { cache: 'no-store' }).then((r) => r.json()).then((g: Graph) => {
      if (disposed) return;
      if (!g.ok) { setErr(g.error || 'concept-graph endpoint error'); return; }
      setMeta({ nodes: g.nodes.length, edges: g.edges.length });
      const pos = layout(g.nodes, g.edges);
      const byId = new Map(g.nodes.map((n) => [n.id, n] as const));
      const epos: number[] = []; const ecol: number[] = [];
      for (const e of g.edges) {
        const a = pos.get(e.a)!, b = pos.get(e.b)!;
        const ca = new THREE.Color(colorOf(byId.get(e.a)!.dom)), cb = new THREE.Color(colorOf(byId.get(e.b)!.dom));
        const al = 0.15 + e.w * 0.5; epos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        ecol.push(ca.r * al, ca.g * al, ca.b * al, cb.r * al, cb.g * al, cb.b * al);
      }
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.Float32BufferAttribute(epos, 3));
      eg.setAttribute('color', new THREE.Float32BufferAttribute(ecol, 3));
      scene.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
      for (const nd of g.nodes) {
        const p = pos.get(nd.id)!; const col = colorOf(nd.dom); const r = 0.8 + Math.sqrt(nd.clusters) * 0.32;
        const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 24),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.7, roughness: 0.4 }));
        m.position.copy(p); scene.add(m); meshes.push(m); meshNode.set(m, nd);
        const halo = new THREE.Mesh(new THREE.SphereGeometry(r * 1.5, 16, 16),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
        halo.position.copy(p); scene.add(halo);
        const spr = labelSprite(nd.label, col); spr.position.copy(p).add(new THREE.Vector3(0, r + 1.6, 0)); scene.add(spr);
      }
    }).catch((e) => setErr(String(e)));

    function onClick(ev: MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      if (hit) { const nd = meshNode.get(hit.object); if (nd) { setSel(nd); camTarget = hit.object.position.clone(); } }
    }
    renderer.domElement.addEventListener('click', onClick);
    const onResize = () => size(); window.addEventListener('resize', onResize);

    function animate() {
      raf = requestAnimationFrame(animate);
      core.rotation.y += 0.003; core.rotation.x += 0.0012;
      controls.target.lerp(camTarget, 0.06); controls.update();
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      disposed = true; cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('click', onClick); window.removeEventListener('resize', onResize);
      controls.dispose(); renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: 540, borderRadius: 10, overflow: 'hidden',
      border: '1px solid rgba(0,255,255,0.25)', background: 'radial-gradient(circle at 50% 40%, rgba(0,30,60,0.5), rgba(0,5,15,0.88))' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 10, left: 14, fontFamily: 'Orbitron, monospace', fontSize: 11, color: '#00ffff', textShadow: '0 0 6px #00ffff', letterSpacing: 2 }}>
        CONCEPT GRAPH{meta ? ` · ${meta.nodes} signatures · ${meta.edges} links` : ''}
      </div>
      <div style={{ position: 'absolute', bottom: 10, left: 14, fontFamily: 'Rajdhani, sans-serif', fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
        drag to orbit · scroll to zoom · click a signature to recenter
      </div>
      {err && <div style={{ position: 'absolute', top: 34, left: 14, color: '#ff5555', fontSize: 12, fontFamily: 'Rajdhani, sans-serif' }}>{err}</div>}
      {sel && (
        <div style={{ position: 'absolute', top: 10, right: 12, width: 230, background: 'rgba(0,12,28,0.9)', border: '1px solid rgba(0,255,255,0.3)', borderRadius: 8, padding: '10px 12px', fontFamily: 'Rajdhani, sans-serif' }}>
          <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 12, color: hex(colorOf(sel.dom)), textShadow: `0 0 6px ${hex(colorOf(sel.dom))}`, marginBottom: 6 }}>{sel.label}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>{sel.clusters} clusters · {sel.links} internal links</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 8, marginBottom: 3 }}>families</div>
          {sel.families.slice(0, 6).map((f) => (
            <div key={f.name} style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', display: 'flex', justifyContent: 'space-between' }}>
              <span>{f.name}</span><span style={{ color: 'rgba(0,255,255,0.7)' }}>{f.weight}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
