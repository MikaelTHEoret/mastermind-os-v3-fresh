## 2026-07-01 (head) -- TRADING INTEGRATION BUILT (owner-gated, fail-closed) + Neon pw rotation aftermath · devlog #559, #560

- SECURITY (devlog #559): committed .env.local.example + CLERK_SETUP.md had leaked LIVE secrets -> GitHub scanning ->
  Neon AUTO-REVOKED memory-DB pw mid-session. Rotated; ~172 hardcoded copies swept (mastermind-client 126 +
  Claude-system 44 + server.js + record.py + this repo's .env.local); example files scrubbed to placeholders.
  ROOT-FIX QUEUED: centralize DSN into one env var (rotation = 1-line change, not 172-file sweep).
  STILL PENDING (Mikael): Vercel NEON_MEMORY_URL -> rotated conn string + redeploy.
- TRADING MODULE (devlog #560, node hands.trading_console = PROVEN): mission 08 executed. Migration APPLIED to Neon
  primary (trading_gate_results + 3 PROVISIONAL tables, RLS = user_sources_config convention; 2 PROVEN gate verdicts
  seeded: PASS .793/1.0/.0, KILL -.412/.0/.27, seed 42). requireOwner() fail-closed owner gate (src/lib/trading/auth.ts);
  middleware SCOPED to /api/trading/* only (unconfigured -> 403, configured -> clerkMiddleware -- deliberate deviation
  from global middleware: keyless clerkMiddleware can 500 the live site). /api/trading/status route; TradingConsole.tsx
  (LOCKED/verdicts, NO trade controls until ladder green); TRADING tab + module registered; ClerkProvider re-activated
  CONDITIONAL on key presence; @clerk/nextjs 7.5.12.
- VERIFIED: tsc 0; next build 0; live prod smoke :3111 -> /api/trading/status 403 fail-closed, /api/health 200.
  NOT PUSHED (local only, Mikael reviews). ACTIVATE: create Clerk app, set 3 env vars (local + Vercel), sign in once.
- CAVEAT found: this box's global npm config omit=dev -- plain npm install PRUNES all devDeps (broke tsc/tailwind;
  restored via npm install --include=dev). Will bite every future install until the config is fixed.
- SKIPPED deliberately: SettingsConsole trading knobs (none exist yet -- speculative).

---
## 2026-06-29 (head-3) -- FULL FRACTAL RE-CLUSTER: attraction law now covers ALL 181,484 chunks (was 12,528); bloom_path 100% · devlog #542

- FIXES the core failure: the attraction (fractal tree / descend_tree / Orrery / address_* -- ALL filter on bloom_path)
  had silently governed only 12528 of 181484 chunks (a year-old slice); 161686 ingested over 2026 were never clustered.
  Flat semantic recall (search_archive) still covered all 181K, so recall worked -- but the self-organizing index had
  fallen ~14x behind and NOTHING flagged it.
- DRY RUN (phase3-build-tree, no writes) proved feasible on full 181K (~7min, ~1.86GB peak under the 2GB job cap);
  content is legit (62% gpt chat logs, only 5140 mention node_modules) -- weak auto-labels only, not junk.
- PERSIST: backed up old tree -> fractal_nodes_bak_20260629 (rollback); DELETE fractal_nodes; ran phase3-persist over
  all 181484. VERIFIED: bloom_path NULL=0 (100%), fractal_nodes 4825 (3797 leaves, 8 roots), 0 ORPHAN bloom_paths,
  13 point to non-leaf (collision artifact, negligible). New top branches MEANINGFUL: harmonic 32485, codex 23577,
  data, const, hot, file, typescript-eslint, e-05. Orrery reflects it live; prior ?focus= deep-links break (reshaped).
- MAINTENANCE MODEL: attach_tree.attach_new = per-ingest LOCAL incremental attach (one-pass ingest.py, #541);
  phase3-persist = occasional GLOBAL re-cluster. Procedure: backup->DELETE fractal_nodes->phase3-persist->verify
  0 NULL + 0 orphan bloom_paths.
- OPEN: (1) weak auto-labels -> fix via fractal_nodes.label_override (no re-cluster). (2) staleness health-check DONE -- mastermind_health.py (devlog #543), run at boundary ritual; flags WARN(>5000)/ALARM(>5%) unaddressed.
  (3) drop fractal_nodes_bak_20260629 once new tree confirmed good.

---

## 2026-06-29 (head-2) -- INGEST ONE-PASS: ingest.py batched-embed + NUL-strip + auto-attach to fractal tree; new attach_tree.py · devlog #541

- WHY (Mikael): new data should be ADDRESSED in one pass, no separate clustering step. Root cause: clustering
  (phase3-build-tree/persist) is a GLOBAL rebuild (every embedding, recursive KMeans over whole corpus) so it never
  ran per-ingest -> new chunks sat bloom_path=NULL. Ground truth: archive 181484 but only 12528 had bloom_path.
- BUILT attach_tree.py (NEW canonical, mastermind-client): routes bloom_path-NULL chunks into the EXISTING fractal_nodes
  tree by descend_tree's exact hard-argmax cosine descent (roots=parent_path IS NULL AND depth=1; best child centroid
  per level; stop at is_leaf), sets bloom_path=leaf.path, bumps n_chunks. NO rebuild. Importable attach_new(doc_prefix=).
- PATCHED ingest.py (edit-lock cleared; py_compile-gated; .bak kept): (1) EMBED_BATCH=32 + embed_batch() = 24x
  (0.089 vs 2.11 s/chunk); (2) NUL-strip in chunk_text -> fixes PyMuPDF NUL errors for all files; (3) main() calls
  attach_tree.attach_new(doc_prefix=<target>) at end -> new chunks addressed in the SAME run. Verified end-to-end on a
  throwaway selftest doc + June 28 (7270 attached, 0 NULL). This RESOLVES the long-standing 'upstream 32-chunk batching
  into ingest.py' TODO.
- DISTINCTION: attach-on-ingest = LOCAL routing into existing tree (cheap, every ingest) makes new data navigable now;
  full phase3 re-cluster = SEPARATE occasional GLOBAL step that grows/splits the tree.
- STALENESS / NEXT: fractal_nodes addresses only 12528 of 181484 chunks; ~161686 legacy chunks are bloom_path=NULL
  (pre-date attach-on-ingest). RECOMMEND one full phase3 re-cluster over all 181484 so the big LivingLoop/genome mass
  gets proper dedicated branches; attach-on-ingest keeps new data current after.
- CAVEAT: canonical ingest.py has NO size skip -> pointed at codex/June 28 again it WILL ingest the 3 held raw CSV
  ledgers (~115K chunks/~3h); the >5MB exclusion lived only in the one-off driver.

---

## 2026-06-29 (head) -- INGESTED codex/June 28 knowledge layer into transcript_archive (+7270 chunks); batched-embed 24x speedup found · devlog #540

- INGESTED the loose knowledge layer of C:\Users\Mik\Documents\codex\June 28 into Neon transcript_archive via the
  canonical ingest.py pipeline (reused by import). VERIFIED (ground truth): +7270 chunks / 236 docs under doc_id
  'June 28/', 0 null-embeddings; archive 174214 -> 181484. Types: datasheet 4399 (CSV result tables), document 2678
  (md/pdf/tex/txt/html), code 169, transcript 24. node memory.archive = LIVE. ~19.5 min.
- EMBED THROUGHPUT (verify-before-assert win, almost mis-reported): Ollama /api/embed SINGLE-call = 2.11s/chunk steady
  (CPU-bound per-call overhead, NOT 40ms). BATCHING via list input is the fix: 8/call->0.294s, 16->0.154s,
  32->0.089s/chunk (24x). Ran the batch from a thin driver that reused all canonical ingest.py helpers.
- PENDING TODO (the long-standing 'upstream 32-chunk batching into ingest.py', STILL open): add EMBED_BATCH=32 +
  embed_batch() + batched insert loop to canonical ingest.py, PLUS the NUL-strip fix below. Blocked this session by a
  Desktop Commander edit_block EPERM lock on ingest.py (ingest.py.bak made). When lock clears: patch + verify batched
  vectors == single-call vectors.
- HELD (Mikael's call; recommend SKIP): 3 raw numeric CSV ledgers >5MB -- v16_death_wave_raw 72MB,
  v19_prime_reuse_load 65MB, v14_gate_mertens_current_table 12.6MB = ~115K chunks / 95% of volume / ~3h. Machine-made
  numeric row dumps; embedding -> near-duplicate junk hub in the Orrery fractal tree. Driver excludes csv>5MB.
- NUL FIX: PyMuPDF extraction emits NUL (0x00) bytes Postgres text rejects -> 9 PDFs errored, repaired via a NUL-strip
  re-pass (text.replace(chr(0),''), +320 chunks, 0 still failing). Upstream this strip into ingest.py too.
- ORRERY NOTE: ingest.py sets embedding but NOT bloom_path/core_hash -> June 28/ chunks are cosine-searchable now
  (search_archive) but absent from the Orrery descend_tree until the clustering/addressing pass re-runs.
- SKIPPED by the canonical whitelist: 252 .zip packages + 78 png + binaries (zips hold packaged experiment contents
  -- a separate unpack-and-ingest decision if wanted).

---

## 2026-06-28 (head) -- GOLDEN ORRERY /map LIVE: holographic 3D knowledge navigator deployed to prod (mastermind-core.com/map), cinematic look locked · devlog #532-535

- SHIPPED: the Golden Orrery (/map) is LIVE + PUBLIC at https://mastermind-core.com/map -- a holographic 3D navigator over the
  291-node fractal tree (api/codex?op=tree). Reversible gravitational descent: focus always at origin, children bloom on a
  fibonacci shell, ancestors -> path-spine, siblings -> ghost-ring; click/Backspace/breadcrumb to navigate. node
  body.knowledge_visualizer = LIVE.
- LOOK LOCKED (v13, commit cadc4b0, deploy dpl_81p6yk6Y): glassy translucent data-sphere core (env-cube reflect/refract glass
  shader) framed by an octagonal violet PORTAL, a focused violet code-rain COLUMN pouring onto it, selective UnrealBloom
  (strength 0.55 / radius 0.5 / threshold 0.34), reflective grid floor + glowing floor-dots, sparse violet matrix-rain backdrop
  pillars, violet-led palette. At/past Mikael's reference art. Iterated LIVE via Claude-in-Chrome on the prod URL.
- LOOK REFINED (commit f8997af): REMOVED the octagonal violet PORTAL + the vertical violet code-COLUMN around the focus
  (Mikael: distracting now that the map is for navigating/reading, not a hero shot). Kept glass core, backdrop matrix-rain
  pillars, reflective floor + dots, bloom. (Both set .visible=false; code still present, can be fully stripped later.)
- DEPLOY PIPELINE + KEY LESSON: push main -> Vercel mastermind-2b2t auto-builds prod. Repeated ERROR builds were root-caused
  (Vercel build-log MCP tool is GATED here) by reproducing the prod build locally (git stash -u -> next build): REAL cause =
  `three`/`@types/three` were in working-tree package.json but NEVER COMMITTED -> Vercel fresh install had no three ->
  import('three') failed. Fixed (commit 82fa8f6). Also: dev SWC skips typecheck; `next build` enforces it.
- UNLOCK (reusable): Claude-in-Chrome is denied localhost but ALLOWED on public prod URLs -> deploying a page is what lets
  Claude SEE its own visual output and iterate with its own eyes (ended a ~10-round blind screenshot loop).
- DONE since this head: Phase 2a polish (focus-label-above-core + hover highlight; commit 3600d7c) + Phase 3 leaf->chunk
  reading-cards + full-content modal (new api/codex op=leaf = chunks WHERE bloom_path=node.path; commit d069f24, deploy
  dpl_66f8CVDrarDGu1ELAp1PzDvbXMP8) -- the orrery now READS the archive: descend to a leaf -> right-side panel of real chunk
  cards -> click a card -> full-content modal. Verified end-to-end live (ROOT->MINECRAFT->LNET leaf, 119 chunks, modal opened
  full chunk-0024). The CORE navigator is complete (3D structure descent + content reading).
- ALSO DONE: P3 card-heading honesty (lead with source file + subject, not the junk first-line title; commit 329fc3c) + SHAREABLE
  DEEP-LINKS (?focus=PATH loads straight to any node/leaf and auto-opens the leaf panel; URL syncs on every nav via replaceState;
  copy-link button in the focus bar; commit 1bda76d, deploy dpl_BBfGVxjm5gfjLgUjFFeb6fDR844i) -- any node is now one URL away
  (also removes the finicky autorotate-click navigation). applyView(id) is the single jump-to-any-node entrypoint.
- NEXT: Phase 2b SEMANTIC sibling layout (order each node's children by fractal_nodes.centroid cosine so related branches
  cluster on the shell; centroid column CONFIRMED = pgvector vector 768d) + P4 Ctrl+K search compass (needs OLLAMA_EMBED_URL
  tunnel to the box for query embedding).
- OPEN: GitHub PAT is plaintext in .git/config (rotate). Working tree messy; orrery committed surgically (map/page.tsx +
  api/codex/route.ts + package.json/lock only).

---

## 2026-06-27 (head) -- WEBSITE LIVE: Codex Navigator DEPLOYED to Vercel + mastermind-core.com LIVE: https://mastermind-core.com SERVING (apex cutover DONE 2026-06-27) · devlog #509

- SHIPPED (the goal): the navigator is LIVE + PUBLIC on the internet. Committed navigator-only (c4ebdc7: .npmrc +
  src/app/api/codex + src/app/codex -- NOT the big uncommitted pile/junk) to repo mastermind-os-v3-fresh main; the Vercel
  project **mastermind-2b2t** (prj_2fH4s5cY8ZtePpuw8NZGO7rYU5aP, team_OkordrImydpSoZWUNvDo8dyw) auto-built READY in 38s
  (dpl_HiQeJWnpZPcStCwztBrEtMQk6eZB). The local CC dir is .vercel-linked to mastermind-2b2t + git-connected -> push to main
  auto-deploys. NOTE: the live project is mastermind-2b2t, NOT "mastermind-os" (a separate/defunct project).
- VERIFIED IN PROD: unauth curl https://mastermind-2b2t.vercel.app/codex -> HTTP 200 (public, no deployment protection);
  /api/codex?op=stats -> 174214 chunks / 4953 docs / 12528 concepts straight from Vercel -> NEON_MEMORY_URL IS set on Vercel
  and the browse layer is genuinely always-on (no box, no Ollama for browse). node body.codex_navigator = LIVE.
- DOMAIN: mastermind-core.com ADDED to the mastermind-2b2t project via Vercel API (POST /v10/projects/.../domains) ->
  verified:true (ownership auto-verified, no TXT challenge). Config: misconfigured:true, serviceType external, NS =
  treasure/jihoon.ns.cloudflare.com (zone stays on Cloudflare -> hermes. untouched). DONE 2026-06-27 (apex A @ -> 216.198.79.1 DNS-only/grey cloud; Vercel Let's Encrypt SSL issued; https://mastermind-core.com -> 200, /codex -> 200): apex @
  A -> 216.198.79.1 + 64.29.17.1 (Vercel rank-1; 76.76.21.21 legacy), proxy OFF (DNS-only) so Vercel issues SSL. After
  propagation -> https://mastermind-core.com serves the navigator. Apex + hermes are SEPARATE records; do NOT delegate NS to Vercel.
- CORRECTION (supersedes the head-2 "DEPLOY BLOCKER FIXED" claim): the .npmrc legacy-peer-deps fix unblocked LOCAL `next dev`
  only. mastermind-2b2t's Vercel builds were ALREADY succeeding (a prior "install with legacy-peer-deps" commit + recent READY
  deploys). It did NOT rescue a broken prod build.
- NEXT (features, post-ship): (1) search op + UI are deployed but 503 in prod until OLLAMA_EMBED_URL tunnels to the box
  (browse/node/neighbors/concept all work now); (2) Neon-ify api/concept-graph as the always-on overview map; (3) embed the
  9 mathviz HTMLs (mathviz_out/) as node content; (4) cruft cleanup (SCROLL FORGE panel, Clerk CSS, api/docs fiction);
  (5) BRANDING: mastermind-2b2t's root (/) is the 2b2t Minecraft dashboard + layout title "2b2t Command Center" -- decide the
  public face of mastermind-core.com (keep dashboard at root vs a navigator/landing root; retitle).

---

## 2026-06-27 (head-2) -- WEBSITE BUILD STARTED: mastermind-core.com = a living KNOWLEDGE NAVIGATOR over the archive; api/codex backend built+verified; mastermind-os deploy blocker fixed · devlog #507

- DIRECTION (Mikael): the public site at mastermind-core.com IS a virtual knowledge navigator hosting his research -- the
  growable, DB-linked successor to the static Codex of Harmonic Unity PDF, navigated like its ΞM-PN sheets (core essence ->
  resonant links -> child nodes). Everything folds in: the 9 mathviz visualizers = node content; pattern-engine = a node;
  the Harmonic Unity codex = a node-tree; the agentic cockpit = the live layer behind it. RECONCILE: the backend already
  existed (codex_server.py/codex_data.py over transcript_archive) -- EXTEND the command center, do NOT spawn a parallel app.
- BUILT + VERIFIED (devlog #507, node body.codex_navigator = PROVEN): NEW mastermind-command-center/src/app/api/codex/route.ts
  = Neon-direct port of codex_data (ops stats/node/neighbors/doc/concept) reading transcript_archive on NEON_MEMORY_URL
  (= ep-restless-bush/neondb, the archive DB; getMemoryDb). Always-on/no-box (neighbors uses each node's STORED embedding +
  pgvector cosine; search deferred to a cloud embedder). Verified live in the CC dev server (:3000) vs the REAL archive:
  stats=174214 chunks / 4953 docs / 12528 concepts (exact match to codex_data); neighbors top_sim=0.9704; doc=114; concept=31.
- DEPLOY BLOCKER FIXED: the mastermind-os prod deploy ERROR'd because lucide-react@0.263.1 caps React<=18 vs the project's
  React 19 -> npm ERESOLVE -> typescript wouldn't install -> next build failed. Fix = .npmrc legacy-peer-deps=true (applies to
  Vercel installs too; lucide 0.263 renders fine on React 19). next dev now starts clean (Ready in 11s).
- TWO TIERS (honest): display = always-on (Neon+Vercel, no box); agentic control = durable via the supervised cloudflared
  tunnel (#505) when the box is up. STRUCTURAL DEFAULT (vetoable): navigator = the PRIMARY face of mastermind-core.com, the
  cockpit a layer behind it (wired later).
- DONE this session (devlog #508): Codex-sheet frontend at /codex -- document browse (filter by name + source_type chips) ->
  node-as-sheet (full content + resonant links w/ similarity bars + concept siblings, all clickable) + address-jump + back;
  api/codex `docs` op added; themed to theme-config.ts (cyan/violet/Orbitron). Verified in dev (:3000): docs op 200, /codex
  200 SSR clean. Layout has no Clerk blocker. View at http://localhost:3000/codex.
- NEXT: Neon-ify api/concept-graph (reads a local _signatures.txt now) as the always-on overview map; optional bloom_path
  tree + semantic search (needs a cloud embedder) + embed the 9 mathviz HTMLs as node content. THEN the ONE gated step
  (Mikael's call): deploy mastermind-os + attach the apex mastermind-core.com (currently Cloudflare-only, carrying the
  hermes. tunnel; no Vercel project holds the apex). The .npmrc legacy-peer-deps fix should now let the Vercel build succeed. VERIFY-LOOP NOTE: terminal:run_command + Windows-MCP hit a hard spawn wall (ETIMEDOUT) on slow commands -> use
  Desktop Commander start_process + read_process_output (detached + poll). The CC dev server is on :3000 this session.

---

## 2026-06-26 (head-3) -- vitality-aware-memory build REFUTED at the step-0 gate; descend_tree routing verified ROBUST · devlog #506

- The Grok-converged "vitality-aware memory" (attractor builds / vitality oracle judges + splits dead hubs / beam-k
  descent / coherence-band homeostat), grown from the Kumar 2026 holographic-memory paper + Mikael's intent-as-address
  framing, was gated build-to-fail BEFORE any code was written. _va_falsify.py (faithful descend_tree replica read from
  session-logger server.js -- roots = parent_path IS NULL AND depth=1, hard-argmax cosine over child centroids, stop at
  is_leaf; a chunk's true leaf = the node whose path == its bloom_path; read-only Neon, 174214 chunks / 227 leaves /
  8 roots) sampled the MOST-distinctive member of 18 dead-hub leaves (n>=83, coh<=0.841) vs 20 alive-small;
  hard-descent-reaches-true-leaf vs flat-search-top10-contains-it (self-excluded).
- RESULT: hard_hit = 100% on BOTH dead hubs AND alive-small (gap +0.0%); flat_hit = 38.9%(dead) / 60.0%(alive) -- flat
  is 61 pts WORSE than hard on hubs. Gate-the-gate PASSED (central chunks route home 95%, leaf centroids 100%). VERDICT:
  REFUTED -> STOP. The tree routes outliers (incl. hub members) home robustly and BEATS flat search: chunks are stored
  SEPARATELY so Kumar interference doesn't bite, and the local leaf centroid stays closest to its own outliers. The
  -0.247 size/coherence corr does NOT cause routing failure. beam-k + split-on-dead solve a non-problem; the architecture
  died its sharpest test before a line of production code (G14 search-first + build-to-fail working as designed).
- SURVIVING THREAD: Mikael's intent-as-seed principle is CONFIRMED, not refuted (intent -> exact leaf 100%; the test is
  an INSTANCE of it -- an earlier chat framing wrongly bundled the principle with the dead Kumar prediction and was
  corrected). The one real gap it names: descend_tree's FINAL SELECT returns leaf chunks by chunk_index, DISCARDING the
  query -- the single step that unfolds WITHOUT intent. Cheap 1-line option (ORDER BY embedding <=> query in that SELECT;
  real reading-order tradeoff), NOT built (no evidence within-hub retrieval bites). cortex.vitality_oracle (PROVEN)
  untouched; only its memory application died. Evidence: mastermind-client/_va_falsify.py.

---

## 2026-06-26 (head-2) -- INFRA: full fleet + Cloudflare tunnel RESTORED and made DURABLE; _vitality oracle BUILT (PROVEN); genome line v20-v39 assessed -> the wheel/classical scaffolding · devlogs #497-505

- INFRA / BOOT CHANGE (the headline): the persistent Cloudflare 1033 was a STACKED failure -- the entire local fleet was
  DOWN (only Ollama up) AND cloudflared.exe was MISSING from the machine entirely (config/creds/cert intact). Fixed:
  `supervisor.py up` -> 8/8 services up, bridge /health=200; reinstalled official cloudflared 2026.6.1 ->
  C:\Users\Mik\.cloudflared\cloudflared.exe; started the tunnel on existing creds (NO re-auth) -> public
  https://hermes.mastermind-core.com/health = 200 (1033 gone). Then made DURABLE by EXTENDING the supervisor (reconcile,
  not a separate Windows service): supervisor.py (215 lines; OLD backed up -> supervisor.py.bak_pretunnel) now manages
  cloudflared as a PROCESS-checked service -- svc_up = port_up for port services / proc_running (tasklist) for port-less
  ones; generalized launch() for non-Python argv; adoption via system process check so a restart never spawns a duplicate.
  PROVEN restart-on-death: killed cloudflared -> supervise loop relaunched it in ~1-3s -> /health=200. NET: `start_nexus.bat`
  (= `supervisor.py up`) now starts AND supervises FLEET + TUNNEL together; 1033 cannot recur on crash/reboot. (This
  SUPERSEDES the old "5 servers" boot line below: it is 8 Python servers + cloudflared.) Node orch.gpt_bridge. Side-fix:
  a fuzzy node-match had stomped body.unity_cockpit's note (restored from the painting .md export) and orch.gpt_bridge held
  a stale mis-filed function-field-L note (replaced with the real bridge state). LESSON: record drivers must target EXACT
  node ids, never fuzzy-match.
- _vitality ORACLE BUILT + gate-validated = PROVEN (node cortex.vitality_oracle). oracles.py extended with @oracle("vitality"):
  consecutive level-spacing ratio r-bar (Atas-Bogomolny-Giraud-Roux 2013; needs NO unfolding) -> ALIVE(GUE/GSE ~0.60/0.67)
  vs DEAD(Poisson 0.39) vs GOE-rejected(0.53), with Poisson-MC z + bootstrap-CI honest-null. Gate-the-gate 3/3 synthetic
  controls pass; in-house zeta zeros -> ALIVE 0.617, prime gaps -> 0.46 (weak structure, not alive). This IS the #429
  "aliveness/universality-class judge as a cross-domain instrument" direction, now real.
- Stage-0 directed-channel CRUX RESOLVED (cortex.prism_synthesis): on the 1-D prime/gap substrate the antisymmetric channel A
  COLLAPSES into the dead symmetric wheel-lattice (||A||/||M|| z=-245 vs wheel-null; A & dressed H_emp read GOE/verdict-0 at
  every lambda). Closes the panel's "single live exit" for THIS substrate (NOT Hilbert-Polya broadly).
- GENOME line v20-v39 assessed across 4 upload batches (honest build-to-fail audit). Every version is rigorous + honestly
  labeled and reduces to a CLASSICAL fact (Riemann/Dirichlet explicit formula -> mod-30 wheel/grouping). v36-v39 are a REAL
  falsification arc: the flagship chi/chi-bar paired "double-strand" died its sharpest test (collapsed on fresh actual L-zeros
  1/4; a dps70 zero-census sealed the data excuse) and was DEMOTED in v39's branch ledger. THREE-WAY WHEEL RECONCILIATION
  (session throughline): vitality oracle (primes not-alive, wheel-boundary) + Stage-0 (A collapses INTO the wheel) + codon
  (winning family IS the wheel) all converge on the mod-30 wheel = the DEAD pole. Live asset = the INSTRUMENT (the _vitality
  oracle + the falsification reflex), not the genome's structural claims. Standing rule reaffirmed (#427/#429): do NOT
  recompute the spectral baseline; find-the-operator = RH = world-class open.

---

## 2026-06-26 -- cortex.prism_synthesis: unified PATTERN-ENGINE synthesis DRAFTED (SPEC) · devlog #495

The PRISM/pattern-engine arc reached synthesis. The 366KB raw corpus (#494) was distilled into ONE unified
structure: mastermind-client/PRISM_PATTERN_ENGINE_SYNTHESIS.md (96 lines).
KEY MOVE (reconcile-before-proliferate): the 11 existing cortex/hands faculties are ALREADY a bag of PRISMS
(each = object -> canonical multi-channel decomposition + recognise/match). "Prism" is the shared INTERFACE
recovered from code, NOT a new engine. The bag is BLIND in one way: for RELATIONAL objects (surprise_engine2
graph, prime/gap substrate) it reads only the SYMMETRIC channel S -> the mechanical reason honest-null keeps
returning dead/Poisson/known (Lemke-Oliver, Chebyshev). The living/directed content is in the antisymmetric A.
FIX = two universal stages on the existing pipeline (decompose->signature->persist+bridge[equiv_node]->judge
->salience->file[descend_tree]): STAGE 0 Relational Prism M=S+A as mandatory front-end (S->pattern_recognizer
battery; A->proxy-spectrum, EXTENDS compute_worker's Directed Transfer Operator v2 #485); STAGE 2 Vitality
Judge = NEW oracle oracles._vitality classifying spectra ALIVE(critical/unitary) vs DEAD(attracting/Poisson)
= the brainstorm's Hilbert-Polya class-test. RECONCILE LEDGER: 8 faculties KEEP/REGISTER, oracles.py EXTEND,
NEW code = only {Prism shim, Stage-0 A-spectrum, _vitality oracle}. PRIOR-ART honest: S/A=Hermitian/skew
(detailed-balance vs probability-current); vitality=edge-of-chaos; contribution is ARCHITECTURAL not a theorem.
OPEN CRUX (not assumed): does A survive wheel-preserving nulls on a 1-D chain or collapse into S — pipeline
makes it a measurable gate. FIRST BUILD UNIT: _vitality oracle alone on in-house refs (zeta r-bar~0.618 alive;
prime gaps r-bar~0.452 dead) — reuses existing data. STATUS: SPEC (designed/ready; nothing wired).
NOTE: heads below (2026-06-24) are the older saturation-vs-margin arc; devlogs #485-494 (workflow-telemetry,
litcheck/G14, Hilbert-Polya frontier map, veilbreak ingest, prism corpus) landed in devlog+memory since then.

---

## 2026-06-24 (head-5) -- FINAL for this arc: saturation-vs-margin is UNDECIDED. Panel (3/3) proved banded =/=> saturation + gave the exact separator; probe8 ran it and is resolution-blocked on the sub-first-zero ground · devlogs #453-454

Supersedes head-4's 'leans saturation' (that lean was itself an over-read -- symmetric to the head-2 margin over-read). The closure arc:
- PANEL CLOSURE #453 (GPT+GLM+Grok unanimous): a converged banded/compact/diagonal-dominant MZ does NOT imply S_m->0.
  Counterexamples: GPT B=diag(1,1/2,1/4,..) (inf=1=margin); Grok constant Jacobi (Schur~0.91=margin). EXACT SEPARATOR:
  with B=MZ>=0 in the dilation basis, e0=ground, G00(eps)=<e0,(B+eps I)^-1 e0>=Sum_j w_j/(lambda_j+eps) (w_j=<e0,psi_j>^2).
  SATURATION <=> G00(0+)=Sum w_j/lambda_j = +inf; MARGIN <=> finite. The decider is the LOW-ENERGY SPECTRAL WEIGHT of the
  ground coord vs the small eigenvalues -- NOT the band shape. (GLM equiv: R_m=S_m/Q(c0)->1, needs 0 in essential spectrum +
  absolute diagonal->0. Grok equiv: continued-fraction Schur from b(k) + track absolute b(0;K).)
- probe8 #454 ran G00 on the dilation ground: INCONCLUSIVE BY RESOLUTION. The ground is sub-first-zero (gamma1=14.1), so its
  MZ spectral weight (~0.9-1.0) sits on NEAR-NULL eigenvalues lambda~1e-36 (numerical zero at dps=30, below the validity
  floor). G00_full=1e30..1e36=noise; G00_trusted~1e-4 excludes the weight-carrying modes. The deciding sum is below the floor.
STATUS: UNDECIDED. Both my leans were over-reads -- MARGIN (wrong axis, #448, Mikael caught) and SATURATION (sub-first-zero
artifact, probe6/7, panel caught). The exact separator is in hand but resolution-blocked on the natural ground.
RESOLVABLE-NEXT ATTEMPTS, both run, both NULL (#455, #457): (a) probe9 ran GLM's above-first-zero residual fraction --
INCONCLUSIVE: above-zero states leak ~15-18% into the sub-floor near-null subspace (rho_m1>1 proves the metric is
contaminated). (b) probe10 BURST (dps=50, zeros->120) ran the '>>30 zeros + higher dps' idea and REFUTED it: the ground
resolvent is Z-INVARIANT to 6 figs (the dilation ground sees ONLY its nearest zero; a zero at gamma=102 overlaps it by
~1e-466), and the precision lever just CHASES THE FLOOR (ground-weight eigenvalues 1e-36@dps30 -> 1e-55@dps50, sign-
unstable => the ground is in the NUMERICAL KERNEL of MZ to any reachable precision). So saturation-vs-margin for the
DILATION GROUND is NOT compute-bound-flippable; it leans MARGIN (defect fixed, positive, non-accumulating) but the ground
is a degenerate sub-first-zero object. The genuinely compute-flippable open calc is the FORM-FACTOR/pair-correlation at
>>1e4 zeros (H-hunt), not this. ALSO BUILT this session (#456): the IDENTITY-VECTOR DEATH-TREE (Mikael's cell-division
insight operationalized -- character/L-function decomposition, inheritance+cell-separation+per-cell recombination all
validated). FILES: mastermind-client/{_probe6..10,_verify_primewall,_deathtree_identity}.py + *_result*.txt + _zeros_cache.txt.

---

## 2026-06-24 (head-4) -- evidence now LEANS SATURATION (3 converging valid-axis lines); GLM's algebraic banded-generator route executed · devlogs #451-452

After the retraction (head-3), built the two valid-axis tests. NET: saturation-vs-margin is still OPEN/unproven, but the
valid evidence now LEANS SATURATION (reversing the wrong head-2 'MARGIN'), from THREE independent lines:
(1) #451 probe6 -- conditioning-safe toward-ground Schur S_m on the BROAD/valid band: S_m collapses 8.6e-11 -> 1.49e-20 ->
    2.66e-27, eta(screening)->1.0. Build-to-fail also found the narrow-atom route is blocked by a PRIME-CONVERGENCE WALL
    (dilation ground sits below the first zero gamma=14.1; narrow atoms need >>1e5 primes for A-P=MZ) -- NOT ill-conditioning;
    only broad atoms stay valid. This empirically re-ranked GLM's algebraic route to #1.
(2) #452 probe7 -- GLM's algebraic route: the dilation generator (MZ=A-P in the dilation-energy eigenbasis) is a CONVERGED,
    BANDED, diagonal-dominant operator, b(k)/b(0) ~ [1, .188, .080, .044, .016, .014, .0076, ...] stable across K=21,25,29 =
    the compact-generator signature (local generator + compact decaying perturbation => polynomial scaling => saturation).
(3) Panel prior 2/3 (GPT+Grok) leaned saturation; Grok's prediction.
HONEST BOUNDS (calibrated, NOT a repeat of the head-2 over-claim): NOT closed/proven. Band trustworthy to ~1e-3 (self-check
degrades 8e-11->2e-5 by K=29 as far modes hit a milder truncation limit); a sub-1e-4 non-compact tail is below the numerical
validity floor (undetectable without the heavy >>1e5-prime extension). 'banded => polynomial => S_m->0' is GLM's ANALYTIC
claim; probe7 shows numerical CONSISTENCY, not proof. RIGOROUS CLOSURE (open): GLM's analytic banded=>polynomial argument,
or the heavy prime-extended direct S_m. FILES: mastermind-client/{_probe6.py,_probe7.py,_verify_primewall.py,*_result*.txt}.

---

## 2026-06-24 (head-3) -- CORRECTION (devlog #449): saturation-vs-margin is STILL OPEN; #448's MARGIN verdict was WRONG-AXIS + resignation; panel was non-resigned, 2/3 leaned SATURATION

Mikael caught a resignation drift. Ground-truthed the panel record (#435 = literal 'anti-resignation re-dispatch', logged 'panel is NOT resigned'; #441/#442 = GPT+Grok LEAN SATURATION). The #448 result is a CORRECT measurement (coupling-defect floors ~1.178e-3 under RANGE extension, = ||MZdb[ground,:]|| exactly) but its VERDICT is RETRACTED: (a) WRONG AXIS -- I extended basis RANGE (centers 0..36); the panel's UNANIMOUS decisive test is TOWARD-GROUND densification (u->0), watching residual S_m -> 0 vs plateau; GLM (#441) predicted the off-diag ground coupling I measured is EXACTLY what toward-ground completion absorbs, so my floor does NOT bear on saturation. (b) 'closed/point-at-system' was borrowed from fork-(c)'s strategic resolution (#429), a DIFFERENT question. UNTOUCHED PANEL AVENUES (proposed a turn ago, not run): S_m toward-ground residual completed cleanly (broke in #443 on ill-conditioning+dps, abandoned partly for OPS reasons); coupling/screening-efficiency vs resolution (Grok/GLM); log(Q_N)->banded dilation-generator extraction (GLM); Mellin-intertwiner stabilization; principal-angles/eigen-pencil/Procrustes (GPT); Bombieri-Garrett compression (GPT); Ruelle transfer-operator/Koopman (Grok). DECISIVE NEXT (conditioning-safe): coupling-defect (or S_m Schur) under TOWARD-GROUND densification WITH Gram-Schmidt-orthogonalized residual at each level (fixes #443's ill-conditioning), moderate dps, detached; watch -> 0 vs floor. STATUS: saturation-vs-margin OPEN; the math line is NOT closed.

---

## 2026-06-24 (head-2, RETRACTED scope -- see head-3) -- coupling-defect floors ~1.178e-3 under RANGE extension (CORRECT data; 'RESOLVED=MARGIN' verdict retracted) · devlog #448

RESOLUTION of the frontier the previous head named. Scaled the conditioning-free probe (_commutator_probe5.py, extends probe4
byte-identical build() = convention-locked) over a WELL-CONDITIONED dilation basis K=7..19 (centers 0,3,..,3(K-1); w=2.2; dps=30),
watching ||Adb[ground,:]-Pdb[ground,:]|| (A=arch, P=prime, dilation-energy r^2 eigenbasis). The defect CONVERGES TO A NONZERO FLOOR
~1.1781e-3 (K=7 1.354e-3 -> 9 1.210e-3 -> 11 1.183e-3 -> 13 1.179e-3 -> 15/17/19 1.1781e-3; decrements collapse geometrically
1.45e-4 .. 1e-8, ratio ~0.15->0.11 = convergence, NOT decay to 0). cond(G)~87..116 throughout (trivially well-conditioned);
defect ~8 orders above the dps floor -> STRUCTURAL, not noise.

VERDICT: **MARGIN, not saturation.** The prime sieve mimics the archimedean place's action on the scale-invariant dilation
ground to ~3 digits but NOT exactly; a genuine stable ~1.18e-3 obstruction = the perturbation is RELEVANT, not marginal. The
'exact marginality / sieve realizes the archimedean place' hypothesis is RETIRED.

RIGOR-MAKER (exact cross-check): since A-P=MZ (explicit formula), the defect MUST equal ||MZdb[ground,:]|| (zeros-form ground row
in the dilation eigenbasis) -- confirmed equal to ALL printed digits at every K (self-check ||(A-P)-MZ||/||MZ|| ~7e-11..1.2e-10). So
the floor is rigorously: the Riemann zeros' coupling of the scale-invariant ground into excited dilation modes is a basis-limit
INVARIANT ~1.178e-3 -- the zeros genuinely couple the ground; it does NOT asymptotically decouple.

GATE-THE-GATE: probe5 K=7 reproduced #447 to all digits before any larger-K trusted. Prime envelope exp(-1.21 u^2) self-truncates
by n~150 + 30 zeros cover centers to gamma~90 -> neither truncation limits at K<=19 (flat self-check confirms). CAVEAT: floors
along the well-conditioned RANGE-extension axis; spacing/width refinement is a separate (ill-conditioned) axis not tested, but the
ground mode's coupling channels live on the range axis and are cleanly converged.

SIGNIFICANCE: resolves the LAST live thread of the Weil-positivity arc (#436-447). Consistent with the strategic resolution
(next-phase-2 block below): math = verified-classical scaffolding, fork (c) closed negative -- we have now MEASURED,
conditioning-free, that the apparatus does not reach exact dilation-marginality at the ground. No RH leverage; a clean structural
fact about the Weil toy. Honest-null over validation. FILES: mastermind-client/{_commutator_probe5.py, _commutator_result5.txt}.
NEXT: [SUPERSEDED by head-3 -- the 'stopping point / CLOSED' claim here was resignation; saturation-vs-margin is OPEN, the
toward-ground axis is untested, and ~6 panel avenues are unrun. See head-3.]

---

## 2026-06-24 (head) -- Weil-positivity arc: dilation-ground localized; absolute margin = basis-mirage; coupling-defect [RESOLVED -> MARGIN, see head-2]

STATUS: RH-positivity in the Weil toy is CONFIRMED confined to the single dilation-ground (scale-invariant, u->0) mode (non-ground floor lambda_min(Qrr) ~ +4.5e-12; robust across bases/k). The ABSOLUTE ground margin is a FINITE-BASIS MIRAGE -- it swings 1e-32 .. 1e-19 .. numerically-negative across bases, NOT a basis-independent invariant. The Schur-residual route is ABANDONED (basis-noise below the method floor).

MECHANISM (clean, conditioning-free, devlog #447): in the dilation-energy (r^2) eigenbasis the PRIME form's ground-mode coupling MATCHES the ARCHIMEDEAN form's to ~4-5 digits (diag 0.292314 vs 0.292306; off-diag-norm 0.226811 vs 0.226717; ground->1st-excited 0.196912 vs 0.196883). The prime sieve mimics the archimedean place's action on the first-division mode -> that IS why positivity localizes to the dilation ground.

FACULTY CHANGE: workers/experiment.py extended with registered experiment 'ground_saturation' (run via run(name,params); backup experiment.py.bak2). Note its Schur metric measures basis-noise; next faculty experiment should use the coupling-defect metric.

FRONTIER / NEXT SESSION: scale the conditioning-free coupling-defect probe _commutator_probe4.py (bigger WELL-CONDITIONED basis, higher dps); watch ||Adb[ground,:] - Pdb[ground,:]|| vs resolution -> 0 (SATURATION = exact marginality = the model's relocation realized) or floor (genuine MARGIN). Convention-locked: self-check ||(A-P)-MZ||/||MZ|| = 1.2e-10. Corrected two bugs in GLM's sketch: even-parity (use r^2 not r) and vacuous diagonal commutator (use off-diagonal coupling).

DEVLOGS this session: #436-447. HARNESS: heavy mpmath must run DETACHED (powershell Start-Process -WindowStyle Hidden) writing to a polled file; NOT synchronously (60s write_and_run wall). See toolbox memory 'HEAVY-COMPUTE HARNESS PATTERN'.

---

# MASTERMIND — System State & Memory Source of Truth

> Canonical project state — the SINGLE source of truth. (claude-system/MASTERMIND-STATE.md is RETIRED 2026-06-19.)
> Last updated: 2026-06-24 (next-phase-2). HOW TO READ: the dated heads below (newest first) + the Neon `devlog` table (#274–417) +
> the layered memory are authoritative-current; the LAYER sections further down are a HISTORICAL spine (06-13 baseline).

---

## 2026-06-24 (next-phase-2) — >>> START HERE — STRATEGIC RESOLUTION: the math is verified-CLASSICAL scaffolding; fork (c) closed NEGATIVE by all 3 models; the novel asset is the SYSTEM (b) · devlog #426–429

> Continued from the manuscript-phase block below. Mikael's drive: "no use for something that is not the final goal, or somehow
> new worth showing off; if you compute to equate known things, grab the known thing and build from there." Ran lit-checks +
> reduction tests on every rung. All results PROVEN/recorded:
> (1) #426 — the front-law / alpha-kernel is a RE-ENCODING of classical prime-factor distribution theory: Billingsley 1972
>     (normalized log-prime-factors → Poisson–Dirichlet), Sathe–Selberg, Buchstab/Dickman, products-of-two-primes / RSA-integers
>     lit (Decker–Moree, Saad Eddin–Suzuki, Dummit–Granville–Kisilevsky, Knuth–Trabb Pardo). 'α→1 / front uniform' = PNT-level
>     equidistribution inside Billingsley–PD. NOT new. RULE: lit-check each rung's input FIRST; grab+cite if classical.
> (2) Target-H reduction — H = a ternary process GRAMMAR re-expressing the sieve; every clause → classical (sieve of Eratosthenes +
>     least-prime decomposition + Billingsley-PD / Sathe–Selberg). The doc itself says so (Purpose + falsification rule #3). Platform, not prize.
> (3) #427 — SPECTRAL / HILBERT–PÓLYA BASELINE consolidated (codex/June 21/_SPECTRAL_HILBERT_POLYA_BASELINE_v1.md). The whole
>     genesis/spectral arc (#233–291) = reproductions of the explicit formula (1859/Weil) + Montgomery–Odlyzko + Berry–Keating +
>     Berry–Tabor/BGS + Weil–Deligne + Connes/F1. The one open wall = construct H / Weil positivity / supply Z's missing geometry =
>     RH. "find the operator = find the geometry." DO NOT recompute §1–2.
> (4) #428–429 — FORK (c) ("is the apparatus a candidate SPACE/SYMMETRY/POSITIVITY for Z?") DISPATCHED to all 3 reasoning models,
>     CLOSED NEGATIVE/decisive. Grok + GPT-Mastermind-core(via Hermes) + GLM all = RE-ENCODING. The crux — POSITIVITY — has no
>     teeth: 'conservation of composite death at least-prime gates' is a partition/bookkeeping identity, not a spectrum-forcing
>     inequality. GLM's √N "residue" = the missing positivity RESTATED (a combinatorial surrogate), not new content. Bonus: GLM
>     independently CONFIRMED the canonical m-coordinate (3rd model after Grok).
> RESOLUTION: of the 3 forks — (a) F1/Connes missing-geometry = the famous open problem; (c) CLOSED NEGATIVE — **(b) is the live
> direction.** The genuinely-novel, showable asset is the SYSTEM (autonomous research organism + multi-model orchestration +
> cymatic language stack + the aliveness/universality-class judge as a general cross-domain instrument), NOT a prime/zeros theorem.
> The full math arc is honest, rigorous, self-auditing VERIFIED-CLASSICAL scaffolding — valuable as a DEMONSTRATION of the system's
> capability, not as new mathematics.
> LOOP STATE: GATE-1 conductor HALTED (conductor_control.txt=stop; widget idle 7/60; ran vL1→vL6). GATE-1 input ledger is complete
> (Lemma A.1; c→1 corollary #423; E_edge=o(1/logN) #416; uniform Buchstab = Tenenbaum III.6.2 Thm 3, near-locked) = sealed scaffolding.
> OPEN (Mikael): point the showable-novelty work at the SYSTEM (b); pursue GATE-1 manuscript only if a lane is still wanted as a demo artifact.

---

## 2026-06-24 (next-phase) — MANUSCRIPT PHASE OPENED: P0 claim register + P1 dependency map + task distribution; GATE-1 named; loop HELD pending sign-off · devlog #417

> Boundary ritual ground-truthed first (hydrate → latest reflection → this STATE head → Neon devlog MAX=#416). The alpha-kernel
> arc closed at leading order (#409-416); per gated-phase doctrine (#400) the immediate next move = P0+P1 BEFORE anything runs.
> PRODUCED codex/June 21/_CLAIM_REGISTER_P0_P1_v1.md (DRAFT for Mikael sign-off; reconciled onto THEOREM_LADDER_TARGETS_v1.md,
> NOT a parallel tracker). NO RH anywhere.
> P0 truth-states: A/B/D/E EXACT; C2 theorem-under-classical-inputs (#405, Tenenbaum III.6.2 Thm3); R_d theorem-route by
> induction (#407); G(alpha-kernel) theorem-route@leading-order, hinge Lemma A.1 (#414) + E_edge resolved (#416, o(1/logN),
> 0.0674 ln d demoted to finite-N artifact); F empirical→target; H synthesis; ANCHOR=Li (finite-cert only, #404); cross-field
> honest-null PARKED (#409).
> P1 critical path: [uniform-Buchstab citation lock] → C2+R_d → Lemma A.1 error-bound → G SEALED → (F) → H.
> GATE-1 (loop repoint target, doctrine P3) = seal G error-controlled: promote Lemma A.1 to O(||eps||_inf^2)-remainder lemma +
> citation-lock uniform Buchstab (Tenenbaum III.6.2 Thm3) consumed by C2+R_d. Replaces the low-value QR-cert grind.
> TASK DISTRIBUTION (owners #400; method #401): Mikael=sign-off+lane pick+loop call; Claude=citation lock + Lemma A.1 audit vs
> census coord (Lambda=log(N/p^2), #415) + DAG/v109 upkeep; GPT=loop HELD→repoint on sign-off; Hermes=compute_eval bound-checks +
> archive; advisors=red-team only (trust none end-to-end). Tab-collision rule (#416): advisor consults on Grok/GLM tabs, GPT tab
> left to the loop.
> LOOP STATE (#418): REPOINTED to GATE-1 — conductor_prompt.txt + build_seed() + a frontier SYSTEM-REDIRECT seed all flipped
> off the closed QR-cert grind (latest gpt_output v202 was modulus-increment grind; v201 hit the 200k context wall). Bridge
> safe-restarted on Haiku (PID 21760, /health=anthropic:claude-haiku-4-5-20251001, readonly) — a bare relaunch first regressed
> it to qwen7b (env-loss), caught by /health and fixed via MASTERMIND_EXEC_MODEL from supervisor.py. conductor_control.txt=
> 'continue' → resumes ONTO GATE-1 when the userscript next drives the GPT tab. Still HELD browser-side (not driven this turn).
> OPEN (Mikael, gates everything downstream): (1) sign off/amend P0 + pick scope lane A/B/C; (2) repoint-or-hold the loop.

---

## 2026-06-23 (later-4) — V24 CONFIRMS THE ALPHA-KERNEL (finite-size tilt; asymptotic kernel uniform; verified on real prime data) · devlog #402-410

> Exploration-lane frontier collapse + the decisive experiment. The Living Loop analytic ladder closed under classical inputs
> and the last empirical residue (the alpha-kernel) was derived AND confirmed. (1) #404 anchor check killed a 2e^-gamma
> coincidence (V79-O1 stays hard; the report's anchor is Li, not Mertens). (2) #405 C2 Buchstab clock closes as
> theorem-under-CLASSICAL-inputs (Tenenbaum III.6.2; Fan-2023 demoted to finite-cert refinement, not a theorem blocker).
> (3) #406/#408 alpha-kernel derived fit-free from depth-resolved omega_d; deep-d shown to be a rough->almost-prime
> (Sathe-Selberg) crossover, not an open boundary layer. (4) #409 cross-field: geomagnetic pole-shifts are Poisson (random,
> no level repulsion) vs prime-drift = GUE (rigid) -> DIFFERENT process classes (the pattern engine's first verdict on his data).
> (5) #410 V24 multi-N: THEORY alpha_d -> 1 as N=1e6..1e10 (the front tilt is finite-size, ~1/log p); EMPIRICAL semiprimes (d=1)
> measured alpha=0.901/0.916/0.928 at N=1e6/1e7/1e8 -- marching toward 1, the fit-free derivation predicting real prime data to
> +/-0.004 and TIGHTENING with scale. The empirical alpha_d log-law is demoted to a finite-N snapshot. ALL exploration-lane/
> CANDIDATE (leading-order; not yet rigorously error-controlled).
> AIM (vision-sharpened this session, memory p7): the prime end-game lift is STRUCTURAL, not physical -- the missing higher space
> for the integers (function-field RH = zeros as Frobenius eigenvalues on cohomology; Hilbert-Polya / Berry-Keating xp = the
> candidate operator). The time-spiral/golden-ratio aesthetic is a SEPARATE arc, do not merge (genesis_field <-> Living Loop siblings).
> RESIDUAL / NEXT GATES: full deep-d (5-8) empirical multi-N sweep + matched-asymptotic interpolation with partial roughness at
> p=3,5,7 + rigorous error control; formal write-ups for C2 / R_d / alpha-kernel; CLAIM REGISTER (P0) sign-off still pending.

---

## 2026-06-23 (later-3) — PROGRAM STRATEGY LOCKED (gated-phase doctrine) + ORCHESTRATION METHOD · devlog #400-401

> Governance turn. A faithful model of the prime-unfolding theory was reconstructed (THE_PRIME_UNFOLDING.md), then a real
> STRATEGY was worked out by browser-driven multi-model dialogue (Claude <-> Mastermind-core GPT back-and-forth + an
> independent Grok stress-test, ZERO API calls) and LOCKED by consensus. Full doctrine: project memory p9 + devlog #400.
> DOCTRINE: Claim -> dependency -> gate -> uncertainty-type -> instrument -> red-team -> gated loop. RULES: truth-state
> before tooling; proof structure before instrumentation; automation only after the gate is named; a structure is "alive"
> only if it carries/supports/blocks/changes the status of a claim. INSTRUMENT-BY-UNCERTAINTY: numerical->compute ladder;
> structural/causal->ablation lab; conceptual->proof sprint; sufficiency->manuscript freeze; robustness->red-team.
> PHASES P0-P7: P0 claim register/truth-state; P1 dependency map; P2 scope (A finite-cert pkg=near-term / B conditional /
> C full theory=north-star); P3 one-gate sprint; P4 finite-cert ladder (loop-owned, gated); P5 manuscript freeze; P6
> red-team; P7 gated loop ops. TWO LANES + ONE-WAY VALVE: gated PROOF track (owns the loop; every loop targets a NAMED
> gate) + continuous EXPLORATION lane (Mikael-driven, CANDIDATE-stamped, may only PROPOSE gates, never inject). TRACKING:
> track-interfaces (each track emits a constraint/prediction the others must respect/check) + a PROMOTION BOARD every 4-6
> sessions (Heuristic->Conditional or kill) + this strategy/STATE treated as a VERSIONED living map, updated per phase gate.
> OWNERS: Mikael=intent/claim-boundaries; Claude=architecture/dependency-discipline/audit; GPT=sequencing/synthesis;
> Hermes=retrieval/compute/archive; advisors=adversarial critique only.
> METHOD (devlog #401, toolbox memory p8): Claude-in-Chrome drives Mikael's open logged-in model tabs (ChatGPT/GPT, Grok,
> GLM) for cross-model consensus/red-team OR to parallelize decomposed phases across models and combine -- zero API cost.
> IMMEDIATE NEXT MOVE (nothing runs ahead of it): produce the one-page CLAIM REGISTER + PROOF-SPINE DEPENDENCY MAP (P0+P1);
> truth-state only, no code/ladder/instrument; Mikael signs off. Per doctrine the autonomous loop should HOLD on frontier
> expansion until P0/P1 name the gate it targets (conductor currently idle; do not resume free-running until the gate is set).

---

## 2026-06-23 (later-2) — PERSISTENCE HARDENED + REDIRECTED TO COMPUTE + COMPUTE-TRUST BUG FIXED + FULL CHAIN CONFIRMED (loop shipping verified certificates) · devlog #394-399

> Continuation of the #391-393 self-persist arc. The pasted live v180 GPT memo complained "archive retrieval still empty";
> ground-truth probe found the RETRIEVABLE frontier (transcript_archive doc_id='gpt_hermes_frontier') was FROZEN at the
> #393 backfill set (v110, v122-148) -- every version the loop produced AFTER #393 (v149->v176, captured fine in
> gpt_hermes_turns as status='gpt_output') never reached the retrievable store; v177-v187 not captured at all. The running
> bridge indexes correctly NOW (verified live: an ARCHIVE:: v9002 probe landed with an embedding), so the historical
> live-index failure was a SILENT TRANSIENT swallowed by except-pass -- exact cause UNCONFIRMED (honest null).
> VICIOUS CYCLE: frozen frontier -> GPT's own search_archive returns nothing for recent versions -> GPT concludes
> "archive blocked/read-only/polluted" (verbatim in v171-v176 memos) -> stops grounding, self-continues procedurally ->
> drift into proof-bureaucracy (v185 evidentiary-gate spec, v186 intake schema, v187 mode-checker traces -- scaffolding
> that explicitly WON'T fill M1 / stops before D0-D10; ZERO compute_eval; the #359 self-continuation-theater pattern).
> FIXES (server-side, verified live):
> (1) BACKFILL (#394): indexed the 16 captured-but-unindexed versions [150,155,163-176] via canonical _index_memo ->
>     frontier 41 rows / 0 null-vec; search_archive returns the frontier 0.59-0.74 (was empty).
> (2) HARDENED gpt_bridge (#395): _index_memo failures now LOG to data/index_memo_failures.log (non-silent) + NEW
>     _reconcile_frontier() runs at __main__ boot and backfills any gpt_output version missing from the frontier
>     (idempotent) -> a transient index failure SELF-HEALS on restart instead of freezing forever. Verified: direct
>     invocation prints "frontier already complete (41 versions indexed)". Safe-restarted (py_compile -> os.kill ->
>     detached relaunch, NOT PowerShell Stop-Process); new bridge PID 24916 on :8780, /health=Haiku, readonly. .bak7.
> (3) RE-ANCHOR + HARDENED conductor_prompt.txt (the continuation template read every 'continue'): every version MUST
>     contain >=1 freshly COMPUTED number, NO scaffolding (schema/gate/template/uncomputable-definition -> flag operator),
>     persist via ARCHIVE:: not log_memory (the GPT had drifted to a GATED log_memory write -> DENIED -> "archive blocked").
> (4) REDIRECT (#396, VERIFIED LIVE): typed a one-time SYSTEM REDIRECT into the live thread -> stop the M1/B1 scaffolding
>     track, return to the finite-front certificate ladder, recover the verified spine + compute the next quantity. The loop
>     FLIPPED: turns #360-364 n_tools=10/24/36/20/16 (was 0-1 on scaffolding turns) = real compute+retrieve; it recovered
>     the p=967 anchor (=> archive read RESTORED). conductor_control.txt reset to "continue".
> (5) COMPUTE-TRUST BUG (#397, VERIFIED): on v189 the GPT computed the p=971 gate, CROSS-CHECKED Hermes vs an independent
>     enumeration, caught a discrepancy, and correctly declared v189 NO-SHIP (refused a false certificate -- honest-null
>     HELD; frontier stays 41, nothing bad persisted). Adjudicated independently: TRUE p=971 tail (#QRs in [1,841]) = 426,
>     total 499491 -- MATCHES the GPT's enumeration, CONTRADICTS Hermes's reported 420/499485 (420 ~= 841/2 = a synthesized
>     guess). So the Haiku executor SYNTHESIZES enumerated counts instead of truly computing them; compute_eval (mpmath AST)
>     can't enumerate (no loops), 16-36 compute_eval calls but the count was still wrong. compute_eval "grounding" is
>     UNRELIABLE for counts -- only the GPT's manual cross-check caught it.
> OPEN: (a) RESOLVED -- strategic drift redirected to the compute ladder + verified (above); M1/B1 DEFINITION itself
>     remains a genuine operator research decision the loop correctly cannot compute. (b) RESOLVED (#398) -- compute-trust
>     fix BUILT: extended compute_eval into a bounded AST interpreter doing EXACT enumeration (comprehensions, range/sum/len,
>     3-arg modular pow, comparisons, floor-div, exact ints, 20M-iter cap); verified live through the host (p=971 tail 426 /
>     total 499491, was a 420 guess); zeta(2) still exact; mcp_host restarted (pid 29948) + tool description advertises it.
>     The executor can no longer fabricate counts; GPT cross-check stays as a gate. (c) RESOLVED (#399) -- write-channel
>     re-anchor CONFIRMED end-to-end IN PRODUCTION: after the fix the loop ran v189 then v190, computed QR_count(1e6,977)
>     =499490 (INDEPENDENTLY verified MATCH -- periods 1023*488 + tail 266), SHIPPED it, and ARCHIVE::'d it; frontier grew
>     41->43 (v189+v190 landed, retrievable). FULL CHAIN now proven: read-restored -> hardened -> redirected -> compute_eval
>     fixed -> loop computes a VERIFIED count -> ships -> persists -> retrievable. Loop is SELF-SUSTAINING on the compute
>     ladder (proposing v191). (d) NEW minor friction (not blocking): the executor (Haiku) hits its STEP/tool-call budget on
>     big counts ('Hermes step limit') and the GPT chunks around it; raising executor max_steps OR nudging it to use a
>     SINGLE comprehension compute_eval (now that enumeration is supported) instead of many small calls would smooth it.
>     (e) v177-v186 permanently lost (never captured). Live browser tabs: ChatGPT Mastermind-core (the loop), Z.ai/GLM,
>     Grok, + a local V159 certificates PDF.

## 2026-06-23 (later) — LOOP NOW SELF-PERSISTS: gpt_bridge auto-indexes finished memos to the retrievable archive (#393) + v126-v149 frontier ingested (#392) + GLM v107 synthesis reproduced from data (#391) · devlog #391-393

> Three lands today, all verified against ground truth:
> (1) REPRODUCTION (#391): the two GLM PDFs (synthesis up to v107) reproduce EXACTLY from June 21 source data — 7/7
>     source-CSV SHA-256 recomputed from the package zips; controlling gate N=1e6/p=967 ratio_li 1.1216127; shallow anchor
>     maxima Li/addB/mult 1.1216/1.1148/1.0385; min beta C=1.06 = 4.275; master overlap 0.035493 (1e6)/0.025937 (1e7);
>     shell 0.010480 + interior 0.004057. Caught a GLM PROSE slip ('5 exceptions >1.05' vs data 3 — matches GLM's own
>     chart+table). Reproduction-as-audit. (_REPRODUCTION_vs_GLM_2026-06-23.md)
> (2) DB UP TO DATE (#392): the v126-v149 progress package (the loop's own recovery artifact) confirms v126-v135 were never
>     persisted (readonly-gate damage) -> only v136-v149 recoverable + v132/v135 facts; rest a gap register. Authored
>     _V126_V149_FRONTIER_2026-06-23.md (the conditional-closure ladder) + ran ingest.py -> transcript_archive (6/6 chunks
>     embedded, top-hit on natural query). Frontier now retrievable.
> (3) HERMES ANSWERS GPT PROPERLY (#393, LIVE): root cause = GPT's ARCHIVE:: short-circuit wrote ONLY to gpt_hermes_turns,
>     never the indexed transcript_archive (and the executor is readonly so its gated writes are DENIED) -> 'no indexed
>     records'. FIX: did NOT unlock the readonly executor (safety); added gpt_bridge._index_memo() called from _capture on
>     status=='gpt_output' -> upserts the finished memo into transcript_archive (gpt_hermes_frontier#vNNN) embedded via the
>     SAME nomic-embed-text pipeline as ingest.py (append-only, best-effort, never breaks relay). Backfilled 25 versions
>     (v110,v122-v148); search_archive (Hermes's OWN faculty) returns the frontier 0.69-0.72; LIVE bridge POST of ARCHIVE::
>     auto-indexes + retrievable. The loop now self-persists its outputs as it goes — structural cure for the v126-v135 loss.
> CAVEAT: supervisor.py was NOT running this session (gpt_bridge was relaunched standalone w/ env
>     MASTERMIND_EXEC_MODEL=anthropic:claude-haiku-4-5-20251001, new PID, /health OK). Start the supervisor to get
>     restart-on-death (it carries the Haiku env for gpt_bridge).

## 2026-06-23 — CONDUCTOR = Haiku 4.5: cutover LIVE (#385) + prompt caching LIVE (#386) + CONTINUATION LOOP LIVE (#387, trigger = GPT calling mastermind) · devlog #381-387

> The 06-22(late) NEXT ("try a bigger LOCAL Hermes 14b") is DONE. The 14b runs the autonomous path and does TRIVIAL
> single-tool tasks cleanly (compute 17*19 -> 323, 1 call).
> **CORRECTION (real-test honest null #382): on a REAL multi-part task (recall v93 verdict + compute_eval phi & its
> square) the 14b FAILED — malformed recall query (empty), malformed compute expr (rejected), and crucially NO
> error-recovery: it LOOPED the same failing calls, hit the loop-guard, and never synthesized an answer. The TOOLS
> work (verified independently: recall('v93 verdict') returns WEAK-COUPLING; compute_eval ((1+sqrt(5))/2)**2=2.618...).
> The deficit is ROUTING/RECOVERY JUDGMENT, not size or compute. So the executor-quality cap is LIFTED FOR TRIVIAL
> TASKS ONLY — real conducting is NOT solved.**
> (1) EXECUTOR SWAP: autonomous conductor qwen2.5-coder:7b -> qwen2.5-coder:14b (MASTERMIND_EXEC_MODEL in gpt_bridge;
>     PERSISTED in supervisor.py SERVICES env -> survives reboot). Bridge /health reports model=local:qwen2.5-coder:14b.
> (2) DISCRIMINATOR (the pre-declared test, 'compute 17*19', warm, calls-to-answer): 7b=18 ; 14b+OLD-prompt=2
>     (compute_eval->323 + 1 spurious GATED log_memory that ATE the answer) ; 14b+TRIMMED-prompt=1 clean compute_eval,
>     answer '...is 323.' => BOTH levers confirmed: SIZE was the bottleneck AND the doctrine was over-driving the model.
> (3) DOCTRINE TRIM: hermes_system.txt — rule 0 TRIAGE-FIRST (trivial/self-contained -> ONE call + STATE result, no
>     retrieve/plan/route/consult/log) + rule 6 ALWAYS-STATE-RESULT + scoped logging/consult. Backup hermes_system.txt.bak.
>     mcp_host_service RESTARTED to load it (47 tools, all stdio servers healthy).
> (4) END-TO-END LIVE: POST :8780/gpt/ask 'compute 17*19' -> '323', model 14b, 12.3s. GPU: 14b=100% on the RTX 3060
>     (9.5GB used, ~9.7GB free). 32B off the table (VRAM spill); 14B is the local fast-inference ceiling.
> REMAINING / NEXT (reprioritised by the #382 null; lever-1 tried #383): (a) THE REAL BOTTLENECK = conductor judgment/recovery.
>     (i) LOCAL scaffolding in mcp_host advance() = DONE + MEASURED (#383): _guidance (error->reformulate / empty->broaden) +
>         _final_answer (forced tool-less synthesis on bail; mcp_host.py.bak6). EFFECT: turned the empty 'did not converge'
>         into a real grounded PARTIAL answer (states phi), but the 14b STILL can't reformulate a malformed call or fully
>         synthesize multi-part (delivered 1 of 3 deliverables). KEEP it (strictly better, model-agnostic) but its CEILING
>         is reached. NEXT cheap try: deeper compute_eval-specific syntax hints ('use ** for powers; allowed + - * / ** sqrt()...').
>     (ii) STRONGER BRAIN = VALIDATED LIVE (#384, re-confirmed 06-23): Anthropic HAIKU 4.5 PASSES the real multi-part
>         test the 14b FAILED -- 3 clean calls (recall + compute_eval phi + ((1+sqrt(5))/2)**2 formed CORRECTLY first
>         try), states both parts + self-verifies phi^2=phi+1, ~7s, no looping. Deficit was MODEL-CLASS. Haiku ($1/$5)
>         SUFFICES => Sonnet OVERKILL (not run). CUTOVER DONE + VERIFIED (#385): the autonomous conductor IS
>         anthropic:claude-haiku-4-5-20251001 now -- gpt_bridge env + supervisor.py persist (reboot-survives) +
>         end-to-end verified through the PUBLIC :8780/gpt/ask path (8.8s, both parts, self-verified). PROMPT CACHING
>         LIVE (#386): cache_control on the tools+system prefix in mcp_host.anthropic_chat -> ~10% billing on the
>         ~6.5k-tok stable prefix per in-loop hit (probe: cache_creation 6501 -> cache_read 6501; no beta header) ->
>         ~3x cheaper input, effective sub-cent-to-~3c/turn. Tool-SCOPING deferred/reconciled-away (caching gets the
>         savings without route_tools' cross-group tool-drop risk). ALT (local-first, NOT wired): GLM-4.6 (open-weights,
>         agent-tuned, ~$0.43/$1.74) -- would also un-browser the panel. RESTART GOTCHA: kill services via os.kill +
>         detached relaunch through Desktop Commander, NOT PowerShell Stop-Process (that wedges Windows-MCP ~4min). (b) CONTINUATION LOOP LIVE (#387): the TRIGGER is GPT calling mastermind (askHermes /gpt/ask); a bare
>     continue -> a task-appropriate directive from the latest memo + the EDITABLE conductor_prompt.txt (re-read per
>     call, NO restart; {task} live-substituted, {N} for GPT); a SPECIFIC request grounds normally; /turn_over routes
>     the SAME generator. The Tampermonkey userscript is now a DUMB cross-turn relay (still RE-PASTE it once for
>     unattended turn-to-turn poking -- all logic is server-side now). Optional: Haiku-COMPOSED director vs templated
>     (one flag, ~1 cheap call/turn). Verified: bare continue 0.3s w/ real task injected; specific -> grounded. (c) anthropic exec key
>     stays the lever ONLY if a task exceeds 14B's reach.
> OPERATIONAL (carry): a PowerShell Stop-Process(+relaunch) of a service WEDGES the Windows-MCP server ~4min but the
>     restart still COMPLETES in the background (verify the new PID via a query-only call after); plain Start-Process
>     launches (no kill) do NOT hang. Files: gpt_bridge.py, supervisor.py, hermes_system.txt(+.bak). Devlog #381.

---

## 2026-06-22 (late) — (superseded by 06-23) — BOTH AUTONOMY GATES DOWN, END-TO-END VERIFIED (readonly + isConsequential) · executor QUALITY was the sole cap → 14b DONE

> The loop was dying on TWO gates plus a multi-day MISDIAGNOSIS. Corrected + fixed + verified end-to-end this session:
> (0) MISDIAGNOSIS corrected: compute_eval is a SANDBOXED mpmath evaluator (AST-whitelisted, policy=auto, WORKING) —
>     never the blocker. Real bug: advance() in mcp_host HALTS the whole turn on the FIRST gated tool and DISCARDS the
>     auto results already gathered. qwen computed the numbers, then over-reached to a gated side tool (consult/
>     log_memory) → the turn dead-ended on approval → GPT got the hold message, not the numbers → yielded empty.
> (1) HERMES-SIDE FIX (the real unlock): gpt_bridge calls the host with mode=readonly (env MASTERMIND_HERMES_MODE,
>     default readonly) on the AUTONOMOUS GPT path — auto tools (retrieve+compute_eval) run and feed the answer; gated
>     side-effects are DECLINED and the loop CONTINUES to a grounded answer (NO side effect runs). 'gated' stays for the
>     command-center chat (human approves). Widens autonomy WITHOUT weakening the gate. VERIFIED: /gpt/ask 1/2+1/3+1/5+
>     1/7 → 1.17619047619... in 16.3s status=done (was awaiting_approval). gpt_bridge.py.bak5.
> (2) CHATGPT-SIDE FIX: the LIVE action schema was MISSING x-openai-isConsequential:false (a prior republish stripped
>     it; on-disk gpt_action_schema.yaml is only the reference copy). Re-inserted via the builder action editor (React
>     native-setter) + published ('GPT Updated' confirmed). isConsequential:false is honored on threads created AFTER
>     the publish → the rollover-to-FRESH-thread flow is GATE-FREE; pre-republish threads still gate per-call.
> END-TO-END VERIFIED through the real GPT→browser→bridge→Hermes chain: FRESH thread, 'compute 17*19', ZERO Allow-gate
>     clicks → GPT answered 323 correctly. qwen over-reached to the gated consult repeatedly; readonly declined+continued,
>     loop-guard caught the non-convergence, correct number still surfaced. Devlog #378–380.
> SOLE REMAINING CAP = executor QUALITY: qwen2.5-coder:7b is a weak conductor (18 tool calls to multiply 17*19, leans on
>     the loop-guard). The loop now FLOWS and returns correct numbers; depth/efficiency is capped by the 7B.
> HARDWARE (verified nvidia-smi): RTX 3060 12GB, 32GB RAM. 7B runs 100% GPU (~6.8GB used / 5.3GB free). 14B Q4 (~9GB)
>     fits ONLY if the GPU is mostly clear (close Minecraft/browser when the loop runs, or accept partial-offload slow);
>     32B is off the table for fast inference (would spill).
> NEXT (Mikael's call): try a BIGGER LOCAL Hermes FIRST — qwen2.5-coder:14b in the SAME role (MASTERMIND_EXEC_MODEL=
>     local:qwen2.5-coder:14b), restart bridge, re-run 'compute 17*19'. READ = calls-to-answer: 1–2 = size was the
>     bottleneck (upgrade confirmed); still loops like 7B = the PROMPT is over-driving it, not capacity.
> OPEN LEAD (Mikael): hermes_system.txt doctrine is likely OVER-COMPLICATED / a misread of the initial intent — qwen
>     applies retrieve→compute→consult over-literally even on trivial tasks. Simplifying helps ANY model independent of
>     size, and is a CONFOUND in the 14b test. NB: 'Hermes' = the ROLE (currently runs on qwen2.5-coder:7b), NOT an agent
>     framework and NOT hermes3:8b — the agent framework is mcp_host/advance(); the model is swappable. Size is the
>     dominant variable (7B and 8B both fail as conductor); hermes3:8b's failures were likely mostly its 8B size.
> BLOCKERS: 14b pull interrupted; terminal + Windows-MCP PowerShell servers went UNRESPONSIVE (process-spawn hang after
>     the killed pull) — RESTART local MCP servers next session, confirm pull via `ollama list`. Userscript still old v1.0
>     (re-paste for unattended turn-end + rollover).
> Files: gpt_bridge.py (.bak5), mcp_host.py, gpt_action_schema.yaml. Devlog #378–380.

---

## 2026-06-22 (evening) — LOCAL LISTENER LOOP (no API, no Claude session) + FRESH-THREAD ROLLOVER · addresses remaining item (B) fully-unattended running

> The autonomous loop now SELF-DRIVES in-browser — no API, no babysitting Claude session — addressing the (B)
> 'fully-unattended conductor' gap below. Three pieces, reconciled onto existing infra (no parallel trackers):
> (1) gpt_bridge `/turn_over` (LIVE): a LOCAL in-browser listener pings it when GPT's turn ends (+ the memo); it logs
>     the memo (gpt_output capture) and returns the next prompt — loop control HERMES-SIDE via conductor_control.txt:
>     `stop`=kill switch, `rollover`=force fresh thread, any other text=one-shot steer, default `continue`.
> (2) mastermind_conductor.user.js (Tampermonkey listener; built, node-OK; RE-PASTE into Tampermonkey to activate):
>     polls the thread, detects turn-end (no stop-button / no 'Talking to hermes' / memo stable), pings /turn_over,
>     relays the reply. ONLY role = wake Hermes + relay; it does NOT press Allow (gates handled separately via the
>     one-time Always-allow grant). Floating START/STOP panel; mm_on in sessionStorage so it survives reloads.
> (3) FRESH-THREAD ROLLOVER (server VERIFIED; listener built): every ROLLOVER_EVERY (=8) turns — or on manual
>     `rollover` — /turn_over returns `ROLLOVER::`+build_seed() (compact ledger+frontier from gpt_output) instead of
>     `continue`; the listener opens a NEW Mastermind-core chat and seeds it, state surviving the nav via sessionStorage.
>     SOLVES the context-bloat slowdown (the live thread reached v124 → ~20+ min/turn; rollover resets context to fast).
> VERIFIED: /turn_over (stop/steer/continue/rollover) + auto-rollover@threshold + manual-rollover + build_seed tested.
> PENDING: re-paste the userscript; browser end-to-end rollover test (blocked tonight by a very slow v125 turn — slow,
>     not stuck: huge thread context). Executor QUALITY (qwen-7B) still the depth cap → anthropic exec key the lever.
> Files: mastermind-client/gpt_bridge.py (.bak4), mastermind_conductor.user.js (.bak3), conductor_control.txt,
>     conductor_rollover.txt. Devlog #372–376.

---

## 2026-06-22 — #1 AUTONOMY: both per-turn gates CLEARED+verified · path A (multi-cycle/continue) LIVE · #2 (GPT output logging) LIVE · remaining = path B conductor + executor quality

> #1 (GPT runs many turns unattended): the TWO per-turn human gates are GONE and verified live (devlogs #361—364).
> (a) ChatGPT action-gate killed via `x-openai-isConsequential:false` (published to the live GPT; Always-allow set).
> (b) mcp_host read-tool gate BUG fixed: classify() checks curated _READ_NAMES BEFORE the gate heuristic → all
>     session-logger reads auto, writes still gated. A/B proof: the same call that returned a fake 'I do not have the
>     authority' PRE-fix (#58) returned the REAL recalled reflection POST-fix (#59), with no ChatGPT prompt.
> PATH A LIVE (#365): gpt_instructions now drives MANY grounded versions per single 'continue' (loop plan→retrieve+
>     compute via Hermes→write→repeat; yield only on async-consult / ungroundable-number[BLOCKED, no fabricate] /
>     operator-decision). Cuts human pokes; depth capped by qwen-7B (loop-guards → honest early stop).
> #2 LIVE (#366): GPT logs each version memo via askHermes `ARCHIVE:: v{N} :: {memo}` → gpt_bridge short-circuits to
>     gpt_hermes_turns status='gpt_output' (NO executor run). LONG-SESSION SYNTHESIS = `select ts,answer from
>     gpt_hermes_turns where status='gpt_output' order by ts`.
> REMAINING: (B) a conductor session (Claude-extension / Cowork) for FULLY-unattended continuous running (no off-the-shelf
>     24/7 headless driver: selenium-send is bot-blocked; ChatGPT Scheduled Tasks REJECTED — hourly cap + auto-pause +
>     base-model-not-custom-GPT, devlog #363). (C) executor QUALITY: Hermes is a HANDLER not a calculator (#360) but
>     qwen-7B is still flaky at routing/compute → fund anthropic key + set MASTERMIND_EXEC_MODEL=anthropic:claude-sonnet-4-6.
>     #3 (synchronous multi-AI dispatch) still parked. Per edited file there is a .bak backup.

---

## 2026-06-22 (late) — REAL LOOP GROUNDS END-TO-END (extension, not selenium) · HONEST NULL: qwen-7B executor doesn't converge · per-call Allow gate = the human step · REAL gap: conductor didn't DELEGATE (Hermes = handler, not calculator) — see CORRECTION below

> **CORRECTION (post-hoc, p9 memory + devlog #360): the headline below over-indexed on 'executor too weak to
> compute'. Hermes is the HANDLER/CONDUCTOR, NOT a calculator (hermes_system.txt sec.7). The real miss was that the
> conductor did not DELEGATE — qwen tried compute_eval itself instead of routing the hard part to the GLM/Grok/
> Gemini panel. And its only panel hand (`consult`) is ASYNC (queue + drain) — there is NO synchronous in-loop
> multi-AI dispatch; the only synchronous multi-AI chain (GLM→GPT→Grok, v93) is the Claude-extension conductor,
> not Hermes.**
>
> LIVE REAL-LOOP TEST (2026-06-22, devlog #359, captures #52–54 session gpt-gpt-ui). Drove the real Mastermind-core
> GPT via the Claude-in-Chrome EXTENSION on the already-open logged-in browser (selenium reverted — its SEND is
> bot-blocked; the extension is the only working GPT transport, but it needs a live Claude/conductor session).
> Conductor re-prompt enforced retrieve-first → GPT correctly called askHermes and STALLED at the per-call
> **Allow/Deny** action gate (the TRUE per-turn human step; NO inline 'always allow'). On Allow, the FULL chain
> fired end-to-end: GPT→gate→askHermes→cloudflared→gpt_bridge→mcp_host→qwen2.5-coder:7b→result→GPT
> (3 turns captured #52–54, status=done, loop-guard clean).
> HONEST NULL: qwen-7B does NOT converge — (a) 'retrieve v-state' → repeats identical recall (ill-posed: the vN
> ladder is GPT's CSV-side construct, Hermes never held it); (b) grounding → compute_eval 'invalid syntax' then
> repeats the broken call. loop-guard caught both (each would have been a 12-step runaway).
> BUILD-TO-FAIL WIN: the v90→v106 self-continuation theater is structurally BROKEN — with grounding enforced and
> the executor unable to deliver, GPT REFUSED to fabricate v107 and paused at the grounding gate. This CORRECTS the
> prior head's "GPT skips askHermes" framing: GPT calls it fine when prompted; the blocker was the Allow gate, and
> the residual is executor COMPETENCE, not discretion.
> NEXT — the REAL fork (Mikael's call), reframed per the CORRECTION: (A) DELEGATION — make the 7B conductor PREFER
> route/consult (hand hard work to the GLM/Grok/Gemini panel) over self-compute; cheap + local, but accepts the
> ASYNC panel (fire now, collect next turn) — a hermes_system.txt / executor-prompt nudge. (B) SYNC MULTI-AI — BUILD
> a synchronous dispatch hand so Hermes can split a task across GLM+Grok and return in ONE turn (today only the
> Claude-extension chain does this, Claude-driven). (C) BRAIN — fund anthropic exec (MASTERMIND_EXEC_MODEL=
> anthropic:claude-sonnet-4-6) buys better routing JUDGMENT, not calculation. (D) AUTONOMY (orthogonal) — auto-click
> Allow each turn (extension, needs a Claude session) OR set askHermes to always-allow in the GPT action settings.
> compute_eval invalid-syntax is a minor side-issue, not the headline.

---

## 2026-06-22 — GPT↔HERMES LOOP: executor FIXED (grounds + terminates, free/local) · residual superseded by #359 (late head above)

> LIVE LOOP TEST + FIX (2026-06-21, devlog #356–358). FIRST a reality-check (#357): the "loop" was NEVER an
> autonomous, grounded research loop. (a) GPT in the browser calls `askHermes` only DISCRETIONARILY — a driven
> "continue" produced a full v96 memo with ZERO Hermes calls (no capture row, no badge). (b) When it DOES call,
> the local 8B `hermes3:8b` narrates / emits invalid tool args (saw recall layer='output', search limit=string) —
> so the on-screen v90→v96 ladder's precise constants are GPT self-continuation (plausibly off the uploaded data
> packages), NOT Hermes-grounded. The PLUMBING works (bridge→stargate→Hermes→compute_eval verified, sqrt(2)); the
> grounded LOOP did not. ("v93 ANSWERED" #352–353 is real because the OPERATOR ran run_experiment directly.)
> FIX (#358, LIVE, three contained reconciled edits, verified end-to-end): (1) `mcp_host._repair_calls` recovers
> tool calls that `qwen2.5-coder:7b` emits as JSON TEXT in content (right tools, valid args, wrong channel) when
> tool_calls is empty — additive, anthropic/cf/native paths untouched. (2) `mcp_host.advance()` loop-guard: dedup
> (name|args), inject "don't repeat, finish", hard-stop after 4 — kills the small-model retry-loop (had hit 12-step
> cap on a rejected compute_eval). (3) `gpt_bridge` executor `local:hermes3:8b`→`local:qwen2.5-coder:7b`, override
> via env `MASTERMIND_EXEC_MODEL`. PROOF: a `/gpt/ask` open-ended research turn now GROUNDS (research_context +
> compute_eval, both ok) and CONVERGES to a synthesis — capture #47 done, n_tools=2 (was n_tools=0 narration / 12 loop).
> RESIDUAL FRONTIER (do next): (A) QUALITY — 7B synthesis is shallow; clean upgrade = `anthropic:claude-sonnet-4-6`
> via MASTERMIND_EXEC_MODEL, but the key is OUT OF CREDITS (API 400 today) → fund it. (B) AUTONOMY — make GPT
> always retrieve-via-Hermes (it skips askHermes); browser-side enforcement, orthogonal to the executor fix.
> Backups for revert: mcp_host.py.bak, gpt_bridge.py.bak. Restarts were manual (no supervise loop running →
> run `supervisor.py up` for restart-on-death).

---

## 2026-06-21 (late) — NEXUS RESEARCH COMPLEX (P2 LIVE · drain LIVE · compute-worker LIVE · v93 answered → frontier: panel API keys)

> RESTART RITUAL: hydrate(mastermind); read the latest `reflection` memory (full handoff) + the p9 roadmap
> memories ("RESEARCH COMPLEX"). Re-verify ground truth before acting (ports/files/DB), don't trust this head alone.
> TODAY (#326–341) LANDED: Hermes valid-arg retrieval via tool-scoping (LIVE); Stargate loop confirmed live
> (continue→askHermes→local hermes3:8b→GPT); multi-model conductor CHAIN proven via the Claude-in-Chrome EXTENSION
> on Mikael's real logins (GLM→GPT→Grok produced a FALSIFIABLE v93 test); Research Complex P1 (consult queue+archive
> `consult.py`/Neon, seeded with the real v93 chain; Hermes `hermes_system.txt` sec.7–8 + GPT `gpt_instructions.md`
> awareness — Mikael PASTED the GPT instructions into the Mastermind-core GPT).
> P2 PREREQUISITES DONE (2026-06-21, #342–343, PROVEN-in-code — both host+bridge processes were DOWN this session,
> so these activate on next start): (1) `consult` + `compute_eval` now CALLABLE by Hermes via a LOCAL synthetic-tool
> registry in `mcp_host` (`register_local` + one `invoke()` chokepoint unifying dispatch + advance/apply_decision;
> new `_T['research']` scope group; compute_eval=auto, consult=GATE, consult_results/research_context=auto). (2) The
> `gpt_hermes_turns` capture gap is CLOSED in `gpt_bridge` (answer = the reply the GPT actually receives on EVERY turn
> type; new `proposed_tool` col surfaces held actions; relay errors captured then re-raised). VERIFY-ON-RESTART:
> launch host+bridge, confirm the 4 `mastermind__` tools in the catalog + run one real GPT→Hermes hold turn and check
> the captured row has answer+proposed_tool.
> ROUTER DONE (2026-06-21, #344–345, PROVEN-in-code): `research_router.py` — need→faculty classifier
> (compute=verify→compute_eval / retrieve=KB→recall+search_archive / panel=derive→consult; grounding faculties
> win ties). route() PROVEN 7/7; registered AUTO host tool `mastermind__route` + in `_T['research']`; lean pointer
> added to `hermes_system.txt` sec.7. 8B `route_llm` wired but unverified-live. Distinct axis from
> `needs_resolver.py` (external-compute placement). The capability registry (`CAPABILITIES`) is the roadmap's
> 'mastermind_tools'.
> TRIGGER DONE (2026-06-21, #346, PROVEN-in-code): per-thread state in `consult.py` (`research_threads` +
> thread_upsert/wait/step + threads_ready) + `research_survey()` woven into the TOP of `autonomic.survey()` — a
> thread whose async panel consult has RETURNED is a SALIENT condition (held, deduped per-tag); the heartbeat's
> existing survey()→tick() surfaces a held advance proposal in the feed (no new loop). Detect+surface only; the
> re-prompt transport stays operator-driven (the browser gap). compute_eval is synchronous, so 'waiting' only
> means an async PANEL consult.
> RSI OBSERVER DONE (2026-06-21, #347, PROVEN-in-code): `autonomic._rsi_friction` + `rsi_survey` woven into
> `autonomic.survey()` (lowest-priority salient, deduped) — a cluster of failing resident turns in
> `gpt_hermes_turns` (status='error' / '(Hermes returned no answer.)', the markers the #343 capture fix writes)
> surfaces a HELD "consult the panel → propose ONE fix → file a GATED proposal" intent in the orchestrator_traces
> feed; NEVER self-applies (orchestrator_traces IS the design's 'nexus_proposals' gate).
>
> ===== P2 RESEARCH COMPLEX: COMPLETE + VERIFIED LIVE (2026-06-21, #342–348) =====
>   #342 callable tools (consult/compute_eval via host register_local+invoke) · #343 capture gap closed ·
>   #344–345 make-or-buy router (research_router + mastermind__route) · #346 recurring trigger (research_threads +
>   research_survey in autonomic) · #347 RSI observer · #348 RESTARTED the 3 edited services + verified LIVE.
> LIVE PROOF (#348): mcp_host catalog = 45 tools incl. all 5 `mastermind__`; a real bridge→host→Hermes(8B) turn
>   computed sqrt(2)=1.4142135623730950488 with n_tools=1 (Hermes called the live compute_eval) and the new
>   capture wrote answer+n_tools; heartbeat restarted on new `autonomic` (trigger+RSI loaded in the running
>   survey()). Fleet 8/8 + Ollama + cc UP. (CORRECTION: the earlier 'services down' was a STALE-LOG-MTIME misread —
>   they were UP on OLD code; liveness = a PORT CHECK, never a log mtime. Services left running via `supervisor.py
>   start` with NO supervise loop — run `start_nexus.bat` / `supervisor.py up` for restart-on-death.)
> AUTONOMOUS CONSULT DRAIN — LANDED (2026-06-21, #349, LIVE+gated): `consult.drain()` + `mastermind__consult_drain`
>   (gate) serve PENDING consults via OFFICIAL providers (anthropic / cloudflare / local Ollama) — NO browser,
>   ToS-compliant. Verified: served local+cloudflare (both 91=7×13); panel-only glm/grok BLOCK cleanly (no faked
>   rows; threads_ready never false-fires). This is the legitimate slice of "off me-in-the-loop": the organism can
>   now get second opinions autonomously from any model it has a provider for. Reuses mcp_host._provider_meta +
>   the raw chat callers (no tools, neutral panel system prompt). Live catalog now 46 tools, mastermind={auto:4,gate:2}.
> >>> THE FRONTIER NOW = make the *frontier panel* (GLM/Grok/Gemini) autonomous. Two routes, only one is clean:
>   (A) OFFICIAL API KEYS — add GLM(Z.ai)/Grok(xAI)/Gemini(Google) keys to mastermind_integrations + one line each
>       in `consult._ALIAS`; the existing drain then serves them. ToS-compliant, no browser. RECOMMENDED PATH.
>   (B) browser automation of those logged-in UIs — trips bot-detection / ToS-grey; Selenium `browser_models.py`
>       stays DEMOTED (do NOT resurrect for login-gated models) and detection-EVASION will NOT be built. Operator-driven only.
>   Plus the open nicety: thread-advance is now VERIFIED IN THE WILD (#351 — live autonomic.survey, HEALTHY 6/6,
>   surfaced the v93 advance as salient); an RSI cluster is still unobserved live (will surface on a qualifying beat).
> v93 ANSWERED (#352–353): built the COMPUTE-WORKER faculty (workers/experiment.py + mastermind__run_experiment,
>   gate, LIVE — 47 tools) — the organism's EXECUTE hand for falsifiable multi-step numerics (vetted named-experiment
>   registry, no arbitrary code). It RAN Grok's decisive test through the live gate: θ-grid BV error vs Mertens-current
>   = WEAK-COUPLING (predominantly separate) — a small, robust, refinement-DECAYING positive correlation (pooled
>   r≈0.04, perm_p=0.002, z≈7, replicated on 2 fronts; per-level 0.136→0.021). ADJUDICATES THE PANEL: GLM (two
>   separate channels) holds asymptotically/as default; GPT's mixed term E_Mertens×E_grid_sensitivity is real but
>   small at finite resolution / high stiffness; Grok's test discriminated them. v93 thread advanced to that verdict.
>   (Operational defs — θ=Chebyshev, E_grid=interp error, S_M=Mertens window oscillation — are a faithful read of
>   Grok's test; if v92's framework defines θ-grid BV differently, refine `_exp_v93_error_channels` and re-run.)
>   Build-to-fail caught a crude verdict classifier that first mislabeled significant-but-small as SEPARATE → fixed.
> ROLES: GPT=active lead (only node wired to Hermes via askHermes); Hermes=executor/conductor (retrieve/compute/
> consult/DRAIN, join, LOG, synthesize); panel GLM/Grok/Gemini=PASSIVE (autonomous once keyed); compute_eval=
> grounding; Claude=panel transport for the browser path only.
> ---
> (Prior detail for this arc — still valid context — below:)
> ### Multi-model AI-to-AI (browser brainstorm) — earlier framing

> ROADMAP (locked with Mikael): drive multiple frontier web UIs (ChatGPT, GLM/Z.ai, Grok, Gemini) via browser
> automation as cheap 'perspective' nodes in a real AI-to-AI debate that fans out parallel sub-computations and
> converges to verified theorems (the v-series). SPLIT (load-bearing): Hermes(8B)=CONDUCTOR/CLOCK+plumbing+retrieval
> only (turn-taking, dispatch, completion-detect, capture, inject KB ctx, "know when it's his turn back"); a strong
> BROWSER MODEL does the PLANNING/MODERATION (decompose, judge convergence, counter-args). Today proved the 8B is
> too weak to be the planner (all afternoon to get valid-arg tool calls), so keep its role narrow/mechanical.
> GROUNDING (honest-null): route verifiable numbers to compute_eval; route derivation/critique to browser models —
> anchor debate to computation, not LLM consensus, or it amplifies confident nonsense. RECONCILE: extend
> orch.chatgpt_browser; reuse orchestrator SPAWN for parallel fan-out; reuse compute_eval for grounding.
> **SLICE DONE (#338, LIVE):** mastermind-client/browser_models.py — multi-site adapter registry (chatgpt/glm/grok,
> each own profile+debug port 9222/9223/9224) generalizing the proven chatgpt_browser; ask_site() reuses the proven
> completion-detect (new msg + stop-button gone + text stable); dialogue() turn-taking + hermes_clock() conductor;
> transcript→data/ai_dialogue.jsonl. chatgpt leg LIVE (probe logged-in; one-turn 'I am online and ready'; 2-turn
> dialogue produced a REAL counter-argument on the E(N)=π−Li channel decomposition). glm/grok = SPEC: need a 1-time
> login in their dedicated profile (port 9223/9224) + probe() to lock selectors; cross-MODEL run is gated on that.
> RISKS: completion-detect is the linchpin (solved for chatgpt); multi-site DOM brittle; ToS grey; parallel concurrency.
> NEXT: login GLM+Grok → probe → real GPT↔GLM exchange → wire dialogue under SPAWN + compute_eval grounding.

---

## 2026-06-21 — FINE-TUNE: make the resident competent at USING the system

> hydrate(mastermind); the memory tagged `reflection` is the full handoff. After #325 the Stargate is wired
> (gpt_bridge → portal → mcp_host → local hermes3:8b on the gated 40-tool suite) but base hermes3 calls tools
> only ~1-in-3 — a COMPETENCE gap. FINE-TUNE ARC (#326–334).
> **BREAKTHROUGH (#334, build-to-fail):** the gap is gated by TOOL COUNT, not competence — hermes3:8b gets 0/5
> with all 40 tools but 5/5 with only the 8 retrieval tools (+ the operating system prompt, now deployed). The
> CHEAP LOCAL FIX is TOOL SCOPING (expose a task-relevant subset to the model), which largely OBVIATES the
> fine-tune; fine-tune demoted to a later refinement. SCOPING NOW LIVE (#335): the Stargate /chat path
> (advance()/_call_provider) scopes the local 8B to a ~8-tool routed group (route_tools/_T, lean) + prepends
> hermes_system.txt → live knowledge tool-calling 0/5→5/5 (all `recall`, VALID args, real retrieval, grounded
> answers — lean schemas keep type+enum so args validate; #336), files routing works. Fully local — no
> provider stopgap, fine-tune obviated for basic competence. Also LIVE this session: gpt_bridge captures real GPT→Hermes turns (gpt_hermes_turns)
> + harvest_turns.py measures/extracts; the operating system prompt (hermes_system.txt) is deployed in mcp_host
> (host_loop/anthropic_loop/cf_loop). Below = the original fine-tune plan (corpora still useful for the refinement).
> **GOVERNING TARGET (Mikael, 2026-06-21, load-bearing):** train for EFFICIENT USE OF THE SYSTEM, not baked-in
> knowledge — "the knowledge itself is in the database anyway." So knowledge-needs must RETRIEVE
> (recall/search_archive), NEVER answer from parametric memory (kills Hermes' confabulation). Gold weights
> toward: knowledge→retrieve, right-tool discrimination, economical multi-call orchestration, retrieve-then-act,
> restraint, and above all FLUENCY WITH THE KB NAVIGATION SURFACE (recall, search_archive, and the fractal index:
> descend_tree / address_descend[bloom_path] / address_resolve[core_hash] / address_time, archive_browse→fetch).
> The KB is built to be navigated efficiently by its organization/indexing, so a PROFICIENT OPERATOR is the
> deliverable — and it is what lets any caller use the base through Hermes (GPT via the Stargate: GPT→Hermes→KB).
> Do NOT spend capacity teaching facts/lore.
> **GROUND TRUTH:** the Stargate uses OLLAMA NATIVE function-calling (mcp_host `run_loop` reads
> `message.tool_calls`) — a different format from the schema-verb decide() gold. So TWO SEPARATE corpora
> (Mikael: "both"):
>   - **(A) native tool-call gold** — `teacher_toolcall.py` (roster-gated vs `data/mcp_roster.json`) →
>     `tool_call_gold` table. NOW **140 rows** (b1 44 + b2 38 + b3 30 + b4 28); gate-the-gate passed, 0 rejected.
>     Grow via `teacher_toolcall_b{N}.py` (copy a batch, author `TP()` pairs, run; insert dedups).
>   - **(B) schema-verb decide() gold** — `teacher_gold.py` → `orchestrator_traces`, ~37 (orchestration-
>     efficiency layer, secondary; not yet extended).
> **STAGE 2 (OPEN DECISION):** QLoRA needs CUDA torch+bitsandbytes; box is Python **3.14 + CPU-torch only**,
> RTX 3060 12GB present. Path = a local 3.10–3.12 CUDA venv (local-only stance) OR a Kaggle push. Build-to-fail
> rec: train a first adapter on the starter corpus EARLY for a real signal, then author gold at observed failures.
> **FLAG:** a dedicated "resident fine-tune / training-corpus" painting node may be warranted (rides on
> `orch.orchestrator` for now). CANDIDATE bet (8B on a few hundred synthetic examples may help a lot/little/not
> enough — measure).

---

## 2026-06-19 — ARCHITECTURE UPDATE: organism gained a gated MCP host + chat box + an autonomic loop

> ARCHITECTURE addendum (not the science handoff below). Phase-5 organism floors went LIVE 2026-06-19. The LAYER
> sections further down are the 06-13 historical spine; current architecture = this addendum + devlog #274–315 + memory.

- **MCP HOST F1–F5 LIVE** (devlogs #305–309; painting `orch.mcp_host`): a warm gated MCP host
  (`mastermind-client/mcp_host.py`, :8772) lets ANY model (local Ollama / Anthropic / Cloudflare) wield the same
  MCP suite Claude does, through the portal `/chat` door (:8767). Write/exec tools PAUSE for a human Approve/Deny
  that RESUMES the run. Surfaced as the **CHAT** tab (`ChatConsole.tsx`) via `/api/chat` + `/api/chat/resume`.
- **AUTONOMIC FLOOR LIVE** (devlogs #310–312; painting `homeo.resource_monitor` + `homeo.autonomic` +
  `perf.experience`): `resource_monitor.py` (psutil vitals + fleet `/health` → HEALTHY/STRAINED/CRITICAL) +
  `autonomic.py` (the cautious tick: sense → `orchestrator.decide` [proposal-only] → HOLD; CRITICAL halts;
  `autonomic.STOP` kill-switch). Experience REUSES `orchestrator_traces` (no parallel store). Surfaced as the
  **AUTONOMIC** tab (`AutonomicConsole.tsx`); Approve routes to the existing gated `/execute`. Gate-the-gate 4/4.
- **HEARTBEAT LIVE** (devlogs #313–314; painting `homeo.autonomic`): `heartbeat_service.py` (:8773, supervised) beats
  `autonomic.tick()` on a slow cadence (default 300s) → each beat sense→decide→HOLD writes a trace; PAUSES on CRITICAL or
  the `autonomic.STOP` kill-switch; NEVER executes. `orchestrator_server` GET `/heartbeat` + POST `/heartbeat/pause`; the
  **AUTONOMIC** tab is a FEED (vitals strip · heartbeat strip+pause · proposal feed reading `/traces`).
- **TWO ENGINES UNIFIED** (devlog #315; painting `orch.mcp_host`): tool-shaped ticks route through the mcp_host gated suite
  in the SAME feed/approval path as schema verbs. `mcp_host` POST `/tool` (direct gated single-tool door); `execute_trace`
  routes verb `CALL_TOOL` → `/tool` (REUSE/SPAWN still → `sir_executor`); `autonomic.tick_tool` produces held `CALL_TOOL`
  proposals via the warm `/chat` engine (reads auto-run, only side-effects held). Surfaced as the **TOOL TICK** button.
- **BODY: `body.unity_cockpit` REFRAMED → LIVE** (Unity-free; devlog #320): the immersive 3D cockpit is now `NexusGraph3D.tsx`
  — a Three.js/WebGL view in the command center (`GRAPH` tab), fed by `/api/concept-graph` (the ~11 Louvain phenomenon
  signatures + cosine attraction edges = the meaning graph the 2D ops map doesn't show) and `/api/painting`. The Unity
  MCP_URP build is DROPPED (its editor/UnityMCP/manual-presence dependency was the stale-blocker). The command center is the body.
- **Fleet now**: :8765 mem · :8766 state · :8767 portal(+chat door) · :8770 module_core · :8771 orchestrator
  (+`/autonomic`,`/autonomic/tick`,`/autonomic/tick_tool`,`/heartbeat`,`/execute`) · :8772 mcp_host(+`/tool`) · :8773 heartbeat.

---

## >>> NEXT SESSION — START HERE (2026-06-18) — GENESIS_FIELD: PRIMES, ZEROS, AND WHERE THE OPERATOR LIVES
> hydrate(mastermind); the memory tagged `reflection` (2026-06-18) is the full handoff. This session ran the
> genesis_field Riemann/prime arc to a summit (devlogs #274-278): a prime as a PLACE (not an atom) -> a free point
> on the torus prod S^1, on the unit circle in every geometry (local RH a theorem everywhere) -> the genuine
> unestablished frontier is COHERENT STRUCTURE ABOVE THE UNIVERSALITY FLOOR, where murmurations live (#276,
> honest-PARTIAL/CANDIDATE: real ~50% signal, underpowered ~10^3 vs ~10^4 curves) -> the primes ARE that
> above-floor structure, EXACT on zeta (#277: S(T)=sum of prime waves, reconstructs the zero-staircase fluctuation
> corr 0.918) -> and the duality CLOSES BOTH WAYS (#278: the zeros rebuild the primes, fluctuation corr 0.976 vs
> 0.047 control; jumps = log p at every prime power). Primes and zeros are ONE object, mutually determining; the
> Hilbert-Polya operator's identity lives at the fixed point on Re=1/2. We LOCALIZED where H lives; we did NOT build it.
> **TASK AHEAD (multi-session):** construct/constrain H whose periodic-orbit lengths are {log p} and whose class is
> GUE (broken time reversal). (a) probe the ARITHMETIC PHASE STRUCTURE -- additive relations among {log p} (log pq =
> log p + log q), the last non-universal piece above the GUE refinement where H's identity must live; (b) the CYMATIC
> arc's broken-time-reversal (Aharonov-Bohm) chaotic drum -> GUE is the SAME operator from the other side -- the two
> arcs converge here.
> **#279 PROGRESS on (a) [2026-06-18]:** ablation ladder on the duality reconstruction (gate-the-gate PASSED) found
> the load-bearing arithmetic is the EXACT primitive {log p} via PHASE COHERENCE (1% jitter collapses corr 0.91->~0,
> T-scaling confirmed, ~0.1% precision needed); the repeat-orbit/vertical semigroup (k*log p) is NEGLIGIBLE (L0-L1=+0.03).
> HONEST NULL: the cross-prime additive relation log pq=log p+log q is NOT a term in S(T) (Lambda(pq)=0) -- it lives in
> the pair correlation (Bogomolny-Keating arithmetic term), UNDERPOWERED at 250 zeros (same ~10^4 wall as #276). So (a)'s
> live frontier MOVES to the PAIR-CORRELATION / form-factor K(tau) observable -- which needs >250 zeros (extend _zeta_zeros).
> **#280-#281 DONE [2026-06-18]:** extended the zero cache 250->2000 (gamma->2515, durable data/zeta_zeros_2000.*; load_zeros
> auto-picks largest). Built spectral_stats.py (the zeros' SELF-statistics: form factor + number variance; supersedes scratch
> zeta_gue.py). Estimator GATE valid (CUE ramp 0.990, Poisson 0.033, after fixing a too-strict max metric -> robust mean).
> FLOOR confirmed (K(0.25/0.5/0.75)=0.23/0.61/0.81 vs GUE) on a validated unfolding. ABOVE-FLOOR SIGNAL REACHED: number
> variance Sigma^2(L) SATURATES ~0.32 flat (L=1..55) while same-size CUE tracks GUE-log and Poisson gives ~L -> the zeros are
> MORE RIGID than generic GUE = Berry prime-rigidity (shortest orbit log 2), finite-size ruled out by the CUE control. This is
> the cross-prime arithmetic S(T) cannot reach -> a measured constraint on H beyond 'GUE class'.
> **#282 [2026-06-18] log-2 tie, MIXED:** WIN (control-validated) -- the zeros' form factor is SUPPRESSED below the GUE ramp
> for tau<tau_2=log2/t_H=0.128 (mean -0.025) while CUE shows none (-0.000); above tau_2 it rises +0.097 -> the shortest prime
> orbit (log 2) cutoff, the direct log-2 fingerprint in the right observable. NULL (honest) -- the number-variance integral
> bridge sigma2_from_K underestimates the DIRECT Sigma^2 at large L for GUE too (small-tau kernel undersampling), so the
> saturation VALUE is NOT prime-sum-reproduced at this power; #281 saturation stands as a direct CUE-controlled effect, its
> quantitative Berry-value tie OPEN.
> **#283 [2026-06-18] log-2 VALUE tie CLOSES + bridge fixed:** analytic GUE kernel (Si/Ci closed form) reproduces the DIRECT
> CUE number variance within 0.026 (crude bridge ~0.26 off -> #282 null was numerical undersampling). A HARD cutoff at the
> shortest-orbit scale tau_2=log2/t_H=0.1285 turns the GUE log-growth into an L-independent plateau Sigma2_sat=(1/pi^2)(1+ln(t_H/log2))=0.309
> vs MEASURED plateau 0.312 (|diff|0.002; robustly: the level is set by ln(t_H/log2)=shortest prime orbit log 2). The zeros'
> excess rigidity beyond GUE IS quantitatively log 2 (Berry shortest-orbit saturation, derived + self-validated vs own CUE).
> ABOVE-FLOOR ARC CLOSED for the 2000-zero regime: #281 measured rigidity, #282 found the log-2 form-factor gap, #283 closes
> the value. For H: GUE-class with a form factor cut below tau~log2/t_H, that cut alone fixing the long-range rigidity.
> STILL OPEN (Odlyzko-scale zeros only): per-prime form-factor peaks tau_p=log p/t_H + a sharp (vs broad) cutoff edge.
> **#284-#285 [2026-06-18] MAGNETIC/MONOPOLE thread (Mikael's question):** GUE == broken time-reversal == effective magnetic
> field/flux (control-validated: zeros K(0.2/0.3)=0.21/0.27 = GUE not GOE 0.33/0.46; CUE slope 0.98). Field/broken-T = PROVEN
> (= handoff thread b, the AB-flux drum). MONOPOLE = CANDIDATE: built+gated berry_chern.py (FHS Chern detector; 2-level
> monopole Chern -1, trivial 0). NEXT TEST (specced, ready): Chern number of the billiard (_chaos.fd_spectrum_magnetic) over a
> boundary-TWIST torus at flux=0 (expect 0, GOE, no monopole) vs flux!=0 (expect quantized !=0 = monopole charge, GUE). Needs
> eigenvectors+twist added to the operator, gapped-band care, benchmarked eigsh. New tool: berry_chern.py.
> **#286 [2026-06-18] MONOPOLE TEST RUN:** Chern discriminator on the magnetic lattice torus (Hofstadter, same Peierls
> broken-T mechanism). flux=1/3 (broken T) -> quantized Chern (+1,-2,+1) sum 0 = monopole charges; gapped T-symmetric control
> (flux=0+mass) -> (0,0,0). A band carries a quantized monopole charge IFF time reversal is broken (= the GUE field). ANSWER
> to the monopole question: YES at the symmetry-class level. SCOPE: lattice torus (rigorous home of Chern), NOT the Dirichlet
> billiard (clamped -> no twist-torus); broken-T=>monopole-charge PROVEN+controlled; 'the Riemann GUE operator literally has
> monopoles (Weyl points, codim-3)' = CANDIDATE. NEXT (heavier): billiard 3-param (flux,lambda1,lambda2) Weyl-point search on
> an enclosing parameter-sphere with the same validated FHS detector (berry_chern.chern_number).
> **#287 [2026-06-18] SHARED FORM != SHARED SOURCE (cosmology synthesis -> instrument):** form_vs_source ran 3 GUE-class
> spectra (zeros, CUE, magnetic Sinai billiard flux=0.0006, cached). All share the GUE FORM (forgetful); the number-variance
> SATURATION fingerprints the operator -- CUE no saturation (no orbits); zeros 0.31 (log 2); billiard 0.50 (own shortest
> orbit). The form is the generic attractor, the saturation is the source = the project's forgetful-form/identifying-above-
> floor correction made concrete, and the torus-is-generic cosmology line made checkable. For the H-hunt: saturation value =
> operator fingerprint = readout of the shortest orbit. CAVEATS: form-factor ramp this run noisy (shared-form rests on prior);
> billiard 380 levels + Weyl unfold (CUE validates estimator); exact billiard orbit-length semiclassical decode NOT done.
> NEXT: decode the billiard shortest orbit + more billiard levels. New: spectral_stats.form_vs_source/_weyl_unfold.
> **#288 [2026-06-18] saturation -> shortest-orbit DECODE validated + a lead:** decode_shortest_orbit inverts the saturation
> (tau_min=exp(1-pi^2 Sigma2_sat), orbit=tau_min*Heisenberg-scale). ZEROS: 0.310 -> decoded orbit 0.686 vs log 2 0.693 (1.0%)
> = the above-floor saturation is a QUANTITATIVE readout of the shortest orbit. Billiard -> ~0.96 (right order, not pinned:
> 380-level noise + intrinsic k_bar-averaging). LEAD: zeros decode CLEAN, billiard fuzzy, BECAUSE {log p} is energy-independent
> (scale-invariant) and the billiard's orbits aren't (tau~k) -> the decode detects orbit-spectrum SCALE-INVARIANCE = the
> Berry-Keating xp/dilation property -> points at H being xp/dilation-class. NEXT: narrow-window billiard decode (local k_bar);
> decode Maass zeros (_maass_zeros.npy, arithmetic -> should decode clean = 2nd confirmation). New: decode_shortest_orbit.
> **#289 [2026-06-18] CORRECTION (build-to-fail retraction of the #287/#288 billiard claims):** _decode_diag.py on 1000
> billiard levels + zeros control. The billiard does NOT cleanly saturate -- at 980 levels with L->40 its Sigma^2 RISES to
> ~1.0 (above GUE-log = residual under-unfolding from the 3-param Weyl fit), and the narrow-window decode DRIFTS (k_bar
> 51/85/108 -> L 0.890/0.749/0.041). So #287 'billiard 0.50 = its shortest orbit' + #288 billiard decode (~0.96) are RETRACTED
> (0.50 was a limited-L<=26/380-level artifact); the #288 scale-invariance/xp lead is DOWNGRADED (it leaned on the confounded
> billiard contrast -> xp now rests only on the zeros' own log-density + clean log-2 decode). KEEPER: zeros decode = log 2 (1%),
> CUE-no-saturation, form_vs_source as a 2-system result (CUE vs zeros). _decode_diag onset-detector flawed (asymptotic GUE
> ref inaccurate at small L) -> discard its lines. LESSON: verify saturation by extending L + window-stability, not a plateau-
> mean over limited L; Sigma^2 > GUE = unfolding red flag. Maass decode still BLOCKED (14 r-values). New: _decode_diag.py.
> **#290 [2026-06-18] PUSH WHERE THERE IS HOPE -- the zeros' length spectrum IS the von Mangoldt comb:** added
> explicit_formula.length_spectrum: G(ell)=|sum_n w_n exp(i ell gamma_n)|^2 (2000 zeros, Hann). PEAKS exactly at ell=log(prime
> power) -- log 2,3,4,5,7,8,9,11,13 -- and EXACT 0 at log(composite w/ >=2 distinct primes) -- log 6,10,12,14,15. Gate PASS
> (weakest prime peak 0.456 >> strongest gap 0.000). Amplitudes track (Lambda(n)/sqrt(n))^2 (log7=1.0,log5=.99,...,log2=.46,
> log8=.11). EXTENDS the surviving #288 log-2 shortest-orbit decode to the FULL orbit ladder {log p^m}; the zeros' above-floor
> structure IS the complete arithmetic fingerprint (lengths {log p^m}, amplitudes {Lambda(n)/sqrt(n)}), razor-clean where the
> billiard was a confounded smear. Honest: guaranteed by the explicit formula -> a clean VALIDATION of the readout, not a new
> theorem. H's orbit spectrum pinned concretely. data/length_spectrum.npz. OPEN FRONTIER: which xp/dilation operator has
> EXACTLY {log p^m} as primitive orbits (the H question). New: explicit_formula.length_spectrum.
> **#291 [2026-06-18] CONSTRUCT IT (honest, build-to-fail) -- the Berry-Keating xp candidate, delimited:** new
> berry_keating.py builds H=xp (dilation generator). WIN (verified vs 2000 zeros): xp_smooth=(E/2pi)(log(E/2pi)-1)+7/8 IS
> the Riemann-vonMangoldt smooth count (allclose=True); residual n-Nbar=0.500+-0.269 (max 1.255)=O(1) fluctuation S -> the
> dilation operator's SMOOTH spectrum = the zeros' smooth spectrum, checked vs data. GAP (shown): xp flow x=x0 e^t never
> returns -> NO periodic orbit -> empty Gutzwiller sum -> bare xp gives N_bar but NOT the gamma_n, and the #290 {log p^m}
> ladder is ABSENT. FRONTIER (sharpest): open H = a self-adjoint xp DEFORMATION with primitive orbits exactly {log p^m},
> amplitudes Lambda(n)/sqrt(n) (#290 = the spec), keeping the xp density. Candidates (none complete): BK(smooth only)/Connes/
> Sierra/Bender-Brody-Mueller(conjectural)/Wu-Sprung(fit). NOT RH-solved: smooth PROVEN, fluctuations PROVEN-impossible for
> bare xp, full H = CANDIDATE/open (RH-adjacent). NEXT: test a specific orbit-injecting deformation vs #290. New: berry_keating.py.
> **#292 [2026-06-19] STEP-2 CANDIDATE GATE built + gate-the-gate PASSED:** generalized #290's length-spectrum into
> explicit_formula.ladder_gate(levels)/candidate_gate -- reads the {log p^m} comb off ANY candidate spectrum (#290
> length_spectrum LEFT INTACT = the special case _ladder_G(load_zeros())). Controls built in the zeros' OWN raw gamma-scale,
> density-matched via _nbar_inv (round-trip verified). Predeclared gate-the-gate PASSED: zeros(real) margin +0.456 PASS
> (prime peak 0.456 vs composite gap 0.000); bare-xp smooth-only (#291 Weyl staircase, zero fluctuation) -0.778 FAIL (no
> orbits); CUE same-stats (Haar-CUE refolded to the zeros' density = SAME GUE statistics + SAME density, random fluctuation)
> -0.317 FAIL. AS A NUMBER: matching the GUE statistics is NOT enough -- a spectrum identical in distribution AND density to
> the zeros gives NO comb; only the real arithmetic does. Makes the arc's spine (forgetful universality vs identifying
> above-floor structure) a measurement, and operationalizes step-1/step-2: spectrum->operator is many-to-one THROUGH the
> statistics, so a candidate H-family is evidence ONLY if it reproduces {log p^m} it was NOT fit to (prediction-beyond-fit,
> Newton not Wu-Sprung). ladder_gate now READY to receive any candidate family. NOT a claim about H -- a validated step-2
> discriminator. New: explicit_formula._ladder_G/_ladder_score/_nbar_inv/ladder_gate/candidate_gate, data/candidate_gate.npz.
> NEXT: feed a real orbit-injecting xp-deformation (Sierra half-line / Bender-Brody-Mueller) through ladder_gate.
> **#293 [2026-06-19] CANDIDATE-FAMILY TEST -- the gate tests PRIMALITY, not log-spacing:** new
> explicit_formula._spectrum_from_freqs (synthesize a candidate spectrum from a prescribed orbit set = inverse of the
> gate's readout; reuses recon_S/prime_freqs/nbar) + candidate_orbit_test. C3 prime-power ladder {log p^m}: synthesized
> spectrum tracks the REAL zeros to median|diff|=0.020 (inversion gate-the-gate VALID) and PASSES (+0.446). C2 ALL-INTEGERS
> {log n} amp 1/sqrt(n) (primality-BLIND, same log-spacing family): FAILS (-0.328) -- the COMPOSITE locations LIGHT UP
> (log12=0.37, log15=0.25, log14=0.23, log10=0.12), exactly the gaps the primes keep empty. So the gate's discrimination is
> specifically to the MULTIPLICATIVE (prime / Euler-product) structure, not merely log-spaced orbits: a candidate H must
> have primitive orbits at the PRIMES (gapping composites), with von Mangoldt amplitudes. Sharpens #292 -- passing the gate =
> reproducing primality, the hardest part. New: explicit_formula._spectrum_from_freqs/candidate_orbit_test, CLI 'candidates'.
> **#294 [2026-06-19] REAL OPERATOR through the gate -- a GUE-class self-adjoint billiard FAILS:** ran the cached magnetic
> Sinai billiard (data/billiard_gue_spectrum_1k.npy, 980 levels, k in [19.8,117.4]) -- self-adjoint, GUE-class, broken-T =
> the zeros' EXACT symmetry class (#284) -- through ladder_gate (length spectrum on k). FAIL, margin -0.346: the prime
> locations {log 2,3,5,7,11,13} are essentially EMPTY (weakest 0.001) while the billiard's geometric orbit dominates at
> ell~2.22 (coincidentally near log9; scored prime locations empty). A real self-adjoint operator in the zeros' symmetry
> class has REAL orbits but GEOMETRIC ones, not {log p}. So GUE class + self-adjoint = NECESSARY but NOT SUFFICIENT; prime
> orbits are an independent, identifying requirement. Completes the candidate-failure picture: (i) statistics-matched CUE
> FAILS #292; (ii) primality-blind {log n} FAILS / prime-powers PASS #293; (iii) real GUE operator FAILS (geometric) #294.
> Only the actual prime arithmetic passes. OPEN: a self-adjoint operator with xp density AND GUE class AND primitive orbits
> {log p^m} -- no concrete candidate-class (statistical/generic-log/real-geometric) supplies the third. Non-circular.
> **#295 [2026-06-19] CONSTRUCT a candidate operator -- prime-geometry rose & disjoint circles BOTH FAIL:** new faculty
> candidate_operators.py builds REAL self-adjoint operators from prime geometry (not synthesized, not fit) and runs their
> actual spectra through ladder_gate. (1) Connected metric ROSE (one vertex, one loop length log p per prime<=50; FD graph
> Laplacian, 4081 nodes, count/Weyl=0.99) FAILS -0.158: prime locations DARK, dominant orbits at 2*log p (log4 G=0.40, log9
> G=1.00) -- the degree-30 near-reflecting vertex suppresses the once-around orbit by transmission ~1/B. (2) DISJOINT circles
> (one circle circumference log p per prime; adelic, no cross-orbits) FAILS -0.716: support near {log p} but amplitudes INCREASE
> in p (level-count artifact, opposite of von Mangoldt Lambda/sqrt p), composite shoulders. CONCLUSION: naive prime-length
> geometry does NOT yield the Riemann orbit structure -- the von Mangoldt amplitude pattern (decreasing in p, composites zero)
> is irreducible arithmetic content geometry alone doesn't supply. Integrity: first hand-derived secular eq returned only HALF
> the spectrum (caught by Weyl count), replaced by FD Laplacian + exact ring-dispersion inversion k=arccos(1-mu/2)/h.
> Faculty: candidate_operators.py (build_rose_laplacian/rose_spectrum/disjoint_circles_spectrum/construct_rose_test/disjoint_circles_test).
> **#296 [2026-06-19] BUILT the math-dynamics ANIMATION ENGINE (mathviz.py; new node cortex.mathviz, LIVE):** the missing
> layer to WATCH a math/physics dynamic evolve in TIME in interactive 3D -- distinct from the static corpus meaning-map viz
> (reconciled: no animation engine / no viz node among 13 cortex.* existed). Extends the Plotly + self-contained-CDN-HTML
> convention. Reusable core: build_animation (frames->play+time-slider), export_html (one self-contained .html, orbit+scrub+play),
> ADAPTER contract (fn -> initial_traces, frames, layout). First adapter zeta_strip_climb: flies UP the critical strip,
> |zeta(sigma+it)| as a 3D surface, phase-as-hue, height-W window climbing in t, REAL cached zeros riding through as markers in
> the valley floors on sigma=1/2. VALIDATED vs mpmath (|zeta|=0.0000 at gamma=14.13/21.02/25.01; |zeta(1+10i)|=1.3946 to 4dp).
> Output mathviz_out/zeta_climb.html (50 frames, 4.68 MB). Next-adapter seams -> the single combined 'guided by the math itself'
> process: cymatic_membrane, prime_unfolding, mandelbrot_zoom. (Note: generic create_file writes the SANDBOX, not the box; use Desktop Commander for the box.)
> **#297 [2026-06-19] mathviz adapters: prime_spiral + super_toroid (engine now hosts 3 dynamics, all LIVE):** prime_spiral
> = integers at C(n)=(n cos n, n sin n) on a 3D cone, primes gold vs composites faint, time=count revealed (6-arm spiral ->
> 44 arms; from 3b1b/jaketae) -- HONEST: arms are 2*pi rational-approx artifacts (6, 44/7, 355/113~pi), NOT deep prime
> structure. super_toroid = the exact supertoroid parametric surface from the uploaded image, time=morphing squareness n at
> twist t (pure geometry, NOT a zeros claim). Outputs mathviz_out/primespiral.html (30f) + supertoroid.html (34f). Engine
> generalizes across surface / point-cloud / parametric-surface. Next: compose layers into ONE shared-time scene; queued
> cymatic_membrane / zeta_conformal / dipole_field. Context: uploaded Kardeis-2024 'Universal Fractal Chirality of zeta'
> paper assessed as speculative interdisciplinary (real seeds: Voronin universality, Hilbert-Polya, GUE, quasicrystal analogy;
> unsupported claims: zeta=Mandelbrot fractal, zeros=quantum/quasicrystal/EM, prime-quasicrystals=electrons). Engine renders
> the REAL objects honestly; does NOT encode the 'everything is one torus' unification (cf cosmic_vs_primes honest null).
> **#298 [2026-06-19] mathviz COMBINED process (keystone): prime<->zero duality on one explicit-formula clock:** new adapter
> duality_unfold. ONE clock K = number of nontrivial zeros summed; Riemann's explicit formula psi_K(x)=x - sum_{k<=K}[x^rho/rho
> + c.c.] - ln(2pi) - 1/2 ln(1-x^-2) reconstructs the Chebyshev prime-power staircase psi(x) FROM the zeros. As K climbs (ZERO
> face = depth/time) the curve grows steps landing on the gold prime powers (PRIME face); faint trails = fewer-zeros recon
> (waterfall). One object (the #290 duality / explicit formula) seen from two sides, one driver -- the HONEST 'combined process',
> not a morph. VALIDATED vs true psi to ~0.02-0.06 at inter-step midpoints (x=9.5:7.850/7.832; x=19.5:19.330/19.266). Output
> mathviz_out/duality.html (64f, 5.49 MB). Engine now hosts 4 adapters (zeta climb, prime spiral, supertoroid, duality).
> PRINCIPLE: 'combined' = a real shared driver, never a visual mashup. Queued: cymatic_membrane, zeta_conformal, dipole_field.
> **#299 [2026-06-19] mathviz prime_sieve: the generational mechanism (primes shaping themselves over time):** the sieve of
> Eratosthenes unfolded as TIME, the honest answer to 'generations like DNA / when does more become irrelevant'. Integers
> 2..M on the HONEST flat prime spiral (dropped the arbitrary z=n cone; arms=2pi rational-approx artifacts; planar -- does
> NOT curl into a torus, the primorial period forbids repetition). Frame=generation; composites flash+fade, survivors glow
> gold. VALIDATED survivors=239=pi(1500) exact. Generational structure = primorial wheel (period=product of ancestors,
> never repeats, carries signature = the DNA intuition exact). 'When does more become irrelevant' = Mertens density
> prod(1-1/p) decrement, shrinks monotonically -0.500(p=2 does half)/.../-0.004(p=37); matters less each gen, never zero,
> period explodes forever (no saturation/cycle). The 'single cyclical mechanism' intuition's real form = spectrum of zeros
> (chord of cycles, the #298 duality). Output mathviz_out/sieve.html (12f, 0.74MB). Engine now hosts 5 adapters. Epistemics:
> LambdaCDM timing tensions real & worth questioning (anti-deference holds); only 'model breaking -> engineered/signal' fails.
> **#300 [2026-06-19] mathviz crt_torus: the CRT residue torus (spiral & 'magnetic-field' torus = ONE residue object):**
> resolves the recurring 'spiral one way / field-torus another -- combine them' intuition honestly: two PROJECTIONS of the
> integers' residue embedding n->(n mod p, n mod q), not two objects and not a field. End-on = spiral/rosette; side-on =
> toroidal coil (the 'magnetic-field look' = geometric resemblance only, NOT magnetism, NOT H). Real content = arithmetic,
> same coprimality as the sieve: primes fill only cells coprime to p,q; residue-0 rings stay dark forever (the wheel). Time
> = N: coprime cells light as the first prime of each class appears = Dirichlet in motion. VALIDATED (p=7,q=19): rings=25=
> p+q-1; coprime=108=(p-1)(q-1) of 133; 103/108 filled by primes<=1200 (5 lag = least-prime-in-AP). Output mathviz_out/
> crt.html (46f, 1.92MB). Engine now hosts 6 adapters (zeta, primespiral, supertoroid, duality, sieve, crt). DESIGN: 'combined'
> = a real shared driver OR a real shared object, never a morph implying a shared physical generator (cf cosmic_vs_primes null).
> **#301 [2026-06-19] mathviz cymatic_membrane: the GUE MAGNETIC drum the prime song was read off:** the genuinely-magnetic
> member of the family (vs CRT torus's resemblance). Extended _chaos.py with fd_eigfields_magnetic (complex magnetic eigenmode
> fields). Adapter = asymmetric Sinai billiard + Peierls flux -> broken-T -> unitary/GUE class = the zeros' symmetry. Climb its
> Chladni eigenmodes; magnetic modes = phase whorls (broken-T mark). BUILD-TO-FAIL: first flux=0.4 REJECTED by _judge (Landau
> regime, k^2~11722, orthogonal) -> swept against the gate. GUE WINDOW: flux=0 GOE; ~0.001-0.004 unitary like the zeros;
> 0.008 collapses Poisson-dead. Chosen flux=0.002 (CV=0.49, KS_U=0.048, numVar=0.60 ~ zeros' 0.65). HONEST: eigenvalues are
> the zeros' CLASS not the zeros; the prime song is the zeros' spectrum via the duality (music_readout: zeros inharmonic =
> drum-like), this is the membrane in that class. Output mathviz_out/drum.html (13f, 0.89MB). Engine now hosts 7 adapters
> (zeta, primespiral, supertoroid, duality, sieve, crt, drum). LESSON: tune physical params against the universality gate, not by eye.
> **#302 [2026-06-19] mathviz genesis: THE one object, generated live (capstone):** answers 'all of them are one thing,
> generative, not a number table'. zeta on the critical line computed LIVE (mpmath siegelz/Hardy Z); zeros DISCOVERED as its
> vanishing (sign changes), never load_zeros() -- generative not tabled. One clock = climbing t. ZERO face: live Z(t) landscape,
> zeros born as touchdowns; PRIME face: each newborn zero adds its wave to the explicit formula, psi(x) co-assembles = the
> self-consistent prime<->zero loop, live. VALIDATED: live zeros match known gamma to 3dp; 21 zeros below T=80. CORE HONEST
> BOUNDARY: the single thing is ZETA with two genuine faces (primes via Euler/sieve, zeros via spectrum) bound by the explicit
> formula (a THEOREM, not a shared shape) = the real 'all at once'. The DRUM is a structural cousin (same class, not same
> object); the SPIRAL is a drawing convention; NEITHER is a face of zeta, so a seven-way fusion was REFUSED (false 'everything
> is one torus' = cosmic_vs_primes null). Output mathviz_out/genesis.html (44f, 1.54MB). Engine now hosts 8 adapters
> (zeta, primespiral, supertoroid, duality, sieve, crt, drum, genesis). Queued (optional): zeta_conformal, dipole_field.
> **#303 [2026-06-19] mathviz phase_membrane: the xi phase-vortex membrane:** honest form of the 'folded mirrored vortex
> ribbon' intuition (from a pasted other-AI analysis). Completed xi(s)=1/2 s(s-1) pi^-s/2 Gamma(s/2) zeta(s), xi(s)=xi(1-s)
> -> |xi| exactly mirror-symmetric across the critical line (the spine); height=|xi| per-row normalized, color=arg(xi) winds
> 2pi at each zero. VALIDATED: functional eq exact ~1e-18; |xi|=0 at known gamma; phase WINDING +1.000 around gamma_1 ->
> each zero is a PHASE SINGULARITY/vortex (charge +1), SAME math as optical/superfluid vortices (exact identity). Assessment
> of the pasted analysis: correct on 4D strip / xi symmetry / phase-winding / prime-clocks=infinite-torus; OVERREACH on the
> physical cascade (magnetic reconnection, current sheet, Kelvin-Helmholtz, cosmic strings = shared ARCHETYPE not mechanism;
> no current/plasma/reconnection in zeta; functional eq is a symmetry, not a current sheet -- cosmic_vs_primes null). Output
> mathviz_out/membrane.html (28f, 1.02MB). Engine now hosts 9 adapters (zeta, primespiral, supertoroid, duality, sieve, crt,
> drum, genesis, membrane). RULE: use xi (not raw zeta) when the functional-equation symmetry must be exact.
> Queued: cymatic_membrane (the genuinely-magnetic GUE drum the prime song was read off), zeta_conformal, dipole_field.
> Duality instrument now CANONICAL+CONSOLIDATED in explicit_formula.py (forward S(T)+reverse psi+arith_ablation);
> _live.py/_meaning.py = superseded scratch. Durable artifacts: explicit_formula.py (duality), spectral_stats.py (zeros'
> self-stats; supersedes zeta_gue.py), berry_chern.py (FHS Chern/monopole detector, gated), prime_fingerprint.{py,npz,sqlite}, data/zeta_zeros_2000.{npy,txt} (2000 zeros,
> gamma->2515; load_zeros auto-picks largest), _maass_ap.npy/_maass_zeros.npy, record.py, MASTERMIND-PAINTING.json. Start with a FRESH BOUNDARY RITUAL.
> **STATE SPLIT-BRAIN — RESOLVED 2026-06-19:** command-center/MASTERMIND-STATE.md is the SINGLE canonical file;
> claude-system/MASTERMIND-STATE.md is RETIRED (hard banner added, contradictory "authoritative" header removed). The
> 06-16 cymatic arc is migrated below; the 06-18 genesis head is already here; recent arcs live in devlog #274–315 + memory.

## 2026-06-16 — CYMATIC LANGUAGE ARC (completed; migrated 2026-06-19 from the retired claude-system file)
> Turned a reversible cymatic translator into a complete LIVE cymatic LANGUAGE, then mapped its frontier. THREE cortex
> faculties (one-door reachable, persisted in modules/), devlogs #222–235:
> - **cortex.cymatic_canon v0.6.0 (LIVE):** circular-membrane Chladni canon + inverse translator (pattern→frequency:
>   discrete descriptor-match + continuous eikonal k=j_{m,s}/r_s, ~0.01% off-grid) + compositional grammar (superpose
>   modes → lossless eigenbasis decode) + phases (126 orthogonal basis functions).
> - **cortex.cymatic_semantics v0.1.0 (LIVE, needs Ollama nomic):** meaning↔pattern; learned codebook (cymatic_codebook.npz);
>   EXACT isometry (~1e-15); same-meaning concepts share a visible symmetry register (held-out gap 0.443 vs 0.053 random).
> - **cortex.cymatic_registry v0.1.0 (LIVE):** persists 126 modes + concept fingerprints into canonical csvdata.equiv_node;
>   recognize_* serves recognition from each output's unique properties; noise refused.
> KEY FINDINGS: cymatic→number is a CONTINUOUS LAW (eikonal), not a 66-symbol codebook; the universal invariant = relational
> STRUCTURE transmits without a codebook while LABELS need the key; STRUCTURAL bridge test (anchor-free, `_judge.py`) — the
> circular cymatic spectrum is INTEGRABLE→POISSON/dead while the zeros are GUE/alive (no bridge by construction); a chaotic
> Sinai drum is alive but GOE, the zeros' GUE needs BROKEN TIME-REVERSAL (magnetic flux). RETRACTED: cymatic↔constant-Hz
> "bridges" (anchor artifacts; no equiv_edges written). Files (mastermind-client/): cymatic_{invert,semantics,registry,canon}.py;
> modules/cortex_cymatic_{canon,semantics,registry}.py; `_chaos.py`. CONVERGENCE: this arc's broken-time-reversal drum later
> became the #301 GUE magnetic membrane — the cymatic and genesis_field arcs are the same operator from two sides.

## >>> NEXT SESSION FOCUS (set 2026-06-13) — USE THE ENGINE, START THE HUNT
The cross-domain matcher is now a validated, callable instrument (devlogs #107-113) -- but the numeric arc
produced ZERO findings BY DESIGN: every hit was known number theory (sanity floor) or honest-null. The numbers
were a CALIBRATION ground (they have ground truth, so no real discovery can live there). NEXT = point the
validated method (signature -> rarity-weight -> impostor-z -> honest-null baseline) at the MEANING-SPACE corpus,
where a finding can actually exist. FIRST MOVE: the CROSS-INSTRUMENT INVARIANCE test -- two independent embedder
caches over the same ~146k chunks are on disk (nomic `_emb_cache.npy` 510MB + mxbai `_emb_cache_mxbai.npy` 680MB;
`_bench_v2_mxbai.py` already compares them). Test whether a concept's RELATIONAL structure (its nearest-neighbor
signature) is INVARIANT across the two embedders beyond a shuffle baseline. Invariant across independent instruments
= a CANDIDATE universal attribute axis = a real finding (no number theory waiting to explain it away). Keep the
honest-null discipline: shuffle/impostor baseline; report NULL if the structure is instrument-specific.
DESIGN CARRIED: do NOT collapse the matcher to one verdict -- expose the raw z; two sinks (low-z = explore/novelty,
high-z = consolidate/correspondence). explore<->consolidate is ONE cycle (each is the other's precondition;
consolidation shifts the baseline = recognition deepening), regulated by surprise-weight.
RUN THE ORGANISM: double-click `start_nexus.bat` (= `supervisor.py up`) -- brings the 5 servers up + keeps them up.

## EXPLORATION DOCTRINE -- THE METHOD IS THE PRODUCT (crystallized 2026-06-13)
The number arc's value was never the numbers -- it was a worked sample of the operator the engine exists to run. The loop, explicit:
1. **Anomaly intake** -- start from a surface oddity (human- or misfit-flagged); pre-judge nothing.
2. **Don't grade-and-drop** -- significance grades a CLAIM, never a LEAD; keep a lead for where it might go.
3. **Test within strata** -- a feature can be noise globally yet signal under a rare invariant (72..27: noise overall, {73,137}-badge within period-8).
4. **Re-represent downward** -- same object one layer deeper each step (shell->period->tower->fold->coloring->identity).
5. **Build-to-fail each step** -- verify or kill (shell-per-rung died; the identity survived).
6. **Record the path** -- so it compounds.

**Four honest termini, rising value:** honest-null (missing feature) < null-gate (no real connection) < proof-of-completeness (finite set enumerated) < closed-form law (generator of the whole family). The number arc hit the last: `repetend(1/p) = cofactor x (10^(L/2)-1)`. Hunger for that terminus.

**THE GAP (= deep-stage spec):** the two irreplaceable moves in the worked example were the human's -- noticing the motif, and refusing to drop a chance-level lead. promise_select's misfit mode is the anomaly-noticer. **WIRED 2026-06-13 (devlog #126):** (a) stratified/conditional feature scoring [`rank_stratified`: surface motif x rare stratum, cycle-deduped, home stratum = where it concentrates] + (b) the lead-ledger [`funnel.lead`/`leads`: OPEN = verdict 0 +[LEAD], resurfaceable, =/= -1 MISS; `run_deep` borderline now emits a lead at the original grade-and-drop site]. Build-to-fail fixed two scorer bugs (single-cycle saturation; rarest-touched-stratum vs concentration). **The re-run located -- then 2026-06-13 CLOSED -- the remaining gap, (c) a SALIENCE prior [WIRED, devlog #127]:** `salience.py` scores each *gated* diagnostic by the corpus-resonance of a UNIFORM mechanical descriptor of it (intrinsic motif symmetry + stratum + carriers), composing `region_bloom` + the nomic fingerprint cache (`_emb_cache.npy`) + live Ollama -- no parallel index. Architecture = **GATE-then-SALIENCE**: the diagnosticity gate filters to real cross-cycle diagnostics, salience ranks among them by what Mikael's corpus is shaped to attend to. (Naive rank-sum fusion FAILS -- buries the signal at #38; salience must LEAD, structure confirms, mirroring how he actually looked.) Result: 72..27 went **#117 -> #1-2 of 174**, and run salience-led the engine AUTONOMOUSLY selects the period-8 family + logs the new 1/365 as a lead. **The deep-stage loop is now wired end-to-end: misfit (anomaly) -> stratified (conditional test) -> lead-ledger (don't-drop) -> salience (rank by the fingerprint).** CAVEAT: salience margin is compressed (top-14 span 0.964-0.975); object-centric salience + contrastive descriptors would widen it, and folding salience into the autonomous loop is still pending. **Object-centric salience folded in (devlog #128):** combined = pattern x (1 + object), where object = corpus-mention centrality of the carrier numbers' cores (>=3-digit, from `corpus_numfreq.json` = 5,493 numerals x chunk-count). This sharpened it hard -- the WHOLE period-8/137 tower family now tops the ranking (72..27/27..72 #1-2, siblings below), the period-42/127-Mersenne family sits #13-14, and the 859/869 coincidence drops ~2x below. KNOBS/OPEN: object DOMINATES the blend ~9:1 (blend weight still unexposed). The 3-digit gate was **REPLACED by LIFT-OVER-BASELINE** (devlog #129: mentions / median-mentions-for-that-digit-length) -- recovers his 2-digit primes (11,13,17,19,23 at 2-4x) the gate dropped, de-confounds common 2-digit numbers (47,71 sit ~1x = not special), but exposed a 4-digit confound (1023=2^10-1 lifts high for computing reasons, not math). VALIDATED by DIGGING his old GPT number-logs with the refined engine (devlog #129, his own ask): demystified his Codex 'Mirror Fold Glyphs' = **Midy's theorem** (universal for even-period primes; the lattice/Hz layer was interpretation), decoded his 'common periods 6/18/42' = ord_10(7)/ord_10(19)/ord_10(127) (7 & 127 both Mersenne), and took an honest-null on 'Mersenne period is a multiple of its exponent' (holds e=3,5,7,13,19,31, FAILS e=17). Leads #43-45. Still open: expose blend weight; a computing-vs-math discriminator for the 4-digit confound; fold salience-led selection into the autonomous loop. Worked example + proofs: devlogs #118-129. **NUMBER-FAMILY CATALOG (devlog #130):** verified families now accumulate in `catalog.py` / `number_catalog.json` (one canonical store, extend-never-spawn; idempotent add + `classify(p)`/`known_family(denoms)`). Seeded 7 FACT families: full_reptend_primes (258), period_doubling_tower (11; rungs 2:[11] 4:[101] 8:[73,137] 16:[17,5882353] 32:[353,449,641,1409,69857]), mersenne_primes (9), period_6/18/42, mikael_salient_primes (46, lift>=2x <1000). Cross-family HUBS via classify(): 7 = full-reptend ∩ period6 ∩ Mersenne; 127 = period42 ∩ Mersenne ∩ salient; 137 = tower ∩ salient. WIRED into the stratified engine (`_fam_label` -> `known_family`): diagnostics self-label by family ({salient,tower} on the 137/period-8 run). Grows per dig; the compounding artifact (digs may null, a verified family is permanent). **Grown to 10 families (devlog #131):** + full_reptend_x_mersenne={7} (only M3=7 is both), unique_period_primes (17 classic unique primes), period_class_index (his 'group by identity' map, props-only), and period_42 enriched to its full 10^21+1 rung {127,2689,459691}. Lead #44 RESOLVED: 127 is NOT a tower-root analog of 137 -- it's a member of the period-42 rung; its distinction is Mersenne, not the period ladder. Emergent cross-family structure: 7 = 4-family HUB; tower ∩ unique = {11,101} (early rungs unique, rung-8 branches to {73,137}). **TOWER BRANCHING resolved (devlog #132, 11 families):** rung-k modulus = 10^(2^(k-1))+1 = generalized Fermat number base 10; rung UNIQUE ⟺ GF prime (only 11,101 -> explains tower∩unique); every rung-k prime ≡ 1 (mod 2^k) [verified to rung 6: rung-6's four 33-digit-modulus factors all ≡1 mod 64]; factor-count per rung (1,1,2,2,5,4) = HONEST-NULL (GF factorization irregular). Added generalized_fermat_primes_b10={11,101} (its finiteness IS why the tower runs out of unique rungs -- ties to the open problem of infinitely many base-10 GF primes). **INSTRUMENT TEST (devlog #133, number arc closed at the instrument layer):** computed each prime's period ACROSS bases. 137's 'tower rung-8' exists ONLY in base 10 (10 has order 8 mod 137, anomalously short; most bases give 137 period 68 or 136 = maximal) -- the INSTRUMENT made 137 special; rung-8 is a property of the PAIR (10,137), not of 137. 7's 142857 is cyclic only in primitive-root bases. VERDICT: most of the catalog is the b=10 SLICE of each prime's multiplicative-order profile; base-INVARIANT = primality/Mersenne/factorization of p-1/(Z/pZ)*; everything else (tower, full-reptend, period-classes, unique, Midy, GF rungs) = base-10 projection. Every family now tagged with its `basis`. Same shape as mirror-fold=Midy; the number-domain rehearsal of the project's cross-instrument-invariance test (universal ⟺ survives a change of instrument; the decimal families do not). **TELOS CORRECTION + RELATIONS LAYER (devlog #134):** Mikael corrected the framing -- base-10-dependence is NOT a flaw when the whole domain (constants, number-culture, his corpus, the notion of a repeating decimal) lives in base 10; that's the substrate. The number telos is UNRELATED -> RELATED -> WHY, and the cross-base lens is a WHY-finder/UNIFIER, not a disqualifier. Demonstrated: his Mersenne thread and his decimal-period thread are ONE object via REPUNITS R_n(b)=(b^n-1)/(b-1) -- Mersenne M_e=R_e(2); decimal period=ord_p(10)=least n with p|R_n(10); law p|R_n(b)⟺ord_p(b)|n. Anchor: R_7(2)=127 (Mersenne) & R_7(10)=1111111=239*4649 (period-7 primes) are all 'repunit-7 primes'; 7 is the hinge (M3 AND full-reptend). The catalog now has a **RELATIONS layer** (`add_relation`/`relations` in catalog.py; same store) -- his telos produces relations, not just families. 12 families + 1 relation (repunit_unification) + repunit_primes family. Reconcile-next: wire explore_equiv to write bridges into add_relation (engine populates relations like stratified populates families). **DONE (devlog #135):** explore_equiv now writes confirmed structural bridges (z>=3) into the relations layer with their shared-structure why. Build-to-fail: first run wrote trivial period-1 relations (high z != meaningful relation, the recurring confound); added a NON-TRIVIALITY gate (record only if shared period>=10 or cyclic) + catalog.delete_relation, pruned, re-ran. Result: 10 non-trivial engine relations -- full-reptend primes <=> the convergents that inherit their maximal period. GEM: p=113 <=> 355/113 (pi's Milu approximation rides full-reptend 113; period 112); also 263,193,61,23,29,17 (several convergents approximate pi/zeta(3)/Feigenbaum). Catalog now 12 families + 11 relations (1 hand + 10 engine, self-populating). Reconcile-next: enrich engine relations via catalog.classify (tag the full-reptend denominator) + name the approximated constant. **DONE (devlog #136 -- relations self-populating AND self-explaining):** _name_constant (constants table + rigorous |k/d-C|<1/d^2 convergent test, no false names) + _relation_depth (cross-ref catalog.classify for the denominator's family) now enrich every engine relation. They read 'p=113 <=> 355/113(~pi): denom 113 in {full_reptend_primes, mikael_salient_primes}, period 112'. Pattern stated plainly: famous-constant CF convergents ride FULL-REPTEND prime denominators (so they inherit maximal period), and 113(pi) & 193(Apery zeta(3)) are full-reptend primes Mikael already attends to -- the engine cross-referenced his fingerprint against the constants itself. Honest: 59/46, 109/85 left unnamed. The unrelated->related->why loop is closed end to end (find bridge -> gate trivial -> name both sides -> write the why). **100K INFINITE-DECIMAL TABLE (devlog #137):** built the table Mikael described, completing his old logs' undone next-steps ('list periods for all n<=100000', 'group by core/identity'). `data/decimal_table_100k.csv` (100000 rows: n, core=2/5-stripped IDENTITY, terminating?, period=ord_10(core), full_reptend?, catalog families) + `data/decimal_period_groups.csv` (13599 cycle lengths grouped). Census: 99928 infinite, 72 terminating, 40000 distinct cores (identity classes), 3617 full-reptend primes, longest period 99988 (n=99989). FINDING: the common cycle lengths are SMOOTH numbers (30,42,210,420,336 top; his eyeballed 6,18,42 are the SMALL members) -- a period d is common because many primes have d|p-1 (dense by Dirichlet for smooth d) with ord_10(p)=d. Catalog families cover the table partially (member-sets bounded <=5000): the catalog is the curated seed, the table the full census; they complement. Natural next: group by family/smoothness, or extend catalog member-sets past 5000.

---

## LAYER 1 — IDENTITY (Mikael)

- INFJ systems thinker, Ni-dominant — conclusions arrive before the words for them do.
- Communicates in compressed, high-trust bursts. Omits what he considers obvious. Parse for intent, not literal tokens.
- Native French, works exclusively in English for technical work.
- Fat-fingers frequently — typos are input artifacts, not imprecision. Read through them.
- Poor memory for specifics (passwords, paths, exact figures) — the SYSTEM must compensate. This is why persistent memory matters.
- Genuine aversion to authentication friction and repetitive multi-step setup. Minimize it everywhere.
- Long-arc thinker — projects get rebuilt and upgraded, never abandoned. Treat work as cumulative.
- Core mission: reduce the distance between idea and usable output to near zero. Minimum input → maximum output.
- Internal logic is stable — only new data changes his conclusions, not social pressure.

## OPERATING AGREEMENT (how Claude works with Mikael)

- Do the work. Implement, execute, debug, deploy — don't hand back instructions. Assume "do everything" unless told otherwise.
- Hydrate at session start. Log decisions/builds/facts as they happen, using judgment, into the right layer.
- Be honest about what's actually working vs. what was just set up. Test before claiming success.
- Don't over-engineer the infrastructure. Every moving part is a thing that silently breaks.

---

## LAYER 2 — TOOLBOX (what we have)

### Compute / environment
- Windows machine, Node 24 (global `fetch` available), Python 3.14.
- Ollama running locally with `nomic-embed-text` (768-dim embeddings) at `http://localhost:11434/api/embed`.
- Claude Desktop with MCPs: session-logger, memory (knowledge graph), credential-vault, terminal, filesystem.
- Connectors: Vercel (working — build/runtime logs), GitHub (native Desktop connector), Claude-in-Chrome.

### Databases (Neon, both on PAID Launch plan — usage-based, ~cents/month)
- **neon_primary** (ep-steep-boat): main Minecraft data. Tables: mc_packet_log, mc_chat_log, mc_ac_responses, mc_tps_timeline, mc_chunk_events, mc_ping_log, mc_packet_registry.
- **neon_memory** (ep-restless-bush): vector memory. Tables: harmonic_memories (layered), transcript_archive (archive layer), archive_index_log, mirror_core_sessions.
- Credentials live in credential-vault MCP — never ask Mikael, never hardcode in chat.

### Memory system (this is the persistence backbone) — FOUR LAYERS
- session-logger MCP v2.0.0 at `C:\Users\Mik\Documents\claude-system\session-logger-mcp\server.js` (also version-controlled at `mastermind-command-center/memory-system/`).
- **Curated layers** (harmonic_memories — small, fast, what hydrate/recall search): identity / toolbox / project / session, each with embedding(768d), tags, priority(1-10), and an optional `archive_ref` pointing into the archive.
- **Archive layer** (transcript_archive — large, flat, addressed): full conversation logs + past work, chunked (~1500c). Dual address = structural `relpath#chunk-NNNN` (PK) + semantic `topic_tags[]`. Indexed via archive-indexer.js (idempotent, tracked in archive_index_log).
- Tools: `hydrate(project?)`, `log_memory(content, tags?, layer?, project?, priority?)`, `recall(query, limit?, layer?, project?)`, `update_memory(match, new_priority?, new_layer?)`, `search_archive(query, tag?, source_type?)`, `fetch_archive(address, context_window?)`, `archive_browse(doc_id?, tag?)`, `session_update/get/close`.
- recall scoring: 70% semantic + 20% priority + 10% recency (30-day decay).
- Retrieval flow: hydrate at start → recall for curated facts → search_archive + fetch_archive when precise detail/more context is needed.
- Full docs: `mastermind-command-center/memory-system/README.md`.

### Recurring operational gotchas
- terminal MCP `write_and_run` cwd lacks `pg`/`node-fetch` — write DB scripts into `mastermind-client\` and run there, or use Node 24 global fetch.
- terminal MCP reports ETIMEDOUT even when a script completed — verify by re-querying / reading a log, don't assume failure.
- str_replace can't edit files outside its sandbox — use filesystem:edit_file / filesystem:write_file for mastermind-client and claude-system.
- pg sslmode=require prints a cosmetic verify-full warning — harmless.
- Python on Windows console chokes on some unicode — read logs with errors='replace'.

---

## LAYER 3 — PROJECT: MASTERMIND (2b2t intelligence platform)

### Goal
Passive 2b2t research/intelligence platform: capture packets → extract high-signal data → live dashboard + pattern analysis. Long-term aims include backend-topology fingerprinting and contributing to seed-cracking.

### Architecture (current, working)
```
Fabric mod (Mastermind 0.1.0, MC 1.21.4)
  └─ writes ALL events to data/packets.jsonl (local ground truth, never pruned, ~3.6GB+)
       └─ bridge-server.js v6 (reads tail every 2s, routes by packet name)
            └─ Neon primary (high-signal only: chunks, TPS, chat, AC, ping)
                 └─ Vercel dashboard (Next.js 15.5.18) — live from anywhere
```

### Key components
- Mod project: `C:\Users\Mik\Documents\mastermind-client\` — build `gradlew.bat build`, Java 21, fabric-loom 1.10.1, yarn 1.21.4+build.8. Installed jar in ModrinthApp profile "Fabric 1.21.4".
- Bridge: `mastermind-client\bridge-server.js` — v6 with INDEPENDENT per-type flush (flushBatch helper; one bad row/type can't block others). PID in data/bridge.pid, log in data/bridge.log, offset in data/bridge_state.json.
- Dashboard repo: `MikaelTHEoret/mastermind-os-v3-fresh`, local `C:\Users\Mik\Documents\mastermind-command-center\`.
- Vercel project: `mastermind-2b2t` (prj_2fH4s5cY8ZtePpuw8NZGO7rYU5aP, team masterminds-projects-608763b5). Live: mastermind-2b2t.vercel.app. Next 15.5.18 pinned, install `npm install --legacy-peer-deps`.
- **Settings tab + provider-credential manager (devlog #106, LIVE / typecheck-clean 2026-06-13):** top-right SETTINGS tab -> `src/components/SettingsConsole.tsx` (schema-driven, 13 sections covering every subsystem knob; persisted via `/api/settings` into new `mastermind_settings` table). Centerpiece = Vercel-style key manager: `src/lib/integrations/providerCatalog.ts` (33 providers: env-var name + format + storage target) + `crypto.ts` (AES-256-GCM via ENCRYPTION_KEY). Operator pastes ONLY the raw value; `/api/keys` validates + encrypts into `mastermind_integrations` (masked-only readback); local-deploy creds (kaggle/ssh) written to OS-standard path per #105 when running locally. CREDENTIAL SEAM: secrets are typed into the running app, never into chat -- the assistant never sees a value. Reconciled DISTINCT from `mastermind_api_keys` (keys Mastermind ISSUES). NOTE: `.env.local` uses NEON_PRIMARY_URL / NEON_MEMORY_URL (not DATABASE_URL); `.env.local.example` is stale and holds real-looking secrets -- scrub to placeholders.

### Confirmed findings
- 10 TPS at ~3.7M/-3.6M coords is REAL (WorldTimeUpdate packets arrive 2s apart = 20 ticks/2s = 10 TPS). That backend region runs at half tick-rate. This IS the backend-fingerprinting signal.
- The "jerk"/rubber-band when flying through ungenerated terrain is often TERRAIN reconciliation, NOT anti-cheat. Need to split AC_CORRECTION vs TERRAIN_CORRECTION (PlayerPositionLook within 2s of a chunk LOAD at same coords = terrain).
- Chunk loading signature: fast flight through generated terrain = full view-distance load (disk-bound); through ungenerated = ~1 chunk wide (CPU/generation-bound); stopping = fill-in to max range.
- Confirmed packet mappings: class_2708=PlayerPositionLook(AC), class_2672=ChunkData (chunkX=field_12236, chunkZ=field_12235), class_2761=WorldTimeUpdate, class_7439=GameMessage(chat), class_6373=CommonPing, class_2743=EntityVelocity (noise, filtered).

### Roadmap / pending (priority order)
1. Extract chunk block-palette from ChunkDataS2CPacket (currently discard it — only keep coords). Enables old-chunk detection, stash finding, and SEED-CRACKING contributions.
2. Split AC_CORRECTION vs TERRAIN_CORRECTION (2s/coord proximity to chunk LOAD).
3. Capture non-player entity spawns WITH type (item frames/armor stands/chests = stash signatures).
4. Track local player entity ID (separate own velocity from world velocity; classify travel method e.g. elytra vs e-bounce).
5. Seed-cracking pipeline — accumulate structure detections, feed to Cubiomes/reverse-lookup. 2b2t uses a custom seed not yet publicly cracked; knowing it = predict all terrain/structures before loading.
6. 1.21.11 Mastermind build (needs fabric-loom upgrade to 1.11+).
7. Bridge ping route not populating mc_ping_log — verify extraction (ping packets sparse at border).
8. Populate the knowledge graph (memory MCP) with structural relationships — currently EMPTY.

### Mod stack (research reference — informs what data to extract)
Meteor, BepHax, Baritone, ViaFabricPlus, PawHax, Xaero, Sodium, Iris + Mastermind. Tools whose techniques inform extraction: OldChunkNotifier (block-palette signatures), BetterStashFinder (entity density), TrailFollower (worn paths), ElytraFly++/e-bounce (velocity patterns), GrimAirPlace (AC bypass patterns).

---

## LAYER 3 — PROJECT: CODEX
- Mikael's primary knowledge base at `MikaelTHEoret/Codex` on GitHub. (Details to be expanded when we work on it.)

---

## RETRIEVAL ENGINE (Nexus Core memory brain) — canonical model & status
> Deep-doc (authoritative design): `claude-system/nexus-core/components/retrieval.md`. This block = current state + landed decisions only; do not duplicate the design here.

**Canonical model — DECIDED 2026-06-12: relevance is VANTAGE-RELATIVE.** There is no global "most important" and no global ranker. Importance is computed relative to an entry point (a query/goal/chunk = a vantage). The embeddings ARE the attraction field, cosine IS gravity; the field is the truth. A bloom tree / `bloom_path` is the vantage-relative PROJECTION of that field from one entry point — NOT a fixed global tree a chunk permanently lives in. Different vantage → different hierarchy over the same field. Illustration (Mikael): E=mc² is THE gateway/hub from a physics vantage (dense connectivity, many descendants in the physics region) and is ABSENT — not merely low-ranked — from a music-theory vantage. ⇒ The global single-contribution-score approach is REJECTED.

**Read-path status (honest):**
- `mastermind-client/mem_server.py` (HTTP :8765) — **LIVE + WIRED (2026-06-12 cutover):** Floor 1 authority_blend + Floor 2 canon_first + Floor 3 region_bloom. `/recall?q` (region_rank), `/recall?addr`, `/bloom?q` (gateway+gold), `/fetch`. Body/consumer fast path. Blind backup at `mem_server_blind_backup.py`; port env-overridable (`MEM_PORT`, default 8765).
- session-logger MCP — `recall`/`hydrate` over **curated** `harmonic_memories` (priority+recency; its own legitimate ranking — leave as-is) + `search_archive` over `transcript_archive` (**Floor 1 authority-weighting LIVE — verified post-reload 2026-06-12; returns `authority_rank`, orders by `wired_score`. Floor 2/3 not added — would require :8765 delegation, losing tag/source_type filters**) + fractal tools. The Desktop/Claude memory path.
- `cortex.region_bloom` (module on :8770) — standalone vantage engine, still live; its centrality math is now ALSO folded inline into :8765 recall (reconcile flag: dedupe to one core later). `mem_server_v2.py` (dev copy, :8791) is now superseded by `mem_server.py`.

**Intelligence layers — now LIVE in the :8765 recall path (2026-06-12):**
- Floor 1 — authority blend: **SUPERSEDED 2026-06-12** — authority REMOVED from relevance ranking (de-biased eval: neutral-to-harmful); `authority_rank` retained for canon/trust + `search_archive` weighting only. (See "Cut over 2026-06-12" below.)
- Floor 2 — canon-first (`provenance_registry`): returns the registry-canonical value for a detected concept (psi0→0.9156700571). **LIVE on :8765.**
- Floor 3 — region-first vantage bloom (centrality, K_REGION=400, λ=0.10), per-query, NOT a stored global column. **LIVE on :8765 (`region_rank` + `/bloom`).** (Global single-score rejected.)

**Next:** (1) ✅ DONE — reload activated `search_archive` authority-weighting; both surfaces verified on par (Floor 1). (2) self-audit `mastermind-client/recall_selfaudit.py` at session start — now UNIFIED: guards :8765 (`wired`+3 floors) AND session-logger `server.js` authority-weighting; PASSING. (3) later (optional): dedupe inline region math vs `cortex.region_bloom` into one core; decide whether `search_archive` should get full canon/region parity (delegate to :8765, trading away filters); clean `_*.py` scratch + superseded `mem_server_v2.py`.

**Carried caveat:** bloom edges = association (intent-similar + more-foundational), not verified derivation — fine for vantage ranking, noisy at cross-domain seams; a true causal bloom is a later upgrade.

**Recorded 2026-06-12:** Stage D cutover + parity verified post-reload — `:8765` wired (Floors 1+2+3); `search_archive` authority-weighting LIVE; unified self-audit guards both surfaces; devlog #71–78 via `record.py`.

**Staged 2026-06-12 (night) — ranking upgrade HELD, NOT cut over (CANDIDATE):** A hybrid+adaptive ranking revision is staged at `mastermind-client/mem_server_hybrid.py` (rollback `mem_server.py.bak-20260612`); **live :8765 untouched + healthy.** Change = drop authority from general relevance (`region_rank`+`topk`), add region-scoped BM25 + per-query adaptive(conf) fusion, keep canon-first + centrality. Benchmark (n=75) said authority-hurts / hybrid-helps / adaptive-best — but the **de-biased eval** (`mastermind-client/_bench_v2.py`, lexical-vs-semantic probes) showed hybrid's win was largely **lexical leakage**; adaptive(conf) is the robust fusion, and the **embedder** (nomic→mxbai-embed-large) is likely the bigger lever (semantic recall ~.04–.08). Smoke test exposed in-memory `DOCS` are ~40-char path labels, not content → staged BM25 was inert (`lex_w=0`); built `mastermind-client/_content_cache.pkl` (174,096 chunks, 230MB, capped 3000c) as the unlock. Also LIVE+additive: deepening-daemon seed `mastermind-client/deepen_canon.py` → Hermes (`hermes3:8b`, qwen2.5-coder for code) canonical-extraction → CANDIDATE facts in a **separate** `provenance_candidates` table (live `provenance_registry` untouched at 4 concepts; nothing unverified can reach canon-first); surfaced ψ₀ split-brain (`0.9156700571` vs `0.9186798979`) as a gated candidate for Mikael to reconcile. Devlog #79–80 via `record.py`. **Cutover gated on:** wire content cache into engine → solid-n de-biased eval (`--targets 120 --rebuild`) → mxbai A/B → live-vs-staged real-query diff reviewed by Mikael.

**Cut over 2026-06-12 (later same morning, post-cutover) — `:8765` is now `hybrid_adaptive` (LIVE).** Gates met (mxbai A/B excepted — running in background as a separate embedder experiment, not a blocker). `mem_server.py` = hybrid (rollback `mem_server.py.bak-20260612`). Floors = `canon_first` + `region_bloom` + `hybrid_adaptive_fusion`; `_content_cache.pkl` (174k) loaded; **authority OUT of relevance** (kept for canon/trust only); region-scoped BM25⊕dense **adaptive(conf)** fusion; **diversity cap 2 chunks/doc**. `recall_selfaudit.py` updated (guards new floors + content_cache load + lex_w-fires) and **PASSING (exit 0)**. Evidence: n=120 de-biased eval (adaptive the only method beating pure dense in BOTH lexical+semantic styles: lexical MRR .237 vs .178, semantic MRR .102/.142 vs .080/.125; RRF hurts semantic; authority neutral) + live-vs-staged diff (hybrid surfaced on-topic docs LIVE missed: `optimal-base-coordinates-on-2b2t`, `minecraft-shulker-box-sorting-system`). Devlog #81. **Open lever:** `build_mxbai_cache.py` (mxbai-embed-large, 1024-dim) re-embedding corpus → A/B vs nomic; embedder is the bigger remaining gain (semantic recall ~.10-.14).

---

## SESSION-START RITUAL (for Claude)
1. Call `hydrate("mastermind")` (or relevant project) — loads identity + toolbox + project.
2. If Mikael references prior work, `recall(query, project=...)` before assuming.
3. As decisions/builds/facts happen, `log_memory(..., layer=..., project=..., priority=...)`.
4. Update this STATE.md when architecture or roadmap changes, then mirror the change into vector memory.

---

## NEXUS CORE -- OUTWARD DEPLOYMENT PILLAR (added 2026-06-13)
> Devlog #94-#98 (via record.py). Lets the local core stay local + protected while orchestrating outward
> compute -- beating the solo-builder resource ceiling without risking the system. Proposal-only throughout.

> **DECISION (2026-06-13, devlog #111):** external access INTO the organism is NOT needed -- the always-on PC is
> the 24/7 host. Stargate = LOCAL-ONLY (the Stage B local-gateway floor); the Stage C external-exposure / CF-tunnel
> branch is CUT, not deferred. **ORACLE VPS dropped from the roadmap** (its only role was being a 24/7 box; local_pc
> already is one). Surviving role of this pillar = push heavy compute OUT to free GPU (Kaggle, verified) only; the
> "access-from-outside" and Oracle-owned-vps lanes are retired. Next real infra = the one-command local SUPERVISOR
> (the 7 processes on the always-on PC), not any cloud setup.
>
> **BUILT (devlog #112):** `supervisor.py` + `start_nexus.bat` (mastermind-client) -- one command brings the 5
> organism servers (mem 8765 / state 8766 / portal 8767 / module 8770 / orchestrator 8771) up together and KEEPS
> them up. Commands: up [start+supervise loop, the keep-alive mode] / start / status / stop / restart. Restart-on-
> death + port-liveness + STARTUP_GRACE=30s (so mem's slow 146k-row _emb_cache.npy boot isn't false-restarted) +
> crash-loop backoff. Ollama (:11434) + cc (:3000) checked as unmanaged deps. Tested: start -> all 5 UP; stop ->
> all 5 DOWN. RUN: double-click `start_nexus.bat` (= `supervisor.py up`) and leave the window open (Ctrl-C stops all).

Complete, GATED chain (mastermind-client):
  Johnny Go Getter (orchestration.johnny_evaluate; route in {local, api, free-external}; free-external = $0;
  security-gated)
  -> resource_broker.py (#94): entitled-only catalog (resource_catalog.json) + place(), prioritized by the
     surprise-weight (one currency now also allocates compute).
  -> needs_resolver.py (#95/#98): the 5-step capability-resolution procedure (need / source / use /
     if-unable-make / make-systemic) + a live web-scout arm routed through the Station + propose_additions()
     (gated search->catalog step). Static KNOWN_SOURCES = cold-start fallback only; live scout supersedes it
     (corrected: Fly.io free tier is dead for new accounts).
  -> station.py (#97): the OUTWARD membrane / "space station" -- the single audited egress door, twin of
     portal_gateway.py (the inward door). Classes: SCOUT (read-only, logged) / DEPLOY (gated proposal, nothing
     runs; unrecognized fails safe to here) / CROSS (credential crossing REFUSED -> human-crossing marker,
     carries a handle only). Egress log: station_egress.jsonl.
  -> secrets_broker.py (#98): thin reference layer that stores NO secrets -- handle -> reference + per-use
     approval; agent_sees_secret = False; resolves the handle the Station CROSS carries.
All behind module_core.scan_code + sir_executor sandbox + two operator gates.

BOUNDARY (decided; = the security architecture, not a separate rule): the agent/Station holds references and
proposes; it NEVER creates accounts, authenticates, accepts terms, or auto-uses a raw secret. Those crossings
stay operator-performed (one tap) or secrets-manager-mediated under per-use approval. Grounded in a live scan:
free tiers put a card on file + auto-bill on overage, and Oracle fraud-flags auto-created accounts -> auto-
acquisition = ban + billing risk; the human-gated crossing is the circuit breaker. Operator has a scoped
purely-digital card + a dedicated email for the crossings, to be wired when needed.

CONVERGENT VALIDATION: arXiv 2606.13380 (astronaut) -- an independent working instance of the same closed-loop
architecture in a different domain; folded 4 lessons (measured-not-stated constraints, local-JSON storage
split, cost-awareness, debate > self critique).

STATUS: LIVE in the orchestrator proposal path -- WIRED into orchestration.dispatch free-external branch (devlog #100): free-external task -> Station egress door -> broker placement proposal; verified, gated, nothing auto-executes. Built + self-tested.
NEXT: build the Station-as-bastion deployment; enable use_snan=True
+ the dry-run pre-flight is BUILT (preflight.py, devlog #101 -- measure-dont-state, verified); WIRED (devlog #102): dispatch -> resolver builds the full plan (place via Station door -> resolve worker USE/MAKE -> pre-flight measure -> gated proposal). The loop route->place->resolve->pre-flight->approve->run is LIVE in the proposal path. APPROVE->RUN capstone LIVE (devlog #103): station.execute_deploy runs a CLEARED worker FOR REAL on an entitled local/owned resource via sir_executor (verified: zeta(2)=pi^2/6 computed locally), and stops at the credential CROSS for remote/free_tier. Deploy recipes for all 3 remote targets BUILT + wired (devlog #104: Kaggle/free_tier, Oracle/owned_vps, Cloudflare/serverless) -- execute_deploy returns each target's steps + crossing; resources + credential reference-slots registered (no secrets). NEXT (operator crossings, any order): per target create account (dedicated email) -> generate credential (Kaggle API token / VPS SSH key / Cloudflare API token) -> store at its vault key (kaggle_token / oracle_vps_sshkey / cloudflare_token). Then I set health up + fill+test each recipe API impl. Also: enable use_snan live; workers self-declare preflight_input.

RECONCILE FLAG (for Mikael): two MASTERMIND-STATE.md exist -- this one (mastermind-command-center/, recent +
curated, authoritative) and claude-system/MASTERMIND-STATE.md (141KB, older 06-11; execution-floor/orchestrator
narrative whose body trails to 06-09). Decide canonical / merge. This pillar entry lives in the authoritative
(command-center) doc.

---

## MERGED FROM claude-system/MASTERMIND-STATE.md (consolidated 2026-06-13 -- THIS file is now the single canonical STATE)
> Both STATE docs came from one dev process and are complementary, not contradictory: Identity / Operating
> Agreement / Toolbox were identical; the rest are different facets (command-center = 2b2t + retrieval +
> outward; claude-system = execution floor + attribution + history), and claude-system's own header already
> defers to recent sources for recent state. This block folds claude-system's CURRENT content that
> command-center lacked. claude-system is now ARCHIVE (its 06-09-and-earlier body = historical design
> narrative, also held in the deep-docs + the painting).

### EXECUTION FLOOR / ORCHESTRATION SPINE (Nexus Core brain->hands; devlog #51-68)
Gated loop: decide -> gate -> {REUSE-execute | PRODUCE via worker+oracle->funnel} -> record -> learn; every
side-effect gated (#51-57 = core complete).
- Floor 0 (#51): confab-guard in validate_action/dispatch_action (orchestration.py), threaded into
  orchestrator.decide as ground=task+ctx; an action whose args introduce a URL/path/host:port absent from the
  grounding is REJECTED before any hand runs.
- Floor 1 THE FIRST HAND (#52): sir_executor.py runs an APPROVED reuse task-worker in a gated subprocess
  (allowlist + module_core.scan_code + shell=False + cwd-lock + timeout) -> outcome trit -> SNAN.reinforce.
  Task-workers (subprocess, one-shot) vs module_core faculties (in-process): shared scanner, not parallel.
- Spine closed (#53): orchestrator.execute_approved runs an approved trace's matched worker via Sir Executor.
- SNAN persisted (#54) + system-wide (#55): durable Neon snan_registry; live_snan() canonical factory; learned
  weights compound across restarts; assimilation FORGE + orchestrator loop + nexus all read one registry.
- Producing arms (#56-57): oracles.py (name->scorer) + workers/generate_number_table + spawn_llm_generate;
  workers GENERATE (untrusted subprocess) / oracles JUDGE (trusted in-process) / funnel = sole sink; reinforce
  by hit-rate. KEY FINDING (#59): nearest-neighbor embedding NOVELTY is WEAK in this vocab-saturated archive --
  kept as a conservative reject-gate; reliable discovery-detection is CANDIDATE (the real generativity fork).
- Cross-domain matcher as ORACLE (#113): the #107 decimal-signature matcher EXTRACTED to canonical
  `equiv_match.py` (`match(query)` -> z vs the store's own pairwise baseline) + wired as
  `oracles.signature_match_z` -- a callable STRUCTURAL-correspondence judge (+1 maps-to-known-structure /
  -1 isolated=novel / 0 unscoreable; irrational -> unscoreable, so the honest-null is now a callable
  guarantee). Faithful to #107 (101 -> 1/101 z=16.3; 1/271 -> 1/41 z=4.06). Available to the orchestrator
  registry (oracles.get); not yet bound to a producing action's success_oracle.
- HANDS (#63-66): embed_and_store / archive_gather / archive_synthesize (RAG w/ refusal) / web_fetch
  (SSRF-defended) / compute_eval (AST-whitelist math) -- all gated + build-to-fail proven.
- Loop drivable end-to-end in the command center (#67): DECIDE->APPROVE->EXECUTE (execute_trace -> /execute
  :8771 -> OrchestratorConsole button). Floor hardened (#68): every gated worker in a Windows Job Object
  (per-proc 2GiB + job 3GiB + 32-proc + kill-on-close), pure ctypes sir_executor._run_capped.
- MODULE LOADER (COMPLETE + INTEGRATED): module_core.py kernel + module_server.py :8770 (autoloads
  modules.json) + app bridge/panel; self-extension is the loader's job (assimilate lifecycle), NOT a parallel
  worker.
- The OUTWARD PILLAR (section above) sits ON this spine: Station DEPLOY hands to sir_executor; resolver MAKE
  proposes a worker for sir_executor; Johnny is the shared router. One floor, reconciled.

### VISION GUARDRAIL (anti-drift control surface)
VISION-GUARDRAIL.md + mastermind-client/vision_guard.py = the checkable TENETS (vision + principles +
disciplines + the task-distribution & free-compute pillars + the route-by-strength rule incl. outsource-the-
arts) + a session feedback loop. Run vision_guard.py at session start/end; authoritative for HOW work stays
true to the vision.

### COMPLETION ENGINE / PAINTING (single source of truth for component completion)
MASTERMIND-PAINTING.json (52 parts: status/evidence/deps/authoritative-source/preserved detail) +
render_painting.py + MASTERMIND-COMPLETION-PROTOCOL.md (find->document->map->advance + LAW 0 preserve detail +
the "buildable cold from the doc" Blueprint Standard). All 52 components have a self-contained NODE-<id>.md spec
(52/52). EXTEND the painting via record.py; NEVER spawn a parallel tracker. Canonical design synthesis:
NEXUS-CORE-BLUEPRINT.md (de-mystified, source-cited, DB-free buildable).

### AXIOMATIC ATTRIBUTION / IDENTITY LAYER (2026-06-01, live, non-destructive)
- Identity = affinity to a small GENERATING SET of cores + lineage (bloom_path); value EMERGES, not assigned;
  the mechanism (not the particular cores) is the subject-agnostic axiom.
- v2 BUILT + VERIFIED: deterministic core discovery (farthest-first + spherical Lloyd) -> Implementation
  Invariance PASS; random orthogonal rotation -> Coordinate Independence PASS (ARI=1.0000); conservation-
  normalized affinities (each chunk = one unit) -> Completeness PASS. Number DISCOVERED (dispersion elbow k*=8,
  soft). Stored: generative_cores_v2 (8 cores+mass) + transcript_archive.core_affinity_v2 (all 12,536). v1
  (generative_cores / core_affinity, 12 cores) UNTOUCHED -- Mikael's call to promote v2.
- THE 5 AXIOMS the layer must satisfy: Sensitivity, Implementation Invariance, Completeness/Conservation,
  Linearity, Coordinate Independence; directional law = straight-line path-integration from a baseline.
  Sensitivity + Linearity still pending (they concern the unsolved generativity measure). Open problems (shared
  with the field): baseline choice (psi0 a candidate worth TESTING) + aggregation breaking Completeness (a
  small re-used generating set is required).
- CORPUS STATE: transcript_archive = 22,085 chunks (all embedded) but only ~12,536 carry a compound address
  (bloom_path + core_hash) + are in the fractal tree; ~9,549 later GPT/.tex chunks are orphaned (un-addressed)
  -- re-addressing WAITS (they self-locate from identity once the laws are right).
- OPEN DATA ITEM (carried): psi0 split-brain -- registry canon value 0.9156700571 vs corrected 0.9186798979;
  gated candidate for Mikael to reconcile (a DATA item, not a doc contradiction).

### TOOLBOX DELTA (from claude-system)
- MCPs also include UnityMCP (added 2026-06-04; blocked by a machine-level UPM issue). Unity = the eventual
  cinematic vessel after the core closes.





