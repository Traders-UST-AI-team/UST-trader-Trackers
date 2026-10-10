// Demo seed: a snapshot of REAL data captured from live sources, loaded into a separate DB with no network use.
// It is always labelled as a seed in the API/UI; it is never presented as live.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, kvSet, tx } from './db.ts';

export const SEED_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'demo_seed.json');
const TABLES: { name: string; where?: string }[] = [
  { name: 'events', where: 'relevant = 1' },
  { name: 'markets', where: 'is_open = 1' },
  { name: 'price_history', where: 'condition_id IN (SELECT condition_id FROM markets WHERE is_open = 1)' },
  { name: 'history_meta' },
  { name: 'event_market_links' },
  { name: 'stories' },
  { name: 'source_health' },
  { name: 'series_points' },
  { name: 'series_meta' },
];
// Telegram text is third-party content under Telegram's terms: excluded from the shareable seed unless explicitly requested.
const TELEGRAM_TABLES: { name: string; where?: string }[] = [{ name: 'tg_channels' }, { name: 'tg_posts' }, { name: 'tg_matches' }];
const tables = () => (process.env.SEED_WITH_TELEGRAM ? [...TABLES, ...TELEGRAM_TABLES] : TABLES);

export function exportSeed(): { path: string; rows: Record<string, number> } {
  const rows: Record<string, number> = {};
  const data: Record<string, unknown[]> = {};
  for (const t of tables()) {
    const r = db.prepare(`SELECT * FROM ${t.name}${t.where ? ` WHERE ${t.where}` : ''}`).all();
    data[t.name] = r; rows[t.name] = r.length;
  }
  const last = (db.prepare("SELECT v FROM kv WHERE k = 'last_refresh_finished_at'").get() as { v: string } | undefined)?.v ?? new Date().toISOString();
  writeFileSync(SEED_PATH, JSON.stringify({ kind: 'war-tracker-demo-seed', captured_at: last, exported_at: new Date().toISOString(), tables: data }));
  return { path: SEED_PATH, rows };
}

export function loadSeed(): { captured_at: string; rows: Record<string, number> } {
  if (!existsSync(SEED_PATH)) throw new Error(`No seed found at ${SEED_PATH}. Create one first with: npm run seed:export (needs a populated live database).`);
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as { captured_at: string; tables: Record<string, Record<string, unknown>[]> };
  const rows: Record<string, number> = {};
  tx(() => {
    for (const t of [...TABLES, ...TELEGRAM_TABLES]) db.prepare(`DELETE FROM ${t.name}`).run();
    for (const t of [...TABLES, ...TELEGRAM_TABLES]) {
      const recs = seed.tables[t.name] ?? [];
      rows[t.name] = recs.length;
      if (!recs.length) continue;
      const cols = Object.keys(recs[0]);
      const ins = db.prepare(`INSERT OR REPLACE INTO ${t.name} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const r of recs) ins.run(...(cols.map((c) => r[c] ?? null) as never[]));
    }
  });
  kvSet('seed_captured_at', seed.captured_at);
  kvSet('last_refresh_finished_at', seed.captured_at);
  return { captured_at: seed.captured_at, rows };
}
