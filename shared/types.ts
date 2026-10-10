// Shapes returned by /api/*. Kept dependency-free so both server and UI import them.

export type Tier = 'Tier-1' | 'Tier-2' | 'Tier-3';
export type LocationPrecision = 'point' | 'city' | 'region' | 'country';

export interface EventLocation {
  name: string;
  lat: number;
  lng: number;
  /** point/city = specific place; region = strait/sea/area; country = centroid (approximate only) */
  precision: LocationPrecision;
}

export interface StoryInfo {
  story_id: string;
  size: number;
  publishers: { source_id: string; name: string; tier: string; event_id: string; title: string; timestamp: string }[];
  independence_groups: number;
  state_only: boolean;
  note: string;
}

export interface LinkedContract {
  condition_id: string;
  venue: 'polymarket' | 'kalshi';
  question: string;
  price: number | null;
  score: number;
  matched_entities: string[];
  matched_topics: string[];
}

/** Universal event schema (superset of the planned one; `linked_contract_id` -> `linked_contracts`). */
export interface TrackerEvent {
  id: string;
  /** Publication time of the source item (ISO-8601 UTC). The reported event time is not extracted at this stage. */
  timestamp: string;
  collected_at: string;
  source_id: string;
  source_name: string;
  /** e.g. "UN OCHA platform; item originates from UNHCR" */
  originating_source: string | null;
  source_affiliation: string;
  /** What this source's statements cover; null when no special scope caveat applies. */
  source_scope: string | null;
  /** Publisher-reported last update; present when the item was revised after publication. */
  modified_at: string | null;
  revision_count: number;
  reliability_tier: Tier;
  claim_status: 'reported';
  /** 'date' = the source gives only a day (no time of day); the timestamp is that day at 00:00 UTC. */
  time_precision: 'instant' | 'date';
  /** Set when the publisher's stated time was later than first collection; `timestamp` is then the collection time. */
  publisher_time_note: string | null;
  /** Stable feed identity (platform + source + external id) used by research references. */
  feed_key: string;
  /** Vessel types the text names explicitly, with the words used (J1). Wording only — not cargo, owner or status. */
  vessel_types: { type: string; label: string; span: string }[];
  /** Publisher when the feed aggregates several (e.g. Google News headline discovery). */
  publisher: string | null;
  title: string;
  location: EventLocation | null;
  entities: string[];
  topics: string[];
  summary: string;
  raw_url: string;
  language: string;
  relevant: boolean;
  linked_contracts: LinkedContract[];
  /** true = energy, shipping, sanctions, a chokepoint/energy-company entity or a mapped asset; false = regional context. */
  focus_energy_shipping: boolean;
  /** When the item says the thing happened (day precision), if it says so explicitly; null otherwise. Distinct from publication time. */
  event_time: { start: string; precision: 'day'; basis: string } | null;
  /** Curated assets this item explicitly names or is located at, with documented company relationships. Not evidence of disruption. */
  assets: AssetLink[];
  /** Related coverage from other outlets (headline/entity similarity). Not verification. */
  story: StoryInfo | null;
}

export type QuoteBasis = 'midpoint' | 'last_trade' | 'provider_price';

export type Venue = 'polymarket' | 'kalshi';

export interface Market {
  /** Stored provider flag; non-open does not by itself mean resolved. */
  is_open?: boolean;
  condition_id: string;
  venue: Venue;
  /** Unit of volume_*: Polymarket reports USD; Kalshi reports contracts. Not comparable across venues. */
  volume_unit: 'USD' | 'contracts';
  open_interest: number | null;
  event_id: string;
  event_title: string;
  question: string;
  outcome_label: string;
  price: number | null;
  quote_basis: QuoteBasis | null;
  best_bid: number | null;
  best_ask: number | null;
  spread: number | null;
  wide_spread: boolean;
  one_day_change: number | null;
  one_week_change: number | null;
  volume_total: number | null;
  volume_24h: number | null;
  liquidity: number | null;
  end_date: string | null;
  start_date: string | null;
  /** Provider's last update of the market record. */
  provider_updated_at: string | null;
  /** When this tracker last observed it. */
  observed_at: string;
  resolution_url: string;
  resolution_text: string;
  tags: string[];
  history_points: number;
}

export interface HistoryPoint { t: number; p: number }

