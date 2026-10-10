// Unified read model over the original `events` and `tg_posts` tables (neither is changed or merged).
// Identity = platform + source/channel + external id. Telegram keeps its own viewpoint label and is never placed in the news tiers.
// Ordering is by publication time with keyset pagination; "new" means first collected after a reader's snapshot and NOT backfilled.
import type { Express } from 'express';
import { db, kvGet, kvSet } from './db.ts';
import { NEWS_SOURCES, SOURCE_META } from './registry.ts';
import type { FeedItem, FeedKind, FeedResponse } from '../shared/types.ts';
import { lowSignalReason } from '../shared/desk.ts';
import { cachedHeadlines } from './translation.ts';

type Row = Record<string, any>;
const parse = <T>(s: string | null | undefined, fb: T): T => { try { return s ? (JSON.parse(s) as T) : fb; } catch { return fb; } };
const kindOf = (sourceKind: string): FeedKind => (sourceKind === 'official' ? 'official' : sourceKind === 'maritime' ? 'maritime' : 'news');
export const FEED_KINDS: FeedKind[] = ['news', 'official', 'maritime', 'telegram'];
/** A web item first collected more than this long after its stated publication is a late find / backfill, not a new arrival. */
const LATE_FIND_H = 24;

export interface FeedQuery {
  kind?: string; source?: string; topic?: string; place?: string; lang?: string; q?: string; includeFiltered?: boolean; limit?: number; cursor?: string | null;
  /** Leave out low-signal items (shared/desk.ts lowSignalReason) and repeat headlines that reached us through several aggregator feeds. */
  signal?: boolean;
}

const encodeCursor = (pub: string, key: string) => Buffer.from(JSON.stringify([pub, key])).toString('base64url');
function decodeCursor(c: string): [string, string] | null {
  try { const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')); return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' ? [v[0], v[1]] : null; } catch { return null; }
}

/** Builds the UNION over both tables with every filter applied inside each branch. */
function unionSql(f: FeedQuery): { sql: string; args: (string | number)[] } | { error: string } {
  const kind = f.kind ?? 'all';
  if (kind !== 'all' && !FEED_KINDS.includes(kind as FeedKind)) return { error: `kind must be all|${FEED_KINDS.join('|')}` };
  const webSources = NEWS_SOURCES.filter((s) => kind === 'all' || kindOf(s.kind) === kind).map((s) => s.id);
  const wantWeb = kind !== 'telegram' && webSources.length > 0;
  const wantTg = kind === 'all' || kind === 'telegram';
  const branches: string[] = []; const args: (string | number)[] = [];
  const like = (s: string) => `%${s.replace(/[%_]/g, '')}%`;

  if (wantWeb && !(f.source && f.source.startsWith('telegram:'))) {
    const w: string[] = [`e.source_id IN (${webSources.map(() => '?').join(',')})`]; args.push(...webSources);
    if (!f.includeFiltered) w.push('e.relevant = 1');
    if (f.source) { w.push('e.source_id = ?'); args.push(f.source); }
    if (f.topic) { w.push('e.topics LIKE ?'); args.push(like(`"${f.topic}"`)); }
    if (f.place) { w.push('e.location_name LIKE ?'); args.push(like(f.place)); }
    if (f.lang) { w.push('e.language = ?'); args.push(f.lang); }
    if (f.q) { w.push('(e.title LIKE ? OR e.summary LIKE ?)'); args.push(like(f.q), like(f.q)); }
    branches.push(`SELECT 'web' AS platform, e.source_id AS src, NULL AS channel, e.id AS ref_id, e.external_id AS ext,
      ('web:' || e.source_id || ':' || e.external_id) AS key, e.published_at AS pub, e.first_seen_at AS seen, e.time_precision AS prec,
      e.title AS title, e.summary AS body, e.raw_url AS url, e.language AS lang, e.topics AS topics, e.location_name AS place, e.tier AS tier, e.publisher AS publisher,
      NULL AS fwd, e.revision_count AS revisions, e.publisher_time_raw AS ptr,
      CASE WHEN julianday(e.first_seen_at) - julianday(e.published_at) > ${LATE_FIND_H / 24} THEN 1 ELSE 0 END AS backfill,
      CASE WHEN julianday(e.first_seen_at) - julianday(e.published_at) > ${LATE_FIND_H / 24} THEN 'late_find' ELSE 'latest' END AS via
      FROM events e WHERE ${w.join(' AND ')}`);
  }
  if (wantTg && !(f.source && !f.source.startsWith('telegram:'))) {
    const w: string[] = ['1 = 1'];
    if (f.source) { w.push('p.channel = ?'); args.push(f.source.slice('telegram:'.length)); }
    if (f.topic) { w.push('p.topics LIKE ?'); args.push(like(`"${f.topic}"`)); }
    if (f.place) { w.push('p.loc_name LIKE ?'); args.push(like(f.place)); }
    if (f.lang) { w.push('p.lang = ?'); args.push(f.lang); }
    if (f.q) { w.push('p.text LIKE ?'); args.push(like(f.q)); }
    branches.push(`SELECT 'telegram' AS platform, 'telegram' AS src, p.channel AS channel, CAST(p.post_id AS TEXT) AS ref_id, CAST(p.post_id AS TEXT) AS ext,
      ('telegram:' || p.channel || ':' || p.post_id) AS key, p.posted_at AS pub, p.first_seen_at AS seen, 'instant' AS prec,
      NULL AS title, p.text AS body, p.url AS url, p.lang AS lang, p.topics AS topics, p.loc_name AS place, NULL AS tier, NULL AS publisher,
      p.forwarded_from AS fwd, p.edited AS revisions, NULL AS ptr,
      CASE WHEN p.seen_via = 'latest' THEN 0 ELSE 1 END AS backfill, p.seen_via AS via
      FROM tg_posts p WHERE ${w.join(' AND ')}`);
  }
  if (!branches.length) return { sql: "SELECT NULL AS key, NULL AS pub WHERE 0", args: [] };
  return { sql: branches.join(' UNION ALL '), args };
}

