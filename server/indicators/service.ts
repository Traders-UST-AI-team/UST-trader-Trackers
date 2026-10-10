// Indicator service: reads STORED data only (never triggers ingestion), computes with shared/indicators.ts, caches results.
// Registered indicators with bounded parameters only — no arbitrary expressions, scripts or Pine.
import { db, kvGet, kvSet } from '../db.ts';
import * as I from '../../shared/indicators.ts';
import type { Coverage, IndicatorResult, IndPoint, IndStatus, Sample } from '../../shared/indicators.ts';
import { SENSORS } from '../sources/sensors.ts';
import type { Prefs, ReactionResult, WatchCard, WatchItem } from '../../shared/types.ts';
export type { Prefs, WatchCard, WatchItem } from '../../shared/types.ts';

export const REGISTRY_VERSION = I.DEFINITION_VERSION;

// ───────────────────────────── registry ─────────────────────────────

export interface IndicatorDef {
  id: string; title: string; kind: 'market' | 'sensor'; family: 'change' | 'ma' | 'movement' | 'baseline' | 'published' | 'observed' | 'technical';
  unit: string; timeframe: string; overlay: boolean; description: string; params?: Record<string, { min: number; max: number; default: number }>;
}

export const DEFS: IndicatorDef[] = [
  { id: 'change_1h', title: '1h change', kind: 'market', family: 'change', unit: 'pp', timeframe: '1h', overlay: false, description: '100 × (latest − reference) within one provider history series; reference = closest point at or before latest − 1h and within 15 min of that target. Null (never 0) when the latest point is >2 h old or no reference qualifies.' },
  { id: 'change_24h', title: '24h change', kind: 'market', family: 'change', unit: 'pp', timeframe: '24h', overlay: false, description: 'As 1h change with a 24h window and a 2 h reference tolerance.' },
  { id: 'sma', title: 'Simple moving average (hourly)', kind: 'market', family: 'ma', unit: '%', timeframe: 'N × 1h', overlay: true, params: { n: { min: 2, max: 200, default: 24 } }, description: 'Mean of N consecutive final-sample-per-completed-UTC-hour values; null until a full window; warm-up restarts after a gap > 90 min.' },
  { id: 'ema', title: 'Exponential moving average (hourly)', kind: 'market', family: 'ma', unit: '%', timeframe: 'N × 1h', overlay: true, params: { n: { min: 2, max: 200, default: 24 } }, description: 'alpha = 2/(N+1), seeded with the first complete N-point SMA, then recursive; restarts after a gap.' },
  { id: 'rsi14', title: 'RSI 14 (hourly, optional sub-plot)', kind: 'market', family: 'technical', unit: '0–100', timeframe: '14 × 1h', overlay: false, description: 'Wilder smoothing: first value from 14 differences (15 points), then avg = (prev×13 + current)/14. 50 when both averages are 0, 100 when only the loss is 0, 0 when only the gain is 0. 30/70 are descriptive reference lines. Describes the sampled series; not a signal.' },
  { id: 'macd', title: 'MACD 12/26/9 (hourly, optional sub-plot)', kind: 'market', family: 'technical', unit: 'pp', timeframe: '12/26/9 × 1h', overlay: false, description: 'EMA12 − EMA26 (SMA-seeded); signal = EMA9 of MACD seeded with the first nine MACD values; histogram = MACD − signal. Complete only after 34 consecutive hourly points. Output in percentage points.' },
  { id: 'bollinger', title: 'Bollinger 20, 2 (hourly, optional overlay)', kind: 'market', family: 'technical', unit: '%', timeframe: '20 × 1h', overlay: true, description: 'SMA20 ± 2 × population standard deviation (denominator 20). Raw bands may cross 0–100 % and are not clipped; excursions are counted. Not confidence intervals.' },
  { id: 'hourly_movement', title: 'Hourly movement vs history', kind: 'market', family: 'movement', unit: 'pp', timeframe: '1h', overlay: false, description: 'Latest adjacent-hour absolute change vs median and P95 (type-7 quantiles) of up to 168 PRIOR adjacent-hour pairs; ≥48 required. Describes historical unusualness only.' },
  { id: 'baseline_28d', title: 'Change vs trailing 28-day mean', kind: 'sensor', family: 'baseline', unit: 'series unit', timeframe: 'daily', overlay: false, description: 'Latest daily value vs the mean of the preceding 28 calendar days (current excluded; ≥24 valid days). Percentage unavailable when the baseline is 0.' },
  { id: 'published_change', title: 'Change vs previous published observation', kind: 'sensor', family: 'published', unit: 'series unit', timeframe: 'per observation', overlay: false, description: 'Absolute and percentage change vs the preceding actual observation; no weekend/holiday zeros.' },
  { id: 'sma_published', title: 'SMA over published observations', kind: 'sensor', family: 'published', unit: 'series unit', timeframe: 'N observations', overlay: true, params: { n: { min: 2, max: 60, default: 7 } }, description: 'Mean of N consecutive published observations; interruptions > 7 days reset warm-up.' },
  { id: 'observed_change', title: 'Latest value and observed change', kind: 'sensor', family: 'observed', unit: 'series unit', timeframe: 'as observed', overlay: false, description: 'Latest observation, change vs previous and vs ~24 h earlier. No anomaly baseline until ≥ 14 days of coverage with controls.' },
];

