import type { Express } from 'express';
import { SENSORS } from '../sources/sensors.ts';
import { DEFS, REGISTRY_VERSION, activityIndicators, eventReaction, getPrefs, getWatchlist, marketIndicators, sensorIndicators, setPrefs, setWatchlist, watchlistCards } from './service.ts';

const num = (v: unknown): number | undefined => { const n = Number(v); return Number.isFinite(n) && String(v).trim() !== '' ? n : undefined; };

/** asOf may be a past time (historical indicators) but never meaningfully in the future. */
function asOfOf(q: unknown): number | undefined | 'bad' {
  if (q === undefined) return undefined;
  const n = num(q);
  if (n === undefined || n < 0 || n > Date.now() / 1000 + 60) return 'bad';
  return Math.floor(n);
}

export function registerIndicatorRoutes(app: Express, opts: { seed: boolean }) {
  app.get('/api/indicators/registry', (_req, res) => res.json({ definition_version: REGISTRY_VERSION, indicators: DEFS }));

  app.get('/api/markets/:id/indicators', (req, res) => {
    const asOf = asOfOf(req.query.asOf);
    if (asOf === 'bad') return res.status(400).json({ error: 'asOf must be a unix timestamp (seconds) not in the future' });
    const ids = typeof req.query.indicators === 'string' ? req.query.indicators.split(',') : [];
    const out = marketIndicators(req.params.id, ids, { asOf, since: num(req.query.since) });
    if (!out) return res.status(404).json({ error: 'unknown contract' });
    if (out.rejected.length) return res.status(400).json({ error: `unregistered or out-of-range indicator(s): ${out.rejected.join(', ')}`, registry: '/api/indicators/registry' });
    res.json({ ...out, seed_mode: opts.seed });
  });

  app.get('/api/markets/:id/reaction', (req, res) => {
    const ts = num(req.query.ts);
    if (ts === undefined || ts < 0 || ts > Date.now() / 1000 + 60) return res.status(400).json({ error: 'ts must be the item publication time as a unix timestamp (seconds), not in the future' });
    const precision = req.query.precision === 'date' ? 'date' : 'instant';
    const asOf = asOfOf(req.query.asOf);
    if (asOf === 'bad') return res.status(400).json({ error: 'asOf must be a unix timestamp (seconds) not in the future' });
    const out = eventReaction(req.params.id, Math.floor(ts), precision, asOf);
    if (!out) return res.status(404).json({ error: 'unknown contract' });
    res.json(out);
  });

  app.get('/api/sensors/:id/indicators', (req, res) => {
    const asOf = asOfOf(req.query.asOf);
    if (asOf === 'bad') return res.status(400).json({ error: 'asOf must be a unix timestamp (seconds) not in the future' });
    const ids = typeof req.query.indicators === 'string' ? req.query.indicators.split(',') : [];
    const out = sensorIndicators(req.params.id, ids, { asOf, since: num(req.query.since) });
    if (!out) return res.status(404).json({ error: 'unknown sensor series' });
    if (out.rejected.length) return res.status(400).json({ error: `unregistered or out-of-range indicator(s): ${out.rejected.join(', ')}`, registry: '/api/indicators/registry' });
    res.json({ ...out, seed_mode: opts.seed });
  });

  /** Default indicator(s) for every sensor series in one call (the Sensors tab). */
  app.get('/api/indicators/sensors', (_req, res) => {
    res.json({ definition_version: REGISTRY_VERSION, seed_mode: opts.seed, series: SENSORS.map((d) => ({ id: d.id, indicators: sensorIndicators(d.id, [], {})?.indicators ?? [] })) });
  });

  app.get('/api/watchlist', (req, res) => {
    const asOf = asOfOf(req.query.asOf);
    if (asOf === 'bad') return res.status(400).json({ error: 'asOf must be a unix timestamp (seconds) not in the future' });
    res.json({ ...watchlistCards(asOf), items: getWatchlist(), seed_mode: opts.seed });
  });
  app.put('/api/watchlist', (req, res) => {
    const r = setWatchlist(req.body?.items);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ...watchlistCards(), items: r.items });
  });

  app.get('/api/prefs', (_req, res) => res.json(getPrefs()));
  app.put('/api/prefs', (req, res) => {
    const r = setPrefs(req.body);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r.prefs);
  });

  app.get('/api/indicators/activity', (_req, res) => res.json(activityIndicators()));
}
