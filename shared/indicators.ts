// Indicator math — pure functions, NO third-party dependencies, deterministic given (input, asOf).
// Definition version: bump DEFINITION_VERSION whenever a formula, tolerance or default below changes (cached results key on it).
//
// Conventions (docs/UNIFIED_MONITOR_PLAN.md §5):
//  - Probabilities enter as 0–1 and leave as percent (%) or percentage points (pp). Nothing is ever silently filled: a value that cannot
//    be computed is `null` with a status and a reason — never zero.
//  - Hourly indicators use the FINAL real sample of each COMPLETED UTC hour bucket (`sample_at` is kept). Empty buckets stay empty, and a
//    gap > 90 min between consecutive representative samples ends a continuity segment and restarts warm-up.
//  - Only data at or before `asOf` is used. Baselines exclude the observation being evaluated.
//  - Compute over the complete input; any UI range/cropping or chart downsampling happens AFTER, so it cannot change a value.

export const DEFINITION_VERSION = 'ind-1.1.0'; // 1.1.0: adds optional RSI / MACD / Bollinger (package G); existing formulas unchanged

export const CONFIG = {
  hour_s: 3600,
  /** Gap between consecutive representative samples that ends a continuity segment (90 min). */
  gap_break_s: 5400,
  /** Series whose median sample spacing exceeds this are not hourly (e.g. 6 h / 24 h fidelity) and get no hourly indicators. */
  hourly_max_median_spacing_s: 5400,
  /** A hourly indicator whose latest completed-bucket sample is older than this is 'stale'. */
  hourly_stale_s: 3 * 3600,
  change: {
    '1h': { window_s: 3600, latest_max_age_s: 7200, ref_tolerance_s: 900 },
    '24h': { window_s: 86400, latest_max_age_s: 7200, ref_tolerance_s: 7200 },
  },
  hourly_movement: { max_pairs: 168, min_pairs: 48 },
  daily_baseline: { window_days: 28, min_valid_days: 24, max_age_days: 14 },
  published: { reset_gap_days: 7, max_age_days: 14 },
  rsi: { period: 14 },
  macd: { fast: 12, slow: 26, signal: 9 },
  bollinger: { period: 20, k: 2 },
} as const;

export type IndStatus = 'ok' | 'warming_up' | 'stale' | 'gap' | 'unsupported';
export interface Sample { t: number; v: number }
export interface IndPoint { t: number; value: number | null; status: IndStatus }

export interface Coverage {
  first_t: number | null; last_t: number | null; samples: number; segments: number; gaps: number; spacing_median_s: number | null;
  dropped: { nonfinite: number; duplicate: number; out_of_range: number; after_as_of: number };
}

export interface IndicatorResult {
  id: string; definition_version: string; target: { kind: 'market' | 'sensor'; id: string };
  basis: string; unit: string; timeframe: string; params: Record<string, number | string>;
  as_of: number; computed_at: number; input_version: string; sample_count: number; coverage: Coverage;
  status: IndStatus; reason: string | null;
  latest: IndPoint | null; points: IndPoint[];
  /** Indicator-specific extras (e.g. the baseline behind an "unusual move" label, the two timestamps behind a change). */
  extra?: Record<string, unknown>;
}

// ───────────────────────────── statistics ─────────────────────────────

/** Type-7 (linear interpolation) quantile of an ASCENDING array; p in [0,1]. Returns null for an empty array. */
export function quantile7(sortedAsc: number[], p: number): number | null {
  const n = sortedAsc.length;
  if (n === 0) return null;
  if (n === 1) return sortedAsc[0];
  const h = (n - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h), hi = Math.ceil(h);
  return sortedAsc[lo] + (h - lo) * (sortedAsc[hi] - sortedAsc[lo]);
}
export const median7 = (a: number[]): number | null => quantile7([...a].sort((x, y) => x - y), 0.5);
export const mean = (a: number[]): number | null => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// ───────────────────────────── normalisation ─────────────────────────────

export interface NormalizeOpts { min?: number; max?: number; asOf?: number }

