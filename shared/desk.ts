// The desk: turns a few hundred items into a short, ranked reading list for a trader.
//
// Items are grouped into stories (the server's cross-outlet grouping), each story is scored by
// fixed rules, and only stories that clear a bar are returned. Every point of the score comes with
// a reason, so the ranking can be read and argued with. A linked contract's move is the venue's
// own 24h change, shown next to the story because they coincide, not because one caused the other.
import type { Market, TrackerEvent } from './types';

export type DeskBand = 'top' | 'watch';

export interface DeskReason { key: string; label: string; points: number }

export interface DeskContract {
  condition_id: string; question: string; venue: string; price: number | null;
  /** Venue-reported 24h change (probability units), null when the venue gives none. */
  change_24h: number | null;
}

export interface DeskStory {
  /** story_id when several outlets carry it, otherwise the item id. */
  id: string;
  lead: TrackerEvent;
  /** Every loaded item in the story, newest first. */
  items: TrackerEvent[];
  /** Distinct outlets across the whole story group, including items older than the window. */
  outlets: string[];
  /** Independence groups across the whole story group (see StoryInfo). */
  independent: number;
  first_at: string;
  last_at: string;
  contracts: DeskContract[];
  /** The thread's score: the best of this story and its related stories. */
  score: number;
  /** Why this story (the headline shown) ranks; strongest first, penalties last. */
  reasons: DeskReason[];
  band: DeskBand;
  /** Lower-ranked stories about the same development, folded under this one. */
  related: DeskStory[];
}

export interface DeskResult {
  stories: DeskStory[];
  /** Items considered, and how many were left out as low-signal. */
  considered: number;
  dropped: number;
}

export const DESK_RULES = {
  hours: 24,
  topMin: 6,
  watchMin: 4,
  topMax: 8,
  watchMax: 20,
  halfLifeH: 18,
} as const;

const SPECIFIC = new Set(['security', 'shipping', 'energy', 'sanctions', 'nuclear']);
const OFFICIAL_KINDS = new Set(['official', 'maritime']);
const TRADE_PRESS = new Set(['gcaptain', 'splash247']);

const HARD = /\b(strikes?|struck|attack(s|ed)?|missiles?|drones?|killed|kills?|dead|deaths?|explosions?|blasts?|seiz(e|ed|es|ure)|hijack\w*|tankers?|vessels?|ships?|blockade|clos(e|ed|ure)|shut|sanction(s|ed)?|blacklist\w*|ceasefire|truce|nuclear|enrich\w*|invasion|troops|evacuat\w*|airspace|intercept\w*|mines?|escalat\w*|retaliat\w*|bomb\w*|raids?|halt(s|ed)?|suspend(s|ed)?|exports?|pipelines?|refiner(y|ies)|warning|operation|offensive)\b/i;
const SOFT = /(\bin photos\b|^photos?:|^film\b|\bfilm\s*\||\bvideo\b|\bfestival\b|\bconcert\b|\|\s*letters\b|\bopinion\b|\bpodcast\b|\bold news\b|\bvoices from\b|\bpro league\b|\bfootball\b|\bceltic\b|\bmuseum\b|\bmausoleum\b|\bexplainer\b|\bwhat we know\b|\binterview\b|\bstocks? cashing\b)/i;
const ROUNDUP = /(\brecap\b|^\w+ update,|\bupdates?:|\blive\b:?|\bday \d+\b|\bdaily press briefing\b)/i;

/**
 * Why a single item is low-signal for a trader, or null when it is not: a feature/culture piece, no
 * market-relevant topic, or a foreign-language headline nobody has translated yet. The desk and the
 * Feed's "Signal" view use the same rule, so an item hidden in one is hidden in the other.
 */
export function lowSignalReason(x: { title: string; title_en?: string | null; language: string | null; topics: string[] }): string | null {
  const head = x.title_en ?? x.title;
  if (SOFT.test(head)) return 'feature';
  if (!x.topics.length) return 'no market topic';
  if (x.language && x.language !== 'en' && !x.title_en) return 'untranslated';
  return null;
}

