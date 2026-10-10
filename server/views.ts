import type { DatabaseSync } from 'node:sqlite';
import type { LinkedContract, Market, Tier, TrackerEvent } from '../shared/types.ts';
import type { NewsSource } from './registry.ts';
import { linkAssets, type AssetLink } from './assets.ts';
import { isEnergyShippingFocus } from './geo.ts';
import { extractEventTime } from './eventtime.ts';
import { vesselTypeSummary } from './maritime/types.ts';
import { storyFor } from './story.ts';

/**
 * The read models the API serves.
 *
 * These used to be private functions inside server/index.ts — the same file that registers routes,
 * opens the stream, boots Vite and handles signals. Nothing could assert a derived field without an
 * HTTP round trip, and briefing.ts had already grown a second, divergent event shaper. They now live
 * here with the two store-reading lookups injected, so a test can drive them with plain rows.
 */

type Row = Record<string, any>;
const parse = <T>(s: string | null | undefined, fb: T): T => { try { return s ? (JSON.parse(s) as T) : fb; } catch { return fb; } };

export interface EventViewDeps {
  /** Registry metadata per source id, used for names, tiers, affiliation and scope. */
  sourceMeta: ReadonlyMap<string, NewsSource>;
  /** Curated-asset relations. Injected because the default reads data/assets.json. */
  linkAssets?: (text: string, location: { name: string; lat: number; lng: number; precision: string } | null) => AssetLink[];
  /** Cross-outlet story grouping. Injected because the default reads the store. */
  storyFor?: (eventId: string) => TrackerEvent['story'];
}

/** One contract as the API presents it, including the quote spread it implies. */
export function marketView(r: Row): Market {
  const spread = r.best_bid != null && r.best_ask != null ? r.best_ask - r.best_bid : r.spread ?? null;
  return {
    is_open: Boolean(r.is_open), condition_id: r.condition_id, venue: r.venue, volume_unit: r.volume_unit, open_interest: r.open_interest, event_id: r.event_id, event_title: r.event_title, question: r.question, outcome_label: r.outcome_label,
    price: r.price, quote_basis: r.quote_basis, best_bid: r.best_bid, best_ask: r.best_ask, spread, wide_spread: spread != null && spread > 0.1,
    one_day_change: r.one_day_change, one_week_change: r.one_week_change, volume_total: r.volume_total, volume_24h: r.volume_24h, liquidity: r.liquidity,
    end_date: r.end_date, start_date: r.start_date, provider_updated_at: r.provider_updated_at, observed_at: r.observed_at,
    resolution_url: r.url ?? `https://polymarket.com/event/${r.event_slug}`, resolution_text: r.resolution_text, tags: parse<string[]>(r.tags, []),
    history_points: r.history_points ?? 0,
  };
}

export const MARKET_SELECT = `SELECT m.*, (SELECT COUNT(*) FROM price_history h WHERE h.condition_id = m.condition_id) AS history_points FROM markets m`;

/**
 * One stored item as the API presents it. Every derived field — focus, place events, vessel types,
 * asset relations, story grouping — is computed here and nowhere else.
 */
export function eventView(
  r: Row,
  links: LinkedContract[],
  deps: EventViewDeps,
): TrackerEvent {
  const meta = deps.sourceMeta.get(r.source_id);
  const assetsFor = deps.linkAssets ?? linkAssets;
  const storyOf = deps.storyFor ?? storyFor;
  const assets = assetsFor(`${r.title}. ${r.summary}`, r.location_name ? { name: r.location_name, lat: r.lat, lng: r.lng, precision: r.loc_precision } : null);
  return {
    focus_energy_shipping: isEnergyShippingFocus(parse<string[]>(r.topics, []), parse<string[]>(r.entities, []), assets.length > 0 || meta?.kind === 'maritime'),
    event_time: r.time_precision === 'date' ? null : extractEventTime(`${r.title}. ${r.summary}`, r.published_at),
    id: r.id, timestamp: r.published_at, collected_at: r.first_seen_at, source_id: r.source_id, source_name: r.publisher ? `${r.publisher} (via Google News)` : meta?.name ?? r.source_id,
    originating_source: r.originating_source, source_affiliation: meta?.affiliation ?? '', source_scope: meta?.scope ?? null, modified_at: r.modified_at ?? null, revision_count: r.revision_count ?? 0, reliability_tier: ((r.tier as Tier | null) ?? meta?.tier ?? 'Tier-3') as Tier,
    claim_status: 'reported', time_precision: r.time_precision ?? 'instant', publisher: r.publisher ?? null, title: r.title,
    feed_key: `web:${r.source_id}:${r.external_id}`,
    vessel_types: vesselTypeSummary(`${r.title}. ${r.summary}`),
    publisher_time_note: r.publisher_time_raw ? `The feed states ${r.publisher_time_raw}, which is later than when this tracker first collected the item; it is placed at collection time. The feed's time-zone label is probably wrong; no offset is guessed.` : null,
    location: r.location_name ? { name: r.location_name, lat: r.lat, lng: r.lng, precision: r.loc_precision } : null,
    entities: parse<string[]>(r.entities, []), topics: parse<string[]>(r.topics, []), summary: r.summary, raw_url: r.raw_url,
    language: r.language, relevant: !!r.relevant, linked_contracts: links, story: storyOf(r.id),
    assets,
  };
}

/** Contracts linked to these items, best score first. One query for the whole page. */
export function linksFor(db: DatabaseSync, ids: string[]): Map<string, LinkedContract[]> {
  const out = new Map<string, LinkedContract[]>();
  if (!ids.length) return out;
  const rows = db.prepare(`SELECT l.event_id, l.condition_id, l.score, l.matched_entities, l.matched_topics, m.question, m.price, m.venue
    FROM event_market_links l JOIN markets m ON m.condition_id = l.condition_id AND m.is_open = 1
    WHERE l.event_id IN (${ids.map(() => '?').join(',')}) ORDER BY l.score DESC, m.volume_24h DESC`).all(...ids) as Row[];
  for (const r of rows) {
    const a = out.get(r.event_id) ?? [];
    a.push({ condition_id: r.condition_id, venue: r.venue, question: r.question, price: r.price, score: r.score, matched_entities: parse(r.matched_entities, []), matched_topics: parse(r.matched_topics, []) });
    out.set(r.event_id, a);
  }
  return out;
}