/** Sort ascending, drop non-finite, drop out-of-range, deduplicate by timestamp (the LAST value for a timestamp wins), drop points after asOf. */
export function normalize(raw: Sample[], opts: NormalizeOpts = {}): { samples: Sample[]; dropped: Coverage['dropped']; spacing_median_s: number | null } {
  const dropped = { nonfinite: 0, duplicate: 0, out_of_range: 0, after_as_of: 0 };
  const byT = new Map<number, number>();
  for (const s of raw) {
    if (!Number.isFinite(s.t) || !Number.isFinite(s.v)) { dropped.nonfinite++; continue; }
    if ((opts.min !== undefined && s.v < opts.min) || (opts.max !== undefined && s.v > opts.max)) { dropped.out_of_range++; continue; }
    if (opts.asOf !== undefined && s.t > opts.asOf) { dropped.after_as_of++; continue; }
    if (byT.has(s.t)) dropped.duplicate++;
    byT.set(s.t, s.v);
  }
  const samples = [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }));
  const gaps: number[] = [];
  for (let i = 1; i < samples.length; i++) gaps.push(samples[i].t - samples[i - 1].t);
  return { samples, dropped, spacing_median_s: median7(gaps) };
}

export interface Rep extends Sample { bucket: number }

/** Final real sample of each COMPLETED UTC hour (bucket end ≤ asOf). `t` is the sample's own time (sample_at). Empty hours produce nothing. */
export function hourlyRepresentatives(samples: Sample[], asOf: number): Rep[] {
  const last = new Map<number, Sample>();
  for (const s of samples) {
    if (s.t > asOf) continue;
    const b = Math.floor(s.t / CONFIG.hour_s) * CONFIG.hour_s;
    if (b + CONFIG.hour_s > asOf) continue; // incomplete bucket
    const cur = last.get(b);
    if (!cur || s.t >= cur.t) last.set(b, s);
  }
  return [...last.entries()].sort((a, b) => a[0] - b[0]).map(([bucket, s]) => ({ t: s.t, v: s.v, bucket }));
}

/** Split representatives into continuity segments wherever consecutive samples are more than 90 min apart. */
export function segmentsOf(reps: Rep[]): Rep[][] {
  const out: Rep[][] = [];
  let cur: Rep[] = [];
  for (const r of reps) {
    if (cur.length && r.t - cur[cur.length - 1].t > CONFIG.gap_break_s) { out.push(cur); cur = []; }
    cur.push(r);
  }
  if (cur.length) out.push(cur);
  return out;
}

export function coverageOf(samples: Sample[], reps: Rep[], dropped: Coverage['dropped'], spacing: number | null): Coverage {
  const segs = segmentsOf(reps);
  return { first_t: samples[0]?.t ?? null, last_t: samples[samples.length - 1]?.t ?? null, samples: samples.length, segments: segs.length, gaps: Math.max(0, segs.length - 1), spacing_median_s: spacing, dropped };
}

// ───────────────────────────── moving averages (hourly) ─────────────────────────────

/** SMA over N consecutive samples inside a continuity segment. Values before a complete window (and after a break) are null/warming_up. Output in the input's unit. */
export function smaSeries(reps: Rep[], n: number): IndPoint[] {
  const out: IndPoint[] = [];
  for (const seg of segmentsOf(reps)) {
    let sum = 0;
    seg.forEach((r, i) => {
      sum += r.v;
      if (i >= n) sum -= seg[i - n].v;
      out.push(i >= n - 1 ? { t: r.t, value: sum / n, status: 'ok' } : { t: r.t, value: null, status: 'warming_up' });
    });
  }
  return out;
}

/** EMA: alpha = 2/(N+1); seeded with the first complete N-point SMA, then recursive. Restarts after a continuity break. */
export function emaSeries(reps: Rep[], n: number): IndPoint[] {
  const alpha = 2 / (n + 1);
  const out: IndPoint[] = [];
  for (const seg of segmentsOf(reps)) {
    let ema: number | null = null;
    seg.forEach((r, i) => {
      if (i < n - 1) { out.push({ t: r.t, value: null, status: 'warming_up' }); return; }
      ema = i === n - 1 ? seg.slice(0, n).reduce((s, x) => s + x.v, 0) / n : alpha * r.v + (1 - alpha) * (ema as number);
      out.push({ t: r.t, value: ema, status: 'ok' });
    });
  }
  return out;
}

