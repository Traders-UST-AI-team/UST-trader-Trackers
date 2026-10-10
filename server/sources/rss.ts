import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import { fetchText } from '../http.ts';
import { db, tx } from '../db.ts';
import { bump } from '../versions.ts';
import { extractEntities, extractTopics, geolocate, isMiddleEastRelevant } from '../geo.ts';
import type { NewsSource } from '../registry.ts';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: true, trimValues: true });

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#8217': '’', '#8211': '–', '#8212': '—', '#8216': '‘', '#8220': '“', '#8221': '”' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, g: string) => {
    if (ENT[g]) return ENT[g];
    if (g.startsWith('#x')) return String.fromCodePoint(parseInt(g.slice(2), 16));
    if (g.startsWith('#')) return String.fromCodePoint(parseInt(g.slice(1), 10));
    return m;
  });
}
export const stripHtml = (s: string): string => decodeEntities(s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Drop tracking params; keep a stable identity for dedupe. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    for (const k of [...u.searchParams.keys()]) if (/^(at_|utm_|traffic_source|ocid|ns_)/i.test(k)) u.searchParams.delete(k);
    u.hash = '';
    return u.toString();
  } catch { return raw.trim(); }
}

const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && '#text' in (v as object)) return String((v as Record<string, unknown>)['#text']);
  return String(v);
};

