/**
 * The living tracker: a watchlist the team edits, kept up to date on a schedule.
 *
 *   watchlist  companies (ticker → EDGAR profile) and the Amazon listings that stand for them
 *   collect    newest reviews per listing from each configured connector, scored once, appended
 *   financials quarterly revenue from EDGAR, so every swing is tested against what was reported
 *   runs       every attempt is logged, including "not connected" and failures
 *
 * Collection is incremental and cheap: a review already stored is never re-scored, so a scheduled
 * run only pays the scorer for reviews it has not seen.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { ChannelExposure, CollectionRun, CollectionStatus, Company, ConnectorStatus, Product, ReviewRaw, WatchlistRow } from '../../shared/review-types.ts';
import { CanaryUnavailableError, fetchBestBuyReviews, type CanaryDeps } from './adapters.ts';
import { amazonProvider, fetchAmazonReviews, type AmazonDeps } from './amazon.ts';
import { fetchReportedQuarters, lookupCompany, type EdgarDeps } from './edgar.ts';
import { ingestReviews, type Scorer } from './ingest.ts';
import { runInTransaction } from './db.ts';
import { getDashboardSummary, toCompany, toProduct } from './service.ts';
import { scorerReachability } from './jev.ts';

type Row = Record<string, any>;

export interface TrackerDeps {
  scorer?: Scorer;
  amazon?: AmazonDeps;
  canary?: CanaryDeps;
  edgar?: EdgarDeps;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

/** Reviews read per listing per run. Newest first, so a daily run sees everything new. */
export const MAX_REVIEWS_PER_RUN = 50;
/** EDGAR is re-read this often per company; filings arrive quarterly. */
export const FINANCIALS_REFRESH_HOURS = 24;

const iso = (d: Date) => d.toISOString();

// ── connectors ───────────────────────────────────────────────────────────────────────────────────

export function connectorStatus(env: Record<string, string | undefined> = process.env): ConnectorStatus[] {
  const provider = amazonProvider(env);
  const scorer = scorerReachability(env).find((s) => s.ready)?.name ?? 'none';
  return [
    {
      id: 'amazon', label: 'Amazon reviews', ready: provider !== null, scheduled: true,
      detail: provider === 'rainforest' ? 'Rainforest API (newest reviews per ASIN)'
        : provider === 'apify' ? `Apify actor ${env.APIFY_AMAZON_REVIEWS_ACTOR}`
        : 'Not connected. Set RAINFOREST_API_KEY, or APIFY_TOKEN + APIFY_AMAZON_REVIEWS_ACTOR. CSV import works meanwhile.',
    },
    {
      id: 'bestbuy', label: 'Best Buy reviews', ready: Boolean(env.BESTBUY_API_KEY), scheduled: true,
      detail: env.BESTBUY_API_KEY ? 'Best Buy developer API (products with a SKU)' : 'Not connected. Set BESTBUY_API_KEY.',
    },
    {
      id: 'reddit', label: 'Reddit (early canary)', ready: false, scheduled: false,
      detail: 'Reddit refuses scripted requests from this project (HTTP 403); available on request only, and not evaded.',
    },
    {
      id: 'edgar', label: 'SEC EDGAR financials', ready: true, scheduled: true,
      detail: `Quarterly revenue, operating income and gross margin from XBRL, refreshed every ${FINANCIALS_REFRESH_HOURS} h.`,
    },
    {
      id: 'csv', label: 'CSV import', ready: true, scheduled: false,
      detail: `Any review export (browser extensions, Helium 10, Jungle Scout…). Scored with ${scorer}.`,
    },
  ];
}

// ── run log ──────────────────────────────────────────────────────────────────────────────────────

