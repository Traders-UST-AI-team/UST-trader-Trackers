// Service/API-level fixtures: stored data → indicator results, caching, bounds, preferences, watchlist, routes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

process.env.TRACKER_DB = join(mkdtempSync(join(tmpdir(), 'wt-ind-')), 't.sqlite');
const { db } = await import('./db.ts');
const svc = await import('./indicators/service.ts');
const { registerIndicatorRoutes } = await import('./indicators/routes.ts');

const T0 = 1_790_000_000 - (1_790_000_000 % 3600); // an exact UTC hour in the past (a future asOf is rejected by the API)
const H = 3600;
const close = (a: number | null | undefined, b: number, eps = 1e-9) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

function addMarket(id: string, venue: string, points: [number, number][], fidelity = 60) {
  db.prepare(`INSERT OR REPLACE INTO markets (condition_id, venue, event_id, event_slug, event_title, question, outcome_label, observed_at, is_open, price, quote_basis, best_bid, best_ask, liquidity, volume_24h)
    VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)`).run(id, venue, 'e', 'e', 'Event', `Question ${id}`, 'Yes', new Date().toISOString(), points.at(-1)![1], 'midpoint', 0.4, 0.42, 5000, 100);
  db.prepare('DELETE FROM price_history WHERE condition_id = ?').run(id);
  const ins = db.prepare('INSERT INTO price_history (condition_id, t, p) VALUES (?,?,?)');
  for (const [t, p] of points) ins.run(id, t, p);
  db.prepare('INSERT OR REPLACE INTO history_meta (condition_id, fetched_at, fidelity, error) VALUES (?,?,?,NULL)').run(id, new Date().toISOString(), fidelity);
}
// 101 hourly samples, 30 s after the hour, linear ramp p_i = 0.30 + 0.001·i  (i = 0..100)
const ramp: [number, number][] = Array.from({ length: 101 }, (_, i) => [T0 + i * H + 30, 0.3 + 0.001 * i]);
addMarket('m1', 'polymarket', ramp);
const AS_OF = T0 + 100 * H + 1800; // 30 min into the hour that sample 100 belongs to → that hour is NOT complete

test('SMA24 equals the hand-computed mean of the last 24 completed-hour samples', () => {
  const r = svc.marketIndicators('m1', ['sma24'], { asOf: AS_OF })!.indicators[0];
  assert.equal(r.status, 'ok');
  // last completed bucket is i=99; mean of p_76..p_99 = 0.30 + 0.001·(76+99)/2 = 0.3875 → 38.75 %
  close(r.latest!.value, 38.75, 1e-9);
  assert.equal(r.unit, '%'); assert.equal(r.timeframe, '24 x 1h'); assert.equal(r.definition_version, 'ind-1.1.0');
  assert.equal(r.points.filter((p) => p.value === null).length, 23);                  // warm-up points are null, never zero
  assert.equal(r.points.length, 100);                                                 // samples 0..99 (sample 100 is in the incomplete hour)
});

test('EMA24 matches an independent plain-loop implementation of the stated formula', () => {
  const r = svc.marketIndicators('m1', ['ema24'], { asOf: AS_OF })!.indicators[0];
  const v = ramp.slice(0, 100).map(([, p]) => p);
  let e = v.slice(0, 24).reduce((a, b) => a + b, 0) / 24;
  for (let i = 24; i < v.length; i++) e = 0.08 * v[i] + 0.92 * e;
  close(r.latest!.value, 100 * e, 1e-9);
});