export const MARKET_DEFAULTS = ['change_1h', 'change_24h', 'sma24', 'ema24', 'hourly_movement'];

export interface ParsedId { raw: string; def: IndicatorDef; n?: number }

/** Accepts registry ids plus sma/ema/sma_published with a bounded N written as sma24, ema72, sma7 … Anything else is rejected. */
export function parseIds(list: string[], kind: 'market' | 'sensor'): { ok: ParsedId[]; bad: string[] } {
  const ok: ParsedId[] = [], bad: string[] = [];
  for (const raw of list) {
    const id = raw.trim();
    if (!id) continue;
    const m = /^(sma|ema)(\d{1,3})$/.exec(id);
    if (m) {
      const def = kind === 'market' ? DEFS.find((d) => d.id === m[1]) : m[1] === 'sma' ? DEFS.find((d) => d.id === 'sma_published') : undefined;
      const n = Number(m[2]);
      if (def?.params && n >= def.params.n.min && n <= def.params.n.max) { ok.push({ raw: id, def, n }); continue; }
      bad.push(id); continue;
    }
    const def = DEFS.find((d) => d.id === id && d.kind === kind && !d.params);
    if (def) ok.push({ raw: id, def }); else bad.push(id);
  }
  return { ok, bad };
}

// ───────────────────────────── cache ─────────────────────────────

const CACHE_MAX = 800;
const cache = new Map<string, IndicatorResult>();
export const cacheStats = { hits: 0, misses: 0 };
export const clearCache = () => { cache.clear(); cacheStats.hits = 0; cacheStats.misses = 0; };

function cached(key: string, make: () => IndicatorResult): IndicatorResult {
  const hit = cache.get(key);
  if (hit) { cacheStats.hits++; return hit; }
  cacheStats.misses++;
  const r = make();
  cache.set(key, r);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return r;
}

// ───────────────────────────── inputs ─────────────────────────────

interface MarketInput {
  id: string; venue: string; question: string; basis: string; basisKey: string; fidelity: number | null; raw: Sample[]; version: string;
  spread: number | null; liquidity: number | null; price: number | null; quote_basis: string | null; observed_at: string; history_fetched_at: string | null;
}

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

interface SensorInput { id: string; def: (typeof SENSORS)[number]; raw: Sample[]; version: string; fetched_at: string | null }

export function loadSensorInput(seriesId: string): SensorInput | null {
  const def = SENSORS.find((s) => s.id === seriesId);
  if (!def) return null;
  const raw = (db.prepare('SELECT t, v FROM series_points WHERE series_id = ? ORDER BY t').all(seriesId) as unknown as { t: number; v: number }[]).map((r) => ({ t: r.t, v: r.v }));
  const meta = db.prepare('SELECT fetched_at FROM series_meta WHERE series_id = ?').get(seriesId) as { fetched_at: string } | undefined;
  return { id: seriesId, def, raw, version: I.fingerprintSamples(raw, [seriesId, def.provider]), fetched_at: meta?.fetched_at ?? null };
}