const srcMeta = SOURCE_META;
/** Cached English headlines for the web rows of one page. */
function headlinesFor(rows: Row[]): Map<string, string> {
  const web = rows.filter((r) => r.platform === 'web');
  return cachedHeadlines(db, web.map((r) => ({ id: String(r.ref_id), title: String(r.title ?? ''), summary: String(r.body ?? ''), language: String(r.lang ?? '') })));
}
const titleOf = (r: Row) => (r.platform === 'telegram' ? String(r.body ?? '').split('\n')[0] : String(r.title ?? ''));
const lowSignalOf = (r: Row, heads: Map<string, string>) =>
  lowSignalReason({ title: titleOf(r), title_en: r.platform === 'web' ? heads.get(String(r.ref_id)) ?? null : null, language: r.lang && r.lang !== 'und' ? r.lang : null, topics: parse<string[]>(r.topics, []) });
// One article can arrive more than once: an aggregator (Google News) delivers it through several query feeds, and some
// outlets republish under a new URL. In the signal view only the first copy in feed order is kept.
/** True when an earlier copy in feed order (newer publication, or same time and a later key) exists, so this one is the repeat. Stateless, so it holds across pages. */
function repeatOfEarlier(r: Row, f: FeedQuery): boolean {
  if (r.platform !== 'web') return false;
  const later = `AND (published_at > ? OR (published_at = ? AND ('web:' || source_id || ':' || external_id) > ?)) ${f.includeFiltered ? '' : 'AND relevant = 1'} LIMIT 1`;
  if (r.publisher) {
    if (f.source) return false; // with a source filter the other copy may be filtered away; show this one
    return !!db.prepare(`SELECT 1 FROM events WHERE publisher = ? AND title = ? ${later}`).get(r.publisher, r.title, r.pub, r.pub, r.key);
  }
  return !!db.prepare(`SELECT 1 FROM events WHERE source_id = ? AND publisher IS NULL AND title = ? ${later}`).get(r.src, r.title, r.pub, r.pub, r.key);
}
const dupKey = (r: Row) => (r.platform === 'web' ? `${r.publisher ?? r.src}|${r.title}` : null);

