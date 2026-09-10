function keyFor(row, key) {
  const value = row?.[key];
  if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError(`Missing ranking key ${key}.`);
  return String(value);
}

export function reciprocalRankFusion(lists, { key = 'id', limit = 10, rankConstant = 60, weights = [] } = {}) {
  const fused = new Map();
  lists.forEach((list, listIndex) => {
    const weight = weights[listIndex] ?? 1;
    list.forEach((row, rowIndex) => {
      const id = keyFor(row, key);
      const current = fused.get(id) ?? { row, score: 0, matches: [] };
      current.score += weight / (rankConstant + rowIndex + 1);
      current.matches.push({ list: listIndex, rank: rowIndex + 1 });
      fused.set(id, current);
    });
  });
  return [...fused.values()]
    .sort((left, right) => right.score - left.score || keyFor(left.row, key).localeCompare(keyFor(right.row, key)))
    .slice(0, limit)
    .map(({ row, score, matches }) => ({ ...row, retrievalScore: Number(score.toFixed(8)), retrievalMatches: matches }));
}

export function diversifyByDocument(rows, limit, maximumPerDocument = 2) {
  const counts = new Map();
  const selected = [];
  for (const row of rows) {
    const document = String(row.docId ?? row.doc_id ?? row.id ?? 'unknown');
    const count = counts.get(document) ?? 0;
    if (count >= maximumPerDocument) continue;
    counts.set(document, count + 1);
    selected.push(row);
    if (selected.length >= limit) break;
  }
  return selected;
}
