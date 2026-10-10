// Persisted circuit breaker. After 3 consecutive failures a source is skipped (by the automatic cycle) until `open_until`;
// cool-down doubles per further failure up to 6 h. A manual "Refresh now" bypasses the breaker; any success closes it.
import { db } from './db.ts';

export const BREAKER_THRESHOLD = 3;
const MAX_COOLDOWN_MS = 6 * 3600_000;

export interface BreakerState { fails: number; open_until: string | null; last_error: string | null }

export function getBreaker(sourceId: string): BreakerState {
  return (db.prepare('SELECT fails, open_until, last_error FROM breaker WHERE source_id = ?').get(sourceId) as BreakerState | undefined) ?? { fails: 0, open_until: null, last_error: null };
}

export function isOpen(sourceId: string, now = Date.now()): boolean {
  const b = getBreaker(sourceId);
  return !!b.open_until && Date.parse(b.open_until) > now;
}

export function recordFailure(sourceId: string, intervalMin: number, error: string, now = Date.now()): BreakerState {
  const fails = getBreaker(sourceId).fails + 1;
  const cooldown = fails >= BREAKER_THRESHOLD ? Math.min(MAX_COOLDOWN_MS, Math.max(10, intervalMin) * 60_000 * 2 ** (fails - BREAKER_THRESHOLD)) : 0;
  const open_until = cooldown ? new Date(now + cooldown).toISOString() : null;
  db.prepare(`INSERT INTO breaker (source_id, fails, open_until, last_error, updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(source_id) DO UPDATE SET fails = excluded.fails, open_until = excluded.open_until, last_error = excluded.last_error, updated_at = excluded.updated_at`)
    .run(sourceId, fails, open_until, error.slice(0, 300), new Date(now).toISOString());
  return { fails, open_until, last_error: error };
}

export function recordSuccess(sourceId: string) {
  db.prepare('DELETE FROM breaker WHERE source_id = ?').run(sourceId);
}
