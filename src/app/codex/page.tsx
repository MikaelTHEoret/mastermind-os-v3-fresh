'use client';

import { useState, useEffect, useCallback, type CSSProperties } from 'react';

// --- palette, reconciled to src/lib/theme-config.ts ---
const C = {
  cyan: '#00ffff',
  magenta: '#ff00ff',
  violet: '#8a2be2',
  gold: '#ffff00',
  green: '#00ffaa',
  muted: '#7a8a99',
  white: '#ffffff',
  bg: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
  card: 'rgba(0,0,0,0.78)',
};
const ORBITRON = "'Orbitron', 'Segoe UI', monospace";

const srcColor = (s: string | null): string =>
  (({ transcript: C.cyan, document: C.violet, code: C.green, data: C.gold, datasheet: C.magenta } as Record<string, string>)[
    s || ''
  ] || C.muted);

type NodeT = {
  address: string; source_type: string | null; doc_id: string | null; title: string | null;
  tags: string[] | null; evidence_class: string | null; subject: string | null;
  core_hash: string | null; chars: number | null; content?: string; snippet?: string; sim?: number;
};
type DocT = { doc_id: string; chunks: number; source_type: string | null };
type Stats = { chunks: number; docs: number; addressed_core_hash: number; by_source_type: Record<string, number> };
type Sheet = { node: NodeT; neighbors: NodeT[]; siblings: NodeT[] };

