// Per-source health + freshness. Three different questions are kept apart:
//   1. did the collector run?       → last_attempt_at / last_success_at / error / breaker      (collection)
//   2. how old is the newest DATA?  → newest_at + age, judged against the provider's own publication rhythm (observation / publication)
//   3. when will we try again?      → next_attempt_at
// A successful fetch that returned old observations is NOT "current data", and a quiet news source is not a failed one.
import { db } from './db.ts';
import { getBreaker } from './breaker.ts';
import { allSourceDefs, configOf, dueAt, type SourceDef } from './sourceconfig.ts';
import { NEWS_SOURCES, type NewestQuery } from './registry.ts';
import { nextTelegramAttempt } from './tgscheduler.ts';
import type { SourceHealth } from '../shared/types.ts';

type Row = Record<string, any>;
const AUTO_REFRESH_MIN = 10;

interface Policy { basis: NonNullable<SourceHealth['freshness']>['basis']; current_s: number; delayed_s?: number; note: string }

const H = 3600, D = 86400;

/** A publisher that only speaks when something happens: a week of silence is normal. */
const SPORADIC_POLICY: Policy = { basis: 'publication', current_s: 7 * D, note: 'official/sporadic publisher: silence is normal' };
/** Everything else on the publication clock: the newest item's own publication time. */
const PUBLICATION_POLICY: Policy = { basis: 'publication', current_s: D, note: 'newest item publication time' };

/**
 * How this source's freshness is judged. Every source that differs from the publication default
 * carries its own policy on its registry entry; nothing here enumerates ids.
 */
export function policyOf(d: SourceDef): Policy {
  if (d.freshness) return d.freshness;
  if (d.sporadic) return SPORADIC_POLICY;
  if (d.kind === 'maritime') return { ...PUBLICATION_POLICY, note: 'trade press / advisories' };
  return PUBLICATION_POLICY;
}

/**
 * News and official items all land in the events table, so that query is a rule about the table
 * rather than a fact about each publisher; anything else carries its own query on its entry.
 */
const EVENTS_NEWEST: NewestQuery = { sql: 'SELECT MAX(published_at) v FROM events WHERE source_id = ?', unit: 'iso' };

function newestOf(d: SourceDef, basis: Policy['basis']): number | null {
  const query = d.newest ?? (basis === 'publication' ? EVENTS_NEWEST : undefined);
  if (!query) return null;
  const row = db.prepare(query.sql).get(...((query.args ?? [d.id]) as never[])) as { v: string | number | null } | undefined;
  const raw = row?.v ?? null;
  if (raw === null) return null;
  if (query.unit === 's') return Number(raw) * 1000;
  if (query.unit === 'ms') return Number(raw);
  return Date.parse(String(raw));
}

export function sourceHealth(now = Date.now()): SourceHealth[] {
  const h = new Map((db.prepare('SELECT * FROM source_health').all() as Row[]).map((r) => [r.source_id, r]));
  const defs = allSourceDefs();
  return defs.map((d) => {
    const r = h.get(d.id);
    const ok = r?.last_success_at ? r.last_success_at : null;
    const stale = ok ? now - Date.parse(ok) > Math.max(configOf(d.id)?.interval_min ?? d.intervalMin, d.id === 'telegram' ? 1 : AUTO_REFRESH_MIN) * 3 * 60_000 : true;
    const br = getBreaker(d.id);
    const pol = policyOf(d);
    const newest = d.disabled ? null : newestOf(d, pol.basis);
    const age = newest === null ? null : Math.max(0, Math.round((now - newest) / 1000));
    const assessment: NonNullable<SourceHealth['freshness']>['assessment'] =
      d.disabled ? 'unknown' : age === null ? 'unknown' : age <= pol.current_s ? 'current' : pol.delayed_s && age <= pol.delayed_s ? 'delayed' : pol.basis === 'publication' || pol.basis === 'post' ? 'quiet' : 'old';
    const interval = configOf(d.id)?.interval_min ?? d.intervalMin; // effective (possibly user-configured) cadence
    // The main cycle runs every AUTO_REFRESH_MIN, so a source is actually attempted at the first cycle after it is due.
    const base = d.id === 'telegram' ? (nextTelegramAttempt() ? Date.parse(nextTelegramAttempt()!) : null) : dueAt(d.id, r?.last_attempt_at ? Date.parse(r.last_attempt_at) : null, interval);
    const next = d.disabled ? null : br.open_until && Date.parse(br.open_until) > now ? br.open_until : base === null ? null : new Date(base).toISOString();
    return {
      source_id: d.id, name: d.name, kind: d.kind, last_attempt_at: r?.last_attempt_at ?? null, last_success_at: ok,
      status: d.disabled ? 'blocked' : (r?.status ?? 'never'), items: r?.items ?? null, error: d.disabled ?? r?.error ?? null,
      expected_interval_min: interval, stale: d.disabled ? false : stale, consecutive_failures: br.fails, breaker_open_until: br.open_until,
      next_attempt_at: next,
      freshness: { basis: pol.basis, newest_at: newest === null ? null : new Date(newest).toISOString(), age_s: age, assessment, note: pol.note },
    } as SourceHealth;
  });
}
