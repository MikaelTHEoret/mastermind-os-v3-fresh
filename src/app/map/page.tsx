'use client';

// THE GOLDEN ORRERY — holographic look (body.knowledge_visualizer).
// Reversible gravitational descent (focus at origin). Bodies are FUTURISTIC HOLOGRAMS of celestial matter:
// additive glowing spheres, sparse code flowing under the skin, moving scanlines, holo wireframe, iridescent
// edge-light + a soft sprite halo (no corona-shell ring). SUN(focus)/PLANET(child)/MOON(deeper) presets;
// coherence drives cleanliness. Holographic palette (cyan-white / iridescent), field stays dark.

import { useEffect, useRef, useState } from 'react';

const C = { cyan: '#6ff2ff', gold: '#ffe1a0', green: '#7fffc8', magenta: '#c79bff', text: '#dffaff', textDim: 'rgba(150,215,235,0.6)' };
const ORBITRON = "'Orbitron','Segoe UI',monospace";
const RAJDHANI = "'Rajdhani','Segoe UI',sans-serif";

// color = ANCESTRY ONLY — holographic register (luminous, cool, iridescent). ROOT cyan-white.
const BRANCH_COLORS: Record<string, string> = {
  ROOT: '#cdfbff', frequency: '#5fe9ff', harmonic: '#ffd98a', minecraft: '#6dffc4',
  ternary: '#b89cff', overline: '#9ab8ff', price: '#ffe7a0', scroll: '#ff9ec4', self: '#88d6ff',
};
const colorOf = (root: string): string => BRANCH_COLORS[root] || '#9fd0ff';

type RawNode = { id: string; name: string; depth: number; is_leaf: boolean; n_chunks: number; coherence: number | null; root: string };
type GLink = { source: string; target: string };
type TreeResp = { nodes: RawNode[]; links: GLink[]; roots: string[]; count: number };
type Crumb = { id: string; name: string };
type ViewState = { focusId: string; path: Crumb[]; focus: RawNode | null; childCount: number };
type ChunkCard = { address: string; title: string | null; subject: string | null; source_type: string | null; chars: number | null; snippet: string };
type LeafData = { path: string; total: number; chunks: ChunkCard[]; loading: boolean };

function shell(n: number, radius: number): [number, number, number][] {
  if (n <= 0) return [];
  const out: [number, number, number][] = []; const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2; const r = Math.sqrt(Math.max(0, 1 - y * y)); const th = ga * i;
    out.push([Math.cos(th) * r * radius, y * radius * 0.6, Math.sin(th) * r * radius]);
  }
  return out;
}

