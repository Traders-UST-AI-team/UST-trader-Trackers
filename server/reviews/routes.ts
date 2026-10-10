import type { Express, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { listReviews } from './service.ts';
import { sniffAndParseReviews } from './sniffer.ts';
import { DEFAULT_CHAIN_BUDGET_MS, scoreReview, scorerReachability } from './jev.ts';
import { ingestReviews, type Scorer } from './ingest.ts';
import { fetchBestBuyReviews, fetchRedditCanaries, searchBestBuyProducts, CanaryUnavailableError, type CanaryDeps } from './adapters.ts';
import { getDashboardSummary, toCompany, toProduct } from './service.ts';
import { addCompany, collectProduct, connectorStatus, listRuns, setProductActive, syncFinancials, updateCompany, upsertProduct, watchlist, WatchlistError, type TrackerDeps } from './tracker.ts';
import { lookupCompany } from './edgar.ts';
import type { ReviewRaw, ReviewStatusResponse } from '../../shared/review-types.ts';

/**
 * Body limit for the CSV endpoints. A real Amazon export runs to megabytes, and express's 100 kb
 * default rejects it before the handler runs, so the route's own try/catch never sees the error
 * and the operator gets an unexplained failure. Boot code passes this to `express.json`.
 */
export const REVIEWS_JSON_LIMIT = '8mb';
/** The only endpoints that accept a whole CSV export; every other route keeps express's default. */
export const REVIEWS_LARGE_BODY_PATHS = ['/api/reviews/sniff', '/api/reviews/import'];

/** Dependencies the routes accept rather than create, so tests can supply fakes. */
export interface ReviewRouteDeps {
  /** Transport for the canary providers. Production leaves it unset and reaches the network. */
  canary?: CanaryDeps;
  /** Scorer used by every write path. Production leaves it unset and uses the provider chain. */
  scorer?: Scorer;
  /** Collectors, EDGAR and environment for the watchlist routes; tests supply fakes. */
  tracker?: TrackerDeps;
}

/** Sends a watchlist rule violation with its own status, anything else as a 500. */
function fail(res: Response, err: unknown) {
  if (err instanceof WatchlistError) return res.status(err.status).json({ error: err.message });
  res.status(500).json({ error: (err as Error).message });
}

const intParam = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/**
 * `store` is accepted, not created: the caller owns the connection and its lifetime, so tests can
 * point it at their own database and boot code decides whether the bundled dataset is loaded.
 */
export function registerReviewRoutes(app: Express, store: DatabaseSync, deps: ReviewRouteDeps = {}): void {
  const db = store;
  const scorer = deps.scorer ?? scoreReview;
  const trackerDeps: TrackerDeps = { ...deps.tracker, scorer, canary: deps.canary ?? deps.tracker?.canary };
  const lookups = new Map<string, { at: number; value: Awaited<ReturnType<typeof lookupCompany>> }>();

  // ── watchlist ─────────────────────────────────────────────────────────────────────────────────

  app.get('/api/reviews/watchlist', (_req: Request, res: Response) => {
    try {
      res.json(watchlist(db));
    } catch (err) {
      fail(res, err);
    }
  });

  app.get('/api/reviews/connectors', (_req: Request, res: Response) => {
    res.json(connectorStatus(trackerDeps.env));
  });

  // A preview of what adding a ticker will store; cached so typing does not hammer EDGAR.
  app.get('/api/reviews/lookup', async (req: Request, res: Response) => {
    const ticker = String(req.query.ticker ?? '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) return res.status(400).json({ error: 'A ticker is required.' });
    const cached = lookups.get(ticker);
    if (cached && Date.now() - cached.at < 6 * 3_600_000) return res.json({ found: cached.value });
    try {
      const value = await lookupCompany(ticker, trackerDeps.edgar);
      lookups.set(ticker, { at: Date.now(), value });
      res.json({ found: value });
    } catch (err) {
      res.status(503).json({ error: `SEC EDGAR could not be reached: ${(err as Error).message}` });
    }
  });

  app.post('/api/reviews/companies', async (req: Request, res: Response) => {
    try {
      const company = await addCompany(db, req.body ?? {}, trackerDeps);
      // The first read of its filings happens now, so the new row is useful immediately.
      const financials = company.financials_synced_at ? null : await syncFinancials(db, company, { ...trackerDeps, trigger: 'manual' });
      res.status(201).json({ company: toCompany(db.prepare('SELECT * FROM companies WHERE ticker = ?').get(company.ticker) as any), financials });
    } catch (err) {
      fail(res, err);
    }
  });

  app.patch('/api/reviews/companies/:ticker', (req: Request, res: Response) => {
    try {
      res.json(updateCompany(db, String(req.params.ticker).toUpperCase(), req.body ?? {}));
    } catch (err) {
      fail(res, err);
    }
  });

  app.post('/api/reviews/companies/:ticker/financials', async (req: Request, res: Response) => {
    try {
      const row = db.prepare('SELECT * FROM companies WHERE ticker = ?').get(String(req.params.ticker).toUpperCase()) as any;
      if (!row) return res.status(404).json({ error: 'Not on the watchlist.' });
      res.json(await syncFinancials(db, toCompany(row), { ...trackerDeps, trigger: 'manual' }));
    } catch (err) {
      fail(res, err);
    }
  });

  app.patch('/api/reviews/products/:asin', (req: Request, res: Response) => {
    try {
      if (typeof req.body?.is_active !== 'boolean') return res.status(400).json({ error: 'is_active (boolean) is required.' });
      res.json(setProductActive(db, String(req.params.asin).toUpperCase(), req.body.is_active));
    } catch (err) {
      fail(res, err);
    }
  });

  // Collect now: one listing, or every active listing of a company.
  app.post('/api/reviews/collect', async (req: Request, res: Response) => {
    try {
      const { asin, ticker } = req.body ?? {};
      const rows = asin
        ? db.prepare('SELECT * FROM products WHERE asin = ?').all(String(asin))
        : db.prepare('SELECT * FROM products WHERE ticker = ? AND is_active = 1').all(String(ticker ?? ''));
      if (rows.length === 0) return res.status(404).json({ error: 'No active listing to collect.' });
      const runs = [];
      for (const row of rows) runs.push(...(await collectProduct(db, toProduct(row as any), { ...trackerDeps, trigger: 'manual' })));
      res.json({ runs });
    } catch (err) {
      fail(res, err);
    }
  });

  // Best Buy catalogue search, to find a listing's SKU. A POST, so it needs the team code: every
  // search spends the team's API quota.
  app.post('/api/reviews/bestbuy/search', async (req: Request, res: Response) => {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim().slice(0, 120) : '';
    if (!query) return res.status(400).json({ error: 'A search query is required.' });
    try {
      res.json(await searchBestBuyProducts(query, deps.canary ?? deps.tracker?.canary));
    } catch (err) {
      if (err instanceof CanaryUnavailableError) return res.status(503).json({ error: err.message });
      fail(res, err);
    }
  });

  app.get('/api/reviews/runs', (req: Request, res: Response) => {
    res.json(listRuns(db, {
      ticker: typeof req.query.ticker === 'string' ? req.query.ticker : undefined,
      asin: typeof req.query.asin === 'string' ? req.query.asin : undefined,
      limit: intParam(req.query.limit),
    }));
  });

  // 1. Companies list
  app.get('/api/reviews/companies', (_req: Request, res: Response) => {
    try {
      const rows = db.prepare('SELECT * FROM companies ORDER BY ticker ASC').all();
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 2. Products list
  app.get('/api/reviews/products', (req: Request, res: Response) => {
    try {
      const ticker = req.query.ticker as string | undefined;
      const sql = ticker
        ? 'SELECT * FROM products WHERE ticker = ? ORDER BY is_active DESC, asin ASC'
        : 'SELECT * FROM products ORDER BY is_active DESC, asin ASC';
      const rows = ticker ? db.prepare(sql).all(ticker) : db.prepare(sql).all();
      res.json(rows.map((r) => toProduct(r as any)));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 3. Add or update a listing (the company must be on the watchlist)
  app.post('/api/reviews/products', (req: Request, res: Response) => {
    try {
      res.status(201).json(upsertProduct(db, req.body ?? {}));
    } catch (err) {
      fail(res, err);
    }
  });

  // 4. Dashboard summary: one listing (asin) or a whole company (ticker)
  app.get('/api/reviews/dashboard', (req: Request, res: Response) => {
    try {
      const asin = typeof req.query.asin === 'string' && req.query.asin ? req.query.asin : undefined;
      let ticker = typeof req.query.ticker === 'string' && req.query.ticker ? req.query.ticker.toUpperCase() : undefined;
      if (!asin && !ticker) {
        const first = db.prepare('SELECT ticker FROM companies WHERE is_active = 1 ORDER BY ticker LIMIT 1').get() as { ticker: string } | undefined;
        if (!first) return res.status(404).json({ error: 'The watchlist is empty. Add a company first.' });
        ticker = first.ticker;
      }
      const summary = getDashboardSummary(db, { asin, ticker });
      if (!summary) return res.status(404).json({ error: asin ? `No product ${asin}.` : `${ticker} is not on the watchlist.` });
      res.json(summary);
    } catch (err) {
      fail(res, err);
    }
  });

  // 5. Paginated and filtered reviews list
  app.get('/api/reviews/list', (req: Request, res: Response) => {
    try {
      const asin = req.query.asin as string | undefined;
      const ticker = typeof req.query.ticker === 'string' ? req.query.ticker.toUpperCase() : undefined;
      const platform = req.query.platform as string | undefined;
      const tone = req.query.tone as string | undefined;
      const reason = req.query.reason as string | undefined;
      const verified_only = req.query.verified_only === '1' || req.query.verified_only === 'true';
      const query = req.query.query as string | undefined;
      // listReviews bounds both: an unreadable or negative value becomes the default.
      const limit = intParam(req.query.limit);
      const offset = intParam(req.query.offset);

      const result = listReviews(db, {
        asin,
        ticker,
        platform,
        tone,
        reason,
        verified_only,
        query,
        limit,
        offset,
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 6. CSV Column Sniffer preview
  app.post('/api/reviews/sniff', (req: Request, res: Response) => {
    try {
      const csv = typeof req.body.csv === 'string' ? req.body.csv : '';
      if (!csv) {
        return res.status(400).json({ error: 'Missing CSV content in request body' });
      }

      const sniffResult = sniffAndParseReviews(csv);
      res.json(sniffResult);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 7. Import reviews (with automatic scoring)
  app.post('/api/reviews/import', async (req: Request, res: Response) => {
    try {
      const { asin, reviews } = req.body;
      if (!asin || !Array.isArray(reviews) || reviews.length === 0) {
        return res.status(400).json({ error: 'asin and non-empty reviews array are required' });
      }

      const prod = db.prepare('SELECT ticker FROM products WHERE asin = ?').get(asin) as { ticker: string } | undefined;
      if (!prod) {
        return res.status(404).json({ error: `ASIN ${asin} does not exist in products` });
      }

      // Rows arrive from a CSV the operator chose to import: captured, not seeded.
      const report = await ingestReviews(db, { asin, ticker: prod.ticker }, reviews, { scorer });
      res.json({
        success: true,
        imported: report.imported,
        scored: report.scored,
        skipped: report.skipped,
        failures: report.outcomes.filter((o) => !o.stored).map((o) => ({ review_id: o.review_id, error: o.error })),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 8. Re-score a single review or arbitrary text
  app.post('/api/reviews/score-single', async (req: Request, res: Response) => {
    try {
      const { review_id, body, star_rating, title } = req.body;

      if (review_id) {
        const row = db.prepare('SELECT * FROM reviews_raw WHERE review_id = ?').get(review_id) as any;
        if (!row) return res.status(404).json({ error: 'Review not found' });

        // Re-scored through the same path as every other write: the raw row and its score are
        // rewritten together, so a provider failure leaves the previous pair intact.
        const report = await ingestReviews(db, { asin: row.asin, ticker: row.ticker }, [{
          review_id: row.review_id,
          platform: row.platform,
          review_date: row.review_date,
          star_rating: row.star_rating,
          title: row.title,
          body: row.body,
          author: row.author,
          verified_purchase: Boolean(row.verified_purchase),
          source_type: row.source_type,
          source_url: row.source_url,
          provenance: row.provenance ?? 'captured',
        }], { scorer });

        const outcome = report.outcomes[0];
        if (!outcome?.stored) return res.status(502).json({ success: false, review_id, error: outcome?.error ?? 'scoring failed' });
        return res.json({ success: true, review_id, score: outcome.score });
      }

      if (body) {
        const score = await scorer({ body, star_rating, title });
        return res.json({ success: true, score });
      }

      res.status(400).json({ error: 'review_id or body is required' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 9. Fetch canary reviews (Reddit or Best Buy)
  app.post('/api/reviews/fetch-canary', async (req: Request, res: Response) => {
    try {
      const { asin, type } = req.body;
      if (!asin) return res.status(400).json({ error: 'asin is required' });

      const prod = db.prepare('SELECT * FROM products WHERE asin = ?').get(asin) as any;
      if (!prod) return res.status(404).json({ error: 'Product not found' });

      let reviews: ReviewRaw[];
      try {
        reviews = type === 'bestbuy'
          ? await fetchBestBuyReviews({ asin: prod.asin, ticker: prod.ticker, bestbuy_sku: prod.bestbuy_sku }, deps.canary)
          : await fetchRedditCanaries({ asin: prod.asin, ticker: prod.ticker, query: prod.reddit_query || prod.title }, deps.canary);
      } catch (e) {
        if (e instanceof CanaryUnavailableError) {
          // Nothing is written. A provider we could not reach must not become rows on screen, and
          // the reason travels to the caller instead of being swallowed into a log line.
          return res.status(503).json({ success: false, added: 0, provider: e.provider, error: e.message });
        }
        throw e;
      }

      const report = await ingestReviews(db, { asin: prod.asin, ticker: prod.ticker }, reviews, { scorer });
      res.json({
        success: true,
        added: report.imported,
        skipped: report.skipped,
        failures: report.outcomes.filter((o) => !o.stored).map((o) => ({ review_id: o.review_id, error: o.error })),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 10. Financials
  app.get('/api/reviews/financials', (req: Request, res: Response) => {
    try {
      const ticker = req.query.ticker as string | undefined;
      const sql = ticker
        ? 'SELECT * FROM company_financials WHERE ticker = ? ORDER BY period_end_date ASC'
        : 'SELECT * FROM company_financials ORDER BY ticker ASC, period_end_date ASC';
      const rows = ticker ? db.prepare(sql).all(ticker) : db.prepare(sql).all();
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 11. System Status
  app.get('/api/reviews/status', (_req: Request, res: Response) => {
    try {
      const rawCount = (db.prepare('SELECT COUNT(*) c FROM reviews_raw').get() as { c: number }).c;
      const scoredCount = (db.prepare('SELECT COUNT(*) c FROM reviews_scored').get() as { c: number }).c;
      const capturedCount = (db.prepare("SELECT COUNT(*) c FROM reviews_raw WHERE provenance = 'captured'").get() as { c: number }).c;
      const seedCount = (db.prepare("SELECT COUNT(*) c FROM reviews_raw WHERE provenance = 'seed'").get() as { c: number }).c;

      // Reported from the chain that actually runs, not from a second hand-written ladder.
      const scorers = scorerReachability();
      const engineMode = scorers.find((s) => s.ready)?.name ?? 'none';

      const status: ReviewStatusResponse = {
        db_path: 'data/reviews.sqlite',
        total_reviews: rawCount,
        total_scored: scoredCount,
        captured_reviews: capturedCount,
        seed_reviews: seedCount,
        scorers,
        engine_mode: engineMode,
        budget_ms: DEFAULT_CHAIN_BUDGET_MS,
      };

      res.json(status);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}
