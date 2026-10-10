// Indicator service: reads STORED data only (never triggers ingestion), computes with shared/indicators.ts, caches results.
// Registered indicators with bounded parameters only — no arbitrary expressions, scripts or Pine.
import { db, kvGet, kvSet } from '../db.ts';
import { NEWS_SOURCES } from '../registry.ts';

/** Official sources that are actually connected, by registry kind rather than by a copied id list. */
const OFFICIAL_SOURCE_IDS = new Set(NEWS_SOURCES.filter((s) => s.kind === 'official' && s.enabled !== false).map((s) => s.id));
import * as I from '../../shared/indicators.ts';
import type { Coverage, IndicatorResult, IndPoint, IndStatus, Sample } from '../../shared/indicators.ts';
import { SENSORS } from '../sources/sensors.ts';
import { DEFS, MARKET_DEFAULTS, parseIds, REGISTRY_VERSION, type ParsedId } from './registry.ts';
import {
  cacheStats, clearCache, computeMarketOne, computeSensorOne, defaultSensorIds, iso,
  marketIndicatorsFromInput, sensorIndicatorsFromInput,
  type ComputeOpts, type IndicatorResponse, type MarketInput, type SensorInput,
} from './compute.ts';
export { clearCache, cacheStats, computeMarketOne, computeSensorOne, defaultSensorIds, marketIndicatorsFromInput, sensorIndicatorsFromInput } from './compute.ts';
export type { ComputeOpts, IndicatorResponse, MarketInput, SensorInput } from './compute.ts';

// Re-exported so existing importers keep one import site while the vocabulary moves out of the
// store-coupled module.
export { DEFS, MARKET_DEFAULTS, parseIds, REGISTRY_VERSION, registryEntries } from './registry.ts';
export type { IndicatorDef, ParsedId } from './registry.ts';
import type { Prefs, ReactionResult, WatchCard, WatchItem } from '../../shared/types.ts';
export type { Prefs, WatchCard, WatchItem } from '../../shared/types.ts';

// ───────────────────────────── registry ─────────────────────────────

// ───────────────────────────── inputs ─────────────────────────────

export function loadMarketInput(conditionId: string): MarketInput | null {
  const m = db.prepare('SELECT condition_id, venue, question, price, quote_basis, best_bid, best_ask, spread, liquidity, observed_at FROM markets WHERE condition_id = ?').get(conditionId) as Record<string, any> | undefined;
  if (!m) return null;
  const raw = (db.prepare('SELECT t, p FROM price_history WHERE condition_id = ? ORDER BY t').all(conditionId) as unknown as { t: number; p: number }[]).map((r) => ({ t: r.t, v: r.p }));
  const meta = db.prepare('SELECT fidelity, basis, fetched_at FROM history_meta WHERE condition_id = ?').get(conditionId) as { fidelity: number | null; basis: string | null; fetched_at: string | null } | undefined;
  const basisKey = meta?.basis ?? (m.venue === 'kalshi' ? 'kalshi_candle_midpoint' : 'polymarket_clob_price_history');
  const spread = m.best_bid != null && m.best_ask != null ? m.best_ask - m.best_bid : m.spread ?? null;
  return {
    id: conditionId, venue: m.venue, question: m.question, basis: `${m.venue}:${basisKey}`, basisKey, fidelity: meta?.fidelity ?? null, raw,
    version: I.fingerprintSamples(raw, [m.venue, basisKey, meta?.fidelity ?? 'na']), // COMPLETE input + venue + basis + sampling precision
    spread, liquidity: m.liquidity ?? null, price: m.price ?? null, quote_basis: m.quote_basis ?? null, observed_at: m.observed_at, history_fetched_at: meta?.fetched_at ?? null,
  };
}

export function loadSensorInput(seriesId: string): SensorInput | null {
  const def = SENSORS.find((s) => s.id === seriesId);
  if (!def) return null;
  const raw = (db.prepare('SELECT t, v FROM series_points WHERE series_id = ? ORDER BY t').all(seriesId) as unknown as { t: number; v: number }[]).map((r) => ({ t: r.t, v: r.v }));
  const meta = db.prepare('SELECT fetched_at FROM series_meta WHERE series_id = ?').get(seriesId) as { fetched_at: string } | undefined;
  return { id: seriesId, def, raw, version: I.fingerprintSamples(raw, [seriesId, def.provider]), fetched_at: meta?.fetched_at ?? null };
}

