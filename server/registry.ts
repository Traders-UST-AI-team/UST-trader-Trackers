import type { Tier } from '../shared/types.ts';

const H = 3600, D = 86400;
// Cadence and budget bounds. A family states them once; a source that differs names its own.
// These were a chain of id branches in sourceconfig.ts, which is where the values are read but not
// where a source is described.
const BOUNDS_TELEGRAM: SourceBounds = { interval: [5, 240], budget: [1, 30], budgetDefault: 8, budgetUnit: 'preview pages per channel per run' };
// Wallet pilot: far below the published v2 limits (trades 300 / positions & activity 200 per 10 s); pilot cadences per plan §9.
const BOUNDS_PILOT_TRADES: SourceBounds = { interval: [1, 60], budget: [5, 100], budgetDefault: 30, budgetUnit: 'HTTP requests per run' };
const BOUNDS_PILOT_WALLETS: SourceBounds = { interval: [10, 240], budget: [5, 120], budgetDefault: 60, budgetUnit: 'HTTP requests per run' };
const BOUNDS_PILOT_HOLDERS: SourceBounds = { interval: [30, 1440], budget: [2, 40], budgetDefault: 12, budgetUnit: 'HTTP requests per run' };
const BOUNDS_PILOT_LEADERBOARD: SourceBounds = { interval: [360, 10080], budget: [1, 10], budgetDefault: 4, budgetUnit: 'HTTP requests per run' };
const BOUNDS_MARKET: SourceBounds = { interval: [5, 240], budget: [20, 600], budgetDefault: 250, budgetUnit: 'HTTP requests per run' };
const BOUNDS_DAILY_SERIES: SourceBounds = { interval: [60, 1440], budget: [5, 100], budgetDefault: 40, budgetUnit: 'HTTP requests per run' };
const BOUNDS_OPENSKY: SourceBounds = { interval: [10, 1440], budget: [2, 50], budgetDefault: 12, budgetUnit: 'HTTP requests per run' };
const BOUNDS_IODA: SourceBounds = { interval: [15, 1440], budget: [2, 80], budgetDefault: 30, budgetUnit: 'HTTP requests per run' };
// Multi-page adapters, sized from measured runs (2 attempts per page): FCDO 14 country pages; Maersk listing + articles; EASA list + details.
const BOUNDS_MULTIPAGE_14: SourceBounds = { interval: [5, 1440], budget: [14, 60], budgetDefault: 32, budgetUnit: 'HTTP requests per run' };
const BOUNDS_MULTIPAGE_2: SourceBounds = { interval: [5, 1440], budget: [2, 60], budgetDefault: 25, budgetUnit: 'HTTP requests per run' };


export interface NewsSource {
  id: string;
  name: string;
  kind: 'news' | 'official' | 'maritime' | 'analysis';
  adapter?: 'rss' | 'maersk' | 'fcdo' | 'ofac' | 'gnews' | 'easa' | 'inbox' | 'nga';
  /** Feed has no per-item timestamps: take the day from the article URL and mark the item date-only. */
  dateFromUrl?: boolean;
  /** Google News search query (adapter 'gnews'). */
  query?: string;
  /** What the source's statements actually cover (shown in the UI so scope is never overstated). */
  scope?: string;
  url: string;
  tier: Tier;
  /** Ownership / funding context, shown on every card so state framing stays visible. */
  affiliation: string;
  language: string;
  intervalMin: number;
  maxItems: number;
/** false = known not to be programmatically accessible; shown as "blocked" with the reason, never fetched. */
  enabled?: boolean;
  blockedReason?: string;
  /**
   * Silence is normal for this publisher: it only publishes when something happens, so a week of
   * quiet is neither staleness nor failure. Previously a separate OFFICIAL_SPORADIC set in
   * sourcehealth.ts listed these ids — and it was neither the official sources nor the maritime
   * ones, so it could not be derived and had to live on the entry.
   */
  sporadic?: boolean;
  bounds?: SourceBounds;
}

/** How "how old is the newest data?" is judged for one source. */
export interface FreshnessPolicy {
  basis: 'observation' | 'publication' | 'history' | 'post';
  current_s: number;
  delayed_s?: number;
  note: string;
}