test('1h change: 100×(latest − reference) with the real timestamps and interval; hourly movement baseline needs ≥48 prior pairs', () => {
  const r = svc.marketIndicators('m1', ['change_1h', 'change_24h', 'hourly_movement'], { asOf: AS_OF })!.indicators;
  const c1 = r[0], c24 = r[1], mv = r[2];
  assert.equal(c1.status, 'ok'); close(c1.latest!.value, 0.1, 1e-9);                  // 100×(0.400 − 0.399)
  assert.equal(c1.extra!.actual_interval_s, 3600); assert.equal((c1.extra!.latest as any).t, T0 + 99 * H + 30); // latest COMPLETED hour (sample 100 is in the incomplete hour)
  assert.match(String(c1.extra!.measured_on), /completed-hour/);
  close(c24.latest!.value, 2.4, 1e-9); assert.equal(c24.extra!.actual_interval_s, 86400);
  assert.equal(mv.status, 'ok'); close(mv.latest!.value, 0.1, 1e-9);
  assert.equal((mv.extra!.baseline as any).n, 98);                                    // prior adjacent-hour pairs within the 168 window
  assert.equal(mv.extra!.label, 'within_history');                                     // a constant 0.1 pp walk is not unusual
  assert.match(String(mv.extra!.note), /not a cause, a forecast or a trading signal/);
});

test('a future asOf-bucket point is excluded; a stale latest point gives null with a reason, never zero', () => {
  const stale = svc.marketIndicators('m1', ['change_1h', 'sma24'], { asOf: AS_OF + 4 * H })!.indicators;
  assert.equal(stale[0].status, 'stale'); assert.equal(stale[0].latest!.value, null); assert.match(stale[0].reason!, /old/);
  assert.equal(stale[1].status, 'stale'); assert.equal(stale[1].latest!.value, null);
  // historical asOf: ignoring everything after it gives the value that was knowable then
  const past = svc.marketIndicators('m1', ['sma24'], { asOf: T0 + 50 * H + 1800 })!.indicators[0];
  close(past.latest!.value, 100 * (0.3 + 0.001 * (26 + 49) / 2), 1e-9);               // samples 26..49
});

test('range independence: `since` crops what is returned but never what is computed', () => {
  const full = svc.marketIndicators('m1', ['ema24'], { asOf: AS_OF })!.indicators[0];
  const crop = svc.marketIndicators('m1', ['ema24'], { asOf: AS_OF, since: T0 + 80 * H })!.indicators[0];
  assert.ok(crop.points.length < full.points.length);
  const byT = new Map(full.points.map((p) => [p.t, p.value]));
  for (const p of crop.points) assert.equal(p.value, byT.get(p.t));                    // identical values at identical timestamps
  assert.equal(crop.latest!.value, full.latest!.value);
});

test('cache: identical request hits; revising an OLD observation (same MAX(t)) invalidates; sampling precision is part of the version', () => {
  svc.clearCache();
  const a = svc.marketIndicators('m1', ['sma24'], { asOf: AS_OF })!.indicators[0];
  assert.deepEqual([svc.cacheStats.hits, svc.cacheStats.misses], [0, 1]);
  const b = svc.marketIndicators('m1', ['sma24'], { asOf: AS_OF })!.indicators[0];
  assert.equal(svc.cacheStats.hits, 1); assert.deepEqual(a, b);
  db.prepare('UPDATE price_history SET p = 0.9 WHERE condition_id = ? AND t = ?').run('m1', T0 + 90 * H + 30); // an old point revised
  const c = svc.marketIndicators('m1', ['sma24'], { asOf: AS_OF })!.indicators[0];
  assert.notEqual(c.input_version, a.input_version); assert.notEqual(c.latest!.value, a.latest!.value);
  assert.equal(svc.cacheStats.misses, 2);
  db.prepare('UPDATE price_history SET p = ? WHERE condition_id = ? AND t = ?').run(0.3 + 0.001 * 90, 'm1', T0 + 90 * H + 30); // restore
  db.prepare('UPDATE history_meta SET fidelity = 360 WHERE condition_id = ?').run('m1');
  assert.notEqual(svc.marketIndicators('m1', ['sma24'], { asOf: AS_OF })!.indicators[0].input_version, a.input_version, 'fidelity must change the version');
  db.prepare('UPDATE history_meta SET fidelity = 60 WHERE condition_id = ?').run('m1');
  assert.equal(svc.marketIndicators('m1', ['sma24'], { asOf: AS_OF })!.indicators[0].input_version, a.input_version, 'restoring the input restores the version');
  // same input, different venue/basis → different version (compute separately by venue and basis)
  addMarket('m1k', 'kalshi', ramp);
  assert.notEqual(svc.marketIndicators('m1k', ['sma24'], { asOf: AS_OF })!.indicators[0].input_version, a.input_version);
});

