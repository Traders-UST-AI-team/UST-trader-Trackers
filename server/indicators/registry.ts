import * as I from '../../shared/indicators.ts';

/**
 * The indicator vocabulary: which indicators exist, and exactly which ids a caller may ask for.
 *
 * This module deliberately imports no store. It used to sit in service.ts, which opens the database
 * at import, so exercising `parseIds` — a pure string check — required setting TRACKER_DB before an
 * import. It is also where the registry and the validator have to agree: the registry used to
 * publish the family id `sma` while `parseIds` rejected it, so a client that read the registry and
 * used it got a 400.
 */

export const REGISTRY_VERSION = I.DEFINITION_VERSION;

export interface IndicatorDef {
  id: string; title: string; kind: 'market' | 'sensor'; family: 'change' | 'ma' | 'movement' | 'baseline' | 'published' | 'observed' | 'technical';
  unit: string; timeframe: string; overlay: boolean; description: string; params?: Record<string, { min: number; max: number; default: number }>;
  /**
   * A parameterised indicator is requested as `<requestPrefix><n>` — sma24, ema72, sma7 — not by
   * its bare id. Declaring the prefix here is what lets the registry and the validator agree.
   */
  requestPrefix?: string;
}

export const DEFS: IndicatorDef[] = [
  { id: 'change_1h', title: '1h change', kind: 'market', family: 'change', unit: 'pp', timeframe: '1h', overlay: false, description: '100 × (latest − reference) within one provider history series; reference = closest point at or before latest − 1h and within 15 min of that target. Null (never 0) when the latest point is >2 h old or no reference qualifies.' },
  { id: 'change_24h', title: '24h change', kind: 'market', family: 'change', unit: 'pp', timeframe: '24h', overlay: false, description: 'As 1h change with a 24h window and a 2 h reference tolerance.' },
  { id: 'sma', title: 'Simple moving average (hourly)', kind: 'market', family: 'ma', unit: '%', timeframe: 'N × 1h', overlay: true, params: { n: { min: 2, max: 200, default: 24 } }, requestPrefix: 'sma', description: 'Mean of N consecutive final-sample-per-completed-UTC-hour values; null until a full window; warm-up restarts after a gap > 90 min.' },
  { id: 'ema', title: 'Exponential moving average (hourly)', kind: 'market', family: 'ma', unit: '%', timeframe: 'N × 1h', overlay: true, params: { n: { min: 2, max: 200, default: 24 } }, requestPrefix: 'ema', description: 'alpha = 2/(N+1), seeded with the first complete N-point SMA, then recursive; restarts after a gap.' },
  { id: 'rsi14', title: 'RSI 14 (hourly, optional sub-plot)', kind: 'market', family: 'technical', unit: '0–100', timeframe: '14 × 1h', overlay: false, description: 'Wilder smoothing: first value from 14 differences (15 points), then avg = (prev×13 + current)/14. 50 when both averages are 0, 100 when only the loss is 0, 0 when only the gain is 0. 30/70 are descriptive reference lines. Describes the sampled series; not a signal.' },
  { id: 'macd', title: 'MACD 12/26/9 (hourly, optional sub-plot)', kind: 'market', family: 'technical', unit: 'pp', timeframe: '12/26/9 × 1h', overlay: false, description: 'EMA12 − EMA26 (SMA-seeded); signal = EMA9 of MACD seeded with the first nine MACD values; histogram = MACD − signal. Complete only after 34 consecutive hourly points. Output in percentage points.' },
  { id: 'bollinger', title: 'Bollinger 20, 2 (hourly, optional overlay)', kind: 'market', family: 'technical', unit: '%', timeframe: '20 × 1h', overlay: true, description: 'SMA20 ± 2 × population standard deviation (denominator 20). Raw bands may cross 0–100 % and are not clipped; excursions are counted. Not confidence intervals.' },
  { id: 'hourly_movement', title: 'Hourly movement vs history', kind: 'market', family: 'movement', unit: 'pp', timeframe: '1h', overlay: false, description: 'Latest adjacent-hour absolute change vs median and P95 (type-7 quantiles) of up to 168 PRIOR adjacent-hour pairs; ≥48 required. Describes historical unusualness only.' },
  { id: 'baseline_28d', title: 'Change vs trailing 28-day mean', kind: 'sensor', family: 'baseline', unit: 'series unit', timeframe: 'daily', overlay: false, description: 'Latest daily value vs the mean of the preceding 28 calendar days (current excluded; ≥24 valid days). Percentage unavailable when the baseline is 0.' },
  { id: 'published_change', title: 'Change vs previous published observation', kind: 'sensor', family: 'published', unit: 'series unit', timeframe: 'per observation', overlay: false, description: 'Absolute and percentage change vs the preceding actual observation; no weekend/holiday zeros.' },
  { id: 'sma_published', title: 'SMA over published observations', kind: 'sensor', family: 'published', unit: 'series unit', timeframe: 'N observations', overlay: true, params: { n: { min: 2, max: 60, default: 7 } }, requestPrefix: 'sma', description: 'Mean of N consecutive published observations; interruptions > 7 days reset warm-up.' },
  { id: 'observed_change', title: 'Latest value and observed change', kind: 'sensor', family: 'observed', unit: 'series unit', timeframe: 'as observed', overlay: false, description: 'Latest observation, change vs previous and vs ~24 h earlier. No anomaly baseline until ≥ 14 days of coverage with controls.' },
];