// ───────────────────────────── result builders ─────────────────────────────

const iso = (t: number | null | undefined) => (t == null ? null : new Date(t * 1000).toISOString());

function base(args: { id: string; kind: 'market' | 'sensor'; target: string; basis: string; unit: string; timeframe: string; params: Record<string, number | string>; asOf: number; version: string; coverage: Coverage }): IndicatorResult {
  return {
    id: args.id, definition_version: I.DEFINITION_VERSION, target: { kind: args.kind, id: args.target }, basis: args.basis, unit: args.unit, timeframe: args.timeframe, params: args.params,
    as_of: args.asOf, computed_at: Math.floor(Date.now() / 1000), input_version: args.version, sample_count: args.coverage.samples, coverage: args.coverage, status: 'warming_up', reason: null, latest: null, points: [],
  };
}

function pushPoints(pts: IndPoint[], since?: number): IndPoint[] { return since ? pts.filter((p) => p.t >= since) : pts; }

function computeMarketOne(inp: MarketInput, pid: ParsedId, asOf: number, since?: number): IndicatorResult {
  const nz = I.normalize(inp.raw, { min: 0, max: 1, asOf });
  const reps = I.hourlyRepresentatives(nz.samples, asOf);
  const coverage = I.coverageOf(nz.samples, reps, nz.dropped, nz.spacing_median_s);
  const id = pid.def.family === 'ma' ? `${pid.def.id}${pid.n}` : pid.def.id;
  const r = base({ id, kind: 'market', target: inp.id, basis: inp.basis, unit: pid.def.unit, timeframe: pid.def.family === 'ma' ? `${pid.n} x 1h` : pid.def.timeframe, params: pid.n ? { n: pid.n } : {}, asOf, version: inp.version, coverage });

  const hourlyOk = nz.spacing_median_s !== null && nz.spacing_median_s <= I.CONFIG.hourly_max_median_spacing_s;

  if (pid.def.family === 'change') {
    const w = pid.def.id === 'change_1h' ? '1h' : '24h';
    // Hourly series: measure between COMPLETED-HOUR samples. A provider's trailing "price at fetch time" point sits off the hourly grid and would
    // put the reference outside tolerance for every contract at once; the live quote is shown separately (extra.quote). Coarser series use raw points.
    const basisSamples = hourlyOk ? reps.map((x) => ({ t: x.t, v: x.v })) : nz.samples;
    const c = I.probabilityChange(basisSamples, w, asOf);
    r.status = c.status; r.reason = c.reason;
    r.latest = c.latest ? { t: c.latest.t, value: c.value_pp, status: c.status } : null;
    r.points = c.reference && c.latest ? [{ t: c.reference.t, value: 100 * c.reference.v, status: 'ok' }, { t: c.latest.t, value: 100 * c.latest.v, status: 'ok' }] : [];
    r.extra = {
      window: w, formula: '100 * (p_latest - p_reference)', measured_on: hourlyOk ? 'completed-hour samples (final real sample of each completed UTC hour)' : 'raw provider points (series is not hourly)', latest: c.latest && { t: c.latest.t, at: iso(c.latest.t), p_pct: 100 * c.latest.v }, reference: c.reference && { t: c.reference.t, at: iso(c.reference.t), p_pct: 100 * c.reference.v },
      target_t: c.target_t, actual_interval_s: c.actual_interval_s, tolerance_s: c.tolerance_s, latest_age_s: c.latest_age_s,
      quote: { price_pct: inp.price === null ? null : 100 * inp.price, basis: inp.quote_basis, observed_at: inp.observed_at, note: 'order-book quote basis can differ from provider history' },
    };
    return r;
  }

  if (!hourlyOk) { r.status = 'unsupported'; r.reason = `history is not hourly (median spacing ${nz.spacing_median_s === null ? 'unknown' : (nz.spacing_median_s / 3600).toFixed(1) + ' h'}; fidelity ${inp.fidelity ?? '?'} min)`; return r; }

  if (pid.def.family === 'technical') {
    const last = reps[reps.length - 1];
    if (!last) { r.reason = 'no completed hourly samples'; return r; }
    const need = pid.def.id === 'rsi14' ? I.CONFIG.rsi.period + 1 : pid.def.id === 'macd' ? I.CONFIG.macd.slow + I.CONFIG.macd.signal - 1 : I.CONFIG.bollinger.period;
    let main: IndPoint[]; const extra: Record<string, unknown> = { required_consecutive_points: need, rule: 'final real sample of each completed UTC hour; gaps > 90 min restart warm-up; description only, not a trading signal' };
    if (pid.def.id === 'rsi14') { main = I.rsiSeries(reps); extra.reference_lines = [30, 70]; }
    else if (pid.def.id === 'macd') { const m = I.macdSeries(reps); main = m.macd; extra.signal = pushPoints(m.signal, since); extra.histogram = pushPoints(m.histogram, since); }
    else { const b = I.bollingerSeries(reps); main = b.middle; extra.upper = pushPoints(b.upper, since); extra.lower = pushPoints(b.lower, since); extra.excursions_outside_0_100 = b.excursions; }
    const tail = main[main.length - 1];
    const complete = pid.def.id === 'macd' ? (extra.signal as IndPoint[]).at(-1)?.value !== null && (extra.signal as IndPoint[]).at(-1)?.value !== undefined : tail.value !== null;
    const age = asOf - last.t;
    if (age > I.CONFIG.hourly_stale_s) { r.status = 'stale'; r.reason = `latest completed-hour sample is ${(age / 3600).toFixed(1)} h old`; r.latest = { t: last.t, value: null, status: 'stale' }; }
    else if (!complete) {
      const segs = I.segmentsOf(reps); const seg = segs[segs.length - 1];
      r.status = segs.length > 1 ? 'gap' : 'warming_up'; r.reason = `${seg.length} of ${need} consecutive hourly points available${segs.length > 1 ? ' since the last gap' : ''}`;
      r.latest = { t: tail.t, value: null, status: r.status };
    } else { r.status = 'ok'; r.latest = tail; }
    r.points = pushPoints(main, since); r.extra = extra;
    return r;
  }

  if (pid.def.family === 'ma') {
    const raw = pid.def.id === 'sma' ? I.smaSeries(reps, pid.n!) : I.emaSeries(reps, pid.n!);
    const pts: IndPoint[] = raw.map((p) => ({ t: p.t, value: p.value === null ? null : 100 * p.value, status: p.status }));
    const last = reps[reps.length - 1];
    if (!last) { r.reason = 'no completed hourly samples'; return r; }
    const age = asOf - last.t;
    const tailLatest = pts[pts.length - 1];
    if (age > I.CONFIG.hourly_stale_s) { r.status = 'stale'; r.reason = `latest completed-hour sample is ${(age / 3600).toFixed(1)} h old`; r.latest = { t: last.t, value: null, status: 'stale' }; }
    else if (tailLatest.value === null) {
      const segs = I.segmentsOf(reps); const tail = segs[segs.length - 1];
      r.status = segs.length > 1 ? 'gap' : 'warming_up';
      r.reason = `${tail.length} of ${pid.n} consecutive hourly samples available${segs.length > 1 ? ` since the last gap (before ${iso(tail[0].t)})` : ''}`;
      r.latest = { t: tailLatest.t, value: null, status: r.status };
    } else { r.status = 'ok'; r.latest = tailLatest; }
    r.points = pushPoints(pts, since);
    r.extra = { samples_in_last_segment: I.segmentsOf(reps).at(-1)?.length ?? 0, rule: 'final real sample of each completed UTC hour; gaps > 90 min restart warm-up' };
    return r;
  }

  if (pid.def.family === 'movement') {
    const mv = I.hourlyMovement(reps, asOf);
    r.status = mv.status; r.reason = mv.reason;
    r.latest = mv.current ? { t: mv.current.t, value: mv.status === 'ok' ? mv.current.abs_pp : null, status: mv.status } : null;
    const wide = inp.spread !== null && inp.spread > 0.10;
    r.extra = {
      current: mv.current, baseline: mv.baseline, exceeds_p95: mv.exceeds_p95,
      label: mv.status !== 'ok' ? 'unavailable' : mv.exceeds_p95 ? (wide ? 'above_p95_wide_spread' : 'above_p95') : 'within_history',
      caution: wide ? `order-book spread is ${(100 * (inp.spread as number)).toFixed(1)} pp: a move may reflect a wide spread` : null,
      context: { spread_pp: inp.spread === null ? null : 100 * inp.spread, liquidity: inp.liquidity }, note: 'Describes how unusual this hour-to-hour move is versus this contract\'s own history. It is not a cause, a forecast or a trading signal.',
    };
    return r;
  }
  r.status = 'unsupported'; r.reason = 'indicator not applicable to markets';
  return r;
}