export interface MarketHistory {
  condition_id: string;
  outcome_label: string;
  basis: string;
  fetched_at: string | null;
  points: HistoryPoint[];
}

export interface SourceHealth {
  source_id: string;
  name: string;
  kind: 'prediction_market' | 'news' | 'official' | 'maritime' | 'analysis' | 'sensor' | 'social' | 'wallet';
  last_attempt_at: string | null;
  last_success_at: string | null;
  status: 'ok' | 'error' | 'never' | 'blocked';
  items: number | null;
  error: string | null;
  expected_interval_min: number;
  stale: boolean;
  /** Consecutive failed attempts; at 3+ the automatic cycle skips the source until breaker_open_until (a manual refresh still retries). */
  consecutive_failures: number;
  breaker_open_until: string | null;
  /** When the next automatic attempt is due (null for disabled sources or before the first attempt). */
  next_attempt_at: string | null;
  /** Age of the newest DATA (not of the fetch), judged against this provider's own publication rhythm. */
  freshness: { basis: 'publication' | 'observation' | 'history' | 'post'; newest_at: string | null; age_s: number | null; assessment: 'current' | 'delayed' | 'quiet' | 'old' | 'unknown'; note: string };
}

export interface Status {
  collection_paused?: boolean;
  /** 'seed' = offline snapshot of previously captured data; never live. */
  mode: 'live' | 'seed';
  seed_captured_at: string | null;
  refreshing: boolean;
  last_refresh_finished_at: string | null;
  sources: SourceHealth[];
  /** Per-source input versions; a view refetches when the versions of the sources it reads change. */
  versions: Record<string, number>;
  counts: { events: number; events_relevant: number; markets: number; observations: number; history_points: number };
  server_time: string;
}

export interface AssetFact { claim: string; source_title: string; source_url: string; source_date: string | null; period: string; unit: string }
export interface Asset {
  id: string; name: string; type: string; lat: number; lng: number; precision: LocationPrecision;
  line?: [number, number][]; line_note?: string; facts: AssetFact[]; caveat: string; verified_by: string;
}
export interface AssetRelation { company: string; relation: string; asset_id: string; detail: string; source_url: string; valid_as_of: string; verified_by: string }
export interface AssetsFile { _readme: string; retrieved_at: string; assets: Asset[]; relations: AssetRelation[]; not_included: string[] }

export interface SensorSeries {
  id: string; group: 'chokepoint' | 'price' | 'airspace' | 'connectivity'; title: string; unit: string; style: 'bar' | 'line';
  provider: string; source_url: string; caveat: string; intervalMin: number;
  points: [number, number][]; as_of: number | null; fetched_at: string | null;
}

export interface TgMedia { type: 'photo' | 'video' | 'round_video' | 'voice' | 'document' | 'unsupported'; url: string | null; thumb: string | null; duration: string | null; note?: string }
export interface TgMatch { strength: 'strong' | 'weak'; event_id: string; title: string; published_at: string; outlet: string; tier: string; similarity: number; delta_min: number; url: string }
export type TgCorroboration = 'matched_tier12' | 'matched_tier3_only' | 'weak_match' | 'no_match' | 'not_assessed';
export interface TgPost {
  channel: string; post_id: number; posted_at: string; edited: boolean; text: string; views: number | null; forwarded_from: string | null; forwarded_url: string | null; reply_to: number | null;
  media: TgMedia[]; link_preview: { url: string; title: string; site: string; description: string } | null; url: string; lang: string | null;
  entities: string[]; topics: string[]; flags: string[]; location: { name: string; lat: number; lng: number; precision: 'point' | 'city' | 'region' | 'country' } | null;
  report_kind: string; claim_kinds: string[]; attributions: string[]; hashtags: string[]; domains: string[]; corroboration: TgCorroboration; matches: TgMatch[];
}
export interface TgOverview {
  channel: string | null; info: { title: string | null; description: string | null; subscribers: number | null; counters: string[]; fetched_at: string; last_attempt_at: string | null; last_error: string | null; gap_note: string | null } | null;
  window_days: number; posts: number; with_text: number; per_day: { day: string; count: number }[]; per_hour_utc: number[];
  topics: { name: string; count: number }[]; report_kinds: { name: string; count: number }[]; languages: { name: string; count: number }[]; claim_kinds: { name: string; count: number }[];
  media: Record<'photo' | 'video' | 'round_video' | 'voice' | 'document' | 'text_only' | 'forward' | 'reply' | 'with_link', number>;
  top_entities: { name: string; count: number }[]; top_flags: { name: string; count: number }[]; top_attributions: { name: string; count: number }[];
  attribution: { claim_posts: number; with_attribution: number };
  places: { name: string; n: number; lat: number; lng: number; precision: string }[];
  network: { nodes: { name: string; count: number }[]; edges: { a: string; b: string; weight: number }[] };
  views: { kind: string; n: number; median: number | null; p90: number | null }[];
  corroboration: Record<TgCorroboration, number>; lead_minutes: { n: number; median: number | null; samples: number[] }; notes: string[];
}

