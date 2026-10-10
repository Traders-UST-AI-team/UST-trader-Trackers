// Re-parses every cached raw feed twice; the second pass must insert nothing. Prints one JSON line. Usage: tsx scripts/idempotence-check.ts
const { db } = await import('../server/db.ts');
const { storeFeed } = await import('../server/sources/rss.ts');
const { NEWS_SOURCES } = await import('../server/registry.ts');
let checked = 0, dup = 0;
const skipped: string[] = [];
for (const r of db.prepare('SELECT source_id, body FROM raw_cache').all() as { source_id: string; body: string }[]) {
  const src = NEWS_SOURCES.find((s) => s.id === r.source_id);
  if (!src) continue;
  try { storeFeed(src, r.body); dup += storeFeed(src, r.body).inserted; checked++; } catch (e) { skipped.push(`${r.source_id}: ${(e as Error).message.slice(0, 50)}`); }
}
console.log(JSON.stringify({ checked, dup, skipped }));
process.exit(0);
export {}; // module scope (top-level await)