const SENSOR_AGE_S = (def: SensorInput['def']) => def.intervalMin * 60 * 3;

function computeSensorOne(inp: SensorInput, pid: ParsedId, asOf: number, since?: number): IndicatorResult {
  const nz = I.normalize(inp.raw, { asOf });
  const coverage: Coverage = { first_t: nz.samples[0]?.t ?? null, last_t: nz.samples.at(-1)?.t ?? null, samples: nz.samples.length, segments: 1, gaps: 0, spacing_median_s: nz.spacing_median_s, dropped: nz.dropped };
  const id = pid.n ? `${pid.def.id === 'sma_published' ? 'sma' : pid.def.id}${pid.n}` : pid.def.id;
  const r = base({ id, kind: 'sensor', target: inp.id, basis: `${inp.def.provider}`, unit: inp.def.unit, timeframe: pid.def.timeframe, params: pid.n ? { n: pid.n } : {}, asOf, version: inp.version, coverage });
  const prefix = inp.id.split(':')[0];
  const applies = (pid.def.family === 'baseline' && prefix === 'pw') || (pid.def.family === 'published' && prefix === 'fred') || (pid.def.family === 'observed' && (prefix === 'opensky' || prefix === 'ioda'));
  if (!applies) { r.status = 'unsupported'; r.reason = `${pid.def.title} does not apply to ${inp.def.provider} (${prefix}) series`; return r; }
  const extraBase = { observed_at: iso(nz.samples.at(-1)?.t), fetched_at: inp.fetched_at, provider: inp.def.provider, note: inp.def.group === 'chokepoint' || prefix === 'fred' ? 'Daily/published series: observation time is the data\'s own date, not collection time; never live.' : 'Observation time vs collection time shown separately.' };

  if (pid.def.family === 'baseline') {
    const b = I.dailyBaselineChange(nz.samples, asOf);
    r.status = b.status; r.reason = b.reason; r.latest = b.latest ? { t: b.latest.t, value: b.abs_change, status: b.status } : null;
    r.extra = { ...extraBase, latest_value: b.latest?.v ?? null, baseline_mean: b.baseline_mean, valid_days: b.valid_days, abs_change: b.abs_change, pct_change: b.pct_change, observation_age_days: b.observation_age_days, window: `preceding ${I.CONFIG.daily_baseline.window_days} calendar days, current excluded` };
    r.points = b.latest ? [{ t: b.latest.t, value: b.latest.v, status: 'ok' }] : [];
    return r;
  }
  if (pid.def.family === 'published' && pid.def.id === 'published_change') {
    const c = I.publishedChange(nz.samples, asOf);
    r.status = c.status; r.reason = c.reason; r.latest = c.latest ? { t: c.latest.t, value: c.abs_change, status: c.status } : null;
    r.extra = { ...extraBase, latest_value: c.latest?.v ?? null, previous: c.previous, abs_change: c.abs_change, pct_change: c.pct_change, days_between: c.days_between, observation_age_days: c.observation_age_days };
    r.points = [c.previous, c.latest].filter(Boolean).map((s) => ({ t: s!.t, value: s!.v, status: 'ok' as IndStatus }));
    return r;
  }
  if (pid.def.id === 'sma_published') {
    const pts = I.smaPublished(nz.samples, pid.n!);
    const last = nz.samples.at(-1);
    const age = last ? (asOf - last.t) / 86400 : null;
    const tail = pts.at(-1);
    if (!last) { r.reason = 'no observations'; return r; }
    if (age! > I.CONFIG.published.max_age_days) { r.status = 'stale'; r.reason = `latest observation is ${age!.toFixed(1)} days old`; r.latest = { t: last.t, value: null, status: 'stale' }; }
    else if (tail!.value === null) { r.status = 'warming_up'; r.reason = `fewer than ${pid.n} consecutive observations since the last interruption`; r.latest = { t: tail!.t, value: null, status: 'warming_up' }; }
    else { r.status = 'ok'; r.latest = tail!; }
    r.points = pushPoints(pts, since); r.extra = { ...extraBase, rule: 'consecutive published observations; interruption > 7 days resets warm-up' };
    return r;
  }
  if (pid.def.family === 'observed') {
    const o = I.observedChange(nz.samples, asOf, SENSOR_AGE_S(inp.def));
    r.status = o.status; r.reason = o.reason; r.latest = o.latest ? { t: o.latest.t, value: o.latest.v, status: o.status } : null;
    r.extra = { ...extraBase, change_vs_previous: o.change_vs_previous, change_24h: o.change_24h, coverage_days: o.coverage_days, baseline: o.baseline, baseline_reason: o.baseline_reason, age_s: o.age_s };
    r.points = pushPoints(nz.samples.map((s) => ({ t: s.t, value: s.v, status: 'ok' as IndStatus })), since);
    return r;
  }
  r.status = 'unsupported'; r.reason = 'indicator not implemented'; return r;
}

