// Unified feed read model + persisted source configuration (Package D / J2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.TRACKER_DB = join(mkdtempSync(join(tmpdir(), 'wt-feed-')), 't.sqlite');
const { db, kvSet } = await import('./db.ts');
const { readFeed, countNew, unreadCounts } = await import('./feed.ts');
const sc = await import('./sourceconfig.ts');

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const ev = (id: string, src: string, pubMinAgo: number | string, seenMinAgo: number, extra: Partial<Record<string, unknown>> = {}) =>
  db.prepare(`INSERT INTO events (id, source_id, external_id, published_at, title, summary, raw_url, language, entities, topics, relevant, first_seen_at, last_seen_at, location_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, src, `ext-${id}`, typeof pubMinAgo === 'string' ? pubMinAgo : iso(pubMinAgo), `Title ${id}`, `Summary ${id}`, `https://x/${id}`, (extra.lang as string) ?? 'en', '[]',
    JSON.stringify(extra.topics ?? ['shipping']), extra.relevant === 0 ? 0 : 1, iso(seenMinAgo), iso(seenMinAgo), (extra.place as string) ?? null);
const post = (ch: string, id: number, pubMinAgo: number, seenMinAgo: number, via: string) =>
  db.prepare(`INSERT INTO tg_posts (channel, post_id, posted_at, text, url, lang, topics, first_seen_at, fetched_at, seen_via) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(ch, id, iso(pubMinAgo), `Post ${id} about Hormuz`, `https://t.me/${ch}/${id}`, 'en', '["military"]', iso(seenMinAgo), iso(seenMinAgo), via);

ev('a', 'bbc-me', 10, 9);
ev('b', 'un-news-me', 20, 19, { topics: ['diplomacy'], place: 'Geneva' });
const T30 = iso(30);
ev('c', 'gcaptain', T30, 29);
ev('d', 'bbc-me', T30, 29);                    // identical publication time to c → tie broken by key
ev('e', 'bbc-me', 3000, 5);                   // published 2 days before first collection → late find, not "new"
ev('f', 'bbc-me', 40, 39, { relevant: 0 });   // filtered-out item
post('chan_one', 101, 5, 4, 'latest');
post('chan_one', 90, 600, 3, 'gap');          // recovered from a coverage gap → shown in place, not "new"
post('chan_one', 50, 9000, 3, 'backfill');

test('feed: stable identities, publication order, every item exactly once across keyset pages (ties included)', () => {
  const all: string[] = [];
  let cursor: string | null = null;
  do {
    const r = readFeed({ limit: 2, cursor }, false);
    assert.ok(!('error' in r));
    all.push(...r.items.map((i) => i.key));
    cursor = r.next_cursor;
  } while (cursor);
  assert.equal(new Set(all).size, all.length, 'no duplicates');
  assert.deepEqual(all, ['telegram:chan_one:101', 'web:bbc-me:ext-a', 'web:un-news-me:ext-b', 'web:gcaptain:ext-c', 'web:bbc-me:ext-d', 'telegram:chan_one:90', 'web:bbc-me:ext-e', 'telegram:chan_one:50']);
});

test('feed route: a cursor over a long external id (full article URL) survives the HTTP layer', async () => {
  const express = (await import('express')).default;
  const { registerFeedRoutes } = await import('./feed.ts');
  const longId = `https://www.example.com/middle-east/${'very-long-slug-'.repeat(12)}article-123456`;
  for (let i = 0; i < 3; i++) db.prepare(`INSERT INTO events (id, source_id, external_id, published_at, title, summary, raw_url, language, entities, topics, relevant, first_seen_at, last_seen_at)
    VALUES (?, 'bbc-me', ?, ?, 't', 's', 'https://x', 'en', '[]', '[]', 1, ?, ?)`).run(`long${i}`, `${longId}-${i}`, iso(5000 + i), iso(5000 + i), iso(5000 + i));
  const app = express(); registerFeedRoutes(app, { seed: false });
  const srv = app.listen(0); const port = (srv.address() as { port: number }).port;
  try {
    const seen: string[] = []; let cur: string | null = null;
    do {
      const r: Response = await fetch(`http://127.0.0.1:${port}/api/feed?source=bbc-me&limit=1${cur ? `&cursor=${encodeURIComponent(cur)}` : ''}`);
      assert.equal(r.status, 200, 'page request accepted');
      const b = await r.json() as { items: { key: string }[]; next_cursor: string | null };
      seen.push(...b.items.map((x) => x.key)); cur = b.next_cursor;
    } while (cur);
    assert.ok(seen.filter((k) => k.includes('very-long-slug')).length === 3);
  } finally { srv.close(); }
});

test('feed: kind/source/topic/place/language filters; Telegram is never given a news tier', () => {
  const kinds = (k: string) => { const r = readFeed({ kind: k }, false); assert.ok(!('error' in r)); return r.items.map((i) => i.key); };
  assert.deepEqual(kinds('official'), ['web:un-news-me:ext-b']);
  assert.deepEqual(kinds('maritime'), ['web:gcaptain:ext-c']);
  assert.deepEqual(kinds('telegram'), ['telegram:chan_one:101', 'telegram:chan_one:90', 'telegram:chan_one:50']);
  const tg = readFeed({ kind: 'telegram' }, false);
  assert.ok(!('error' in tg));
  assert.ok(tg.items.every((i) => i.tier === null && i.viewpoint_label));
  const t = readFeed({ topic: 'diplomacy' }, false); assert.ok(!('error' in t)); assert.deepEqual(t.items.map((i) => i.key), ['web:un-news-me:ext-b']);
  const p = readFeed({ place: 'gene' }, false); assert.ok(!('error' in p)); assert.equal(p.items.length, 1);
  const s = readFeed({ source: 'telegram:chan_one' }, false); assert.ok(!('error' in s)); assert.equal(s.items.length, 3);
  const f = readFeed({ includeFiltered: true, source: 'bbc-me' }, false); assert.ok(!('error' in f)); assert.ok(f.items.some((i) => i.key === 'web:bbc-me:ext-f'));
  assert.ok('error' in readFeed({ kind: 'tweets' }, false));
  assert.ok('error' in readFeed({ cursor: 'garbage' }, false));
});

test('feed: "N new" counts genuine arrivals only — backfilled, gap-recovered and late-found items are not new', () => {
  const n = countNew({}, iso(15));
  assert.ok(!('error' in n));
  assert.equal(n.count, 2, 'a (web) + 101 (telegram latest); e (late find), 90 (gap), 50 (backfill) excluded');
  kvSet('feed_read_marker', iso(6));
  const u = unreadCounts();
  assert.equal(u.counts.telegram, 1); assert.equal(u.counts.news, 0); assert.equal(u.counts.all, 1);
});

test('feed: seed mode explains the missing Telegram data', () => {
  const r = readFeed({ kind: 'telegram' }, true);
  assert.ok(!('error' in r));
  assert.match(r.notes.join(' '), /Seed mode.*no Telegram posts/);
});

test('source config: bounds enforced (no silent clamping), persisted with a version, survives a new connection, reset restores defaults', () => {
  assert.equal(sc.setConfig('fred', { interval_min: 5 }).ok, false, 'a daily provider cannot be polled every 5 min');
  assert.equal(sc.setConfig('bbc-me', { interval_min: 7.5 }).ok, false);
  assert.equal(sc.setConfig('bbc-me', { request_budget: 0 }).ok, false);
  assert.equal(sc.setConfig('bbc-me', { cadence: 5 }).ok, false, 'unknown fields rejected');
  assert.equal(sc.setConfig('nope', { interval_min: 30 }).ok, false);
  const v0 = sc.configVersion();
  const r = sc.setConfig('bbc-me', { interval_min: 45, request_budget: 6 });
  assert.ok(r.ok);
  assert.equal(r.config.interval_min, 45); assert.equal(r.config.version, 1); assert.equal(sc.configVersion(), v0 + 1);
  assert.equal((sc.setConfig('bbc-me', { interval_min: 50 }) as { ok: true; config: { version: number; request_budget: number } }).config.version, 2);
  const other = new DatabaseSync(process.env.TRACKER_DB!, { readOnly: true }); // "restart": a fresh connection sees the stored setting
  assert.deepEqual({ ...(other.prepare("SELECT interval_min, request_budget FROM source_config WHERE source_id = 'bbc-me'").get() as object) }, { interval_min: 50, request_budget: 6 });
  other.close();
  assert.ok(sc.setConfig('bbc-me', { reset: true }).ok);
  assert.equal(sc.configOf('bbc-me')!.overridden, false);
  assert.equal(sc.configOf('telegram')!.interval_min, 5, 'pilot target');
});

test('source config: jittered due time stays within ±5% of the interval and is stable per source', () => {
  for (const id of ['bbc-me', 'polymarket', 'telegram:chan_one']) {
    const j = sc.jitterFrac(id);
    assert.ok(Math.abs(j) <= 0.05);
    assert.equal(sc.jitterFrac(id), j);
  }
  const due = sc.dueAt('bbc-me', 0, 30)!;
  assert.ok(due >= 30 * 60_000 * 0.95 && due <= 30 * 60_000 * 1.05);
});
