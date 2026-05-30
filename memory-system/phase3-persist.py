"""
Phase 3 persist — rebuild the fractal tree and WRITE it to the DB.
Writes fractal_nodes (with centroids) and updates transcript_archive.bloom_path
to each chunk's assigned LEAF path (consistent: assigned by cluster membership,
not per-chunk tags). Also stamps harmonic_memories later via the descent tool.
"""
import psycopg2, numpy as np, json, re
from sklearn.cluster import KMeans
from collections import Counter
from psycopg2.extras import execute_values

CONN = "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"
LEAF_MAX, COHERENT_SIM, MAX_DEPTH, MIN_SPLIT = 60, 0.78, 6, 120
STOP = set("the a an and or but in on at to for of with by is are was were this that it as be have has from your you i we they will can would could should about into more most some other".split())

def load():
    print("Loading embeddings...", flush=True)
    conn = psycopg2.connect(CONN); cur = conn.cursor()
    cur.execute("""SELECT address, LEFT(content,160), embedding FROM transcript_archive
                   WHERE embedding IS NOT NULL ORDER BY doc_id, chunk_index""")
    addrs, snips, vecs = [], [], []
    for address, snip, emb in cur.fetchall():
        addrs.append(address); snips.append(snip or "")
        vecs.append(np.fromstring(emb.strip("[]"), sep=","))
    cur.close(); conn.close()
    X = np.array(vecs, dtype=np.float32); X /= (np.linalg.norm(X,axis=1,keepdims=True)+1e-8)
    print(f"Loaded {len(addrs)} chunks", flush=True)
    return addrs, snips, X

def label_for(idxs, snips, used):
    words = Counter()
    for i in idxs:
        for w in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", snips[i].lower()):
            if w not in STOP and len(w)<=24: words[w]+=1
    for w,_ in words.most_common(20):
        if w not in used: used.add(w); return w
    for w,_ in words.most_common(1): return w
    return "misc"

def adaptive_k(n):
    return 8 if n>2000 else 6 if n>800 else 5 if n>300 else 4

nodes = []           # node dicts incl centroid
leaf_assign = {}     # address -> leaf path
def build(idxs, X, addrs, snips, path, depth, used):
    n=len(idxs); sub=X[idxs]
    centroid=sub.mean(axis=0); centroid/=(np.linalg.norm(centroid)+1e-8)
    coherence=float((sub@centroid).mean())
    is_leaf=(n<=LEAF_MAX) or (depth>=MAX_DEPTH) or (coherence>=COHERENT_SIM and n<MIN_SPLIT)
    parent = "/".join(path.split("/")[:-1]) if path and "/" in path else (None if depth<=1 else path)
    nodes.append({"path":path,"name":path.split("/")[-1] if path else "ROOT",
                  "parent":(path.rsplit("/",1)[0] if "/" in path else None) if path else None,
                  "depth":depth,"is_leaf":is_leaf,"n":n,"coh":round(coherence,3),
                  "centroid":centroid.tolist()})
    if is_leaf:
        for j in idxs: leaf_assign[addrs[j]] = path
        return
    k=min(adaptive_k(n),n)
    if k<2:
        nodes[-1]["is_leaf"]=True
        for j in idxs: leaf_assign[addrs[j]] = path
        return
    labels=KMeans(n_clusters=k,n_init=4,random_state=42).fit_predict(sub)
    for cl in range(k):
        loc=np.where(labels==cl)[0]
        if len(loc)==0: continue
        ci=[idxs[j] for j in loc]
        lbl=label_for(ci,snips,used)
        build(ci, X, addrs, snips, f"{path}/{lbl}" if path else lbl, depth+1, used)

def main():
    addrs,snips,X=load()
    print("Building + persisting fractal tree...", flush=True)
    build(list(range(len(addrs))), X, addrs, snips, "", 0, set())
    leaves=[nd for nd in nodes if nd["is_leaf"]]
    print(f"Tree: {len(nodes)} nodes, {len(leaves)} leaves, {len(leaf_assign)} chunks assigned", flush=True)

    conn=psycopg2.connect(CONN); cur=conn.cursor()
    # write nodes
    print("Writing fractal_nodes...", flush=True)
    for nd in nodes:
        cur.execute(
            """INSERT INTO fractal_nodes (path,name,parent_path,depth,is_leaf,n_chunks,coherence,centroid)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (path) DO UPDATE SET n_chunks=EXCLUDED.n_chunks, centroid=EXCLUDED.centroid""",
            (nd["path"] or "ROOT", nd["name"], nd["parent"], nd["depth"], nd["is_leaf"],
             nd["n"], nd["coh"], "["+",".join(map(str,nd["centroid"]))+"]"))
    conn.commit()
    print(f"  wrote {len(nodes)} nodes", flush=True)

    # update chunk bloom_path to its leaf path, batched
    print("Updating chunk bloom_path to leaf paths...", flush=True)
    items=list(leaf_assign.items())
    B=500
    for i in range(0,len(items),B):
        chunk=items[i:i+B]
        execute_values(cur,
            "UPDATE transcript_archive AS ta SET bloom_path=v.bp FROM (VALUES %s) AS v(addr,bp) WHERE ta.address=v.addr",
            chunk)
        conn.commit()
    print(f"  updated {len(items)} chunks", flush=True)
    cur.close(); conn.close()
    print("PHASE3 PERSIST COMPLETE")

main()
