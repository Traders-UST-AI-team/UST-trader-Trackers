import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { closeReviewsStore, openReviewsStore } from './reviews/db.ts';
import { seedReviewsDatabase } from './reviews/seed.ts';
import { fiscalYearEndMonth, quarterlySeries, reportedQuarters, type XbrlFact } from './reviews/edgar.ts';
import { amazonDate, amazonProvider, fetchAmazonReviews, normaliseAmazonReview } from './reviews/amazon.ts';
import { CanaryUnavailableError } from './reviews/adapters.ts';
import { addCompany, collectProduct, dueProducts, listRuns, syncFinancials, upsertProduct, watchlist, WatchlistError } from './reviews/tracker.ts';
import { backtestSummary, quarterToneSeries, swingOutcome, type ScoredReviewRow } from './reviews/policy.ts';
import { classifyQuarter } from '../shared/review-signals.ts';
import { getDashboardSummary } from './reviews/service.ts';
import { teamWriteGuard, registerTeamRoutes } from './teamauth.ts';
import type { CompanyFinancial } from '../shared/review-types.ts';
import type { ScoreResult } from './reviews/jev.ts';

process.env.HTTP_MIN_GAP_MS = '0';
process.env.HTTP_BACKOFF_MS = '5';

/** A transport answering by URL substring; anything unmatched is a 404. Records every URL asked. */
function router(routes: Record<string, unknown>) {
  const asked: string[] = [];
  const fetchImpl = (async (url: string) => {
    asked.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    const body = key ? routes[key] : { error: 'not found' };
    return { ok: Boolean(key), status: key ? 200 : 404, headers: new Headers(), text: async () => JSON.stringify(body), json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}

const fixedScore = async (): Promise<ScoreResult> => ({ tone_score: -1, is_product_related: true, primary_reason: 'defect', tags: ['defect'], model_used: 'test' });

const fact = (start: string, end: string, val: number, filed: string, form = '10-Q', accn = `acc-${end}`): XbrlFact => ({ start, end, val, filed, form, accn });

// ── EDGAR ────────────────────────────────────────────────────────────────────────────────────────

test('EDGAR: Q4 is derived as the year less Q1–Q3, and a restated value keeps its first filing date', () => {
  const series = quarterlySeries([[
    fact('2024-04-01', '2024-06-30', 100, '2024-07-25'),
    fact('2024-07-01', '2024-09-30', 110, '2024-10-24'),
    fact('2024-10-01', '2024-12-31', 130, '2025-01-29'),
    // the same quarter, restated in a later filing
    fact('2024-10-01', '2024-12-31', 131, '2025-10-29'),
    // nine-month year-to-date figure: neither a quarter nor a year, ignored
    fact('2024-04-01', '2024-12-31', 340, '2025-01-29'),
    fact('2024-04-01', '2025-03-31', 450, '2025-05-23', '10-K'),
  ]]);
  assert.deepEqual(series.map((q) => [q.end, q.value, q.derived]), [
    ['2024-06-30', 100, false],
    ['2024-09-30', 110, false],
    ['2024-12-31', 131, false],
    ['2025-03-31', 450 - 100 - 110 - 131, true],
  ]);
  assert.equal(series[2].first_filed, '2025-01-29', 'the market learned the number on the first filing');
});

test('EDGAR: an earlier revenue concept owns its periods; later concepts only fill gaps', () => {
  const series = quarterlySeries([
    [fact('2025-01-01', '2025-03-31', 200, '2025-04-30')],
    [fact('2025-01-01', '2025-03-31', 999, '2025-04-30'), fact('2024-01-01', '2024-03-31', 180, '2024-04-30')],
  ]);
  assert.deepEqual(series.map((q) => q.value), [180, 200]);
});

test('EDGAR: reported quarters carry fiscal labels, YoY growth, margins and a filing link', () => {
  const usd = (facts: XbrlFact[]) => ({ units: { USD: facts } });
  const rows = reportedQuarters({
    'us-gaap': {
      RevenueFromContractWithCustomerExcludingAssessedTax: usd([
        fact('2024-04-01', '2024-06-30', 1000, '2024-07-25', '10-Q', '0001032975-24-000001'),
        fact('2025-04-01', '2025-06-30', 1100, '2025-07-30', '10-Q', '0001032975-25-000001'),
      ]),
      GrossProfit: usd([fact('2025-04-01', '2025-06-30', 440, '2025-07-30')]),
    },
  }, { ticker: 'LOGI', cik: '0001032975', fiscalYearEndMonth: 3 });
  const latest = rows.at(-1)!;
  assert.equal(latest.fiscal_label, 'FY26 Q1');
  assert.equal(latest.id, 'LOGI-FY2026Q1');
  assert.equal(latest.revenue_yoy_growth, 10);
  assert.equal(latest.gross_margin, 40);
  assert.equal(latest.source_filing_url, 'https://www.sec.gov/Archives/edgar/data/1032975/000103297525000001/');
});

// ── Amazon ───────────────────────────────────────────────────────────────────────────────────────

test('Amazon: rows from either provider shape normalise; rows without identity or text are dropped', () => {
  const p = { asin: 'B003NR57BY', ticker: 'LOGI' };
  const rainforest = normaliseAmazonReview({ id: 'R1', title: 'Broke', body: 'Double clicks', rating: 1, date: { raw: 'Reviewed in the United States on March 3, 2025', utc: '2025-03-03T00:00:00.000Z' }, verified_purchase: true, vine_program: true, profile: { name: 'Sam' } }, p);
  assert.equal(rainforest?.review_id, 'amazon_R1');
  assert.equal(rainforest?.review_date, '2025-03-03');
  assert.equal(rainforest?.is_vine, true);
  assert.equal(rainforest?.author, 'Sam');
  const apify = normaliseAmazonReview({ reviewId: 'R2', reviewText: 'Fine mouse', ratingScore: '4.0', date: 'Reviewed in the United States on January 5, 2025', isVerified: true }, p);
  assert.equal(apify?.review_date, '2025-01-05');
  assert.equal(apify?.star_rating, 4);
  assert.equal(normaliseAmazonReview({ body: 'no id', date: '2025-01-01' }, p), null);
  assert.equal(normaliseAmazonReview({ id: 'R3', date: '2025-01-01' }, p), null);
  assert.equal(amazonDate('garbage'), null);
});

test('Amazon: without a provider the collector reports "not connected" and never dials out', async () => {
  const t = router({});
  assert.equal(amazonProvider({}), null);
  await assert.rejects(() => fetchAmazonReviews({ asin: 'B003NR57BY', ticker: 'LOGI' }, { env: {}, transport: { fetchImpl: t.fetchImpl } }), CanaryUnavailableError);
  assert.equal(t.asked.length, 0);
});

test('Amazon: a provider failure never echoes the request URL (it carries the key)', async () => {
  const fetchImpl = (async () => ({ ok: false, status: 401, headers: new Headers(), text: async () => '' })) as unknown as typeof fetch;
  await assert.rejects(
    () => fetchAmazonReviews({ asin: 'B003NR57BY', ticker: 'LOGI' }, { env: { RAINFOREST_API_KEY: 'secret-key' }, transport: { fetchImpl } }),
    (e: Error) => e instanceof CanaryUnavailableError && !e.message.includes('secret-key') && /HTTP 401/.test(e.message),
  );
});

// ── collection ───────────────────────────────────────────────────────────────────────────────────

test('collect: only reviews not already stored are scored, and every connector attempt is logged', async () => {
  const store = openReviewsStore(':memory:');
  try {
    seedReviewsDatabase(store);
    const product = upsertProduct(store, { asin: 'B0TESTTEST', ticker: 'LOGI', title: 'Test mouse' });
    const t = router({ 'api.rainforestapi.com': { reviews: [
      { id: 'A1', body: 'Scroll wheel died', rating: 1, date: { utc: '2025-05-01T00:00:00Z' } },
      { id: 'A2', body: 'Great', rating: 5, date: { utc: '2025-05-02T00:00:00Z' } },
    ] } });
    let scored = 0;
    const scorer = async () => { scored++; return fixedScore(); };
    const deps = { env: { RAINFOREST_API_KEY: 'k' }, amazon: { transport: { fetchImpl: t.fetchImpl } }, scorer };

    const first = await collectProduct(store, product, { ...deps, trigger: 'manual' });
    assert.deepEqual(first.map((r) => [r.connector, r.status, r.fetched, r.stored]), [['amazon', 'ok', 2, 2]]);
    const second = await collectProduct(store, product, { ...deps, trigger: 'schedule' });
    assert.deepEqual(second.map((r) => [r.status, r.fetched, r.stored]), [['ok', 2, 0]]);
    assert.equal(scored, 2, 'reviews seen before are not re-scored');
    assert.equal(listRuns(store, { asin: 'B0TESTTEST' }).length, 2);
  } finally {
    closeReviewsStore(store);
  }
});

test('collect: with no connector configured the attempt is still logged as unavailable', async () => {
  const store = openReviewsStore(':memory:');
  try {
    seedReviewsDatabase(store);
    const product = upsertProduct(store, { asin: 'B0TESTTEST', ticker: 'LOGI', title: 'Test mouse' });
    const runs = await collectProduct(store, product, { env: {}, trigger: 'manual' });
    assert.deepEqual(runs.map((r) => r.status), ['unavailable']);
    assert.deepEqual(dueProducts(store, new Date(), {}), [], 'the scheduler skips products it cannot collect');
  } finally {
    closeReviewsStore(store);
  }
});

test('financials: an EDGAR read replaces the bundled figures; a failed read leaves them alone', async () => {
  const store = openReviewsStore(':memory:');
  try {
    seedReviewsDatabase(store);
    const logi = { ticker: 'LOGI', name: 'Logitech', cik: '0001032975', fiscal_year_end_month: 3 };
    const down = router({});
    const failed = await syncFinancials(store, logi, { edgar: { transport: { fetchImpl: down.fetchImpl, retries: 0 } }, trigger: 'manual' });
    assert.equal(failed.status, 'error');
    const seedRows = (store.prepare("SELECT COUNT(*) c FROM company_financials WHERE ticker = 'LOGI' AND provenance = 'seed'").get() as { c: number }).c;
    assert.ok(seedRows > 0, 'a failed read touches nothing');

    const up = router({ 'companyfacts/CIK0001032975': { facts: { 'us-gaap': { Revenues: { units: { USD: [
      fact('2024-04-01', '2024-06-30', 1000, '2024-07-25'),
      fact('2025-04-01', '2025-06-30', 1100, '2025-07-30'),
    ] } } } } } });
    const ok = await syncFinancials(store, logi, { edgar: { transport: { fetchImpl: up.fetchImpl } }, trigger: 'manual' });
    assert.equal(ok.status, 'ok');
    const rows = store.prepare("SELECT provenance, COUNT(*) c FROM company_financials WHERE ticker = 'LOGI' GROUP BY provenance").all() as { provenance: string; c: number }[];
    assert.deepEqual(rows.map((r) => [r.provenance, r.c]), [['edgar', 2]]);
    assert.ok(up.asked.every((u) => u.startsWith('https://data.sec.gov/')));
  } finally {
    closeReviewsStore(store);
  }
});

test('watchlist: a ticker is resolved on EDGAR; one EDGAR does not know needs its name and fiscal year end', async () => {
  const store = openReviewsStore(':memory:');
  try {
    const t = router({
      'company_tickers.json': { 0: { cik_str: 1670592, ticker: 'YETI', title: 'YETI Holdings, Inc.' } },
      'submissions/CIK0001670592': { name: 'YETI Holdings, Inc.', fiscalYearEnd: '1228', sicDescription: 'Sporting goods' },
    });
    const yeti = await addCompany(store, { ticker: 'yeti', channel_exposure: 'high', added_by: 'Ana' }, { edgar: { transport: { fetchImpl: t.fetchImpl } } });
    assert.equal(yeti.cik, '0001670592');
    assert.equal(yeti.fiscal_year_end_month, 12);
    assert.equal(yeti.channel_exposure, 'high');
    assert.equal(yeti.added_by, 'Ana');

    await assert.rejects(() => addCompany(store, { ticker: 'NOPE' }, { edgar: { transport: { fetchImpl: t.fetchImpl } } }), (e: Error) => e instanceof WatchlistError && e.status === 422);
    const manual = await addCompany(store, { ticker: 'NOPE', name: 'Nope AG', fiscal_year_end_month: 6 }, { edgar: { transport: { fetchImpl: t.fetchImpl } } });
    assert.equal(manual.cik, null);

    assert.throws(() => upsertProduct(store, { asin: 'bad', ticker: 'YETI', title: 'x' }), WatchlistError);
    assert.throws(() => upsertProduct(store, { asin: 'B073WJW4CV', ticker: 'ZZZ', title: 'x' }), /watchlist first/);
    assert.deepEqual(watchlist(store).map((r) => r.company.ticker), ['NOPE', 'YETI']);
  } finally {
    closeReviewsStore(store);
  }
});

test('dashboard: a company scope pools every active listing', () => {
  const store = openReviewsStore(':memory:');
  try {
    seedReviewsDatabase(store);
    const company = getDashboardSummary(store, { ticker: 'LOGI' })!;
    const one = getDashboardSummary(store, { asin: 'B003NR57BY' })!;
    assert.equal(company.product, null);
    assert.ok(company.products.length >= 2);
    assert.ok(company.total_reviews >= one.total_reviews);
    assert.equal(one.product?.asin, 'B003NR57BY');
  } finally {
    closeReviewsStore(store);
  }
});

// ── signal rules ─────────────────────────────────────────────────────────────────────────────────

const fin = (id: string, start: string, end: string, yoy: number | null): CompanyFinancial => ({
  id, ticker: 'T', fiscal_year: 2025, fiscal_quarter: 1, fiscal_label: id, period_start_date: start, period_end_date: end,
  sec_report_date: end, revenue_usd: 1, revenue_yoy_growth: yoy, operating_income_usd: null, source_filing_url: null,
});

test('outcome: a swing is a hit when growth slows within two reported quarters, a miss when it holds, pending until reported', () => {
  const q1 = fin('Q1', '2025-01-01', '2025-03-31', 8);
  const q2 = fin('Q2', '2025-04-01', '2025-06-30', 9);
  const q3 = fin('Q3', '2025-07-01', '2025-09-30', 6);
  assert.equal(swingOutcome(q1, [q1, q2, q3]), 'hit');
  assert.equal(swingOutcome(q1, [q1, q2, fin('Q3', '2025-07-01', '2025-09-30', 10)]), 'miss');
  assert.equal(swingOutcome(q1, [q1, q2]), 'pending');
  assert.equal(swingOutcome(null, [q1]), 'no_filing');
});

test('signal: a negative swing needs tone below baseline *and* a fall from last quarter', () => {
  assert.equal(classifyQuarter({ delta_tone: -0.3, review_count: 40, qoq_change: -0.1 }).signal, 'negative_swing');
  assert.equal(classifyQuarter({ delta_tone: -0.3, review_count: 40, qoq_change: 0.05 }).signal, 'stable', 'recovering, not a new swing');
  assert.equal(classifyQuarter({ delta_tone: -0.3, review_count: 5 }).is_sparse, true);
});

test('tone: Vine reviews are counted but never averaged into tone', () => {
  const row = (id: string, tone: number, vine = false): ScoredReviewRow => ({
    review_id: id, review_date: '2025-02-01', platform: 'amazon', tone_score: tone, is_product_related: 1, primary_reason: 'other', tags_json: '[]', is_vine: vine ? 1 : 0,
  });
  const { quarters } = quarterToneSeries([row('a', -2), row('b', 2, true), row('c', 2, true)], { fiscalYearEndMonth: 12, financials: [] });
  assert.equal(quarters[0].avg_tone, -2);
  assert.equal(quarters[0].vine_count, 2);
  assert.equal(quarters[0].tone_review_count, 1);
});

test('backtest: the hit rate is reported next to the base rate it has to beat', () => {
  const fins = [
    fin('A', '2024-01-01', '2024-03-31', 10), fin('B', '2024-04-01', '2024-06-30', 8),
    fin('C', '2024-07-01', '2024-09-30', 9), fin('D', '2024-10-01', '2024-12-31', 12), fin('E', '2025-01-01', '2025-03-31', 13),
  ];
  const quarter = (finRow: CompanyFinancial, swing: boolean) => ({
    quarter_label: finRow.id, calendar_quarter: finRow.id, start_date: finRow.period_start_date, end_date: finRow.period_end_date, review_count: 30,
    avg_tone: 0, baseline_tone: 0, delta_tone: 0, reddit_tone: null, amazon_tone: null, bestbuy_tone: null, negative_count: 0, defect_count: 0,
    quality_decline_count: 0, is_sparse: false, is_negative_swing: swing, financial: finRow, outcome: swing ? swingOutcome(finRow, fins) : null,
  });
  const summary = backtestSummary([quarter(fins[0], true), quarter(fins[2], true)], fins);
  assert.equal(summary.hits, 1);
  assert.equal(summary.misses, 1);
  assert.equal(summary.hit_rate, 0.5);
  assert.equal(summary.base_quarters, 3);
  assert.equal(summary.base_rate, Number((1 / 3).toFixed(3)));
});

// ── team code ────────────────────────────────────────────────────────────────────────────────────

test('team code: reads stay open, writes need the code, and the guard is off when no code is set', async () => {
  const app = express();
  app.use(teamWriteGuard);
  app.use(express.json());
  registerTeamRoutes(app);
  app.get('/api/thing', (_req, res) => res.json({ ok: true }));
  app.post('/api/thing', (_req, res) => res.json({ ok: true }));
  app.post('/api/keep-fresh', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const saved = process.env.TEAM_WRITE_TOKEN;
  try {
    delete process.env.TEAM_WRITE_TOKEN;
    assert.equal((await fetch(`${base}/api/thing`, { method: 'POST' })).status, 200);

    process.env.TEAM_WRITE_TOKEN = 'open-sesame';
    assert.equal((await fetch(`${base}/api/thing`)).status, 200);
    assert.equal((await fetch(`${base}/api/keep-fresh`, { method: 'POST' })).status, 200);
    const refused = await fetch(`${base}/api/thing`, { method: 'POST' });
    assert.equal(refused.status, 401);
    assert.equal((await refused.json()).code, 'team_code_required');
    assert.equal((await fetch(`${base}/api/thing`, { method: 'POST', headers: { 'x-team-token': 'wrong' } })).status, 401);
    assert.equal((await fetch(`${base}/api/thing`, { method: 'POST', headers: { 'x-team-token': 'open-sesame' } })).status, 200);
    assert.deepEqual(await (await fetch(`${base}/api/session`, { headers: { 'x-team-token': 'open-sesame' } })).json(), { write_protected: true, can_write: true });
  } finally {
    if (saved === undefined) delete process.env.TEAM_WRITE_TOKEN;
    else process.env.TEAM_WRITE_TOKEN = saved;
    server.close();
  }
});

test('outcome: a swing newer than the latest filing is pending, not "no filing"', () => {
  const row = (id: string, date: string, tone: number): ScoredReviewRow => ({
    review_id: id, review_date: date, platform: 'amazon', tone_score: tone, is_product_related: 1, primary_reason: 'other', tags_json: '[]',
  });
  const rows: ScoredReviewRow[] = [];
  ['2025-02-01', '2025-05-01', '2025-08-01', '2025-11-01'].forEach((d, i) => { for (let k = 0; k < 25; k++) rows.push(row(`b${i}_${k}`, d, 1)); });
  for (let k = 0; k < 25; k++) rows.push(row(`s_${k}`, '2026-02-01', -1));
  const { quarters } = quarterToneSeries(rows, { fiscalYearEndMonth: 12, financials: [fin('Q', '2025-10-01', '2025-12-31', 5)] });
  const last = quarters.at(-1)!;
  assert.equal(last.is_negative_swing, true);
  assert.equal(last.outcome, 'pending');
});

test('EDGAR: a 52/53-week year closing in the first days of a month belongs to the month before', () => {
  assert.equal(fiscalYearEndMonth('0331'), 3);
  assert.equal(fiscalYearEndMonth('1228'), 12);
  assert.equal(fiscalYearEndMonth('0103'), 12, 'YETI');
  assert.equal(fiscalYearEndMonth('0927'), 9, 'Apple');
  assert.equal(fiscalYearEndMonth('0202'), 1, 'a retailer closing in early February');
  assert.equal(fiscalYearEndMonth(undefined), null);
});
