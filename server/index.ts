import { cachedNewsTranslation, createNewsTranslator } from './translation.ts';
import express from 'express';
import { createServer as createVite } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { db, kvGet } from './db.ts';
import { loadSeed } from './seed.ts';
import { isRefreshing, lastRefreshFinishedAt, runIngest } from './ingest.ts';
import { KALSHI_SOURCE, NEWS_SOURCES, POLYMARKET_SOURCE, SENSOR_SOURCES, TELEGRAM_SOURCE } from './registry.ts';
import { storyFor } from './story.ts';
import { linkAssets } from './assets.ts';
import { getBreaker } from './breaker.ts';
import { versions } from './versions.ts';
import { sourceHealth } from './sourcehealth.ts';
import { counterpartsFor } from './equivalence.ts';
import { registerIndicatorRoutes } from './indicators/routes.ts';
import { extractEventTime } from './eventtime.ts';
import { isEnergyShippingFocus } from './geo.ts';
import { readSensors } from './sources/sensors.ts';
import { registerTelegramRoutes } from './telegram.ts';
import { registerFeedRoutes } from './feed.ts';
import { registerSourcesRoutes } from './sourcesapi.ts';
import './tgscheduler.ts'; // registers the Telegram job
import { runAllJobs, startScheduler } from './scheduler.ts';
import { releaseAllLeases } from './lease.ts';
import { ensureAnyHistory, HISTORY_BASIS } from './history.ts';
import { registerWalletRoutes } from './wallets/routes.ts';
import { registerWalletJobs } from './wallets/collect.ts';
import { evaluateAlerts, registerAlertRoutes } from './alerts.ts';
import { registerResearchRoutes } from './research/routes.ts';
import { registerBriefingRoutes, registerBriefingJob } from './briefing.ts';
import { registerMaritimeRoutes } from './maritime/routes.ts';
import { vesselTypeSummary } from './maritime/types.ts';
import { checkRegistrySet } from './research/coverage.ts';
import { afterCollection } from './research/hooks.ts';
import { broadcastStreamEvent, registerStreamRoutes, closeAllStreamClients } from './stream.ts';
import type { HistoryPoint, LinkedContract, Market, MarketHistory, SourceHealth, Status, Tier, TrackerEvent } from '../shared/types.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 5173);
const PROD = process.env.NODE_ENV === 'production';
const SEED = !!process.env.TRACKER_SEED;
if (SEED) {
  const r = loadSeed();
  console.log(`[seed] loaded offline demo seed captured ${r.captured_at}:`, r.rows);
}
const AUTO_REFRESH_MIN = 10;
const STALE_AFTER_MIN = 5;

const app = express();
app.use(express.json());

type Row = Record<string, any>;
const parse = <T>(s: string | null | undefined, fb: T): T => { try { return s ? (JSON.parse(s) as T) : fb; } catch { return fb; } };
const srcMeta = new Map(NEWS_SOURCES.map((s) => [s.id, s]));

function toMarket(r: Row): Market {
  const spread = r.best_bid != null && r.best_ask != null ? r.best_ask - r.best_bid : r.spread ?? null;
  return {
    is_open: Boolean(r.is_open), condition_id: r.condition_id, venue: r.venue, volume_unit: r.volume_unit, open_interest: r.open_interest, event_id: r.event_id, event_title: r.event_title, question: r.question, outcome_label: r.outcome_label,
    price: r.price, quote_basis: r.quote_basis, best_bid: r.best_bid, best_ask: r.best_ask, spread, wide_spread: spread != null && spread > 0.1,
    one_day_change: r.one_day_change, one_week_change: r.one_week_change, volume_total: r.volume_total, volume_24h: r.volume_24h, liquidity: r.liquidity,
    end_date: r.end_date, start_date: r.start_date, provider_updated_at: r.provider_updated_at, observed_at: r.observed_at,
    resolution_url: r.url ?? `https://polymarket.com/event/${r.event_slug}`, resolution_text: r.resolution_text, tags: parse<string[]>(r.tags, []),
    history_points: r.history_points ?? 0,
  };
}

