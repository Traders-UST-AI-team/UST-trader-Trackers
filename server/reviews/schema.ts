export const REVIEWS_SCHEMA = `
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
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(ticker) REFERENCES companies(ticker)
);

CREATE TABLE IF NOT EXISTS reviews_raw (
  review_id TEXT PRIMARY KEY,
  asin TEXT NOT NULL,
  ticker TEXT NOT NULL,
  review_date TEXT NOT NULL,
  star_rating REAL NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  author TEXT,
  verified_purchase INTEGER DEFAULT 1,
  is_vine INTEGER DEFAULT 0,
  source_type TEXT DEFAULT 'csv_import',
  source_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(asin) REFERENCES products(asin)
);

CREATE INDEX IF NOT EXISTS idx_reviews_asin_date ON reviews_raw (asin, review_date DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_ticker_date ON reviews_raw (ticker, review_date DESC);

CREATE TABLE IF NOT EXISTS reviews_scored (
  review_id TEXT PRIMARY KEY,
  asin TEXT NOT NULL,
  ticker TEXT NOT NULL,
  tone_score INTEGER NOT NULL, -- -2, -1, 0, 1, 2
  is_product_related INTEGER NOT NULL DEFAULT 1, -- 0 for seller/shipping only
  primary_reason TEXT NOT NULL DEFAULT 'other', -- defect, quality_decline, price, ergonomics, software, praise, other
  tags TEXT NOT NULL DEFAULT '[]', -- JSON string of tags
  model_used TEXT NOT NULL DEFAULT 'typesafe-jev',
  scored_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(review_id) REFERENCES reviews_raw(review_id)
);

CREATE INDEX IF NOT EXISTS idx_scored_asin ON reviews_scored (asin, tone_score);

CREATE TABLE IF NOT EXISTS company_financials (
  id TEXT PRIMARY KEY, -- ticker_FY25Q3
  ticker TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL,
  fiscal_quarter INTEGER NOT NULL,
  fiscal_label TEXT NOT NULL, -- 'FY25 Q3'
  period_start_date TEXT NOT NULL,
  period_end_date TEXT NOT NULL,
  sec_report_date TEXT,
  revenue_usd REAL,
  revenue_yoy_growth REAL,
  operating_income_usd REAL,
  source_filing_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fin_ticker ON company_financials (ticker, fiscal_year, fiscal_quarter);

CREATE TABLE IF NOT EXISTS review_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;
