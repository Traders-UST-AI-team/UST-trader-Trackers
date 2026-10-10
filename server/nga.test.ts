// I2 — NGA broadcast navigational warnings, on a real captured response (server/fixtures/nga_broadcast_warn.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TRACKER_DB = join(mkdtempSync(join(tmpdir(), 'wt-nga-')), 't.sqlite');
const { db } = await import('./db.ts');
const N = await import('./sources/nga.ts');
const { storeParsed } = await import('./sources/rss.ts');
const { NEWS_SOURCES } = await import('./registry.ts');
const FX = JSON.parse(readFileSync(new URL('./fixtures/nga_broadcast_warn.json', import.meta.url), 'utf8'))['broadcast-warn'] as import('./sources/nga.ts').NgaWarning[];

test('date-time groups parse to UTC; malformed ones are rejected, never re-dated', () => {
  assert.equal(N.parseDtg('081538Z MAY 2024'), '2024-05-08T15:38:00.000Z');
  assert.equal(N.parseDtg('310000Z FEB 2024'), null, 'impossible day');
  assert.equal(N.parseDtg('2024-05-08'), null);
});

test('only Middle East waters/coasts kept; official identity, originating authority and the documented per-message query preserved', () => {
  const { items, skipped } = N.ngaItems(FX);
  assert.ok(items.length >= 3 && skipped >= 2, `${items.length} kept, ${skipped} skipped`);
  const q = items.find((i) => i.externalId === 'P-2024-1540')!;
  assert.match(q.title, /^HYDROPAC 1540\/24 — PERSIAN GULF\. QATAR\./);
  assert.equal(q.publishedAt, '2024-05-08T15:38:00.000Z');
  assert.match(q.originating!, /^Relayed from NAVAREA IX 175\/24/);
  assert.equal(q.url, 'https://msi.nga.mil/api/publications/broadcast-warn?navArea=P&msgYear=2024&msgNumber=1540&output=json');
  assert.ok(!items.some((i) => /INDIA\.|LAKSHADWEEP/.test(i.title) && !/GULF|RED SEA|ADEN/.test(i.title)), 'Arabian Sea + India is not a Middle East coast');
});

test('storage is idempotent; long-running warnings are late finds, not new arrivals', () => {
  const src = NEWS_SOURCES.find((s) => s.id === 'nga-navwarn')!;
  const { items } = N.ngaItems(FX);
  const a = storeParsed(src, items), b = storeParsed(src, items);
  assert.equal(a.inserted, items.length); assert.equal(b.inserted, 0);
  const r = db.prepare("SELECT published_at, first_seen_at FROM events WHERE source_id = 'nga-navwarn' AND external_id = 'P-2024-1540'").get() as { published_at: string; first_seen_at: string };
  assert.ok(Date.parse(r.first_seen_at) - Date.parse(r.published_at) > 86400e3, 'issued 2024, first collected now → the feed labels it a late find');
});
