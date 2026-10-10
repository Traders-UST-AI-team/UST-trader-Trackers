// Kalshi public market-data API (unauthenticated reads). A separate venue: contracts are never merged with Polymarket's.
import { fetchJson } from '../http.ts';
import { db, kvGet, kvSet, tx } from '../db.ts';
import { bump } from '../versions.ts';
import { extractEntities } from '../geo.ts';

const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const CATEGORIES = ['World', 'Politics', 'Economics', 'Commodities'];
const SERIES_RESCAN_HOURS = 6;

interface KSeries { ticker: string; title: string; category: string }
interface KMarket {
  ticker: string; event_ticker: string; title: string; yes_sub_title?: string; status: string; market_type?: string;
  yes_bid_dollars?: string; yes_ask_dollars?: string; last_price_dollars?: string;
  volume_fp?: string; volume_24h_fp?: string; open_interest_fp?: string;
  open_time?: string; close_time?: string; expected_expiration_time?: string; updated_time?: string;
  rules_primary?: string; rules_secondary?: string;
}
interface KEvent { event_ticker: string; series_ticker: string; title: string; sub_title?: string; markets?: KMarket[] }

const n = (x: unknown): number | null => { const v = typeof x === 'string' ? Number(x) : typeof x === 'number' ? x : NaN; return Number.isFinite(v) ? v : null; };

/** Same convention as Polymarket: midpoint only if both sides are a real two-sided quote; else labelled last trade. */
export function kalshiQuote(m: Pick<KMarket, 'yes_bid_dollars' | 'yes_ask_dollars' | 'last_price_dollars'>): { price: number | null; basis: 'midpoint' | 'last_trade' | null; bid: number | null; ask: number | null } {
  const bid = n(m.yes_bid_dollars), ask = n(m.yes_ask_dollars), last = n(m.last_price_dollars);
  // bid 0 / ask 1 is an empty book, not a quote.
  if (bid !== null && ask !== null && bid > 0 && ask < 1 && ask >= bid) return { price: (bid + ask) / 2, basis: 'midpoint', bid, ask };
  if (last !== null && last > 0 && last < 1) return { price: last, basis: 'last_trade', bid: bid && bid > 0 ? bid : null, ask: ask !== null && ask < 1 ? ask : null };
  return { price: null, basis: null, bid: null, ask: null };
}

async function discoverSeries(): Promise<KSeries[]> {
  const out: KSeries[] = [];
  for (const cat of CATEGORIES) {
    let cursor = '';
    for (let i = 0; i < 20; i++) {
      const d = await fetchJson<{ series?: KSeries[]; cursor?: string }>(`${BASE}/series?category=${encodeURIComponent(cat)}&limit=200${cursor ? `&cursor=${cursor}` : ''}`);
      for (const s of d.series ?? []) if (extractEntities(s.title).me.length > 0 || /\b(Maersk|Hormuz)\b/i.test(s.title)) out.push({ ticker: s.ticker, title: s.title, category: cat });
      cursor = d.cursor ?? '';
      if (!cursor) break;
    }
  }
  return out;
}

async function meSeries(): Promise<{ tickers: string[]; rescanned: boolean }> {
  const at = kvGet('kalshi_series_at');
  const cached = kvGet('kalshi_series');
  if (cached && at && Date.now() - Date.parse(at) < SERIES_RESCAN_HOURS * 3600_000) return { tickers: JSON.parse(cached), rescanned: false };
  const series = await discoverSeries();
  const dedup = [...new Set(series.map((s) => s.ticker))];
  kvSet('kalshi_series', JSON.stringify(dedup)); kvSet('kalshi_series_at', new Date().toISOString());
  return { tickers: dedup, rescanned: true };
}

export interface KalshiResult { series: number; events: number; markets: number; historyFetched: number; warnings: string[] }