// ───────────────────────────── public API ─────────────────────────────

/**
 * The edge where the store is: resolve an id to the data it needs, then hand that to the pure
 * computation. Nothing below this line knows how an indicator is calculated; nothing above it
 * knows which tables exist.
 */
export function marketIndicators(conditionId: string, ids: string[], opts: ComputeOpts = {}): IndicatorResponse | null {
  const inp = loadMarketInput(conditionId);
  return inp ? marketIndicatorsFromInput(inp, ids, opts) : null;
}

export function sensorIndicators(seriesId: string, ids: string[], opts: ComputeOpts = {}): IndicatorResponse | null {
  const inp = loadSensorInput(seriesId);
  return inp ? sensorIndicatorsFromInput(inp, ids, opts) : null;
}

// ───────────────────────────── watchlist cards ─────────────────────────────


export const WATCHLIST_MAX = 8;

function validWatch(items: unknown): WatchItem[] | null {
  if (!Array.isArray(items) || items.length > WATCHLIST_MAX) return null;
  const out: WatchItem[] = [];
  for (const x of items) {
    if (!x || typeof x !== 'object') return null;
    const { kind, id } = x as Record<string, unknown>;
    if ((kind !== 'market' && kind !== 'sensor') || typeof id !== 'string' || id.length > 200) return null;
    if (kind === 'market' && !db.prepare('SELECT 1 FROM markets WHERE condition_id = ?').get(id)) return null;
    if (kind === 'sensor' && !SENSORS.some((s) => s.id === id)) return null;
    if (!out.some((o) => o.kind === kind && o.id === id)) out.push({ kind, id });
  }
  return out;
}

function defaultWatchlist(): WatchItem[] {
  const top = (venue: string) => (db.prepare("SELECT condition_id FROM markets WHERE venue = ? AND is_open = 1 AND price IS NOT NULL ORDER BY volume_24h DESC NULLS LAST LIMIT 1").get(venue) as { condition_id: string } | undefined)?.condition_id;
  const items: WatchItem[] = [];
  for (const v of ['polymarket', 'kalshi']) { const id = top(v); if (id) items.push({ kind: 'market', id }); }
  for (const s of ['pw:hormuz:total', 'fred:brent', 'ioda:IR:bgp', 'opensky:gulf:airborne']) if (SENSORS.some((x) => x.id === s)) items.push({ kind: 'sensor', id: s });
  return items.slice(0, 6);
}

export function getWatchlist(): WatchItem[] {
  const stored = kvGet('watchlist');
  if (stored) { try { const v = validWatch(JSON.parse(stored)); if (v) return v; } catch { /* fall through to defaults */ } }
  const d = defaultWatchlist();
  if (d.length) kvSet('watchlist', JSON.stringify(d)); // persisted on first use: "default to 4–6 pinned cards"
  return d;
}

export function setWatchlist(items: unknown): { ok: true; items: WatchItem[] } | { ok: false; error: string } {
  const v = validWatch(items);
  if (!v) return { ok: false, error: `invalid watchlist (max ${WATCHLIST_MAX} existing markets/sensors, each {kind,id})` };
  kvSet('watchlist', JSON.stringify(v));
  return { ok: true, items: v };
}

function sparkOf(raw: Sample[], asOf: number, n: number): [number, number][] {
  const reps = I.hourlyRepresentatives(I.normalize(raw, { min: 0, max: 1, asOf }).samples, asOf);
  return reps.slice(-n).map((r) => [r.t, 100 * r.v]);
}