const MARKET_SELECT = `SELECT m.*, (SELECT COUNT(*) FROM price_history h WHERE h.condition_id = m.condition_id) AS history_points FROM markets m`;

function toEvent(r: Row, links: LinkedContract[]): TrackerEvent {
  const meta = srcMeta.get(r.source_id);
  const assets = linkAssets(`${r.title}. ${r.summary}`, r.location_name ? { name: r.location_name, lat: r.lat, lng: r.lng, precision: r.loc_precision } : null);
  return {
    focus_energy_shipping: isEnergyShippingFocus(parse<string[]>(r.topics, []), parse<string[]>(r.entities, []), assets.length > 0 || meta?.kind === 'maritime'),
    event_time: r.time_precision === 'date' ? null : extractEventTime(`${r.title}. ${r.summary}`, r.published_at),
    id: r.id, timestamp: r.published_at, collected_at: r.first_seen_at, source_id: r.source_id, source_name: r.publisher ? `${r.publisher} (via Google News)` : meta?.name ?? r.source_id,
    originating_source: r.originating_source, source_affiliation: meta?.affiliation ?? '', source_scope: meta?.scope ?? null, modified_at: r.modified_at ?? null, revision_count: r.revision_count ?? 0, reliability_tier: ((r.tier as Tier | null) ?? meta?.tier ?? 'Tier-3') as Tier,
    claim_status: 'reported', time_precision: r.time_precision ?? 'instant', publisher: r.publisher ?? null, title: r.title,
    feed_key: `web:${r.source_id}:${r.external_id}`,
    vessel_types: vesselTypeSummary(`${r.title}. ${r.summary}`),
    publisher_time_note: r.publisher_time_raw ? `The feed states ${r.publisher_time_raw}, which is later than when this tracker first collected the item; it is placed at collection time. The feed's time-zone label is probably wrong; no offset is guessed.` : null,
    location: r.location_name ? { name: r.location_name, lat: r.lat, lng: r.lng, precision: r.loc_precision } : null,
    entities: parse<string[]>(r.entities, []), topics: parse<string[]>(r.topics, []), summary: r.summary, raw_url: r.raw_url,
    language: r.language, relevant: !!r.relevant, linked_contracts: links, story: storyFor(r.id),
    assets,
  };
}

function linksFor(ids: string[]): Map<string, LinkedContract[]> {
  const out = new Map<string, LinkedContract[]>();
  if (!ids.length) return out;
  const rows = db.prepare(`SELECT l.event_id, l.condition_id, l.score, l.matched_entities, l.matched_topics, m.question, m.price, m.venue
    FROM event_market_links l JOIN markets m ON m.condition_id = l.condition_id AND m.is_open = 1
    WHERE l.event_id IN (${ids.map(() => '?').join(',')}) ORDER BY l.score DESC, m.volume_24h DESC`).all(...ids) as Row[];
  for (const r of rows) {
    const a = out.get(r.event_id) ?? [];
    a.push({ condition_id: r.condition_id, venue: r.venue, question: r.question, price: r.price, score: r.score, matched_entities: parse(r.matched_entities, []), matched_topics: parse(r.matched_topics, []) });
    out.set(r.event_id, a);
  }
  return out;
}

app.get('/api/events', (req, res) => {
  const includeFiltered = req.query.include_filtered === '1';
  const limit = Math.min(Number(req.query.limit ?? 300), 1000);
  const rows = db.prepare(`SELECT * FROM events ${includeFiltered ? '' : 'WHERE relevant = 1'} ORDER BY published_at DESC LIMIT ?`).all(limit) as Row[];
  const links = linksFor(rows.map((r) => r.id));
  res.json(rows.map((r) => toEvent(r, links.get(r.id) ?? [])));
});

const translateNews = createNewsTranslator(db, { seed: SEED });
app.get('/api/events/:id/translation', (req, res) => res.json(cachedNewsTranslation(db, req.params.id)));
app.post('/api/events/:id/translation', async (req, res) => {
  try { res.json(await translateNews(req.params.id)); }
  catch (e) { res.status(503).json({ error: (e as Error).message }); }
});

