"""Test fractal descent retrieval: embed a query, walk the tree by best-child
centroid match at each level, reach a leaf, return its chunk addresses."""
import psycopg2, numpy as np, urllib.request, json

CONN = "postgres://neondb_owner:npg_zlpZTMd4S9Qo@ep-restless-bush-a51ekyko-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"

def embed(text):
    req=urllib.request.Request("http://localhost:11434/api/embed",
        data=json.dumps({"model":"nomic-embed-text","input":text}).encode(),
        headers={"Content-Type":"application/json"})
    v=json.loads(urllib.request.urlopen(req).read())["embeddings"][0]
    v=np.array(v,dtype=np.float32); return v/(np.linalg.norm(v)+1e-8)

def descend(cur, qvec):
    """Walk from top level to a leaf, picking best-matching child each step."""
    path_trace=[]
    parent=None  # top-level nodes have parent_path NULL
    while True:
        if parent is None:
            cur.execute("SELECT path,is_leaf,centroid FROM fractal_nodes WHERE parent_path IS NULL AND depth=1")
        else:
            cur.execute("SELECT path,is_leaf,centroid FROM fractal_nodes WHERE parent_path=%s",(parent,))
        rows=cur.fetchall()
        if not rows: break
        best=None;best_sim=-2
        for path,is_leaf,cen in rows:
            cv=np.fromstring(cen.strip("[]"),sep=","); cv/=(np.linalg.norm(cv)+1e-8)
            s=float(qvec@cv)
            if s>best_sim: best_sim=s;best=(path,is_leaf)
        path_trace.append((best[0],round(best_sim,3)))
        if best[1]:  # is_leaf
            return best[0], path_trace
        parent=best[0]
    return (parent, path_trace)

def main():
    conn=psycopg2.connect(CONN);cur=conn.cursor()
    queries=[
        "how did we fix the bridge server flushing chunks to neon",
        "fractal address core hash identity",
        "psi0 harmonic resonance frequency constant",
    ]
    for q in queries:
        qv=embed(q)
        leaf,trace=descend(cur,qv)
        print(f"\nQUERY: {q}")
        print("  descent: "+" -> ".join(f"{p.split('/')[-1]}({s})" for p,s in trace))
        # fetch the leaf's addresses
        cur.execute("SELECT address,LEFT(content,90) FROM transcript_archive WHERE bloom_path=%s LIMIT 4",(leaf,))
        rows=cur.fetchall()
        print(f"  LEAF '{leaf}' -> {len(rows)} sample addresses:")
        for a,snip in rows: print(f"    {a}  | {snip.strip()[:70]}")
    cur.close();conn.close()
    print("\nDESCENT TEST COMPLETE")

main()