function toItem(r: Row, heads: Map<string, string>): FeedItem {
  const isTg = r.platform === 'telegram';
  const meta = isTg ? null : srcMeta.get(r.src);
  const matches = isTg ? (db.prepare('SELECT event_id, similarity, strength FROM tg_matches WHERE channel = ? AND post_id = ? ORDER BY similarity DESC LIMIT 3').all(r.channel, Number(r.ext)) as Row[]).map((m) => ({ event_id: m.event_id as string, strength: m.strength as string, similarity: m.similarity as number })) : [];
  const text = String(r.body ?? '');
  return {
    key: r.key, platform: r.platform, kind: isTg ? 'telegram' : kindOf(meta?.kind ?? 'news'), source_id: isTg ? `telegram:${r.channel}` : r.src,
    source_name: isTg ? `@${r.channel}` : r.publisher ? `${r.publisher} (via ${meta?.name ?? r.src})` : meta?.name ?? r.src,
    // Telegram has no headline: the first line serves as the title and the rest as the body (so nothing is shown twice).
    title: isTg ? text.split('\n')[0].slice(0, 160) || '(no text — media or link only)' : r.title, text: (isTg ? text.split('\n').slice(1).join('\n').trim() : text).slice(0, 500),
    published_at: r.pub, collected_at: r.seen, time_precision: r.prec, url: r.url, language: r.lang && r.lang !== 'und' ? r.lang : null, topics: parse<string[]>(r.topics, []), place: r.place ?? null,
    tier: isTg ? null : (r.tier ?? meta?.tier ?? null), viewpoint_label: isTg ? 'Telegram channel — viewpoint-labelled discovery source, not tiered as news' : null,
    forward_origin: r.fwd ?? null, event_id: isTg ? null : r.ref_id, matches, backfill: !!r.backfill, collected_via: r.via, revised: Number(r.revisions) > 0,
    publisher_time_raw: r.ptr ?? null,
    title_en: isTg ? null : heads.get(String(r.ref_id)) ?? null, low_signal: lowSignalOf(r, heads),
  };
}

export function readFeed(f: FeedQuery, seed: boolean): FeedResponse | { error: string } {
  const u = unionSql(f);
  if ('error' in u) return u;
  const limit = Math.min(100, Math.max(1, Math.floor(f.limit ?? 50)));
  let pos: [string, string] | null = null;
  if (f.cursor) {
    pos = decodeCursor(f.cursor);
    if (!pos) return { error: 'invalid cursor' };
  }
  const batch = (after: [string, string] | null, n: number) =>
    db.prepare(`SELECT * FROM (${u.sql}) ${after ? 'WHERE (pub < ? OR (pub = ? AND key < ?))' : ''} ORDER BY pub DESC, key DESC LIMIT ?`)
      .all(...u.args, ...(after ? [after[0], after[0], after[1]] : []), n) as Row[];
  // Keyset scan: with the signal filter on, rows are read in batches and filtered here until the page is
  // full (bounded, so one request never walks the whole store). The cursor always marks where scanning stopped.
  const kept: Row[] = [];
  const heads = new Map<string, string>();
  let more = true;
  for (let round = 0; round < (f.signal ? 8 : 1) && kept.length <= limit && more; round++) {
    const n = f.signal ? (limit + 1) * 3 : limit + 1;
    const rows = batch(pos, n);
    more = rows.length === n;
    for (const [k, v] of headlinesFor(rows)) heads.set(k, v);
    for (const r of rows) {
      pos = [r.pub, r.key];
      if (f.signal && (lowSignalOf(r, heads) || repeatOfEarlier(r, f))) continue;
      kept.push(r);
      if (kept.length > limit) break;
    }
  }
  const page = kept.slice(0, limit);
  const last = page[page.length - 1];
  const next = kept.length > limit && last ? encodeCursor(last.pub, last.key) : more && pos ? encodeCursor(pos[0], pos[1]) : null;
  const notes: string[] = [];
  if (seed) notes.push('Seed mode: the offline snapshot contains no Telegram posts (excluded by design), so the Telegram tab is empty and nothing is fetched.');
  return { items: page.map((r) => toItem(r, heads)), next_cursor: next, snapshot_at: new Date().toISOString(), notes };
}