app.get('/api/events/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id) as Row | undefined;
  if (!row) return res.status(404).json({ error: 'This news item is no longer available in the tracker.' });
  res.json(toEvent(row, linksFor([row.id]).get(row.id) ?? []));
});

app.get('/api/markets', (_req, res) => {
  const rows = db.prepare(`${MARKET_SELECT} WHERE m.is_open = 1 ORDER BY m.volume_24h DESC NULLS LAST`).all() as Row[];
  res.json(rows.map(toMarket));
});

app.get('/api/markets/:id', (req, res) => {
  const row = db.prepare(`${MARKET_SELECT} WHERE m.condition_id = ?`).get(req.params.id) as Row | undefined;
  if (!row) return res.status(404).json({ error: 'Unknown contract' });
  res.json(toMarket(row));
});

app.get('/api/markets/:id/counterparts', (req, res) => res.json(counterpartsFor(req.params.id)));

app.get('/api/markets/:id/history', async (req, res) => {
  const id = req.params.id;
  const m = db.prepare('SELECT outcome_label, venue FROM markets WHERE condition_id = ?').get(id) as Row | undefined;
  if (!m) return res.status(404).json({ error: 'unknown contract' });
  const state = await ensureAnyHistory(id, 15).catch(() => 'error');
  const pts = db.prepare('SELECT t, p FROM price_history WHERE condition_id = ? ORDER BY t').all(id) as unknown as HistoryPoint[];
  const meta = db.prepare('SELECT fetched_at, fidelity, error FROM history_meta WHERE condition_id = ?').get(id) as Row | undefined;
  const body: MarketHistory & { fetch_state: string; error: string | null } = {
    condition_id: id, outcome_label: m.outcome_label, basis: HISTORY_BASIS[m.venue] ?? 'unknown',
    fetched_at: meta?.fetched_at ?? null, points: pts, fetch_state: state, error: meta?.error ?? null,
  };
  res.json(body);
});

function status(): Status {
  const c = (sql: string) => (db.prepare(sql).get() as Row).c as number;
  return {
    mode: SEED ? 'seed' : 'live', seed_captured_at: SEED ? kvGet('seed_captured_at') : null,
    refreshing: isRefreshing(), last_refresh_finished_at: lastRefreshFinishedAt(), sources: sourceHealth(),
    counts: { events: c('SELECT COUNT(*) c FROM events'), events_relevant: c('SELECT COUNT(*) c FROM events WHERE relevant = 1'),
      markets: c('SELECT COUNT(*) c FROM markets WHERE is_open = 1'), observations: c('SELECT COUNT(*) c FROM market_obs'), history_points: c('SELECT COUNT(*) c FROM price_history') },
    server_time: new Date().toISOString(), versions: versions(),
  };
}

registerTelegramRoutes(app);
registerIndicatorRoutes(app, { seed: SEED });
registerFeedRoutes(app, { seed: SEED });
registerSourcesRoutes(app, { seed: SEED });
registerWalletRoutes(app, { seed: SEED });
registerAlertRoutes(app, { seed: SEED });
registerResearchRoutes(app);
registerBriefingRoutes(app, { seed: SEED });
registerBriefingJob({ seed: SEED });
registerMaritimeRoutes(app);
registerStreamRoutes(app);
checkRegistrySet();
console.log(`[research] ${afterCollection('ingest')}`); // mirror provider end dates on start (local only)
registerWalletJobs(() => {
  try {
    evaluateAlerts({ seed: SEED });
    broadcastStreamEvent('alerts', { at: new Date().toISOString() });
  } catch (e) {
    console.error('[alerts] evaluation failed', e);
  }
});
app.get('/api/sensors', (_req, res) => res.json(readSensors()));

app.get('/api/assets', (_req, res) => {
  try { res.type('json').send(readFileSync(resolve(root, 'data', 'assets.json'), 'utf8')); }
  catch (e) { res.status(500).json({ error: `assets.json unreadable: ${(e as Error).message}` }); }
});

