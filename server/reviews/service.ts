import type { DatabaseSync } from 'node:sqlite';
import type {
  Company,
  CompanyFinancial,
  EnrichedReview,
  Product,
  ReviewDashboardSummary,
} from '../../shared/review-types.ts';
import { backtestSummary, canarySummary, currentStatus, listingCounts, quarterToneSeries, type ScoredReviewRow } from './policy.ts';

interface DbRow {
  [key: string]: any;
}

const toCompany = (r: DbRow): Company => ({
  ticker: r.ticker,
  name: r.name,
  cik: r.cik,
  fiscal_year_end_month: r.fiscal_year_end_month,
  sector: r.sector ?? null,
  channel_exposure: r.channel_exposure ?? 'medium',
  notes: r.notes ?? null,
  added_by: r.added_by ?? null,
  is_active: r.is_active == null ? true : Boolean(r.is_active),
  financials_synced_at: r.financials_synced_at ?? null,
  financials_status: r.financials_status ?? null,
  created_at: r.created_at,
});

export const toProduct = (r: DbRow): Product => ({
  asin: r.asin,
  ticker: r.ticker,
  title: r.title,
  category: r.category,
  amazon_url: r.amazon_url,
  bestbuy_sku: r.bestbuy_sku,
  reddit_query: r.reddit_query,
  is_active: Boolean(r.is_active),
  added_by: r.added_by ?? null,
  amazon_domain: r.amazon_domain ?? 'amazon.com',
  collect_interval_hours: r.collect_interval_hours ?? 24,
  last_collected_at: r.last_collected_at ?? null,
  created_at: r.created_at,
});

export { toCompany };

export function readFinancials(db: DatabaseSync, ticker: string): CompanyFinancial[] {
  const finRows = db.prepare('SELECT * FROM company_financials WHERE ticker = ? ORDER BY period_end_date ASC').all(ticker) as DbRow[];
  return finRows.map((f) => ({
    id: f.id,
    ticker: f.ticker,
    fiscal_year: f.fiscal_year,
    fiscal_quarter: f.fiscal_quarter,
    fiscal_label: f.fiscal_label,
    period_start_date: f.period_start_date,
    period_end_date: f.period_end_date,
    sec_report_date: f.sec_report_date,
    revenue_usd: f.revenue_usd,
    revenue_yoy_growth: f.revenue_yoy_growth,
    operating_income_usd: f.operating_income_usd,
    gross_margin: f.gross_margin,
    accession_number: f.accession_number,
    official_excerpt: f.official_excerpt,
    source_filing_url: f.source_filing_url,
    provenance: f.provenance ?? 'seed',
    created_at: f.created_at,
  }));
}

/**
 * The dashboard for one listing (`asin`) or for a whole company (`ticker`: every active listing,
 * pooled). Pooling a brand's listings is the research's answer to thin quarters: one ASIN rarely
 * has enough reviews per quarter for its mean to mean anything.
 *
 * Reads the stored reviews and financials, then hands them to the pure policy modules. The rules
 * themselves live in policy.ts (tone, signals, outcomes) and fiscal.ts (calendar ↔ fiscal periods).
 */
export function getDashboardSummary(db: DatabaseSync, scope: { asin?: string; ticker?: string }): ReviewDashboardSummary | null {
  let product: Product | null = null;
  let ticker = scope.ticker;
  if (scope.asin) {
    const prodRow = db.prepare('SELECT * FROM products WHERE asin = ?').get(scope.asin) as DbRow | undefined;
    if (!prodRow) return null;
    product = toProduct(prodRow);
    ticker = product.ticker;
  }
  if (!ticker) return null;

  const compRow = db.prepare('SELECT * FROM companies WHERE ticker = ?').get(ticker) as DbRow | undefined;
  if (!compRow) return null;
  const company = toCompany(compRow);

  const products = product
    ? [product]
    : (db.prepare('SELECT * FROM products WHERE ticker = ? AND is_active = 1 ORDER BY asin').all(ticker) as DbRow[]).map(toProduct);
  const asins = products.map((p) => p.asin);

  const rows = asins.length === 0 ? [] : db.prepare(`
    SELECT r.review_id, r.review_date, r.platform, r.is_vine, s.tone_score, s.is_product_related, s.primary_reason, s.tags_json
    FROM reviews_raw r
    LEFT JOIN reviews_scored s ON s.review_id = r.review_id
    WHERE r.asin IN (${asins.map(() => '?').join(',')})
    ORDER BY r.review_date ASC
  `).all(...asins) as unknown as ScoredReviewRow[];

  const financials = readFinancials(db, company.ticker);
  const series = quarterToneSeries(rows, { fiscalYearEndMonth: company.fiscal_year_end_month, financials });
  const counts = listingCounts(rows);
  const latest = series.quarters.at(-1) ?? null;

  return {
    company,
    product,
    products,
    backtest: backtestSummary(series.quarters, financials),
    current_status: currentStatus(series.quarters),
    latest_quarter: latest,
    quarters: series.quarters,
    total_reviews: rows.length,
    all_records_count: counts.all_records_count,
    product_reviews_count: counts.product_reviews_count,
    seller_only_count: counts.seller_only_count,
    tone_change_latest: latest?.delta_tone ?? null,
    negative_rate: counts.negative_rate,
    top_defect_tags: series.topTags,
    canary_summary: canarySummary(rows, series.quarters),
  };
}

