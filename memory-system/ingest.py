"""
Extended ingestion tool — handles PDF, large chat logs, code, docs, with
provenance/authority tagging built in. Idempotent (archive_index_log).
For the incoming flood of large PDFs + chat logs + datasheets.

Usage: python ingest.py <path-or-dir> [--authority code|datasheet|document|transcript]
Auto-detects authority by extension/content if not given.
"""
import sys, os, re, hashlib, json, urllib.request
import psycopg2
from psycopg2.extras import execute_values

CONN = "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"
OLLAMA = "http://localhost:11434/api/embed"
MODEL = "nomic-embed-text"
CHUNK, OVERLAP = 1500, 200

AUTH_RANK = {"code":10, "datasheet":8, "document":6, "transcript":3, "unknown":4}
CONN_COMMIT = [lambda: None]  # set in main() so ingest_file can commit mid-file

def embed(text):
    try:
        req = urllib.request.Request(OLLAMA,
            data=json.dumps({"model":MODEL,"input":text[:8000]}).encode(),
            headers={"Content-Type":"application/json"})
        return json.loads(urllib.request.urlopen(req, timeout=30).read())["embeddings"][0]
    except Exception as e:
        return None

def extract_pdf(path):
    """Extract text from PDF via PyMuPDF, page by page."""
    import fitz
    doc = fitz.open(path)
    pages = []
    for i, page in enumerate(doc):
        txt = page.get_text()
        if txt.strip():
            pages.append((i, txt))
    doc.close()
    return pages  # list of (page_no, text)

def detect_authority(path, text_sample):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".py",".js",".ts",".tsx",".jsx",".c",".cpp",".rs",".java"): return "code"
    if ext in (".csv",".tsv",".xlsx",".json") : return "datasheet"
    # chat logs / transcripts: heuristic — lots of "User:" "Assistant:" "ChatGPT" "Grok" markers
    if re.search(r'\b(User|Assistant|ChatGPT|Grok|You said|To view keyboard shortcuts)\b', text_sample):
        return "transcript"
    if ext == ".pdf": return "document"
    if ext in (".md",".txt"): return "document"
    return "unknown"

TAG_RX = [
    ('memory', re.compile(r'\b(memory|recall|embedding|vector|hydrate)\b', re.I)),
    ('fractal-address', re.compile(r'fractal|address|bloom|core.hash', re.I)),
    ('harmonic', re.compile(r'harmonic|resonance|psi.?0|aether|toroidal|432', re.I)),
    ('codex', re.compile(r'codex|genesis equation|ternary|glyph', re.I)),
    ('gravity', re.compile(r'gravity|gravitational|phase convergence|relativ', re.I)),
    ('mastermind', re.compile(r'mastermind|2b2t|packet|fabric|baritone', re.I)),
    ('mcp', re.compile(r'\bmcp\b|model context protocol', re.I)),
    ('code', re.compile(r'\b(function|const|import|def |class )\b')),
]
def tags_for(text):
    t = [name for name,rx in TAG_RX if rx.search(text)]
    return t or ['general']

# audit flag: does this chunk QUOTE a numeric constant? (candidate drift to verify vs code)
NUM_CONST = re.compile(r'(psi.?0|\u03c80|\u03c6|phi|\u03c0_?H|pi_?H)\s*[=\u2248]\s*([0-9./]+)', re.I)
def audit_flag_for(text, authority):
    if authority == "transcript" and NUM_CONST.search(text):
        return "quoted-constant-verify-vs-code"
    return None

def chunk_text(text):
    out = []
    for i in range(0, len(text), CHUNK - OVERLAP):
        piece = text[i:i+CHUNK].strip()
        if len(piece) > 40: out.append(piece)
    return out