app.get('/api/status', (_req, res) => res.json({ ...status(), collection_paused: Boolean(process.env.TRACKER_NO_AUTO_REFRESH) }));

// Machine-readable health: 200 = ok or degraded (some sources failing/stale), 503 = the store is unreadable or no source has ever succeeded.
const STARTED = Date.now();
app.get('/api/health', (_req, res) => {
  let dbOk = true;
  try { db.prepare('SELECT 1').get(); } catch { dbOk = false; }
  const sources = dbOk ? sourceHealth() : [];
  const active = sources.filter((s) => s.status !== 'blocked');
  const bad = active.filter((s) => s.status === 'error' || s.stale || s.consecutive_failures > 0);
  const neverOk = active.length > 0 && active.every((s) => !s.last_success_at);
  const state = !dbOk || neverOk ? 'down' : bad.length ? 'degraded' : 'ok';
  res.status(state === 'down' ? 503 : 200).json({
    status: state, checked_at: new Date().toISOString(), uptime_s: Math.round((Date.now() - STARTED) / 1000), mode: SEED ? 'seed' : 'live', db_ok: dbOk,
    sources: { total: sources.length, active: active.length, ok: active.length - bad.length, degraded: bad.map((s) => ({ id: s.source_id, status: s.status, stale: s.stale, consecutive_failures: s.consecutive_failures, breaker_open_until: s.breaker_open_until, error: s.error })) },
    last_refresh_finished_at: lastRefreshFinishedAt(),
  });
});
app.post('/api/refresh', (_req, res) => {
  if (SEED) return res.status(409).json({ error: 'seed mode: refresh disabled (offline snapshot)', ...status() });
  const already = isRefreshing();
  runIngest({ force: true })
    .then(() => broadcastStreamEvent('refresh', { finished_at: lastRefreshFinishedAt() }))
    .catch((e) => console.error('[ingest] failed', e));
  runAllJobs(true).catch((e) => console.error('[jobs] failed', e)); // background jobs (Telegram, wallets): leased, budgeted
  res.status(202).json({ started: !already, ...status() });
});

// Stale-while-revalidate: serve cache instantly; refresh in the background when data is old.
function maybeRefresh(reason: string) {
  if (SEED || process.env.TRACKER_NO_AUTO_REFRESH) return; // the latter is for acceptance/QA runs that must not touch the network
  const last = lastRefreshFinishedAt();
  if (!isRefreshing() && (!last || Date.now() - Date.parse(last) > STALE_AFTER_MIN * 60_000)) {
    console.log(`[ingest] starting (${reason})`);
    runIngest()
      .then((r) => {
        console.log('[ingest] done', Object.fromEntries(Object.entries(r.results).map(([k, v]) => [k, v.ok ? 'ok' : v.detail])));
        broadcastStreamEvent('refresh', { finished_at: lastRefreshFinishedAt() });
      })
      .catch((e) => console.error('[ingest] failed', e));
  }
}
app.use('/api/status', (_req, _res, next) => { maybeRefresh('page poll'); next(); });
setInterval(() => maybeRefresh('timer'), AUTO_REFRESH_MIN * 60_000).unref();

if (PROD) {
  const dist = resolve(root, 'dist');
  if (!existsSync(dist)) { console.error('dist/ missing — run `npm run start` (builds first) or `npm run dev`.'); process.exit(1); }
  app.use(express.static(dist));
  app.get('/{*splat}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
} else {
  const vite = await createVite({ root, server: { middlewareMode: true, hmr: { port: PORT < 64535 ? PORT + 1000 : PORT - 1000 } }, appType: 'spa' });
  app.use(vite.middlewares);
}

// Release leases and close streaming clients on shutdown so a restarted server (e.g. `tsx watch`) does not wait for them to expire.
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { releaseAllLeases(); closeAllStreamClients(); process.exit(0); });

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  War Tracker  →  http://localhost:${PORT}  (${PROD ? 'production' : 'dev'})\n`);
  maybeRefresh('startup');
  if (!SEED && !process.env.TRACKER_NO_AUTO_REFRESH) startScheduler();
});
