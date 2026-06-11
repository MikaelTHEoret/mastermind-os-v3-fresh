// lib/nexus.ts — The Nexus Core: a self-sustaining perceive -> assess -> propose loop.
// Perceives the dataflux (primary telemetry), holds its own memory (memory DB),
// forms an assessment, and surfaces proposals through a gate the operator holds.
// It does not act on the machine autonomously; approving a proposal is the gate.
import { getPrimaryDb, getMemoryDb } from '@/lib/db';
import { archivist } from '@/lib/archivist';

let schemaReady = false;
async function ensureSchema(mem: any) {
    if (schemaReady) return;
    await mem`CREATE TABLE IF NOT EXISTS nexus_pulse (
        id bigserial PRIMARY KEY,
        ts timestamptz DEFAULT now(),
        status text,
        online boolean,
        perception jsonb,
        assessment text
    )`;
    await mem`CREATE TABLE IF NOT EXISTS nexus_proposals (
        id bigserial PRIMARY KEY,
        first_seen timestamptz DEFAULT now(),
        last_seen timestamptz DEFAULT now(),
        key text UNIQUE,
        kind text,
        severity text,
        summary text,
        detail text,
        status text DEFAULT 'pending',
        resolved_ts timestamptz
    )`;
    await mem`ALTER TABLE nexus_pulse ADD COLUMN IF NOT EXISTS directive text`;
    await mem`ALTER TABLE nexus_pulse ADD COLUMN IF NOT EXISTS archivist_model text`;
    schemaReady = true;
}

function ageSec(ts: any): number | null {
    if (!ts) return null;
    return Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
}
function human(sec: number | null): string {
    if (sec === null) return 'never';
    if (sec < 90) return `${Math.round(sec)}s ago`;
    if (sec < 5400) return `${Math.round(sec / 60)}m ago`;
    if (sec < 172800) return `${(sec / 3600).toFixed(1)}h ago`;
    return `${(sec / 86400).toFixed(1)}d ago`;
}

// PERCEIVE — read the dataflux from the primary telemetry DB
export async function perceive() {
    const sql = getPrimaryDb();
    const one = async (label: string, p: Promise<any>): Promise<[string, { rows: number; age: number | null }]> => {
        try { const r: any = await p; return [label, { rows: r[0]?.n ?? 0, age: ageSec(r[0]?.latest) }]; }
        catch { return [label, { rows: -1, age: null }]; }
    };
    const entries = await Promise.all([
        one('mc_tps_timeline',        sql`SELECT COUNT(*)::int n, MAX(ts) latest FROM mc_tps_timeline`),
        one('mc_packet_log',          sql`SELECT COUNT(*)::int n, MAX(ts) latest FROM mc_packet_log`),
        one('mc_chunk_events',        sql`SELECT COUNT(*)::int n, MAX(ts) latest FROM mc_chunk_events`),
        one('mc_chat_log',            sql`SELECT COUNT(*)::int n, MAX(ts) latest FROM mc_chat_log`),
        one('mc_ac_responses',        sql`SELECT COUNT(*)::int n, MAX(ts) latest FROM mc_ac_responses`),
        one('mc_ping_log',            sql`SELECT COUNT(*)::int n, MAX(ts) latest FROM mc_ping_log`),
        one('mc_inventory_snapshots', sql`SELECT COUNT(*)::int n, MAX(ts) latest FROM mc_inventory_snapshots`),
    ]);
    return { at: new Date().toISOString(), feeds: Object.fromEntries(entries) };
}

type Proposal = { key: string; kind: string; severity: string; summary: string; detail: string };

