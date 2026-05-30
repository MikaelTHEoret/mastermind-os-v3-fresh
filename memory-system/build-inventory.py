"""
Build a human-readable document INVENTORY of the archive — grouped by fractal
domain, flagged for future reference. Not re-vectorizing: consolidating what
exists and what it's about at the document level.
"""
import psycopg2, re
from collections import Counter, defaultdict

CONN = "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"
OUT = r"C:\Users\Mik\Documents\mastermind-command-center\ARCHIVE_INVENTORY.md"

# Human descriptions of the 8 emergent top-level fractal domains
DOMAIN_DESC = {
    "frequency":"Harmonic/physics codex material — frequencies, resonance, oscillation models.",
    "harmonic": "Harmonic codex — psi0, golden ratio, toroidal/cosmic field math, gravity.",
    "ternary":  "Ternary logic, base-12/144 lattice, hashing and number-theoretic work.",
    "overline": "Codex math notation-heavy material (LaTeX/equations, derivations).",
    "minecraft":"Mastermind 2b2t platform — mod, bridge, Neon, dashboard, MCP, deployment.",
    "scroll":   "Scroll-Protocol / sovereign-codex narrative + invocation documents.",
    "price":    "Trading material — BTCC, strategy, market microstructure, signals.",
    "self":     "Identity / consciousness / recursive-self threads and reflections.",
    "misc":     "Mixed or uncategorized material.",
}

def clean(s):
    if not s: return ""
    s = re.sub(r"\s+", " ", s).strip()
    return s[:90]

def main():
    conn = psycopg2.connect(CONN); cur = conn.cursor()
    # Per-doc aggregate: chunks, type, all tags, dominant top-level domain, a title/descriptor
    cur.execute("""
        SELECT doc_id,
               COUNT(*) AS chunks,
               MAX(source_type) AS stype,
               MODE() WITHIN GROUP (ORDER BY split_part(bloom_path,'/',1)) AS domain,
               (array_agg(title ORDER BY chunk_index))[1] AS first_title
        FROM transcript_archive
        GROUP BY doc_id
    """)
    docs = cur.fetchall()

    # tags per doc (separate query, aggregate distinct tags)
    cur.execute("""
        SELECT doc_id, t, COUNT(*) n FROM transcript_archive, unnest(topic_tags) t
        GROUP BY doc_id, t
    """)
    tagmap = defaultdict(Counter)
    for doc_id, t, n in cur.fetchall():
        tagmap[doc_id][t] += n
    cur.close(); conn.close()

    # group docs by domain
    by_domain = defaultdict(list)
    for doc_id, chunks, stype, domain, title in docs:
        by_domain[domain or "misc"].append((doc_id, chunks, stype, title))

    total_docs = len(docs)
    total_chunks = sum(d[1] for d in docs)

    lines = []
    lines.append("# Archive Inventory")
    lines.append("")
    lines.append(f"> Document-level map of the archive goldmine. {total_docs} documents, "
                 f"{total_chunks:,} chunks. Grouped by emergent fractal domain, flagged for reference.")
    lines.append("> Generated 2026-05-30. This is a *map of what exists and what it's about* — "
                 "not a re-index. The chunk-level vector index lives in transcript_archive.")
    lines.append("")
    lines.append("**Flags:** ★ = landmark (≥100 chunks, major source) · ⚙ = code · 📄 = document/design · 💬 = transcript · 📊 = data")
    lines.append("")

    type_flag = {"code":"⚙","document":"📄","transcript":"💬","data":"📊"}

    # order domains by total chunks desc
    order = sorted(by_domain.keys(), key=lambda d: -sum(x[1] for x in by_domain[d]))
    for domain in order:
        items = sorted(by_domain[domain], key=lambda x:-x[1])
        dchunks = sum(x[1] for x in items)
        lines.append(f"## {domain}  —  {len(items)} docs, {dchunks:,} chunks")
        desc = DOMAIN_DESC.get(domain)
        if desc: lines.append(f"*{desc}*")
        lines.append("")
        for doc_id, chunks, stype, title in items:
            name = doc_id.split("/")[-1]
            flag = "★ " if chunks >= 100 else ""
            tf = type_flag.get(stype, "")
            toptags = ", ".join(t for t,_ in tagmap[doc_id].most_common(4))
            desc_txt = clean(title)
            lines.append(f"- {flag}{tf} **{name}** ({chunks}ch) — {desc_txt}  ·  _{toptags}_")
        lines.append("")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"Inventory written: {total_docs} docs across {len(by_domain)} domains -> {OUT}")
    # quick domain summary to console
    for domain in order:
        items = by_domain[domain]
        print(f"  {domain:12} {len(items):4} docs  {sum(x[1] for x in items):6} chunks")

main()
