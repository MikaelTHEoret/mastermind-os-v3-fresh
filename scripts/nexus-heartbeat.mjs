// nexus-heartbeat.mjs — headless heartbeat for the Nexus Core.
// Keeps the nexus beating when no GUI tab is open and regardless of host plan.
// Usage:  node scripts/nexus-heartbeat.mjs
// Env:    NEXUS_URL (default prod), NEXUS_INTERVAL_MS (default 30000)
const URL = process.env.NEXUS_URL || 'https://mastermind-2b2t.vercel.app';
const INTERVAL = Number(process.env.NEXUS_INTERVAL_MS || 30000);

async function beat() {
    const t = new Date().toISOString().slice(11, 19);
    try {
        const r = await fetch(`${URL}/api/nexus/tick`, { method: 'POST' });
        const j = await r.json();
        if (j.ok) console.log(`${t}  ♥ ${j.status}  online=${j.online}  proposals=${j.proposals?.length ?? 0}`);
        else console.log(`${t}  ✕ ${j.error}`);
    } catch (e) {
        console.log(`${t}  ✕ ${e.message}`);
    }
}
console.log(`Nexus heartbeat → ${URL}  every ${INTERVAL / 1000}s`);
beat();
setInterval(beat, INTERVAL);