test('coarse history (6 h fidelity) is NOT presented as hourly: hourly indicators unsupported, 24h change still computed', () => {
  const coarse: [number, number][] = Array.from({ length: 40 }, (_, i) => [T0 + i * 6 * H, 0.3 + 0.002 * i]);
  addMarket('m6h', 'polymarket', coarse, 360);
  const r = svc.marketIndicators('m6h', ['sma24', 'ema24', 'hourly_movement', 'change_24h'], { asOf: T0 + 39 * 6 * H + 600 })!.indicators;
  assert.deepEqual(r.slice(0, 3).map((x) => x.status), ['unsupported', 'unsupported', 'unsupported']);
  assert.match(r[0].reason!, /not hourly.*6\.0 h/);
  assert.equal(r[3].status, 'ok'); close(r[3].latest!.value, 100 * 0.002 * 4, 1e-9);   // 24 h = four 6-h steps
});

test('gap handling: a >90 min hole restarts warm-up, status gap, value null with the sample count', () => {
  const holey: [number, number][] = ramp.slice(0, 101).filter(([t]) => !(t > T0 + 90 * H && t < T0 + 93 * H)); // remove samples 91,92
  addMarket('mgap', 'polymarket', holey);
  const r = svc.marketIndicators('mgap', ['sma24'], { asOf: AS_OF })!.indicators[0];
  assert.equal(r.status, 'gap'); assert.equal(r.latest!.value, null);
  assert.match(r.reason!, /\d+ of 24 consecutive hourly samples available since the last gap/);
  assert.equal(r.coverage.gaps, 1);
});

test('event reaction: completed-hour moves vs a point-in-time baseline that excludes the event itself', () => {
  // ramp: every hour moves +0.1 pp. Event published mid-hour 60.
  const ts = T0 + 60 * H + 1800;
  const r = svc.eventReaction('m1', ts, 'instant', AS_OF)!;
  assert.equal(r.status, 'ok'); close(r.move_event_hour_pp, 0.1, 1e-9); close(r.move_next_hour_pp, 0.1, 1e-9); close(r.level_change_24h_pp, 2.5, 1e-9);
  assert.equal(r.baseline!.n, 59); close(r.baseline!.median_pp, 0.1, 1e-9); close(r.baseline!.p95_pp, 0.1, 1e-9);
  assert.equal(r.label_event_hour, 'within_ordinary'); assert.match(r.caveats.join(' '), /not evidence of cause/);
  // a +10 pp jump inside hour 70, planted in a copy of the series: flagged above P95, and the baseline must NOT include that jump
  const jumped: [number, number][] = ramp.map(([t, p], i) => [t, i >= 70 ? p + 0.10 : p]);
  addMarket('mjump', 'polymarket', jumped);
  const j = svc.eventReaction('mjump', T0 + 70 * H + 600, 'instant', AS_OF)!;
  close(j.move_event_hour_pp, 10.1, 1e-9); assert.equal(j.label_event_hour, 'above_p95');
  close(j.baseline!.p95_pp, 0.1, 1e-9);                                  // jump excluded from its own yardstick
  assert.equal(j.baseline!.n, 69);                                       // adjacent pairs ending at buckets 1..69
  // an item in the hour AFTER the jump is judged against a baseline that now contains the jump pair as ordinary history, not the event
  // date-only items cannot be aligned to an hour; items in an incomplete hour or before the history are explicit
  assert.equal(svc.eventReaction('m1', ts, 'date', AS_OF)!.status, 'unsupported');
  const live = svc.eventReaction('m1', T0 + 100 * H + 600, 'instant', AS_OF)!;
  assert.equal(live.status, 'warming_up'); assert.match(live.reason!, /not complete yet/);
  assert.equal(svc.eventReaction('m1', T0 - 5 * H, 'instant', AS_OF)!.status, 'warming_up');
  // too little history for a baseline → moves shown, label unavailable, reason says why
  const early = svc.eventReaction('m1', T0 + 20 * H + 600, 'instant', AS_OF)!;
  assert.equal(early.baseline, null); assert.equal(early.label_event_hour, 'unavailable'); assert.match(early.reason!, /prior adjacent-hour pairs/); assert.ok(early.move_event_hour_pp !== null);
});