const BODY_VERT = `
varying vec2 vUv; varying vec3 vNormalW; varying vec3 vViewDirW;
uniform float uTime; uniform float uCoherence; uniform float uFocus; uniform float uNoiseAmount;
float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453123); }
void main(){
  vUv = uv; vec3 d = position; float inst = 1.0 - uCoherence;
  float n = hash(normal*8.0 + vec3(uTime*0.08));
  float breathe = sin(uTime*0.7 + n*6.283) * inst * uNoiseAmount;
  d += normal * breathe * mix(0.4,1.0,uFocus);
  vec4 wp = modelMatrix * vec4(d,1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewDirW = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// holographic, additive-blended body
const BODY_FRAG = `
precision highp float;
uniform float uTime; uniform vec3 uBranchColor; uniform vec3 uAccentColor;
uniform float uCoherence; uniform float uFocus;
uniform sampler2D uCodeTex; uniform float uCodeScale; uniform float uCodeSpeed; uniform float uCodeOpacity;
uniform sampler2D uCircuitTex; uniform float uCircuitScale;
uniform samplerCube uEnvMap; uniform float uEnvIntensity;
uniform float uCircuitOpacity; uniform float uRimPower; uniform float uRimIntensity;
uniform float uPulseIntensity; uniform float uAlpha;
varying vec2 vUv; varying vec3 vNormalW; varying vec3 vViewDirW;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
float gridLine(float x, float w){ float g = abs(fract(x)-0.5); return smoothstep(w,0.0,g); }
void main(){
  vec3 N = normalize(vNormalW); vec3 V = normalize(vViewDirW);
  float fres = pow(1.0 - max(dot(N,V),0.0), uRimPower);
  float inst = 1.0 - uCoherence;
  float pulse = 0.5 + 0.5*sin(uTime*(0.6 + inst*1.2));
  vec3 holo = vec3(0.72,0.95,1.0);

  // flowing code under the skin (more visible)
  vec2 cUv = vUv*uCodeScale; cUv.y += uTime*uCodeSpeed*mix(0.6,1.8,inst);
  float ccol = floor(cUv.x*18.0); cUv.y += hash(vec2(ccol,4.2))*0.25;
  float cs = texture2D(uCodeTex, cUv).a;
  float sparse = hash(floor(vUv*vec2(20.0,12.0)));
  float spMask = step(mix(0.52,0.4,inst), sparse);
  float code = cs*spMask;

  // moving holographic scanlines
  float scan = 0.5 + 0.5*sin(vUv.y*44.0 - uTime*2.0);
  scan = mix(0.6, 1.0, pow(scan, 1.5));

  // circuit-board traces (DOMINANT surface feature, crisp at any distance) + faint latitude rings
  float ck = texture2D(uCircuitTex, vUv*uCircuitScale).a;
  float lat = gridLine(vUv.y*14.0, 0.02);

  // iridescent edge: shift toward cyan-white at grazing angles
  vec3 irid = mix(uBranchColor, holo, fres*0.65);

  // glossy specular highlight (fake top-light) for a glassy read
  float spec = pow(max(N.y*0.5 + 0.5, 0.0), 8.0);
  // GLASS: reflect + refract the colorful chamber (env cube) -> a real glass material, not flat emissive
  vec3 Rrefl = reflect(-V, N);
  vec3 Rrefr = refract(-V, N, 0.72);
  vec3 envRefl = textureCube(uEnvMap, Rrefl).rgb;
  vec3 envRefr = textureCube(uEnvMap, Rrefr).rgb;
  float fglass = clamp(fres*1.3 + 0.12, 0.0, 1.0);
  vec3 glass = mix(envRefr, envRefl, fglass) * uEnvIntensity;
  vec3 base = glass * mix(vec3(1.0), uBranchColor*1.5, 0.32) + uBranchColor*0.03;
  vec3 color = base;
  color += uBranchColor*(0.05 + pulse*uPulseIntensity*0.5);
  color += mix(uBranchColor, holo, 0.5)*code*uCodeOpacity*2.0;
  color += mix(uBranchColor, holo, 0.6)*ck*(0.4 + uCircuitOpacity*0.7);
  color += holo*lat*0.1;
  color += holo*pow(max(dot(N,V),0.0),1.6)*0.16;
  color += irid*fres*uRimIntensity*0.7;
  color += holo*spec*0.25;
  color *= scan;
  color *= 0.95 + 0.05*sin(uTime*26.0 + hash(vUv*7.0)*6.283)*mix(0.3,1.0,inst);

  float a = uAlpha * (0.92 + 0.08*fres);
  gl_FragColor = vec4(color, a);
}`;

type Preset = { lvl: number; focus: number; codeScale: number; codeSpeed: number; codeOpacity: number; circuit: number; rimPower: number; rim: number; pulse: number; noise: number };
const SUN: Preset = { lvl: 0, focus: 1, codeScale: 1.3, codeSpeed: 0.02, codeOpacity: 0.3, circuit: 0.28, rimPower: 1.6, rim: 0.75, pulse: 0.22, noise: 0.045 };
const PLANET: Preset = { lvl: 1, focus: 0, codeScale: 1.8, codeSpeed: 0.013, codeOpacity: 0.26, circuit: 0.24, rimPower: 1.8, rim: 0.6, pulse: 0.12, noise: 0.03 };
const MOON: Preset = { lvl: 2, focus: 0, codeScale: 2.4, codeSpeed: 0.007, codeOpacity: 0.2, circuit: 0.18, rimPower: 2.2, rim: 0.5, pulse: 0.05, noise: 0.018 };
const RAIN_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const RAIN_FRAG = `
precision highp float;
uniform float uTime; uniform sampler2D uCodeTex;
varying vec2 vUv;
float hash(float x){ return fract(sin(x*127.1)*43758.5453); }
void main(){
  vec2 uv = vUv * vec2(48.0, 26.0);
  float col = floor(uv.x);
  float sp = 0.5 + hash(col)*1.4;
  uv.y = uv.y + uTime*sp + hash(col)*50.0;
  float g = texture2D(uCodeTex, fract(uv)).a;
  float colMask = step(0.55, hash(col*2.3));
  vec3 c = mix(vec3(0.32,0.26,0.6), vec3(0.7,0.62,0.95), g*0.7);
  float a = g * colMask * 0.55;
  gl_FragColor = vec4(c*(0.7+0.6*g), a);
}`;

// dense VIOLET column rain pouring onto the focus (brighter toward the bottom)
const COL_FRAG = `
precision highp float;
uniform float uTime; uniform sampler2D uCodeTex;
varying vec2 vUv;
float hash(float x){ return fract(sin(x*127.1)*43758.5453); }
void main(){
  vec2 uv = vUv * vec2(20.0, 58.0);
  float col = floor(uv.x);
  float sp = 1.2 + hash(col)*2.2;
  uv.y = uv.y + uTime*sp*3.0 + hash(col)*50.0;
  float g = texture2D(uCodeTex, fract(uv)).a;
  float colMask = step(0.12, hash(col*2.3));
  float edge = smoothstep(0.0,0.16,vUv.x)*smoothstep(1.0,0.84,vUv.x);
  float fall = smoothstep(1.0,0.0,vUv.y);
  vec3 c = mix(vec3(0.55,0.3,1.0), vec3(0.86,0.72,1.0), g);
  float a = g*colMask*edge*(0.45+0.85*fall)*1.5;
  gl_FragColor = vec4(c*(1.0+1.3*g), a);
}`;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export default function GoldenOrrery() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLDivElement | null>(null);
  const goToRef = useRef<(id: string) => void>(() => {});
  const [tree, setTree] = useState<TreeResp | null>(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState<ViewState>({ focusId: 'ROOT', path: [], focus: null, childCount: 0 });
  const [leaf, setLeaf] = useState<LeafData | null>(null);
  const [openChunk, setOpenChunk] = useState<{ address: string; title: string; content: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try { const r = await fetch('/api/codex?op=tree'); const j = (await r.json()) as TreeResp; if (!j.nodes) setErr(JSON.stringify(j)); else setTree(j); }
      catch (e) { setErr(String(e)); }
    })();
  }, []);

  useEffect(() => {
    if (!tree || !mountRef.current) return;
    const mount = mountRef.current; let disposed = false; let raf = 0; let cleanup = () => {};

    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      const { Reflector } = await import('three/examples/jsm/objects/Reflector.js');
      const { EffectComposer } = await import('three/examples/jsm/postprocessing/EffectComposer.js');
      const { RenderPass } = await import('three/examples/jsm/postprocessing/RenderPass.js');
      const { UnrealBloomPass } = await import('three/examples/jsm/postprocessing/UnrealBloomPass.js');
      if (disposed) return;
      const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

      const atlas = (() => {
        const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512; const cx = cv.getContext('2d')!;
        cx.clearRect(0, 0, 256, 512); cx.font = '15px Rajdhani, monospace'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
        const G = ['0', '1', '/', '#', '{', '}', '<', '>', 'λ', 'ψ', 'π', '∑'];
        for (let x = 8; x < 256; x += 14) { const s = Math.random(); for (let y = 8; y < 512; y += 18) { cx.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.6})`; cx.fillText(G[(Math.random() * G.length) | 0], x + Math.sin(y * 0.04 + s) * 2, y); } }
        const t = new THREE.CanvasTexture(cv); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipMapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
      })();
      const glowTex = (() => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d')!;
        const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64); grd.addColorStop(0, 'rgba(255,255,255,0.5)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.16)'); grd.addColorStop(0.7, 'rgba(255,255,255,0.04)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(cv); t.needsUpdate = true; return t;
      })();

      const circuitTex = (() => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 512; const x = cv.getContext('2d')!;
        x.clearRect(0, 0, 512, 512); x.lineCap = 'square'; x.lineJoin = 'miter';
        const cell = 40; x.strokeStyle = 'rgba(255,255,255,0.96)'; x.fillStyle = 'rgba(255,255,255,0.96)';
        for (let i = 0; i < 60; i++) {
          x.lineWidth = 3 + Math.random() * 2.5;
          let px = (Math.floor(Math.random() * 13)) * cell + cell / 2;
          let py = (Math.floor(Math.random() * 13)) * cell + cell / 2;
          x.beginPath(); x.moveTo(px, py);
          const steps = 2 + (Math.random() * 4 | 0);
          for (let s = 0; s < steps; s++) { const len = cell * (1 + (Math.random() * 2 | 0)); if (Math.random() < 0.5) px += (Math.random() < 0.5 ? -len : len); else py += (Math.random() < 0.5 ? -len : len); x.lineTo(px, py); }
          x.stroke(); x.beginPath(); x.arc(px, py, 5, 0, 6.2832); x.fill();
        }
        for (let i = 0; i < 45; i++) { x.beginPath(); x.arc(Math.random() * 512, Math.random() * 512, 3.5, 0, 6.2832); x.fill(); }
        const t = new THREE.CanvasTexture(cv); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
      })();

      const byId = new Map(tree.nodes.map((n) => [n.id, n]));
      const childrenOf = new Map<string, RawNode[]>(); tree.nodes.forEach((n) => childrenOf.set(n.id, []));
      const parentOf = new Map<string, string>();
      for (const l of tree.links) { childrenOf.get(l.source)?.push(byId.get(l.target)!); parentOf.set(l.target, l.source); }
      childrenOf.forEach((a) => a.sort((x, y) => y.n_chunks - x.n_chunks));
      const pathTo = (id: string): string[] => { const p: string[] = []; let c: string | undefined = id; while (c) { p.unshift(c); c = parentOf.get(c); } return p; };
      const baseR = (n: RawNode) => Math.max(3, 3 + Math.sqrt(n.n_chunks) * 0.22);

      const W = mount.clientWidth, H = mount.clientHeight;
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#04060f');
      const camera = new THREE.PerspectiveCamera(58, W / H, 0.1, 6000); camera.position.set(0, 16, 200);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); mount.appendChild(renderer.domElement);
      const composer = new EffectComposer(renderer); composer.setSize(W, H); composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      composer.addPass(new RenderPass(scene, camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.55, 0.5, 0.34); composer.addPass(bloom);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 55; controls.maxDistance = 520;
      controls.autoRotate = true; controls.autoRotateSpeed = 0.16;
      const cubeRT = new THREE.WebGLCubeRenderTarget(256, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      const cubeCam = new THREE.CubeCamera(1, 4000, cubeRT); scene.add(cubeCam);

      const sphere = new THREE.SphereGeometry(1, 48, 36);
      type Tgt = { node: RawNode; tPos: import('three').Vector3; tScale: number; tOpac: number; curScale: number; role: string; u: Record<string, { value: unknown }> };
      const meshes = new Map<string, import('three').Mesh>();
      const mkUniforms = (col: string) => ({
        uTime: { value: 0 }, uBranchColor: { value: new THREE.Color(col) }, uAccentColor: { value: new THREE.Color(col) },
        uLevel: { value: 1 }, uCoherence: { value: 0.8 }, uFocus: { value: 0 },
        uCodeTex: { value: atlas }, uCodeScale: { value: 3.2 }, uCodeSpeed: { value: 0.013 }, uCodeOpacity: { value: 0.32 },
        uCircuitTex: { value: circuitTex }, uCircuitScale: { value: 1.5 },
        uEnvMap: { value: cubeRT.texture }, uEnvIntensity: { value: 2.6 },
        uCircuitOpacity: { value: 0.16 }, uRimPower: { value: 2.5 }, uRimIntensity: { value: 0.95 },
        uPulseIntensity: { value: 0.12 }, uNoiseAmount: { value: 0.03 }, uAlpha: { value: 0 },
      });
      for (const n of tree.nodes) {
        const u = mkUniforms(colorOf(n.root));
        const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, transparent: true, depthWrite: true });
        const m = new THREE.Mesh(sphere, mat); m.visible = false; m.scale.setScalar(0.001);
        m.userData = { node: n, tPos: V(0, 0, 0), tScale: 0.001, tOpac: 0, curScale: 0.001, role: 'hidden', u } as Tgt;
        meshes.set(n.id, m); scene.add(m);
      }

      // soft sprite halo for the focus sun (no shell -> no ring artifact)
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(C.cyan), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      glow.scale.setScalar(0.001); scene.add(glow);

      // holographic chamber (toward Mikael's refs): matrix-rain backdrop + particle dust + tech-grid floor
      const rainMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uCodeTex: { value: atlas } }, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending });
      const rainSphere = new THREE.Mesh(new THREE.SphereGeometry(720, 40, 28), rainMat); scene.add(rainSphere);
      const pcount = 600; const parr = new Float32Array(pcount * 3); const pcol = new Float32Array(pcount * 3);
      const pPal = [new THREE.Color('#b06bff'), new THREE.Color('#c79bff'), new THREE.Color('#7fe8ff'), new THREE.Color('#ff9ec4'), new THREE.Color('#9ab8ff')];
      for (let i = 0; i < pcount; i++) { parr[i * 3] = (Math.random() - 0.5) * 820; parr[i * 3 + 1] = (Math.random() - 0.5) * 520; parr[i * 3 + 2] = (Math.random() - 0.5) * 820; const c = pPal[(Math.random() * pPal.length) | 0]; pcol[i * 3] = c.r; pcol[i * 3 + 1] = c.g; pcol[i * 3 + 2] = c.b; }
      const pgeo = new THREE.BufferGeometry(); pgeo.setAttribute('position', new THREE.Float32BufferAttribute(parr, 3)); pgeo.setAttribute('color', new THREE.Float32BufferAttribute(pcol, 3));
      const points = new THREE.Points(pgeo, new THREE.PointsMaterial({ vertexColors: true, size: 4.5, map: glowTex, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
      scene.add(points);
      const reflector = new Reflector(new THREE.PlaneGeometry(2200, 2200), { color: 0x16242f, textureWidth: 1024, textureHeight: 1024, clipBias: 0.003 });
      reflector.rotation.x = -Math.PI / 2; reflector.position.y = -118; scene.add(reflector);
      const grid = new THREE.GridHelper(1600, 52, new THREE.Color('#5fd0ff'), new THREE.Color('#2e6f9a')); grid.position.y = -117; const gmat = grid.material as import('three').Material; gmat.transparent = true; gmat.opacity = 0.5; scene.add(grid);
      const fdN = 240; const fdPos = new Float32Array(fdN * 3); const fdCol = new Float32Array(fdN * 3);
      const fdPal = [new THREE.Color('#39e7ff'), new THREE.Color('#ff5fd2'), new THREE.Color('#b06bff'), new THREE.Color('#5fa8ff'), new THREE.Color('#ff9ec4')];
      for (let i = 0; i < fdN; i++) { const a = Math.random() * Math.PI * 2; const rr = 60 + Math.random() * 720; fdPos[i * 3] = Math.cos(a) * rr; fdPos[i * 3 + 1] = -116 + Math.random() * 3; fdPos[i * 3 + 2] = Math.sin(a) * rr; const c = fdPal[(Math.random() * fdPal.length) | 0]; fdCol[i * 3] = c.r; fdCol[i * 3 + 1] = c.g; fdCol[i * 3 + 2] = c.b; }
      const fdGeo = new THREE.BufferGeometry(); fdGeo.setAttribute('position', new THREE.Float32BufferAttribute(fdPos, 3)); fdGeo.setAttribute('color', new THREE.Float32BufferAttribute(fdCol, 3));
      const floorDots = new THREE.Points(fdGeo, new THREE.PointsMaterial({ vertexColors: true, size: 8, map: glowTex, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
      scene.add(floorDots);

      // octagonal violet PORTAL behind the focus (billboarded each frame)
      const octPts: import('three').Vector3[] = [];
      for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; octPts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0)); }
      const octGeo = new THREE.BufferGeometry().setFromPoints(octPts);
      const portalOuter = new THREE.Line(octGeo, new THREE.LineBasicMaterial({ color: new THREE.Color('#a657ff'), transparent: true, opacity: 0.9 }));
      const portalInner = new THREE.Line(octGeo, new THREE.LineBasicMaterial({ color: new THREE.Color('#e6d2ff'), transparent: true, opacity: 0.85 })); portalInner.scale.setScalar(0.9);
      const portalDisc = new THREE.Mesh(new THREE.CircleGeometry(0.96, 8, Math.PI / 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#2a1556'), transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
      const portal = new THREE.Group(); portal.add(portalDisc); portal.add(portalOuter); portal.add(portalInner); scene.add(portal);

      // focused VIOLET rain column pouring onto the core
      const colMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uCodeTex: { value: atlas } }, vertexShader: RAIN_VERT, fragmentShader: COL_FRAG, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
      const rainCol = new THREE.Mesh(new THREE.PlaneGeometry(64, 300), colMat); rainCol.position.set(0, 150, 0); scene.add(rainCol);

      const rays = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(291 * 6), 3)), new THREE.LineBasicMaterial({ color: 0x8fe6ff, transparent: true, opacity: 0.12 })); scene.add(rays);
      const spineGeom = new THREE.BufferGeometry(); spineGeom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(40 * 3), 3));
      const spine = new THREE.Line(spineGeom, new THREE.LineBasicMaterial({ color: 0xa9ddff, transparent: true, opacity: 0.4 })); scene.add(spine);
      const pulseDot = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(C.cyan), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 })); pulseDot.scale.setScalar(7); pulseDot.visible = false; scene.add(pulseDot);

      const focusRef = { current: 'ROOT' }; let spineIds: string[] = []; let childIds: string[] = [];

      const applyPreset = (u: Record<string, { value: unknown }>, p: Preset, coh: number, isFocus: boolean, col: string) => {
        u.uLevel.value = p.lvl; u.uFocus.value = isFocus ? 1 : 0; u.uCoherence.value = coh;
        u.uAccentColor.value = new THREE.Color(isFocus ? C.cyan : col);
        u.uCodeScale.value = p.codeScale; u.uRimPower.value = p.rimPower;
        u.uCodeOpacity.value = p.codeOpacity * lerp(0.7, 1.15, coh);
        u.uCircuitOpacity.value = p.circuit * lerp(0.6, 1.0, coh);
        u.uRimIntensity.value = p.rim * lerp(0.8, 1.18, coh);
        u.uNoiseAmount.value = p.noise * lerp(1.8, 0.45, coh);
        u.uPulseIntensity.value = p.pulse * lerp(1.4, 0.8, coh);
        u.uCodeSpeed.value = p.codeSpeed * lerp(1.8, 0.85, coh);
      };
      const setTarget = (id: string, pos: import('three').Vector3, scale: number, opac: number, role: string, preset: Preset, emerge: boolean) => {
        const m = meshes.get(id); if (!m) return; const t = m.userData as Tgt; const n = t.node; const coh = n.coherence ?? 0.6;
        if (!m.visible) { m.visible = true; if (emerge) { m.position.set(0, 0, 0); t.curScale = 0.001; m.scale.setScalar(0.001); t.u.uAlpha.value = 0; } }
        t.tPos = pos; t.tScale = scale; t.tOpac = opac; t.role = role;
        applyPreset(t.u, preset, coh, role === 'center', colorOf(n.root));
      };

      const applyView = (focusId: string) => {
        const focus = byId.get(focusId); if (!focus) return; focusRef.current = focusId;
        const kids = childrenOf.get(focusId) || []; const path = pathTo(focusId);
        const anc = path.slice(0, -1).reverse(); const parent = parentOf.get(focusId);
        const sibs = (parent ? childrenOf.get(parent) || [] : []).filter((s) => s.id !== focusId);
        meshes.forEach((m) => { const t = m.userData as Tgt; t.role = 'hidden'; t.tOpac = 0; t.tScale = 0.001; });
        setTarget(focusId, V(0, 0, 0), baseR(focus) * 1.5, 1, 'center', SUN, false);
        const coreR0 = baseR(focus) * 1.5;
        const cp = shell(kids.length, Math.max(coreR0 * 2.4 + 20, 58) + Math.min(kids.length, 40) * 1.3);
        kids.forEach((k, i) => setTarget(k.id, V(cp[i][0], cp[i][1], cp[i][2]), baseR(k), 1, 'child', PLANET, true));
        anc.forEach((aid, i) => { const a = byId.get(aid)!; setTarget(aid, V(0, 56 + i * 22, -18 - i * 17), Math.max(2.4, baseR(a) * 0.5), Math.max(0.2, 0.8 - i * 0.14), 'spine', MOON, false); });
        const gp = shell(sibs.length, 200);
        sibs.forEach((s, i) => setTarget(s.id, V(gp[i][0], gp[i][1] * 0.35, gp[i][2]), Math.max(2, baseR(s) * 0.5), 0.14, 'ghost', MOON, false));
        spineIds = [focusId, ...anc]; childIds = kids.map((k) => k.id);
        setView({ focusId, path: path.map((id) => ({ id, name: byId.get(id)!.name })), focus, childCount: kids.length });
        try { const u = new URL(window.location.href); if (focusId === 'ROOT') u.searchParams.delete('focus'); else u.searchParams.set('focus', focusId); window.history.replaceState(null, '', u.toString()); } catch { /* url sync skipped */ }
      };
      goToRef.current = applyView;

      const layer = labelRef.current!; const pool = new Map<string, HTMLDivElement>();
      const ensure = (id: string): HTMLDivElement => { let d = pool.get(id); if (!d) { d = document.createElement('div'); d.className = 'ol-plaque'; d.style.position = 'absolute'; layer.appendChild(d); pool.set(id, d); } return d; };
      const projV = new THREE.Vector3();
      const updateLabels = () => {
        const active = new Set<string>();
        meshes.forEach((m, id) => {
          const t = m.userData as Tgt; const op = t.u.uAlpha.value as number;
          const show = (t.role === 'center' || t.role === 'child' || t.role === 'spine') && op > 0.33;
          if (!show) return; active.add(id);
          projV.copy(m.position); projV.project(camera); if (projV.z > 1) return;
          const x = (projV.x * 0.5 + 0.5) * W, y = (-projV.y * 0.5 + 0.5) * H;
          const n = t.node; const isC = t.role === 'center'; const isS = t.role === 'spine'; const isHov = id === hoverId; const col = colorOf(n.root);
          const d = ensure(id); d.style.setProperty('--branch', col);
          d.className = 'ol-plaque' + (isC ? ' ol-focus' : isS ? ' ol-spine' : '') + (isHov && !isC ? ' ol-hover' : '');
          const meta = isC ? `${n.n_chunks.toLocaleString()} CHUNKS${n.coherence != null ? ` · COH ${n.coherence}` : ''}` : (isS ? '' : `${n.n_chunks.toLocaleString()}${n.coherence != null ? ` · ${n.coherence}` : ''}`);
          d.innerHTML = `<div class="ol-t">${isC ? '◈ ' : ''}${n.name}</div>${meta ? `<div class="ol-m">${meta}</div>` : ''}`;
          const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion); let labelY = y - (isC ? 30 : 16); if (isC) { const top = m.position.clone().addScaledVector(upv, t.curScale * 1.18); top.project(camera); labelY = (-top.y * 0.5 + 0.5) * H - 16; } d.style.left = x + 'px'; d.style.top = labelY + 'px'; d.style.opacity = String(Math.min(1, op));
          d.style.display = 'block';
        });
        pool.forEach((d, id) => { if (!active.has(id)) d.style.display = 'none'; });
      };

      const raycaster = new THREE.Raycaster(); const ptr = new THREE.Vector2(); let hoverId: string | null = null;
      const pick = (ev: MouseEvent): import('three').Mesh | null => {
        const r = renderer.domElement.getBoundingClientRect(); ptr.x = ((ev.clientX - r.left) / r.width) * 2 - 1; ptr.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
        raycaster.setFromCamera(ptr, camera);
        const vis = [...meshes.values()].filter((m) => m.visible && ((m.userData as Tgt).u.uAlpha.value as number) > 0.12);
        return (raycaster.intersectObjects(vis, false)[0]?.object as import('three').Mesh) || null;
      };
      const onMove = (ev: PointerEvent) => { const m = pick(ev); const id = m ? (m.userData as Tgt).node.id : null; if (id !== hoverId) { hoverId = id; renderer.domElement.style.cursor = id && id !== focusRef.current ? 'pointer' : 'grab'; } };
      const onClick = (ev: MouseEvent) => { const m = pick(ev); if (!m) return; const t = m.userData as Tgt; if (t.role === 'child' || t.role === 'ghost' || t.role === 'spine') applyView(t.node.id); };
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Backspace' || e.key === 'Escape') { const p = parentOf.get(focusRef.current); if (p) applyView(p); } };
      renderer.domElement.addEventListener('pointermove', onMove); renderer.domElement.addEventListener('click', onClick); window.addEventListener('keydown', onKey);
      const onResize = () => { const w = mount.clientWidth, h = mount.clientHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(w, h); };
      window.addEventListener('resize', onResize);

      const initialFocus = (() => { try { const f = new URL(window.location.href).searchParams.get('focus'); return f && byId.has(f) ? f : 'ROOT'; } catch { return 'ROOT'; } })();
      applyView(initialFocus);
      const clock = new THREE.Clock(); let envFrame = 0;
      const animate = () => {
        raf = requestAnimationFrame(animate); const tt = clock.getElapsedTime();
        if ((envFrame++ % 3) === 0) { try {
          const efm = meshes.get(focusRef.current);
          if (efm) cubeCam.position.copy(efm.position);
          const visSnap: boolean[] = []; let vi = 0; meshes.forEach((m) => { visSnap[vi++] = m.visible; m.visible = false; });
          const gWasV = glow.visible; glow.visible = false; const rWasV = reflector.visible; reflector.visible = false;
          cubeCam.update(renderer, scene);
          vi = 0; meshes.forEach((m) => { m.visible = visSnap[vi++]; }); glow.visible = gWasV; reflector.visible = rWasV;
        } catch { /* env update skipped */ } }
        meshes.forEach((m) => {
          const t = m.userData as Tgt; const u = t.u; m.position.lerp(t.tPos, 0.16);
          const hov = (m.userData as Tgt).node.id === hoverId ? 1.13 : 1.0;
          t.curScale += (t.tScale * hov - t.curScale) * 0.16; m.scale.setScalar(t.curScale);
          u.uAlpha.value = (u.uAlpha.value as number) + ((t.tOpac as number) - (u.uAlpha.value as number)) * 0.16; u.uTime.value = tt;
          if (t.role === 'hidden' && (u.uAlpha.value as number) < 0.02) m.visible = false;
        });
        const fm = meshes.get(focusRef.current);
        if (fm) { const ft = fm.userData as Tgt; glow.position.copy(fm.position); glow.scale.setScalar(Math.max(8, ft.curScale * 2.6)); (glow.material as import('three').SpriteMaterial).color.set(colorOf(ft.node.root)); const gm = glow.material as import('three').SpriteMaterial; gm.opacity = gm.opacity + (0.3 - gm.opacity) * 0.12; }
        rainMat.uniforms.uTime.value = tt; points.rotation.y += 0.0004;
        const rp = rays.geometry.attributes.position.array as Float32Array; let k = 0; const ctr = meshes.get(focusRef.current);
        if (ctr) for (const cid of childIds) { const cm = meshes.get(cid); if (!cm) continue; rp[k++] = ctr.position.x; rp[k++] = ctr.position.y; rp[k++] = ctr.position.z; rp[k++] = cm.position.x; rp[k++] = cm.position.y; rp[k++] = cm.position.z; }
        rays.geometry.setDrawRange(0, childIds.length * 2); rays.geometry.attributes.position.needsUpdate = true;
        const sp = spineGeom.attributes.position.array as Float32Array; let j = 0; const spinePts: import('three').Vector3[] = [];
        for (const sid of spineIds) { const sm = meshes.get(sid); if (!sm) continue; sp[j++] = sm.position.x; sp[j++] = sm.position.y; sp[j++] = sm.position.z; spinePts.push(sm.position.clone()); }
        spineGeom.setDrawRange(0, spineIds.length); spineGeom.attributes.position.needsUpdate = true;
        if (spinePts.length >= 2) { pulseDot.visible = true; const frac = (tt * 0.25) % 1; const seg = (spinePts.length - 1) * (1 - frac); const i0 = Math.min(spinePts.length - 2, Math.floor(seg)); const f = seg - i0; pulseDot.position.lerpVectors(spinePts[i0], spinePts[i0 + 1], f); } else pulseDot.visible = false;
        colMat.uniforms.uTime.value = tt;
        rainCol.rotation.y = Math.atan2(camera.position.x - rainCol.position.x, camera.position.z - rainCol.position.z);
        { const ffm = meshes.get(focusRef.current); if (ffm) { const ft2 = ffm.userData as Tgt; const camDir = new THREE.Vector3().subVectors(ffm.position, camera.position).normalize(); portal.position.copy(ffm.position).addScaledVector(camDir, Math.max(8, ft2.curScale * 1.4)); portal.quaternion.copy(camera.quaternion); portal.scale.setScalar(Math.max(16, ft2.curScale * 2.9)); } }
        controls.update(); updateLabels(); composer.render();
      };
      animate();

      cleanup = () => {
        cancelAnimationFrame(raf);
        renderer.domElement.removeEventListener('pointermove', onMove); renderer.domElement.removeEventListener('click', onClick);
        window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize);
        pool.forEach((d) => d.remove());
        controls.dispose(); sphere.dispose(); atlas.dispose(); glowTex.dispose(); circuitTex.dispose(); rays.geometry.dispose(); spineGeom.dispose(); rainSphere.geometry.dispose(); rainMat.dispose(); pgeo.dispose(); (points.material as import('three').Material).dispose(); grid.geometry.dispose(); (grid.material as import('three').Material).dispose(); reflector.getRenderTarget().dispose(); reflector.geometry.dispose(); (reflector.material as import('three').Material).dispose(); cubeRT.dispose(); fdGeo.dispose(); (floorDots.material as import('three').Material).dispose();
        meshes.forEach((m) => (m.material as import('three').Material).dispose()); (glow.material as import('three').Material).dispose(); (pulseDot.material as import('three').Material).dispose();
        composer.dispose?.(); octGeo.dispose(); (portalOuter.material as import('three').Material).dispose(); (portalInner.material as import('three').Material).dispose(); portalDisc.geometry.dispose(); (portalDisc.material as import('three').Material).dispose(); rainCol.geometry.dispose(); colMat.dispose();
        renderer.dispose(); if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      };
    })();
    return () => { disposed = true; cleanup(); };
  }, [tree]);

  useEffect(() => {
    const f = view.focus;
    if (!f || !f.is_leaf) { setLeaf(null); setOpenChunk(null); return; }
    let cancelled = false;
    setLeaf({ path: view.focusId, total: f.n_chunks, chunks: [], loading: true });
    (async () => {
      try {
        const r = await fetch(`/api/codex?op=leaf&path=${encodeURIComponent(view.focusId)}&k=24`);
        const j = await r.json();
        if (!cancelled) setLeaf({ path: view.focusId, total: j.total ?? 0, chunks: (j.chunks || []) as ChunkCard[], loading: false });
      } catch { if (!cancelled) setLeaf({ path: view.focusId, total: f.n_chunks, chunks: [], loading: false }); }
    })();
    return () => { cancelled = true; };
  }, [view.focusId, view.focus]);

  const openCard = async (address: string, title: string) => {
    setOpenChunk({ address, title, content: 'Loading\u2026' });
    try {
      const r = await fetch(`/api/codex?op=node&address=${encodeURIComponent(address)}`);
      const j = await r.json();
      setOpenChunk({ address, title, content: (j.content as string) || (j.snippet as string) || '(no content)' });
    } catch { setOpenChunk({ address, title, content: '(failed to load)' }); }
  };

  const copyLink = () => { try { navigator.clipboard.writeText(window.location.href); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); } catch { /* clipboard blocked */ } };
  const srcFile = (a: string) => { const i = a.indexOf('#'); return i > 0 ? a.slice(0, i) : a; };
  const chunkRef = (a: string) => { const i = a.indexOf('#'); return i >= 0 ? a.slice(i + 1) : a; };

  const parentId = view.path.length >= 2 ? view.path[view.path.length - 2].id : null;
  const cohColor = view.focus?.coherence == null ? C.cyan : view.focus.coherence >= 0.78 ? C.green : view.focus.coherence >= 0.6 ? C.gold : C.magenta;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: 'radial-gradient(ellipse at 50% 46%, #081224 0%, #050b18 60%, #02050c 100%)', color: C.text, overflow: 'hidden' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@300;400;600&display=swap');
        .ol-grid{position:absolute;inset:0;pointer-events:none;z-index:0;opacity:.6;background-image:repeating-linear-gradient(45deg,transparent,transparent 6px,rgba(111,242,255,.012) 6px,rgba(111,242,255,.012) 8px);animation:olflow 60s linear infinite}
        @keyframes olflow{to{background-position:40px 40px}}
        .ol-scan{position:absolute;inset:0;pointer-events:none;z-index:2;opacity:.5;background:repeating-linear-gradient(0deg,rgba(120,230,255,.03) 0px,rgba(120,230,255,.03) 1px,transparent 1px,transparent 3px)}
        .ol-frame{position:absolute;inset:12px;pointer-events:none;z-index:2;border:2px solid rgba(150,110,235,.6);border-radius:10px;box-shadow:inset 0 0 80px rgba(140,110,230,.16),inset 0 0 6px rgba(200,170,255,.4),0 0 46px rgba(150,90,255,.3),0 0 16px rgba(150,120,255,.3)}
        .ol-frame::before,.ol-frame::after{content:'';position:absolute;width:54px;height:54px;border-color:rgba(199,140,255,.95);border-style:solid;filter:drop-shadow(0 0 9px rgba(199,140,255,.7))}
        .ol-frame::before{top:-2px;left:-2px;border-width:3px 0 0 3px;border-top-left-radius:8px}
        .ol-frame::after{bottom:-2px;right:-2px;border-width:0 3px 3px 0;border-bottom-right-radius:8px}
        .ol-plaque{transform:translate(-50%,-100%);pointer-events:none;white-space:nowrap;background:linear-gradient(90deg,color-mix(in srgb,var(--branch) 18%,transparent),transparent),rgba(4,12,24,.42);border:1px solid rgba(111,242,255,.22);border-left:2px solid color-mix(in srgb,var(--branch) 85%,transparent);box-shadow:0 0 14px color-mix(in srgb,var(--branch) 22%,transparent),inset 0 0 18px rgba(111,242,255,.04);backdrop-filter:blur(6px);padding:5px 9px;border-radius:3px}
        .ol-plaque .ol-t{font-family:${ORBITRON};font-size:11.5px;letter-spacing:.13em;text-transform:uppercase;color:#eafbff;text-shadow:0 0 9px color-mix(in srgb,var(--branch) 60%,transparent)}
        .ol-plaque .ol-m{margin-top:3px;font-family:${RAJDHANI};font-size:11px;letter-spacing:.04em;color:rgba(190,238,250,.78)}
        .ol-focus{padding:9px 12px;border-color:rgba(111,242,255,.4)}
        .ol-focus .ol-t{font-size:17px;color:#fbffff}
        .ol-spine{padding:3px 7px;opacity:.85}.ol-spine .ol-t{font-size:9.5px;color:#cdeaff}
        .ol-plaque.ol-hover{transform:translate(-50%,-100%) scale(1.09);border-color:rgba(207,233,255,.85);box-shadow:0 0 22px color-mix(in srgb,var(--branch) 55%,transparent),inset 0 0 18px rgba(111,242,255,.06)}
        .ol-readpanel{position:absolute;top:58px;right:14px;bottom:58px;width:360px;max-width:42vw;z-index:4;display:flex;flex-direction:column;background:linear-gradient(160deg,rgba(10,18,34,.74),rgba(4,9,20,.68));border:1px solid rgba(120,160,255,.22);border-radius:8px;box-shadow:0 0 30px rgba(80,60,160,.2),inset 0 0 40px rgba(80,120,200,.05);backdrop-filter:blur(12px);overflow:hidden}
        .ol-readhead{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid rgba(120,160,255,.18);flex:0 0 auto}
        .ol-readlist{overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:7px}
        .ol-readlist::-webkit-scrollbar{width:7px}.ol-readlist::-webkit-scrollbar-thumb{background:rgba(120,160,255,.25);border-radius:4px}
        .ol-card{cursor:pointer;padding:9px 11px;border-radius:5px;background:rgba(120,160,255,.05);border:1px solid rgba(120,160,255,.14);border-left:2px solid rgba(150,120,255,.5);transition:background .15s,border-color .15s,box-shadow .15s}
        .ol-card:hover{background:rgba(120,160,255,.1);border-left-color:#6ff2ff;box-shadow:0 0 14px rgba(111,242,255,.12)}
        .ol-card-h{display:flex;gap:7px;align-items:baseline;margin-bottom:4px}
        .ol-card-src{flex:0 0 auto;font-family:${ORBITRON};font-size:8px;letter-spacing:1px;text-transform:uppercase;color:#b89cff;border:1px solid rgba(184,156,255,.35);border-radius:3px;padding:1px 5px}
        .ol-card-title{font-family:${ORBITRON};font-size:9.5px;font-weight:500;letter-spacing:.3px;color:#8fcfe8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:lowercase}
        .ol-card-snip{font-family:${RAJDHANI};font-size:12.5px;line-height:1.5;color:rgba(206,232,248,.85);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;margin-top:2px}
        .ol-card-meta{margin-top:5px;font-family:${ORBITRON};font-size:8px;letter-spacing:.5px;color:rgba(150,200,230,.4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ol-modal{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;background:rgba(2,5,12,.72);backdrop-filter:blur(3px)}
        .ol-modal-box{width:min(760px,86vw);max-height:80vh;display:flex;flex-direction:column;background:linear-gradient(160deg,rgba(12,20,38,.97),rgba(5,10,22,.97));border:1px solid rgba(120,160,255,.3);border-radius:10px;box-shadow:0 0 60px rgba(90,70,180,.35);padding:16px 18px}
        .ol-modal-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-bottom:10px;border-bottom:1px solid rgba(120,160,255,.2);margin-bottom:10px}
        .ol-modal-body{overflow-y:auto;font-family:${RAJDHANI};font-size:13.5px;line-height:1.6;color:rgba(220,245,255,.9);white-space:pre-wrap;word-break:break-word}
        .ol-modal-body::-webkit-scrollbar{width:8px}.ol-modal-body::-webkit-scrollbar-thumb{background:rgba(120,160,255,.3);border-radius:4px}
      `}} />
      <div className="ol-grid" />
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
      <div className="ol-scan" />
      <div className="ol-frame" />
      <div ref={labelRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }} />

      <div style={{ position: 'absolute', top: 16, left: 0, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', zIndex: 4, maxWidth: '62vw', padding: '8px 14px', background: 'linear-gradient(90deg,rgba(4,12,24,.55),rgba(4,12,24,.1))', borderLeft: `1px solid ${C.cyan}66`, backdropFilter: 'blur(8px)' }}>
        <span style={{ color: C.cyan, fontFamily: ORBITRON, fontSize: 11, opacity: 0.85 }}>◈</span>
        {view.path.map((c, i) => (
          <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            {i > 0 && <span style={{ color: `${C.cyan}66`, fontSize: 10 }}>/</span>}
            <span onClick={() => goToRef.current(c.id)} style={{ cursor: 'pointer', fontFamily: ORBITRON, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: i === view.path.length - 1 ? C.cyan : 'rgba(170,225,245,0.55)', textShadow: i === view.path.length - 1 ? `0 0 10px ${C.cyan}` : 'none' }}>{c.name}</span>
          </span>
        ))}
      </div>

      <div style={{ position: 'absolute', top: 14, right: 18, display: 'flex', alignItems: 'center', gap: 10, zIndex: 4 }}>
        <span style={{ fontFamily: ORBITRON, fontSize: 11, letterSpacing: 3, color: C.cyan, textShadow: `0 0 12px ${C.cyan}88` }}>◈ GOLDEN ORRERY</span>
        <a href="/codex" style={{ fontFamily: ORBITRON, fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', color: C.cyan, border: `1px solid ${C.cyan}55`, borderRadius: 3, padding: '5px 10px', textDecoration: 'none' }}>◇ codex</a>
      </div>

      {view.focus && (
        <div style={{ position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', maxWidth: '60vw', display: 'flex', gap: 18, alignItems: 'center', zIndex: 4, padding: '9px 18px', borderRadius: 4, background: 'linear-gradient(135deg,rgba(111,242,255,.04) 25%,transparent 25%) 0 0/18px 18px, rgba(4,12,24,.55)', border: `1px solid ${C.cyan}33`, borderTop: `1px solid ${C.cyan}66`, boxShadow: `0 0 18px ${C.cyan}18, inset 0 0 28px ${C.cyan}0a`, backdropFilter: 'blur(10px)', fontFamily: RAJDHANI, fontSize: 13 }}>
          <span style={{ fontFamily: ORBITRON, fontSize: 9, letterSpacing: 2, color: C.cyan }}>◈ {view.focusId === 'ROOT' ? 'CORE' : (view.focus.is_leaf ? 'LEAF' : 'NODE')}</span>
          <span style={{ color: C.text }}>{view.childCount} <span style={{ color: C.textDim }}>{view.focus.is_leaf ? 'leaves' : view.focusId === 'ROOT' ? 'branches' : 'subjects'}</span></span>
          <span style={{ color: C.text }}>{view.focus.n_chunks.toLocaleString()} <span style={{ color: C.textDim }}>chunks</span></span>
          {view.focus.coherence != null && <span style={{ color: C.textDim }}>coherence <span style={{ color: cohColor }}>{view.focus.coherence}</span></span>}
          {parentId && <span onClick={() => goToRef.current(parentId)} style={{ cursor: 'pointer', color: C.cyan, fontFamily: ORBITRON, fontSize: 10, letterSpacing: 1 }}>↩ BACK</span>}
          <span onClick={copyLink} style={{ cursor: 'pointer', color: linkCopied ? C.green : C.cyan, fontFamily: ORBITRON, fontSize: 10, letterSpacing: 1 }}>{linkCopied ? '✓ COPIED' : '⧉ LINK'}</span>
        </div>
      )}

      <div style={{ position: 'absolute', bottom: 20, left: 18, color: C.textDim, fontSize: 10, fontFamily: ORBITRON, letterSpacing: 1, zIndex: 4, opacity: 0.6 }}>click to enter · backspace to ascend · drag to orbit</div>

      {err && <div style={{ position: 'absolute', top: 64, left: 18, background: 'rgba(4,12,24,.9)', border: `1px solid ${C.gold}`, borderRadius: 6, padding: '12px 14px', color: C.gold, fontSize: 12, maxWidth: 480, zIndex: 5, fontFamily: RAJDHANI }}>tree load error: {err}</div>}

      {leaf && (
        <div className="ol-readpanel">
          <div className="ol-readhead">
            <span style={{ fontFamily: ORBITRON, fontSize: 12, letterSpacing: '0.12em', color: C.cyan, textShadow: `0 0 10px ${C.cyan}88`, textTransform: 'uppercase' }}>◈ {view.focus?.name}</span>
            <span style={{ fontFamily: RAJDHANI, fontSize: 11, color: C.textDim }}>{leaf.loading ? 'loading…' : `${leaf.chunks.length} of ${leaf.total.toLocaleString()}`}</span>
          </div>
          <div className="ol-readlist">
            {leaf.loading && <div style={{ color: C.textDim, fontFamily: RAJDHANI, fontSize: 12, padding: '12px 4px' }}>reading the archive…</div>}
            {!leaf.loading && leaf.chunks.length === 0 && <div style={{ color: C.textDim, fontFamily: RAJDHANI, fontSize: 12, padding: '12px 4px' }}>no readable chunks at this leaf.</div>}
            {leaf.chunks.map((c) => (
              <div key={c.address} className="ol-card" onClick={() => openCard(c.address, srcFile(c.address))}>
                <div className="ol-card-h">
                  <span className="ol-card-src">{c.source_type || '—'}</span>
                  <span className="ol-card-title">{srcFile(c.address)}{c.subject ? ` · ${c.subject}` : ''}</span>
                </div>
                <div className="ol-card-snip">{c.snippet}</div>
                <div className="ol-card-meta">{chunkRef(c.address)}{c.chars != null ? ` · ${c.chars.toLocaleString()} chars` : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {openChunk && (
        <div className="ol-modal" onClick={() => setOpenChunk(null)}>
          <div className="ol-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="ol-modal-head">
              <span style={{ fontFamily: ORBITRON, fontSize: 12, letterSpacing: '0.08em', color: C.cyan }}>{openChunk.title}</span>
              <span onClick={() => setOpenChunk(null)} style={{ cursor: 'pointer', color: C.textDim, fontFamily: ORBITRON, fontSize: 15, lineHeight: 1 }}>✕</span>
            </div>
            <div className="ol-modal-body">{openChunk.content}</div>
            <div style={{ fontFamily: ORBITRON, fontSize: 9, color: C.textDim, letterSpacing: 1, marginTop: 10 }}>{openChunk.address}</div>
          </div>
        </div>
      )}
    </div>
  );
}