/**
 * The query that yields a source's newest observation, and how to read what it returns.
 * Carried on the entry so health does not have to know each source's table and time unit.
 */
export interface NewestQuery {
  sql: string;
  /**
   * Bound to the placeholders. Defaults to the source's own id for the two generic queries
   * (events by source_id, history by venue); queries with no placeholder say `args: []`.
   */
  args?: string[];
  /** 'iso' (default) parses a timestamp string; 's' and 'ms' read a numeric epoch. */
  unit?: 'iso' | 's' | 'ms';
}

/** Cadence and request-budget bounds shown in the sources view, per source. */
export interface SourceBounds {
  interval: [number, number];
  budget: [number, number];
  budgetDefault: number;
  budgetUnit: string;
}

/** Every non-news source carries the same trait fields, so one list can hold all of them. */
export interface SourceDefinition {
  id: string;
  name: string;
  kind: NewsSource['kind'] | 'prediction_market' | 'sensor' | 'wallet' | 'social';
  intervalMin: number;
  sporadic?: boolean;
  freshness?: FreshnessPolicy;
  newest?: NewestQuery;
  bounds?: SourceBounds;
  enabled?: boolean;
  blockedReason?: string;
}

// Tier is a publisher-level prior, NOT a verdict on any individual claim.
export const NEWS_SOURCES: NewsSource[] = [
  {
    id: 'bbc-me', name: 'BBC News — Middle East', kind: 'news',
    url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml',
    tier: 'Tier-1', affiliation: 'UK public-service broadcaster (licence-fee funded)', language: 'en', intervalMin: 15, maxItems: 30,
  },
  {
    id: 'guardian-me', name: 'The Guardian — Middle East', kind: 'news',
    url: 'https://www.theguardian.com/world/middleeast/rss',
    tier: 'Tier-1', affiliation: 'Independent UK newspaper (Scott Trust)', language: 'en', intervalMin: 30, maxItems: 20,
  },
  {
    id: 'un-news-me', name: 'UN News — Middle East', kind: 'official', sporadic: true,
    url: 'https://news.un.org/feed/subscribe/en/news/region/middle-east/feed/rss.xml',
    tier: 'Tier-1', affiliation: 'United Nations (official organisational reporting; reflects UN positions)', language: 'en', intervalMin: 60, maxItems: 20,
  },
  {
    id: 'un-press', name: 'UN Press — meetings & statements', kind: 'official', sporadic: true,
    url: 'https://press.un.org/en/rss.xml',
    tier: 'Tier-1', affiliation: 'United Nations (official meeting coverage and statements; global scope, filtered here to Middle East)', language: 'en', intervalMin: 60, maxItems: 20,
  },
  {
    id: 'maersk-advisories', name: 'Maersk — Middle East advisories', kind: 'maritime', adapter: 'maersk', sporadic: true, bounds: BOUNDS_MULTIPAGE_2,
    url: 'https://www.maersk.com/news',
    tier: 'Tier-2', affiliation: 'Container carrier’s own operational notices (primary source for its own decisions)', language: 'en', intervalMin: 60, maxItems: 6,
    scope: 'Single carrier: describes Maersk’s own services and bookings only. A carrier suspension is not a port or strait closure, and container routing is not oil/LNG tanker flow.',
  },
  {
    id: 'aljazeera-en', name: 'Al Jazeera English — all news', kind: 'news',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    tier: 'Tier-2', affiliation: 'Funded by the State of Qatar; global feed filtered here to Middle East items', language: 'en', intervalMin: 15, maxItems: 30,
  },
  {
    id: 'mee', name: 'Middle East Eye', kind: 'news',
    url: 'https://www.middleeasteye.net/rss',
    tier: 'Tier-2', affiliation: 'London-based outlet with a regional editorial stance; ownership/funding disputed in public reporting', language: 'en', intervalMin: 30, maxItems: 20,
  },
  {
    id: 'jpost-me', name: 'Jerusalem Post — Middle East', kind: 'news',
    url: 'https://www.jpost.com/rss/rssfeedsmiddleeastnews.aspx',
    tier: 'Tier-2', affiliation: 'Israeli newspaper; domestic-security framing common', language: 'en', intervalMin: 30, maxItems: 20,
  },
  {
    id: 'anadolu', name: 'Anadolu Agency — world', kind: 'news',
    url: 'https://www.aa.com.tr/en/rss/default?cat=world',
    tier: 'Tier-3', affiliation: 'Turkish state news agency — state narrative; needs independent corroboration', language: 'en', intervalMin: 30, maxItems: 30,
  },
  {
    id: 'france24-me', name: 'France 24 — Middle East', kind: 'news', url: 'https://www.france24.com/en/middle-east/rss',
    tier: 'Tier-2', affiliation: 'French state-funded international broadcaster (France Médias Monde)', language: 'en', intervalMin: 30, maxItems: 25,
  },
  {
    id: 'nyt-me', name: 'New York Times — Middle East', kind: 'news', url: 'https://rss.nytimes.com/services/xml/rss/nyt/MiddleEast.xml',
    tier: 'Tier-1', affiliation: 'US newspaper (private); feed gives headline + abstract only', language: 'en', intervalMin: 30, maxItems: 25,
  },
  {
    id: 'sky-world', name: 'Sky News — world (filtered)', kind: 'news', url: 'https://feeds.skynews.com/feeds/rss/world.xml',
    tier: 'Tier-1', affiliation: 'UK commercial broadcaster (Comcast); global feed filtered to Middle East items', language: 'en', intervalMin: 30, maxItems: 20,
  },
  {
    id: 'amwaj', name: 'Amwaj.media', kind: 'news', url: 'https://amwaj.media/rss',
    tier: 'Tier-2', affiliation: 'Regional outlet focused on Iran and the Gulf; ownership/funding not verified here', language: 'en', intervalMin: 60, maxItems: 25,
  },
  {
    id: 'irna-en', name: 'IRNA English', kind: 'news', url: 'https://en.irna.ir/rss',
    tier: 'Tier-3', affiliation: 'Iranian state news agency — state narrative; needs independent corroboration', language: 'en', intervalMin: 30, maxItems: 25,
  },
  {
    id: 'nga-navwarn', name: 'NGA — broadcast navigational warnings (Middle East waters)', kind: 'maritime', adapter: 'nga',
    url: 'https://msi.nga.mil/api/publications/broadcast-warn?status=active&output=json',
    scope: 'Declared navigational hazards and operations relayed by the US NGA (HYDROPAC/HYDROLANT, incl. NAVAREA IX/VIII relays) — not incident reports. Measured 2026-10-09: the newest in-force warning for these waters was issued in May 2024, so this is standing-hazard context, not current coverage of NAVAREA IX.',
    tier: 'Tier-1', affiliation: 'US National Geospatial-Intelligence Agency — official maritime safety information (US government)', language: 'en', intervalMin: 180, maxItems: 60,
  },
  {
    id: 'gcaptain', name: 'gCaptain (maritime trade press)', kind: 'maritime', url: 'https://gcaptain.com/feed/',
    tier: 'Tier-2', affiliation: 'US maritime trade publication; often republishes wire copy (e.g. "(Bloomberg)")', language: 'en', intervalMin: 30, maxItems: 20,
    scope: 'Trade-press reporting on shipping; not an incident registry. Items quoting a wire share that wire\'s independence group.',
  },
  {
    id: 'splash247', name: 'Splash247 (maritime trade press)', kind: 'maritime', url: 'https://splash247.com/feed/',
    tier: 'Tier-2', affiliation: 'Hong Kong/Singapore-based maritime trade publication', language: 'en', intervalMin: 60, maxItems: 15,
    scope: 'Trade-press reporting on shipping; many items are not Middle-East related and are filtered out.',
  },
  {
    id: 'oilprice', name: 'OilPrice.com', kind: 'news', url: 'https://oilprice.com/rss/main',
    tier: 'Tier-2', affiliation: 'Energy news site with a large commentary/analysis mix; treat items as commentary unless sourced', language: 'en', intervalMin: 60, maxItems: 20,
  },
  {
    id: 'ofsi', name: 'UK OFSI — financial sanctions notices', kind: 'official', url: 'https://www.gov.uk/government/organisations/office-of-financial-sanctions-implementation.atom', sporadic: true,
    tier: 'Tier-1', affiliation: 'UK HM Treasury (official notices)', language: 'en', intervalMin: 120, maxItems: 20,
    scope: 'Notices/guidance; many are generic licences unrelated to the Middle East and are filtered out.',
  },
  {
    id: 'inbox', name: 'Advisory emails (user-supplied .eml)', kind: 'maritime', adapter: 'inbox', url: 'file://data/inbox', sporadic: true,
    tier: 'Tier-2', affiliation: 'Advisory emails the user is entitled to receive, saved as .eml in data/inbox/; each sender\'s tier comes from data/inbox/senders.json (default: unrated)', language: 'en', intervalMin: 15, maxItems: 300,
    scope: 'Only what the user chooses to drop in. An empty inbox means nothing was supplied, not that nothing happened.',
  },
  {
    id: 'easa-czib', name: 'EASA — conflict-zone bulletins (CZIB)', kind: 'official', adapter: 'easa', url: 'https://www.easa.europa.eu/en/domains/air-operations/czibs', sporadic: true, bounds: BOUNDS_MULTIPAGE_2,
    tier: 'Tier-1', affiliation: 'EU Aviation Safety Agency (official); day-precision dates', language: 'en', intervalMin: 360, maxItems: 40,
    scope: 'EASA\'s airspace risk assessment for EU air operators; not a statement that any specific flight is or is not safe. The text excerpt is EASA\'s own description.',
  },
  {
    id: 'ofac', name: 'US Treasury OFAC — recent actions', kind: 'official', adapter: 'ofac', url: 'https://ofac.treasury.gov/recent-actions', sporadic: true,
    tier: 'Tier-1', affiliation: 'US Treasury (official); date-only timestamps', language: 'en', intervalMin: 120, maxItems: 10,
    scope: 'Announcement titles only; the linked notice names the affected parties. No legal-effect interpretation is made here.',
  },
  {
    id: 'fcdo', name: 'UK FCDO — travel-advice changes', kind: 'official', adapter: 'fcdo', url: 'https://www.gov.uk/api/content/foreign-travel-advice', sporadic: true, bounds: BOUNDS_MULTIPAGE_14,
    tier: 'Tier-1', affiliation: 'UK Foreign, Commonwealth & Development Office (official)', language: 'en', intervalMin: 180, maxItems: 200,
    scope: 'The UK government\'s advice to British nationals — its own assessment, not ground truth. Routine administrative edits are stored but filtered out.',
  },
  {
    id: 'gn-hormuz', name: 'Google News headlines — Strait of Hormuz', kind: 'news', adapter: 'gnews', url: 'https://news.google.com/rss/search', query: '"Strait of Hormuz" when:2d',
    tier: 'Tier-2', affiliation: 'Headline discovery via Google News search; the publisher named on each item sets its tier', language: 'en', intervalMin: 60, maxItems: 25,
    scope: 'Headline and link only (Google redirect). A headline is not a verified claim; open the publisher for the story.',
  },
  {
    id: 'gn-redsea', name: 'Google News headlines — Red Sea shipping Houthi', kind: 'news', adapter: 'gnews', url: 'https://news.google.com/rss/search', query: 'Red Sea shipping Houthi when:2d',
    tier: 'Tier-2', affiliation: 'Headline discovery via Google News search; the publisher named on each item sets its tier', language: 'en', intervalMin: 60, maxItems: 25,
    scope: 'Headline and link only (Google redirect). A headline is not a verified claim; open the publisher for the story.',
  },
  {
    id: 'gn-iranoil', name: 'Google News headlines — Iran oil exports tanker', kind: 'news', adapter: 'gnews', url: 'https://news.google.com/rss/search', query: 'Iran oil exports tanker when:2d',
    tier: 'Tier-2', affiliation: 'Headline discovery via Google News search; the publisher named on each item sets its tier', language: 'en', intervalMin: 60, maxItems: 25,
    scope: 'Headline and link only (Google redirect). A headline is not a verified claim; open the publisher for the story.',
  },
  {
    id: 'gn-saudi', name: 'Google News headlines — Saudi Arabia Houthi attack', kind: 'news', adapter: 'gnews', url: 'https://news.google.com/rss/search', query: 'Saudi Arabia Houthi attack when:2d',
    tier: 'Tier-2', affiliation: 'Headline discovery via Google News search; the publisher named on each item sets its tier', language: 'en', intervalMin: 60, maxItems: 25,
    scope: 'Headline and link only (Google redirect). A headline is not a verified claim; open the publisher for the story.',
  },
  {
    id: 'presstv', name: 'Press TV', kind: 'news', url: 'https://www.presstv.co.uk/rss.xml', dateFromUrl: true,
    tier: 'Tier-3', affiliation: 'Iranian state broadcaster (IRIB) — state narrative; needs independent corroboration. Feed has no timestamps: dates come from article URLs (date only)', language: 'en', intervalMin: 30, maxItems: 25,
  },
  {
    id: 'aljazeera-ar', name: 'Al Jazeera Arabic', kind: 'news', url: 'https://www.aljazeera.net/rss',
    tier: 'Tier-2', affiliation: 'Funded by the State of Qatar; Arabic-language; original text with on-demand machine English translation; entity/topic matching uses a small hand-written Arabic dictionary (unverified by a native reader)', language: 'ar', intervalMin: 30, maxItems: 25,
  },
  {
    id: 'irna-fa', name: 'IRNA Persian', kind: 'news', url: 'https://www.irna.ir/rss',
    tier: 'Tier-3', affiliation: 'Iranian state news agency (Persian, untranslated) — state narrative, mostly domestic news; Persian dictionary matching unverified by a native reader', language: 'fa', intervalMin: 30, maxItems: 30,
  },
  {
    id: 'reliefweb-me', name: 'ReliefWeb (UN OCHA)', kind: 'official',
    url: 'https://reliefweb.int/updates/rss.xml?search=middle%20east',
    tier: 'Tier-1', affiliation: 'UN OCHA platform; each item credits its originating organisation', language: 'en', intervalMin: 60, maxItems: 20,
    enabled: false,
    blockedReason: 'HTTP 406 "Blocked due to bot activity" for scripted clients. Not bypassed. Next step: request an approved appname for the ReliefWeb API (hdx@un.org).',
  },
];

