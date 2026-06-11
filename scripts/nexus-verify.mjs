// nexus-verify.mjs — proves the Nexus Core + Archivist end-to-end against the
// real DBs, and lays down schema + first pulse. Mirrors lib/nexus.ts tick().
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env.local', 'utf8');
const get = k => (env.match(new RegExp(`^\\s*${k}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm')) || [])[1];
const primary = neon(get('NEON_PRIMARY_URL'));
const mem = neon(get('NEON_MEMORY_URL'));

const ageSec = ts => ts ? Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000) : null;
const human = s => s === null ? 'never' : s < 90 ? `${Math.round(s)}s ago` : s < 5400 ? `${Math.round(s/60)}m ago` : s < 172800 ? `${(s/3600).toFixed(1)}h ago` : `${(s/86400).toFixed(1)}d ago`;

await mem`CREATE TABLE IF NOT EXISTS nexus_pulse (id bigserial PRIMARY KEY, ts timestamptz DEFAULT now(), status text, online boolean, perception jsonb, assessment text)`;
await mem`CREATE TABLE IF NOT EXISTS nexus_proposals (id bigserial PRIMARY KEY, first_seen timestamptz DEFAULT now(), last_seen timestamptz DEFAULT now(), key text UNIQUE, kind text, severity text, summary text, detail text, status text DEFAULT 'pending', resolved_ts timestamptz)`;
await mem`ALTER TABLE nexus_pulse ADD COLUMN IF NOT EXISTS directive text`;
await mem`ALTER TABLE nexus_pulse ADD COLUMN IF NOT EXISTS archivist_model text`;

const tbl = ['mc_tps_timeline','mc_packet_log','mc_chunk_events','mc_chat_log','mc_ac_responses','mc_ping_log','mc_inventory_snapshots'];
const feeds = {};
for (const t of tbl) {
    try { const r = await primary.query(`SELECT COUNT(*)::int n, MAX(ts) latest FROM ${t}`); feeds[t] = { rows: r[0].n, age: ageSec(r[0].latest) }; }
    catch { feeds[t] = { rows: -1, age: null }; }
}
const tpsAge = feeds.mc_tps_timeline.age, chunkAge = feeds.mc_chunk_events.age;
const online = (tpsAge !== null && tpsAge < 120) || (chunkAge !== null && chunkAge < 300);
const freshest = Math.min(...Object.values(feeds).map(x => x.age ?? Infinity));
const status = online ? 'ONLINE' : freshest < 86400 ? 'IDLE' : 'DORMANT';
const proposals = [];
if (!online && tpsAge !== null) proposals.push(['feed-idle','operational','info',`Live feed idle (TPS ${human(tpsAge)})`,'No fresh telemetry in the ONLINE window. Connect the Fabric client to 2b2t with the bridge running.']);
if (feeds.mc_ping_log.rows === 0) proposals.push(['collector-ping','build','todo','Ping collector unwired','mc_ping_log has never received data.']);
if (feeds.mc_inventory_snapshots.rows === 0) proposals.push(['collector-inventory','build','todo','Inventory collector unwired','mc_inventory_snapshots has never received data.']);
const chatAge = feeds.mc_chat_log.age, pktAge = feeds.mc_packet_log.age;
if (chatAge !== null && pktAge !== null && pktAge - chatAge > 3600) proposals.push(['feed-asymmetry','diagnostic','watch','Feed lifespans diverge',`Chat fed ${human(chatAge)} but packets ${human(pktAge)}.`]);
const packets = feeds.mc_packet_log.rows ?? 0;
const assessment = online ? `Nexus ONLINE. Live telemetry flowing (TPS ${human(tpsAge)}). ${proposals.length} open item(s).`
    : `Nexus ${status}. Feed idle; ${packets.toLocaleString()} packets held in memory. ${proposals.length} item(s) need attention.`;

// ---- ARCHIVIST attempt (ollama), graceful fallback to laws ----
const MODEL = process.env.NEXUS_LLM_MODEL || 'llama3.2';
const OLLAMA = process.env.NEXUS_OLLAMA_URL || 'http://localhost:11434';
let directive = null, archModel = null, archNote = '';
try {
    const sys = 'You are the Archivist within the Mastermind Nexus. Interpret the dataflux beyond the laws and frame ONE operational directive. Respond STRICT JSON only: {"directive":"1-2 sentences","proposals":[]}';
    const ar = await fetch(`${OLLAMA}/api/chat`, { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ model: MODEL, format:'json', stream:false, messages:[{role:'system',content:sys},{role:'user',content:JSON.stringify({status,assessment,feeds})}] }),
        signal: AbortSignal.timeout(20000) });
    if (ar.ok) { const j = await ar.json(); const m = (j?.message?.content||'').match(/\{[\s\S]*\}/);
        if (m) { const p = JSON.parse(m[0]); if (typeof p.directive==='string'){ directive=p.directive.slice(0,500); archModel=`ollama:${MODEL}`; } } }
    else { archNote = `ollama ${ar.status} for model '${MODEL}'`; }
} catch (e) { archNote = e.message; }

await mem`INSERT INTO nexus_pulse (status, online, perception, assessment, directive, archivist_model)
          VALUES (${status}, ${online}, ${JSON.stringify({at:new Date().toISOString(),feeds})}, ${assessment}, ${directive}, ${archModel})`;
for (const [key,kind,sev,sum,det] of proposals) {
    await mem`INSERT INTO nexus_proposals (key,kind,severity,summary,detail,status,last_seen) VALUES (${key},${kind},${sev},${sum},${det},'pending',now())
              ON CONFLICT (key) DO UPDATE SET last_seen=now(), summary=EXCLUDED.summary, detail=EXCLUDED.detail, severity=EXCLUDED.severity,
              status=CASE WHEN nexus_proposals.status='dismissed' THEN 'dismissed' ELSE 'pending' END`;
}

console.log('\n=== NEXUS PULSE (laws + archivist, live) ===');
console.log('STATUS    :', status, '| online =', online);
console.log('LAWS      :', assessment);
console.log('ARCHIVIST :', archModel ? `${archModel} — "${directive}"` : `offline (laws only)${archNote?' — '+archNote:''}`);
console.log('\nPERCEPTION:');
for (const t of tbl) console.log(`  ${t.padEnd(24)} rows=${String(feeds[t].rows).padStart(9)}  last=${human(feeds[t].age)}`);
const open = await mem`SELECT id, severity, summary, status FROM nexus_proposals WHERE status IN ('pending','approved') ORDER BY id`;
console.log('\nPROPOSALS THROUGH THE GATE:');
for (const p of open) console.log(`  [#${p.id} ${p.severity.toUpperCase().padEnd(5)} ${p.status}] ${p.summary}`);
const pulses = await mem`SELECT COUNT(*)::int n FROM nexus_pulse`;
console.log(`\nnexus_pulse rows: ${pulses[0].n}   <- core breathing; archivist seam ${archModel?'LIVE':'wired, awaiting a mind'}.`);