export function watchCard(item: WatchItem, asOf: number): WatchCard | null {
  if (item.kind === 'market') {
    const inp = loadMarketInput(item.id);
    if (!inp) return null;
    const m = db.prepare('SELECT event_title FROM markets WHERE condition_id = ?').get(item.id) as { event_title: string };
    const res = marketIndicators(item.id, ['change_1h'], { asOf })!.indicators[0];
    const last = inp.raw.filter((s) => s.t <= asOf).at(-1);
    return {
      key: `market:${item.id}`, kind: 'market', id: item.id, title: inp.question, subtitle: `${inp.venue === 'kalshi' ? 'Kalshi' : 'Polymarket'} · ${m.event_title}`, venue: inp.venue, unit: '%',
      latest: { value: inp.price === null ? null : 100 * inp.price, label: `${inp.quote_basis ?? 'no quote'} quote`, observed_at: inp.observed_at, fetched_at: inp.history_fetched_at, basis: inp.quote_basis }, // obs = quote read time; fetched = price-history fetch
      change: { window: '1h', value: res.latest?.value ?? null, unit: 'pp', status: res.status, reason: res.reason, interval_s: (res.extra?.actual_interval_s as number | null) ?? null, detail: 'provider history basis, not the order-book quote' },
      sparkline: sparkOf(inp.raw, asOf, 72), status: res.status, note: last ? `history observed ${iso(last.t)}` : 'no history',
    };
  }
  const inp = loadSensorInput(item.id);
  if (!inp) return null;
  const family = item.id.split(':')[0];
  const ids = defaultSensorIds(item.id).slice(0, 1);
  const res = sensorIndicators(item.id, ids, { asOf })!.indicators[0];
  const x = (res.extra ?? {}) as Record<string, any>;
  const last = inp.raw.filter((s) => s.t <= asOf).at(-1);
  let change: WatchCard['change'] = null;
  if (family === 'pw') change = { window: 'vs trailing 28-day mean', value: x.pct_change ?? null, unit: '%', status: res.status, reason: res.reason, interval_s: null, detail: x.baseline_mean == null ? 'baseline unavailable' : `baseline mean ${(x.baseline_mean as number).toFixed(1)} ${inp.def.unit}` };
  else if (family === 'fred') change = { window: 'vs previous published', value: x.pct_change ?? null, unit: '%', status: res.status, reason: res.reason, interval_s: x.days_between == null ? null : (x.days_between as number) * 86400, detail: 'daily spot; delayed' };
  else change = { window: 'vs previous observation', value: x.change_vs_previous ?? null, unit: inp.def.unit, status: res.status, reason: res.reason, interval_s: null, detail: 'observed change only; no anomaly baseline' };
  return {
    key: `sensor:${item.id}`, kind: 'sensor', id: item.id, title: inp.def.title, subtitle: inp.def.provider, venue: null, unit: inp.def.unit,
    latest: { value: last?.v ?? null, label: inp.def.group === 'chokepoint' || family === 'fred' ? 'latest published observation (not live)' : 'latest observation', observed_at: iso(last?.t), fetched_at: inp.fetched_at, basis: inp.def.provider },
    change, sparkline: inp.raw.filter((s) => s.t <= asOf).slice(-60).map((s) => [s.t, s.v] as [number, number]), status: res.status, note: res.reason,
  };
}

export function watchlistCards(asOf = Math.floor(Date.now() / 1000)): { as_of: number; definition_version: string; cards: WatchCard[] } {
  const cards = getWatchlist().map((i) => watchCard(i, asOf)).filter((c): c is WatchCard => !!c);
  return { as_of: asOf, definition_version: I.DEFINITION_VERSION, cards };
}

// ───────────────────────────── preferences ─────────────────────────────

export const PANE_IDS = ['rsi14', 'macd'] as const;
export const DEFAULT_PREFS: Prefs = { indicators: ['sma24'], axis: 'auto', range: '30d', panes: [] };

export function getPrefs(): Prefs {
  try { const p = JSON.parse(kvGet('prefs') ?? 'null'); return sanitizePrefs(p) ?? DEFAULT_PREFS; } catch { return DEFAULT_PREFS; }
}