function startRun(db: DatabaseSync, run: { ticker: string; asin: string | null; connector: string; trigger: 'schedule' | 'manual' }, now: Date): number {
  const r = db.prepare(`INSERT INTO collection_runs (ticker, asin, connector, trigger, started_at, status) VALUES (?, ?, ?, ?, ?, 'running')`)
    .run(run.ticker, run.asin, run.connector, run.trigger, iso(now));
  return Number(r.lastInsertRowid);
}

function finishRun(db: DatabaseSync, id: number, result: { status: CollectionStatus; fetched?: number; stored?: number; skipped?: number; message?: string | null }, now: Date) {
  db.prepare('UPDATE collection_runs SET finished_at = ?, status = ?, fetched = ?, stored = ?, skipped = ?, message = ? WHERE id = ?')
    .run(iso(now), result.status, result.fetched ?? 0, result.stored ?? 0, result.skipped ?? 0, result.message ?? null, id);
}

const toRun = (r: Row): CollectionRun => ({
  id: r.id, ticker: r.ticker, asin: r.asin, connector: r.connector, trigger: r.trigger, started_at: r.started_at,
  finished_at: r.finished_at, status: r.status, fetched: r.fetched, stored: r.stored, skipped: r.skipped, message: r.message,
});

export function listRuns(db: DatabaseSync, filter: { ticker?: string; asin?: string; limit?: number } = {}): CollectionRun[] {
  const where: string[] = [];
  const args: string[] = [];
  if (filter.ticker) { where.push('ticker = ?'); args.push(filter.ticker); }
  if (filter.asin) { where.push('asin = ?'); args.push(filter.asin); }
  const limit = Number.isInteger(filter.limit) && filter.limit! > 0 ? Math.min(filter.limit!, 200) : 30;
  const rows = db.prepare(`SELECT * FROM collection_runs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...args, limit) as Row[];
  return rows.map(toRun);
}

// ── collection ───────────────────────────────────────────────────────────────────────────────────

type Connector = 'amazon' | 'bestbuy';

/** Connectors that can run for this product right now. */
export function connectorsFor(product: Product, env: Record<string, string | undefined> = process.env): Connector[] {
  const out: Connector[] = [];
  if (amazonProvider(env)) out.push('amazon');
  if (env.BESTBUY_API_KEY && product.bestbuy_sku) out.push('bestbuy');
  return out;
}

async function fetchFrom(connector: Connector, product: Product, deps: TrackerDeps): Promise<ReviewRaw[]> {
  if (connector === 'amazon') {
    return fetchAmazonReviews({ asin: product.asin, ticker: product.ticker, domain: product.amazon_domain, max: MAX_REVIEWS_PER_RUN }, { env: deps.env, ...deps.amazon });
  }
  return fetchBestBuyReviews({ asin: product.asin, ticker: product.ticker, bestbuy_sku: product.bestbuy_sku ?? undefined }, deps.canary);
}

/**
 * Collects one product from every connector that can run. Reviews already stored are skipped
 * before scoring, so a run only pays for what is new. Every connector attempt is logged.
 */
export async function collectProduct(
  db: DatabaseSync,
  product: Product,
  opts: { trigger: 'schedule' | 'manual'; connectors?: Connector[] } & TrackerDeps,
): Promise<CollectionRun[]> {
  const now = opts.now ?? (() => new Date());
  const env = opts.env ?? process.env;
  const connectors = opts.connectors ?? connectorsFor(product, env);
  const runIds: number[] = [];

  if (connectors.length === 0) {
    const id = startRun(db, { ticker: product.ticker, asin: product.asin, connector: 'none', trigger: opts.trigger }, now());
    finishRun(db, id, { status: 'unavailable', message: 'No review connector is configured. Import a CSV, or connect Amazon / Best Buy.' }, now());
    runIds.push(id);
  }

  const known = db.prepare('SELECT 1 FROM reviews_raw WHERE review_id = ?');
  for (const connector of connectors) {
    const id = startRun(db, { ticker: product.ticker, asin: product.asin, connector, trigger: opts.trigger }, now());
    runIds.push(id);
    try {
      const fetched = await fetchFrom(connector, product, opts);
      const fresh = fetched.filter((r) => !known.get(r.review_id));
      const report = await ingestReviews(db, { asin: product.asin, ticker: product.ticker }, fresh, { scorer: opts.scorer });
      finishRun(db, id, {
        status: fetched.length === 0 ? 'empty' : 'ok',
        fetched: fetched.length,
        stored: report.imported,
        skipped: report.skipped,
        message: fetched.length === 0 ? 'The provider answered with no reviews.'
          : `${fresh.length} new of ${fetched.length} read${report.skipped ? `; ${report.skipped} could not be scored` : ''}.`,
      }, now());
    } catch (e) {
      const unavailable = e instanceof CanaryUnavailableError;
      finishRun(db, id, { status: unavailable ? 'unavailable' : 'error', message: (e as Error).message }, now());
    }
  }

  db.prepare('UPDATE products SET last_collected_at = ? WHERE asin = ?').run(iso(now()), product.asin);
  const placeholders = runIds.map(() => '?').join(',');
  return (db.prepare(`SELECT * FROM collection_runs WHERE id IN (${placeholders}) ORDER BY id`).all(...runIds) as Row[]).map(toRun);
}

// ── financials ───────────────────────────────────────────────────────────────────────────────────

/**
 * Reads a company's reported quarters from EDGAR and stores them. On success the bundled demo
 * figures for that company are replaced; on failure nothing already stored is touched.
 */
export async function syncFinancials(db: DatabaseSync, company: Company, opts: { trigger: 'schedule' | 'manual' } & TrackerDeps): Promise<CollectionRun> {
  const now = opts.now ?? (() => new Date());
  const id = startRun(db, { ticker: company.ticker, asin: null, connector: 'edgar', trigger: opts.trigger }, now());
  const setStatus = db.prepare('UPDATE companies SET financials_synced_at = ?, financials_status = ? WHERE ticker = ?');
  try {
    if (!company.cik) throw new CanaryUnavailableError('edgar', 'no CIK on record for this company');
    const quarters = await fetchReportedQuarters({ ticker: company.ticker, cik: company.cik, fiscal_year_end_month: company.fiscal_year_end_month }, opts.edgar);
    if (quarters.length === 0) throw new CanaryUnavailableError('edgar', 'EDGAR has no quarterly revenue in XBRL for this company');
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO company_financials (id, ticker, fiscal_year, fiscal_quarter, fiscal_label, period_start_date, period_end_date, sec_report_date, revenue_usd, revenue_yoy_growth, operating_income_usd, gross_margin, accession_number, official_excerpt, source_filing_url, provenance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'edgar')
    `);
    runInTransaction(db, () => {
      db.prepare("DELETE FROM company_financials WHERE ticker = ? AND provenance = 'seed'").run(company.ticker);
      for (const q of quarters) {
        upsert.run(q.id, company.ticker, q.fiscal_year, q.fiscal_quarter, q.fiscal_label, q.period_start_date, q.period_end_date, q.sec_report_date,
          q.revenue_usd, q.revenue_yoy_growth, q.operating_income_usd, q.gross_margin, q.accession_number, q.official_excerpt, q.source_filing_url);
      }
    });
    const latest = quarters.at(-1)!;
    const message = `${quarters.length} quarters; latest ${latest.fiscal_label} (filed ${latest.sec_report_date}).`;
    finishRun(db, id, { status: 'ok', fetched: quarters.length, stored: quarters.length, message }, now());
    setStatus.run(iso(now()), 'ok', company.ticker);
  } catch (e) {
    finishRun(db, id, { status: e instanceof CanaryUnavailableError ? 'unavailable' : 'error', message: (e as Error).message }, now());
    setStatus.run(iso(now()), `failed: ${(e as Error).message}`, company.ticker);
  }
  return toRun(db.prepare('SELECT * FROM collection_runs WHERE id = ?').get(id) as Row);
}