/** The dashboard for one listing. */
export const getProductDashboardSummary = (db: DatabaseSync, asin: string) => getDashboardSummary(db, { asin });

export function listReviews(
  db: DatabaseSync,
  params: {
    asin?: string;
    ticker?: string;
    platform?: string;
    tone?: string;
    reason?: string;
    verified_only?: boolean;
    query?: string;
    limit?: number;
    offset?: number;
  }
): { reviews: EnrichedReview[]; total: number } {
  const whereClauses: string[] = [];
  const args: any[] = [];

  if (params.asin) {
    whereClauses.push('r.asin = ?');
    args.push(params.asin);
  } else if (params.ticker) {
    whereClauses.push('r.asin IN (SELECT asin FROM products WHERE ticker = ? AND is_active = 1)');
    args.push(params.ticker);
  }

  if (params.platform && params.platform !== 'all') {
    whereClauses.push('r.platform = ?');
    args.push(params.platform);
  }

  if (params.tone && params.tone !== 'all') {
    if (params.tone === 'negative') {
      whereClauses.push('s.tone_score <= -1');
    } else if (params.tone === 'neutral') {
      whereClauses.push('s.tone_score = 0');
    } else if (params.tone === 'positive') {
      whereClauses.push('s.tone_score >= 1');
    } else {
      const num = parseInt(params.tone, 10);
      if (!Number.isNaN(num)) {
        whereClauses.push('s.tone_score = ?');
        args.push(num);
      }
    }
  }

  if (params.reason && params.reason !== 'all') {
    whereClauses.push('s.primary_reason = ?');
    args.push(params.reason);
  }

  if (params.verified_only) {
    whereClauses.push('r.verified_purchase = 1');
  }

  if (params.query) {
    whereClauses.push('(r.body LIKE ? OR r.title LIKE ? OR r.author LIKE ?)');
    const qStr = `%${params.query.trim()}%`;
    args.push(qStr, qStr, qStr);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const countRow = db.prepare(`
    SELECT COUNT(*) AS c
    FROM reviews_raw r
    LEFT JOIN reviews_scored s ON s.review_id = r.review_id
    ${whereSql}
  `).get(...args) as { c: number };

  // A missing, unreadable or non-positive limit is the default, never "no limit" (SQLite reads
  // LIMIT -1 as unbounded); the ceiling always applies.
  const limit = Number.isInteger(params.limit) && params.limit! > 0 ? Math.min(params.limit!, 200) : 50;
  const offset = Number.isInteger(params.offset) && params.offset! > 0 ? params.offset! : 0;

  const rows = db.prepare(`
    SELECT r.*, s.tone_score, s.is_product_related, s.primary_reason, s.tags_json, s.model_used, s.scored_at
    FROM reviews_raw r
    LEFT JOIN reviews_scored s ON s.review_id = r.review_id
    ${whereSql}
    ORDER BY r.review_date DESC
    LIMIT ? OFFSET ?
  `).all(...args, limit, offset) as DbRow[];

  const reviews: EnrichedReview[] = rows.map((r) => {
    let tags: string[] = [];
    if (r.tags_json) {
      try {
        tags = JSON.parse(r.tags_json);
      } catch {
        // ignore
      }
    }

    return {
      review_id: r.review_id,
      asin: r.asin,
      ticker: r.ticker,
      platform: r.platform,
      review_date: r.review_date,
      star_rating: r.star_rating,
      title: r.title,
      body: r.body,
      author: r.author,
      verified_purchase: Boolean(r.verified_purchase),
      source_type: r.source_type,
      source_url: r.source_url,
      provenance: r.provenance ?? 'captured',
      created_at: r.created_at,
      // A row without a score (stored before scoring was made atomic) is "unscored", never tone 0.
      tone_score: r.tone_score ?? null,
      is_product_related: r.is_product_related == null ? null : Boolean(r.is_product_related),
      primary_reason: r.primary_reason ?? null,
      tags,
      model_used: r.model_used ?? null,
      is_vine: Boolean(r.is_vine),
      scored_at: r.scored_at,
    };
  });

  return { reviews, total: countRow.c };
}