export function sanitizePrefs(p: unknown): Prefs | null {
  if (!p || typeof p !== 'object') return null;
  const x = p as Record<string, unknown>;
  const inds = Array.isArray(x.indicators) ? x.indicators.filter((i): i is string => typeof i === 'string') : null;
  if (!inds || inds.length > 6) return null;
  const parsed = parseIds(inds, 'market');
  const overlays = parsed.ok.filter((o) => o.def.overlay).map((o) => o.raw);
  if (parsed.bad.length || overlays.length !== inds.length) return null; // only registered OVERLAY indicators may be preferences
  if (x.axis !== 'auto' && x.axis !== 'fixed') return null;
  if (!['24h', '7d', '30d', 'all'].includes(x.range as string)) return null;
  let panes: string[] = [];
  if (x.panes !== undefined) {
    if (!Array.isArray(x.panes) || x.panes.length > PANE_IDS.length || x.panes.some((q) => typeof q !== 'string' || !(PANE_IDS as readonly string[]).includes(q)) || new Set(x.panes).size !== x.panes.length) return null;
    panes = x.panes as string[];
  }
  return { indicators: overlays, axis: x.axis, range: x.range as Prefs['range'], panes };
}

export function setPrefs(p: unknown): { ok: true; prefs: Prefs } | { ok: false; error: string } {
  const v = sanitizePrefs(p);
  if (!v) return { ok: false, error: 'invalid preferences (indicators must be registered overlay ids like sma24/ema72/bollinger; panes only rsi14/macd; axis auto|fixed; range 24h|7d|30d|all)' };
  kvSet('prefs', JSON.stringify(v));
  return { ok: true, prefs: v };
}

// ───────────────────────────── information activity ─────────────────────────────

export interface ActivityWindow { window: string; collected: { total: number; news: number; official: number; telegram: number }; late_collected: number }

/** Counts by COLLECTION time (events.first_seen_at, tg_posts.first_seen_at where seen_via='latest'); publication-time distribution is separate.
 * News items first seen long after publication (> 6 h) are counted as late-collected, and Telegram back-fills are not counted as new at all. */
export function activityIndicators(now = Date.now()) {
  const win = (ms: number, label: string): ActivityWindow => {
    const since = new Date(now - ms).toISOString();
    const rows = db.prepare(`SELECT source_id, published_at, first_seen_at FROM events WHERE first_seen_at >= ? AND relevant = 1`).all(since) as unknown as { source_id: string; published_at: string; first_seen_at: string }[];
    // Derived from the registry, and only from sources that can actually deliver: the old literal
    // set included reliefweb-me, which is disabled, so "official" counted a source that never
    // contributes an item.
    const official = OFFICIAL_SOURCE_IDS;
    let news = 0, off = 0, late = 0;
    for (const r of rows) {
      if (Date.parse(r.first_seen_at) - Date.parse(r.published_at) > 6 * 3600_000) { late++; continue; }
      if (official.has(r.source_id)) off++; else news++;
    }
    const tg = (db.prepare("SELECT COUNT(*) c FROM tg_posts WHERE first_seen_at >= ? AND seen_via = 'latest'").get(since) as { c: number }).c;
    return { window: label, collected: { total: news + off + tg, news, official: off, telegram: tg }, late_collected: late };
  };
  const dist = (db.prepare(`SELECT substr(published_at, 1, 13) h, COUNT(*) c FROM events WHERE published_at >= ? AND relevant = 1 AND time_precision = 'instant' GROUP BY h ORDER BY h`).all(new Date(now - 24 * 3600_000).toISOString()) as unknown as { h: string; c: number }[]);
  const src = db.prepare("SELECT status, last_success_at FROM source_health").all() as unknown as { status: string; last_success_at: string | null }[];
  const ok = src.filter((s) => s.status === 'ok').length;
  return {
    as_of: new Date(now).toISOString(), windows: [win(15 * 60_000, '15m'), win(3600_000, '1h')], publication_distribution_24h: dist.map((d) => ({ hour_utc: `${d.h}:00Z`, items: d.c })),
    coverage: { sources_reporting: src.length, sources_ok: ok, success_rate: src.length ? ok / src.length : null },
    notes: ['Counts are items COLLECTED in the window (collection time), not events that occurred in it.', 'Telegram back-fills and news items first seen > 6 h after publication are not counted as new.', 'Watchlist activity only — not platform-wide volume or sentiment. Reposts and similar reports are not independent confirmations.'],
  };
}


// ───────────────────────────── event reaction (descriptive) ─────────────────────────────

const labelOf = (move: number | null, b: ReactionResult['baseline']): ReactionResult['label_event_hour'] => {
  if (move === null || !b) return 'unavailable';
  const a = Math.abs(move);
  return a > b.p95_pp ? 'above_p95' : a > 2 * b.median_pp ? 'above_typical' : 'within_ordinary';
};

