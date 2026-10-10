import type { SignalOutcome } from './review-signals';

/**
 * How much of a company's sales run through channels where online reviews move buyers (Amazon,
 * DTC). The research is clear that review tone only leads revenue where this is high.
 */
export type ChannelExposure = 'high' | 'medium' | 'low';

export interface Company {
  ticker: string;
  name: string;
  cik: string | null;
  fiscal_year_end_month: number;
  sector?: string | null;
  channel_exposure?: ChannelExposure;
  notes?: string | null;
  added_by?: string | null;
  is_active?: boolean;
  /** When EDGAR financials were last read, and how that went. */
  financials_synced_at?: string | null;
  financials_status?: string | null;
  created_at?: string;
}

export interface Product {
  asin: string;
  ticker: string;
  title: string;
  category: string | null;
  amazon_url: string | null;
  bestbuy_sku: string | null;
  reddit_query: string | null;
  is_active: boolean;
  added_by?: string | null;
  amazon_domain?: string;
  /** How often the scheduler collects this product, in hours. */
  collect_interval_hours?: number;
  last_collected_at?: string | null;
  created_at?: string;
}

/**
 * Who asserts that a stored review is real. Only 'captured' rows are evidence; 'seed' rows are
 * the bundled demo dataset and 'synthetic' rows are fixtures a provider could not be reached for.
 * Every reader that presents a count or a tone must be able to see this, so it is stored, not implied.
 */
export type ReviewProvenance = 'captured' | 'seed' | 'synthetic';

export interface ReviewRaw {
  review_id: string;
  asin: string;
  ticker: string;
  platform: 'amazon' | 'bestbuy' | 'reddit' | string;
  review_date: string; // YYYY-MM-DD
  star_rating: number | null;
  title: string | null;
  body: string;
  author: string | null;
  verified_purchase: boolean;
  source_type: 'csv_plugin' | 'bestbuy_api' | 'reddit_api' | 'manual' | 'seed' | string;
  source_url: string | null;
  provenance: ReviewProvenance;
  /** Amazon Vine (free product) review; read warmer than paid purchases, so kept out of tone. */
  is_vine?: boolean;
  created_at?: string;
}

export type PrimaryReason =
  | 'defect'
  | 'quality_decline'
  | 'price'
  | 'ergonomics'
  | 'software'
  | 'praise'
  | 'other';

export interface ReviewScored {
  review_id: string;
  asin: string;
  ticker: string;
  tone_score: number; // -2 to +2
  is_product_related: boolean;
  primary_reason: PrimaryReason;
  tags: string[];
  model_used: string;
  scored_at?: string;
}

/**
 * A stored review with its score. The score fields are null for a row that was never scored, which
 * must read as "unscored" — not as a neutral tone of 0.
 */
export interface EnrichedReview extends ReviewRaw, Omit<ReviewScored, 'tone_score' | 'is_product_related' | 'primary_reason' | 'model_used'> {
  tone_score: number | null;
  is_product_related: boolean | null;
  primary_reason: PrimaryReason | null;
  model_used: string | null;
  /** Amazon Vine (free product) review: shown, but excluded from tone. */
  is_vine: boolean;
}

export interface CompanyFinancial {
  id: string; // e.g. 'LOGI-FY2025Q3'
  ticker: string;
  fiscal_year: number;
  fiscal_quarter: number;
  fiscal_label: string; // e.g. 'FY25 Q3'
  period_start_date: string;
  period_end_date: string;
  sec_report_date: string | null;
  revenue_usd: number | null;
  revenue_yoy_growth: number | null; // e.g. -4.5 for -4.5%
  operating_income_usd: number | null;
  gross_margin?: number | null;
  accession_number?: string | null;
  official_excerpt?: string | null;
  source_filing_url: string | null;
  /** 'edgar' when read from SEC XBRL; 'seed' for the bundled demo set. */
  provenance?: 'edgar' | 'seed';
  created_at?: string;
}

export interface QuarterlyAggregation {
  quarter_label: string; // e.g. 'FY25 Q2' or '2024-Q3'
  calendar_quarter: string; // e.g. '2024-Q3'
  start_date: string;
  end_date: string;
  review_count: number;
  product_review_count?: number;
  seller_only_count?: number;
  /** Amazon Vine (free product) reviews: shown, not averaged into tone. */
  vine_count?: number;
  /** Reviews that carried tone this quarter — the n behind avg_tone. */
  tone_review_count?: number;
  /** Change in mean tone from the previous quarter that had any. */
  qoq_change?: number | null;
  avg_tone: number | null;
  baseline_tone: number | null; // 4-quarter rolling baseline
  delta_tone: number | null; // avg_tone - baseline_tone
  reddit_tone: number | null; // early canary tone
  amazon_tone: number | null;
  bestbuy_tone: number | null;
  negative_count: number; // count of tone <= -1
  defect_count: number;
  quality_decline_count: number;
  is_sparse: boolean; // review_count < SIGNALS.sparseReviewCount
  is_negative_swing: boolean; // delta_tone < SIGNALS.negativeSwingDelta
  /** The classification the server decided, so a view never has to re-derive it. */
  signal?: 'negative_swing' | 'positive' | 'stable';
  financial?: CompanyFinancial | null;
  /**
   * Whether a reported period covers this quarter. 'no_filing' means the company has no filing for
   * that window — deliberately distinct from a match that happens to be false.
   */
  financial_match?: 'matched' | 'no_filing';
  /**
   * For a negative swing: what revenue did afterwards (see SIGNALS.outcomeHorizonQuarters).
   * null for a quarter that is not a swing.
   */
  outcome?: SignalOutcome | null;
  /** The later filing in which revenue growth slowed, for a hit. */
  outcome_filing?: { fiscal_label: string; revenue_yoy_growth: number | null; sec_report_date: string | null } | null;
  /** A swing that revenue growth did not follow — recorded, not dropped. Same as outcome === 'miss'. */
  is_miss?: boolean;
}

