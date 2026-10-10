// Collection outcome per source (source_health). Shared by the main ingest cycle and the separate Telegram scheduler.
import { db } from './db.ts';

/** Records the latest outcome (source_health) and appends one attempt to the telemetry history (collection_attempts), which
 *  starts when this code first ran — earlier continuity is unknown. `manual` = user-requested refresh; `partial` = ok but incomplete. */
export function recordRun(sourceId: string, ok: boolean, items: number | null, error: string | null, opts: { manual?: boolean; partial?: boolean } = {}) {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO collection_attempts (source_id, at, ok, partial, manual, error) VALUES (?,?,?,?,?,?)').run(sourceId, now, ok ? 1 : 0, opts.partial ? 1 : 0, opts.manual ? 1 : 0, error?.slice(0, 300) ?? null);
  db.prepare(`INSERT INTO source_health (source_id, last_attempt_at, last_success_at, status, items, error) VALUES (?,?,?,?,?,?)
    ON CONFLICT(source_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at,
      last_success_at = CASE WHEN ? THEN excluded.last_attempt_at ELSE source_health.last_success_at END,
      status = excluded.status, items = COALESCE(excluded.items, source_health.items), error = excluded.error`)
    .run(sourceId, now, ok ? now : null, ok ? 'ok' : 'error', items, error, ok ? 1 : 0);
}

export function recordUsage(sourceId: string, requests: number, budget: number, exhausted: boolean) {
  db.prepare(`INSERT INTO source_runs (source_id, last_run_at, requests, budget, budget_exhausted) VALUES (?,?,?,?,?)
    ON CONFLICT(source_id) DO UPDATE SET last_run_at = excluded.last_run_at, requests = excluded.requests, budget = excluded.budget, budget_exhausted = excluded.budget_exhausted`)
    .run(sourceId, new Date().toISOString(), requests, budget, exhausted ? 1 : 0);
}

/** Coverage changes that make volume comparisons non-like-for-like (channels added/removed, cadence changes, registry changes). */
export function recordSourceSetChange(kind: string, detail: string) {
  db.prepare('INSERT INTO source_set_changes (at, kind, detail) VALUES (?,?,?)').run(new Date().toISOString(), kind, detail.slice(0, 500));
}
