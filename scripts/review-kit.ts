// Human-review kits (UNIFIED_MONITOR_PLAN.md §12 H2–H4). They PREPARE material for named reviewers; nothing here labels, verifies
// or approves anything by itself.
//   npx tsx scripts/review-kit.ts link-benchmark        → docs/review/link_benchmark_v1/ (frozen sample; predictions kept in a separate file)
//   npx tsx scripts/review-kit.ts score-links <csv>     → precision/recall with Wilson 95 % intervals from a reviewer-labelled copy
//   npx tsx scripts/review-kit.ts language-corpus       → docs/review/language_corpus_v1.csv (Arabic/Persian items + editable review columns)
//   npx tsx scripts/review-kit.ts pair-queue            → docs/review/pair_review_queue.csv (Polymarket–Kalshi candidates with both rule texts)
//   npx tsx scripts/review-kit.ts approve-pairs <csv>   → adds ONLY fully reviewed, named, reasoned pairs to data/contract_equivalence.json
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { approvePairs, wilson } from '../server/review/pairs.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'docs/review');
const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
const csv = (cols: string[], rows: unknown[][]) => [cols.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n') + '\n';
function parseCsv(text: string): Record<string, string>[] {
  const out: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); out.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  const [head, ...rows] = out.filter((r) => r.some((c) => c.trim()));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
/** Deterministic PRNG so the sample can be regenerated exactly from the recorded seed. */
function mulberry32(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const shuffle = <T>(a: T[], rnd: () => number) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const cmd = process.argv[2];
const SEED = 20261009;

if (cmd === 'link-benchmark') {
  const { db } = await import('../server/db.ts');
  const { buildIdf, matchPair } = await import('../server/link.ts');
  const { extractEntities } = await import('../server/geo.ts');
  const rnd = mulberry32(SEED);
  const markets = db.prepare('SELECT condition_id, venue, question, event_title, resolution_text, end_date, url, event_slug FROM markets WHERE is_open = 1').all() as Record<string, any>[];
  const events = db.prepare("SELECT id, source_id, external_id, published_at, title, summary, raw_url FROM events WHERE relevant = 1 AND published_at >= ? ORDER BY published_at").all(new Date(Date.now() - 30 * 86400e3).toISOString()) as Record<string, any>[];
  const idf = buildIdf(markets.map((m) => `${m.question}. ${m.event_title}`));
  const linked = new Set((db.prepare('SELECT event_id, condition_id FROM event_market_links').all() as Record<string, string>[]).map((r) => `${r.event_id}|${r.condition_id}`));
  const ents = (t: string) => new Set(extractEntities(t).all);
  const mEnts = new Map(markets.map((m) => [m.condition_id, ents(`${m.question}. ${m.event_title}`)]));
  type P = { e: Record<string, any>; m: Record<string, any>; stratum: string; predicted: boolean };
  const A: P[] = [], B: P[] = [], C: P[] = [];
  for (const e of events) {
    const et = `${e.title}. ${e.summary}`, ee = ents(et);
    for (const m of markets) {
      const k = `${e.id}|${m.condition_id}`;
      const pred = !!matchPair(et, `${m.question}. ${m.event_title}`, idf);
      if (linked.has(k)) A.push({ e, m, stratum: 'rule_link', predicted: true });
      else if ([...mEnts.get(m.condition_id)!].some((x) => ee.has(x) && x !== 'United States')) B.push({ e, m, stratum: 'shared_entity_not_linked', predicted: pred });
      else if (rnd() < 0.002) C.push({ e, m, stratum: 'random_no_shared_entity', predicted: pred });
    }
  }
  const perSource = new Map<string, number>();
  const take = (pool: P[], n: number) => { const out: P[] = []; for (const p of shuffle(pool, rnd)) { const s = p.e.source_id; if ((perSource.get(s) ?? 0) >= 15) continue; perSource.set(s, (perSource.get(s) ?? 0) + 1); out.push(p); if (out.length >= n) break; } return out; };
  const sample = shuffle([...take(A, 40), ...take(B, 40), ...take(C, 20)], rnd);
  const dir = resolve(OUT, 'link_benchmark_v1');
  if (existsSync(resolve(dir, 'manifest.json'))) { console.error(`${dir} already exists — the frozen sample is never regenerated in place. Create link_benchmark_v2 instead.`); process.exit(1); }
  mkdirSync(dir, { recursive: true });
  const ruleHash = createHash('sha256').update(readFileSync(resolve(ROOT, 'server/link.ts'))).digest('hex').slice(0, 16);
  const rows = sample.map((p) => {
    const id = createHash('sha1').update(`${p.e.source_id}:${p.e.external_id}|${p.m.condition_id}`).digest('hex').slice(0, 12);
    return { id, split: parseInt(id.slice(0, 2), 16) % 2 ? 'eval' : 'dev', p };
  });
  writeFileSync(resolve(dir, 'review.csv'), csv(['pair_id', 'split', 'item_published_at', 'item_source', 'item_title', 'item_excerpt', 'item_url', 'contract_venue', 'contract_question', 'contract_rules_excerpt', 'contract_deadline_utc', 'contract_url', 'label (relevant|irrelevant|ambiguous)', 'reviewer', 'notes'],
    rows.map(({ id, split, p }) => [id, split, p.e.published_at, p.e.source_id, p.e.title, String(p.e.summary).slice(0, 400), p.e.raw_url, p.m.venue, p.m.question, String(p.m.resolution_text ?? '').replace(/\s+/g, ' ').slice(0, 500), p.m.end_date, p.m.url ?? `https://polymarket.com/event/${p.m.event_slug}`, '', '', ''])));
  writeFileSync(resolve(dir, 'predictions.json'), JSON.stringify({ _readme: 'HIDDEN from the reviewer: do not share until labels are final. stratum + the rule decision per pair.', rule: 'server/link.ts (rule v3)', rule_sha256_16: ruleHash, pairs: Object.fromEntries(rows.map(({ id, p }) => [id, { stratum: p.stratum, predicted_link: p.predicted }])) }, null, 1));
  writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify({
    frozen_at: new Date().toISOString(), rule: 'link rule v3 (server/link.ts)', rule_sha256_16: ruleHash, seed: SEED,
    recipe: 'Relevant items of the last 30 days × open contracts. Strata: 40 pairs the rule linked; 40 pairs sharing ≥1 named entity that the rule did not link; 20 random pairs with no shared entity (≈0.2 % Bernoulli pre-sample). At most 15 pairs per source. Shuffled; split by pair-id hash (dev/eval).',
    counts: { total: rows.length, by_stratum: Object.fromEntries(['rule_link', 'shared_entity_not_linked', 'random_no_shared_entity'].map((s) => [s, rows.filter((r) => r.p.stratum === s).length])), dev: rows.filter((r) => r.split === 'dev').length, eval: rows.filter((r) => r.split === 'eval').length },
    rules: 'Tune only on dev. The eval split stays untouched until a final claim; once used for tuning it becomes development data. The earlier fixture server/fixtures/link_benchmark.json was labelled by an AI agent and is not independent.',
  }, null, 1));
  writeFileSync(resolve(dir, 'LABEL_GUIDE.md'), `# Link benchmark v1 — labelling guide\n\nFor each row decide whether the prediction-market contract is **explicitly relevant** to the news item: would a careful analyst reading the item reasonably look at this contract's price because the item is about the same actors, place and kind of development the contract resolves on?\n\n- **relevant** — the item concerns what the contract resolves on (same actors/place/kind of event).\n- **irrelevant** — shared words or countries only; the contract's resolution does not depend on this kind of development.\n- **ambiguous** — reasonable analysts could disagree; keep it ambiguous rather than forcing a choice, and say why in notes.\n\nRelevance is not causation and not a forecast. Do not look at the tracker's links or at \`predictions.json\` while labelling. Fill \`reviewer\` on every labelled row (name or approved identifier). Adjudicate disagreements between reviewers in notes. Then run \`npx tsx scripts/review-kit.ts score-links <your file>\`.\n`);
  console.log(`froze ${rows.length} pairs → ${dir} (dev ${rows.filter((r) => r.split === 'dev').length}, eval ${rows.filter((r) => r.split === 'eval').length}); pools: ${A.length} links, ${B.length} near-misses, ${C.length} random`);
} else if (cmd === 'score-links' && process.argv[3]) {
  const dir = resolve(OUT, 'link_benchmark_v1');
  const pred = JSON.parse(readFileSync(resolve(dir, 'predictions.json'), 'utf8')).pairs as Record<string, { stratum: string; predicted_link: boolean }>;
  const rows = parseCsv(readFileSync(process.argv[3], 'utf8'));
  const labelCol = Object.keys(rows[0] ?? {}).find((k) => k.startsWith('label')) ?? 'label';
  const labelled = rows.filter((r) => r[labelCol]);
  const noReviewer = labelled.filter((r) => !r.reviewer);
  if (noReviewer.length) { console.error(`${noReviewer.length} labelled row(s) have no reviewer — results are only reported for named, independent review.`); process.exit(1); }
  const lines: string[] = [`# Link benchmark v1 — results (${new Date().toISOString()})`, '', `Reviewers: ${[...new Set(labelled.map((r) => r.reviewer))].join(', ')}. Ambiguous rows are excluded from precision/recall and counted separately. Recall is measured within the sampled strata, not over all possible pairs.`, '', '| Split | n labelled | ambiguous | precision (95 % CI) | recall within sample (95 % CI) |', '|---|---|---|---|---|'];
  for (const split of ['dev', 'eval']) {
    const s = labelled.filter((r) => r.split === split), clear = s.filter((r) => r[labelCol] !== 'ambiguous');
    const tp = clear.filter((r) => pred[r.pair_id]?.predicted_link && r[labelCol] === 'relevant').length;
    const fp = clear.filter((r) => pred[r.pair_id]?.predicted_link && r[labelCol] === 'irrelevant').length;
    const fn = clear.filter((r) => !pred[r.pair_id]?.predicted_link && r[labelCol] === 'relevant').length;
    const f = (k: number, n: number) => { const w = wilson(k, n); return n ? `${(100 * k / n).toFixed(0)} % (${(100 * w![0]).toFixed(0)}–${(100 * w![1]).toFixed(0)} %, ${k}/${n})` : 'n/a'; };
    lines.push(`| ${split} | ${s.length} | ${s.length - clear.length} | ${f(tp, tp + fp)} | ${f(tp, tp + fn)} |`);
  }
  const p = resolve(dir, `results_${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(p, lines.join('\n') + '\n');
  console.log(lines.join('\n'), `\n→ ${p}`);
} else if (cmd === 'language-corpus') {
  const { db } = await import('../server/db.ts');
  const rnd = mulberry32(SEED + 1);
  const pick = (lang: string, rel: number, n: number) => shuffle(db.prepare('SELECT * FROM events WHERE language = ? AND relevant = ?').all(lang, rel) as Record<string, any>[], rnd).slice(0, n);
  const items = ['ar', 'fa'].flatMap((l) => [...pick(l, 1, 40), ...pick(l, 0, 20)]);
  mkdirSync(OUT, { recursive: true });
  const p = resolve(OUT, 'language_corpus_v1.csv');
  if (existsSync(p)) { console.error(`${p} exists — never regenerated in place; create v2.`); process.exit(1); }
  writeFileSync(p, csv(['item_id', 'language', 'source', 'url', 'published_at', 'original_title', 'original_excerpt', 'extracted_relevant', 'extracted_entities', 'extracted_topics', 'extracted_place', 'place_precision', 'time_precision',
    'reviewer', 'relevant_ok (yes|no|unsure)', 'entities_ok (yes|no)', 'place_ok (yes|no)', 'negation_or_tense_issue', 'corrections', 'notes'],
    items.map((e) => [e.id, e.language, e.source_id, e.raw_url, e.published_at, e.title, String(e.summary).slice(0, 500), e.relevant ? 'yes' : 'no', e.entities, e.topics, e.location_name ?? '', e.loc_precision ?? '', e.time_precision, '', '', '', '', '', '', ''])));
  console.log(`wrote ${items.length} items (ar ${items.filter((i) => i.language === 'ar').length}, fa ${items.filter((i) => i.language === 'fa').length}) → ${p}. Original text is untranslated by design.`);
} else if (cmd === 'pair-queue') {
  const { db } = await import('../server/db.ts');
  const { findCounterparts, loadVerified } = await import('../server/equivalence.ts');
  const rows = db.prepare("SELECT condition_id AS id, venue, question, event_title, end_date, price, quote_basis, resolution_text, url, event_slug FROM markets WHERE is_open = 1").all() as Record<string, any>[];
  const pool: Record<string, any>[] = rows.map((r) => ({ ...r, url: r.url ?? `https://polymarket.com/event/${r.event_slug}` }));
  const seen = new Set<string>(), out: unknown[][] = [];
  for (const t of pool.filter((m) => m.venue === 'polymarket')) for (const c of findCounterparts(t as never, pool as never, loadVerified(), 3)) {
    const k = `${t.id}|${c.condition_id}`; if (seen.has(k)) continue; seen.add(k);
    const kx = pool.find((m) => m.id === c.condition_id)!;
    out.push([t.id, c.condition_id, t.question, kx.question, t.end_date, kx.end_date, c.end_delta_days, t.url, kx.url, String(t.resolution_text ?? '').replace(/\s+/g, ' '), String(kx.resolution_text ?? '').replace(/\s+/g, ' '), c.score, c.shared_entities.join('; '), c.warnings.join(' '), '', '', '', '', '', '', '']);
  }
  mkdirSync(OUT, { recursive: true });
  const p = resolve(OUT, 'pair_review_queue.csv');
  writeFileSync(p, csv(['polymarket_id', 'kalshi_id', 'polymarket_question', 'kalshi_question', 'polymarket_end_utc', 'kalshi_end_utc', 'deadline_gap_days', 'polymarket_url', 'kalshi_url', 'polymarket_rules', 'kalshi_rules', 'text_similarity', 'shared_entities', 'warnings',
    'reviewer', 'equivalent (yes|no|partial)', 'outcome_alignment (same|inverted|different)', 'deadline_and_timezone_checked (yes|no)', 'resolution_source_checked (yes|no)', 'rationale', 'review_date'], out));
  console.log(`wrote ${out.length} candidate pair(s) → ${p}. None is verified until a named reviewer completes every check.`);
} else if (cmd === 'approve-pairs' && process.argv[3]) {
  const file = resolve(ROOT, 'data/contract_equivalence.json');
  const eq = JSON.parse(readFileSync(file, 'utf8')) as { _readme: string; pairs: Record<string, string>[] };
  const r = approvePairs(parseCsv(readFileSync(process.argv[3], 'utf8')), eq.pairs as never);
  eq.pairs = r.pairs as never;
  const added = r.added, rejected = r.rejected;
  writeFileSync(file, JSON.stringify(eq, null, 2) + '\n');
  console.log(`added ${added} verified pair(s); ${rejected} reviewed row(s) not approved (need equivalent=yes, outcome_alignment=same, both checks = yes, a reviewer and a rationale ≥ 20 chars).`);
} else {
  console.log('usage: npx tsx scripts/review-kit.ts link-benchmark | score-links <csv> | language-corpus | pair-queue | approve-pairs <csv>');
}
