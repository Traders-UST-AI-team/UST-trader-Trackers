import type { Express, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { getProductDashboardSummary, listReviews } from './service.ts';
import { sniffAndParseReviews } from './sniffer.ts';
import { DEFAULT_CHAIN_BUDGET_MS, scoreReview, scorerReachability } from './jev.ts';
import { ingestReviews, type Scorer } from './ingest.ts';
import { fetchBestBuyReviews, fetchRedditCanaries, CanaryUnavailableError, type CanaryDeps } from './adapters.ts';
import type { ReviewRaw, ReviewStatusResponse } from '../../shared/review-types.ts';

/**
 * Body limit for the CSV endpoints. A real Amazon export runs to megabytes, and express's 100 kb
 * default rejects it before the handler runs, so the route's own try/catch never sees the error
 * and the operator gets an unexplained failure. Boot code passes this to `express.json`.
 */
export const REVIEWS_JSON_LIMIT = '8mb';

/** Dependencies the routes accept rather than create, so tests can supply fakes. */
export interface ReviewRouteDeps {
  /** Transport for the canary providers. Production leaves it unset and reaches the network. */
  canary?: CanaryDeps;
  /** Scorer used by every write path. Production leaves it unset and uses the provider chain. */
  scorer?: Scorer;
}

/**
 * `store` is accepted, not created: the caller owns the connection and its lifetime, so tests can
 * point it at their own database and boot code decides whether the bundled dataset is loaded.
 */
export function registerReviewRoutes(app: Express, store: DatabaseSync, deps: ReviewRouteDeps = {}): void {
  const db = store;
  const scorer = deps.scorer ?? scoreReview;

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
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 3. Add or update product
  app.post('/api/reviews/products', (req: Request, res: Response) => {
    try {
      const { asin, ticker, title, category, amazon_url, bestbuy_sku, reddit_query } = req.body;
      if (!asin || !ticker || !title) {
        return res.status(400).json({ error: 'asin, ticker, and title are required' });
      }

      // Ensure company exists
      const company = db.prepare('SELECT 1 FROM companies WHERE ticker = ?').get(ticker);
      if (!company) {
        db.prepare('INSERT INTO companies (ticker, name) VALUES (?, ?)').run(ticker, ticker);
      }

      const stmt = db.prepare(`
        INSERT INTO products (asin, ticker, title, category, amazon_url, bestbuy_sku, reddit_query)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asin) DO UPDATE SET
          title = excluded.title,
          category = excluded.category,
          amazon_url = excluded.amazon_url,
          bestbuy_sku = excluded.bestbuy_sku,
          reddit_query = excluded.reddit_query
      `);
      stmt.run(
        asin,
        ticker,
        title,
        category || null,
        amazon_url || `https://www.amazon.com/dp/${asin}`,
        bestbuy_sku || null,
        reddit_query || title.slice(0, 20)
      );

      res.status(201).json({ success: true, asin });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 4. Dashboard summary
  app.get('/api/reviews/dashboard', (req: Request, res: Response) => {
    try {
      let asin = req.query.asin as string | undefined;
      if (!asin) {
        // default to first product
        const first = db.prepare('SELECT asin FROM products WHERE is_active = 1 LIMIT 1').get() as { asin: string } | undefined;
        asin = first?.asin ?? 'B003NR57BY';
      }

      const summary = getProductDashboardSummary(db, asin);
      if (!summary) {
        return res.status(404).json({ error: `Product with ASIN ${asin} not found` });
      }

      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 5. Paginated and filtered reviews list
  app.get('/api/reviews/list', (req: Request, res: Response) => {
    try {
      const asin = req.query.asin as string | undefined;
      const platform = req.query.platform as string | undefined;
      const tone = req.query.tone as string | undefined;
      const reason = req.query.reason as string | undefined;
      const verified_only = req.query.verified_only === '1' || req.query.verified_only === 'true';
      const query = req.query.query as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      const result = listReviews(db, {
        asin,
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
