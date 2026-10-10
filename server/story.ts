// Cross-outlet story clustering. Purpose: stop "same story, N outlets" being read as "N independent confirmations".
// Deliberately conservative: a cluster means "these items appear to cover the same development", not "the claim is true".
import { db, tx } from './db.ts';
import { extractEntities } from './geo.ts';
import { SOURCE_META } from './registry.ts';

const STOP = new Set(('a an the and or but of in on at to for from by with as is are was were be been it its this that these those after before over under into out up down new says say said ' +
  'will would could may might has have had not no yes more most less than also amid about against between during while who whom what when where why how their his her our your us we they he she').split(' '));
const WINDOW_H = 72;
const MAX_GAP_H = 48;
const THRESHOLD = 0.34;      // best pair inside a merge must be at least this similar
const AVG_THRESHOLD = 0.27;  // and the average over comparable pairs at least this

/** Light normalisation so "strikes/struck/striking" collapse; not a real stemmer, just enough for headlines. */
export function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[’']s\b/g, '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
    .map((w) => w.replace(/(ing|ed|es|s)$/u, (m, _g, off) => (off >= 4 ? '' : m)));
}

interface Item { id: string; source_id: string; outlet: string; ts: number; vec: Map<string, number>; norm: number; ents: Set<string>; cites: string[] }

// Wires/primary sources whose copy is routinely re-reported; two items citing the same one share an independence group.
const CITES = /\b(Reuters|AFP|Associated Press|AP|Axios|UKMTO|CENTCOM|IDF|IRGC|Anadolu|IRNA|Al-Manar|Tasnim|Fars|Sky News|CNN|Wall Street Journal|WSJ|New York Times|Washington Post)\b/g;

/** Evidence-origin group: a publisher is its own group unless its text cites a wire/primary source, in which case it joins that
 *  source's group (retellings of one upstream report are one origin, not independent confirmations). Shared by claim review. */
export function originGroupOf(text: string, outlet: string, sourceName = ''): string {
  const cites = [...new Set([...text.matchAll(CITES)].map((m) => m[1]))].filter((c) => c.toLowerCase() !== sourceName.toLowerCase());
  return cites.length ? `cites:${cites.sort()[0]}` : `pub:${outlet}`;
}

export function cosine(a: Item, b: Item): number {
  let dot = 0;
  const [s, l] = a.vec.size < b.vec.size ? [a, b] : [b, a];
  for (const [t, w] of s.vec) { const o = l.vec.get(t); if (o) dot += w * o; }
  return dot / (a.norm * b.norm || 1);
}

export interface StoryRow { event_id: string; story_id: string; size: number }

