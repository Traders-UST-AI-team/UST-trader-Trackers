import type { DatabaseSync } from 'node:sqlite';

export function migrateReviews(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      ticker TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cik TEXT,
      fiscal_year_end_month INTEGER NOT NULL DEFAULT 3,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      asin TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT,
      amazon_url TEXT,
      bestbuy_sku TEXT,
      reddit_query TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(ticker) REFERENCES companies(ticker)
    );

    CREATE TABLE IF NOT EXISTS reviews_raw (
      review_id TEXT PRIMARY KEY,
      asin TEXT NOT NULL,
      ticker TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'amazon',
      review_date TEXT NOT NULL,
      star_rating REAL,
      title TEXT,
      body TEXT NOT NULL,
      author TEXT,
      verified_purchase INTEGER DEFAULT 1,
      source_type TEXT DEFAULT 'csv_plugin',
      source_url TEXT,
      provenance TEXT NOT NULL DEFAULT 'captured',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(asin) REFERENCES products(asin)
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_asin_date ON reviews_raw (asin, review_date DESC);
    CREATE INDEX IF NOT EXISTS idx_reviews_ticker_date ON reviews_raw (ticker, review_date DESC);
    CREATE INDEX IF NOT EXISTS idx_reviews_platform ON reviews_raw (platform);

    CREATE TABLE IF NOT EXISTS reviews_scored (
      review_id TEXT PRIMARY KEY,
      asin TEXT NOT NULL,
      ticker TEXT NOT NULL,
      tone_score INTEGER NOT NULL,
      is_product_related INTEGER DEFAULT 1,
      primary_reason TEXT DEFAULT 'other',
      tags_json TEXT DEFAULT '[]',
      model_used TEXT DEFAULT 'typesafe-jev',
      scored_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(review_id) REFERENCES reviews_raw(review_id)
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_scored_asin ON reviews_scored (asin);
    CREATE INDEX IF NOT EXISTS idx_reviews_scored_tone ON reviews_scored (tone_score);

    CREATE TABLE IF NOT EXISTS company_financials (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      fiscal_year INTEGER NOT NULL,
      fiscal_quarter INTEGER NOT NULL,
      fiscal_label TEXT NOT NULL,
      period_start_date TEXT NOT NULL,
      period_end_date TEXT NOT NULL,
      sec_report_date TEXT,
      revenue_usd REAL,
      revenue_yoy_growth REAL,
      operating_income_usd REAL,
      gross_margin REAL,
      accession_number TEXT,
      official_excerpt TEXT,
      source_filing_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(ticker) REFERENCES companies(ticker)
    );

    CREATE INDEX IF NOT EXISTS idx_financials_ticker_period ON company_financials (ticker, period_end_date DESC);

    CREATE TABLE IF NOT EXISTS review_kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
  `);

  // Safe migrations for newly added columns
  const tryAddCol = (table: string, col: string, def: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def};`);
    } catch {
      // Column already exists
    }
  };

  tryAddCol('company_financials', 'gross_margin', 'REAL');
  tryAddCol('company_financials', 'accession_number', 'TEXT');
  tryAddCol('company_financials', 'official_excerpt', 'TEXT');
  // Rows stored before provenance existed were all captured from a feed or a hand-imported CSV.
  tryAddCol('reviews_raw', 'provenance', "TEXT NOT NULL DEFAULT 'captured'");
  // Amazon Vine reviews (free product) read systematically warmer; stored, but kept out of tone.
  tryAddCol('reviews_raw', 'is_vine', 'INTEGER NOT NULL DEFAULT 0');

  // The watchlist: who added a company, how exposed its sales are to online reviews, and when its
  // filings were last read. Exposure is the paper's "channel" caveat: a brand that sells mostly
  // through Amazon/DTC transmits review tone to revenue; one sold mostly in stores does not.
  tryAddCol('companies', 'sector', 'TEXT');
  tryAddCol('companies', 'channel_exposure', "TEXT NOT NULL DEFAULT 'medium'");
  tryAddCol('companies', 'notes', 'TEXT');
  tryAddCol('companies', 'added_by', 'TEXT');
  tryAddCol('companies', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  tryAddCol('companies', 'financials_synced_at', 'TEXT');
  tryAddCol('companies', 'financials_status', 'TEXT');
  tryAddCol('products', 'added_by', 'TEXT');
  tryAddCol('products', 'amazon_domain', "TEXT NOT NULL DEFAULT 'amazon.com'");
  tryAddCol('products', 'collect_interval_hours', 'INTEGER NOT NULL DEFAULT 24');
  tryAddCol('products', 'last_collected_at', 'TEXT');
  // Financial rows say where they came from: the bundled demo set, or EDGAR.
  tryAddCol('company_financials', 'provenance', "TEXT NOT NULL DEFAULT 'seed'");

  // One row per collection attempt, scheduled or manual, successful or not: the audit trail that
  // makes "why is this quarter thin?" answerable.
  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      asin TEXT,
      connector TEXT NOT NULL,
      trigger TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      fetched INTEGER NOT NULL DEFAULT 0,
      stored INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runs_ticker ON collection_runs (ticker, started_at DESC);
  `);

  // Any index over a column added above must be created after the migration, not in the block
  // that runs against a database which may predate the column.
  db.exec('CREATE INDEX IF NOT EXISTS idx_reviews_provenance ON reviews_raw (provenance);');
}