/**
 * Price context around an item's publication, on the completed-hour grid: the move in the hour containing publication and in the next hour
 * (adjacent-hour pairs, directly comparable with the contract's own hourly-move baseline), plus the level change 24 h later. The baseline uses
 * only pairs that END BEFORE the event hour, so the event never contaminates its own yardstick. Date-only items cannot be aligned to an hour.
 * Descriptive timing only — never a statement of cause.
 */
export function eventReaction(conditionId: string, ts: number, precision: 'instant' | 'date', asOf = Math.floor(Date.now() / 1000)): ReactionResult | null {
  const inp = loadMarketInput(conditionId);
  if (!inp) return null;
  const caveats = ['Coincident timing only — not evidence of cause.', 'Many items are published every hour; this cannot isolate any one of them.'];
  const empty = (status: IndStatus, reason: string): ReactionResult => ({ status, reason, event_t: ts, hour_bucket: null, prev: null, in_hour: null, next: null, day_after: null, move_event_hour_pp: null, move_next_hour_pp: null, level_change_24h_pp: null, baseline: null, label_event_hour: 'unavailable', label_next_hour: 'unavailable', caveats, definition_version: I.DEFINITION_VERSION, input_version: inp.version });
  if (precision === 'date') return empty('unsupported', 'date-only item: it cannot be aligned to a precise hourly price reaction');
  const nz = I.normalize(inp.raw, { min: 0, max: 1, asOf });
  if (nz.spacing_median_s === null || nz.spacing_median_s > I.CONFIG.hourly_max_median_spacing_s) return empty('unsupported', 'history is not hourly');
  const reps = I.hourlyRepresentatives(nz.samples, asOf);
  const at = new Map(reps.map((r) => [r.bucket, r]));
  const b = Math.floor(ts / 3600) * 3600;
  if (!reps.length || b < reps[0].bucket) return empty('warming_up', 'the item predates this contract\'s history');
  const prev = at.get(b - 3600) ?? null, inHour = at.get(b) ?? null, next = at.get(b + 3600) ?? null, day = at.get(b + 24 * 3600) ?? null;
  const pt = (r: { t: number; v: number } | null) => (r ? { t: r.t, p_pct: 100 * r.v } : null);
  const moveEvent = prev && inHour ? 100 * (inHour.v - prev.v) : null;
  const moveNext = inHour && next ? 100 * (next.v - inHour.v) : null;
  const level24 = prev && day ? 100 * (day.v - prev.v) : null;
  // baseline: adjacent-hour pairs whose LATER bucket is before the event hour (point-in-time), up to 168, ≥ 48
  const pairs: number[] = [];
  for (let i = 1; i < reps.length; i++) if (reps[i].bucket <= b - 3600 && reps[i].bucket - reps[i - 1].bucket === 3600) pairs.push(Math.abs(100 * (reps[i].v - reps[i - 1].v)));
  const prior = pairs.slice(-I.CONFIG.hourly_movement.max_pairs);
  const baseline = prior.length >= I.CONFIG.hourly_movement.min_pairs ? (() => { const sorted = [...prior].sort((x, y) => x - y); return { n: sorted.length, median_pp: I.quantile7(sorted, 0.5)!, p95_pp: I.quantile7(sorted, 0.95)! }; })() : null;
  const status: IndStatus = moveEvent === null && moveNext === null ? 'warming_up' : 'ok';
  const reason = status === 'warming_up' ? (asOf < b + 3600 ? 'the hour containing the item is not complete yet' : 'no completed-hour samples around the item (history gap)') : !baseline ? `only ${prior.length} prior adjacent-hour pairs; ${I.CONFIG.hourly_movement.min_pairs} needed for a baseline` : null;
  return { status, reason, event_t: ts, hour_bucket: b, prev: pt(prev), in_hour: pt(inHour), next: pt(next), day_after: pt(day), move_event_hour_pp: moveEvent, move_next_hour_pp: moveNext, level_change_24h_pp: level24, baseline,
    label_event_hour: labelOf(moveEvent, baseline), label_next_hour: labelOf(moveNext, baseline), caveats, definition_version: I.DEFINITION_VERSION, input_version: inp.version };
}