/** How the swings have done against later filings, and how often growth slowed anyway. */
export interface BacktestSummary {
  horizon_quarters: number;
  swings: number;
  hits: number;
  misses: number;
  pending: number;
  no_filing: number;
  /** hits / (hits + misses); null before any swing is decided. */
  hit_rate: number | null;
  /** How often revenue growth slowed after any reported quarter: what a hit rate must beat. */
  base_rate: number | null;
  base_quarters: number;
}

export interface ReviewDashboardSummary {
  company: Company;
  /** The single listing in view, or null when the whole company (every active product) is. */
  product: Product | null;
  /** The listings this summary aggregates. */
  products: Product[];
  backtest: BacktestSummary;
  current_status: 'negative_swing' | 'healthy' | 'neutral' | 'sparse_data';
  latest_quarter: QuarterlyAggregation | null;
  quarters: QuarterlyAggregation[];
  total_reviews: number;
  all_records_count: number;
  product_reviews_count: number;
  seller_only_count: number;
  tone_change_latest: number | null;
  negative_rate: number; // percentage of <= -1 reviews
  top_defect_tags: { tag: string; count: number }[];
  canary_summary: {
    reddit_sentiment: number | null;
    reddit_post_count: number;
    earliest_defect_detected: string | null;
    lead_time_days: number;
  };
}

export interface SnifferDetectionResult {
  totalRows: number;
  detectedColumns: {
    bodyCol: string | null;
    dateCol: string | null;
    ratingCol: string | null;
    titleCol: string | null;
    authorCol: string | null;
    verifiedCol: string | null;
  };
  confidence: number;
  sampleRows: Record<string, any>[];
  parsedReviews: Array<{
    body: string;
    date: string;
    rating: number | null;
    title: string | null;
    author: string | null;
    verified: boolean;
  }>;
}

export interface ReviewStatusResponse {
  db_path: string;
  total_reviews: number;
  total_scored: number;
  /** Rows obtained from a fetch or a hand-imported CSV: the only rows that are evidence. */
  captured_reviews: number;
  /** Rows from the bundled demo dataset. */
  seed_reviews: number;
  /**
   * Every scorer in the chain, in the order it is tried, and whether it can run right now.
   * Derived from the chain itself, so this cannot advertise a path the code does not have.
   */
  scorers: { name: string; ready: boolean }[];
  /** The scorer that will answer right now. */
  engine_mode: string;
  /** Wall-clock budget for one scoring round across the whole chain. */
  budget_ms: number;
}

export type CollectionStatus = 'ok' | 'unavailable' | 'error' | 'empty';

/** One collection attempt, scheduled or manual. */
export interface CollectionRun {
  id: number;
  ticker: string;
  asin: string | null;
  connector: string;
  trigger: 'schedule' | 'manual';
  started_at: string;
  finished_at: string | null;
  status: CollectionStatus;
  fetched: number;
  stored: number;
  skipped: number;
  message: string | null;
}

/** A data source the tracker can read, and whether it can right now. */
export interface ConnectorStatus {
  id: 'amazon' | 'bestbuy' | 'reddit' | 'edgar' | 'csv';
  label: string;
  ready: boolean;
  /** Collected by the scheduler, or only on request. */
  scheduled: boolean;
  detail: string;
}

/** One row of the watchlist overview. */
export interface WatchlistRow {
  company: Company;
  product_count: number;
  total_reviews: number;
  reviews_90d: number;
  latest_quarter: string | null;
  avg_tone: number | null;
  delta_tone: number | null;
  signal: 'negative_swing' | 'positive' | 'stable' | null;
  current_status: ReviewDashboardSummary['current_status'];
  is_sparse: boolean;
  backtest: BacktestSummary;
  last_collected_at: string | null;
  /** Mean tone per quarter, oldest first, for a sparkline. */
  tone_trend: (number | null)[];
}

export interface ReviewSession {
  /** Writes need the team code. */
  write_protected: boolean;
  /** The code sent with this request was accepted. */
  can_write: boolean;
}
