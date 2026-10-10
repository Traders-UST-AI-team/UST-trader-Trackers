import { fetchJson } from '../http.ts';
import { extractEntities } from '../geo.ts';
import { db, tx } from '../db.ts';
import { bump } from '../versions.ts';

const GAMMA = 'https://gamma-api.polymarket.com';
const clobBase = () => process.env.POLYMARKET_CLOB_BASE ?? 'https://clob.polymarket.com'; // overridable for fault-injection tests

// Tag slugs that are Middle-East specific are trusted; broad ones (geopolitics, military) are filtered by entity text.
const ME_TAGS = ['middle-east', 'iran', 'israel', 'gaza', 'yemen', 'houthis', 'lebanon', 'syria', 'saudi-arabia', 'hezbollah', 'iraq', 'strait-of-hormuz'];
const BROAD_TAGS = ['geopolitics', 'military'];

interface GammaMarket {
  id: string; conditionId: string; question: string; description?: string; outcomes?: string; outcomePrices?: string;
  clobTokenIds?: string; endDate?: string; startDate?: string; active?: boolean; closed?: boolean; acceptingOrders?: boolean;
  enableOrderBook?: boolean; volumeNum?: number; volume24hr?: number; liquidityNum?: number; updatedAt?: string;
  bestBid?: number; bestAsk?: number; lastTradePrice?: number; spread?: number; oneDayPriceChange?: number; oneWeekPriceChange?: number;
}
interface GammaEvent { id: string; slug: string; title: string; markets?: GammaMarket[]; tags?: { slug: string; label: string }[] }

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const parseArr = (s?: string): string[] => { try { const v = JSON.parse(s ?? '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };

/**
 * Quote convention (from the plan): midpoint only when both sides are valid;
 * otherwise an explicitly labelled last trade; never silently switch. 0 is never substituted for missing.
 */
export function chooseQuote(m: Pick<GammaMarket, 'bestBid' | 'bestAsk' | 'lastTradePrice' | 'outcomePrices'>): { price: number | null; basis: 'midpoint' | 'last_trade' | 'provider_price' | null } {
  const bid = num(m.bestBid), ask = num(m.bestAsk);
  if (bid !== null && ask !== null && bid > 0 && ask > 0 && ask >= bid && ask <= 1) return { price: (bid + ask) / 2, basis: 'midpoint' };
  const last = num(m.lastTradePrice);
  if (last !== null && last > 0 && last < 1) return { price: last, basis: 'last_trade' };
  const op = Number(parseArr(m.outcomePrices)[0]);
  if (Number.isFinite(op) && op > 0 && op < 1) return { price: op, basis: 'provider_price' };
  return { price: null, basis: null };
}

async function fetchTagEvents(tag: string, pages = 1): Promise<GammaEvent[]> {
  const out: GammaEvent[] = [];
  for (let i = 0; i < pages; i++) {
    const url = `${GAMMA}/events?active=true&closed=false&tag_slug=${tag}&limit=100&offset=${i * 100}&order=volume24hr&ascending=false`;
    const page = await fetchJson<GammaEvent[]>(url);
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

export interface PolymarketResult { events: number; markets: number; historyFetched: number; warnings: string[] }

export async function ingestPolymarket(opts: { historyTop?: number } = {}): Promise<PolymarketResult> {
  const warnings: string[] = [];
  const events = new Map<string, GammaEvent>();
  let okTags = 0, consecutiveFails = 0;
  for (const tag of [...ME_TAGS, ...BROAD_TAGS]) {
    // Circuit breaker: two failures in a row means the API is down/limiting us; stop instead of hammering it.
    if (consecutiveFails >= 2) { warnings.push('aborted remaining tag queries after 2 consecutive failures'); break; }
    try {
      const evs = await fetchTagEvents(tag, BROAD_TAGS.includes(tag) ? 2 : 1);
      okTags++; consecutiveFails = 0;
      for (const ev of evs) {
        if (events.has(ev.id)) continue;
        const text = `${ev.title} ${(ev.markets ?? []).slice(0, 5).map((m) => m.question).join(' ')} ${(ev.tags ?? []).map((t) => t.slug).join(' ')}`;
        const trusted = ME_TAGS.includes(tag);
        if (trusted || extractEntities(text).me.length > 0) events.set(ev.id, ev);
      }
    } catch (e) {
      consecutiveFails++;
      warnings.push(`tag ${tag}: ${(e as Error).message}`);
    }
  }
  if (okTags === 0) throw new Error(`all Polymarket tag queries failed (${warnings[0] ?? 'unknown'})`);

  const now = Date.now();
  const observedAt = new Date().toISOString();
  type Row = { m: GammaMarket; ev: GammaEvent };
  const rows: Row[] = [];
  for (const ev of events.values()) {
    const open = (ev.markets ?? []).filter((m) =>
      m.conditionId && m.active && !m.closed && m.acceptingOrders !== false && m.enableOrderBook !== false &&
      (!m.endDate || Date.parse(m.endDate) > now) && ((m.liquidityNum ?? 0) >= 500 || (m.volume24hr ?? 0) > 0));
    open.sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0) || (b.liquidityNum ?? 0) - (a.liquidityNum ?? 0));
    for (const m of open.slice(0, 8)) rows.push({ m, ev }); // cap sub-markets per event (e.g. 120-candidate leaders)
  }
  rows.sort((a, b) => (b.m.volume24hr ?? 0) - (a.m.volume24hr ?? 0));
  const kept = rows.slice(0, 200);

  tx(() => {
    db.prepare("UPDATE markets SET is_open = 0 WHERE venue = 'polymarket'").run();
    const up = db.prepare(`INSERT INTO markets (condition_id, gamma_id, event_id, event_slug, event_title, question, outcome_label, token_id, start_date, end_date,
        resolution_text, tags, price, quote_basis, best_bid, best_ask, spread, one_day_change, one_week_change, volume_total, volume_24h, liquidity,
        provider_updated_at, observed_at, is_open)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(condition_id) DO UPDATE SET gamma_id=excluded.gamma_id, event_id=excluded.event_id, event_slug=excluded.event_slug,
        event_title=excluded.event_title, question=excluded.question, outcome_label=excluded.outcome_label, token_id=excluded.token_id,
        start_date=excluded.start_date, end_date=excluded.end_date, resolution_text=excluded.resolution_text, tags=excluded.tags,
        price=excluded.price, quote_basis=excluded.quote_basis, best_bid=excluded.best_bid, best_ask=excluded.best_ask, spread=excluded.spread,
        one_day_change=excluded.one_day_change, one_week_change=excluded.one_week_change, volume_total=excluded.volume_total,
        volume_24h=excluded.volume_24h, liquidity=excluded.liquidity, provider_updated_at=excluded.provider_updated_at,
        observed_at=excluded.observed_at, is_open=1`);
    const obs = db.prepare(`INSERT OR REPLACE INTO market_obs (condition_id, observed_at, price, basis, bid, ask, volume_24h, liquidity) VALUES (?,?,?,?,?,?,?,?)`);
    for (const { m, ev } of kept) {
      const outcomes = parseArr(m.outcomes);
      const tokens = parseArr(m.clobTokenIds);
      const q = chooseQuote(m);
      up.run(m.conditionId, m.id, ev.id, ev.slug, ev.title, m.question, outcomes[0] ?? 'Yes', tokens[0] ?? null, m.startDate ?? null, m.endDate ?? null,
        m.description ?? '', JSON.stringify((ev.tags ?? []).map((t) => t.slug)), q.price, q.basis, num(m.bestBid), num(m.bestAsk), num(m.spread),
        num(m.oneDayPriceChange), num(m.oneWeekPriceChange), num(m.volumeNum), num(m.volume24hr), num(m.liquidityNum), m.updatedAt ?? null, observedAt);
      obs.run(m.conditionId, observedAt, q.price, q.basis, num(m.bestBid), num(m.bestAsk), num(m.volume24hr), num(m.liquidityNum));
    }
  });

  bump('polymarket');
  // Fetch provider history for the most active contracts now; the rest are loaded lazily when selected.
  const top = kept.slice(0, opts.historyTop ?? 30);
  let historyFetched = 0, histFails = 0;
  for (const { m } of top) {
    if (histFails >= 3) { warnings.push('history refresh aborted after 3 consecutive failures'); break; }
    const r = await ensureHistory(m.conditionId, { maxAgeMin: 30 });
    if (r === 'fetched') historyFetched++;
    histFails = r === 'error' ? histFails + 1 : 0;
    if (r === 'error') warnings.push(`history ${m.conditionId.slice(0, 10)}…`);
  }
  return { events: events.size, markets: kept.length, historyFetched, warnings };
}

interface ClobHistory { history?: { t: number; p: number }[] }

export async function ensureHistory(conditionId: string, o: { maxAgeMin: number }): Promise<'fresh' | 'fetched' | 'error' | 'no-token'> {
  const row = db.prepare('SELECT token_id, start_date FROM markets WHERE condition_id = ?').get(conditionId) as { token_id: string | null; start_date: string | null } | undefined;
  if (!row?.token_id) return 'no-token';
  const meta = db.prepare('SELECT fetched_at, error FROM history_meta WHERE condition_id = ?').get(conditionId) as { fetched_at: string; error: string | null } | undefined;
  if (meta && !meta.error && Date.now() - Date.parse(meta.fetched_at) < o.maxAgeMin * 60_000) return 'fresh';
  // Hourly fidelity first; some long-lived markets reject fine fidelity over a long range, so fall back to coarser.
  for (const fidelity of [60, 360, 1440]) {
    try {
      const j = await fetchJson<ClobHistory>(`${clobBase()}/prices-history?market=${row.token_id}&interval=max&fidelity=${fidelity}`, { retries: 2 });
      const pts = (j.history ?? []).filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p));
      if (pts.length === 0) throw new Error('provider returned an empty history'); // never replace a stored series with nothing
      // REPLACE the stored series with the provider's current one. Accumulating across refetches kept every trailing "price at fetch time"
      // point, which produced off-grid samples and fake gaps in hourly indicators; replacing also lets provider revisions of old points through.
      tx(() => {
        db.prepare('DELETE FROM price_history WHERE condition_id = ?').run(conditionId);
        const ins = db.prepare('INSERT OR REPLACE INTO price_history (condition_id, t, p) VALUES (?,?,?)');
        for (const x of pts) ins.run(conditionId, x.t, x.p);
        db.prepare('INSERT OR REPLACE INTO history_meta (condition_id, fetched_at, fidelity, error) VALUES (?,?,?,NULL)').run(conditionId, new Date().toISOString(), fidelity);
      });
      bump('polymarket');
      return 'fetched';
    } catch (e) {
      if (fidelity === 1440) {
        db.prepare('INSERT OR REPLACE INTO history_meta (condition_id, fetched_at, fidelity, error) VALUES (?,?,?,?)').run(conditionId, new Date().toISOString(), fidelity, (e as Error).message);
        return 'error';
      }
    }
  }
  return 'error';
}