export async function ingestKalshi(opts: { historyTop?: number } = {}): Promise<KalshiResult> {
  const warnings: string[] = [];
  const { tickers } = await meSeries();
  const events: KEvent[] = [];
  let fails = 0;
  for (const t of tickers) {
    if (fails >= 3) { warnings.push('aborted after 3 consecutive failures'); break; }
    try {
      const d = await fetchJson<{ events?: KEvent[] }>(`${BASE}/events?series_ticker=${t}&status=open&with_nested_markets=true&limit=100`, { retries: 1 });
      fails = 0;
      for (const e of d.events ?? []) events.push({ ...e, series_ticker: e.series_ticker || t });
    } catch (e) { fails++; warnings.push(`${t}: ${(e as Error).message.slice(0, 80)}`); }
  }
  if (events.length === 0 && fails > 0) throw new Error(`Kalshi events fetch failed (${warnings[0] ?? 'unknown'})`);

  const observedAt = new Date().toISOString();
  type Row = { m: KMarket; ev: KEvent };
  const rows: Row[] = [];
  for (const ev of events) for (const m of ev.markets ?? []) {
    if (m.status !== 'active' || (m.market_type && m.market_type !== 'binary')) continue;
    if (m.close_time && Date.parse(m.close_time) < Date.now()) continue;
    // Skip markets with no footprint at all (never traded, no open interest).
    if ((n(m.open_interest_fp) ?? 0) < 50 && (n(m.volume_fp) ?? 0) < 500) continue;
    rows.push({ m, ev });
  }
  rows.sort((a, b) => (n(b.m.volume_24h_fp) ?? 0) - (n(a.m.volume_24h_fp) ?? 0) || (n(b.m.open_interest_fp) ?? 0) - (n(a.m.open_interest_fp) ?? 0));
  const kept = rows.slice(0, 150);

  tx(() => {
    db.prepare("UPDATE markets SET is_open = 0 WHERE venue = 'kalshi'").run();
    const up = db.prepare(`INSERT INTO markets (condition_id, venue, ext_ref, url, volume_unit, open_interest, gamma_id, event_id, event_slug, event_title, question, outcome_label,
        token_id, start_date, end_date, resolution_text, tags, price, quote_basis, best_bid, best_ask, spread, one_day_change, one_week_change, volume_total, volume_24h,
        liquidity, provider_updated_at, observed_at, is_open)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(condition_id) DO UPDATE SET ext_ref=excluded.ext_ref, url=excluded.url, open_interest=excluded.open_interest, event_title=excluded.event_title,
        question=excluded.question, start_date=excluded.start_date, end_date=excluded.end_date, resolution_text=excluded.resolution_text, price=excluded.price,
        quote_basis=excluded.quote_basis, best_bid=excluded.best_bid, best_ask=excluded.best_ask, spread=excluded.spread, volume_total=excluded.volume_total,
        volume_24h=excluded.volume_24h, provider_updated_at=excluded.provider_updated_at, observed_at=excluded.observed_at, is_open=1`);
    const obs = db.prepare('INSERT OR REPLACE INTO market_obs (condition_id, observed_at, price, basis, bid, ask, volume_24h, liquidity) VALUES (?,?,?,?,?,?,?,?)');
    for (const { m, ev } of kept) {
      const id = `kalshi:${m.ticker}`;
      const q = kalshiQuote(m);
      const sub = (m.yes_sub_title ?? '').trim();
      const question = sub && !m.title.toLowerCase().includes(sub.toLowerCase()) ? `${m.title} — ${sub}` : m.title;
      const rules = [m.rules_primary, m.rules_secondary].filter(Boolean).join('\n\n');
      up.run(id, 'kalshi', `${ev.series_ticker}|${m.ticker}`, `https://kalshi.com/markets/${ev.series_ticker.toLowerCase()}`, 'contracts', n(m.open_interest_fp),
        m.ticker, ev.event_ticker, ev.series_ticker, ev.title, question, 'Yes', null, m.open_time ?? null, m.close_time ?? m.expected_expiration_time ?? null, rules, '[]',
        q.price, q.basis, q.bid, q.ask, q.bid !== null && q.ask !== null ? q.ask - q.bid : null, null, null, n(m.volume_fp), n(m.volume_24h_fp), null,
        m.updated_time ?? null, observedAt);
      obs.run(id, observedAt, q.price, q.basis, q.bid, q.ask, n(m.volume_24h_fp), null);
    }
  });

  bump('kalshi');
  let historyFetched = 0, histFails = 0;
  for (const { m } of kept.slice(0, opts.historyTop ?? 25)) {
    if (histFails >= 3) { warnings.push('history refresh aborted after 3 consecutive failures'); break; }
    const r = await ensureKalshiHistory(`kalshi:${m.ticker}`, { maxAgeMin: 60 });
    if (r === 'fetched') historyFetched++;
    histFails = r === 'error' ? histFails + 1 : 0;
  }
  return { series: tickers.length, events: events.length, markets: kept.length, historyFetched, warnings };
}

