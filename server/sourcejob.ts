// One code path for "collect from source X now?" shared by the main ingest cycle and the background jobs:
// due check (configured cadence ± jitter) → breaker → request budget → run → record outcome/usage.
import { db } from './db.ts';
import { configOf, dueAt } from './sourceconfig.ts';
import { getBreaker, isOpen, recordFailure, recordSuccess } from './breaker.ts';
import { BudgetExceeded, withBudget } from './http.ts';
import { recordRun, recordUsage } from './runlog.ts';

export interface SourceJobResult { ran: boolean; ok: boolean; detail: string }

/** `items` is read after a successful run (e.g. a row count for the health panel). */
export async function runSourceJob(id: string, job: () => Promise<string>, opts: { force?: boolean; items?: () => number | null } = {}): Promise<SourceJobResult> {
  const cfg = configOf(id);
  if (!opts.force) {
    const h = db.prepare('SELECT last_attempt_at, status FROM source_health WHERE source_id = ?').get(id) as { last_attempt_at: string | null; status: string } | undefined;
    // A failed source is retried at the next opportunity (subject to its breaker), not held back by its cadence.
    const last = h?.status === 'ok' && h.last_attempt_at ? Date.parse(h.last_attempt_at) : null;
    const due = dueAt(id, last, cfg?.interval_min);
    if (due !== null && Date.now() < due) return { ran: false, ok: true, detail: `skipped (next due ${new Date(due).toISOString()})` };
    if (isOpen(id)) { const b = getBreaker(id); return { ran: false, ok: true, detail: `skipped: circuit open until ${b.open_until} after ${b.fails} consecutive failures (last: ${(b.last_error ?? '').slice(0, 80)})` }; }
  }
  // Every run — automatic or manual — is bounded by the source's request budget.
  const budget = cfg?.request_budget ?? 12;
  try {
    const r = await withBudget(id, budget, job);
    // An adapter that isolates per-item failures can swallow the budget stop; the flag still marks the run as partial.
    const note = r.exhausted ? `partial run: request budget of ${budget} exhausted; remaining items were skipped (${r.value})` : null;
    recordRun(id, true, opts.items?.() ?? null, note, { manual: !!opts.force, partial: r.exhausted }); recordSuccess(id); recordUsage(id, r.used, budget, r.exhausted);
    return { ran: true, ok: true, detail: note ?? r.value };
  } catch (e) {
    const used = (e as { budgetUsed?: number }).budgetUsed ?? 0;
    if (e instanceof BudgetExceeded) {
      // Not a provider failure: data stored before the stop is kept; the run is labelled partial and the breaker is untouched.
      const note = `partial run: ${e.message}; data stored before the stop is kept`;
      recordRun(id, true, opts.items?.() ?? null, note, { manual: !!opts.force, partial: true }); recordUsage(id, used, budget, true);
      return { ran: true, ok: true, detail: note };
    }
    const msg = (e as Error).message;
    recordRun(id, false, null, msg, { manual: !!opts.force }); recordFailure(id, cfg?.interval_min ?? 10, msg); recordUsage(id, used, budget, false);
    return { ran: true, ok: false, detail: msg };
  }
}
