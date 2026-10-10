// Event ↔ contract linking (rule v2). A link needs (a) the event to name essentially ALL of the contract's Middle-East entities
// (coverage ≥ 0.66; "Israel" alone does not match "Israel military action against Lebanon"), (b) a shared topic — generic topics
// (diplomacy/politics/humanitarian) only count with ≥2 matched entities — and (c) the contract existed at publication.
// It is a relevance pointer with visible evidence, never a causal claim. Scored against server/fixtures/link_benchmark.json.
import { db, tx } from './db.ts';
import { ENTITIES, extractEntities, extractTopics } from './geo.ts';
import { tokens } from './story.ts';

const ME_NAMES = new Set(ENTITIES.filter((x) => x.me).map((x) => x.name));
const GENERIC = new Set(['Turkey']); // too ambiguous on its own to justify a contract link
// Topics that name a concrete kind of development. 'diplomacy', 'politics', 'humanitarian' are too generic to justify
// a link on one shared entity alone ("Israel" + "diplomacy" matches almost every Israel contract).
const SPECIFIC_TOPICS = new Set(['security', 'shipping', 'energy', 'sanctions', 'nuclear']);
const MAX_PER_EVENT = 6;
const MAX_PER_POLY_EVENT = 2;
const WINDOW_DAYS = 14;

/** Actors that unambiguously imply a country; used on both sides so "IRGC" can match a contract about Iran. */
const IMPLIES: Record<string, string> = { IRGC: 'Iran', Houthis: 'Yemen', Hezbollah: 'Lebanon', Hamas: 'Palestine', IDF: 'Israel' };
// Tuned on benchmark splits dev + holdout-1 (see server/fixtures/link_benchmark.json); judge it on a fresh holdout, not those.
const TERM_COVERAGE_MIN = 0.35;
const COVERAGE_MIN = 0.66; // 2-entity contracts need both; 3-entity contracts need two

function explicitME(text: string): Set<string> {
  return new Set(extractEntities(text).all.filter((n) => ME_NAMES.has(n) && !GENERIC.has(n)));
}
/** Explicit entities plus the countries they unambiguously imply (IRGC→Iran …). */
function withImplied(ents: Set<string>): Set<string> {
  const out = new Set(ents);
  for (const n of ents) if (IMPLIES[n]) out.add(IMPLIES[n]);
  return out;
}

export interface PairMatch { ents: string[]; topics: string[]; score: number; coverage: number }

// ---- distinctive-term coverage ----
// Contract words that carry no identity ("will", months, years…). Everything else is weighted by IDF over all open contracts, so a rare
// term ("pipeline", "Marib", "voicemail") the event never mentions drags the score down, while boilerplate ("military action") barely counts.
const FILLER = new Set(['will', 'before', 'end', 'ends', 'any', 'new', 'have', 'does', 'did', 'get', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept',
  'oct', 'nov', 'dec', 'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'year', 'month', 'week', 'day',
  'above', 'below', 'more', 'less', 'least', 'than', 'over', 'under', 'between', 'during', 'reported', 'source', 'agency', 'agencies']);

export type Idf = (token: string) => number;
export const flatIdf: Idf = () => 1;

/** Content tokens (stemmed words) + canonical entity tokens; entity tokens double the weight of identity terms. */
function bag(text: string, implied: boolean): Set<string> {
  const out = new Set<string>();
  for (const t of tokens(text)) if (!FILLER.has(t) && !/^\d+$/.test(t)) out.add(t);
  const ents = new Set(extractEntities(text).all);
  for (const n of ents) { out.add(`ent:${n}`); if (implied && IMPLIES[n]) out.add(`ent:${IMPLIES[n]}`); }
  return out;
}

export function buildIdf(contractTexts: string[]): Idf {
  const df = new Map<string, number>();
  for (const t of contractTexts) for (const tok of bag(t, false)) df.set(tok, (df.get(tok) ?? 0) + 1);
  const N = contractTexts.length;
  return (tok) => Math.log((N + 1) / ((df.get(tok) ?? 0) + 1)) + 1;
}