/** Agency datelines ("Tehran, IRNA –", "تهران-ایرنا-", "ANKARA, Anadolu –") name where the desk is, not where the story happened. */
export function stripDateline(t: string): string {
  return t.replace(/^\s*[\p{L}\u200c .'’]{2,30}\s*[,-]\s*(?:IRNA|ایرنا|Press TV|TASS|Anadolu|AA|Xinhua|AFP|AP|Reuters|WAFA|SANA|KUNA|WAM|QNA)\s*[–—-]\s*/iu, '');
}

/** Drop a leading repeat of the headline and cut long text at a word boundary with an ellipsis. */
export function tidySummary(title: string, body: string, max = 600): string {
  let b = stripDateline(body.trim());
  if (b.toLowerCase().startsWith(title.toLowerCase())) b = b.slice(title.length).replace(/^[\s.:–—-]+/, '');
  if (b.length <= max) return b;
  const cut = b.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 40))}…`;
}

export interface ParsedItem { modifiedAt?: string | null; publisher?: string | null; tier?: string | null; timePrecision?: 'instant' | 'date'; forceRelevant?: boolean; outlet?: string | null; externalId: string; url: string; title: string; summary: string; publishedAt: string; originating: string | null; countries: string[] }

export function parseFeed(xml: string, opts: { dateFromUrl?: boolean } = {}): ParsedItem[] {
  const doc = parser.parse(xml);
  const raw = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? [];
  const items = Array.isArray(raw) ? raw : [raw];
  const out: ParsedItem[] = [];
  for (const it of items) {
    const title = stripHtml(text(it.title));
    const link = canonicalUrl(text(typeof it.link === 'object' && it.link?.['@_href'] ? it.link['@_href'] : it.link));
    const dateRaw = text(it.pubDate ?? it.published ?? it.updated ?? it['dc:date']);
    let ts = Date.parse(dateRaw);
    let timePrecision: 'instant' | 'date' = 'instant';
    if (!Number.isFinite(ts) && opts.dateFromUrl) { // feed gives no timestamp: use the day stated in the article URL, explicitly date-only
      const m = /\/(20\d{2})\/(\d{2})\/(\d{2})\//.exec(link);
      if (m) { ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])); timePrecision = 'date'; }
    }
    if (!title || !link || !Number.isFinite(ts)) continue; // undated / unlinked items cannot satisfy "every event has a source + time"
    const descRaw = text(it.description ?? it.summary ?? it['content:encoded']);
    // ReliefWeb embeds structured tags in the description HTML.
    const decodedDesc = decodeEntities(descRaw);
    const srcTag = /class="tag source">\s*Source:\s*([^<]+)</i.exec(decodedDesc)?.[1]?.trim() ?? null;
    const countryTag = /class="tag country">\s*Countries?:\s*([^<]+)</i.exec(decodedDesc)?.[1]?.trim() ?? '';
    const body = stripHtml(descRaw.replace(/<div class="tag [^"]*">[\s\S]*?<\/div>/gi, '').replace(/&lt;div class="tag [^"]*"&gt;[\s\S]*?&lt;\/div&gt;/gi, ''));
    const guid = text(it.guid) || link;
    const cleaned = tidySummary(title, body);
    out.push({
      externalId: guid, url: link, title, summary: cleaned, publishedAt: new Date(ts).toISOString(), timePrecision, originating: srcTag,
      countries: countryTag ? countryTag.split(',').map((s) => s.replace(/\(.*?\)/g, '').trim()).filter(Boolean) : [],
    });
  }
  return out;
}

/** Canonical outlet key: the same outlet reached through two feeds must not count as two independent outlets. */
export function outletKey(name: string): string {
  const k = name.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '');
  const alias: [RegExp, string][] = [[/^(bbc|bbcnews)/, 'bbc'], [/^(theguardian|guardian)/, 'guardian'], [/^aljazeera/, 'aljazeera'], [/^(thenewyorktimes|newyorktimes|nytimes|nyt)/, 'nyt'],
    [/^(associatedpress|ap|apnews)$/, 'ap'], [/^(reuters)/, 'reuters'], [/^france24/, 'france24'], [/^(jerusalempost|thejerusalempost)/, 'jpost'], [/^middleeasteye/, 'mee'],
    [/^(anadolu|anadoluagency|aa)/, 'anadolu'], [/^(skynews)/, 'sky'], [/^(unnews|unitednations)/, 'un'], [/^(gcaptain)/, 'gcaptain'], [/^(oilpricecom|oilprice)/, 'oilprice']];
  for (const [re, v] of alias) if (re.test(k)) return v;
  return k;
}

const eventId = (publishedAt: string, key: string) => `evt_${publishedAt.slice(0, 10).replace(/-/g, '')}_${createHash('sha1').update(key).digest('hex').slice(0, 6)}`;

export interface RssResult { fetched: number; inserted: number; relevant: number; revised?: number }

export async function ingestRss(src: NewsSource): Promise<RssResult> {
  const xml = await fetchText(src.url, { retries: 2, headers: { accept: 'application/rss+xml, application/xml, text/xml, */*' } });
  const r = storeFeed(src, xml); // parse first: only a body that parsed is worth caching
  cacheRaw(src.id, xml);
  return r;
}

/** Keep the last good raw body (≤1.5 MB) so parser regressions can be reproduced offline. */
export function cacheRaw(sourceId: string, body: string) {
  if (body.length > 1_500_000) return;
  db.prepare('INSERT OR REPLACE INTO raw_cache (source_id, fetched_at, bytes, sha256, body) VALUES (?,?,?,?,?)')
    .run(sourceId, new Date().toISOString(), body.length, createHash('sha256').update(body).digest('hex'), body);
}

/** Parse + normalise + persist. Idempotent: an item already stored (same source + guid) is only touched, never duplicated. */
export function storeFeed(src: NewsSource, xml: string): RssResult {
  const items = parseFeed(xml, { dateFromUrl: src.dateFromUrl }).slice(0, src.maxItems);
  if (items.length === 0) throw new Error('feed parsed but contained zero usable items (format change or empty feed)');
  return storeParsed(src, items);
}

/** Shared persistence for every adapter. A re-seen item whose publisher-reported modification time advanced is a
 *  revision: its text is updated in place, the count is bumped, and first_seen/published stay as originally recorded. */
export const ingestParsed = (src: NewsSource, items: ParsedItem[]): RssResult => storeParsed(src, items);

const FUTURE_TOLERANCE_MS = 10 * 60e3;

export function storeParsed(src: NewsSource, items: ParsedItem[]): RssResult {
  const r = tx(() => storeParsedInner(src, items)); // all-or-nothing per source batch
  if (r.inserted > 0 || (r.revised ?? 0) > 0) bump(src.id);
  return r;
}

function storeParsedInner(src: NewsSource, items: ParsedItem[]): RssResult {
  const now = new Date().toISOString();
  const find = db.prepare('SELECT id, modified_at FROM events WHERE source_id = ? AND external_id = ?');
  const ins = db.prepare(`INSERT INTO events (id, source_id, external_id, published_at, title, summary, raw_url, language, originating_source,
      location_name, lat, lng, loc_precision, entities, topics, relevant, first_seen_at, last_seen_at, modified_at, publisher, tier, time_precision, outlet, publisher_time_raw)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const touch = db.prepare('UPDATE events SET last_seen_at = ? WHERE id = ?');
  const revise = db.prepare(`UPDATE events SET title = ?, summary = ?, entities = ?, topics = ?, relevant = ?, location_name = ?, lat = ?, lng = ?, loc_precision = ?,
      modified_at = ?, revision_count = revision_count + 1, last_seen_at = ? WHERE id = ?`);
  let inserted = 0, relevant = 0, revised = 0;
  for (const it of items) {
    const hay = `${it.title}. ${it.summary} ${it.countries.join(' ')}`;
    const ents = extractEntities(hay);
    const rel = !!it.forceRelevant || ents.me.length > 0 || isMiddleEastRelevant(hay);
    const loc = geolocate(it.title, it.summary, it.countries);
    const topics = extractTopics(`${it.title}. ${it.summary}`);
    const prior = find.get(src.id, it.externalId) as { id: string; modified_at: string | null } | undefined;
    if (prior) {
      if (it.modifiedAt && (!prior.modified_at || it.modifiedAt > prior.modified_at)) {
        revised++;
        revise.run(it.title, it.summary, JSON.stringify(ents.all), JSON.stringify(topics), rel ? 1 : 0, loc?.name ?? null, loc?.lat ?? null, loc?.lng ?? null, loc?.precision ?? null, it.modifiedAt, now, prior.id);
      } else touch.run(now, prior.id);
      continue;
    }
    // A stated publication time later than our first collection is impossible (usually a mislabelled time zone). The item is placed at
    // collection time and the publisher's value is kept and shown — no offset is guessed.
    const future = Date.parse(it.publishedAt) > Date.parse(now) + FUTURE_TOLERANCE_MS;
    const publishedAt = future ? now : it.publishedAt;
    ins.run(eventId(it.publishedAt, `${src.id}|${it.externalId}`), src.id, it.externalId, publishedAt, it.title, it.summary, it.url, src.language, it.originating,
      loc?.name ?? null, loc?.lat ?? null, loc?.lng ?? null, loc?.precision ?? null, JSON.stringify(ents.all), JSON.stringify(topics), rel ? 1 : 0, now, now, it.modifiedAt ?? null,
      it.publisher ?? null, it.tier ?? null, it.timePrecision ?? 'instant', it.outlet ?? outletKey(it.publisher ?? src.name), future ? it.publishedAt : null);
    inserted++;
    if (rel) relevant++;
  }
  return { fetched: items.length, inserted, relevant, revised };
}