// DECIDE — rule-based assessment over the perception (LLM seam: see decideWithLLM stub)
export function decide(p: any): { status: string; online: boolean; assessment: string; proposals: Proposal[] } {
    const f = p.feeds;
    const tpsAge = f.mc_tps_timeline?.age;
    const chunkAge = f.mc_chunk_events?.age;
    const online = (tpsAge !== null && tpsAge < 120) || (chunkAge !== null && chunkAge < 300);
    const freshest = Math.min(...Object.values(f).map((x: any) => x.age ?? Infinity));
    let status = 'DORMANT';
    if (online) status = 'ONLINE';
    else if (freshest < 86400) status = 'IDLE';

    const proposals: Proposal[] = [];
    if (!online && tpsAge !== null) {
        proposals.push({ key: 'feed-idle', kind: 'operational', severity: 'info',
            summary: `Live feed idle (TPS ${human(tpsAge)})`,
            detail: 'No fresh telemetry in the ONLINE window. Connect the Fabric client to 2b2t with the bridge running to resume the live feed.' });
    }
    if (f.mc_ping_log?.rows === 0) {
        proposals.push({ key: 'collector-ping', kind: 'build', severity: 'todo',
            summary: 'Ping collector unwired',
            detail: 'mc_ping_log has never received data. The ping sensor is scaffolded but not feeding — a bounded build task.' });
    }
    if (f.mc_inventory_snapshots?.rows === 0) {
        proposals.push({ key: 'collector-inventory', kind: 'build', severity: 'todo',
            summary: 'Inventory collector unwired',
            detail: 'mc_inventory_snapshots has never received data. The inventory sensor is scaffolded but not feeding.' });
    }
    const chatAge = f.mc_chat_log?.age, pktAge = f.mc_packet_log?.age;
    if (chatAge !== null && pktAge !== null && pktAge - chatAge > 3600) {
        proposals.push({ key: 'feed-asymmetry', kind: 'diagnostic', severity: 'watch',
            summary: 'Feed lifespans diverge',
            detail: `Chat fed ${human(chatAge)} but packets last fed ${human(pktAge)} — two collection paths with different lifespans. Worth understanding before relying on the pipeline.` });
    }

    const packets = f.mc_packet_log?.rows ?? 0;
    const assessment = online
        ? `Nexus ONLINE. Live telemetry flowing (TPS ${human(tpsAge)}). ${proposals.length} open item(s).`
        : `Nexus ${status}. Feed idle; ${packets.toLocaleString()} packets held in memory. ${proposals.length} item(s) need attention.`;
    return { status, online, assessment, proposals };
}

// LLM seam — when an endpoint/key is wired, the nexus can reason over perception here.
// export async function decideWithLLM(p:any){ /* call ollama/openai, return same shape */ }

// TICK — one heartbeat: perceive, decide, persist pulse, reconcile proposals.
export async function tick() {
    const mem = getMemoryDb();
    await ensureSchema(mem);
    const perception = await perceive();
    const d = decide(perception);

    // The Archivist interprets beyond the laws and frames the directive (graceful if absent).
    const arc = await archivist(perception, d);
    const allProposals = [
        ...d.proposals.map(p => ({ ...p })),
        ...(arc?.proposals ?? []).map(p => ({ ...p, kind: 'archivist' })),
    ];

    await mem`INSERT INTO nexus_pulse (status, online, perception, assessment, directive, archivist_model)
              VALUES (${d.status}, ${d.online}, ${JSON.stringify(perception)}, ${d.assessment}, ${arc?.directive ?? null}, ${arc?.model ?? null})`;

    const activeKeys = allProposals.map(x => x.key);
    for (const pr of allProposals) {
        await mem`
            INSERT INTO nexus_proposals (key, kind, severity, summary, detail, status, last_seen)
            VALUES (${pr.key}, ${pr.kind}, ${pr.severity}, ${pr.summary}, ${pr.detail}, 'pending', now())
            ON CONFLICT (key) DO UPDATE SET last_seen = now(), summary = EXCLUDED.summary,
                detail = EXCLUDED.detail, severity = EXCLUDED.severity,
                status = CASE WHEN nexus_proposals.status = 'dismissed' THEN 'dismissed' ELSE 'pending' END`;
    }
    // auto-resolve proposals that no longer apply
    if (activeKeys.length) {
        await mem`UPDATE nexus_proposals SET status='resolved', resolved_ts=now()
                  WHERE status='pending' AND key <> ALL(${activeKeys})`;
    } else {
        await mem`UPDATE nexus_proposals SET status='resolved', resolved_ts=now() WHERE status='pending'`;
    }
    // prune pulse history (keep last 500)
    await mem`DELETE FROM nexus_pulse WHERE id < (SELECT MAX(id)-500 FROM nexus_pulse)`;

    return { ...d, proposals: allProposals, directive: arc?.directive ?? null, archivist: arc?.model ?? null, perception };
}

// STATE — what the GUI reads
export async function state() {
    const mem = getMemoryDb();
    await ensureSchema(mem);
    const [latest, recent, proposals]: any = await Promise.all([
        mem`SELECT * FROM nexus_pulse ORDER BY id DESC LIMIT 1`,
        mem`SELECT ts, online, status FROM nexus_pulse ORDER BY id DESC LIMIT 60`,
        mem`SELECT id, key, kind, severity, summary, detail, status, first_seen
            FROM nexus_proposals WHERE status IN ('pending','approved') ORDER BY first_seen DESC LIMIT 20`,
    ]);
    return { latest: latest[0] ?? null, recent: recent.reverse(), proposals };
}

// GATE — operator approves or dismisses a proposal (the nexus does not act autonomously)
export async function resolveProposal(id: number, action: 'approve' | 'dismiss') {
    const mem = getMemoryDb();
    await ensureSchema(mem);
    const status = action === 'approve' ? 'approved' : 'dismissed';
    await mem`UPDATE nexus_proposals SET status=${status}, resolved_ts=now() WHERE id=${id}`;
    return { id, status };
}