export interface AssetLink {
  asset_id: string; name: string; type: string; relation: 'explicitly_named' | 'same_reported_location'; evidence: string;
  relations: { company: string; relation: string; detail: string; source_url: string; valid_as_of: string; verified_by: string }[];
}

export interface Counterpart {
  condition_id: string; venue: Venue; question: string; price: number | null; quote_basis: QuoteBasis | null; end_date: string | null; rules_excerpt: string; url: string | null;
  score: number; end_delta_days: number | null; shared_entities: string[]; verified: boolean; verified_by: string | null; rules_note: string | null; warnings: string[];
}

export interface TgChannel { channel: string; title: string | null; subscribers: number | null; fetched_at: string; last_attempt_at: string | null; last_error: string | null; gap_note: string | null; posts: number }

// ───────── indicators / watchlist / preferences (server/indicators/service.ts) ─────────
import type { IndStatus } from './indicators';
export interface WatchItem { kind: 'market' | 'sensor'; id: string }
export interface WatchCard {
  key: string; kind: 'market' | 'sensor'; id: string; title: string; subtitle: string; venue: string | null; unit: string;
  latest: { value: number | null; label: string; observed_at: string | null; fetched_at: string | null; basis: string | null };
  change: { window: string; value: number | null; unit: string; status: IndStatus; reason: string | null; interval_s: number | null; detail: string } | null;
  sparkline: [number, number][]; status: IndStatus; note: string | null;
}
export interface Prefs { indicators: string[]; axis: 'auto' | 'fixed'; range: '24h' | '7d' | '30d' | 'all'; /** Optional sub-plots below the chart (rsi14, macd); empty by default. */ panes?: string[] }
export interface ReactionResult {
  status: IndStatus; reason: string | null; event_t: number; hour_bucket: number | null;
  prev: { t: number; p_pct: number } | null; in_hour: { t: number; p_pct: number } | null; next: { t: number; p_pct: number } | null; day_after: { t: number; p_pct: number } | null;
  move_event_hour_pp: number | null; move_next_hour_pp: number | null; level_change_24h_pp: number | null;
  baseline: { n: number; median_pp: number; p95_pp: number } | null;
  label_event_hour: 'within_ordinary' | 'above_typical' | 'above_p95' | 'unavailable'; label_next_hour: 'within_ordinary' | 'above_typical' | 'above_p95' | 'unavailable';
  caveats: string[]; definition_version: string; input_version: string;
}
export interface ActivityResponse {
  as_of: string; windows: { window: string; collected: { total: number; news: number; official: number; telegram: number }; late_collected: number }[];
  publication_distribution_24h: { hour_utc: string; items: number }[]; coverage: { sources_reporting: number; sources_ok: number; success_rate: number | null }; notes: string[];
}

// ── Package D: unified feed ──
export type FeedKind = 'news' | 'official' | 'maritime' | 'telegram';
export interface FeedItem {
  /** Stable identity: platform + source/channel + external id. */
  key: string; platform: 'web' | 'telegram'; kind: FeedKind; source_id: string; source_name: string;
  title: string; text: string; published_at: string; collected_at: string; time_precision: 'instant' | 'date'; url: string;
  language: string | null; topics: string[]; place: string | null;
  /** News tier for web items; always null for Telegram (never forced into the news tiers). */
  tier: Tier | null; viewpoint_label: string | null;
  forward_origin: string | null; event_id: string | null; matches: { event_id: string; strength: string; similarity: number }[];
  /** Backfilled / gap-recovered / late-found: shown in place, never counted as a new arrival. */
  backfill: boolean;
  /** How the item was first collected: latest poll, Telegram history backfill / gap recovery, a late-found web item, or unknown (collected before this was recorded). */
  collected_via: 'latest' | 'backfill' | 'gap' | 'late_find' | 'unknown';
  revised: boolean; publisher_time_raw: string | null;
}
export interface FeedResponse { items: FeedItem[]; next_cursor: string | null; snapshot_at: string; notes: string[] }