export default function CodexNavigator() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [docs, setDocs] = useState<DocT[]>([]);
  const [docFilter, setDocFilter] = useState('');
  const [srcFilter, setSrcFilter] = useState('');
  const [view, setView] = useState<'home' | 'search' | 'doc' | 'node'>('home');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NodeT[] | null>(null);
  const [searchErr, setSearchErr] = useState('');
  const [docChunks, setDocChunks] = useState<{ doc_id: string; chunks: NodeT[] } | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [addr, setAddr] = useState('');

  const api = useCallback(async (q: string) => {
    try {
      const r = await fetch(`/api/codex${q}`);
      return await r.json();
    } catch (e) {
      return { error: String(e) };
    }
  }, []);

  useEffect(() => {
    (async () => {
      setStats(await api('?op=stats'));
      const d = await api('?op=docs&limit=400');
      setDocs(d.docs || []);
    })();
  }, [api]);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true); setView('search'); setSearchResults(null); setSearchErr('');
    const r = await api(`?op=search&q=${encodeURIComponent(q)}${srcFilter ? `&source_type=${srcFilter}` : ''}&k=20`);
    if (r.error) { setSearchErr(r.error); setSearchResults([]); }
    else setSearchResults(r.results || []);
    setLoading(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [api, srcFilter]);

  const openDoc = useCallback(async (doc_id: string) => {
    setLoading(true); setView('doc'); setDocChunks(null);
    const d = await api(`?op=doc&doc_id=${encodeURIComponent(doc_id)}`);
    setDocChunks({ doc_id, chunks: d.chunks || [] });
    setLoading(false);
  }, [api]);

  const openNode = useCallback(async (address: string, pushPrev?: string) => {
    setLoading(true);
    const n: NodeT = await api(`?op=node&address=${encodeURIComponent(address)}`);
    const nb = await api(`?op=neighbors&address=${encodeURIComponent(address)}&k=10`);
    let siblings: NodeT[] = [];
    if (n.core_hash) {
      const c = await api(`?op=concept&core_hash=${encodeURIComponent(n.core_hash)}`);
      siblings = (c.chunks || []).filter((x: NodeT) => x.address !== address);
    }
    if (pushPrev) setHistory((h) => [...h, pushPrev]);
    setSheet({ node: n, neighbors: nb.neighbors || [], siblings });
    setView('node'); setLoading(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [api]);

  const back = useCallback(() => {
    if (history.length) {
      const prev = history[history.length - 1];
      setHistory((h) => h.slice(0, -1));
      openNode(prev);
    } else {
      setView('home'); setSheet(null);
    }
  }, [history, openNode]);

  const shownDocs = docs.filter(
    (d) => (!srcFilter || d.source_type === srcFilter) && (!docFilter || d.doc_id.toLowerCase().includes(docFilter.toLowerCase())),
  );

  // ---- small style helpers ----
  const panel = (accent: string): CSSProperties => ({
    background: C.card,
    border: `1.5px solid ${accent}`,
    borderRadius: 12,
    boxShadow: `0 0 18px ${accent}44, inset 0 0 12px rgba(0,0,0,0.5)`,
  });
  const badge = (color: string): CSSProperties => ({
    fontFamily: ORBITRON, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
    color, border: `1px solid ${color}`, borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap',
  });
  const resultCard = (r: NodeT) => (
    <div key={r.address} onClick={() => openNode(r.address)} style={{ ...panel(C.cyan + '55'), padding: '12px 14px', cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ color: C.cyan, fontSize: 13, fontWeight: 600 }}>{r.title || r.subject || r.doc_id}</span>
        {r.sim != null && <span style={{ color: C.magenta, fontSize: 11, fontFamily: ORBITRON, whiteSpace: 'nowrap' }}>{r.sim.toFixed(3)}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
        <span style={badge(srcColor(r.source_type))}>{r.source_type || 'misc'}</span>
        <span style={{ color: C.muted, fontSize: 10, wordBreak: 'break-all' }}>{r.doc_id}</span>
      </div>
      <div style={{ color: '#c9d4de', fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{r.snippet}</div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.white, fontFamily: 'ui-monospace, monospace', padding: '28px 22px 80px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 6 }}>
          <h1 style={{ margin: 0, fontFamily: ORBITRON, fontSize: 30, letterSpacing: 3, color: C.cyan, textShadow: `0 0 14px ${C.cyan}` }}>
            &#11041; CODEX NAVIGATOR
          </h1>
          <span style={{ color: C.violet, fontFamily: ORBITRON, fontSize: 11, letterSpacing: 2 }}>living knowledge navigator</span>
        </div>
        {stats && (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', color: C.muted, fontSize: 12, marginBottom: 16 }}>
            <span><b style={{ color: C.cyan }}>{stats.chunks?.toLocaleString?.()}</b> nodes</span>
            <span><b style={{ color: C.violet }}>{stats.docs?.toLocaleString?.()}</b> documents</span>
            <span><b style={{ color: C.gold }}>{stats.addressed_core_hash?.toLocaleString?.()}</b> concepts</span>
          </div>
        )}

        {/* search — primary entry, always visible */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(query); }}
            placeholder="search the archive…  (semantic — e.g. &quot;riemann zeros as phase singularities&quot;)"
            style={{ flex: 1, background: 'rgba(0,0,0,0.55)', border: `1.5px solid ${C.cyan}`, borderRadius: 10, color: C.white, padding: '12px 16px', fontSize: 14, outline: 'none', boxShadow: `0 0 14px ${C.cyan}33`, fontFamily: 'ui-monospace, monospace' }}
          />
          <button onClick={() => runSearch(query)} style={{ ...badge(C.cyan), cursor: 'pointer', background: `${C.cyan}18`, fontSize: 13, padding: '0 22px' }}>search</button>
        </div>

        {/* toolbar */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
          {view !== 'home' && (
            <button onClick={back} style={{ ...badge(C.cyan), cursor: 'pointer', background: 'transparent', fontSize: 11, padding: '7px 12px' }}>
              &larr; back
            </button>
          )}
          <button onClick={() => { setView('home'); setSheet(null); setHistory([]); }}
            style={{ ...badge(C.muted), cursor: 'pointer', background: 'transparent', fontSize: 11, padding: '7px 12px' }}>
            home
          </button>
          <input
            value={addr} onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && addr.trim()) openNode(addr.trim(), sheet?.node?.address); }}
            placeholder="jump to address  (e.g. besterror-1.txt#chunk-0091)"
            style={{ flex: 1, minWidth: 220, background: 'rgba(0,0,0,0.5)', border: `1px solid ${C.violet}66`, borderRadius: 8, color: C.white, padding: '8px 12px', fontFamily: 'ui-monospace, monospace', fontSize: 12, outline: 'none' }}
          />
          {loading && <span style={{ color: C.green, fontFamily: ORBITRON, fontSize: 10, letterSpacing: 1 }}>&#9696; loading</span>}
        </div>

        {/* ===================== SEARCH RESULTS ===================== */}
        {view === 'search' && (
          <div>
            <div style={{ fontFamily: ORBITRON, fontSize: 13, letterSpacing: 1, color: C.cyan, marginBottom: 12 }}>
              RESULTS &middot; <span style={{ color: C.white }}>{query}</span>
            </div>
            {searchErr && <div style={{ ...panel(C.gold), padding: '12px 14px', color: C.gold, fontSize: 12.5, marginBottom: 12 }}>{searchErr}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(searchResults || []).map((r) => resultCard(r))}
              {searchResults && searchResults.length === 0 && !searchErr && <div style={{ color: C.muted }}>No results.</div>}
            </div>
          </div>
        )}

        {/* ===================== HOME : document browse ===================== */}
        {view === 'home' && (
          <div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
              <span style={{ fontFamily: ORBITRON, fontSize: 13, letterSpacing: 2, color: C.cyan }}>DOCUMENTS</span>
              <input value={docFilter} onChange={(e) => setDocFilter(e.target.value)} placeholder="filter by name…"
                style={{ background: 'rgba(0,0,0,0.5)', border: `1px solid ${C.cyan}44`, borderRadius: 8, color: C.white, padding: '6px 10px', fontSize: 12, outline: 'none', minWidth: 180 }} />
              <button onClick={() => setSrcFilter('')} style={{ ...badge(srcFilter === '' ? C.white : C.muted), cursor: 'pointer', background: 'transparent' }}>all</button>
              {stats && Object.keys(stats.by_source_type || {}).map((s) => (
                <button key={s} onClick={() => setSrcFilter(srcFilter === s ? '' : s)}
                  style={{ ...badge(srcColor(s)), cursor: 'pointer', background: srcFilter === s ? `${srcColor(s)}22` : 'transparent' }}>
                  {s} &middot; {stats.by_source_type[s]}
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {shownDocs.map((d) => (
                <div key={d.doc_id} onClick={() => openDoc(d.doc_id)}
                  style={{ ...panel(srcColor(d.source_type)), padding: '12px 14px', cursor: 'pointer', transition: 'transform 0.12s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}>
                  <span style={{ fontSize: 13, color: C.white, wordBreak: 'break-word', lineHeight: 1.3 }}>{d.doc_id}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                    <span style={badge(srcColor(d.source_type))}>{d.source_type || 'misc'}</span>
                    <span style={{ color: C.muted, fontSize: 11 }}>{d.chunks} nodes</span>
                  </div>
                </div>
              ))}
            </div>
            {shownDocs.length === 0 && <div style={{ color: C.muted, marginTop: 20 }}>No documents match.</div>}
          </div>
        )}

        {/* ===================== DOC : chunk list ===================== */}
        {view === 'doc' && docChunks && (
          <div>
            <div style={{ fontFamily: ORBITRON, fontSize: 16, letterSpacing: 1, color: C.violet, marginBottom: 4, wordBreak: 'break-word' }}>{docChunks.doc_id}</div>
            <div style={{ color: C.muted, fontSize: 12, marginBottom: 16 }}>{docChunks.chunks.length} nodes</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {docChunks.chunks.map((ch) => (
                <div key={ch.address} onClick={() => openNode(ch.address)}
                  style={{ ...panel(C.cyan + '55'), padding: '12px 14px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: C.cyan, fontSize: 12, fontWeight: 600 }}>{ch.title || ch.subject || ch.address}</span>
                    <span style={{ color: C.muted, fontSize: 10, whiteSpace: 'nowrap' }}>{ch.address.split('#')[1] || ''}</span>
                  </div>
                  <div style={{ color: '#c9d4de', fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{ch.snippet}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===================== NODE : the Codex sheet ===================== */}
        {view === 'node' && sheet && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
            {/* left: the sheet */}
            <div style={{ ...panel(C.violet), padding: '18px 20px' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                <span style={badge(srcColor(sheet.node.source_type))}>{sheet.node.source_type || 'misc'}</span>
                {sheet.node.evidence_class && <span style={badge(C.gold)}>{sheet.node.evidence_class}</span>}
                {sheet.node.core_hash && <span style={badge(C.green)}>core {sheet.node.core_hash}</span>}
                <span style={{ color: C.muted, fontSize: 11, marginLeft: 'auto', wordBreak: 'break-all' }}>{sheet.node.address}</span>
              </div>
              <h2 style={{ margin: '2px 0 14px', fontFamily: ORBITRON, fontSize: 18, color: C.cyan, lineHeight: 1.3 }}>
                {sheet.node.title || sheet.node.subject || sheet.node.address}
              </h2>
              {sheet.node.doc_id && (
                <div style={{ marginBottom: 14 }}>
                  <span onClick={() => sheet.node.doc_id && openDoc(sheet.node.doc_id)}
                    style={{ color: C.violet, fontSize: 11, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                    &#8627; {sheet.node.doc_id} ({sheet.node.chars} chars)
                  </span>
                </div>
              )}
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.62, color: '#e6edf3', maxHeight: 620, overflow: 'auto', paddingRight: 8 }}>
                {sheet.node.content || sheet.node.snippet || <span style={{ color: C.muted }}>(no content)</span>}
              </div>
              {sheet.node.tags && sheet.node.tags.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 16 }}>
                  {sheet.node.tags.map((t) => <span key={t} style={badge(C.muted)}>{t}</span>)}
                </div>
              )}
            </div>

            {/* right: resonant links + concept siblings */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={panel(C.magenta)}>
                <div style={{ fontFamily: ORBITRON, fontSize: 11, letterSpacing: 2, color: C.magenta, padding: '12px 14px 8px' }}>RESONANT LINKS</div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {sheet.neighbors.map((nb) => (
                    <div key={nb.address} onClick={() => openNode(nb.address, sheet.node.address)}
                      style={{ padding: '10px 14px', borderTop: `1px solid ${C.magenta}22`, cursor: 'pointer' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ color: C.white, fontSize: 12, lineHeight: 1.3 }}>{nb.title || nb.subject || nb.doc_id}</span>
                        <span style={{ color: C.magenta, fontSize: 11, fontFamily: ORBITRON, whiteSpace: 'nowrap' }}>{nb.sim?.toFixed(3)}</span>
                      </div>
                      <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, marginTop: 5 }}>
                        <div style={{ height: '100%', width: `${Math.max(0, Math.min(1, ((nb.sim || 0) - 0.5) / 0.5)) * 100}%`, background: C.magenta, borderRadius: 2 }} />
                      </div>
                      <div style={{ color: C.muted, fontSize: 11, marginTop: 5, lineHeight: 1.4, maxHeight: 32, overflow: 'hidden' }}>{nb.snippet}</div>
                    </div>
                  ))}
                  {sheet.neighbors.length === 0 && <div style={{ color: C.muted, fontSize: 12, padding: '8px 14px 14px' }}>none</div>}
                </div>
              </div>

              {sheet.siblings.length > 0 && (
                <div style={panel(C.gold)}>
                  <div style={{ fontFamily: ORBITRON, fontSize: 11, letterSpacing: 2, color: C.gold, padding: '12px 14px 8px' }}>
                    CONCEPT SIBLINGS &middot; {sheet.node.core_hash}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {sheet.siblings.slice(0, 20).map((sb) => (
                      <div key={sb.address} onClick={() => openNode(sb.address, sheet.node.address)}
                        style={{ padding: '9px 14px', borderTop: `1px solid ${C.gold}22`, cursor: 'pointer' }}>
                        <span style={{ color: '#e6edf3', fontSize: 12, lineHeight: 1.3 }}>{sb.title || sb.subject || sb.doc_id}</span>
                        <div style={{ color: C.muted, fontSize: 11, marginTop: 3 }}>{sb.doc_id}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