/** Items first collected after `since` that are genuine arrivals (not backfill / late finds), for the "N new items" button. */
export function countNew(f: FeedQuery, since: string): { count: number; newest_collected_at: string | null } | { error: string } {
  const u = unionSql(f);
  if ('error' in u) return u;
  if (f.signal) {
    const rows = db.prepare(`SELECT * FROM (${u.sql}) WHERE seen > ? AND backfill = 0`).all(...u.args, since) as Row[];
    const heads = headlinesFor(rows), dups = new Set<string>();
    let count = 0, newest: string | null = null;
    for (const r of rows) {
      const d = dupKey(r);
      if (lowSignalOf(r, heads) || (d && dups.has(d))) continue;
      if (d) dups.add(d);
      count++; if (!newest || r.seen > newest) newest = r.seen;
    }
    return { count, newest_collected_at: newest };
  }
  const r = db.prepare(`SELECT COUNT(*) c, MAX(seen) m FROM (${u.sql}) WHERE seen > ? AND backfill = 0`).get(...u.args, since) as { c: number; m: string | null };
  return { count: r.c, newest_collected_at: r.m };
}

/** Unread = genuine arrivals collected after the persisted read marker, per kind. */
export function unreadCounts(signal = false): { marker: string | null; counts: Record<FeedKind | 'all', number> } {
  const marker = kvGet('feed_read_marker');
  const since = marker ?? '1970-01-01T00:00:00.000Z';
  const counts = { all: 0, news: 0, official: 0, maritime: 0, telegram: 0 } as Record<FeedKind | 'all', number>;
  for (const k of FEED_KINDS) {
    const n = countNew({ kind: k, signal }, since);
    counts[k] = 'error' in n ? 0 : n.count;
    counts.all += counts[k];
  }
  return { marker, counts };
}

export function registerFeedRoutes(app: Express, opts: { seed: boolean }) {
  const q = (req: { query: Record<string, unknown> }): FeedQuery => {
    // Filters are short free text; the cursor is opaque and can be long (it embeds an external id such as a full article URL).
    const s = (k: string, max = 120) => (typeof req.query[k] === 'string' && (req.query[k] as string).trim() ? (req.query[k] as string).trim().slice(0, max) : undefined);
    return { kind: s('kind'), source: s('source'), topic: s('topic'), place: s('place'), lang: s('lang'), q: s('q'), includeFiltered: req.query.include_filtered === '1', signal: req.query.signal === '1', limit: Number(req.query.limit ?? 50), cursor: s('cursor', 8192) ?? null };
  };
  app.get('/api/feed', (req, res) => {
    const out = readFeed(q(req), opts.seed);
    if ('error' in out) return res.status(400).json(out);
    res.json(out);
  });
  app.get('/api/feed/new', (req, res) => {
    const since = typeof req.query.since === 'string' && Number.isFinite(Date.parse(req.query.since)) ? new Date(req.query.since).toISOString() : null;
    if (!since) return res.status(400).json({ error: 'since must be an ISO timestamp (the snapshot_at of the page being read)' });
    const out = countNew(q(req), since);
    if ('error' in out) return res.status(400).json(out);
    res.json(out);
  });
  app.get('/api/feed/unread', (req, res) => res.json(unreadCounts(req.query.signal === '1')));
  app.put('/api/feed/read-marker', (req, res) => {
    const at = req.body?.at === undefined ? new Date().toISOString() : typeof req.body.at === 'string' && Number.isFinite(Date.parse(req.body.at)) ? new Date(req.body.at).toISOString() : null;
    if (!at || Date.parse(at) > Date.now() + 60_000) return res.status(400).json({ error: 'at must be an ISO timestamp not in the future (omit for now)' });
    kvSet('feed_read_marker', at);
    res.json(unreadCounts(req.query.signal === '1'));
  });
}
