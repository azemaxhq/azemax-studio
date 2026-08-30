// Minimal fuzzy matcher for Explorer search — subsequence matching with scoring.
// Keeps bundle tiny, no dependencies, deterministic, CPU-light for large trees.

export interface FuzzyResult {
  matched: boolean;
  score: number;
  // character indices in `text` that matched the query (lowercase comparison)
  indices: number[];
}

// Return matching indices if query characters appear in order inside text (case-insensitive).
// Score: lower is better (earlier + contiguous matches preferred).
export function fuzzyMatch(text: string, query: string): FuzzyResult {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return { matched: true, score: 0, indices: [] };
  if (t.includes(q)) {
    const start = t.indexOf(q);
    const indices: number[] = [];
    for (let i = 0; i < q.length; i++) indices.push(start + i);
    // strong bonus for substring match
    return { matched: true, score: start * 2 - q.length * 10, indices };
  }
  const indices: number[] = [];
  let qi = 0;
  let lastIdx = -2;
  let gaps = 0;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      if (ti !== lastIdx + 1) gaps++;
      score += ti; // earlier hits = lower score
      lastIdx = ti;
      qi++;
    }
  }
  if (qi !== q.length) return { matched: false, score: Infinity, indices: [] };
  // penalize gaps and spread
  score += gaps * 15 + (indices[indices.length - 1] - indices[0]) * 0.5;
  return { matched: true, score, indices };
}

export function fuzzyHighlight(text: string, indices: number[]): Array<{ text: string; highlight: boolean }> {
  if (indices.length === 0) return [{ text, highlight: false }];
  const set = new Set(indices);
  const parts: Array<{ text: string; highlight: boolean }> = [];
  let buf = '';
  let curHighlight = set.has(0);
  for (let i = 0; i < text.length; i++) {
    const h = set.has(i);
    if (h !== curHighlight) {
      if (buf) parts.push({ text: buf, highlight: curHighlight });
      buf = text[i];
      curHighlight = h;
    } else {
      buf += text[i];
    }
  }
  if (buf) parts.push({ text: buf, highlight: curHighlight });
  return parts;
}
