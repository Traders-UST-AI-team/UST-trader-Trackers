// Fixtures for shared/indicators.ts. Every expected number below was worked out by hand from the formula in the plan, not by running the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG, DEFINITION_VERSION, dailyBaselineChange, emaSeries, fingerprint, fingerprintSamples, hourlyMovement, hourlyRepresentatives, normalize,
  bollingerSeries, macdSeries, observedChange, probabilityChange, rsiSeries, publishedChange, quantile7, segmentsOf, smaPublished, smaSeries, type Rep, type Sample,
} from '../shared/indicators.ts';

const H = 3600, D = 86400;
const close = (a: number | null | undefined, b: number, eps = 1e-9) => { assert.ok(a !== null && a !== undefined && Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`); };
const reps = (vals: number[], start = 0, step = H): Rep[] => vals.map((v, i) => ({ t: start + i * step, v, bucket: Math.floor((start + i * step) / H) * H }));
const vals = (pts: { value: number | null }[]) => pts.map((p) => p.value);

test('type-7 quantiles: hand-computed values, edge cases', () => {
  assert.equal(quantile7([1, 2, 3, 4], 0.5), 2.5);                                  // h = 1.5
  close(quantile7([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 9.55);                    // h = 8.55 → 9 + 0.55·(10−9)
  assert.equal(quantile7([5], 0.95), 5);
  assert.equal(quantile7([], 0.5), null);
  assert.equal(quantile7([3, 9], 0), 3); assert.equal(quantile7([3, 9], 1), 9);
  close(quantile7([0, 10], 0.25), 2.5);
});

test('normalize: sorts, de-duplicates (last wins), drops non-finite/out-of-range/future points, reports each', () => {
  const r = normalize([{ t: 3, v: 0.3 }, { t: 1, v: 0.1 }, { t: 1, v: 0.15 }, { t: 2, v: NaN }, { t: 4, v: 1.2 }, { t: 9, v: 0.5 }], { min: 0, max: 1, asOf: 3 });
  assert.deepEqual(r.samples, [{ t: 1, v: 0.15 }, { t: 3, v: 0.3 }]);
  assert.deepEqual(r.dropped, { nonfinite: 1, duplicate: 1, out_of_range: 1, after_as_of: 1 });
  assert.equal(r.spacing_median_s, 2);
  assert.deepEqual(normalize([]).samples, []);
});

test('hourly representatives: final real sample of each COMPLETED hour; incomplete hour and empty hours produce nothing', () => {
  const raw: Sample[] = [{ t: 100, v: 0.1 }, { t: 3500, v: 0.2 }, { t: 3700, v: 0.3 }, { t: 7300, v: 0.4 }, { t: 7400, v: 0.5 }];
  const a = hourlyRepresentatives(raw, 10800);
  assert.deepEqual(a.map((r) => [r.t, r.v, r.bucket]), [[3500, 0.2, 0], [3700, 0.3, 3600], [7400, 0.5, 7200]]);
  const b = hourlyRepresentatives(raw, 10799); // third hour not complete yet
  assert.deepEqual(b.map((r) => r.t), [3500, 3700]);
  const c = hourlyRepresentatives([{ t: 100, v: 0.1 }, { t: 9000, v: 0.9 }], 20000); // hour 1 and hour 3 empty
  assert.deepEqual(c.map((r) => r.bucket), [0, 7200]);
});

test('continuity: a gap over 90 minutes ends a segment', () => {
  const r = [...reps([1, 2, 3], 0), ...reps([4, 5], 3 * H + 5401)];
  assert.equal(segmentsOf(r).length, 2);
  assert.equal(segmentsOf(reps([1, 2, 3], 0, 5400)).length, 1); // exactly 90 min is still continuous
});

test('SMA: null until a full N-point window; exact means; restarts warm-up after a gap', () => {
  assert.deepEqual(vals(smaSeries(reps([0.1, 0.2, 0.3, 0.4, 0.5]), 3)).map((v) => (v === null ? null : Math.round(v * 1e9) / 1e9)), [null, null, 0.2, 0.3, 0.4]);
  const gapped = [...reps([1, 2, 3, 4]), ...reps([10, 20, 30], 4 * H + 6 * H)]; // 6 h gap
  const s = smaSeries(gapped, 3);
  assert.deepEqual(vals(s), [null, null, 2, 3, null, null, 20]);                 // second segment warms up again
  assert.deepEqual(s.map((p) => p.status), ['warming_up', 'warming_up', 'ok', 'ok', 'warming_up', 'warming_up', 'ok']);
  assert.deepEqual(vals(smaSeries(reps([7, 7, 7, 7]), 3)), [null, null, 7, 7]);   // constant → constant
  assert.deepEqual(vals(smaSeries(reps([1, 2]), 24)), [null, null]);              // too short
});

test('EMA: alpha = 2/(N+1), seeded with the first N-point SMA', () => {
  // N=3 → alpha 0.5. values 2,4,6,8,10: seed = mean(2,4,6)=4; then 0.5·8+0.5·4=6; then 0.5·10+0.5·6=8
  assert.deepEqual(vals(emaSeries(reps([2, 4, 6, 8, 10]), 3)), [null, null, 4, 6, 8]);
  // N=24 → alpha 0.08: constant series stays constant; rising ramp lags the last value
  const ramp = emaSeries(reps(Array.from({ length: 30 }, (_, i) => i)), 24);
  close(ramp[23].value, 11.5);                                                      // seed = mean(0..23)
  close(ramp[24].value, 0.08 * 24 + 0.92 * 11.5);                                   // = 12.5
  assert.deepEqual(vals(emaSeries(reps(Array(10).fill(0.3)), 5)).slice(4), Array(6).fill(0.3));
  // restart after a gap
  assert.equal(emaSeries([...reps([1, 2, 3]), ...reps([5, 6, 7], 20 * H)], 3)[3].value, null);
});

test('probability change: 100×(p_latest − p_reference), actual timestamps and interval, null — never zero — when unusable', () => {
  const s: Sample[] = [{ t: 0, v: 0.4 }, { t: 3600, v: 0.45 }, { t: 7200, v: 0.5 }];
  const ok = probabilityChange(s, '1h', 7200 + 600);
  assert.equal(ok.status, 'ok'); close(ok.value_pp, 5, 1e-9); assert.equal(ok.actual_interval_s, 3600);
  assert.deepEqual([ok.latest?.t, ok.reference?.t, ok.target_t], [7200, 3600, 3600]);
  const w24 = probabilityChange(s, '24h', 7800);
  assert.equal(w24.value_pp, null); assert.equal(w24.status, 'warming_up');         // history does not reach back 24 h
  // closest prior point at or before the target; interval reflects the REAL reference, not the nominal window
  const near = probabilityChange([{ t: 0, v: 0.4 }, { t: 3500, v: 0.45 }, { t: 7200, v: 0.5 }], '1h', 7500);
  assert.equal(near.status, 'ok'); close(near.value_pp, 5, 1e-9);
  assert.equal(near.target_t, 3600); assert.equal(near.reference!.t, 3500); assert.equal(near.actual_interval_s, 3700); // real interval, not the nominal 3600
  // a reference a full hour before the target is NOT acceptable (tolerance 15 min): gap, value null
  const sparse = probabilityChange([{ t: 0, v: 0.4 }, { t: 7200, v: 0.5 }], '1h', 7500);
  assert.equal(sparse.status, 'gap'); assert.equal(sparse.value_pp, null); assert.match(sparse.reason!, /60 min before/);
  // reference further than 15 min before the target → gap
  const gap = probabilityChange([{ t: 0, v: 0.4 }, { t: 5000, v: 0.5 }], '1h', 5100);
  assert.equal(gap.value_pp, null); assert.equal(gap.status, 'gap'); assert.match(gap.reason!, /nearest earlier point is 23 min/);
  // latest older than 2 h → stale
  const stale = probabilityChange(s, '1h', 7200 + 7201);
  assert.equal(stale.value_pp, null); assert.equal(stale.status, 'stale');
  // 24 h tolerance is 2 h: reference 90 min early is fine, 150 min early is a gap
  const day = (refOffset: number): Sample[] => [{ t: 100000 - 86400 - refOffset, v: 0.2 }, { t: 100000, v: 0.3 }];
  assert.equal(probabilityChange(day(5400), '24h', 100100).status, 'ok');
  assert.equal(probabilityChange(day(9000), '24h', 100100).status, 'gap');
  // a point after asOf must not change the result
  const withFuture = probabilityChange([...s, { t: 9999, v: 0.99 }], '1h', 7800);
  assert.equal(withFuture.value_pp, ok.value_pp);
  assert.equal(probabilityChange([], '1h', 10).value_pp, null);
});

test('hourly movement baseline: prior pairs only, window of 168, ≥48 required, P95 per type-7', () => {
  const walk = (changesPp: number[]): Rep[] => { // alternating sign keeps the walk near 0.5
    const out: number[] = [0.5];
    changesPp.forEach((c, i) => out.push(out[i] + (i % 2 === 0 ? c : -c) / 100));
    return reps(out);
  };
  // 59 prior pairs of 1 pp, then a 10 pp move → median 1, P95 1, current 10 exceeds
  const a = hourlyMovement(walk([...Array(59).fill(1), 10]), 61 * H + 100);
  assert.equal(a.status, 'ok'); close(a.current!.abs_pp, 10, 1e-9); assert.equal(a.baseline!.n, 59); close(a.baseline!.median_pp, 1, 1e-9); close(a.baseline!.p95_pp, 1, 1e-9); assert.equal(a.exceeds_p95, true);
  // window limit: 100 pairs of 5 pp, then 100 of 1 pp, current = last 1 pp pair → prior window = last 168 prior pairs = 69×5pp + 99×1pp
  const b = hourlyMovement(walk([...Array(100).fill(5), ...Array(100).fill(1)]), 201 * H + 100);
  assert.equal(b.baseline!.n, 168); close(b.baseline!.median_pp, 1, 1e-9);           // indices 0..98 are 1pp → h=83.5 → 1
  close(b.baseline!.p95_pp, 5, 1e-9);                                                // h=158.65 → both neighbours are 5pp
  assert.equal(b.exceeds_p95, false);
  // fewer than 48 prior pairs → warming_up, no baseline
  const c = hourlyMovement(walk(Array(48).fill(1)), 50 * H);                         // 48 pairs total = 47 prior
  assert.equal(c.status, 'warming_up'); assert.equal(c.baseline, null); assert.match(c.reason!, /47 prior/);
  // an empty hour breaks adjacency: that pair is not counted
  const d = hourlyMovement([...reps([0.5, 0.6]), ...reps([0.7], 3 * H)], 5 * H);
  assert.equal(d.current!.abs_pp > 0, true); assert.equal(d.baseline, null);         // the 1h→3h pair is not adjacent
  // stale latest
  assert.equal(hourlyMovement(walk(Array(60).fill(1)), 200 * H).status, 'stale');
});

test('daily baseline (PortWatch-style): preceding 28 calendar days, ≥24 valid, current excluded, zero denominator → null %', () => {
  const day = (d: number, v: number): Sample => ({ t: d * D, v });
  const flat = Array.from({ length: 30 }, (_, d) => day(d, 10));                    // days 0..29
  const ok = dailyBaselineChange([...flat, day(30, 13)], 31 * D);
  assert.equal(ok.status, 'ok'); assert.equal(ok.valid_days, 28); close(ok.baseline_mean, 10); close(ok.abs_change, 3); close(ok.pct_change, 30);
  // the current observation must not leak into the baseline: a huge latest value leaves the mean at 10
  close(dailyBaselineChange([...flat, day(30, 1000)], 31 * D).baseline_mean, 10);
  // exactly 24 valid days is enough, 23 is not
  const keep = (n: number) => Array.from({ length: n }, (_, i) => day(29 - i, 10));
  assert.equal(dailyBaselineChange([...keep(24), day(30, 12)], 31 * D).status, 'ok');
  const short = dailyBaselineChange([...keep(23), day(30, 12)], 31 * D);
  assert.equal(short.status, 'warming_up'); assert.equal(short.pct_change, null); assert.match(short.reason!, /23 of the preceding 28/);
  // zero baseline → absolute change available, percentage unavailable (not Infinity)
  const zeros = dailyBaselineChange([...Array.from({ length: 28 }, (_, d) => day(d, 0)), day(28, 5)], 29 * D);
  assert.equal(zeros.abs_change, 5); assert.equal(zeros.pct_change, null); assert.match(zeros.reason!, /baseline is zero/);
  // provider delay: 5 days old is NOT stale for a daily series; 20 days is
  assert.equal(dailyBaselineChange([...flat, day(30, 13)], 35 * D).status, 'ok');
  assert.equal(dailyBaselineChange([...flat, day(30, 13)], 51 * D).status, 'stale');
  // observations after asOf are ignored
  assert.equal(dailyBaselineChange([...flat, day(30, 13), day(40, 99)], 31 * D).latest!.v, 13);
});

test('published-observation series (FRED-style): change vs the previous real observation; SMA over observations; no weekend zeros', () => {
  const fri = 4 * D, mon = 7 * D;                                                  // 3-day weekend gap between observations
  const c = publishedChange([{ t: fri, v: 100 }, { t: mon, v: 110 }], mon + D);
  assert.equal(c.abs_change, 10); close(c.pct_change, 10); assert.equal(c.days_between, 3); assert.equal(c.status, 'ok');
  assert.equal(publishedChange([{ t: 0, v: 0 }, { t: D, v: 5 }], 2 * D).pct_change, null);   // zero previous
  assert.equal(publishedChange([{ t: 0, v: 1 }], D).status, 'warming_up');
  assert.equal(publishedChange([{ t: 0, v: 1 }, { t: D, v: 2 }], 30 * D).status, 'stale');
  const sma = smaPublished([1, 2, 3, 4].map((v, i) => ({ t: i * D, v })), 3);
  assert.deepEqual(vals(sma), [null, null, 2, 3]);
  // interruption longer than 7 days resets warm-up
  const reset = smaPublished([{ t: 0, v: 1 }, { t: D, v: 2 }, { t: 2 * D, v: 3 }, { t: 12 * D, v: 4 }, { t: 13 * D, v: 5 }], 2);
  assert.deepEqual(vals(reset), [null, 1.5, 2.5, null, 4.5]);
});

test('observed change (OpenSky/IODA): latest + observed deltas only; anomaly baseline explicitly unsupported', () => {
  const s: Sample[] = [{ t: 0, v: 50 }, { t: 3600, v: 60 }, { t: D, v: 80 }, { t: D + 3600, v: 70 }];
  const o = observedChange(s, D + 3700, 7200);
  assert.equal(o.latest!.v, 70); assert.equal(o.change_vs_previous, -10);
  assert.equal(o.change_24h!.value, 10);                                            // vs the observation 24 h earlier (t=3600 → 60)
  assert.equal(o.baseline, 'unsupported'); assert.match(o.baseline_reason, /14 days/);
  assert.equal(observedChange(s, D + 3600 + 8000, 7200).status, 'stale');
  assert.equal(observedChange([], 10, 10).latest, null);
  assert.equal(observedChange([{ t: 0, v: 5 }, { t: D + 3 * H, v: 6 }], D + 4 * H, 99999).change_24h, null); // no point within 2 h of the 24 h-earlier time
});

test('fingerprint: identical input → identical digest; any revised value, order, basis or extra changes it', () => {
  const a: Sample[] = [{ t: 1, v: 0.1 }, { t: 2, v: 0.2 }, { t: 3, v: 0.3 }];
  assert.equal(fingerprintSamples(a, ['polymarket', 'clob', 60]), fingerprintSamples([...a], ['polymarket', 'clob', 60]));
  assert.notEqual(fingerprintSamples(a, ['x']), fingerprintSamples([{ t: 1, v: 0.1 }, { t: 2, v: 0.21 }, { t: 3, v: 0.3 }], ['x']), 'a revised OLD value must change the version');
  assert.notEqual(fingerprintSamples(a, ['polymarket', 'clob', 60]), fingerprintSamples(a, ['polymarket', 'clob', 360]), 'sampling precision is part of the version');
  assert.notEqual(fingerprintSamples(a, ['kalshi']), fingerprintSamples(a, ['polymarket']), 'basis/venue is part of the version');
  assert.notEqual(fingerprint(['a', 'bc']), fingerprint(['ab', 'c']));
});

test('determinism and range independence: same input → identical output; cropping the input afterwards cannot change earlier values', () => {
  const vals1 = Array.from({ length: 80 }, (_, i) => 0.3 + 0.2 * Math.sin(i / 5));
  const r = reps(vals1);
  assert.deepEqual(smaSeries(r, 24), smaSeries(r, 24));
  assert.deepEqual(emaSeries(r, 24), emaSeries(r, 24));
  // A UI that crops to the last 30 points must still show the full-history EMA values for those timestamps.
  const full = emaSeries(r, 24), cropped = full.filter((p) => p.t >= r[50].t);
  const recomputedOnCrop = emaSeries(r.slice(50), 24).filter((p) => p.value !== null);
  assert.notDeepEqual(recomputedOnCrop.map((p) => p.value), cropped.map((p) => p.value), 'recomputing on cropped data WOULD change values — so the service must compute on the full input');
  assert.equal(DEFINITION_VERSION, 'ind-1.1.0');
  assert.equal(CONFIG.hourly_movement.min_pairs, 48);
});

// Package G (optional sub-plots). Expected numbers come from a separate plain-Python implementation (explicit seeds, no shared code) and, for RSI,
// from the widely published 20-close worked example (published table 70.53/66.32/66.55/69.41/66.36/57.97 — its closes are shown rounded to 2 dp,
// hence the ≈0.07 difference to the values below, which use the rounded closes).
const WILDER = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
const P40 = [0.50, 0.51, 0.49, 0.52, 0.55, 0.54, 0.56, 0.58, 0.57, 0.60, 0.62, 0.61, 0.59, 0.60, 0.63, 0.65, 0.64, 0.66, 0.68, 0.67, 0.69, 0.70, 0.68, 0.66, 0.67, 0.65, 0.63, 0.64, 0.62, 0.60, 0.61, 0.59, 0.58, 0.60, 0.57, 0.55, 0.56, 0.54, 0.52, 0.53];

test('RSI14: Wilder smoothing matches an independent computation; needs 15 points; flat/one-sided edge cases are defined', () => {
  const r = rsiSeries(reps(WILDER.map((x) => x / 100)));
  assert.deepEqual(vals(r.slice(0, 14)), Array(14).fill(null), 'first value only after 14 differences (15 points)');
  [70.4641, 66.2496, 66.4809, 69.3469, 66.2947, 57.915].forEach((e, i) => close(r[14 + i].value, e, 5e-5));
  assert.equal(rsiSeries(reps(Array(20).fill(0.4)))[19].value, 50, 'no movement → 50');
  assert.equal(rsiSeries(reps(Array.from({ length: 20 }, (_, i) => 0.3 + i * 0.01)))[19].value, 100, 'only gains → 100');
  assert.equal(rsiSeries(reps(Array.from({ length: 20 }, (_, i) => 0.7 - i * 0.01)))[19].value, 0, 'only losses → 0');
  const gap = rsiSeries([...reps(WILDER.slice(0, 16).map((x) => x / 100)), ...reps(WILDER.slice(0, 5).map((x) => x / 100), 30 * H)]);
  assert.deepEqual(vals(gap.slice(16)), Array(5).fill(null), 'a gap > 90 min restarts warm-up');
});

test('MACD 12/26/9: SMA-seeded EMAs, signal seeded with nine MACD values, complete only from 34 points; output in pp', () => {
  const m = macdSeries(reps(P40));
  assert.equal(m.macd.findIndex((p) => p.value !== null), 25, 'MACD from point 26');
  assert.equal(m.signal.findIndex((p) => p.value !== null), 33, 'signal (and histogram) complete from point 34');
  close(m.macd[25].value, 4.545592467966064); close(m.macd[39].value, -1.4984968422248612);
  close(m.signal[33].value, 2.638569676389847); close(m.signal[39].value, 0.09064072464937828);
  close(m.histogram[39].value, -1.5891375668742396);
  assert.equal(macdSeries(reps(P40.slice(0, 33))).signal.every((p) => p.value === null), true, '33 points are not enough for a signal line');
});

test('Bollinger 20,2: population standard deviation (denominator 20); raw bands are not clipped and excursions are counted', () => {
  const b = bollingerSeries(reps(P40));
  assert.equal(b.middle.findIndex((p) => p.value !== null), 19);
  close(b.middle[19].value, 58.85); close(b.upper[19].value, 70.11543385760176); close(b.lower[19].value, 47.584566142398245);
  close(b.middle[39].value, 60.949999999999996); close(b.upper[39].value, 71.6359721130087); close(b.lower[39].value, 50.26402788699128);
  assert.equal(b.excursions, 0);
  const wild = bollingerSeries(reps([...Array(19).fill(0.02), 0.99]));
  assert.ok((wild.lower[19].value as number) < 0, 'the theoretical lower band is below 0 % and is kept as computed (mean 6.85 %, sd 21.1 pp)');
  assert.equal(wild.excursions, 1);
});

// ── the indicator vocabulary: what the registry publishes must be what the validator accepts ────

test('indicator registry: every published id form is one the validator actually accepts', async () => {
  const { registryEntries, parseIds, DEFS } = await import('./indicators/registry.ts');

  const entries = registryEntries();
  assert.equal(entries.length, DEFS.length);

  for (const entry of entries) {
    // A parameterised entry must publish the *requestable* form, not the bare family id.
    if (entry.param) {
      assert.match(entry.requestable, /\{n\}$/);
      assert.equal(parseIds([entry.id], entry.kind).bad.includes(entry.id), true, `${entry.id} is published bare but the validator rejects it`);
      const concrete = entry.requestable.replace('{n}', String(entry.param.default));
      assert.deepEqual(parseIds([concrete], entry.kind).bad, [], `registry publishes ${entry.requestable} but ${concrete} is rejected`);
    } else {
      assert.equal(entry.requestable, entry.id);
      assert.deepEqual(parseIds([entry.id], entry.kind).bad, [], `registry publishes ${entry.id} but the validator rejects it`);
    }
  }

  // The specific case that was broken: the registry advertised `sma`, parseIds always rejected it.
  const sma = entries.find((e) => e.id === 'sma')!;
  assert.equal(sma.requestable, 'sma{n}');
  assert.deepEqual(parseIds(['sma24'], 'market').ok.map((p) => p.n), [24]);
  assert.deepEqual(parseIds(['sma'], 'market').bad, ['sma']);
});

test('indicator ids: bounds are enforced, and ids that merely contain digits are not mistaken for a family', async () => {
  const { parseIds } = await import('./indicators/registry.ts');

  const okOf = (s: string, k: 'market' | 'sensor' = 'market') => parseIds([s], k);

  // rsi14 is a real id, not "family rsi plus 14": matching the parameterised form first would reject it.
  assert.deepEqual(okOf('rsi14').bad, []);
  assert.equal(okOf('rsi14').ok[0].def.id, 'rsi14');
  assert.deepEqual(okOf('change_24h').bad, []);
  assert.deepEqual(okOf('macd').bad, []);

  // Declared bounds, inclusive.
  assert.deepEqual(okOf('sma2').ok.map((p) => p.n), [2]);
  assert.deepEqual(okOf('sma200').ok.map((p) => p.n), [200]);
  assert.deepEqual(okOf('sma1').bad, ['sma1']);
  assert.deepEqual(okOf('sma201').bad, ['sma201']);
  assert.deepEqual(okOf('ema9999').bad, ['ema9999']);

  // The same request string means different indicators per kind: sma7 is a market SMA or a
  // published-observation SMA, never both.
  assert.equal(okOf('sma7', 'market').ok[0].def.id, 'sma');
  assert.equal(okOf('sma7', 'sensor').ok[0].def.id, 'sma_published');
  assert.deepEqual(okOf('sma70', 'sensor').bad, ['sma70'], 'the sensor bound tops out at 60');
  assert.deepEqual(okOf('sma_published', 'sensor').bad, ['sma_published'], 'the bare family id is not requestable');

  // Unknown, empty and whitespace entries are handled without throwing.
  assert.deepEqual(parseIds(['nope', '', '  '], 'market').bad, ['nope']);
});

test('indicator computation: reachable with plain inputs — no store, no environment, no server', async () => {
  // This file sets no TRACKER_DB and starts no HTTP server. If the computation still pulled in the
  // store, importing it here would open the real database as a side effect.
  const { computeMarketOne, computeSensorOne } = await import('./indicators/compute.ts');
  const { parseIds } = await import('./indicators/registry.ts');

  const H = 3600, T0 = 1_700_000_000;
  const market = {
    id: 'synthetic', venue: 'polymarket', question: 'Synthetic contract', basis: 'polymarket:test', basisKey: 'test',
    fidelity: 60, raw: Array.from({ length: 30 }, (_, i) => ({ t: T0 + i * H, v: 0.5 })), version: 'v1',
    spread: null, liquidity: null, price: 0.5, quote_basis: null, observed_at: new Date(T0 * 1000).toISOString(), history_fetched_at: null,
  };
  const sma = parseIds(['sma10'], 'market').ok[0];
  const out = computeMarketOne(market, sma, T0 + 29 * H);
  assert.equal(out.status, 'ok');
  assert.equal(out.latest?.value, 50);
  assert.equal(out.unit, '%');
  assert.equal(out.input_version, 'v1');

  // A sensor series, likewise from a literal array.
  const sensor = {
    id: 'pw:hormuz:total', def: { id: 'pw:hormuz:total', provider: 'IMF PortWatch', intervalMin: 1440, unit: 'transits' },
    raw: Array.from({ length: 40 }, (_, i) => ({ t: (T0 + i * 86400), v: 100 + i })), version: 'v2', fetched_at: null,
  };
  const base = parseIds(['baseline_28d'], 'sensor').ok[0];
  const sensorOut = computeSensorOne(sensor, base, T0 + 39 * 86400);
  assert.equal(sensorOut.status, 'ok');
  assert.ok((sensorOut.latest?.value ?? 0) > 0, 'a rising series is above its trailing mean');
});