test('registered indicators only; parameters are bounded', () => {
  const ok = (s: string, k: 'market' | 'sensor' = 'market') => svc.parseIds([s], k);
  assert.equal(ok('sma24').ok.length, 1); assert.equal(ok('ema72').ok[0].n, 72); assert.equal(ok('sma200').ok.length, 1);
  for (const bad of ['sma1', 'sma201', 'sma0', 'atr14', 'vwap', 'sma24; drop table', 'x', '../etc', 'sma-5', 'sma2.5']) assert.deepEqual(ok(bad).bad, [bad], bad);
  assert.equal(ok('ema24', 'sensor').bad.length, 1);                                   // EMA is not a registered sensor indicator
  assert.equal(ok('sma7', 'sensor').ok[0].def.id, 'sma_published');
  assert.equal(ok('sma61', 'sensor').bad.length, 1);
});

test('sensor indicators: PortWatch baseline excludes the current day; FRED change/SMA over real observations; OpenSky has no anomaly baseline', () => {
  const D = 86400, d0 = T0 - (T0 % D);
  const put = (id: string, rows: [number, number][]) => { const ins = db.prepare('INSERT OR REPLACE INTO series_points (series_id, t, v) VALUES (?,?,?)'); for (const [t, v] of rows) ins.run(id, t, v); db.prepare('INSERT OR REPLACE INTO series_meta (series_id, fetched_at) VALUES (?,?)').run(id, '2026-10-09T00:00:00Z'); };
  put('pw:hormuz:total', [...Array.from({ length: 30 }, (_, i) => [d0 + i * D, 10] as [number, number]), [d0 + 30 * D, 13]]);
  const asOf = d0 + 33 * D;
  const pw = svc.sensorIndicators('pw:hormuz:total', [], { asOf })!.indicators[0];
  assert.equal(pw.status, 'ok'); close(pw.extra!.baseline_mean as number, 10); close(pw.extra!.pct_change as number, 30); assert.equal(pw.extra!.observation_age_days, 3);
  assert.match(String(pw.extra!.note), /never live/);
  // FRED: Friday → Monday observations only
  put('fred:brent', [[d0, 100], [d0 + D, 102], [d0 + 2 * D, 104], [d0 + 5 * D, 110]]);
  const fr = svc.sensorIndicators('fred:brent', ['published_change', 'sma2'], { asOf: d0 + 6 * D })!.indicators;
  close(fr[0].extra!.pct_change as number, 100 * 6 / 104); assert.equal(fr[0].extra!.days_between, 3);
  assert.deepEqual(fr[1].points.map((p) => p.value), [null, 101, 103, 107]);           // no weekend zeros between 104 and 110
  // OpenSky: observed change only
  put('opensky:iran:airborne', [[d0, 70], [d0 + 1800, 77]]);
  const os = svc.sensorIndicators('opensky:iran:airborne', [], { asOf: d0 + 2000 })!.indicators[0];
  assert.equal(os.extra!.change_vs_previous, 7); assert.equal(os.extra!.baseline, 'unsupported'); assert.match(String(os.extra!.baseline_reason), /14 days/);
  // an indicator that does not apply to a series is explicit, not silently empty
  assert.equal(svc.sensorIndicators('opensky:iran:airborne', ['baseline_28d'], { asOf })!.indicators[0].status, 'unsupported');
});

