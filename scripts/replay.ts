// Re-parse the last good raw response for a feed source (parser-regression aid). Usage: npm run replay -- <source_id>
import { db } from '../server/db.ts';
import { parseFeed } from '../server/sources/rss.ts';
import { NEWS_SOURCES } from '../server/registry.ts';
const id = process.argv[2];
if (!id) { console.log('cached sources:', (db.prepare('SELECT source_id, fetched_at, bytes FROM raw_cache ORDER BY source_id').all() as any[]).map((r) => `${r.source_id} (${r.bytes}B, ${r.fetched_at})`).join('\n  ')); process.exit(0); }
const row = db.prepare('SELECT * FROM raw_cache WHERE source_id = ?').get(id) as { body: string; fetched_at: string; sha256: string } | undefined;
if (!row) { console.error(`no cached response for ${id}`); process.exit(1); }
const src = NEWS_SOURCES.find((s) => s.id === id);
const items = parseFeed(row.body, { dateFromUrl: src?.dateFromUrl });
console.log(`${id}: cached ${row.fetched_at} sha256 ${row.sha256.slice(0, 12)} → ${items.length} items`);
for (const i of items.slice(0, 5)) console.log(' -', i.publishedAt, i.title.slice(0, 90));
