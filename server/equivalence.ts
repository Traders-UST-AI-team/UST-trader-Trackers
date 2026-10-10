// Cross-venue contract counterparts (Polymarket ↔ Kalshi). NOTHING IS MERGED OR AVERAGED. Text-similar candidates are shown with their
// rules text and explicit warnings for a human to check; a price difference is shown ONLY for pairs listed as verified in
// data/contract_equivalence.json (outcome definition, deadline and resolution source checked by a named person).
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.ts';
import { tokens } from './story.ts';
import { extractEntities } from './geo.ts';

const VERIFIED_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'contract_equivalence.json');
export interface VerifiedPair { polymarket: string; kalshi: string; verified_by: string; verified_at: string; rules_note: string }

export function loadVerified(path = VERIFIED_FILE): VerifiedPair[] {
  if (!existsSync(path)) return [];
  try { return (JSON.parse(readFileSync(path, 'utf8')).pairs ?? []) as VerifiedPair[]; } catch { return []; }
}

interface Mkt { id: string; venue: string; question: string; event_title: string; end_date: string | null; price: number | null; quote_basis: string | null; resolution_text: string; url: string | null }
export interface Counterpart {
  condition_id: string; venue: string; question: string; price: number | null; quote_basis: string | null; end_date: string | null; rules_excerpt: string; url: string | null;
  score: number; end_delta_days: number | null; shared_entities: string[]; verified: boolean; verified_by: string | null; rules_note: string | null;
  warnings: string[];
}

const ENT = (m: Mkt) => extractEntities(`${m.question}. ${m.event_title}`).all.filter((e) => !['United States'].includes(e));
const bagOf = (m: Mkt) => new Set([...tokens(`${m.question} ${m.event_title}`), ...ENT(m).map((e) => `ent_${e}`)]);

export const SCORE_MIN = 0.45, END_DELTA_MAX_DAYS = 21;

/** Pure: candidates on the other venue for `target`, from `pool`. Needs ≥1 shared entity, similarity ≥ 0.45 and deadlines within 21 days. */
export function findCounterparts(target: Mkt, pool: Mkt[], verified: VerifiedPair[] = [], max = 3): Counterpart[] {
  const others = pool.filter((m) => m.venue !== target.venue);
  const docs = [target, ...others].map(bagOf);
  const df = new Map<string, number>(); for (const d of docs) for (const t of d) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length, w = (t: string) => Math.log(1 + N / (df.get(t) ?? 1));
  const a = docs[0], eA = new Set(ENT(target));
  const out: Counterpart[] = [];
  others.forEach((m, i) => {
    const b = docs[i + 1];
    let dot = 0, na = 0, nb = 0; for (const t of a) { na += w(t) ** 2; if (b.has(t)) dot += w(t) ** 2; } for (const t of b) nb += w(t) ** 2;
    const score = dot / Math.sqrt(na * nb || 1);
    const shared = ENT(m).filter((e) => eA.has(e));
    const delta = target.end_date && m.end_date ? Math.abs(Date.parse(target.end_date) - Date.parse(m.end_date)) / 86400e3 : null;
    const pair = verified.find((v) => (v.polymarket === target.id && v.kalshi === m.id) || (v.kalshi === target.id && v.polymarket === m.id));
    if (!pair && (score < SCORE_MIN || !shared.length || (delta !== null && delta > END_DELTA_MAX_DAYS))) return;
    const warnings = ['Text similarity is not equivalence: check the outcome definition, deadline and resolution source before comparing prices.'];
    if (delta !== null && delta > 3) warnings.push(`Deadlines differ by ${delta.toFixed(0)} days.`);
    if (target.quote_basis !== m.quote_basis) warnings.push(`Prices use different bases (${target.quote_basis ?? 'none'} vs ${m.quote_basis ?? 'none'}).`);
    warnings.push('Venues differ in fees, liquidity, regulation and who can trade; a price gap is not an arbitrage claim.');
    out.push({ condition_id: m.id, venue: m.venue, question: m.question, price: m.price, quote_basis: m.quote_basis, end_date: m.end_date, rules_excerpt: m.resolution_text.replace(/\s+/g, ' ').slice(0, 420), url: m.url,
      score: Math.round(score * 100) / 100, end_delta_days: delta === null ? null : Math.round(delta * 10) / 10, shared_entities: shared, verified: !!pair, verified_by: pair?.verified_by ?? null, rules_note: pair?.rules_note ?? null, warnings });
  });
  return out.sort((x, y) => Number(y.verified) - Number(x.verified) || y.score - x.score).slice(0, max);
}

export function counterpartsFor(conditionId: string): Counterpart[] {
  const rows = db.prepare("SELECT condition_id AS id, venue, question, event_title, end_date, price, quote_basis, resolution_text, url, event_slug FROM markets WHERE is_open = 1").all() as unknown as (Mkt & { event_slug: string })[];
  const pool = rows.map((r) => ({ ...r, url: r.url ?? `https://polymarket.com/event/${r.event_slug}` }));
  const target = pool.find((m) => m.id === conditionId);
  return target ? findCounterparts(target, pool, loadVerified()) : [];
}