// ───────────────────────────── optional technical sub-plots (package G, off by default) ─────────────────────────────
// These describe the SAMPLED series only. A high RSI on a prediction probability is not evidence that the probability is wrong.

const pt = (t: number, value: number | null, status: IndStatus = value === null ? 'warming_up' : 'ok'): IndPoint => ({ t, value, status });

/** RSI with Wilder smoothing. Needs n+1 consecutive points (n differences) for the first value, then avg = (prev*(n-1) + current)/n.
 * Both averages 0 → 50; average loss 0 → 100; average gain 0 → 0. Output 0–100 (scale-free, so probabilities enter as 0–1). Restarts after a gap. */
export function rsiSeries(reps: Rep[], n: number = CONFIG.rsi.period): IndPoint[] {
  const out: IndPoint[] = [];
  for (const seg of segmentsOf(reps)) {
    let ag = 0, al = 0;
    seg.forEach((r, i) => {
      if (i === 0) { out.push(pt(r.t, null)); return; }
      const d = r.v - seg[i - 1].v, g = Math.max(d, 0), l = Math.max(-d, 0);
      if (i < n) { ag += g; al += l; out.push(pt(r.t, null)); return; }
      if (i === n) { ag = (ag + g) / n; al = (al + l) / n; } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; }
      out.push(pt(r.t, ag === 0 && al === 0 ? 50 : al === 0 ? 100 : ag === 0 ? 0 : 100 - 100 / (1 + ag / al)));
    });
  }
  return out;
}

/** EMA values at every index of a plain number array (SMA seed at index n-1, null before). */
function emaValues(v: number[], n: number): (number | null)[] {
  const a = 2 / (n + 1);
  const out: (number | null)[] = [];
  let e = 0;
  v.forEach((x, i) => {
    if (i < n - 1) { out.push(null); return; }
    e = i === n - 1 ? v.slice(0, n).reduce((s, y) => s + y, 0) / n : a * x + (1 - a) * e;
    out.push(e);
  });
  return out;
}

export interface MacdSeries { macd: IndPoint[]; signal: IndPoint[]; histogram: IndPoint[] }

/** MACD(fast, slow, signal): EMAs seeded with SMAs; MACD = EMA_fast − EMA_slow; the signal line is seeded with the SMA of the first `signal` valid
 * MACD values; histogram = MACD − signal. Complete output needs slow + signal − 1 = 34 consecutive points. Output in pp (probability × 100). */
export function macdSeries(reps: Rep[], fast: number = CONFIG.macd.fast, slow: number = CONFIG.macd.slow, sig: number = CONFIG.macd.signal): MacdSeries {
  const res: MacdSeries = { macd: [], signal: [], histogram: [] };
  for (const seg of segmentsOf(reps)) {
    const v = seg.map((r) => r.v);
    const ef = emaValues(v, fast), es = emaValues(v, slow);
    const m = v.map((_, i) => (ef[i] !== null && es[i] !== null ? (ef[i] as number) - (es[i] as number) : null));
    const first = m.findIndex((x) => x !== null);
    const valid = first < 0 ? [] : (m.slice(first) as number[]);
    const sg = emaValues(valid, sig);
    seg.forEach((r, i) => {
      const mv = m[i] === null ? null : 100 * (m[i] as number);
      const j = first < 0 ? -1 : i - first;
      const sv = j >= 0 && sg[j] !== null ? 100 * (sg[j] as number) : null;
      res.macd.push(pt(r.t, mv)); res.signal.push(pt(r.t, sv)); res.histogram.push(pt(r.t, mv !== null && sv !== null ? mv - sv : null));
    });
  }
  return res;
}

export interface BollingerSeries { middle: IndPoint[]; upper: IndPoint[]; lower: IndPoint[]; excursions: number }

/** Bollinger(n, k): SMA ± k × POPULATION standard deviation (denominator n). Raw bands may leave 0–100 % and are NOT clipped; `excursions` counts
 * points where a band lies outside that range. They are not confidence intervals. Output in % (probability × 100). */