// ── Package D / J2: sources view ──
export interface SourceConfigView {
  source_id: string; interval_min: number; request_budget: number; default_interval_min: number; default_budget: number;
  bounds: { interval: [number, number]; budget: [number, number]; budgetDefault: number; budgetUnit: string };
  version: number; updated_at: string | null; overridden: boolean; last_run: { at: string; requests: number; budget: number; exhausted: boolean } | null;
}
export interface TgChannelView {
  channel: string; enabled: boolean; added_by: string; title: string | null; subscribers: number | null; posts: number;
  last_attempt_at: string | null; last_error: string | null; next_attempt_at: string | null; breaker_open_until: string | null;
  open_gaps: { id: number; low_id: number; high_id: number; cursor_before: number; opened_at: string; pages_used: number; recovered_posts: number }[];
  resolved_gaps_7d: number; lag: { n: number; median_s: number | null; p90_s: number | null; note: string };
  last_run: { started_at: string; finished_at: string | null; pages_latest: number; pages_gap: number; pages_history: number; inserted: number; error: string | null } | null;
}
export interface SourcesResponse {
  seed_mode: boolean; config_version: number; sources: { health: SourceHealth; config: SourceConfigView }[];
  telegram: { interval_min: number; pages_per_channel: number; busy: boolean; channels: TgChannelView[]; note: string };
}

// ── Package E: Wallet activity (Polymarket public data API v2) ──
export interface CoverageView {
  target: string; covered_since: string | null; covered_since_ts: number | null; last_ok_at: string | null;
  last_status: string; last_detail: string | null; stale: boolean;
  open_gaps: { from: string; to: string; opened_at: string; pages_used: number }[];
}
export interface WalletName { display_name: string | null; pseudonym: string | null }
export interface LargeTrade extends WalletName {
  key: string; condition_id: string; question: string; outcome: string; outcome_index: number; side: 'BUY' | 'SELL';
  size_shares: number; price_usdc: number; notional_usdc: number; ts: number; at: string; tx_hash: string;
  wallet: string; watched: boolean; criteria: string[]; first_seen_at: string; seen_via: string;
}
export interface NetTradeValue {
  label: string; window_h: number; since: string;
  by_market_outcome: { condition_id: string; title: string | null; outcome: string; outcome_index: number; buy_usdc: number; sell_usdc: number; net_usdc: number; trades: number; wallets: number }[];
  complete_wallets: number; partial_wallets: { wallet: string; reason: string }[]; excluded_activity: Record<string, number>;
  status: 'complete' | 'partial' | 'unavailable' | 'no_watched_wallets'; note: string;
}
export interface HolderGroup {
  token_id: string; outcome_index: number | null; snapshot_at: string; list_has_more: boolean;
  holders: ({ rank: number; wallet: string; amount_shares: number; watched: boolean } & WalletName)[];
  /** Always null: the API returns a ranked list without total shares outstanding, so no concentration share is computed. */
  concentration: null; note: string;
}
export interface PilotMarketView {
  condition_id: string; question: string; price: number | null; outcome_label: string | null; selection_rule: string; selected_at: string;
  trades_stored: number; oldest_trade_at: string | null; newest_trade_at: string | null; p95_notional_usdc: number | null; coverage: CoverageView;
}
export interface WalletPositionItem {
  condition_id: string; token_id: string; title: string | null; outcome: string | null; size_shares: number | null; entry_price_usdc: number | null; cost_usdc: number | null;
  current_price_usdc: number | null; current_value_usdc: number | null; realized_pnl_usdc: number | null; unrealized_pnl_usdc: number | null;
  status: string | null; redeemable: boolean | null; end_date: string | null; snapshot_at: string; tracked_market: boolean;
}
export interface WatchedWalletView extends WalletName {
  wallet: string; note: string | null; selection_rule: string; selected_at: string; open_positions: number; positions_value_usdc: number | null;
  /** Sums of provider-reported values; null when any position lacks the field (never assumed 0). */
  provider_unrealized_pnl_usdc: number | null; provider_realized_pnl_usdc: number | null;
  last_activity_at: string | null; activity_coverage: CoverageView; positions_coverage: CoverageView;
}
export interface WalletActivityItem {
  key: string; type: string; condition_id: string | null; title: string | null; outcome: string | null; side: string | null; size: number | null;
  usdc_size: number | null; price_usdc: number | null; ts: number; at: string; tx_hash: string; seen_via: string; tracked_market: boolean;
}
export interface WalletDetail { wallet: WatchedWalletView; positions: WalletPositionItem[]; activity: WalletActivityItem[]; net_24h: NetTradeValue; net_7d: NetTradeValue }
export interface LeaderboardSnapshot {
  time_period: string; order_by: string; category: string; snapshot_date: string; note: string;
  rows: { rank: number; wallet: string; display_name: string | null; pnl_usdc: number | null; volume_usdc: number | null; watched: boolean }[];
}
export interface WalletsOverview {
  seed_mode: boolean; notes: string[]; large_trade_usdc: number; pilot_markets: PilotMarketView[]; large_trades: LargeTrade[];
  watched: WatchedWalletView[]; net_24h: NetTradeValue; net_7d: NetTradeValue; leaderboards: LeaderboardSnapshot[];
}

