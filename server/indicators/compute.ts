import * as I from '../../shared/indicators.ts';
import type { Coverage, IndicatorResult, IndPoint, IndStatus, Sample } from '../../shared/indicators.ts';
import { DEFS, MARKET_DEFAULTS, REGISTRY_VERSION, parseIds, type ParsedId } from './registry.ts';

/**
 * Indicator computation, with no store dependency.
 *
 * Everything here takes the data it needs — samples, basis, sampling precision, as-of — instead of
 * an id it looks up. That is what makes the rules testable with a literal array: the previous
 * arrangement put them in a module that opened the database at import, so a pure test had to set
 * TRACKER_DB before an import and stand up an HTTP server to reach them.
 *
 * The id → samples lookup lives in service.ts, at the edge where the store actually is.
 */

/** The fields of a sensor definition this module needs. Structural, so no ingestion module is pulled in. */
export interface SensorDefLike extends Record<string, any> { id: string; provider: string; intervalMin: number; unit: string }

export interface MarketInput {
  id: string; venue: string; question: string; basis: string; basisKey: string; fidelity: number | null; raw: Sample[]; version: string;
  spread: number | null; liquidity: number | null; price: number | null; quote_basis: string | null; observed_at: string; history_fetched_at: string | null;
}


export interface SensorInput { id: string; def: SensorDefLike; raw: Sample[]; version: string; fetched_at: string | null }


// ───────────────────────────── cache ─────────────────────────────

const CACHE_MAX = 800;
const cache = new Map<string, IndicatorResult>();
export const cacheStats = { hits: 0, misses: 0 };
export const clearCache = () => { cache.clear(); cacheStats.hits = 0; cacheStats.misses = 0; };

function cached(key: string, make: () => IndicatorResult): IndicatorResult {
  const hit = cache.get(key);
  if (hit !== undefined) {
    // Least-recently-used: a hit refreshes the entry's position, so a hot key is not evicted in
    // favour of a cold one that merely arrived later.
    cache.delete(key);
    cache.set(key, hit);
    cacheStats.hits++;
    return hit;
  }
  cacheStats.misses++;
  const r = make();
  cache.set(key, r);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return r;
}

// ───────────────────────────── result builders ─────────────────────────────

export const iso = (t: number | null | undefined) => (t == null ? null : new Date(t * 1000).toISOString());

function base(args: { id: string; kind: 'market' | 'sensor'; target: string; basis: string; unit: string; timeframe: string; params: Record<string, number | string>; asOf: number; version: string; coverage: Coverage }): IndicatorResult {
  return {
    id: args.id, definition_version: I.DEFINITION_VERSION, target: { kind: args.kind, id: args.target }, basis: args.basis, unit: args.unit, timeframe: args.timeframe, params: args.params,
    as_of: args.asOf, computed_at: Math.floor(Date.now() / 1000), input_version: args.version, sample_count: args.coverage.samples, coverage: args.coverage, status: 'warming_up', reason: null, latest: null, points: [],
  };
}

function pushPoints(pts: IndPoint[], since?: number): IndPoint[] { return since ? pts.filter((p) => p.t >= since) : pts; }

export function computeMarketOne(inp: MarketInput, pid: ParsedId, asOf: number, since?: number): IndicatorResult {
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

export function computeSensorOne(inp: SensorInput, pid: ParsedId, asOf: number, since?: number): IndicatorResult {
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


export interface ComputeOpts { asOf?: number; since?: number }

export interface IndicatorResponse {
  target: string; as_of: number; definition_version: string; indicators: IndicatorResult[]; rejected: string[];
}

/** The default indicator for a sensor series, from its id prefix. */
export function defaultSensorIds(seriesId: string): string[] {
  const p = seriesId.split(':')[0];
  return p === 'pw' ? ['baseline_28d'] : p === 'fred' ? ['published_change', 'sma7', 'sma20'] : ['observed_change'];
}

/** Computes the requested indicators for one market input. The caller supplies the samples. */
export function marketIndicatorsFromInput(inp: MarketInput, ids: string[], opts: ComputeOpts = {}): IndicatorResponse {
  const asOf = opts.asOf ?? Math.floor(Date.now() / 1000);
  const { ok, bad } = parseIds(ids.length ? ids : MARKET_DEFAULTS, 'market');
  const out = ok.map((pid) => {
    // The as-of is part of what was computed, so it is part of the key: previously the key held a
    // minute bucket, and a result computed for one as-of could be served for another.
    const key = ['m', inp.id, pid.raw, inp.version, I.DEFINITION_VERSION, asOf].join('|');
    const r = cached(key, () => computeMarketOne(inp, pid, asOf)); // the cache holds the FULL result; cropping happens below
    return opts.since ? { ...r, points: r.points.filter((p) => p.t >= opts.since!) } : r;
  });
  return { target: inp.id, as_of: asOf, definition_version: I.DEFINITION_VERSION, indicators: out, rejected: bad };
}

/** Computes the requested indicators for one sensor input. The caller supplies the samples. */
export function sensorIndicatorsFromInput(inp: SensorInput, ids: string[], opts: ComputeOpts = {}): IndicatorResponse {
  const asOf = opts.asOf ?? Math.floor(Date.now() / 1000);
  const { ok, bad } = parseIds(ids.length ? ids : defaultSensorIds(inp.id), 'sensor');
  const out = ok.map((pid) => {
    const key = ['s', inp.id, pid.raw, inp.version, I.DEFINITION_VERSION, asOf].join('|');
    const r = cached(key, () => computeSensorOne(inp, pid, asOf));
    return opts.since ? { ...r, points: r.points.filter((p) => p.t >= opts.since!) } : r;
  });
  return { target: inp.id, as_of: asOf, definition_version: I.DEFINITION_VERSION, indicators: out, rejected: bad };
}
