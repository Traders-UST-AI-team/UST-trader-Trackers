import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { AddressInfo } from 'node:net';
import {
  detectDelimiter,
  parseCsv,
  parseReviewDate,
  parseStarRating,
  sniffAndParseReviews,
} from './reviews/sniffer.ts';
import { scoreReview, scoreWithLocalHeuristics } from './reviews/jev.ts';
import { migrateReviews } from './reviews/schema.ts';
import { closeReviewsStore, openReviewsStore } from './reviews/db.ts';
import { seedReviewsDatabase } from './reviews/seed.ts';
import { calendarQuarterToFiscalLabel, dateToCalendarQuarter, fiscalPeriodForCalendarQuarter, matchPeriodByDate } from './reviews/fiscal.ts';
import { getProductDashboardSummary, listReviews } from './reviews/service.ts';
import { canarySummary, currentStatus, quarterToneSeries } from './reviews/policy.ts';
import { CanaryUnavailableError, fetchBestBuyReviews, fetchRedditCanaries } from './reviews/adapters.ts';
import type { ScoreResult } from './reviews/jev.ts';

// The shared polite-HTTP client throttles per host and backs off between retries; tests that inject
// a fake transport should not pay for either.
process.env.HTTP_MIN_GAP_MS = '0';
process.env.HTTP_BACKOFF_MS = '5';

/** A transport that answers every request with `body` at `status`, so no test reaches the network. */
const fakeTransport = (status: number, body: unknown): { transport: { fetchImpl: typeof fetch } } => ({
  transport: {
    fetchImpl: (async () => ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(),
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    })) as unknown as typeof fetch,
  },
});

test('sniffer: parses CSV with quotes, commas and newlines', () => {
  const csv = `review-title,review-text,star-rating,review-date
"Great mouse, but issues","I bought this mouse, and it worked well for 2 months.
Then, it began double clicking!","1.0 out of 5 stars","Reviewed in the United States on September 22, 2024"
"Solid purchase","Works fine.","5.0 out of 5 stars","Reviewed in the United States on August 10, 2024"`;

  const parsed = parseCsv(csv);
  assert.equal(parsed.headers.length, 4);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0]['review-title'], 'Great mouse, but issues');
  assert.ok(parsed.rows[0]['review-text'].includes('double clicking!'));
});

test('sniffer: auto-detects semicolon and tab delimiters in TSV and European CSV', () => {
  // Semicolon delimited
  const semiCsv = `title;body;rating;date\n"Bad switch";"Left click stopped working";"1";"2024-05-10"\n"Good";"Fine";"5";"2024-05-11"`;
  assert.equal(detectDelimiter(semiCsv), ';');
  const semiParsed = parseCsv(semiCsv);
  assert.equal(semiParsed.headers.length, 4);
  assert.equal(semiParsed.rows.length, 2);
  assert.equal(semiParsed.rows[0].title, 'Bad switch');

  // Tab delimited (TSV)
  const tsv = `title\tbody\trating\tdate\n"T1"\t"Body text"\t"4"\t"2024-06-01"`;
  assert.equal(detectDelimiter(tsv), '\t');
  const tsvParsed = parseCsv(tsv);
  assert.equal(tsvParsed.headers.length, 4);
  assert.equal(tsvParsed.rows.length, 1);
  assert.equal(tsvParsed.rows[0].body, 'Body text');
});

test('sniffer: date parser handles diverse international and web formats', () => {
  assert.equal(parseReviewDate('Reviewed in the United States on September 22, 2024'), '2024-09-22');
  assert.equal(parseReviewDate('Reviewed in the United Kingdom on 15 March 2023'), '2023-03-15');
  assert.equal(parseReviewDate('September 22, 2024'), '2024-09-22');
  assert.equal(parseReviewDate('2024-09-22'), '2024-09-22');
  assert.equal(parseReviewDate('2024/09/22'), '2024-09-22');
  assert.equal(parseReviewDate('09/22/2024'), '2024-09-22'); // US format
  assert.equal(parseReviewDate('25/08/2024'), '2024-08-25'); // EU DD/MM/YYYY format
  assert.equal(parseReviewDate('22.09.2024'), '2024-09-22'); // German DD.MM.YYYY
  assert.equal(parseReviewDate('22-Sep-2024'), '2024-09-22'); // DD-Mon-YYYY
  assert.equal(parseReviewDate(''), null);
  assert.equal(parseReviewDate('Tomorrow morning'), null);
});

test('sniffer: rating parser extracts numbers, decimals, fractions, and CSS classes correctly', () => {
  assert.equal(parseStarRating('5.0 out of 5 stars'), 5.0);
  assert.equal(parseStarRating('4.0 out of 5 stars'), 4.0);
  assert.equal(parseStarRating('4/5.0'), 4.0);
  assert.equal(parseStarRating('4.5 / 5.0'), 4.5);
  assert.equal(parseStarRating('a-star-5'), 5.0);
  assert.equal(parseStarRating('a-star-2-5'), 2.5);
  assert.equal(parseStarRating('3/5'), 3.0);
  assert.equal(parseStarRating('1'), 1.0);
  assert.equal(parseStarRating('4,5'), 4.5); // European comma decimal
  assert.equal(parseStarRating('9/10'), 4.5); // 10-point scale
  assert.equal(parseStarRating('8 out of 10'), 4.0);
  assert.equal(parseStarRating('invalid'), null);
  assert.equal(parseStarRating('-5'), null);
});