test('preferences persist and reject anything that is not a registered overlay; watchlist validates targets and size', () => {
  assert.deepEqual(svc.getPrefs(), svc.DEFAULT_PREFS);
  assert.equal(svc.setPrefs({ indicators: ['sma24', 'ema72'], axis: 'fixed', range: '7d' }).ok, true);
  assert.deepEqual(svc.getPrefs(), { indicators: ['sma24', 'ema72'], axis: 'fixed', range: '7d', panes: [] });
  for (const bad of [{ indicators: ['change_1h'], axis: 'auto', range: '7d' }, { indicators: ['atr14'], axis: 'auto', range: '7d' }, { indicators: ['rsi14'], axis: 'auto', range: '7d' }, { indicators: ['sma24'], axis: 'log', range: '7d' }, { indicators: Array(7).fill('sma24'), axis: 'auto', range: '7d' }, 'x', null])
    assert.equal(svc.setPrefs(bad).ok, false);
  assert.deepEqual(svc.getPrefs().indicators, ['sma24', 'ema72'], 'a rejected update must not change stored prefs');
  assert.equal(svc.setWatchlist([{ kind: 'market', id: 'm1' }, { kind: 'sensor', id: 'fred:brent' }]).ok, true);
  assert.equal(svc.getWatchlist().length, 2);
  for (const bad of [[{ kind: 'market', id: 'nope' }], [{ kind: 'sensor', id: 'nope' }], [{ kind: 'x', id: 'm1' }], Array(9).fill({ kind: 'sensor', id: 'fred:brent' }), 'x']) assert.equal(svc.setWatchlist(bad).ok, false);
  const cards = svc.watchlistCards(AS_OF).cards;
  assert.deepEqual(cards.map((c) => c.kind), ['market', 'sensor']);
  assert.equal(cards[0].change!.unit, 'pp'); assert.equal(cards[0].change!.window, '1h'); assert.ok(cards[0].sparkline.length > 10);
  assert.match(cards[1].latest.label, /not live/);                                     // FRED is delayed: never labelled live
});

test('information activity: counted by COLLECTION time; late-collected news and Telegram backfill are not "new"', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  const iso = (m: number) => new Date(now - m * 60_000).toISOString();
  const ev = (id: string, src: string, pubMinAgo: number, seenMinAgo: number) => db.prepare(`INSERT INTO events (id, source_id, external_id, published_at, title, summary, raw_url, entities, topics, relevant, first_seen_at, last_seen_at, time_precision)
    VALUES (?,?,?,?,?,?,?,'[]','[]',1,?,?,'instant')`).run(id, src, id, iso(pubMinAgo), id, '', 'https://x', iso(seenMinAgo), iso(seenMinAgo));
  ev('a1', 'bbc-me', 20, 10); ev('a2', 'ofac', 5, 3); ev('a3', 'bbc-me', 24 * 60, 5); // a3 published a day ago, first seen 5 min ago → late
  const tg = (id: number, via: string, seenMinAgo: number) => db.prepare(`INSERT INTO tg_posts (channel, post_id, posted_at, text, url, first_seen_at, fetched_at, seen_via) VALUES ('c', ?, ?, 'x', 'u', ?, ?, ?)`).run(id, iso(seenMinAgo + 1), iso(seenMinAgo), iso(seenMinAgo), via);
  tg(1, 'latest', 4); tg(2, 'backfill', 4); tg(3, 'unknown', 4);
  const a = svc.activityIndicators(now);
  const w15 = a.windows[0];
  assert.deepEqual(w15.collected, { total: 3, news: 1, official: 1, telegram: 1 });   // a1 (news), a2 (official), tg 'latest' only
  assert.equal(w15.late_collected, 1);
  assert.match(a.notes.join(' '), /not events that occurred/);
});

// ── routes ──
const app = express(); app.use(express.json()); registerIndicatorRoutes(app, { seed: false });
const server = createServer(app); await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
const B = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