export const MARKET_DEFAULTS = ['change_1h', 'change_24h', 'sma24', 'ema24', 'hourly_movement'];

export interface ParsedId { raw: string; def: IndicatorDef; n?: number }

/**
 * Accepts a registry id, or a parameterised one written as `<requestPrefix><n>` (sma24, ema72,
 * sma7) within the declared bounds. Anything else is rejected.
 *
 * An exact id is matched before the parameterised form so that ids which merely contain digits —
 * rsi14 — are not mistaken for a family plus a bound.
 */
export function parseIds(list: string[], kind: 'market' | 'sensor'): { ok: ParsedId[]; bad: string[] } {
  const ok: ParsedId[] = [], bad: string[] = [];
  for (const raw of list) {
    const id = raw.trim();
    if (!id) continue;

    const exact = DEFS.find((d) => d.id === id && d.kind === kind && !d.params);
    if (exact) { ok.push({ raw: id, def: exact }); continue; }

    const m = /^([a-z_]+?)(\d{1,3})$/.exec(id);
    if (m) {
      const def = DEFS.find((d) => d.kind === kind && d.requestPrefix === m[1]);
      const n = Number(m[2]);
      if (def?.params?.n && n >= def.params.n.min && n <= def.params.n.max) { ok.push({ raw: id, def, n }); continue; }
    }
    bad.push(id);
  }
  return { ok, bad };
}

export interface RegistryEntry {
  id: string; title: string; kind: 'market' | 'sensor'; family: IndicatorDef['family'];
  unit: string; timeframe: string; overlay: boolean; description: string;
  /** The exact string to send in `?indicators=`. `{n}` stands in for the parameter. */
  requestable: string;
  /** Present when `requestable` carries a number. */
  param?: { name: string; min: number; max: number; default: number };
}

/**
 * The registry as a caller should read it: every entry states the id form `parseIds` accepts, so a
 * client can use the registry instead of hardcoding its own copy of the vocabulary.
 */
export function registryEntries(): RegistryEntry[] {
  return DEFS.map((d) => ({
    id: d.id, title: d.title, kind: d.kind, family: d.family, unit: d.unit, timeframe: d.timeframe, overlay: d.overlay, description: d.description,
    requestable: d.requestPrefix ? `${d.requestPrefix}{n}` : d.id,
    ...(d.requestPrefix && d.params?.n ? { param: { name: 'n', ...d.params.n } } : {}),
  }));
}