// ── Package F: in-app alerts ──
/** Severity is shown separately from any direction colour; it says how much attention an alert asks for, not which way a price moved. */
export type AlertSeverity = 'info' | 'notice' | 'warning';
export interface AlertRuleView {
  id: string; title: string; description: string; kind: 'level' | 'event'; unit: string; bounds: [number, number];
  enabled: boolean; threshold: number; cooldown_min: number; version: number;
}
export interface AlertItem {
  id: string; rule_id: string; target_kind: string; target_id: string; target_label: string; title: string; detail: string; severity: AlertSeverity;
  value: number | null; threshold: number | null; unit: string | null; opened_at: string; last_seen_at: string; occurrences: number;
  recovered_at: string | null; acked_at: string | null; revised: boolean; evidence: Record<string, unknown>; definition_version: string;
}
export interface AlertsResponse { seed_mode: boolean; enabled: boolean; rules: AlertRuleView[]; items: AlertItem[]; unacked: number; definition_version: string; notes: string[] }

// ── Package K1 & J1: Maritime Directory & Vessel Watchlist ──
export interface MaritimeVessel {
  id: string; name: string; imo: string | null; mmsi: string | null;
  vessel_type: string; flag: string | null; deadweight: number | null;
  notes: string; external_refs: { site: string; url: string }[];
  watched: boolean; last_seen_at: string | null;
}

export interface MaritimeSourceRef {
  id: string; name: string; url: string; coverage: string; access_type: 'free_public' | 'credit_api' | 'subscription'; notes: string;
}

// ── Package H & L: Claims & Research Workspace ──
export interface ResearchDossier {
  id: string; title: string; description: string; workflow_state: 'open' | 'in_review' | 'resolved' | 'archived';
  created_at: string; updated_at: string; items_count: number; tasks_count: number; open_tasks: number;
}

export interface DossierItem {
  id: string; dossier_id: string; item_key: string; title: string; source_name: string;
  url: string; published_at: string; attached_at: string; rationale: string;
}

export interface ResearchTask {
  id: string; dossier_id: string; question: string; status: 'open' | 'resolved' | 'dismissed';
  created_at: string; resolved_at: string | null; resolution_note: string | null;
}

export interface ResearchHypothesis {
  id: string; title: string; statement: string; scope: string; status: 'untested' | 'supported' | 'contested' | 'invalidated';
  invalidation_conditions: string; next_check_at: string | null; created_at: string; updated_at: string;
  evidence_count: number;
}

export interface HypothesisEvidence {
  id: string; hypothesis_id: string; item_key: string; relationship: 'supports' | 'contradicts' | 'unclear';
  rationale: string; reviewer: string; reviewed_at: string;
}

export interface CalendarEntry {
  id: string; title: string; date: string; time_precision: 'date' | 'instant'; kind: 'contract_deadline' | 'official_event' | 'reporting_date';
  source_url: string; condition_id: string | null; notes: string;
}