test('routes: bounds and validation', async () => {
  assert.equal((await fetch(`${B}/api/markets/m1/indicators?indicators=sma24,ema72&asOf=${AS_OF}`)).status, 200);
  assert.equal((await fetch(`${B}/api/markets/m1/indicators?indicators=sma24;drop`)).status, 400);
  assert.equal((await fetch(`${B}/api/markets/m1/indicators?indicators=atr14`)).status, 400);
  assert.equal((await fetch(`${B}/api/markets/m1/indicators?asOf=${Math.floor(Date.now() / 1000) + 99999}`)).status, 400, 'future asOf rejected');
  assert.equal((await fetch(`${B}/api/markets/m1/indicators?asOf=abc`)).status, 400);
  assert.equal((await fetch(`${B}/api/markets/nope/indicators`)).status, 404);
  assert.equal((await fetch(`${B}/api/markets/m1/reaction?ts=${T0 + 60 * H}&asOf=${AS_OF}`)).status, 200);
  assert.equal((await fetch(`${B}/api/markets/m1/reaction?ts=abc`)).status, 400);
  assert.equal((await fetch(`${B}/api/markets/m1/reaction?ts=${Math.floor(Date.now() / 1000) + 9999}`)).status, 400);
  assert.equal((await fetch(`${B}/api/markets/nope/reaction?ts=${T0}`)).status, 404);
  assert.equal((await fetch(`${B}/api/sensors/nope/indicators`)).status, 404);
  const reg = await (await fetch(`${B}/api/indicators/registry`)).json() as any;
  assert.equal(reg.definition_version, 'ind-1.1.0'); assert.ok(reg.indicators.some((d: any) => d.id === 'sma'));
  const put = await fetch(`${B}/api/prefs`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ indicators: ['atr14'], axis: 'auto', range: '7d' }) });
  assert.equal(put.status, 400);
  const body = await (await fetch(`${B}/api/markets/m1/indicators?indicators=change_1h&asOf=${AS_OF}`)).json() as any;
  assert.deepEqual(Object.keys(body.indicators[0]).filter((k) => ['id', 'definition_version', 'target', 'basis', 'unit', 'timeframe', 'params', 'as_of', 'computed_at', 'input_version', 'sample_count', 'coverage', 'status', 'reason', 'latest', 'points'].includes(k)).length, 16, 'every plan-required output field is present');
});

test('prefs: panes are optional, limited to rsi14/macd, unique; bollinger is a valid overlay', () => {
  const base = { indicators: ['sma24', 'bollinger'], axis: 'auto', range: '30d' };
  assert.deepEqual(svc.sanitizePrefs(base)?.panes, [], 'panes default to none (off by default)');
  assert.deepEqual(svc.sanitizePrefs({ ...base, panes: ['rsi14', 'macd'] })?.panes, ['rsi14', 'macd']);
  for (const bad of [['atr14'], ['rsi14', 'rsi14'], 'rsi14', ['rsi14', 'macd', 'rsi14']]) assert.equal(svc.sanitizePrefs({ ...base, panes: bad }), null);
});

test('computation takes its inputs: an indicator is computed from a plain sample array', () => {
  // No market row, no history table, no HTTP: the computation is reachable with the data it needs.
  const raw = Array.from({ length: 30 }, (_, i) => ({ t: T0 + i * H, v: 0.5 }));
  const input = {
    id: 'synthetic', venue: 'polymarket', question: 'Synthetic', basis: 'polymarket:test', basisKey: 'test',
    fidelity: 60, raw, version: 'v-synthetic', spread: null, liquidity: null, price: 0.5,
    quote_basis: null, observed_at: new Date(T0 * 1000).toISOString(), history_fetched_at: null,
  };
  const parsed = svc.parseIds(['sma10'], 'market');
  assert.deepEqual(parsed.bad, []);

  const out = svc.computeMarketOne(input, parsed.ok[0], T0 + 29 * H);
  assert.equal(out.status, 'ok');
  assert.equal(out.latest?.value, 50, 'a flat 0.5 series has a 50 % moving average');
  assert.equal(out.definition_version, svc.REGISTRY_VERSION);
  assert.equal(out.input_version, 'v-synthetic');

  // The same input and as-of give the same answer; a different as-of is a different computation and
  // is not answered from the cache of another one.
  assert.deepEqual(svc.computeMarketOne(input, parsed.ok[0], T0 + 29 * H), out);
  assert.notEqual(svc.computeMarketOne(input, parsed.ok[0], T0 + 20 * H).latest?.value, undefined);
});
