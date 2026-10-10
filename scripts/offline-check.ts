// Simulates total network failure against a COPY of a database and reports whether data survived and failures were recorded per source.
// Usage: TRACKER_DB=<copy.sqlite> tsx scripts/offline-check.ts      (prints one JSON line)
const { db } = await import('../server/db.ts');
const { runIngest } = await import('../server/ingest.ts');
const tables = ['events', 'markets', 'price_history', 'event_market_links', 'series_points'];
const count = () => Object.fromEntries(tables.map((t) => [t, (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c]));
const before = count();
globalThis.fetch = (async () => { throw new TypeError('fetch failed (simulated network drop)'); }) as typeof fetch;
const t0 = Date.now();
const r = await runIngest({ force: true });
const after = count();
const failed = Object.entries(r.results).filter(([, v]) => !v.ok).map(([k]) => k);
const recorded = (db.prepare("SELECT COUNT(*) c FROM source_health WHERE status = 'error'").get() as { c: number }).c;
console.log(JSON.stringify({ before, after, failed: failed.length, recorded_errors: recorded, seconds: Math.round((Date.now() - t0) / 1000), lost: tables.filter((t) => after[t as keyof typeof after] < before[t as keyof typeof before]) }));
process.exit(0);
export {}; // module scope (top-level await)
