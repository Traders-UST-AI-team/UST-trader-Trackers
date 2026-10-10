// W5 — monitoring coverage and blind spots. Extends the existing source-health / gap state (no competing health engine).
// Success rate = completed successful scheduled attempts ÷ completed scheduled attempts in the window (manual attempts counted
// separately; disabled sources excluded). Telemetry exists only from its actual start — earlier continuity is unknown.
// Lag is descriptive and per cohort: instant-precision items collected by the newest poll only; date-only and backfilled items apart.
import { db, kvGet, kvSet } from '../db.ts';
import { sourceHealth } from '../sourcehealth.ts';
import { NEWS_SOURCES, SOURCE_META } from '../registry.ts';
import { channelConfig, collectionLag, openGaps } from '../sources/telegram.ts';
import { recordSourceSetChange } from '../runlog.ts';
import type { CoverageReport } from '../../shared/research.ts';

type Row = Record<string, any>;
const meta = SOURCE_META;
const quant = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1) + 0.5))] : null);

/** On startup: if the configured source registry differs from the last recorded one, log the change (coverage comparisons). */
export function checkRegistrySet() {
  const cur = NEWS_SOURCES.filter((s) => s.enabled !== false).map((s) => s.id).sort().join(',');
  const prev = kvGet('registry_source_set');
  if (prev !== cur) {
    if (prev !== null) {
      const a = new Set(prev.split(',')), b = new Set(cur.split(','));
      recordSourceSetChange('registry', `added: ${[...b].filter((x) => !a.has(x)).join(', ') || 'none'}; removed: ${[...a].filter((x) => !b.has(x)).join(', ') || 'none'}`);
    }
    kvSet('registry_source_set', cur);
  }
}

export function coverageReport(windowH = 24, now = Date.now()): CoverageReport {
  const since = new Date(now - windowH * 3600e3).toISOString();
  const telemetryStart = (db.prepare('SELECT MIN(at) m FROM collection_attempts').get() as { m: string | null }).m;
  const health = sourceHealth(now);
  const sources = health.map((h) => {
    const a = db.prepare(`SELECT SUM(CASE WHEN manual = 0 AND ok = 1 THEN 1 ELSE 0 END) sok, SUM(CASE WHEN manual = 0 THEN 1 ELSE 0 END) stot,
      SUM(manual) man, SUM(partial) part, MIN(at) first FROM collection_attempts WHERE source_id = ? AND at >= ?`).get(h.source_id, since) as Row;
    const m = meta.get(h.source_id);
    return {
      source_id: h.source_id, name: h.name, kind: h.kind, status: h.status === 'blocked' ? 'disabled' : h.status === 'error' ? 'failing' : h.stale ? 'stale' : h.status, last_success_at: h.last_success_at,
      newest_data_at: h.freshness.newest_at, assessment: h.freshness.assessment,
      attempts: { window_h: windowH, scheduled_ok: a.sok ?? 0, scheduled_total: a.stot ?? 0, rate: h.status === 'blocked' || !a.stot ? null : (a.sok ?? 0) / a.stot, manual: a.man ?? 0, partial: a.part ?? 0, since: a.first ?? null },
      breaker_open_until: h.breaker_open_until, languages: m ? [m.language] : h.source_id === 'telegram' ? ['en', 'ar', 'fa', 'he', 'ru (rule dictionaries)'] : [], scope: m?.scope ?? null,
    };
  });
  // Lag cohorts: publication → first collection, instant precision only, newest-poll arrivals only (late finds > 24 h excluded).
  const webInstant = (db.prepare(`SELECT (julianday(first_seen_at) - julianday(published_at)) * 86400 lag FROM events WHERE time_precision = 'instant' AND first_seen_at >= ?
    AND julianday(first_seen_at) - julianday(published_at) BETWEEN 0 AND 1`).all(since) as { lag: number }[]).map((r) => r.lag).sort((x, y) => x - y);
  const dateOnly = (db.prepare("SELECT COUNT(*) c FROM events WHERE time_precision = 'date' AND first_seen_at >= ?").get(since) as { c: number }).c;
  const late = (db.prepare("SELECT COUNT(*) c FROM events WHERE first_seen_at >= ? AND julianday(first_seen_at) - julianday(published_at) > 1").get(since) as { c: number }).c;
  const tg = collectionLag(null, windowH);
  const relevant = sources.filter((s) => ['news', 'official', 'maritime'].includes(s.kind) && s.status !== 'disabled');
  const allDown = relevant.length > 0 && relevant.every((s) => s.status === 'failing' || s.status === 'stale');
  return {
    generated_at: new Date(now).toISOString(), window_h: windowH, telemetry_since: telemetryStart, sources,
    telegram: channelConfig().map((c) => {
      const st = db.prepare('SELECT last_error FROM tg_channels WHERE channel = ?').get(c.channel) as Row | undefined;
      const lag = collectionLag(c.channel, windowH);
      return { channel: c.channel, enabled: c.enabled, open_gaps: openGaps(c.channel).length, lag_n: lag.n, lag_median_s: lag.median_s, last_error: st?.last_error ?? null };
    }),
    wallet_gaps: (db.prepare('SELECT target, from_ts, to_ts FROM pm_gaps WHERE resolved_at IS NULL').all() as Row[]).map((g) => ({ target: g.target, from: new Date(g.from_ts * 1000).toISOString(), to: new Date(g.to_ts * 1000).toISOString() })),
    lag_cohorts: [
      { cohort: 'news/official, instant precision, collected within 24 h of publication', n: webInstant.length, median_s: quant(webInstant, 0.5), p90_s: quant(webInstant, 0.9), note: 'includes each source\'s polling interval' },
      { cohort: 'Telegram, newest-page poll', n: tg.n, median_s: tg.median_s, p90_s: tg.p90_s, note: tg.note },
      { cohort: 'date-only items (excluded from lag)', n: dateOnly, median_s: null, p90_s: null, note: 'the source gives no time of day' },
      { cohort: 'late finds > 24 h after publication (excluded from lag)', n: late, median_s: null, p90_s: null, note: 'first collected long after publication (new source, backfill or feed delay)' },
    ],
    source_set_changes: (db.prepare('SELECT at, kind, detail FROM source_set_changes ORDER BY id DESC LIMIT 30').all() as Row[]).map((r) => ({ at: r.at, kind: r.kind, detail: r.detail })),
    all_relevant_down: allDown,
    notes: [
      allDown ? 'Every news/official/maritime source is failing or stale: an empty feed here means "nothing observed within this coverage", not "no incidents".' : 'An empty result means "no items observed within this coverage", never "no incidents".',
      `Attempt telemetry starts ${telemetryStart ?? 'now (no attempts recorded yet)'}; continuity before that is unknown.`,
      'Source availability is not evidence of exhaustive coverage: configured sources are a sample of what is published.',
    ],
  };
}