export function bollingerSeries(reps: Rep[], n: number = CONFIG.bollinger.period, k: number = CONFIG.bollinger.k): BollingerSeries {
  const res: BollingerSeries = { middle: [], upper: [], lower: [], excursions: 0 };
  for (const seg of segmentsOf(reps)) {
    seg.forEach((r, i) => {
      if (i < n - 1) { res.middle.push(pt(r.t, null)); res.upper.push(pt(r.t, null)); res.lower.push(pt(r.t, null)); return; }
      const w = seg.slice(i - n + 1, i + 1).map((x) => x.v);
      const mu = w.reduce((s, x) => s + x, 0) / n;
      const sd = Math.sqrt(w.reduce((s, x) => s + (x - mu) ** 2, 0) / n);
      const up = 100 * (mu + k * sd), lo = 100 * (mu - k * sd);
      if (up > 100 || lo < 0) res.excursions++;
      res.middle.push(pt(r.t, 100 * mu)); res.upper.push(pt(r.t, up)); res.lower.push(pt(r.t, lo));
    });
  }
  return res;
}

// ───────────────────────────── probability changes (raw history points) ─────────────────────────────

export interface ChangeResult {
  window: '1h' | '24h'; value_pp: number | null; status: IndStatus; reason: string | null;
  latest: Sample | null; reference: Sample | null; target_t: number | null; actual_interval_s: number | null; tolerance_s: number; latest_age_s: number | null;
}

/**
 * 100 × (p_latest − p_reference) within ONE provider series. latest = last point at or before asOf; reference = the closest point at or
 * before (latest.t − window). Returns null (never 0) when the latest point is too old or no reference lies within the tolerance.
 */
export function probabilityChange(samples: Sample[], window: '1h' | '24h', asOf: number): ChangeResult {
  const cfg = CONFIG.change[window];
  const usable = samples.filter((s) => s.t <= asOf);
  const base: ChangeResult = { window, value_pp: null, status: 'warming_up', reason: null, latest: null, reference: null, target_t: null, actual_interval_s: null, tolerance_s: cfg.ref_tolerance_s, latest_age_s: null };
  if (!usable.length) return { ...base, reason: 'no history point at or before asOf' };
  const latest = usable[usable.length - 1];
  const age = asOf - latest.t;
  if (age > cfg.latest_max_age_s) return { ...base, latest, latest_age_s: age, status: 'stale', reason: `latest history point is ${(age / 3600).toFixed(1)} h old (limit ${cfg.latest_max_age_s / 3600} h)` };
  const target = latest.t - cfg.window_s;
  let ref: Sample | null = null;
  for (let i = usable.length - 1; i >= 0; i--) if (usable[i].t <= target) { ref = usable[i]; break; }
  if (!ref) return { ...base, latest, latest_age_s: age, target_t: target, status: 'warming_up', reason: `history does not reach back ${window}` };
  if (target - ref.t > cfg.ref_tolerance_s) {
    return { ...base, latest, latest_age_s: age, target_t: target, reference: ref, status: 'gap', reason: `nearest earlier point is ${((target - ref.t) / 60).toFixed(0)} min before the ${window} target (tolerance ${cfg.ref_tolerance_s / 60} min)` };
  }
  return { ...base, status: 'ok', value_pp: 100 * (latest.v - ref.v), latest, reference: ref, target_t: target, actual_interval_s: latest.t - ref.t, latest_age_s: age, reason: null };
}

// ───────────────────────────── hourly-movement baseline ─────────────────────────────

export interface MovementResult {
  status: IndStatus; reason: string | null;
  current: { t: number; abs_pp: number; from_t: number } | null;
  baseline: { n: number; median_pp: number; p95_pp: number; window_pairs: number } | null;
  exceeds_p95: boolean | null;
}

/** Absolute hour-to-hour changes (pp) between ADJACENT completed hour buckets inside a segment. The latest pair is evaluated against up to
 * 168 PRIOR pairs (never including itself); needs ≥ 48 prior pairs. */