const HISTORY_NEWEST: NewestQuery = {
  sql: 'SELECT MAX(h.t) v FROM price_history h JOIN markets m ON m.condition_id = h.condition_id WHERE m.venue = ?',
  unit: 's',
};
const HISTORY_FRESHNESS: FreshnessPolicy = { basis: 'history', current_s: 3 * H, note: 'newest stored history point' };

export const POLYMARKET_SOURCE: SourceDefinition = {
  id: 'polymarket', name: 'Polymarket (Gamma + CLOB)', kind: 'prediction_market', intervalMin: 10, bounds: BOUNDS_MARKET,
  freshness: HISTORY_FRESHNESS, newest: HISTORY_NEWEST,
};

export const KALSHI_SOURCE: SourceDefinition = {
  id: 'kalshi', name: 'Kalshi (public market data)', kind: 'prediction_market', intervalMin: 10, bounds: BOUNDS_MARKET,
  freshness: HISTORY_FRESHNESS, newest: HISTORY_NEWEST,
};

/** Non-news data feeds (series). Health is tracked like any other source. */
export const SENSOR_SOURCES: SourceDefinition[] = [
  {
    id: 'portwatch', name: 'IMF PortWatch (chokepoint transits)', kind: 'sensor', intervalMin: 360, bounds: BOUNDS_DAILY_SERIES,
    freshness: { basis: 'observation', current_s: 1.5 * D, delayed_s: 10 * D, note: 'IMF PortWatch publishes daily series with a delay of several days; the observation date is shown and the series is never live' },
    newest: { sql: 'SELECT MAX(t) v FROM series_points WHERE series_id LIKE ?', args: ['pw:%'], unit: 's' },
  },
  {
    id: 'fred', name: 'FRED (Brent/WTI spot)', kind: 'sensor', intervalMin: 360, bounds: BOUNDS_DAILY_SERIES,
    freshness: { basis: 'observation', current_s: 3 * D, delayed_s: 10 * D, note: 'FRED/EIA spot prices are published with a delay of days (weekends and holidays have no observation)' },
    newest: { sql: 'SELECT MAX(t) v FROM series_points WHERE series_id LIKE ?', args: ['fred:%'], unit: 's' },
  },
  {
    id: 'opensky', name: 'OpenSky (air traffic)', kind: 'sensor', intervalMin: 30, bounds: BOUNDS_OPENSKY,
    freshness: { basis: 'observation', current_s: 2 * H, note: 'our own series; samples are taken each poll' },
    newest: { sql: 'SELECT MAX(t) v FROM series_points WHERE series_id LIKE ?', args: ['opensky:%'], unit: 's' },
  },
  {
    id: 'ioda', name: 'IODA (internet routing)', kind: 'sensor', intervalMin: 120, bounds: BOUNDS_IODA,
    freshness: { basis: 'observation', current_s: 6 * H, note: 'hourly points over a 7-day window' },
    newest: { sql: 'SELECT MAX(t) v FROM series_points WHERE series_id LIKE ?', args: ['ioda:%'], unit: 's' },
  },
];

