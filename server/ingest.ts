import { db, kvGet, kvSet } from './db.ts';
import { KALSHI_SOURCE, NEWS_SOURCES, POLYMARKET_SOURCE } from './registry.ts';
import { ingestPolymarket } from './sources/polymarket.ts';
import { ingestKalshi } from './sources/kalshi.ts';
import { adapterFor } from './adapters.ts';
import { outletKey } from './sources/rss.ts';
import { matchTelegramToEvents } from './telegram.ts';
import { acquireLease, releaseLease } from './lease.ts';
import { runSourceJob } from './sourcejob.ts';
import { evaluateAlerts } from './alerts.ts';
import { afterCollection } from './research/hooks.ts';
import { ingestFred, ingestIoda, ingestOpenSky, ingestPortWatch } from './sources/sensors.ts';
import { rebuildLinks } from './link.ts';
import { rebuildStories } from './story.ts';

let running: Promise<IngestSummary> | null = null;
export const isRefreshing = () => running !== null;

export interface IngestSummary { startedAt: string; finishedAt: string; results: Record<string, { ok: boolean; detail: string }>; links: number }

/** Runs one full refresh. Concurrent callers share the in-flight run. A failing source never blocks the others,
 *  and previously stored data stays visible (stale-labelled in the UI). */
export function runIngest(opts: { force?: boolean } = {}): Promise<IngestSummary> {
  if (running) return running;
  running = (async () => {
    const startedAt = new Date().toISOString();
    // One cycle at a time across processes sharing this database (a second server cannot double-poll every source).
    if (!acquireLease('ingest-cycle', 30 * 60_000)) {
      return { startedAt, finishedAt: new Date().toISOString(), results: { cycle: { ok: false, detail: 'skipped: another process holds the ingest-cycle lease' } }, links: 0 };
    }
    try {
    const results: IngestSummary['results'] = {};
    const jobs: [string, () => Promise<string>, () => number | null][] = [];
    let polyMarkets: number | null = null;
    jobs.push([POLYMARKET_SOURCE.id, async () => {
      const r = await ingestPolymarket();
      polyMarkets = r.markets;
      return `${r.events} events / ${r.markets} open contracts, ${r.historyFetched} histories refreshed${r.warnings.length ? `, ${r.warnings.length} warnings` : ''}`;
    }, () => polyMarkets]);
    let kalshiMarkets: number | null = null;
    jobs.push([KALSHI_SOURCE.id, async () => {
      const r = await ingestKalshi();
      kalshiMarkets = r.markets;
      return `${r.series} Middle-East series / ${r.events} open events / ${r.markets} contracts, ${r.historyFetched} histories refreshed${r.warnings.length ? `, ${r.warnings.length} warnings` : ''}`;
    }, () => kalshiMarkets]);
    for (const [id, fn] of [['portwatch', ingestPortWatch], ['fred', ingestFred], ['opensky', ingestOpenSky], ['ioda', ingestIoda]] as const) {
      jobs.push([id, fn, () => null]);
    }
    // Telegram is NOT polled here: it has its own scheduler (server/tgscheduler.ts) so a slow news cycle never delays it.
    for (const s of NEWS_SOURCES.filter((x) => x.enabled !== false)) {
      let n: number | null = null;
      jobs.push([s.id, async () => { const r = await adapterFor(s)(s); n = r.fetched; return `${r.fetched} fetched, ${r.inserted} new, ${r.relevant} relevant`; }, () => n]);
    }
    backfillOutlets();
    for (const [id, job, items] of jobs) {
      const r = await runSourceJob(id, job, { force: opts.force, items });
      results[id] = { ok: r.ok, detail: r.detail };
    }
    let links = 0;
    try { links = rebuildLinks().links; } catch (e) { results['linker'] = { ok: false, detail: (e as Error).message }; }
    try { matchTelegramToEvents(); } catch (e) { results['telegram-match'] = { ok: false, detail: (e as Error).message }; } // new news can match stored posts
    try { rebuildStories(); } catch (e) { results['stories'] = { ok: false, detail: (e as Error).message }; }
    const finishedAt = new Date().toISOString();
    try { evaluateAlerts({ seed: false }); } catch (e) { results['alerts'] = { ok: false, detail: (e as Error).message }; } // in-app only
    results['research'] = { ok: true, detail: afterCollection('ingest') };
    kvSet('last_refresh_finished_at', finishedAt);
    return { startedAt, finishedAt, results, links };
    } finally { releaseLease('ingest-cycle'); }
  })().finally(() => { running = null; });
  return running;
}

function backfillOutlets() {
  for (const s of NEWS_SOURCES) db.prepare('UPDATE events SET outlet = ? WHERE source_id = ? AND outlet IS NULL AND publisher IS NULL').run(outletKey(s.name.split(' — ')[0].split(' (')[0]), s.id);
}

export const lastRefreshFinishedAt = () => kvGet('last_refresh_finished_at');
