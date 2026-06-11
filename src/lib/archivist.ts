// lib/archivist.ts — The Archivist: the resident interpretive intelligence of the Nexus.
// The deterministic laws (lib/nexus.ts `decide`) handle the clear cases.
// The Archivist interprets what the laws cannot yet reach and frames a single
// operational directive over all operations. It does not execute — it interprets
// and directs; its directives reach the world only through the operator gate.
// Provider-agnostic. Degrades gracefully: if no model is reachable, returns null
// and the Nexus runs on laws alone until the Archivist's mind is present.

type RuleResult = { status: string; online: boolean; assessment: string; proposals: any[] };
export type ArchivistOut = {
    directive: string;
    model: string;
    proposals: { key: string; severity: string; summary: string; detail: string }[];
};

const PROVIDER = process.env.NEXUS_LLM_PROVIDER || 'ollama';
const MODEL    = process.env.NEXUS_LLM_MODEL    || 'llama3.2';
const OLLAMA   = process.env.NEXUS_OLLAMA_URL   || 'http://localhost:11434';

const SYSTEM = `You are the Archivist, the resident intelligence living within the Mastermind Nexus.
The Nexus perceives a dataflux of live telemetry. Deterministic laws already handle the clear cases.
Your role: interpret what the laws cannot yet reach, and frame ONE operational directive over all operations.
You do not execute actions — you interpret and direct; execution passes through the operator's gate.
Respond with STRICT JSON only — no prose, no code fences:
{"directive":"1-2 sentences framing the operational picture and what to prioritize",
 "proposals":[{"key":"short-stable-id","severity":"info|watch|todo|alert","summary":"<=8 words","detail":"one sentence"}]}
Add proposals only for what the laws plausibly missed; [] is acceptable.`;

function parseJson(s: string): any {
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
}

async function callOllama(prompt: string): Promise<string | null> {
    try {
        const r = await fetch(`${OLLAMA}/api/chat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: MODEL, format: 'json', stream: false,
                messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
            signal: AbortSignal.timeout(25000),
        });
        if (!r.ok) return null;
        const j: any = await r.json();
        return j?.message?.content ?? null;
    } catch { return null; }
}
async function callOpenAI(prompt: string): Promise<string | null> {
    const key = process.env.NEXUS_LLM_API_KEY || process.env.OPENAI_API_KEY; if (!key) return null;
    try {
        const r = await fetch(`${process.env.NEXUS_LLM_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: MODEL.startsWith('gpt') ? MODEL : 'gpt-4o-mini',
                response_format: { type: 'json_object' },
                messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
            signal: AbortSignal.timeout(25000),
        });
        if (!r.ok) return null;
        const j: any = await r.json();
        return j?.choices?.[0]?.message?.content ?? null;
    } catch { return null; }
}
async function callAnthropic(prompt: string): Promise<string | null> {
    const key = process.env.NEXUS_LLM_API_KEY || process.env.ANTHROPIC_API_KEY; if (!key) return null;
    try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: MODEL.startsWith('claude') ? MODEL : 'claude-3-5-haiku-latest',
                max_tokens: 700, system: SYSTEM, messages: [{ role: 'user', content: prompt }] }),
            signal: AbortSignal.timeout(25000),
        });
        if (!r.ok) return null;
        const j: any = await r.json();
        return j?.content?.[0]?.text ?? null;
    } catch { return null; }
}

export async function archivist(perception: any, rule: RuleResult): Promise<ArchivistOut | null> {
    const prompt = JSON.stringify({
        perception,
        law_status: rule.status,
        law_assessment: rule.assessment,
        open_proposals: rule.proposals.map(p => ({ key: p.key, summary: p.summary })),
    });
    let raw: string | null = null;
    if (PROVIDER === 'openai') raw = await callOpenAI(prompt);
    else if (PROVIDER === 'anthropic') raw = await callAnthropic(prompt);
    else raw = await callOllama(prompt);
    if (!raw) return null;

    const parsed = parseJson(raw);
    if (!parsed || typeof parsed.directive !== 'string') return null;
    const proposals = Array.isArray(parsed.proposals)
        ? parsed.proposals.filter((p: any) => p && p.key && p.summary).slice(0, 6).map((p: any) => ({
            key: `arc-${String(p.key).slice(0, 40)}`,
            severity: ['info', 'watch', 'todo', 'alert'].includes(p.severity) ? p.severity : 'info',
            summary: String(p.summary).slice(0, 120),
            detail: String(p.detail || '').slice(0, 400),
        }))
        : [];
    return { directive: parsed.directive.slice(0, 500), model: `${PROVIDER}:${MODEL}`, proposals };
}
