import type { DatabaseSync } from 'node:sqlite';
import type {
  Company,
  CompanyFinancial,
  EnrichedReview,
  Product,
  ReviewDashboardSummary,
} from '../../shared/review-types.ts';
import { canarySummary, currentStatus, listingCounts, quarterToneSeries, type ScoredReviewRow } from './policy.ts';

interface DbRow {
  [key: string]: any;
}

/**
 * The product dashboard: read the stored reviews and financials, then hand them to the pure policy
 * modules. The rules themselves live in policy.ts (tone, signals, canary) and fiscal.ts (calendar ↔
 * fiscal periods), which is what makes them testable against literal arrays instead of a seeded
 * database.
 */
export function getProductDashboardSummary(db: DatabaseSync, asin: string): ReviewDashboardSummary | null {
  const prodRow = db.prepare('SELECT * FROM products WHERE asin = ?').get(asin) as DbRow | undefined;
  if (!prodRow) return null;

  const compRow = db.prepare('SELECT * FROM companies WHERE ticker = ?').get(prodRow.ticker) as DbRow | undefined;
  if (!compRow) return null;

  const company: Company = {
    ticker: compRow.ticker,
    name: compRow.name,
    cik: compRow.cik,
    fiscal_year_end_month: compRow.fiscal_year_end_month,
    created_at: compRow.created_at,
  };

  const product: Product = {
    asin: prodRow.asin,
    ticker: prodRow.ticker,
    title: prodRow.title,
    category: prodRow.category,
    amazon_url: prodRow.amazon_url,
    bestbuy_sku: prodRow.bestbuy_sku,
    reddit_query: prodRow.reddit_query,
    is_active: Boolean(prodRow.is_active),
    created_at: prodRow.created_at,
  };

  const rows = db.prepare(`
    SELECT r.review_id, r.review_date, r.platform, s.tone_score, s.is_product_related, s.primary_reason, s.tags_json
    FROM reviews_raw r
    LEFT JOIN reviews_scored s ON s.review_id = r.review_id
    WHERE r.asin = ?
    ORDER BY r.review_date ASC
  `).all(asin) as unknown as ScoredReviewRow[];

  const finRows = db.prepare(`
    SELECT * FROM company_financials
    WHERE ticker = ?
    ORDER BY period_end_date ASC
  `).all(company.ticker) as DbRow[];

  const financials: CompanyFinancial[] = finRows.map((f) => ({
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
    created_at: f.created_at,
  }));

  const series = quarterToneSeries(rows, { fiscalYearEndMonth: company.fiscal_year_end_month, financials });
  const counts = listingCounts(rows);
  const latest = series.quarters.at(-1) ?? null;

  return {
    company,
    product,
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

export function listReviews(
  db: DatabaseSync,
  params: {
    asin?: string;
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

  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;

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
      tone_score: r.tone_score ?? 0,
      is_product_related: Boolean(r.is_product_related ?? 1),
      primary_reason: r.primary_reason ?? 'other',
      tags,
      model_used: r.model_used ?? 'unknown',
      scored_at: r.scored_at,
    };
  });

  return { reviews, total: countRow.c };
}