// ───────────────────────────── public API ─────────────────────────────

export interface ComputeOpts { asOf?: number; since?: number }

export function marketIndicators(conditionId: string, ids: string[], opts: ComputeOpts = {}): { target: string; as_of: number; definition_version: string; indicators: IndicatorResult[]; rejected: string[] } | null {
  const inp = loadMarketInput(conditionId);
  if (!inp) return null;
  const asOf = opts.asOf ?? Math.floor(Date.now() / 1000);
  const { ok, bad } = parseIds(ids.length ? ids : MARKET_DEFAULTS, 'market');
  const out = ok.map((pid) => {
    const key = ['m', conditionId, pid.raw, inp.version, I.DEFINITION_VERSION, Math.floor(asOf / 60)].join('|');
    const r = cached(key, () => computeMarketOne(inp, pid, asOf)); // cache holds the FULL result; cropping happens below
    return opts.since ? { ...r, points: r.points.filter((p) => p.t >= opts.since!) } : r;
  });
  return { target: conditionId, as_of: asOf, definition_version: I.DEFINITION_VERSION, indicators: out, rejected: bad };
}

export function defaultSensorIds(seriesId: string): string[] {
  const p = seriesId.split(':')[0];
  return p === 'pw' ? ['baseline_28d'] : p === 'fred' ? ['published_change', 'sma7', 'sma20'] : ['observed_change'];
}

export function sensorIndicators(seriesId: string, ids: string[], opts: ComputeOpts = {}): { target: string; as_of: number; definition_version: string; indicators: IndicatorResult[]; rejected: string[] } | null {
  const inp = loadSensorInput(seriesId);
  if (!inp) return null;
  const asOf = opts.asOf ?? Math.floor(Date.now() / 1000);
  const { ok, bad } = parseIds(ids.length ? ids : defaultSensorIds(seriesId), 'sensor');
  const out = ok.map((pid) => {
    const key = ['s', seriesId, pid.raw, inp.version, I.DEFINITION_VERSION, Math.floor(asOf / 60)].join('|');
    const r = cached(key, () => computeSensorOne(inp, pid, asOf));
    return opts.since ? { ...r, points: r.points.filter((p) => p.t >= opts.since!) } : r;
  });
  return { target: seriesId, as_of: asOf, definition_version: I.DEFINITION_VERSION, indicators: out, rejected: bad };
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
    const official = new Set(['un-news-me', 'un-press', 'ofsi', 'ofac', 'fcdo', 'easa-czib', 'reliefweb-me']);
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
