import { cachedHeadlines, cachedNewsTranslation, createNewsTranslator, registerHeadlineJob } from './translation.ts';
import express from 'express';
import { createServer as createVite } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { db, kvGet } from './db.ts';
import { loadSeed } from './seed.ts';
import { isRefreshing, lastRefreshFinishedAt, runIngest } from './ingest.ts';
import { SOURCE_META } from './registry.ts';
import { versions } from './versions.ts';
import { sourceHealth } from './sourcehealth.ts';
import { counterpartsFor } from './equivalence.ts';
import { registerIndicatorRoutes } from './indicators/routes.ts';
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
import { checkRegistrySet } from './research/coverage.ts';
import { afterCollection } from './research/hooks.ts';
import { broadcastStreamEvent, registerStreamRoutes, closeAllStreamClients } from './stream.ts';
import { registerReviewRoutes, REVIEWS_JSON_LIMIT } from './reviews/routes.ts';
import { MARKET_SELECT, eventView, linksFor, marketView, type EventViewDeps } from './views.ts';
import { closeReviewsStore, openReviewsStore } from './reviews/db.ts';
import { seedReviewsDatabase } from './reviews/seed.ts';
import type { HistoryPoint, LinkedContract, MarketHistory, Status } from '../shared/types.ts';

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
// The reviews importer posts whole CSV exports, which run to megabytes; the default 100 kb limit
// would reject them before the route runs. See REVIEWS_JSON_LIMIT.
app.use(express.json({ limit: REVIEWS_JSON_LIMIT }));

type Row = Record<string, any>;
const srcMeta = SOURCE_META;
const eventDeps: EventViewDeps = { sourceMeta: srcMeta };
const toEvent = (r: Row, links: LinkedContract[]) => eventView(r, links, eventDeps);

app.get('/api/events', (req, res) => {
  const includeFiltered = req.query.include_filtered === '1';
  const limit = Math.min(Number(req.query.limit ?? 300), 1000);
  const rows = db.prepare(`SELECT * FROM events ${includeFiltered ? '' : 'WHERE relevant = 1'} ORDER BY published_at DESC LIMIT ?`).all(limit) as Row[];
  const links = linksFor(db, rows.map((r) => r.id));
  const heads = cachedHeadlines(db, rows as never);
  res.json(rows.map((r) => ({ ...toEvent(r, links.get(r.id) ?? []), title_en: heads.get(r.id) ?? null })));
});

const translateNews = createNewsTranslator(db, { seed: SEED });
registerHeadlineJob(db, { seed: SEED });
app.get('/api/events/:id/translation', (req, res) => res.json(cachedNewsTranslation(db, req.params.id)));
app.post('/api/events/:id/translation', async (req, res) => {
  try { res.json(await translateNews(req.params.id)); }
  catch (e) { res.status(503).json({ error: (e as Error).message }); }
});

app.get('/api/events/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id) as Row | undefined;
  if (!row) return res.status(404).json({ error: 'This news item is no longer available in the tracker.' });
  res.json({ ...toEvent(row, linksFor(db, [row.id]).get(row.id) ?? []), title_en: cachedHeadlines(db, [row as never]).get(row.id) ?? null });
});

app.get('/api/markets', (_req, res) => {
  const rows = db.prepare(`${MARKET_SELECT} WHERE m.is_open = 1 ORDER BY m.volume_24h DESC NULLS LAST`).all() as Row[];
  res.json(rows.map(marketView));
});

app.get('/api/markets/:id', (req, res) => {
  const row = db.prepare(`${MARKET_SELECT} WHERE m.condition_id = ?`).get(req.params.id) as Row | undefined;
  if (!row) return res.status(404).json({ error: 'Unknown contract' });
  res.json(marketView(row));
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

// The reviews store is opened and its bundled dataset loaded here, explicitly, as one boot step.
// The route module accepts the handle rather than creating it, and seeding only ever replaces rows
// marked provenance='seed' — captured reviews and hand-imported CSVs are never touched.
// Set REVIEWS_SEED=0 to open the store without loading the bundled dataset.
const reviewsStore = openReviewsStore();
const reviewsSeed = process.env.REVIEWS_SEED === '0' ? null : seedReviewsDatabase(reviewsStore);
if (reviewsSeed) {
  console.log(reviewsSeed.seeded
    ? `[reviews] bundled dataset loaded: ${reviewsSeed.counts.seed_reviews} demo rows, ${reviewsSeed.counts.captured_reviews} captured rows kept`
    : `[reviews] dataset up to date: ${reviewsSeed.counts.reviews} reviews (${reviewsSeed.counts.seed_reviews} demo, ${reviewsSeed.counts.captured_reviews} captured)`);
}
registerReviewRoutes(app, reviewsStore);
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
// The client's poll is what keeps a page fresh while it is open, but a GET must not collect:
// `POST /api/keep-fresh` carries that intent explicitly and returns the same status payload, so the
// poll costs one request and reading status can never start a collection cycle by accident.
app.post('/api/keep-fresh', (_req, res) => {
  maybeRefresh('page poll');
  res.json({ ...status(), collection_paused: Boolean(process.env.TRACKER_NO_AUTO_REFRESH) });
});
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
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { releaseAllLeases(); closeAllStreamClients(); closeReviewsStore(reviewsStore); process.exit(0); });

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  War Tracker  →  http://localhost:${PORT}  (${PROD ? 'production' : 'dev'})\n`);
  maybeRefresh('startup');
  if (!SEED && !process.env.TRACKER_NO_AUTO_REFRESH) startScheduler();
});