export function hourlyMovement(reps: Rep[], asOf: number): MovementResult {
  const pairs: { t: number; from_t: number; abs_pp: number }[] = [];
  for (const seg of segmentsOf(reps)) {
    for (let i = 1; i < seg.length; i++) {
      if (seg[i].bucket - seg[i - 1].bucket !== CONFIG.hour_s) continue; // adjacent hours only
      pairs.push({ t: seg[i].t, from_t: seg[i - 1].t, abs_pp: Math.abs(100 * (seg[i].v - seg[i - 1].v)) });
    }
  }
  if (!pairs.length) return { status: 'warming_up', reason: 'no adjacent-hour pairs', current: null, baseline: null, exceeds_p95: null };
  const cur = pairs[pairs.length - 1];
  const age = asOf - cur.t;
  const prior = pairs.slice(0, -1).slice(-CONFIG.hourly_movement.max_pairs);
  const current = { t: cur.t, abs_pp: cur.abs_pp, from_t: cur.from_t };
  if (age > CONFIG.hourly_stale_s) return { status: 'stale', reason: `latest hourly pair is ${(age / 3600).toFixed(1)} h old`, current, baseline: null, exceeds_p95: null };
  if (prior.length < CONFIG.hourly_movement.min_pairs) {
    return { status: 'warming_up', reason: `${prior.length} prior adjacent-hour pairs; ${CONFIG.hourly_movement.min_pairs} required`, current, baseline: null, exceeds_p95: null };
  }
  const sorted = prior.map((p) => p.abs_pp).sort((a, b) => a - b);
  const p95 = quantile7(sorted, 0.95)!;
  return { status: 'ok', reason: null, current, baseline: { n: sorted.length, median_pp: quantile7(sorted, 0.5)!, p95_pp: p95, window_pairs: CONFIG.hourly_movement.max_pairs }, exceeds_p95: cur.abs_pp > p95 };
}

// ───────────────────────────── daily / published-observation series (sensors) ─────────────────────────────

export interface DailyBaseline {
  status: IndStatus; reason: string | null; latest: Sample | null; baseline_mean: number | null; valid_days: number;
  abs_change: number | null; pct_change: number | null; observation_age_days: number | null;
}

const DAY = 86400;
const dayIndex = (t: number) => Math.floor(t / DAY);

/** Latest daily value vs the mean of the PRECEDING 28 calendar days (needs ≥ 24 days with an observation; the latest day is excluded).
 * Percentage change is null when the baseline is 0. Staleness is judged against provider publication delay (max_age_days), never against minutes. */
export function dailyBaselineChange(samples: Sample[], asOf: number): DailyBaseline {
  const cfg = CONFIG.daily_baseline;
  const usable = samples.filter((s) => s.t <= asOf);
  const empty: DailyBaseline = { status: 'warming_up', reason: null, latest: null, baseline_mean: null, valid_days: 0, abs_change: null, pct_change: null, observation_age_days: null };
  if (!usable.length) return { ...empty, reason: 'no observations' };
  const latest = usable[usable.length - 1];
  const ageDays = (asOf - latest.t) / DAY;
  const dLatest = dayIndex(latest.t);
  const byDay = new Map<number, number>();
  for (const s of usable) { const d = dayIndex(s.t); if (d < dLatest && d >= dLatest - cfg.window_days) byDay.set(d, s.v); }
  const base: DailyBaseline = { ...empty, latest, valid_days: byDay.size, observation_age_days: ageDays };
  if (ageDays > cfg.max_age_days) return { ...base, status: 'stale', reason: `latest observation is ${ageDays.toFixed(1)} days old (limit ${cfg.max_age_days} d)` };
  if (byDay.size < cfg.min_valid_days) return { ...base, status: 'warming_up', reason: `${byDay.size} of the preceding ${cfg.window_days} days have an observation; ${cfg.min_valid_days} required` };
  const m = mean([...byDay.values()])!;
  return { ...base, status: 'ok', baseline_mean: m, abs_change: latest.v - m, pct_change: m === 0 ? null : (100 * (latest.v - m)) / m, reason: m === 0 ? 'baseline is zero: percentage change unavailable' : null };
}

export interface PublishedChange {
  status: IndStatus; reason: string | null; latest: Sample | null; previous: Sample | null; abs_change: number | null; pct_change: number | null; days_between: number | null; observation_age_days: number | null;
}