interface Candle { end_period_ts: number; yes_bid?: { close_dollars?: string }; yes_ask?: { close_dollars?: string } }

/**
 * History basis (stated in the UI): midpoint of each candle's closing yes-bid and yes-ask, only where both are a real
 * two-sided quote. Candles without one are omitted — gaps are shown as gaps, never filled.
 * Daily candles from market open, hourly candles for the most recent 30 days.
 */
export async function ensureKalshiHistory(conditionId: string, o: { maxAgeMin: number }): Promise<'fresh' | 'fetched' | 'error' | 'no-token'> {
  const row = db.prepare('SELECT ext_ref, start_date FROM markets WHERE condition_id = ?').get(conditionId) as { ext_ref: string | null; start_date: string | null } | undefined;
  if (!row?.ext_ref) return 'no-token';
  const meta = db.prepare('SELECT fetched_at, error FROM history_meta WHERE condition_id = ?').get(conditionId) as { fetched_at: string; error: string | null } | undefined;
  if (meta && !meta.error && Date.now() - Date.parse(meta.fetched_at) < o.maxAgeMin * 60_000) return 'fresh';
  const [series, ticker] = row.ext_ref.split('|');
  const now = Math.floor(Date.now() / 1000);
  const open = row.start_date ? Math.floor(Date.parse(row.start_date) / 1000) : now - 365 * 86400;
  const hourlyFrom = Math.max(open, now - 30 * 86400);
  const get = async (start: number, end: number, period: number) =>
    (await fetchJson<{ candlesticks?: Candle[] }>(`${BASE}/series/${series}/markets/${ticker}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=${period}`, { retries: 2 })).candlesticks ?? [];
  try {
    const pts = new Map<number, number>();
    const mid = (c: Candle) => { const b = n(c.yes_bid?.close_dollars), a = n(c.yes_ask?.close_dollars); return b !== null && a !== null && b > 0 && a < 1 && a >= b ? (a + b) / 2 : null; };
    if (hourlyFrom > open) for (const c of await get(open, hourlyFrom, 1440)) { const p = mid(c); if (p !== null) pts.set(c.end_period_ts, p); }
    for (const c of await get(hourlyFrom, now, 60)) { const p = mid(c); if (p !== null) pts.set(c.end_period_ts, p); }
    tx(() => {
      db.prepare('DELETE FROM price_history WHERE condition_id = ?').run(conditionId);
      const ins = db.prepare('INSERT OR REPLACE INTO price_history (condition_id, t, p) VALUES (?,?,?)');
      for (const [t, p] of pts) ins.run(conditionId, t, p);
      db.prepare('INSERT OR REPLACE INTO history_meta (condition_id, fetched_at, fidelity, error, basis) VALUES (?,?,?,NULL,?)').run(conditionId, new Date().toISOString(), 60, 'kalshi_candle_midpoint');
    });
    bump('kalshi');
    return 'fetched';
  } catch (e) {
    db.prepare('INSERT OR REPLACE INTO history_meta (condition_id, fetched_at, fidelity, error, basis) VALUES (?,?,?,?,?)').run(conditionId, new Date().toISOString(), 60, (e as Error).message, 'kalshi_candle_midpoint');
    return 'error';
  }
}
