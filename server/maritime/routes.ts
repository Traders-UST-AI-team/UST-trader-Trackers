// /api/maritime/* — sources directory, vessel watchlist/identity (K1) and vessel-type extraction (J1). No external calls.
import type { Express, Response } from 'express';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addAttribute, addIdentifier, createVessel, listVessels, reviewMention, scanMentions, vesselView } from './vessels.ts';
import { vesselTypeSummary } from './types.ts';
import type { Result } from '../research/claims.ts';
import { bump } from '../versions.ts';

const SOURCES_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'maritime_sources.json');
const send = <T>(res: Response, r: Result<T>, created = false) => { if (!r.ok) return res.status(r.status).json({ error: r.error }); bump('maritime'); res.status(created ? 201 : 200).json(r.value); };
const body = (req: { body?: unknown }) => (req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {});

export function registerMaritimeRoutes(app: Express) {
  app.get('/api/maritime/sources', (_req, res) => res.json(JSON.parse(readFileSync(SOURCES_FILE, 'utf8'))));
  app.get('/api/maritime/vessels', (_req, res) => res.json(listVessels()));
  app.post('/api/maritime/vessels', (req, res) => send(res, createVessel(body(req)), true));
  app.get('/api/maritime/vessels/:id', (req, res) => { const v = vesselView(req.params.id); if (!v) return res.status(404).json({ error: 'unknown vessel' }); res.json(v); });
  app.post('/api/maritime/vessels/:id/identifiers', (req, res) => send(res, addIdentifier(req.params.id, body(req))));
  app.post('/api/maritime/vessels/:id/attributes', (req, res) => send(res, addAttribute(req.params.id, body(req))));
  app.post('/api/maritime/mentions/:id/review', (req, res) => send(res, reviewMention(req.params.id, body(req))));
  app.post('/api/maritime/scan', (_req, res) => { const r = scanMentions(); bump('maritime'); res.json(r); });
  app.post('/api/maritime/vessel-types', (req, res) => {
    const t = body(req).text;
    if (typeof t !== 'string' || t.length > 20000) return res.status(400).json({ error: 'text (≤ 20,000 chars) required' });
    res.json({ types: vesselTypeSummary(t), note: 'Wording only: an extracted type describes how the item names the vessel, not its cargo, owner or status.' });
  });
}