test('sniffer: auto-detects Instant Data Scraper and Amazon Reviews Exporter columns without false positive collisions', () => {
  // Test case with Reviewer column before text
  const csvWithReviewer = `Reviewer,Text,Date,Rating
John Doe,The left mouse switch started double clicking,2024-05-01,1.0 out of 5 stars`;

  const resReviewer = sniffAndParseReviews(csvWithReviewer);
  assert.equal(resReviewer.detectedColumns.authorCol, 'Reviewer');
  assert.equal(resReviewer.detectedColumns.bodyCol, 'Text');
  assert.equal(resReviewer.parsedReviews[0].author, 'John Doe');
  assert.ok(resReviewer.parsedReviews[0].body.includes('double clicking'));

  // Instant Data Scraper
  const idsCsv = `review-title,review-text,star-rating,review-date,author,verified-purchase
"5.0 out of 5 stars Love this mouse","Been using it for 5 years, still works flawlessly.","5.0 out of 5 stars","Reviewed in the United States on October 12, 2024","John Doe","Verified Purchase"
"1.0 out of 5 stars Double click defect","Left button started double clicking within 60 days.","1.0 out of 5 stars","Reviewed in the United States on November 04, 2024","Jane Smith","Verified Purchase"`;

  const res1 = sniffAndParseReviews(idsCsv);
  assert.equal(res1.detectedColumns.bodyCol, 'review-text');
  assert.equal(res1.detectedColumns.dateCol, 'review-date');
  assert.equal(res1.detectedColumns.ratingCol, 'star-rating');
  assert.equal(res1.detectedColumns.titleCol, 'review-title');
  assert.equal(res1.parsedReviews.length, 2);
  assert.equal(res1.parsedReviews[0].title, 'Love this mouse');
  assert.equal(res1.parsedReviews[0].rating, 5.0);
  assert.equal(res1.parsedReviews[0].date, '2024-10-12');
  assert.equal(res1.parsedReviews[0].verified, true);

  // Amazon Reviews Exporter
  const exporterCsv = `title,body,rating,date,reviewer
"Not durable","Scroll wheel jumped backward and plastic feels very cheap.","2","2024-08-15","Alex"`;

  const res2 = sniffAndParseReviews(exporterCsv);
  assert.equal(res2.detectedColumns.bodyCol, 'body');
  assert.equal(res2.detectedColumns.ratingCol, 'rating');
  assert.equal(res2.parsedReviews[0].rating, 2.0);
  assert.equal(res2.parsedReviews[0].date, '2024-08-15');
});

test('jev scoring: detects hardware defect and switch failure accurately', async () => {
  const defectReview = {
    body: 'The left button developed a terrible double click defect after only 2 months of use. It makes dragging files impossible.',
    star_rating: 1,
    title: 'Double clicking switch',
  };

  const res = await scoreReview(defectReview);
  assert.equal(res.tone_score, -2);
  assert.equal(res.is_product_related, true);
  assert.equal(res.primary_reason, 'defect');
  assert.ok(res.tags.includes('switch_failure') || res.tags.includes('defect'));
});

test('jev scoring: detects quality decline and cheaper materials', () => {
  const qualityReview = {
    body: 'Logitech clearly cut corners on this new version. Cheaper plastic, flimsy feel, worse than my old M510.',
    star_rating: 2,
    title: 'Quality has gone down',
  };

  const res = scoreWithLocalHeuristics(qualityReview);
  assert.ok(res.tone_score <= -1);
  assert.equal(res.primary_reason, 'quality_decline');
  assert.ok(res.tags.includes('quality_decline'));
});

test('jev scoring: classifies shipping-only complaints as not product related', () => {
  const shippingReview = {
    body: 'Late delivery by two weeks. The outer box was crushed upon arrival.',
    star_rating: 1,
    title: 'Terrible delivery',
  };

  const res = scoreWithLocalHeuristics(shippingReview);
  assert.equal(res.is_product_related, false);
  assert.equal(res.primary_reason, 'other');
});

test('reviews db: initializes and seeds Logitech M510 reviews and SEC 10-Q financials', () => {
  const memDb = new DatabaseSync(':memory:');
  migrateReviews(memDb);
  const result = seedReviewsDatabase(memDb);

  assert.equal(result.seeded, true);
  assert.ok(result.counts.companies >= 3);
  assert.ok(result.counts.products >= 4);
  assert.ok(result.counts.financials >= 8);
  assert.ok(result.counts.reviews >= 20);

  // Calling seedReviewsDatabase again should be idempotent
  const second = seedReviewsDatabase(memDb);
  assert.equal(second.seeded, false);
});

test('quarterly aggregation: computes tone, baseline, delta tone, and flags negative swing', () => {
  const memDb = new DatabaseSync(':memory:');
  migrateReviews(memDb);
  seedReviewsDatabase(memDb);

  const summary = getProductDashboardSummary(memDb, 'B003NR57BY');
  assert.ok(summary);
  assert.equal(summary.company.ticker, 'LOGI');
  assert.equal(summary.product!.asin, 'B003NR57BY');
  assert.ok(summary.quarters.length >= 6);

  // Check FY27 Q2 where the Negative Swing inflection hits (-0.214 delta tone)
  const defectQuarter = summary.quarters.find((q) => q.quarter_label === 'FY27 Q2');
  assert.ok(defectQuarter);
  assert.ok(defectQuarter.delta_tone != null && defectQuarter.delta_tone < -0.15);
  assert.equal(defectQuarter.is_negative_swing, true);

  // Verify Reddit canary summary and dynamic lead time
  assert.ok(summary.canary_summary.reddit_post_count >= 2);
  assert.ok(summary.canary_summary.lead_time_days > 0);
});

test('reviews service: listReviews filters by platform, tone, and search query', () => {
  const memDb = new DatabaseSync(':memory:');
  migrateReviews(memDb);
  seedReviewsDatabase(memDb);

  // All reviews
  const all = listReviews(memDb, { asin: 'B003NR57BY' });
  assert.ok(all.total > 20);

  // Negative reviews only
  const neg = listReviews(memDb, { asin: 'B003NR57BY', tone: 'negative' });
  assert.ok(neg.reviews.every((r) => r.tone_score != null && r.tone_score <= -1));

  // Reddit only
  const reddit = listReviews(memDb, { asin: 'B003NR57BY', platform: 'reddit' });
  assert.ok(reddit.reviews.every((r) => r.platform === 'reddit'));

  // Search query
  const searched = listReviews(memDb, { asin: 'B003NR57BY', query: 'double click' });
  assert.ok(searched.reviews.length > 0);
  assert.ok(searched.reviews.every((r) => `${r.title} ${r.body}`.toLowerCase().includes('double click')));
});

