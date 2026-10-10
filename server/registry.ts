import type { Tier } from '../shared/types.ts';

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
    id: 'un-news-me', name: 'UN News — Middle East', kind: 'official',
    url: 'https://news.un.org/feed/subscribe/en/news/region/middle-east/feed/rss.xml',
    tier: 'Tier-1', affiliation: 'United Nations (official organisational reporting; reflects UN positions)', language: 'en', intervalMin: 60, maxItems: 20,
  },
  {
    id: 'un-press', name: 'UN Press — meetings & statements', kind: 'official',
    url: 'https://press.un.org/en/rss.xml',
    tier: 'Tier-1', affiliation: 'United Nations (official meeting coverage and statements; global scope, filtered here to Middle East)', language: 'en', intervalMin: 60, maxItems: 20,
  },
  {
    id: 'maersk-advisories', name: 'Maersk — Middle East advisories', kind: 'maritime', adapter: 'maersk',
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
    id: 'ofsi', name: 'UK OFSI — financial sanctions notices', kind: 'official', url: 'https://www.gov.uk/government/organisations/office-of-financial-sanctions-implementation.atom',
    tier: 'Tier-1', affiliation: 'UK HM Treasury (official notices)', language: 'en', intervalMin: 120, maxItems: 20,
    scope: 'Notices/guidance; many are generic licences unrelated to the Middle East and are filtered out.',
  },
  {
    id: 'inbox', name: 'Advisory emails (user-supplied .eml)', kind: 'maritime', adapter: 'inbox', url: 'file://data/inbox',
    tier: 'Tier-2', affiliation: 'Advisory emails the user is entitled to receive, saved as .eml in data/inbox/; each sender\'s tier comes from data/inbox/senders.json (default: unrated)', language: 'en', intervalMin: 15, maxItems: 300,
    scope: 'Only what the user chooses to drop in. An empty inbox means nothing was supplied, not that nothing happened.',
  },
  {
    id: 'easa-czib', name: 'EASA — conflict-zone bulletins (CZIB)', kind: 'official', adapter: 'easa', url: 'https://www.easa.europa.eu/en/domains/air-operations/czibs',
    tier: 'Tier-1', affiliation: 'EU Aviation Safety Agency (official); day-precision dates', language: 'en', intervalMin: 360, maxItems: 40,
    scope: 'EASA\'s airspace risk assessment for EU air operators; not a statement that any specific flight is or is not safe. The text excerpt is EASA\'s own description.',
  },
  {
    id: 'ofac', name: 'US Treasury OFAC — recent actions', kind: 'official', adapter: 'ofac', url: 'https://ofac.treasury.gov/recent-actions',
    tier: 'Tier-1', affiliation: 'US Treasury (official); date-only timestamps', language: 'en', intervalMin: 120, maxItems: 10,
    scope: 'Announcement titles only; the linked notice names the affected parties. No legal-effect interpretation is made here.',
  },
  {
    id: 'fcdo', name: 'UK FCDO — travel-advice changes', kind: 'official', adapter: 'fcdo', url: 'https://www.gov.uk/api/content/foreign-travel-advice',
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

export const POLYMARKET_SOURCE = {
  id: 'polymarket', name: 'Polymarket (Gamma + CLOB)', kind: 'prediction_market' as const, intervalMin: 10,
};

export const KALSHI_SOURCE = {
  id: 'kalshi', name: 'Kalshi (public market data)', kind: 'prediction_market' as const, intervalMin: 10,
};

/** Non-news data feeds (series). Health is tracked like any other source. */
export const SENSOR_SOURCES = [
  { id: 'portwatch', name: 'IMF PortWatch (chokepoint transits)', kind: 'sensor' as const, intervalMin: 360 },
  { id: 'fred', name: 'FRED (Brent/WTI spot)', kind: 'sensor' as const, intervalMin: 360 },
  { id: 'opensky', name: 'OpenSky (air traffic)', kind: 'sensor' as const, intervalMin: 30 },
  { id: 'ioda', name: 'IODA (internet routing)', kind: 'sensor' as const, intervalMin: 120 },
];

/** Telegram public-channel preview. Viewpoint-labelled discovery source; never mixed into the news tiers. */
/** Polymarket public data API v2 (no key): bounded pilot collection for the Wallet activity view (Package E). */
export const WALLET_SOURCES = [
  { id: 'pm-trades', name: 'Polymarket market trades (pilot markets)', kind: 'wallet' as const, intervalMin: 5 },
  { id: 'pm-wallets', name: 'Polymarket watched-wallet activity & positions', kind: 'wallet' as const, intervalMin: 15 },
  { id: 'pm-holders', name: 'Polymarket top holders (pilot markets)', kind: 'wallet' as const, intervalMin: 60 },
  { id: 'pm-leaderboard', name: 'Polymarket leaderboard (candidate discovery)', kind: 'wallet' as const, intervalMin: 1440 },
];

/** intervalMin = 5: the pilot's public-preview polling target (a target, not a delivery guarantee); runs on its own scheduler. */
export const TELEGRAM_SOURCE = { id: 'telegram', name: 'Telegram (public channel preview)', kind: 'social' as const, intervalMin: 5 };
