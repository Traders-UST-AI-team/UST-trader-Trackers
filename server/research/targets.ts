// W2 — port and chokepoint observation cards built only from data the tracker actually has: IMF PortWatch daily series (delayed
// aggregate, never live), reviewed reference assets and attributed reports. Vessel-level fields stay unavailable until an
// authorized AIS feed with measured coverage exists (package K2). No operating status, closure or congestion is inferred.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.ts';
import { PW_POINTS, SENSORS } from '../sources/sensors.ts';
import { sensorIndicators } from '../indicators/service.ts';
import type { ObservationTarget } from '../../shared/research.ts';

type Row = Record<string, any>;
const ASSETS = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'assets.json'), 'utf8')) as { assets: { id: string; name: string; type: string; aliases?: string[] }[] };
const PW_ASSET: Record<string, string> = { hormuz: 'hormuz', babelmandeb: 'bab-el-mandeb', suez: 'suez-sumed' };
const D = 86400e3;

export function pinnedTargets(): string[] {
  const r = db.prepare("SELECT v FROM workspace_preferences WHERE k = 'pinned_targets'").get() as { v: string } | undefined;
  try { return r ? JSON.parse(r.v) : ['pw:hormuz']; } catch { return ['pw:hormuz']; }
}
export function setPinnedTargets(ids: unknown): { ok: true; pinned: string[] } | { ok: false; error: string } {
  const valid = new Set(targetIds());
  if (!Array.isArray(ids) || ids.length > 12 || !ids.every((x) => typeof x === 'string' && valid.has(x))) return { ok: false, error: `pins must be up to 12 known target ids (${[...valid].join(', ')})` };
  db.prepare("INSERT INTO workspace_preferences (k, v, updated_at) VALUES ('pinned_targets', ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at").run(JSON.stringify(ids), new Date().toISOString());
  return { ok: true, pinned: ids as string[] };
}
const portAssets = () => ASSETS.assets.filter((a) => ['port', 'terminal', 'lng'].includes(a.type));
export const targetIds = () => [...PW_POINTS.map((p) => `pw:${p.key}`), ...portAssets().map((a) => `asset:${a.id}`)];

function reports(aliases: string[], now: number): ObservationTarget['reports'] {
  if (!aliases.length) return [];
  const since = new Date(now - 14 * D).toISOString();
  const w = aliases.map(() => '(title LIKE ? OR summary LIKE ?)').join(' OR ');
  const args = aliases.flatMap((a) => [`%${a}%`, `%${a}%`]);
  return (db.prepare(`SELECT source_id, external_id, title, published_at, time_precision, publisher FROM events WHERE relevant = 1 AND published_at >= ? AND (${w}) ORDER BY published_at DESC LIMIT 8`).all(since, ...args) as Row[])
    .map((r) => ({ source_ref: `web:${r.source_id}:${r.external_id}`, title: r.title, source_name: r.publisher ?? r.source_id, published_at: r.published_at, time_precision: r.time_precision }));
}

function seriesCard(seriesId: string, now: number): ObservationTarget['series'][number] | null {
  const def = SENSORS.find((s) => s.id === seriesId);
  if (!def) return null;
  const pts = db.prepare('SELECT t, v FROM series_points WHERE series_id = ? ORDER BY t DESC LIMIT 2').all(seriesId) as { t: number; v: number }[];
  const [l, p] = pts;
  const age = l ? (now - l.t * 1000) / D : null;
  const ind = sensorIndicators(seriesId, ['baseline_28d'], {})?.indicators[0];
  const x = (ind?.extra ?? {}) as { pct_change?: number | null; baseline_mean?: number | null };
  return {
    id: seriesId, title: def.title, unit: def.unit, provider: def.provider, definition: def.caveat,
    latest: l ? { t: new Date(l.t * 1000).toISOString(), v: l.v } : null, previous: p ? { t: new Date(p.t * 1000).toISOString(), v: p.v } : null,
    // Same source, same unit, the two most recent actual observations; percentage only when the prior value is non-zero.
    change_pct: l && p && p.v !== 0 ? (100 * (l.v - p.v)) / p.v : null,
    change_basis: !l || !p ? 'needs two observations' : p.v === 0 ? 'previous observation is 0 — percentage undefined' : 'latest vs previous actual observation (same series)',
    status: age === null ? 'no data' : age <= 1.5 ? 'current for this provider' : age <= 10 ? 'delayed (normal for this provider)' : 'stale', expected_lag: 'published daily with a lag of several days; revised afterwards',
    baseline_28d: ind ? { pct: x.pct_change ?? null, mean: x.baseline_mean ?? null, status: ind.status, reason: ind.reason } : null,
  };
}

export function observationTargets(now = Date.now()): ObservationTarget[] {
  const pins = new Set(pinnedTargets());
  const vessels = { status: 'unavailable' as const, reason: 'No authorized AIS feed with measured coverage is configured (package K2 is gated on a user-supplied AISstream key), so vessel positions, type mix, port calls, queues and dwell are not shown.' };
  const out: ObservationTarget[] = PW_POINTS.map((p) => {
    const asset = ASSETS.assets.find((a) => a.id === PW_ASSET[p.key]);
    return {
      id: `pw:${p.key}`, name: p.name, kind: 'chokepoint' as const, pinned: pins.has(`pw:${p.key}`),
      series: [seriesCard(`pw:${p.key}:total`, now), seriesCard(`pw:${p.key}:tanker`, now)].filter((s): s is NonNullable<typeof s> => !!s),
      reports: reports(asset?.aliases ?? [p.name], now), vessels,
      notes: ['PortWatch counts are satellite-AIS transit estimates (aggregate, delayed, revised); they are not live and not cargo volume.', 'Reports are attributed items that mention this place; they are not confirmation of any operating status.'],
    };
  });
  for (const a of portAssets()) out.push({
    id: `asset:${a.id}`, name: a.name, kind: a.type === 'port' ? 'port' : 'facility', pinned: pins.has(`asset:${a.id}`), series: [], reports: reports(a.aliases ?? [a.name], now), vessels,
    notes: ['No numerical port-call data is available for this place in the tracker; only its reference record and attributed reports are shown.'],
  });
  return out.sort((x, y) => Number(y.pinned) - Number(x.pinned));
}