/** Change vs the preceding ACTUAL published observation (no weekend/holiday zeros). Percentage unavailable when the previous value is 0. */
export function publishedChange(samples: Sample[], asOf: number): PublishedChange {
  const usable = samples.filter((s) => s.t <= asOf);
  const e: PublishedChange = { status: 'warming_up', reason: null, latest: null, previous: null, abs_change: null, pct_change: null, days_between: null, observation_age_days: null };
  if (usable.length < 2) return { ...e, latest: usable[usable.length - 1] ?? null, reason: 'fewer than two published observations' };
  const latest = usable[usable.length - 1], previous = usable[usable.length - 2];
  const age = (asOf - latest.t) / DAY;
  const out: PublishedChange = { status: 'ok', reason: null, latest, previous, abs_change: latest.v - previous.v, pct_change: previous.v === 0 ? null : (100 * (latest.v - previous.v)) / previous.v, days_between: (latest.t - previous.t) / DAY, observation_age_days: age };
  if (age > CONFIG.published.max_age_days) return { ...out, status: 'stale', reason: `latest observation is ${age.toFixed(1)} days old` };
  if (previous.v === 0) return { ...out, reason: 'previous value is zero: percentage change unavailable' };
  return out;
}

/** SMA over N consecutive PUBLISHED observations. A calendar gap above 7 days between consecutive observations resets warm-up. */
export function smaPublished(samples: Sample[], n: number): IndPoint[] {
  const out: IndPoint[] = [];
  let seg: Sample[] = [];
  for (const s of samples) {
    if (seg.length && (s.t - seg[seg.length - 1].t) / DAY > CONFIG.published.reset_gap_days) seg = [];
    seg.push(s);
    out.push(seg.length >= n ? { t: s.t, value: seg.slice(-n).reduce((a, x) => a + x.v, 0) / n, status: 'ok' } : { t: s.t, value: null, status: 'warming_up' });
  }
  return out;
}

export interface ObservedChange {
  status: IndStatus; reason: string | null; latest: Sample | null; previous: Sample | null; change_vs_previous: number | null;
  change_24h: { value: number; reference: Sample } | null; coverage_days: number; baseline: 'unsupported'; baseline_reason: string; age_s: number | null;
}

/** For self-collected / short series (OpenSky, IODA): latest value and OBSERVED changes only. Anomaly baselines need ≥ 14 days of coverage plus
 * time-of-day and receiver-coverage controls this module does not provide — so none is produced. */
export function observedChange(samples: Sample[], asOf: number, maxAgeS: number): ObservedChange {
  const usable = samples.filter((s) => s.t <= asOf);
  const latest = usable[usable.length - 1] ?? null;
  const previous = usable[usable.length - 2] ?? null;
  const coverage = usable.length ? (usable[usable.length - 1].t - usable[0].t) / DAY : 0;
  const base = { baseline: 'unsupported' as const, baseline_reason: `needs ≥ 14 days of coverage with time-of-day and receiver-coverage controls (have ${coverage.toFixed(1)} d)` };
  if (!latest) return { status: 'warming_up', reason: 'no observations', latest: null, previous: null, change_vs_previous: null, change_24h: null, coverage_days: 0, age_s: null, ...base };
  const age = asOf - latest.t;
  let ref: Sample | null = null;
  for (let i = usable.length - 1; i >= 0; i--) if (usable[i].t <= latest.t - DAY) { ref = usable[i]; break; }
  const refOk = ref && latest.t - DAY - ref.t <= 2 * 3600 ? ref : null;
  return {
    status: age > maxAgeS ? 'stale' : 'ok', reason: age > maxAgeS ? `latest observation is ${(age / 3600).toFixed(1)} h old` : null, latest, previous,
    change_vs_previous: previous ? latest.v - previous.v : null, change_24h: refOk ? { value: latest.v - refOk.v, reference: refOk } : null, coverage_days: coverage, age_s: age, ...base,
  };
}

// ───────────────────────────── hashing (input_version) ─────────────────────────────

/** Small, dependency-free FNV-1a 64-bit-ish digest over strings; used to fingerprint the COMPLETE input (not just MAX(t)). */
export function fingerprint(parts: (string | number)[]): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    h2 ^= h2 >>> 13;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export function fingerprintSamples(samples: Sample[], extra: (string | number)[] = []): string {
  const parts: (string | number)[] = [...extra, samples.length];
  for (const s of samples) parts.push(s.t, s.v);
  return fingerprint(parts);
}
