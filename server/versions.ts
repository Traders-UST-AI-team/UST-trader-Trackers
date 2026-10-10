import { db } from './db.ts';

export function bump(sourceId: string): void {
  db.prepare(`INSERT INTO source_versions (source_id, version, updated_at) VALUES (?, 1, ?)
    ON CONFLICT(source_id) DO UPDATE SET version = version + 1, updated_at = excluded.updated_at`).run(sourceId, new Date().toISOString());
}

export function versions(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of db.prepare('SELECT source_id, version FROM source_versions').all() as unknown as { source_id: string; version: number }[]) out[r.source_id] = r.version;
  return out;
}