const STOP = new Set(('a an the and or but of in on at to for from by with as is are was were be been it its this that these those after before over under into out up down new says say said ' +
  'will would could may might has have had not no more most than also amid about against between during while who what when where why how their his her our they report').split(' '));

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[’']s\b/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)).map((w) => w.replace(/(ing|ed|es|s)$/u, (m, _g, off) => (off >= 4 ? '' : m))));
}
const jaccard = (a: Set<string>, b: Set<string>) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n || 1); };

const TIER_RANK: Record<string, number> = { 'Tier-1': 0, 'Tier-2': 1, 'Tier-3': 2 };
const headline = (e: TrackerEvent) => e.title_en ?? e.title;
const readable = (e: TrackerEvent) => e.language === 'en' || !!e.title_en;
const outletOf = (e: TrackerEvent) => e.publisher ?? e.source_name.split(' — ')[0];

/** Best item to show for a story: readable, best-tier publisher, then the most recent. */
function pickLead(items: TrackerEvent[]): TrackerEvent {
  return [...items].sort((a, b) => Number(readable(b)) - Number(readable(a))
    || (TIER_RANK[a.reliability_tier] ?? 3) - (TIER_RANK[b.reliability_tier] ?? 3)
    || Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
}

/** Smallest 24h move (probability units) that earns market points. */
const MOVING = 0.02;

const ppLabel = (x: number) => `${x >= 0 ? '▲' : '▼'} ${Math.abs(x * 100).toFixed(1)} pp`;

/** Strongest event-to-contract link score among a story's items, per contract. */
function linkStrength(items: TrackerEvent[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of items) for (const c of e.linked_contracts) out.set(c.condition_id, Math.max(out.get(c.condition_id) ?? 0, c.score));
  return out;
}

const independenceOf = (items: TrackerEvent[]) => Math.max(1, ...items.map((e) => e.story?.independence_groups ?? 1));

/**
 * Score one story. `carries` says which linked contracts' moves this story may count in full; a move
 * on any other linked contract is credited to a better-linked story, so here it only counts as touching
 * a moving market. Omitted, every linked move counts (the first pass, before moves are assigned).
 */
function scoreStory(items: TrackerEvent[], markets: ReadonlyMap<string, Market>, now: number, carries?: ReadonlySet<string>): Omit<DeskStory, 'band' | 'related'> {
  const lead = pickLead(items);
  const byTime = [...items].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  // Outlets and independence both describe the whole story group (which can reach back before the window), so they share a basis.
  const outlets = [...new Set([...items.map(outletOf), ...items.flatMap((e) => e.story?.publishers.map((p) => p.name) ?? [])])];
  const independent = Math.max(lead.story?.independence_groups ?? 0, independenceOf(items));
  const contracts = new Map<string, DeskContract>();
  for (const e of items) for (const c of e.linked_contracts) {
    if (contracts.has(c.condition_id)) continue;
    const m = markets.get(c.condition_id);
    contracts.set(c.condition_id, { condition_id: c.condition_id, question: c.question, venue: c.venue, price: m?.price ?? c.price, change_24h: m?.change_24h ?? m?.one_day_change ?? null });
  }
  const cs = [...contracts.values()].sort((a, b) => Math.abs(b.change_24h ?? 0) - Math.abs(a.change_24h ?? 0));

  const pos: DeskReason[] = [], neg: DeskReason[] = [];
  const add = (key: string, label: string, points: number) => (points >= 0 ? pos : neg).push({ key, label, points });

  const big = cs.find((c) => c.change_24h != null && (!carries || carries.has(c.condition_id)));
  const move = Math.abs(big?.change_24h ?? 0);
  if (move >= 0.10) add('market', `Linked market ${ppLabel(big!.change_24h!)} 24h`, 4);
  else if (move >= 0.05) add('market', `Linked market ${ppLabel(big!.change_24h!)} 24h`, 3);
  else if (move >= 0.02) add('market', `Linked market ${ppLabel(big!.change_24h!)} 24h`, 1.5);
  else if (cs.some((c) => Math.abs(c.change_24h ?? 0) >= MOVING)) add('market-shared', 'Touches a moving market (a higher-ranked story carries the move)', 1);
  else if (cs.length) add('market', `Touches ${cs.length} contract${cs.length === 1 ? '' : 's'}`, 1);

  if (independent >= 5) add('confirm', `${independent} independent outlets`, 3.5);
  else if (independent >= 3) add('confirm', `${independent} independent outlets`, 2.5);
  else if (independent === 2) add('confirm', '2 independent outlets', 1.5);

  const official = items.find((e) => OFFICIAL_KINDS.has(e.source_kind) && !TRADE_PRESS.has(e.source_id));
  if (official) add('official', `Official: ${outletOf(official).split(/[—(]/)[0].trim()}`, 2.5);
  else if (items.some((e) => e.reliability_tier === 'Tier-1')) add('tier', 'Tier-1 outlet', 1);

  const text = items.filter(readable).map(headline).join(' \n ');
  const topics = new Set(items.flatMap((e) => e.topics));
  if (HARD.test(text)) add('hard', 'Hard news', 1.5);
  if ([...topics].some((t) => SPECIFIC.has(t))) add('topic', [...topics].filter((t) => SPECIFIC.has(t)).slice(0, 2).join(' · '), 1);
  if (items.some((e) => e.focus_energy_shipping)) add('focus', 'Energy & shipping', 1);
  const asset = items.flatMap((e) => e.assets).find((a) => a.relation === 'explicitly_named');
  if (asset) add('asset', asset.name, 1);
  const fresh = items.filter((e) => now - Date.parse(e.timestamp) < 3 * 3600_000).length;
  if (fresh >= 2) add('developing', 'Developing', 1);

  if (items.every((e) => e.reliability_tier === 'Tier-3')) add('state', 'State media only', -2);
  if (SOFT.test(headline(lead))) add('soft', 'Feature, not news', -6);
  else if (ROUNDUP.test(headline(lead))) add('roundup', 'Roundup', -2);
  if (!topics.size) add('notopic', 'No market topic', -2);
  if (!items.some(readable)) add('untranslated', 'Untranslated', -2);

  const ageH = Math.max(0, (now - Date.parse(byTime[0].timestamp)) / 3600_000);
  const decay = Math.max(0.5, 0.5 ** (ageH / DESK_RULES.halfLifeH));
  const raw = pos.reduce((s, r) => s + r.points, 0) * decay + neg.reduce((s, r) => s + r.points, 0);
  return {
    id: lead.story?.story_id ?? lead.id, lead, items: byTime, outlets, independent,
    first_at: byTime[byTime.length - 1].timestamp, last_at: byTime[0].timestamp, contracts: cs,
    score: Math.round(raw * 10) / 10, reasons: [...pos.sort((a, b) => b.points - a.points), ...neg],
  };
}

/** Two stories are the same development when they share a named actor and either their headlines overlap or most of their contracts do. */
function sameThread(a: DeskStory, b: DeskStory): boolean {
  const ea = new Set(a.items.flatMap((e) => e.entities)), eb = b.items.flatMap((e) => e.entities);
  if (!eb.some((x) => ea.has(x))) return false;
  const wa = words(a.items.filter(readable).map(headline).join(' ')), wb = words(b.items.filter(readable).map(headline).join(' '));
  const titles = jaccard(wa, wb);
  if (titles >= 0.3) return true;
  const ca = new Set(a.contracts.map((c) => c.condition_id)), cb = b.contracts.map((c) => c.condition_id);
  if (!ca.size || !cb.length) return false;
  const shared = cb.filter((x) => ca.has(x)).length;
  return shared / Math.min(ca.size, cb.length) >= 0.6 && titles >= 0.12;
}

/**
 * Rank the last `hours` of relevant items into a reading list. Stories under the watch bar are
 * dropped: they are counted, not shown (the Feed keeps the full stream).
 */
export function rankDesk(events: TrackerEvent[], markets: ReadonlyMap<string, Market>, now: number, hours: number = DESK_RULES.hours): DeskResult {
  const since = now - hours * 3600_000;
  const pool = events.filter((e) => e.relevant && Date.parse(e.timestamp) >= since && Date.parse(e.timestamp) <= now + 600_000);
  const groups = new Map<string, TrackerEvent[]>();
  for (const e of pool) { const k = e.story?.story_id ?? e.id; (groups.get(k) ?? groups.set(k, []).get(k)!).push(e); }
  // One contract's move can be linked to many stories; only one should rank on it. The full move goes to
  // the highest-ranked story that links the contract (first-pass score, then link strength, then more
  // independent outlets, then the most recent); the others only "touch a moving market". Carriers are picked
  // among stories already above the bar, and no story gains points in the second pass, so nothing new crosses it.
  const stories0 = [...groups.values()].map((g) => ({ items: g, first: scoreStory(g, markets, now), links: linkStrength(g), independent: independenceOf(g) }));
  const carrier = new Map<string, (typeof stories0)[number]>();
  for (const s of stories0) {
    if (s.first.score < DESK_RULES.watchMin) continue;
    for (const [cid, strength] of s.links) {
      if (Math.abs((markets.get(cid)?.change_24h ?? markets.get(cid)?.one_day_change) ?? 0) < MOVING) continue;
      const cur = carrier.get(cid);
      if (!cur) { carrier.set(cid, s); continue; }
      const curStrength = cur.links.get(cid) ?? -1;
      const better = s.first.score !== cur.first.score ? s.first.score > cur.first.score
        : strength !== curStrength ? strength > curStrength
          : s.independent !== cur.independent ? s.independent > cur.independent
            : Date.parse(s.first.last_at) > Date.parse(cur.first.last_at);
      if (better) carrier.set(cid, s);
    }
  }
  const scored = stories0.map((s) => {
    const carries = new Set([...s.links.keys()].filter((cid) => carrier.get(cid) === s));
    return { ...scoreStory(s.items, markets, now, carries), band: 'watch' as DeskBand, related: [] as DeskStory[] };
  }).sort((a, b) => b.score - a.score || Date.parse(b.last_at) - Date.parse(a.last_at));

  const kept: DeskStory[] = [];
  for (const s of scored) {
    if (s.score < DESK_RULES.watchMin) break;
    const parent = kept.find((k) => sameThread(k, s));
    if (parent) { parent.related.push(s); continue; }
    kept.push(s);
  }
  // A thread is headed by its best straight-news story: a live blog or roundup can carry the thread's
  // score, but the headline the trader reads should be the development itself.
  const threads = kept.map((k) => {
    const members = [k, ...k.related];
    const head = members.find((m) => !m.reasons.some((r) => r.key === 'roundup' || r.key === 'soft')) ?? k;
    if (head === k) return k;
    return { ...head, score: k.score, related: members.filter((m) => m !== head) };
  });
  let top = 0;
  const stories: DeskStory[] = [];
  for (const s of threads) {
    if (s.score >= DESK_RULES.topMin && top < DESK_RULES.topMax) { s.band = 'top'; top++; stories.push(s); }
    else if (stories.length - top < DESK_RULES.watchMax) { s.band = 'watch'; stories.push(s); }
  }
  const shown = stories.reduce((n, s) => n + s.items.length + s.related.reduce((m, r) => m + r.items.length, 0), 0);
  return { stories, considered: pool.length, dropped: pool.length - shown };
}
