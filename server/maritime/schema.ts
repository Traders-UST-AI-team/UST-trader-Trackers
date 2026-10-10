// Maritime (K1) schema. Dependency-free so db.ts can call it without an import cycle. Additive and repeatable.
import type { DatabaseSync } from 'node:sqlite';

export function migrateMaritime(d: DatabaseSync) {
  const cols = d.prepare('PRAGMA table_info(maritime_vessels)').all() as unknown as { name: string }[];
  if (cols.length && (d.prepare('SELECT COUNT(*) c FROM maritime_vessels').get() as { c: number }).c === 0) d.exec('DROP TABLE maritime_vessels'); // unused draft
  d.exec(`
  CREATE TABLE IF NOT EXISTS vessels (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', watched INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS vessel_identifiers (id TEXT PRIMARY KEY, vessel_id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL,
    valid_from TEXT, valid_to TEXT, source_url TEXT NOT NULL, source_note TEXT, recorded_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_vid_value ON vessel_identifiers (kind, value);
  CREATE TABLE IF NOT EXISTS vessel_attributes (id TEXT PRIMARY KEY, vessel_id TEXT NOT NULL, attr TEXT NOT NULL, value TEXT NOT NULL,
    source_url TEXT NOT NULL, as_of TEXT, recorded_at TEXT NOT NULL);
  -- J1: review trail for reference-asset facts (decisions are recorded; data/assets.json is only edited by hand)
  CREATE TABLE IF NOT EXISTS asset_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, row_key TEXT NOT NULL, statement TEXT NOT NULL, decision TEXT NOT NULL, note TEXT,
    reviewer TEXT NOT NULL, reviewed_at TEXT NOT NULL, file TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS vessel_mentions (id TEXT PRIMARY KEY, vessel_id TEXT NOT NULL, source_ref TEXT NOT NULL, basis TEXT NOT NULL, evidence TEXT NOT NULL,
    status TEXT NOT NULL, reviewer TEXT, reviewed_at TEXT, note TEXT, created_at TEXT NOT NULL, UNIQUE (vessel_id, source_ref, basis));
  `);
}

