import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateResearch } from './research/schema.ts';
import { migrateMaritime } from './maritime/schema.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.TRACKER_DB ?? resolve(root, 'data', 'tracker.sqlite');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  published_at TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  raw_url TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  originating_source TEXT,
  location_name TEXT, lat REAL, lng REAL, loc_precision TEXT,
  entities TEXT NOT NULL DEFAULT '[]',
  topics TEXT NOT NULL DEFAULT '[]',
  relevant INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_events_pub ON events (published_at DESC);

CREATE TABLE IF NOT EXISTS markets (
  condition_id TEXT PRIMARY KEY,
  gamma_id TEXT,
  event_id TEXT NOT NULL,
  event_slug TEXT NOT NULL,
  event_title TEXT NOT NULL,
  question TEXT NOT NULL,
  outcome_label TEXT NOT NULL,
  token_id TEXT,
  start_date TEXT, end_date TEXT,
  resolution_text TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  price REAL, quote_basis TEXT, best_bid REAL, best_ask REAL, spread REAL,
  one_day_change REAL, one_week_change REAL,
  volume_total REAL, volume_24h REAL, liquidity REAL,
  provider_updated_at TEXT,
  observed_at TEXT NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 1
);

-- One row per refresh per market: our own observation series (independent of provider history).
CREATE TABLE IF NOT EXISTS market_obs (
  condition_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  price REAL, basis TEXT, bid REAL, ask REAL, volume_24h REAL, liquidity REAL,
  PRIMARY KEY (condition_id, observed_at)
);

-- Provider price history (Polymarket CLOB /prices-history). Basis is provider-defined.
CREATE TABLE IF NOT EXISTS price_history (
  condition_id TEXT NOT NULL,
  t INTEGER NOT NULL,
  p REAL NOT NULL,
  PRIMARY KEY (condition_id, t)
);
CREATE TABLE IF NOT EXISTS history_meta (
  condition_id TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  fidelity INTEGER NOT NULL,
  error TEXT
);

CREATE TABLE IF NOT EXISTS event_market_links (
  event_id TEXT NOT NULL,
  condition_id TEXT NOT NULL,
  score REAL NOT NULL,
  matched_entities TEXT NOT NULL,
  matched_topics TEXT NOT NULL,
  PRIMARY KEY (event_id, condition_id)
);