// ── watchlist edits ──────────────────────────────────────────────────────────────────────────────

export class WatchlistError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

const EXPOSURES: ChannelExposure[] = ['high', 'medium', 'low'];
const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const ASIN = /^[A-Z0-9]{10}$/;

/**
 * Adds a company to the watchlist. Name, CIK and fiscal year end come from EDGAR when the ticker is
 * found there; a company EDGAR does not know (a foreign listing) can be added with them stated.
 */
export async function addCompany(
  db: DatabaseSync,
  input: { ticker?: unknown; name?: unknown; fiscal_year_end_month?: unknown; channel_exposure?: unknown; notes?: unknown; added_by?: unknown },
  deps: TrackerDeps = {},
): Promise<Company> {
  const ticker = typeof input.ticker === 'string' ? input.ticker.trim().toUpperCase() : '';
  if (!TICKER.test(ticker)) throw new WatchlistError(400, 'A ticker is required (letters, digits, "." or "-").');
  if (db.prepare('SELECT 1 FROM companies WHERE ticker = ?').get(ticker)) {
    db.prepare('UPDATE companies SET is_active = 1 WHERE ticker = ?').run(ticker);
    return toCompany(db.prepare('SELECT * FROM companies WHERE ticker = ?').get(ticker) as Row);
  }

  let found = null as Awaited<ReturnType<typeof lookupCompany>>;
  try {
    found = await lookupCompany(ticker, deps.edgar);
  } catch {
    found = null; // EDGAR unreachable: fall back to what the caller stated
  }
  const statedFye = Number(input.fiscal_year_end_month);
  const fye = found?.fiscal_year_end_month ?? (Number.isInteger(statedFye) && statedFye >= 1 && statedFye <= 12 ? statedFye : null);
  const name = found?.name ?? (typeof input.name === 'string' && input.name.trim() ? input.name.trim() : null);
  if (!name || !fye) {
    throw new WatchlistError(422, `${ticker} was not found on SEC EDGAR. Add it with its company name and fiscal-year-end month.`);
  }
  const exposure = EXPOSURES.includes(input.channel_exposure as ChannelExposure) ? (input.channel_exposure as ChannelExposure) : 'medium';
  db.prepare(`INSERT INTO companies (ticker, name, cik, fiscal_year_end_month, sector, channel_exposure, notes, added_by, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(ticker, name, found?.cik ?? null, fye, found?.sector ?? null, exposure,
      typeof input.notes === 'string' ? input.notes.slice(0, 500) : null,
      typeof input.added_by === 'string' ? input.added_by.slice(0, 60) : null);
  return toCompany(db.prepare('SELECT * FROM companies WHERE ticker = ?').get(ticker) as Row);
}

export function updateCompany(db: DatabaseSync, ticker: string, patch: { channel_exposure?: unknown; notes?: unknown; is_active?: unknown; fiscal_year_end_month?: unknown }): Company {
  const row = db.prepare('SELECT * FROM companies WHERE ticker = ?').get(ticker) as Row | undefined;
  if (!row) throw new WatchlistError(404, `${ticker} is not on the watchlist.`);
  if (patch.channel_exposure !== undefined) {
    if (!EXPOSURES.includes(patch.channel_exposure as ChannelExposure)) throw new WatchlistError(400, 'channel_exposure must be high, medium or low.');
    db.prepare('UPDATE companies SET channel_exposure = ? WHERE ticker = ?').run(patch.channel_exposure as string, ticker);
  }
  if (patch.notes !== undefined) db.prepare('UPDATE companies SET notes = ? WHERE ticker = ?').run(typeof patch.notes === 'string' ? patch.notes.slice(0, 500) : null, ticker);
  if (patch.is_active !== undefined) db.prepare('UPDATE companies SET is_active = ? WHERE ticker = ?').run(patch.is_active ? 1 : 0, ticker);
  if (patch.fiscal_year_end_month !== undefined) {
    const m = Number(patch.fiscal_year_end_month);
    if (!Number.isInteger(m) || m < 1 || m > 12) throw new WatchlistError(400, 'fiscal_year_end_month must be 1–12.');
    db.prepare('UPDATE companies SET fiscal_year_end_month = ? WHERE ticker = ?').run(m, ticker);
  }
  return toCompany(db.prepare('SELECT * FROM companies WHERE ticker = ?').get(ticker) as Row);
}

/** Adds (or updates) a listing for a company already on the watchlist. */
export function upsertProduct(
  db: DatabaseSync,
  input: { asin?: unknown; ticker?: unknown; title?: unknown; category?: unknown; bestbuy_sku?: unknown; amazon_domain?: unknown; collect_interval_hours?: unknown; added_by?: unknown },
): Product {
  const asin = typeof input.asin === 'string' ? input.asin.trim().toUpperCase() : '';
  const ticker = typeof input.ticker === 'string' ? input.ticker.trim().toUpperCase() : '';
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!ASIN.test(asin)) throw new WatchlistError(400, 'An ASIN is 10 letters or digits, e.g. B003NR57BY.');
  if (!title) throw new WatchlistError(400, 'A product title is required.');
  if (!db.prepare('SELECT 1 FROM companies WHERE ticker = ?').get(ticker)) throw new WatchlistError(400, `Add ${ticker || 'the company'} to the watchlist first.`);
  const interval = Number(input.collect_interval_hours);
  const domain = typeof input.amazon_domain === 'string' && /^amazon\.[a-z.]{2,8}$/.test(input.amazon_domain) ? input.amazon_domain : 'amazon.com';
  db.prepare(`
    INSERT INTO products (asin, ticker, title, category, amazon_url, bestbuy_sku, reddit_query, is_active, added_by, amazon_domain, collect_interval_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(asin) DO UPDATE SET title = excluded.title, category = excluded.category, bestbuy_sku = excluded.bestbuy_sku,
      amazon_domain = excluded.amazon_domain, collect_interval_hours = excluded.collect_interval_hours, is_active = 1
  `).run(
    asin, ticker, title.slice(0, 200), typeof input.category === 'string' ? input.category.slice(0, 80) : null,
    `https://www.${domain}/dp/${asin}`,
    typeof input.bestbuy_sku === 'string' && /^\d{4,10}$/.test(input.bestbuy_sku.trim()) ? input.bestbuy_sku.trim() : null,
    title.slice(0, 40),
    typeof input.added_by === 'string' ? input.added_by.slice(0, 60) : null,
    domain,
    Number.isInteger(interval) && interval >= 6 && interval <= 24 * 14 ? interval : 24,
  );
  return toProduct(db.prepare('SELECT * FROM products WHERE asin = ?').get(asin) as Row);
}

export function setProductActive(db: DatabaseSync, asin: string, active: boolean): Product {
  if (!db.prepare('SELECT 1 FROM products WHERE asin = ?').get(asin)) throw new WatchlistError(404, `No product ${asin}.`);
  db.prepare('UPDATE products SET is_active = ? WHERE asin = ?').run(active ? 1 : 0, asin);
  return toProduct(db.prepare('SELECT * FROM products WHERE asin = ?').get(asin) as Row);
}

// ── watchlist overview ───────────────────────────────────────────────────────────────────────────

export function watchlist(db: DatabaseSync, now: Date = new Date()): WatchlistRow[] {
  const companies = (db.prepare('SELECT * FROM companies WHERE is_active = 1 ORDER BY ticker').all() as Row[]).map(toCompany);
  const since90 = new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  const recent = db.prepare(`SELECT COUNT(*) c FROM reviews_raw WHERE review_date >= ? AND asin IN (SELECT asin FROM products WHERE ticker = ? AND is_active = 1)`);
  const lastCollected = db.prepare('SELECT MAX(last_collected_at) v FROM products WHERE ticker = ? AND is_active = 1');

  return companies.map((company) => {
    const s = getDashboardSummary(db, { ticker: company.ticker })!;
    const latest = s.latest_quarter;
    return {
      company,
      product_count: s.products.length,
      total_reviews: s.total_reviews,
      reviews_90d: (recent.get(since90, company.ticker) as { c: number }).c,
      latest_quarter: latest?.quarter_label ?? null,
      avg_tone: latest?.avg_tone ?? null,
      delta_tone: latest?.delta_tone ?? null,
      signal: latest?.signal ?? null,
      current_status: s.current_status,
      is_sparse: latest?.is_sparse ?? true,
      backtest: s.backtest,
      last_collected_at: (lastCollected.get(company.ticker) as { v: string | null }).v,
      tone_trend: s.quarters.slice(-8).map((q) => q.avg_tone),
    };
  });
}

// ── schedule ─────────────────────────────────────────────────────────────────────────────────────

/** Products whose interval has passed and that have a connector to run, oldest first. */
export function dueProducts(db: DatabaseSync, now: Date, env: Record<string, string | undefined> = process.env): Product[] {
  const rows = (db.prepare(`
    SELECT p.* FROM products p JOIN companies c ON c.ticker = p.ticker
    WHERE p.is_active = 1 AND c.is_active = 1
    ORDER BY COALESCE(p.last_collected_at, '') ASC
  `).all() as Row[]).map(toProduct);
  return rows.filter((p) => {
    if (connectorsFor(p, env).length === 0) return false;
    if (!p.last_collected_at) return true;
    return now.getTime() - Date.parse(p.last_collected_at) >= (p.collect_interval_hours ?? 24) * 3_600_000;
  });
}

export function dueCompanies(db: DatabaseSync, now: Date): Company[] {
  const cutoff = new Date(now.getTime() - FINANCIALS_REFRESH_HOURS * 3_600_000).toISOString();
  return (db.prepare(`
    SELECT * FROM companies WHERE is_active = 1 AND cik IS NOT NULL AND (financials_synced_at IS NULL OR financials_synced_at < ?)
    ORDER BY COALESCE(financials_synced_at, '') ASC
  `).all(cutoff) as Row[]).map(toCompany);
}

/** One scheduler pass: a bounded amount of due work, so a long watchlist spreads over ticks. */
export async function runDueWork(db: DatabaseSync, deps: TrackerDeps & { maxProducts?: number; maxCompanies?: number } = {}): Promise<{ products: number; companies: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const env = deps.env ?? process.env;
  const companies = dueCompanies(db, now).slice(0, deps.maxCompanies ?? 3);
  for (const c of companies) await syncFinancials(db, c, { ...deps, trigger: 'schedule' });
  const products = dueProducts(db, now, env).slice(0, deps.maxProducts ?? 5);
  for (const p of products) await collectProduct(db, p, { ...deps, trigger: 'schedule' });
  return { products: products.length, companies: companies.length };
}

export const SCHEDULER_TICK_MS = 15 * 60_000;

/**
 * Starts the background schedule: one pass shortly after boot, then every 15 minutes. A pass that
 * is still running when the next tick comes is not overlapped. Returns a stop function.
 */
export function startReviewsScheduler(db: DatabaseSync, deps: TrackerDeps = {}): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const done = await runDueWork(db, deps);
      if (done.products || done.companies) console.log(`[reviews] scheduled pass: ${done.companies} companies' filings, ${done.products} listings collected`);
    } catch (e) {
      console.error('[reviews] scheduled pass failed', e);
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(tick, 20_000);
  const timer = setInterval(tick, SCHEDULER_TICK_MS);
  first.unref();
  timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}
