// Per-source health + freshness. Three different questions are kept apart:
//   1. did the collector run?       → last_attempt_at / last_success_at / error / breaker      (collection)
//   2. how old is the newest DATA?  → newest_at + age, judged against the provider's own publication rhythm (observation / publication)
//   3. when will we try again?      → next_attempt_at
// A successful fetch that returned old observations is NOT "current data", and a quiet news source is not a failed one.
import { db } from './db.ts';
import { getBreaker } from './breaker.ts';
import { allSourceDefs, configOf, dueAt } from './sourceconfig.ts';
import { nextTelegramAttempt } from './tgscheduler.ts';
import type { SourceHealth } from '../shared/types.ts';

type Row = Record<string, any>;
const AUTO_REFRESH_MIN = 10;

interface Policy { basis: NonNullable<SourceHealth['freshness']>['basis']; current_s: number; delayed_s?: number; note: string }

const H = 3600, D = 86400;
const SENSOR_POLICY: Record<string, Policy> = {
  portwatch: { basis: 'observation', current_s: 1.5 * D, delayed_s: 10 * D, note: 'IMF PortWatch publishes daily series with a delay of several days; the observation date is shown and the series is never live' },
  fred: { basis: 'observation', current_s: 3 * D, delayed_s: 10 * D, note: 'FRED/EIA spot prices are published with a delay of days (weekends and holidays have no observation)' },
  opensky: { basis: 'observation', current_s: 2 * H, note: 'our own series; samples are taken each poll' },
  ioda: { basis: 'observation', current_s: 6 * H, note: 'hourly points over a 7-day window' },
};
const OFFICIAL_SPORADIC = new Set(['un-news-me', 'un-press', 'ofsi', 'ofac', 'fcdo', 'easa-czib', 'maersk-advisories', 'inbox']);

const WALLET_NEWEST: Record<string, string> = {
  'pm-trades': 'SELECT MAX(ts) * 1000 v FROM pm_market_trades',
  'pm-wallets': 'SELECT MAX(ts) * 1000 v FROM pm_wallet_activity',
  'pm-holders': "SELECT MAX(strftime('%s', snapshot_at)) * 1000 v FROM pm_holders",
  'pm-leaderboard': "SELECT MAX(strftime('%s', captured_at)) * 1000 v FROM pm_leaderboard",
};

function policyOf(id: string, kind: string): Policy {
  if (id === 'pm-trades' || id === 'pm-wallets') return { basis: 'observation', current_s: 6 * H, note: 'newest trade/activity timestamp; quiet markets and wallets can go hours without a trade' };
  if (id === 'pm-holders' || id === 'pm-leaderboard') return { basis: 'observation', current_s: id === 'pm-holders' ? 3 * H : 2 * D, note: 'snapshot time (provider ranking at that moment)' };
  if (SENSOR_POLICY[id]) return SENSOR_POLICY[id];
  if (id === 'polymarket' || id === 'kalshi') return { basis: 'history', current_s: 3 * H, note: 'newest stored history point' };
  if (id === 'telegram') return { basis: 'post', current_s: 6 * H, note: 'newest post publication time' };
  if (OFFICIAL_SPORADIC.has(id)) return { basis: 'publication', current_s: 7 * D, note: 'official/sporadic publisher: silence is normal' };
  return { basis: 'publication', current_s: D, note: kind === 'maritime' ? 'trade press / advisories' : 'newest item publication time' };
}

function newestOf(id: string, basis: Policy['basis']): number | null {
  const q = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...(a as never[])) as { v: string | number | null } | undefined)?.v ?? null;
  if (WALLET_NEWEST[id]) { const v = q(WALLET_NEWEST[id]); return v === null ? null : Number(v); }
  if (basis === 'observation') {
    const prefix = ({ portwatch: 'pw:', fred: 'fred:', opensky: 'opensky:', ioda: 'ioda:' } as Record<string, string>)[id];
    const t = q("SELECT MAX(t) v FROM series_points WHERE series_id LIKE ?", `${prefix}%`);
    return t === null ? null : Number(t) * 1000;
  }
  if (basis === 'history') { const t = q("SELECT MAX(h.t) v FROM price_history h JOIN markets m ON m.condition_id = h.condition_id WHERE m.venue = ?", id); return t === null ? null : Number(t) * 1000; }
  if (basis === 'post') { const t = q('SELECT MAX(posted_at) v FROM tg_posts'); return t ? Date.parse(String(t)) : null; }
  const t = q('SELECT MAX(published_at) v FROM events WHERE source_id = ?', id);
  return t ? Date.parse(String(t)) : null;
}

export function sourceHealth(now = Date.now()): SourceHealth[] {
  const h = new Map((db.prepare('SELECT * FROM source_health').all() as Row[]).map((r) => [r.source_id, r]));
  const defs = allSourceDefs();
  return defs.map((d) => {
    const r = h.get(d.id);
    const ok = r?.last_success_at ? r.last_success_at : null;
    const stale = ok ? now - Date.parse(ok) > Math.max(configOf(d.id)?.interval_min ?? d.intervalMin, d.id === 'telegram' ? 1 : AUTO_REFRESH_MIN) * 3 * 60_000 : true;
    const br = getBreaker(d.id);
    const pol = policyOf(d.id, d.kind);
    const newest = d.disabled ? null : newestOf(d.id, pol.basis);
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
