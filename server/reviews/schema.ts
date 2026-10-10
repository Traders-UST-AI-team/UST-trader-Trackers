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

  // Any index over a column added above must be created after the migration, not in the block
  // that runs against a database which may predate the column.
  db.exec('CREATE INDEX IF NOT EXISTS idx_reviews_provenance ON reviews_raw (provenance);');
}