test('canary adapters: map a real response to captured rows and never invent one', async () => {
  const redditBody = {
    data: {
      children: [
        { data: { id: 'abc123', title: 'Scroll wheel jumps backwards', selftext: 'Plastic feels cheaper than my old one.', created_utc: 1750000000, author: 'someone', permalink: '/r/Logitech/comments/abc123/x/' } },
        { data: { id: 'def456', title: 'No selftext', selftext: '', created_utc: 1750000001, author: 'other', permalink: '/r/Logitech/comments/def456/y/' } },
        { data: { title: 'no id', created_utc: 1750000002 } },
      ],
    },
  };

  const rows = await fetchRedditCanaries({ asin: 'B003NR57BY', ticker: 'LOGI', query: 'M510' }, fakeTransport(200, redditBody));
  assert.equal(rows.length, 2, 'rows without an id must be dropped, not defaulted');
  assert.equal(rows[0].review_id, 'reddit_abc123');
  assert.equal(rows[0].platform, 'reddit');
  assert.equal(rows[0].asin, 'B003NR57BY');
  assert.equal(rows[0].provenance, 'captured');
  assert.equal(rows[0].source_type, 'reddit_api');
  assert.equal(rows[0].body, 'Scroll wheel jumps backwards\n\nPlastic feels cheaper than my old one.');
  assert.equal(rows[1].body, 'No selftext');
});

test('canary adapters: an empty search result is empty, not a failure and not a fabrication', async () => {
  const rows = await fetchRedditCanaries({ asin: 'B003NR57BY', ticker: 'LOGI' }, fakeTransport(200, { data: { children: [] } }));
  assert.deepEqual(rows, []);
});

test('canary adapters: a block, an unreadable body and a missing key are reported, never filled in', async () => {
  await assert.rejects(
    () => fetchRedditCanaries({ asin: 'B003NR57BY', ticker: 'LOGI' }, fakeTransport(403, '')),
    (e: Error) => e instanceof CanaryUnavailableError && e.provider === 'reddit' && /403/.test(e.message),
  );
  await assert.rejects(
    () => fetchRedditCanaries({ asin: 'B003NR57BY', ticker: 'LOGI' }, fakeTransport(200, 'not json')),
    (e: Error) => e instanceof CanaryUnavailableError && e.provider === 'reddit',
  );
  await assert.rejects(
    () => fetchRedditCanaries({ asin: 'B003NR57BY', ticker: 'LOGI' }, fakeTransport(200, { unexpected: true })),
    (e: Error) => e instanceof CanaryUnavailableError && /unexpected response shape/.test(e.message),
  );

  const savedKey = process.env.BESTBUY_API_KEY;
  try {
    delete process.env.BESTBUY_API_KEY;
    await assert.rejects(
      () => fetchBestBuyReviews({ asin: 'B003NR57BY', ticker: 'LOGI', bestbuy_sku: '9226065' }, fakeTransport(200, { reviews: [] })),
      (e: Error) => e instanceof CanaryUnavailableError && e.provider === 'bestbuy' && /not connected/.test(e.message),
    );

    process.env.BESTBUY_API_KEY = 'test-key';
    const mapped = await fetchBestBuyReviews({ asin: 'B003NR57BY', ticker: 'LOGI', bestbuy_sku: '9226065' }, fakeTransport(200, {
      reviews: [{ id: 7, rating: 2, title: 'Double clicking', comment: 'Left button double clicks.', submissionTime: '2026-03-04T00:00:00', verifiedPurchase: true, reviewer: { name: 'A Customer' } }],
    }));
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].review_id, 'bestbuy_7');
    assert.equal(mapped[0].review_date, '2026-03-04');
    assert.equal(mapped[0].provenance, 'captured');
    assert.equal(mapped[0].author, 'A Customer');
  } finally {
    if (savedKey === undefined) delete process.env.BESTBUY_API_KEY;
    else process.env.BESTBUY_API_KEY = savedKey;
  }
});