CREATE TABLE IF NOT EXISTS stories (
  event_id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  size INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stories_sid ON stories (story_id);

CREATE TABLE IF NOT EXISTS source_health (
  source_id TEXT PRIMARY KEY,
  last_attempt_at TEXT,
  last_success_at TEXT,
  status TEXT NOT NULL DEFAULT 'never',
  items INTEGER,
  error TEXT
);

-- Telegram public-channel posts (public web preview only). Rule-based analysis fields; media kept as URLs, never downloaded.
CREATE TABLE IF NOT EXISTS tg_channels (
  channel TEXT PRIMARY KEY, title TEXT, description TEXT, subscribers INTEGER, counters TEXT, fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tg_posts (
  channel TEXT NOT NULL, post_id INTEGER NOT NULL, posted_at TEXT NOT NULL, edited INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '', views INTEGER, forwarded_from TEXT, forwarded_url TEXT, reply_to INTEGER,
  media TEXT NOT NULL DEFAULT '[]', link_preview TEXT, url TEXT NOT NULL,
  lang TEXT, entities TEXT NOT NULL DEFAULT '[]', topics TEXT NOT NULL DEFAULT '[]', flags TEXT NOT NULL DEFAULT '[]',
  loc_name TEXT, lat REAL, lng REAL, loc_precision TEXT,
  report_kind TEXT, claim_kinds TEXT NOT NULL DEFAULT '[]', attributions TEXT NOT NULL DEFAULT '[]', hashtags TEXT NOT NULL DEFAULT '[]', domains TEXT NOT NULL DEFAULT '[]',
  first_seen_at TEXT NOT NULL, fetched_at TEXT NOT NULL,
  PRIMARY KEY (channel, post_id)
);
CREATE INDEX IF NOT EXISTS idx_tg_posted ON tg_posts (channel, posted_at DESC);
-- Cross-check of a post against news items (text similarity). "No match" is not evidence of falsity.
CREATE TABLE IF NOT EXISTS tg_matches (
  channel TEXT NOT NULL, post_id INTEGER NOT NULL, event_id TEXT NOT NULL, similarity REAL NOT NULL, delta_min REAL NOT NULL,
  PRIMARY KEY (channel, post_id, event_id)
);

-- Sensor series: numeric observations from non-news providers (chokepoint transits, prices, air traffic, connectivity).
CREATE TABLE IF NOT EXISTS series_points (
  series_id TEXT NOT NULL,
  t INTEGER NOT NULL,          -- unix seconds of the observation (provider's own timestamp, or our poll time for self-collected series)
  v REAL NOT NULL,
  PRIMARY KEY (series_id, t)
);
CREATE TABLE IF NOT EXISTS series_meta (
  series_id TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL
);

-- Last good raw response per feed source (size-capped), kept so a parser regression can be replayed offline: npm run replay -- <source_id>
CREATE TABLE IF NOT EXISTS raw_cache (
  source_id TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, body TEXT NOT NULL
);

-- Persisted circuit-breaker state: survives restarts so a dead source is not hammered every launch.
CREATE TABLE IF NOT EXISTS breaker (
  source_id TEXT PRIMARY KEY, fails INTEGER NOT NULL, open_until TEXT, last_error TEXT, updated_at TEXT NOT NULL
);

-- Per-source input version: bumped whenever a source's stored data changes, so views can refresh when THEIR source changes
-- (not only after a whole ingestion cycle) and indicator caches can be invalidated.
CREATE TABLE IF NOT EXISTS source_versions (
  source_id TEXT PRIMARY KEY, version INTEGER NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);

// Additive, idempotent migrations (SQLite has no ADD COLUMN IF NOT EXISTS).
function addColumn(table: string, col: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}
addColumn('markets', 'venue', "TEXT NOT NULL DEFAULT 'polymarket'");
addColumn('markets', 'ext_ref', 'TEXT');              // venue-specific handle (Kalshi: "SERIES|TICKER")
addColumn('markets', 'url', 'TEXT');                  // venue market/rules page
addColumn('markets', 'volume_unit', "TEXT NOT NULL DEFAULT 'USD'");
addColumn('markets', 'open_interest', 'REAL');
addColumn('history_meta', 'basis', 'TEXT');
addColumn('events', 'modified_at', 'TEXT');          // publisher-reported last update (revisions)
addColumn('events', 'revision_count', 'INTEGER NOT NULL DEFAULT 0');
addColumn('events', 'publisher', 'TEXT');             // per-item publisher when a feed aggregates many (Google News)
addColumn('events', 'tier', 'TEXT');                  // per-item tier override (publisher-level prior)
addColumn('events', 'time_precision', "TEXT NOT NULL DEFAULT 'instant'"); // 'instant' | 'date' (source gives only a day)
addColumn('tg_channels', 'last_attempt_at', 'TEXT');
addColumn('tg_channels', 'last_error', 'TEXT');
addColumn('tg_channels', 'gap_note', 'TEXT');          // set when catch-up hit its page cap before reaching stored posts: posts in between may be missing
addColumn('tg_posts', 'seen_via', "TEXT NOT NULL DEFAULT 'unknown'"); // 'latest' | 'backfill' | 'gap' | 'unknown' (rows collected before this column existed)
addColumn('tg_matches', 'strength', "TEXT NOT NULL DEFAULT 'strong'");
addColumn('events', 'outlet', 'TEXT');                // canonical outlet key so one outlet via two feeds is not 'independent'
addColumn('events', 'publisher_time_raw', 'TEXT');    // publisher's stated time when it was LATER than first collection (shown at collection time instead)
// Repair rows stored before that rule: a publication time more than 10 min after first collection cannot be right.
db.exec(`UPDATE events SET publisher_time_raw = published_at, published_at = first_seen_at
  WHERE publisher_time_raw IS NULL AND published_at > strftime('%Y-%m-%dT%H:%M:%fZ', first_seen_at, '+10 minutes')`);

// ── Package D / J2: scheduling, source configuration, Telegram coverage ──
db.exec(`
CREATE TABLE IF NOT EXISTS source_config (
  source_id TEXT PRIMARY KEY, interval_min INTEGER NOT NULL, request_budget INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_runs (
  source_id TEXT PRIMARY KEY, last_run_at TEXT NOT NULL, requests INTEGER NOT NULL, budget INTEGER NOT NULL, budget_exhausted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY, holder TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tg_channel_config (
  channel TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, added_at TEXT NOT NULL, added_by TEXT NOT NULL, note TEXT
);
CREATE TABLE IF NOT EXISTS tg_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL,
  low_id INTEGER NOT NULL,      -- newest post already stored when the gap opened (exclusive lower bound)
  high_id INTEGER NOT NULL,     -- oldest post the capped catch-up reached (exclusive upper bound)
  cursor_before INTEGER NOT NULL, -- next ?before= value; walks downwards toward low_id
  opened_at TEXT NOT NULL, resolved_at TEXT, pages_used INTEGER NOT NULL DEFAULT 0, recovered_posts INTEGER NOT NULL DEFAULT 0, last_progress_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tg_gaps_open ON tg_gaps (channel, resolved_at);
CREATE TABLE IF NOT EXISTS tg_runs (
  channel TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, pages_latest INTEGER NOT NULL DEFAULT 0, pages_gap INTEGER NOT NULL DEFAULT 0,
  pages_history INTEGER NOT NULL DEFAULT 0, inserted INTEGER NOT NULL DEFAULT 0, error TEXT, PRIMARY KEY (channel, started_at)
);
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_tg_posts_seen ON tg_posts (first_seen_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_events_seen ON events (first_seen_at)');



// Legacy, never-populated drafts of the wallet/alert tables (superseded by pm_* and the alert tables below): dropped only when empty.
for (const t of ['wallet_profiles', 'watched_wallets', 'wallet_trades', 'wallet_activities', 'wallet_positions', 'wallet_leaderboard', 'wallet_holders']) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (exists && (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c === 0) db.exec(`DROP TABLE ${t}`);
}
for (const [t, col] of [['alerts', 'episode_key'], ['alert_rules', 'version']] as const) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all() as unknown as { name: string }[];
  if (cols.length && !cols.some((c) => c.name === col) && (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c === 0) db.exec(`DROP TABLE ${t}`);
}

// ── Package E: Polymarket wallet activity (public data API v2, no key) ──
// Upstream trade/activity rows carry no unique id: identity = composite key + occurrence ordinal (server/wallets/parse.ts).
// Rows are inserted once and never overwritten. Wallet addresses are pseudonymous keys, not identified people.
db.exec(`
CREATE TABLE IF NOT EXISTS pm_market_trades (
  key TEXT PRIMARY KEY, condition_id TEXT NOT NULL, token_id TEXT NOT NULL, outcome TEXT NOT NULL, outcome_index INTEGER NOT NULL,
  wallet TEXT NOT NULL, side TEXT NOT NULL, size_shares REAL NOT NULL, price_usdc REAL NOT NULL, notional_usdc REAL NOT NULL,
  ts INTEGER NOT NULL, tx_hash TEXT NOT NULL, first_seen_at TEXT NOT NULL,
  seen_via TEXT NOT NULL,            -- 'initial' (first sync of the market) | 'poll' (incremental)
  api_version TEXT NOT NULL          -- taker-only market tape: each fill appears once
);
CREATE INDEX IF NOT EXISTS idx_pm_mt_cond ON pm_market_trades (condition_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_pm_mt_notional ON pm_market_trades (notional_usdc DESC);
CREATE TABLE IF NOT EXISTS pm_wallet_activity (
  key TEXT PRIMARY KEY, wallet TEXT NOT NULL, type TEXT NOT NULL, condition_id TEXT, token_id TEXT, outcome TEXT, outcome_index INTEGER,
  side TEXT, size REAL, usdc_size REAL, price_usdc REAL, ts INTEGER NOT NULL, tx_hash TEXT NOT NULL, title TEXT,
  first_seen_at TEXT NOT NULL, seen_via TEXT NOT NULL, api_version TEXT NOT NULL  -- TRADE rows include maker fills
);
CREATE INDEX IF NOT EXISTS idx_pm_wa_wallet ON pm_wallet_activity (wallet, ts DESC);
CREATE TABLE IF NOT EXISTS pm_positions (
  wallet TEXT NOT NULL, token_id TEXT NOT NULL, condition_id TEXT NOT NULL, title TEXT, outcome TEXT, outcome_index INTEGER,
  size_shares REAL, entry_price_usdc REAL, cost_usdc REAL, current_price_usdc REAL, current_value_usdc REAL,
  realized_pnl_usdc REAL, unrealized_pnl_usdc REAL, status TEXT, redeemable INTEGER, end_date TEXT, snapshot_at TEXT NOT NULL,
  PRIMARY KEY (wallet, token_id)
);
CREATE TABLE IF NOT EXISTS pm_position_history (
  wallet TEXT NOT NULL, token_id TEXT NOT NULL, snapshot_at TEXT NOT NULL, size_shares REAL, current_value_usdc REAL,
  PRIMARY KEY (wallet, token_id, snapshot_at)
);
CREATE TABLE IF NOT EXISTS pm_holders (
  condition_id TEXT NOT NULL, token_id TEXT NOT NULL, outcome_index INTEGER, rank INTEGER NOT NULL, wallet TEXT NOT NULL,
  amount_shares REAL NOT NULL, snapshot_at TEXT NOT NULL, list_has_more INTEGER NOT NULL,
  PRIMARY KEY (token_id, rank)
);
CREATE TABLE IF NOT EXISTS pm_leaderboard (
  snapshot_date TEXT NOT NULL, time_period TEXT NOT NULL, order_by TEXT NOT NULL, category TEXT NOT NULL, rank INTEGER NOT NULL,
  wallet TEXT NOT NULL, pnl_usdc REAL, volume_usdc REAL, display_name TEXT, captured_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_date, time_period, order_by, category, rank)
);
CREATE TABLE IF NOT EXISTS pm_profiles (wallet TEXT PRIMARY KEY, display_name TEXT, pseudonym TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pm_watch_wallets (
  wallet TEXT PRIMARY KEY, note TEXT, selection_rule TEXT NOT NULL, selected_at TEXT NOT NULL, added_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pm_pilot_markets (
  condition_id TEXT PRIMARY KEY, selection_rule TEXT NOT NULL, selected_at TEXT NOT NULL, added_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pm_sync (
  target TEXT PRIMARY KEY,           -- 'trades:<condition>' | 'activity:<wallet>' | 'positions:<wallet>' | 'holders:<condition>' | 'leaderboard'
  newest_ts INTEGER, covered_since INTEGER,  -- continuous coverage: no known missing interval after covered_since
  last_run_at TEXT, last_ok_at TEXT, last_status TEXT, last_detail TEXT, pages INTEGER, upstream_has_more INTEGER
);
CREATE TABLE IF NOT EXISTS pm_gaps (   -- interval known to be missing: newer-than from_ts and older-than to_ts; recovered by walking resume_cursor
  id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT NOT NULL, from_ts INTEGER NOT NULL, to_ts INTEGER NOT NULL, resume_cursor TEXT,
  prior_covered_since INTEGER,     -- continuous-coverage start before this gap opened; restored once no gap remains
  episode_start INTEGER NOT NULL DEFAULT 1,  -- 1 = no other gap of this target was open when this one opened
  opened_at TEXT NOT NULL, resolved_at TEXT, pages_used INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL
);

-- ── Package F: in-app alerts. A rule fires only on a normal → abnormal transition of (rule, target); it re-arms after a
-- normal reading. Stale/gap/seed inputs leave the state 'unknown' and never fire.
CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, threshold REAL NOT NULL, cooldown_min INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS alert_state (
  rule_id TEXT NOT NULL, target_id TEXT NOT NULL, state TEXT NOT NULL, since TEXT NOT NULL, last_value REAL, last_eval_at TEXT NOT NULL,
  last_input_status TEXT, open_alert_id TEXT, PRIMARY KEY (rule_id, target_id)
);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, target_label TEXT NOT NULL,
  episode_key TEXT NOT NULL UNIQUE,  -- dedupe: one alert per (rule, target, episode/window)
  title TEXT NOT NULL, detail TEXT NOT NULL, severity TEXT NOT NULL, value REAL, threshold REAL, unit TEXT,
  opened_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, occurrences INTEGER NOT NULL DEFAULT 1,
  recovered_at TEXT, acked_at TEXT, revised INTEGER NOT NULL DEFAULT 0, evidence TEXT NOT NULL DEFAULT '{}', definition_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts (acked_at, opened_at DESC);
`);

// Research workspace + claim review (own module so domain migrations stay readable).
migrateResearch(db);
migrateMaritime(db);

export function kvGet(k: string): string | null {
  const r = db.prepare('SELECT v FROM kv WHERE k = ?').get(k) as { v: string } | undefined;
  return r?.v ?? null;
}
export function kvSet(k: string, v: string): void {
  db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
