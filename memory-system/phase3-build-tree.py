"""
Phase 3 — Fractal node tree via recursive adaptive subdivision.
DRY RUN: builds the tree in memory and writes its shape to a JSON file.
No DB writes. Lets us inspect the tree before persisting.

Principle (Mikael): a fractal is infinitely divisible + expandable, computable
by key. So: recursively subdivide any node dense enough to warrant it; stop at
coherent/small leaves. Depth is per-branch, decided by content. Paths extend,
never rewrite. The 'key' = centroid at each node + path-extension rule.
"""
import psycopg2, numpy as np, json, re, sys
from sklearn.cluster import KMeans
from collections import Counter

CONN = "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"

# --- tuning (the subdivision rule) ---
LEAF_MAX     = 60      # a node with <= this many chunks is a leaf (holds addresses)
COHERENT_SIM = 0.78    # if mean cosine-to-centroid >= this, node is one subject -> leaf
MAX_DEPTH    = 6       # safety ceiling on recursion
MIN_SPLIT    = 120     # below this, don't bother splitting even if not "coherent"

STOP = set("the a an and or but in on at to for of with by is are was were this that it as be have has from your you i we they will can would could should about into more most some other".split())

def load():
    print("Loading embeddings from Neon...", flush=True)
    conn = psycopg2.connect(CONN)
    cur = conn.cursor()
    cur.execute("""SELECT address, doc_id, LEFT(content,160), embedding
                   FROM transcript_archive WHERE embedding IS NOT NULL ORDER BY doc_id, chunk_index""")
    addrs, docs, snips, vecs = [], [], [], []
    for address, doc_id, snip, emb in cur.fetchall():
        addrs.append(address); docs.append(doc_id); snips.append(snip or "")
        vecs.append(np.fromstring(emb.strip("[]"), sep=","))
    cur.close(); conn.close()
    X = np.array(vecs, dtype=np.float32)
    # normalize for cosine via dot product
    X /= (np.linalg.norm(X, axis=1, keepdims=True) + 1e-8)
    print(f"Loaded {len(addrs)} chunks, dim {X.shape[1]}", flush=True)
    return addrs, docs, snips, X

def label_for(idxs, snips, used):
    """Distinctive terms for this cluster's snippets, avoiding already-used labels."""
    words = Counter()
    for i in idxs:
        for w in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", snips[i].lower()):
            if w not in STOP and len(w) <= 24:
                words[w] += 1
    for w, _ in words.most_common(20):
        if w not in used:
            used.add(w); return w
    # fallback
    for w, _ in words.most_common(5):
        return w
    return "misc"

def adaptive_k(n):
    if n > 2000: return 8
    if n > 800:  return 6
    if n > 300:  return 5
    return 4

nodes = []  # flat list of node dicts for output
def build(idxs, X, snips, path, depth, used_labels, counter):
    n = len(idxs)
    sub = X[idxs]
    centroid = sub.mean(axis=0)
    centroid /= (np.linalg.norm(centroid) + 1e-8)
    sims = sub @ centroid
    coherence = float(sims.mean())

    is_leaf = (n <= LEAF_MAX) or (depth >= MAX_DEPTH) or (coherence >= COHERENT_SIM and n < MIN_SPLIT)
    node = {"path": path, "depth": depth, "n_chunks": n,
            "coherence": round(coherence,3), "is_leaf": is_leaf}
    nodes.append(node)

    if is_leaf:
        return
    k = min(adaptive_k(n), n)
    if k < 2:
        node["is_leaf"] = True; return
    km = KMeans(n_clusters=k, n_init=4, random_state=42)
    labels = km.fit_predict(sub)
    for cl in range(k):
        child_local = np.where(labels == cl)[0]
        if len(child_local) == 0: continue
        child_idxs = [idxs[j] for j in child_local]
        lbl = label_for(child_idxs, snips, used_labels)
        child_path = f"{path}/{lbl}" if path else lbl
        build(child_idxs, X, snips, child_path, depth+1, used_labels, counter)

def main():
    addrs, docs, snips, X = load()
    print("Building fractal tree (recursive adaptive subdivision)...", flush=True)
    root_idxs = list(range(len(addrs)))
    # First split is the top level — use a fresh used-label set per top branch later
    used = set()
    build(root_idxs, X, snips, "", 0, used, [0])

    leaves = [nd for nd in nodes if nd["is_leaf"]]
    internal = [nd for nd in nodes if not nd["is_leaf"]]
    depths = Counter(nd["depth"] for nd in nodes)
    print(f"\nTree built: {len(nodes)} nodes ({len(internal)} internal, {len(leaves)} leaves)")
    print(f"Depth distribution: {dict(sorted(depths.items()))}")
    print(f"Leaf chunk sizes: min={min(l['n_chunks'] for l in leaves)}, "
          f"max={max(l['n_chunks'] for l in leaves)}, "
          f"mean={round(sum(l['n_chunks'] for l in leaves)/len(leaves),1)}")
    print(f"Leaf coherence: mean={round(sum(l['coherence'] for l in leaves)/len(leaves),3)}")

    # Show the top-level branches and a sample of their descent
    print("\nTOP-LEVEL BRANCHES:")
    tops = [nd for nd in nodes if nd["depth"]==1]
    for t in sorted(tops, key=lambda x:-x["n_chunks"]):
        print(f"  {t['path']:30} {t['n_chunks']:5}ch  coh={t['coherence']}")

    with open(r"C:\Users\Mik\Documents\mastermind-client\data\phase3-tree.json","w",encoding="utf-8") as f:
        json.dump(nodes, f, indent=1)
    print("\nTree shape written to data\\phase3-tree.json")
    print("DRY RUN COMPLETE (no DB writes)")

main()