export function rebuildStories(): { items: number; stories: number; multi: number } {
  const since = new Date(Date.now() - WINDOW_H * 3600_000).toISOString();
  const rows = db.prepare('SELECT id, source_id, COALESCE(outlet, source_id) AS outlet, published_at, title, summary FROM events WHERE relevant = 1 AND published_at >= ? ORDER BY published_at').all(since) as unknown as
    { id: string; source_id: string; outlet: string; published_at: string; title: string; summary: string }[];
  const docs = rows.map((r) => ({ r, toks: [...tokens(`${r.title} ${r.title} ${r.summary}`)] })); // title counted twice
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d.toks)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length || 1;
  const items: Item[] = docs.map(({ r, toks }) => {
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vec = new Map<string, number>();
    let norm = 0;
    for (const [t, c] of tf) { const w = (1 + Math.log(c)) * Math.log(1 + N / (df.get(t) ?? 1)); vec.set(t, w); norm += w * w; }
    const text = `${r.title}. ${r.summary}`;
    return { id: r.id, source_id: r.source_id, outlet: r.outlet, ts: Date.parse(r.published_at), vec, norm: Math.sqrt(norm), ents: new Set(extractEntities(text).all), cites: [...new Set([...text.matchAll(CITES)].map((m) => m[1]))] };
  });

  // Average-linkage agglomeration over *comparable* pairs (different outlet, within the time window, ≥1 shared entity).
  // Average-link (not single-link) so one shared word like "Turkey" cannot chain unrelated items into a story.
  const n = items.length;
  const sim: (number | null)[][] = Array.from({ length: n }, () => Array<number | null>(n).fill(null));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = items[i], b = items[j];
    if (a.outlet === b.outlet || Math.abs(a.ts - b.ts) > MAX_GAP_H * 3600_000) continue;
    let shared = 0;
    for (const e of a.ents) if (b.ents.has(e)) shared++;
    if (shared === 0) continue;
    sim[i][j] = sim[j][i] = cosine(a, b) + Math.min(0.08, 0.03 * shared);
  }
  let clusters: number[][] = items.map((_, i) => [i]);
  const link = (A: number[], B: number[]) => {
    let sum = 0, cnt = 0, max = 0;
    for (const i of A) for (const j of B) { const v = sim[i][j]; if (v !== null) { sum += v; cnt++; if (v > max) max = v; } }
    if (!cnt || cnt < 0.5 * A.length * B.length || max < THRESHOLD) return -1; // need a strong pair AND broad agreement
    return sum / cnt;
  };
  for (;;) {
    let best = -1, bi = -1, bj = -1;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const v = link(clusters[i], clusters[j]);
      if (v > best) { best = v; bi = i; bj = j; }
    }
    if (best < AVG_THRESHOLD) break;
    if (process.env.STORY_DEBUG) console.log(`merge avg=${best.toFixed(2)}`, clusters[bi].map((k) => rows[k].title.slice(0, 40)), '+', clusters[bj].map((k) => rows[k].title.slice(0, 40)));
    clusters[bi] = clusters[bi].concat(clusters[bj]);
    clusters = clusters.filter((_, k) => k !== bj);
  }
  const groups = new Map<number, number[]>(clusters.map((c, k) => [k, c]));

  let multi = 0;
  tx(() => {
    db.prepare('DELETE FROM stories').run();
    const ins = db.prepare('INSERT INTO stories (event_id, story_id, size) VALUES (?,?,?)');
    for (const idxs of groups.values()) {
      if (idxs.length < 2) continue;
      const members = idxs.map((i) => items[i]);
      const sid = `sty_${members.map((m) => m.id).sort()[0].slice(4)}`;
      for (const m of members) ins.run(m.id, sid, members.length);
      multi++;
    }
  });
  return { items: items.length, stories: groups.size, multi };
}

export interface StoryInfo {
  story_id: string;
  size: number;
  publishers: { source_id: string; name: string; tier: string; event_id: string; title: string; timestamp: string }[];
  /** Distinct independence groups under the stated assumption (see note). */
  independence_groups: number;
  state_only: boolean;
  note: string;
}

export function storyFor(eventId: string): StoryInfo | null {
  const me = db.prepare('SELECT story_id, size FROM stories WHERE event_id = ?').get(eventId) as { story_id: string; size: number } | undefined;
  if (!me) return null;
  const rows = db.prepare(`SELECT e.id, e.source_id, e.publisher, e.tier, COALESCE(e.outlet, e.source_id) AS outlet, e.title, e.published_at, e.summary FROM stories s JOIN events e ON e.id = s.event_id WHERE s.story_id = ? ORDER BY e.published_at`).all(me.story_id) as unknown as
    { id: string; source_id: string; publisher: string | null; tier: string | null; outlet: string; title: string; published_at: string; summary: string }[];
  const meta = SOURCE_META;
  const publishers = rows.map((r) => ({ source_id: r.source_id, name: r.publisher ?? meta.get(r.source_id)?.name.split(' — ')[0] ?? r.source_id, tier: r.tier ?? meta.get(r.source_id)?.tier ?? 'Tier-3', event_id: r.id, title: r.title, timestamp: r.published_at }));
  // Independence: each publisher is its own group, except items that cite the same wire/primary source collapse into that source's group.
  const groups = new Set<string>();
  for (const r of rows) groups.add(originGroupOf(`${r.title}. ${r.summary}`, r.outlet, meta.get(r.source_id)?.name ?? ''));
  return {
    story_id: me.story_id, size: rows.length, publishers, independence_groups: groups.size,
    state_only: publishers.every((p) => p.tier === 'Tier-3'),
    note: 'Items grouped by headline/entity similarity. Publishers are assumed independent unless two cite the same wire or primary source; real independence is unknown. Multiple outlets covering a story is not verification of its claims.',
  };
}