def ingest_file(cur, path, authority=None):
    try:
        cur.execute("SELECT 1 FROM archive_index_log WHERE source_path=%s AND status='done'", (path,))
        if cur.fetchone(): return ("skip", 0)
    except: pass

    ext = os.path.splitext(path)[1].lower()
    rel = os.path.basename(path)
    mtime = None
    try:
        import datetime
        mtime = datetime.datetime.fromtimestamp(os.path.getmtime(path)).isoformat()
    except: pass

    units = []  # (sub_id, text)
    if ext == ".pdf":
        for pageno, txt in extract_pdf(path):
            for ci, piece in enumerate(chunk_text(txt)):
                units.append((f"p{pageno:04d}-c{ci:03d}", piece, pageno))
    else:
        with open(path, encoding="utf-8", errors="replace") as f:
            raw = f.read()
        for ci, piece in enumerate(chunk_text(raw)):
            units.append((f"chunk-{ci:04d}", piece, None))

    if not units: return ("empty", 0)
    sample = units[0][1]
    auth = authority or detect_authority(path, sample)
    rank = AUTH_RANK.get(auth, 4)

    # resume support: skip sub_ids already present for this doc
    cur.execute("SELECT address FROM transcript_archive WHERE doc_id=%s", (rel,))
    have = set(r[0] for r in cur.fetchall())
    total = 0
    batch = []
    stype = ('document' if ext=='.pdf' else (auth if auth!='unknown' else 'document'))
    for n, (sub_id, piece, pageno) in enumerate(units):
        addr = f"{rel}#{sub_id}"
        if addr in have: continue
        vec = embed(piece)
        batch.append((addr, stype, path, rel, 0, tags_for(piece),
                      f"{rel} p{pageno}" if ext=='.pdf' else piece[:80],
                      piece, "["+",".join(map(str,vec))+"]" if vec else None,
                      len(piece), mtime, auth, rank, audit_flag_for(piece, auth)))
        # commit every 25 chunks so big files are resumable + survive interruption
        if len(batch) >= 25:
            execute_values(cur,
                """INSERT INTO transcript_archive
                   (address, source_type, source_path, doc_id, chunk_index, topic_tags, title, content,
                    embedding, char_count, doc_mtime, source_authority, authority_rank, audit_flag)
                   VALUES %s ON CONFLICT (address) DO NOTHING""",
                batch, template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)")
            CONN_COMMIT[0]()
            total += len(batch); batch = []
            with open(r"C:\\Users\\Mik\\Documents\\mastermind-client\\data\\ingest-progress.txt","w") as f:
                f.write(f"{rel}: {total}/{len(units)} chunks\n")
    if batch:
        execute_values(cur,
            """INSERT INTO transcript_archive
               (address, source_type, source_path, doc_id, chunk_index, topic_tags, title, content,
                embedding, char_count, doc_mtime, source_authority, authority_rank, audit_flag)
               VALUES %s ON CONFLICT (address) DO NOTHING""",
            batch, template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)")
        CONN_COMMIT[0]()
        total += len(batch)
    cur.execute("""INSERT INTO archive_index_log (source_path, doc_id, chunks, status)
                   VALUES (%s,%s,%s,'done') ON CONFLICT (source_path)
                   DO UPDATE SET chunks=EXCLUDED.chunks, status='done'""", (path, rel, total))
    return ("done", total)

def main():
    if len(sys.argv) < 2:
        print("Usage: python ingest.py <path-or-dir> [--authority X]"); return
    target = sys.argv[1]
    authority = None
    if "--authority" in sys.argv:
        authority = sys.argv[sys.argv.index("--authority")+1]

    paths = []
    if os.path.isdir(target):
        for dp, dn, fns in os.walk(target):
            for fn in fns:
                if os.path.splitext(fn)[1].lower() in (".pdf",".md",".txt",".py",".js",".json",".csv"):
                    paths.append(os.path.join(dp, fn))
    else:
        paths = [target]

    conn = psycopg2.connect(CONN); cur = conn.cursor()
    CONN_COMMIT[0] = conn.commit
    done=chunks=skip=err=0
    for i, p in enumerate(paths):
        try:
            status, n = ingest_file(cur, p, authority)
            conn.commit()
            if status=="done": done+=1; chunks+=n
            elif status=="skip": skip+=1
            if (done+skip) % 10 == 0:
                print(f"  {done} done ({chunks} chunks), {skip} skipped, {err} err  [{i+1}/{len(paths)}]", flush=True)
        except Exception as e:
            err+=1; conn.rollback()
            try:
                cur.execute("""INSERT INTO archive_index_log (source_path,status,error) VALUES (%s,'error',%s)
                               ON CONFLICT (source_path) DO UPDATE SET status='error', error=EXCLUDED.error""",
                            (p, str(e)[:200])); conn.commit()
            except: conn.rollback()
    cur.close(); conn.close()
    print(f"\nINGEST COMPLETE: {done} files, {chunks} chunks, {skip} skipped, {err} errors")

if __name__ == "__main__":
    main()
