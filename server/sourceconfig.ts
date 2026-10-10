// Persisted per-source collection settings (J2): polling cadence and a request budget per run, with validated bounds.
// Polling cadence is NOT the provider's publication rhythm: polling a daily series every 5 minutes cannot make it real-time,
// so sensor floors are set well above the poll that could ever reveal a new observation.
import { createHash } from 'node:crypto';
import { db, kvGet, kvSet } from './db.ts';
import { recordSourceSetChange } from './runlog.ts';
import { ALL_SOURCES, type FreshnessPolicy, type NewestQuery, type SourceBounds } from './registry.ts';
import type { SourceHealth } from '../shared/types.ts';

export interface SourceDef {
  id: string; name: string; kind: SourceHealth['kind']; intervalMin: number;
  /** Reason this source cannot be collected, or undefined when it can. */
  disabled?: string;
  /** Carried through from the registry entry so health does not re-derive it. */
  sporadic?: boolean;
  freshness?: FreshnessPolicy;
  newest?: NewestQuery;
  /** Carried from the registry entry; the default applies to a single-feed source. */
  bounds?: SourceBounds;
}

export function allSourceDefs(): SourceDef[] {
  return ALL_SOURCES.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind as SourceHealth['kind'],
    intervalMin: s.intervalMin,
    // A source is shown as "not connected" when the registry marks it inaccessible.
    disabled: s.enabled === false ? s.blockedReason : undefined,
    sporadic: s.sporadic,
    freshness: s.freshness,
    newest: s.newest,
    bounds: s.bounds,
  }));
}

export interface Bounds { interval: [number, number]; budget: [number, number]; budgetDefault: number; budgetUnit: string }
/**
 * The bounds a source declares on its own registry entry.
 *
 * A source that states none gets the single-feed default, so "unbounded" is not reachable by
 * omission, and a source's full description lives in one place rather than two.
 */
const DEFAULT_BOUNDS: Bounds = { interval: [5, 1440], budget: [1, 60], budgetDefault: 12, budgetUnit: 'HTTP requests per run' };

export const boundsOf = (d: SourceDef): Bounds => d.bounds ?? DEFAULT_BOUNDS;

export interface EffectiveConfig {
  source_id: string; interval_min: number; request_budget: number; default_interval_min: number; default_budget: number;
  bounds: Bounds; version: number; updated_at: string | null; overridden: boolean;
  last_run: { at: string; requests: number; budget: number; exhausted: boolean } | null;
}

const defsById = () => new Map(allSourceDefs().map((d) => [d.id, d]));

export function configOf(id: string): EffectiveConfig | null {
  const d = defsById().get(id);
  if (!d) return null;
  const b = boundsOf(d);
  const row = db.prepare('SELECT interval_min, request_budget, version, updated_at FROM source_config WHERE source_id = ?').get(id) as { interval_min: number; request_budget: number; version: number; updated_at: string } | undefined;
  const run = db.prepare('SELECT last_run_at, requests, budget, budget_exhausted FROM source_runs WHERE source_id = ?').get(id) as { last_run_at: string; requests: number; budget: number; budget_exhausted: number } | undefined;
  return {
    source_id: id, interval_min: row?.interval_min ?? d.intervalMin, request_budget: row?.request_budget ?? b.budgetDefault,
    default_interval_min: d.intervalMin, default_budget: b.budgetDefault, bounds: b, version: row?.version ?? 0, updated_at: row?.updated_at ?? null, overridden: !!row,
    last_run: run ? { at: run.last_run_at, requests: run.requests, budget: run.budget, exhausted: !!run.budget_exhausted } : null,
  };
}

export const allConfigs = (): EffectiveConfig[] => allSourceDefs().map((d) => configOf(d.id)!);
export const configVersion = (): number => Number(kvGet('source_config_version') ?? 0);

/** Validated update. Values outside the bounds are rejected (never clamped silently). `reset` restores defaults. */
export function setConfig(id: string, patch: unknown): { ok: true; config: EffectiveConfig } | { ok: false; error: string } {
  const d = defsById().get(id);
  if (!d) return { ok: false, error: `unknown source ${id}` };
  if (d.disabled) return { ok: false, error: `${id} is disabled: ${d.disabled}` };
  if (!patch || typeof patch !== 'object') return { ok: false, error: 'body must be an object' };
  const p = patch as Record<string, unknown>;
  if (p.reset === true) {
    db.prepare('DELETE FROM source_config WHERE source_id = ?').run(id);
    kvSet('source_config_version', String(configVersion() + 1));
    return { ok: true, config: configOf(id)! };
  }
  const cur = configOf(id)!;
  const b = cur.bounds;
  const intOf = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : NaN);
  const interval = p.interval_min === undefined ? cur.interval_min : intOf(p.interval_min);
  const budget = p.request_budget === undefined ? cur.request_budget : intOf(p.request_budget);
  if (!(interval >= b.interval[0] && interval <= b.interval[1])) return { ok: false, error: `interval_min must be an integer between ${b.interval[0]} and ${b.interval[1]} minutes for ${id}` };
  if (!(budget >= b.budget[0] && budget <= b.budget[1])) return { ok: false, error: `request_budget must be an integer between ${b.budget[0]} and ${b.budget[1]} (${b.budgetUnit}) for ${id}` };
  const extra = Object.keys(p).filter((k) => !['interval_min', 'request_budget'].includes(k));
  if (extra.length) return { ok: false, error: `unknown field(s): ${extra.join(', ')}` };
  db.prepare(`INSERT INTO source_config (source_id, interval_min, request_budget, version, updated_at) VALUES (?,?,?,1,?)
    ON CONFLICT(source_id) DO UPDATE SET interval_min = excluded.interval_min, request_budget = excluded.request_budget, version = source_config.version + 1, updated_at = excluded.updated_at`)
    .run(id, interval, budget, new Date().toISOString());
  kvSet('source_config_version', String(configVersion() + 1));
  recordSourceSetChange('cadence', `${id}: every ${cur.interval_min} → ${interval} min, budget ${cur.request_budget} → ${budget}`);
  return { ok: true, config: configOf(id)! };
}

/** Deterministic per-source jitter in [-5%, +5%] of the interval, so sources with equal cadence do not all fire together. */
export function jitterFrac(id: string): number {
  const h = createHash('sha1').update(id).digest().readUInt16BE(0) / 0xffff;
  return (h - 0.5) * 0.1;
}

/** When the next automatic attempt is due, given the last attempt (ms). */
export function dueAt(id: string, lastAttemptMs: number | null, intervalMin?: number): number | null {
  if (lastAttemptMs === null) return null;
  const iv = intervalMin ?? configOf(id)?.interval_min ?? 10;
  return lastAttemptMs + iv * 60_000 * (1 + jitterFrac(id));
}
