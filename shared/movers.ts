// The movers board: open contracts grouped by event, ranked by how far they moved in 24 h.
//
// A venue lists one event as many contracts (a date ladder, a list of candidates). A trader reads the
// event, so contracts are grouped and the group is led by its biggest credible move. A move on a
// thin market (little 24h volume) is left out: a few hundred dollars can move a price 30 pp.
// News shown next to a move is a linked item (relevance pointer); the timing is coincident, not causal.
import type { Market, TrackerEvent } from './types';

export const MOVER_RULES = {
  /** Smallest 24h move, in probability units, that puts an event on the board. */
  minMove: 0.03,
  /** Below this 24h volume a contract's move does not count. Venue units differ (USD vs contracts), so each has its own bar. */
  thin: { USD: 1000, contracts: 2000 } as Record<string, number>,
  max: 30,
} as const;

export interface MarketGroup {
  /** The venue's event id. */
  id: string;
  title: string;
  venue: string;
  /** Contracts in the event, biggest credible move first, then by volume. */
  contracts: Market[];
  /** The same contracts as a ladder, highest price first (date and threshold ladders then read in order). */
  ladder: Market[];
  /** The contract that puts the group on the board (or the most traded one). */
  lead: Market;
  /** Short label for each contract inside its event (the question minus the words all of them share). */
  labels: Map<string, string>;
  volume_24h: number;
  /** Linked news items, newest first, one per story. */
  news: TrackerEvent[];
}

export const isThin = (m: Market) => (m.volume_24h ?? 0) < (MOVER_RULES.thin[m.volume_unit] ?? 1000);
const move = (m: Market) => Math.abs(m.change_24h ?? 0);

/** Drops the leading words every question in the group shares, so a ladder reads "Oct 31?" / "Nov 30?". */
function shortLabels(ms: Market[]): Map<string, string> {
  const out = new Map<string, string>();
  if (ms.length < 2) { for (const m of ms) out.set(m.condition_id, m.question); return out; }
  // Kalshi writes "<event question> — <outcome>"; when the outcomes differ, the outcome is the label.
  const tails = ms.map((m) => (m.question.includes(' — ') ? m.question.slice(m.question.lastIndexOf(' — ') + 3) : null));
  if (tails.every((t) => t) && new Set(tails).size === ms.length) { ms.forEach((m, i) => out.set(m.condition_id, tails[i]!)); return out; }
  const split = ms.map((m) => m.question.split(/\s+/));
  let n = 0;
  while (split.every((w) => w.length > n + 1 && w[n] === split[0][n])) n++;
  for (let i = 0; i < ms.length; i++) {
    const rest = split[i].slice(n).join(' ');
    out.set(ms[i].condition_id, rest.length >= 3 ? rest : ms[i].question);
  }
  return out;
}

export function groupMarkets(markets: Market[], events: TrackerEvent[]): MarketGroup[] {
  const newsBy = new Map<string, TrackerEvent[]>();
  for (const e of events) for (const c of e.linked_contracts) (newsBy.get(c.condition_id) ?? newsBy.set(c.condition_id, []).get(c.condition_id)!).push(e);
  const by = new Map<string, Market[]>();
  for (const m of markets) { const k = `${m.venue}:${m.event_id || m.condition_id}`; (by.get(k) ?? by.set(k, []).get(k)!).push(m); }
  return [...by.entries()].map(([id, ms]) => {
    const contracts = [...ms].sort((a, b) => Number(isThin(a)) - Number(isThin(b)) || move(b) - move(a) || (b.volume_24h ?? 0) - (a.volume_24h ?? 0));
    const seen = new Set<string>();
    const news = contracts.flatMap((m) => newsBy.get(m.condition_id) ?? [])
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .filter((e) => { const k = e.story?.story_id ?? e.id; if (seen.has(k)) return false; seen.add(k); return true; });
    return {
      id, title: ms[0].event_title || ms[0].question, venue: ms[0].venue, contracts, lead: contracts[0],
      ladder: [...ms].sort((a, b) => (b.price ?? -1) - (a.price ?? -1)), labels: shortLabels(ms),
      volume_24h: ms.reduce((s, m) => s + (m.volume_24h ?? 0), 0), news,
    };
  });
}

/** Events whose lead contract moved at least `minMove` on a non-thin market, biggest move first. */
export function rankMovers(groups: MarketGroup[]): { movers: MarketGroup[]; thinOnly: number } {
  const movers = groups.filter((g) => !isThin(g.lead) && move(g.lead) >= MOVER_RULES.minMove)
    .sort((a, b) => move(b.lead) - move(a.lead) || b.volume_24h - a.volume_24h).slice(0, MOVER_RULES.max);
  const thinOnly = groups.filter((g) => g.contracts.some((m) => isThin(m) && move(m) >= MOVER_RULES.minMove) && !movers.includes(g)).length;
  return { movers, thinOnly };
}