/**
 * Pure text-level rule (no time check).
 *  1. Every *explicitly named* contract entity must be named by the event (directly or via IRGC→Iran style implication) — coverage ≥ 0.66.
 *  2. At least one Middle-East entity matched, and a shared topic (generic topics need ≥2 matched entities).
 *  3. IDF-weighted share of the contract's distinctive terms present in the event ≥ TERM_COVERAGE_MIN.
 */
export function matchPair(eventText: string, contractText: string, idf: Idf = flatIdf): PairMatch | null {
  const cExp = new Set(extractEntities(contractText).all);
  const eFull = withImplied(new Set(extractEntities(eventText).all));
  const cME = [...cExp].filter((n) => ME_NAMES.has(n) && !GENERIC.has(n));
  if (!cME.length || !eFull.size) return null;
  const ents = [...cExp].filter((n) => eFull.has(n));
  const coverage = ents.length / cExp.size;
  const meMatched = ents.filter((n) => ME_NAMES.has(n) && !GENERIC.has(n));
  if (!meMatched.length || coverage < COVERAGE_MIN) return null;
  const eT = new Set(extractTopics(eventText));
  const topics = extractTopics(contractText).filter((t) => eT.has(t));
  if (!topics.length) return null;
  if (ents.length < 2 && !topics.some((t) => SPECIFIC_TOPICS.has(t))) return null;
  const cBag = bag(contractText, false), eBag = bag(eventText, true);
  let tot = 0, hit = 0;
  for (const t of cBag) { const w = idf(t); tot += w; if (eBag.has(t)) hit += w; }
  const termCoverage = tot ? hit / tot : 0;
  if (termCoverage < TERM_COVERAGE_MIN) return null;
  return { ents: meMatched, topics, coverage: termCoverage, score: 2 * meMatched.length + topics.length + termCoverage * 3 };
}

export function termCoverage(eventText: string, contractText: string, idf: Idf): number {
  const cBag = bag(contractText, false), eBag = bag(eventText, true);
  let tot = 0, hit = 0;
  for (const t of cBag) { const w = idf(t); tot += w; if (eBag.has(t)) hit += w; }
  return tot ? hit / tot : 0;
}

interface M { condition_id: string; event_id: string; text: string; start_date: string | null; volume_24h: number | null }

export function rebuildLinks(): { events: number; links: number } {
  const markets: M[] = (db.prepare('SELECT condition_id, event_id, question, event_title, start_date, volume_24h FROM markets WHERE is_open = 1').all() as unknown as
    { condition_id: string; event_id: string; question: string; event_title: string; start_date: string | null; volume_24h: number | null }[])
    .map((m) => ({ condition_id: m.condition_id, event_id: m.event_id, text: `${m.question}. ${m.event_title}`, start_date: m.start_date, volume_24h: m.volume_24h }));
  const idf = buildIdf(markets.map((m) => m.text));
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
  const events = db.prepare('SELECT id, published_at, title, summary FROM events WHERE relevant = 1 AND published_at >= ?').all(since) as unknown as { id: string; published_at: string; title: string; summary: string }[];
  let links = 0;
  tx(() => {
    db.prepare('DELETE FROM event_market_links').run();
    const ins = db.prepare('INSERT INTO event_market_links (event_id, condition_id, score, matched_entities, matched_topics) VALUES (?,?,?,?,?)');
    for (const ev of events) {
      const t = `${ev.title}. ${ev.summary}`;
      const cands: { m: M; pm: PairMatch }[] = [];
      for (const m of markets) {
        if (m.start_date && Date.parse(m.start_date) > Date.parse(ev.published_at)) continue;
        const pm = matchPair(t, m.text, idf);
        if (pm) cands.push({ m, pm });
      }
      cands.sort((a, b) => b.pm.score - a.pm.score || (b.m.volume_24h ?? 0) - (a.m.volume_24h ?? 0));
      const perPoly = new Map<string, number>();
      let n = 0;
      for (const c of cands) {
        if (n >= MAX_PER_EVENT) break;
        const k = perPoly.get(c.m.event_id) ?? 0;
        if (k >= MAX_PER_POLY_EVENT) continue;
        perPoly.set(c.m.event_id, k + 1);
        ins.run(ev.id, c.m.condition_id, c.pm.score, JSON.stringify(c.pm.ents), JSON.stringify(c.pm.topics));
        n++; links++;
      }
    }
  });
  return { events: events.length, links };
}