test('canary route: a blocked provider writes nothing and returns the reason', async () => {
  const express = (await import('express')).default;
  const { registerReviewRoutes } = await import('./reviews/routes.ts');

  const store = openReviewsStore(':memory:');
  seedReviewsDatabase(store);
  const before = (store.prepare('SELECT COUNT(*) c FROM reviews_raw').get() as { c: number }).c;

  const app = express();
  app.use(express.json());
  registerReviewRoutes(app, store, { canary: fakeTransport(403, '') });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((ok) => server.once('listening', () => ok()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const res = await fetch(`${base}/api/reviews/fetch-canary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ asin: 'B003NR57BY', type: 'reddit' }),
    });
    assert.equal(res.status, 503, 'a blocked fetch must not answer 200');
    const body = await res.json() as { success: boolean; added: number; error: string };
    assert.equal(body.success, false);
    assert.equal(body.added, 0);
    assert.match(body.error, /403/);
    assert.equal(
      (store.prepare('SELECT COUNT(*) c FROM reviews_raw').get() as { c: number }).c,
      before,
      'a blocked fetch wrote rows',
    );
  } finally {
    server.closeAllConnections();
    server.close();
    closeReviewsStore(store);
  }
});

test('calendar & fiscal conversion: handles March and December fiscal year ends', () => {
  const q1 = dateToCalendarQuarter('2024-05-15');
  assert.equal(q1.key, '2024-Q2');
  assert.equal(q1.start, '2024-04-01');
  assert.equal(q1.end, '2024-06-30');

  // Logitech: fiscal year ends March 31 -> 2024-Q2 is FY25 Q1
  const logiLabel = calendarQuarterToFiscalLabel('2024-Q2', 3);
  assert.equal(logiLabel, 'FY25 Q1');

  // YETI / SharkNinja: fiscal year ends December 31 -> 2024-Q2 is FY24 Q2
  const yetiLabel = calendarQuarterToFiscalLabel('2024-Q2', 12);
  assert.equal(yetiLabel, 'FY24 Q2');
});

test('fiscal calendar: every year-end month is handled, not only March and December', () => {
  // NIKE: FY2024 ran 2023-06-01 → 2024-05-31, so April 2024 is in Q4 of FY24. The previous
  // implementation fell through to a default and answered "FY24 Q2".
  const nike = fiscalPeriodForCalendarQuarter('2024-Q2', 5);
  assert.deepEqual(
    { label: nike.label, start: nike.start, end: nike.end, q: nike.fiscal_quarter },
    { label: 'FY24 Q4', start: '2023-06-01', end: '2024-05-31', q: 4 },
  );

  // Helen of Troy: FY2025 ran 2024-03-01 → 2025-02-28, so April 2024 is Q1 of FY25.
  const hele = fiscalPeriodForCalendarQuarter('2024-Q2', 2);
  assert.deepEqual({ label: hele.label, start: hele.start, q: hele.fiscal_quarter }, { label: 'FY25 Q1', start: '2024-03-01', q: 1 });

  // A fiscal year boundary lands where it should for a March year end: 31 Mar is the last day of FY25.
  assert.equal(calendarQuarterToFiscalLabel('2025-Q1', 3), 'FY25 Q4');
  assert.equal(fiscalPeriodForCalendarQuarter('2026-Q2', 3).label, 'FY27 Q1');
});

test('fiscal calendar: a quarter that straddles a year end is counted once, by its first day', () => {
  // For NIKE, calendar 2024-Q2 (Apr–Jun) spans FY24 Q4 and FY25 Q1. It must land in exactly one.
  const period = fiscalPeriodForCalendarQuarter('2024-Q2', 5);
  assert.equal(period.label, 'FY24 Q4');
  assert.ok(period.start <= '2024-04-01' && period.end >= '2024-04-01');
});

test('fiscal calendar: periods are joined on dates, and an absent filing says so', () => {
  const quarter = dateToCalendarQuarter('2024-05-15'); // 2024-04-01 → 2024-06-30
  const filing = { period_start_date: '2024-04-01', period_end_date: '2024-06-30' };
  const other = { period_start_date: '2024-07-01', period_end_date: '2024-09-30' };
  assert.equal(matchPeriodByDate([other, filing], quarter), filing);
  assert.equal(matchPeriodByDate([other], quarter), null, 'a window with no filing must not match something else');
});

test('policy: the tone series is computed from plain rows — no database, no seed', () => {
  const row = (date: string, tone: number | null, platform = 'amazon', product = true, reason = 'other'): any => ({
    review_id: `${date}-${tone}-${platform}`, review_date: date, platform, tone_score: tone,
    is_product_related: product ? 1 : 0, primary_reason: reason, tags_json: JSON.stringify(reason === 'defect' ? ['defect'] : []),
  });

  const rows = [
    // Q1: two product reviews, mean 0
    row('2024-01-10', 1), row('2024-02-10', -1),
    // A seller-only complaint must not move listing tone...
    row('2024-02-11', -2, 'amazon', false, 'other'),
    // ...and a canary post is reported separately, not folded into it.
    row('2024-02-12', -2, 'reddit', true, 'defect'),
  ];

  const series = quarterToneSeries(rows, { fiscalYearEndMonth: 12, financials: [] });
  assert.equal(series.quarters.length, 1);
  const q = series.quarters[0];
  assert.equal(q.calendar_quarter, '2024-Q1');
  assert.equal(q.avg_tone, 0, 'seller-only and canary rows must not change listing tone');
  assert.equal(q.product_review_count, 2);
  assert.equal(q.seller_only_count, 1);
  assert.equal(q.avg_tone != null && q.baseline_tone == null, true, 'no baseline without four prior quarters');
  assert.equal(q.delta_tone, null);
  assert.equal(q.reddit_tone, -2, 'canary tone is reported per quarter');
  assert.equal(q.defect_count, 1);
  assert.equal(q.financial_match, 'no_filing', 'a quarter with no filing must say so, not look like a plain null');
  assert.deepEqual(series.topTags, [{ tag: 'defect', count: 1 }]);
  // Every negative row counts here, canary and seller-only included: this is the raw share, not listing tone.
  assert.equal(series.totalNegatives, 3);
});

test('policy: the baseline needs four prior quarters and the swing flag comes from one threshold', () => {
  const rows: any[] = [];
  const tones = [1, 1, 1, 1, -1]; // five quarters; only the fifth has a 4-quarter baseline
  tones.forEach((tone, i) => {
    const year = 2024 + Math.floor(i / 4);
    const month = String(((i % 4) * 3) + 2).padStart(2, '0');
    rows.push({ review_id: `r${i}`, review_date: `${year}-${month}-10`, platform: 'amazon', tone_score: tone, is_product_related: 1, primary_reason: 'other', tags_json: '[]' });
  });

  const { quarters } = quarterToneSeries(rows, { fiscalYearEndMonth: 12, financials: [] });
  assert.equal(quarters.length, 5);
  assert.equal(quarters[3].baseline_tone, null, 'the fourth quarter has only three priors, so there is no baseline yet');
  assert.equal(quarters[4].baseline_tone, 1, 'five quarters in, the rolling baseline switches on');
  assert.equal(quarters[4].delta_tone, -2);
  assert.equal(quarters[4].is_negative_swing, true);
  assert.equal(quarters[4].signal, 'negative_swing');
  assert.equal(currentStatus(quarters), 'negative_swing');
  assert.equal(canarySummary([], quarters).lead_time_days, 0);
});

test('edge cases: empty, invalid, and malformed inputs to sniffer and parser', () => {
  const emptyRes = sniffAndParseReviews('');
  assert.equal(emptyRes.totalRows, 0);
  assert.equal(emptyRes.confidence, 0);
  assert.equal(emptyRes.parsedReviews.length, 0);

  const spacesRes = sniffAndParseReviews('   \n  \r\n  ');
  assert.equal(spacesRes.totalRows, 0);

  // Ratings edge cases
  assert.equal(parseStarRating('0 out of 5'), null);
  assert.equal(parseStarRating('10 out of 5'), null);
  assert.equal(parseStarRating('-5'), null);
  assert.equal(parseStarRating('No rating available'), null);

  // Date edge cases
  assert.equal(parseReviewDate('Tomorrow morning'), null);
  assert.equal(parseReviewDate('Invalid string date xyz'), null);
});

test('edge cases: product with zero reviews does not crash summary aggregation and reports 0 lead time', () => {
  const memDb = new DatabaseSync(':memory:');
  migrateReviews(memDb);
  seedReviewsDatabase(memDb);

  // Insert a product with no reviews
  memDb.prepare(`
    INSERT INTO products (asin, ticker, title)
    VALUES ('B0_EMPTY_TEST', 'LOGI', 'Empty Test Product')
  `).run();

  const summary = getProductDashboardSummary(memDb, 'B0_EMPTY_TEST');
  assert.ok(summary);
  assert.equal(summary.total_reviews, 0);
  assert.equal(summary.negative_rate, 0);
  assert.equal(summary.quarters.length, 0);
  assert.equal(summary.current_status, 'neutral');
  assert.equal(summary.canary_summary.lead_time_days, 0);
});

test('edge cases: duplicate review insertions are idempotent', () => {
  const memDb = new DatabaseSync(':memory:');
  migrateReviews(memDb);
  seedReviewsDatabase(memDb);

  const initialCount = (memDb.prepare('SELECT COUNT(*) c FROM reviews_raw WHERE asin = ?').get('B003NR57BY') as { c: number }).c;
  const existingRow = memDb.prepare('SELECT review_id FROM reviews_raw WHERE asin = ? LIMIT 1').get('B003NR57BY') as { review_id: string };

  // Insert existing review again with INSERT OR REPLACE
  memDb.prepare(`
    INSERT OR REPLACE INTO reviews_raw (review_id, asin, ticker, platform, review_date, body)
    VALUES (?, 'B003NR57BY', 'LOGI', 'amazon', '2026-09-22', 'Updated body text')
  `).run(existingRow.review_id);

  const afterCount = (memDb.prepare('SELECT COUNT(*) c FROM reviews_raw WHERE asin = ?').get('B003NR57BY') as { c: number }).c;
  assert.equal(afterCount, initialCount);
});

// ── store lifecycle: opening, seeding and ownership ─────────────────────────────────────────────

test('reviews store: opening migrates the schema but never seeds, and the caller owns the handle', () => {
  const store = openReviewsStore(':memory:');
  try {
    const tables = store.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    const names = tables.map((t) => t.name);
    for (const expected of ['companies', 'products', 'reviews_raw', 'reviews_scored', 'company_financials', 'review_kv']) {
      assert.ok(names.includes(expected), `missing table ${expected}`);
    }
    assert.equal((store.prepare('SELECT COUNT(*) c FROM reviews_raw').get() as { c: number }).c, 0);
    assert.equal((store.prepare('SELECT COUNT(*) c FROM companies').get() as { c: number }).c, 0);
  } finally {
    closeReviewsStore(store);
    closeReviewsStore(store); // closing twice is safe (a signal handler may race a normal exit)
  }
});

test('reviews seed: replaces only rows it owns — captured reviews, scores and operator products survive', () => {
  const store = openReviewsStore(':memory:');
  try {
    seedReviewsDatabase(store);

    store.prepare("INSERT INTO products (asin, ticker, title) VALUES ('B0OPERATOR', 'LOGI', 'Operator added product')").run();
    store.prepare("INSERT INTO reviews_raw (review_id, asin, ticker, platform, review_date, body, provenance) VALUES ('captured_1', 'B003NR57BY', 'LOGI', 'amazon', '2026-01-05', 'Body', 'captured')").run();
    store.prepare("INSERT INTO reviews_scored (review_id, asin, ticker, tone_score) VALUES ('captured_1', 'B003NR57BY', 'LOGI', -2)").run();

    // A dataset version bump forces a full re-seed; captured evidence must be untouched.
    const again = seedReviewsDatabase(store, { force: true });
    assert.equal(again.seeded, true);
    assert.ok(again.counts.seed_reviews > 20);
    assert.equal(again.counts.captured_reviews, 1);
    assert.ok(store.prepare('SELECT 1 FROM products WHERE asin = ?').get('B0OPERATOR'), 'operator product was deleted');
    assert.ok(store.prepare('SELECT 1 FROM reviews_scored WHERE review_id = ?').get('captured_1'), 'captured score was deleted');
    assert.ok(store.prepare('SELECT 1 FROM reviews_raw WHERE review_id = ?').get('captured_1'), 'captured review was deleted');
  } finally {
    closeReviewsStore(store);
  }
});

test('reviews seed: no bundled row claims to be captured, and every row states its provenance', () => {
  const store = openReviewsStore(':memory:');
  try {
    seedReviewsDatabase(store);
    const rows = store.prepare('SELECT provenance, source_type FROM reviews_raw').all() as { provenance: string; source_type: string }[];
    assert.ok(rows.length > 20);
    assert.ok(rows.every((r) => r.provenance === 'seed'), 'a bundled row claims a non-seed provenance');
    assert.ok(rows.every((r) => r.source_type === 'seed'), 'a bundled row claims an intake route it never had');
  } finally {
    closeReviewsStore(store);
  }
});

test('reviews routes: the production path accepts an injected store and reports provenance honestly', async () => {
  const express = (await import('express')).default;
  const { registerReviewRoutes } = await import('./reviews/routes.ts');

  const store = openReviewsStore(':memory:');
  seedReviewsDatabase(store);
  store.prepare("INSERT INTO reviews_raw (review_id, asin, ticker, platform, review_date, body, provenance) VALUES ('captured_1', 'B003NR57BY', 'LOGI', 'amazon', '2026-01-05', 'Body', 'captured')").run();

  const app = express();
  app.use(express.json());
  registerReviewRoutes(app, store); // the handle is passed in; the module creates nothing
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((ok) => server.once('listening', () => ok()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const status = await (await fetch(`${base}/api/reviews/status`)).json() as {
      total_reviews: number; captured_reviews: number; seed_reviews: number;
    };
    assert.equal(status.captured_reviews, 1);
    assert.ok(status.seed_reviews > 20);
    assert.equal(status.total_reviews, status.captured_reviews + status.seed_reviews);

    const dashboard = await (await fetch(`${base}/api/reviews/dashboard?asin=B003NR57BY`)).json() as { total_reviews: number; company: { ticker: string } };
    assert.equal(dashboard.company.ticker, 'LOGI');
    assert.ok(dashboard.total_reviews > 20);
  } finally {
    server.closeAllConnections();
    server.close();
    closeReviewsStore(store);
  }
});

// ── the scoring chain ───────────────────────────────────────────────────────────────────────────

/** Answers a provider call with `body`, so the chain can be exercised without the network. */
const answering = (body: unknown, status = 200): typeof fetch =>
  (async () => ({ ok: status >= 200 && status < 300, status, statusText: '', json: async () => body })) as unknown as typeof fetch;

const failingFetch: typeof fetch = (async () => { throw new Error('connection refused'); }) as unknown as typeof fetch;

const oneReview = { body: 'The left button double clicks constantly', star_rating: 1, title: 'Double click defect' };

test('scoring chain: the first configured provider that answers wins, and the record says which', async () => {
  const { scoreReview } = await import('./reviews/jev.ts');

  const viaJev = await scoreReview(oneReview, {
    env: { TYPESAFE_API_KEY: 'k' },
    fetchImpl: answering({ choices: [{ message: { content: JSON.stringify({ tone_score: -2, is_product_related: true, primary_reason: 'defect', tags: ['double_click'] }) } }] }),
  });
  assert.equal(viaJev.model_used, 'typesafe-jev');
  assert.equal(viaJev.tone_score, -2);
  assert.equal(viaJev.primary_reason, 'defect');

  // The JEV key is the second env key for the same adapter, and outranks Gemini when both are set.
  const viaJevAlias = await scoreReview(oneReview, { env: { JEV_API_KEY: 'k', GEMINI_API_KEY: 'g' }, fetchImpl: answering({ choices: [{ message: { content: '{"tone_score":1}' } }] }) });
  assert.equal(viaJevAlias.model_used, 'typesafe-jev');

  const viaGemini = await scoreReview(oneReview, {
    env: { GEMINI_API_KEY: 'g' },
    fetchImpl: answering({ candidates: [{ content: { parts: [{ text: '{"tone_score":-1,"primary_reason":"quality_decline","tags":["build"]}' }] } }] }),
  });
  assert.equal(viaGemini.model_used, 'gemini-2.5-flash');
  assert.equal(viaGemini.tone_score, -1);

  const viaClaude = await scoreReview(oneReview, {
    env: { ANTHROPIC_API_KEY: 'a' },
    fetchImpl: answering({ content: [{ text: 'Sure! {"tone_score":2,"tags":["praise"]} hope that helps' }] }),
  });
  assert.equal(viaClaude.model_used, 'claude-3-5-haiku');
  assert.equal(viaClaude.tone_score, 2);
});

test('scoring chain: unreachable and failing providers are skipped, and the deterministic one always answers', async () => {
  const { scoreReview } = await import('./reviews/jev.ts');

  // No credentials at all: nothing is dialled, the offline scorer answers.
  const offline = await scoreReview(oneReview, { env: {}, fetchImpl: failingFetch });
  assert.equal(offline.model_used, 'local-heuristic');
  assert.equal(offline.tone_score, -2);
  assert.equal(offline.primary_reason, 'defect');

  // The first provider refuses every connection, so the next configured one answers.
  const fellThrough = await scoreReview(oneReview, {
    env: { TYPESAFE_API_KEY: 'k', ANTHROPIC_API_KEY: 'a' },
    fetchImpl: (async (url: string | URL | Request) => {
      if (String(url).includes('anthropic')) return { ok: true, status: 200, statusText: '', json: async () => ({ content: [{ text: '{"tone_score":2}' }] }) } as never;
      throw new Error('connection refused');
    }) as unknown as typeof fetch,
  });
  assert.equal(fellThrough.model_used, 'claude-3-5-haiku');

  // A provider that answers with nonsense falls through too, rather than storing a wrong score.
  const allBroken = await scoreReview(oneReview, { env: { GEMINI_API_KEY: 'g' }, fetchImpl: answering({ candidates: [] }) });
  assert.equal(allBroken.model_used, 'local-heuristic');

  // A clamp keeps a provider's out-of-range answer inside the rubric.
  const clamped = await scoreReview(oneReview, { env: { GEMINI_API_KEY: 'g' }, fetchImpl: answering({ candidates: [{ content: { parts: [{ text: '{"tone_score":-9}' }] } }] }) });
  assert.equal(clamped.tone_score, -2);
});

test('scoring chain: one documented latency bound stops the chain instead of stacking provider timeouts', async () => {
  const { scoreReview } = await import('./reviews/jev.ts');

  let clock = 0;
  // The first provider "takes" longer than the whole budget.
  const slow: typeof fetch = (async () => { clock += 5_000; throw new Error('timed out'); }) as unknown as typeof fetch;

  const score = await scoreReview(oneReview, {
    env: { TYPESAFE_API_KEY: 'k', GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' },
    fetchImpl: slow,
    budgetMs: 6_000,
    now: () => clock,
  });

  assert.equal(score.model_used, 'local-heuristic');
  assert.ok(clock <= 10_000, `the chain should stop after the budget, not after every provider (spent ${clock} ms)`);
});

test('scoring status: what the endpoint advertises is what the chain can actually reach', async () => {
  const { scorerReachability, SCORER_CHAIN } = await import('./reviews/jev.ts');

  // The report is the chain, in order, deriving readiness from the same keys the chain reads.
  const none = scorerReachability({});
  assert.deepEqual(none.map((s) => s.name), SCORER_CHAIN.map((s) => s.name));
  assert.deepEqual(none.filter((s) => s.ready).map((s) => s.name), ['local-heuristic']);

  const all = scorerReachability({ TYPESAFE_API_KEY: 'k', GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' });
  assert.ok(all.every((s) => s.ready), 'every provider is reachable once its key is set');

  const geminiOnly = scorerReachability({ GEMINI_API_KEY: 'g' });
  assert.deepEqual(geminiOnly.filter((s) => s.ready).map((s) => s.name), ['gemini-2.5-flash', 'local-heuristic']);
});

// ── the ingest invariant: a stored review always has exactly one score ───────────────────────────

const countRows = (db: DatabaseSync, sql: string, ...args: unknown[]) => (db.prepare(sql).get(...(args as never[])) as { c: number }).c;

const fixedScorer = async (): Promise<ScoreResult> => ({
  tone_score: -1, is_product_related: true, primary_reason: 'quality_decline', tags: ['quality_decline'], model_used: 'test',
});

test('ingest: a scorer that fails stores nothing — no raw row is left without its score', async () => {
  const { ingestReviews } = await import('./reviews/ingest.ts');
  const store = openReviewsStore(':memory:');
  try {
    seedReviewsDatabase(store);
    const failing = async (): Promise<ScoreResult> => { throw new Error('provider timed out'); };

    const report = await ingestReviews(store, { asin: 'B003NR57BY', ticker: 'LOGI' }, [
      { review_id: 'new_1', body: 'Left button double clicks after two months' },
    ], { scorer: failing });

    assert.equal(report.imported, 0);
    assert.equal(report.skipped, 1);
    assert.match(report.outcomes[0].error!, /provider timed out/);
    assert.equal(countRows(store, 'SELECT COUNT(*) c FROM reviews_raw WHERE review_id = ?', 'new_1'), 0, 'a raw row was written without a score');
    assert.equal(countRows(store, 'SELECT COUNT(*) c FROM reviews_scored WHERE review_id = ?', 'new_1'), 0);
  } finally {
    closeReviewsStore(store);
  }
});

test('ingest: writes the raw row and its score together, and skips empty bodies with a reason', async () => {
  const { ingestReviews } = await import('./reviews/ingest.ts');
  const store = openReviewsStore(':memory:');
  try {
    seedReviewsDatabase(store);

    const report = await ingestReviews(store, { asin: 'B003NR57BY', ticker: 'LOGI' }, [
      { review_id: 'new_2', body: 'Cheaper plastic, flimsy feel', star_rating: 2, provenance: 'captured' },
      { review_id: 'new_3', body: '   ' },
    ], { scorer: fixedScorer });

    assert.equal(report.imported, 1);
    assert.equal(report.scored, 1);
    assert.equal(report.skipped, 1);
    assert.equal(report.outcomes.find((o) => o.review_id === null)?.error, 'empty body');

    assert.equal(countRows(store, 'SELECT COUNT(*) c FROM reviews_raw WHERE review_id = ?', 'new_2'), 1);
    assert.equal(countRows(store, 'SELECT COUNT(*) c FROM reviews_scored WHERE review_id = ?', 'new_2'), 1);
    assert.equal(countRows(store, "SELECT COUNT(*) c FROM reviews_raw WHERE provenance = 'captured'"), 1);

    // The whole store, seeded rows included, must have no unscored row at all.
    assert.equal(
      countRows(store, 'SELECT COUNT(*) c FROM reviews_raw r LEFT JOIN reviews_scored s ON s.review_id = r.review_id WHERE s.review_id IS NULL'),
      0,
      'the store contains a review with no score',
    );
  } finally {
    closeReviewsStore(store);
  }
});

test('ingest: a failed re-score leaves the previous score in place instead of erasing it', async () => {
  const { ingestReviews } = await import('./reviews/ingest.ts');
  const store = openReviewsStore(':memory:');
  try {
    seedReviewsDatabase(store);
    const target = store.prepare("SELECT review_id, asin, ticker FROM reviews_raw WHERE provenance = 'seed' LIMIT 1").get() as { review_id: string; asin: string; ticker: string };
    const before = store.prepare('SELECT tone_score, primary_reason FROM reviews_scored WHERE review_id = ?').get(target.review_id) as { tone_score: number; primary_reason: string };

    const failing = async (): Promise<ScoreResult> => { throw new Error('all providers failed'); };
    const report = await ingestReviews(store, { asin: target.asin, ticker: target.ticker }, [
      { review_id: target.review_id, body: 're-score attempt' },
    ], { scorer: failing });

    assert.equal(report.imported, 0);
    const after = store.prepare('SELECT tone_score, primary_reason FROM reviews_scored WHERE review_id = ?').get(target.review_id) as { tone_score: number; primary_reason: string };
    assert.deepEqual(after, before, 'a failed re-score erased the existing score');
  } finally {
    closeReviewsStore(store);
  }
});

test('import route: one interface stores raw+score pairs and reports what it skipped', async () => {
  const express = (await import('express')).default;
  const { registerReviewRoutes, REVIEWS_JSON_LIMIT } = await import('./reviews/routes.ts');

  const store = openReviewsStore(':memory:');
  seedReviewsDatabase(store);
  const app = express();
  app.use(express.json({ limit: REVIEWS_JSON_LIMIT }));
  registerReviewRoutes(app, store, { scorer: fixedScorer });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((ok) => server.once('listening', () => ok()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const res = await fetch(`${base}/api/reviews/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ asin: 'B003NR57BY', reviews: [
        { review_id: 'csv_1', body: 'Feels cheaper than my old one', rating: 2 },
        { review_id: 'csv_2', body: '' },
      ] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { imported: number; scored: number; skipped: number; failures: { error: string }[] };
    assert.deepEqual({ imported: body.imported, scored: body.scored, skipped: body.skipped }, { imported: 1, scored: 1, skipped: 1 });
    assert.equal(body.failures.length, 1);
    assert.equal(body.failures[0].error, 'empty body');

    // The list route searches text, not ids: look the imported row up by its body.
    const listed = await (await fetch(`${base}/api/reviews/list?asin=B003NR57BY&query=cheaper`)).json() as { total: number; reviews: { review_id: string; tone_score: number; provenance: string }[] };
    assert.ok(listed.total >= 1);
    assert.equal(listed.reviews[0].review_id, 'csv_1');
    assert.equal(listed.reviews[0].tone_score, -1);
    assert.equal(listed.reviews[0].provenance, 'captured');
  } finally {
    server.closeAllConnections();
    server.close();
    closeReviewsStore(store);
  }
});

// ── review fixes: bounded ingest, stable ids, list bounds, chain budget, collector identity ──────

test('ingest: scores with bounded concurrency and keeps rows already committed when a later chunk fails', async () => {
  const { ingestReviews } = await import('./reviews/ingest.ts');
  const store = openReviewsStore(':memory:');
  try {
    seedReviewsDatabase(store);
    let inFlight = 0;
    let peak = 0;
    let calls = 0;
    const scorer = async (): Promise<ScoreResult> => {
      calls++;
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return fixedScorer();
    };
    const inputs = Array.from({ length: 10 }, (_, i) => ({ review_id: `bulk_${i}`, body: `Review number ${i}` }));
    const report = await ingestReviews(store, { asin: 'B003NR57BY', ticker: 'LOGI' }, inputs, { scorer, concurrency: 3, commitEvery: 4 });
    assert.equal(report.imported, 10);
    assert.equal(calls, 10);
    assert.ok(peak <= 3, `at most 3 scoring calls in flight (saw ${peak})`);
    assert.ok(peak > 1, 'scoring is not serial');
    assert.equal(countRows(store, "SELECT COUNT(*) c FROM reviews_scored WHERE review_id LIKE 'bulk_%'"), 10);
  } finally {
    closeReviewsStore(store);
  }
});

test('ingest: a row without an id gets a content-derived id, so re-importing the same export does not duplicate it', async () => {
  const { ingestReviews } = await import('./reviews/ingest.ts');
  const store = openReviewsStore(':memory:');
  try {
    seedReviewsDatabase(store);
    const rows = [{ body: 'Scroll wheel squeaks', date: '2025-02-03', author: 'A' }, { body: 'Great battery', date: '2025-02-04', author: 'B' }];
    const before = countRows(store, 'SELECT COUNT(*) c FROM reviews_raw');
    await ingestReviews(store, { asin: 'B003NR57BY', ticker: 'LOGI' }, rows, { scorer: fixedScorer });
    await ingestReviews(store, { asin: 'B003NR57BY', ticker: 'LOGI' }, rows, { scorer: fixedScorer });
    assert.equal(countRows(store, 'SELECT COUNT(*) c FROM reviews_raw'), before + 2);
  } finally {
    closeReviewsStore(store);
  }
});

test('listReviews: an unreadable or negative limit is the default page, never "no limit"', () => {
  const store = openReviewsStore(':memory:');
  try {
    seedReviewsDatabase(store);
    assert.equal(listReviews(store, { asin: 'B003NR57BY', limit: -1 }).reviews.length, 50);
    assert.equal(listReviews(store, { asin: 'B003NR57BY', limit: Number.NaN }).reviews.length, 50);
    assert.equal(listReviews(store, { asin: 'B003NR57BY', limit: 5000 }).reviews.length <= 200, true);
    assert.equal(listReviews(store, { asin: 'B003NR57BY', limit: 5, offset: -3 }).reviews.length, 5);
  } finally {
    closeReviewsStore(store);
  }
});

test('scoring chain: each provider call is given only the budget that remains', async () => {
  const timeouts: number[] = [];
  let clock = 0;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    // AbortSignal.timeout does not expose its delay, so the adapter's timeout is recorded via the clock.
    void init;
    clock += 4_000;
    timeouts.push(clock);
    throw new Error('timed out');
  }) as unknown as typeof fetch;
  const score = await scoreReview(oneReview, {
    env: { TYPESAFE_API_KEY: 'k', GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' },
    fetchImpl,
    budgetMs: 6_000,
    now: () => clock,
  });
  assert.equal(score.model_used, 'local-heuristic');
  assert.equal(timeouts.length, 2, 'the third provider is not attempted once the budget is spent');
});

test('Best Buy collector: a review without an id is dropped rather than collapsed onto one row', async () => {
  const savedKey = process.env.BESTBUY_API_KEY;
  process.env.BESTBUY_API_KEY = 'test-key';
  try {
    const mapped = await fetchBestBuyReviews({ asin: 'B003NR57BY', ticker: 'LOGI', bestbuy_sku: '9226065' }, fakeTransport(200, {
      reviews: [
        { id: 11, comment: 'Clicks twice', rating: 2, submissionTime: '2025-01-02' },
        { comment: 'No id here', rating: 1, submissionTime: '2025-01-03' },
        { id: '', comment: 'Empty id', rating: 1, submissionTime: '2025-01-03' },
      ],
    }));
    assert.deepEqual(mapped.map((r) => r.review_id), ['bestbuy_11']);
  } finally {
    if (savedKey === undefined) delete process.env.BESTBUY_API_KEY;
    else process.env.BESTBUY_API_KEY = savedKey;
  }
});