/** Telegram public-channel preview. Viewpoint-labelled discovery source; never mixed into the news tiers. */
/** Polymarket public data API v2 (no key): bounded pilot collection for the Wallet activity view (Package E). */
const TAPE_FRESHNESS: FreshnessPolicy = { basis: 'observation', current_s: 6 * H, note: 'newest trade/activity timestamp; quiet markets and wallets can go hours without a trade' };

export const WALLET_SOURCES: SourceDefinition[] = [
  {
    id: 'pm-trades', name: 'Polymarket market trades (pilot markets)', kind: 'wallet', intervalMin: 5, bounds: BOUNDS_PILOT_TRADES,
    freshness: TAPE_FRESHNESS, newest: { sql: 'SELECT MAX(ts) * 1000 v FROM pm_market_trades', args: [], unit: 'ms' },
  },
  {
    id: 'pm-wallets', name: 'Polymarket watched-wallet activity & positions', kind: 'wallet', intervalMin: 15, bounds: BOUNDS_PILOT_WALLETS,
    freshness: TAPE_FRESHNESS, newest: { sql: 'SELECT MAX(ts) * 1000 v FROM pm_wallet_activity', args: [], unit: 'ms' },
  },
  {
    id: 'pm-holders', name: 'Polymarket top holders (pilot markets)', kind: 'wallet', intervalMin: 60, bounds: BOUNDS_PILOT_HOLDERS,
    freshness: { basis: 'observation', current_s: 3 * H, note: 'snapshot time (provider ranking at that moment)' },
    newest: { sql: "SELECT MAX(strftime('%s', snapshot_at)) * 1000 v FROM pm_holders", args: [], unit: 'ms' },
  },
  {
    id: 'pm-leaderboard', name: 'Polymarket leaderboard (candidate discovery)', kind: 'wallet', intervalMin: 1440, bounds: BOUNDS_PILOT_LEADERBOARD,
    freshness: { basis: 'observation', current_s: 2 * D, note: 'snapshot time (provider ranking at that moment)' },
    newest: { sql: "SELECT MAX(strftime('%s', captured_at)) * 1000 v FROM pm_leaderboard", args: [], unit: 'ms' },
  },
];

/** intervalMin = 5: the pilot's public-preview polling target (a target, not a delivery guarantee); runs on its own scheduler. */
export const TELEGRAM_SOURCE: SourceDefinition = {
  id: 'telegram', name: 'Telegram (public channel preview)', kind: 'social', intervalMin: 5, bounds: BOUNDS_TELEGRAM,
  freshness: { basis: 'post', current_s: 6 * H, note: 'newest post publication time' },
  newest: { sql: 'SELECT MAX(posted_at) v FROM tg_posts', args: [], unit: 'iso' },
};
/**
 * Registry metadata by source id. Six modules and a test each built their own copy of this map;
 * it is a constant, so it is built once.
 */
export const SOURCE_META: ReadonlyMap<string, NewsSource> = new Map(NEWS_SOURCES.map((s) => [s.id, s]));

/**
 * Every collectable source, in one list. This is the only place that enumerates them; consumers
 * derive what they need from the entry's kind and traits rather than re-listing ids.
 */
export const ALL_SOURCES: SourceDefinition[] = [
  POLYMARKET_SOURCE, KALSHI_SOURCE, TELEGRAM_SOURCE,
  ...SENSOR_SOURCES, ...WALLET_SOURCES, ...NEWS_SOURCES,
];
