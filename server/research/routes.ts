// /api/research/*, /api/calendar, /api/coverage, /api/observation-targets. Local single-user workflows: writes are validated,
// versioned (edit conflicts return 409) and audited; user text is stored as plain text and rendered escaped.
import type { Express, Response } from 'express';
import { addClaimEvidence, claimView, createClaim, listClaims, removeClaimEvidence, reviewClaim, type Result } from './claims.ts';
import { attachItem, createDossier, createTask, detachItem, dossierDetail, listDossiers, listTasks, updateDossier, updateTask } from './dossiers.ts';
import { addHypothesisEvidence, createHypothesis, hypothesisView, listHypotheses, removeHypothesisEvidence, reviewHypothesis, updateHypothesis } from './hypotheses.ts';
import { createEntry, listEntries, updateEntry } from './calendar.ts';
import { coverageReport } from './coverage.ts';
import { observationTargets, setPinnedTargets } from './targets.ts';
import { isRef, resolveRef, versionsOf } from './refs.ts';
import { bump } from '../versions.ts';

const send = <T>(res: Response, r: Result<T>, created = false) => { if (!r.ok) return res.status(r.status).json({ error: r.error }); bump('research'); res.status(created ? 201 : 200).json(r.value); };
const body = (req: { body?: unknown }) => (req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {});

export function registerResearchRoutes(app: Express) {
  // source references
  app.get('/api/research/source', (req, res) => {
    const ref = req.query.ref;
    if (!isRef(ref)) return res.status(400).json({ error: 'ref must be a feed key' });
    res.json({ source: resolveRef(ref), versions: versionsOf(ref), note: 'Versions exist only from the first time research referenced this item; earlier content is unknown.' });
  });
  // dossiers
  app.get('/api/research/dossiers', (_req, res) => res.json(listDossiers()));
  app.post('/api/research/dossiers', (req, res) => send(res, createDossier(body(req)), true));
  app.get('/api/research/dossiers/:id', (req, res) => { const d = dossierDetail(req.params.id, req.query.order === 'collected' ? 'collected' : 'published'); if (!d) return res.status(404).json({ error: 'unknown dossier' }); res.json(d); });
  app.patch('/api/research/dossiers/:id', (req, res) => send(res, updateDossier(req.params.id, body(req))));
  app.post('/api/research/dossiers/:id/items', (req, res) => send(res, attachItem(req.params.id, body(req))));
  app.delete('/api/research/dossiers/:id/items', (req, res) => { const ref = req.query.ref; if (typeof ref !== 'string') return res.status(400).json({ error: 'ref query parameter required' }); send(res, detachItem(req.params.id, ref)); });
  // tasks
  app.get('/api/research/tasks', (req, res) => res.json(listTasks({ dossier_id: req.query.dossier_id as string | undefined, hypothesis_id: req.query.hypothesis_id as string | undefined, status: req.query.status as string | undefined })));
  app.post('/api/research/tasks', (req, res) => send(res, createTask(body(req)), true));
  app.patch('/api/research/tasks/:id', (req, res) => send(res, updateTask(req.params.id, body(req))));
  // claims (H1)
  app.get('/api/research/claims', (req, res) => res.json(listClaims(typeof req.query.ref === 'string' ? { source_refs: [req.query.ref] } : {})));
  app.post('/api/research/claims', (req, res) => send(res, createClaim(body(req)), true));
  app.get('/api/research/claims/:id', (req, res) => { const c = claimView(req.params.id); if (!c) return res.status(404).json({ error: 'unknown claim' }); res.json(c); });
  app.post('/api/research/claims/:id/evidence', (req, res) => send(res, addClaimEvidence(req.params.id, body(req))));
  app.delete('/api/research/claims/:id/evidence', (req, res) => { const ref = req.query.ref; if (typeof ref !== 'string') return res.status(400).json({ error: 'ref query parameter required' }); send(res, removeClaimEvidence(req.params.id, ref)); });
  app.post('/api/research/claims/:id/reviews', (req, res) => send(res, reviewClaim(req.params.id, body(req))));
  // hypotheses (W3)
  app.get('/api/research/hypotheses', (_req, res) => res.json(listHypotheses()));
  app.post('/api/research/hypotheses', (req, res) => send(res, createHypothesis(body(req)), true));
  app.get('/api/research/hypotheses/:id', (req, res) => { const h = hypothesisView(req.params.id); if (!h) return res.status(404).json({ error: 'unknown hypothesis' }); res.json(h); });
  app.patch('/api/research/hypotheses/:id', (req, res) => send(res, updateHypothesis(req.params.id, body(req))));
  app.post('/api/research/hypotheses/:id/evidence', (req, res) => send(res, addHypothesisEvidence(req.params.id, body(req))));
  app.delete('/api/research/hypotheses/:id/evidence', (req, res) => { const ref = req.query.ref; if (typeof ref !== 'string') return res.status(400).json({ error: 'ref query parameter required' }); send(res, removeHypothesisEvidence(req.params.id, ref)); });
  app.post('/api/research/hypotheses/:id/reviews', (req, res) => send(res, reviewHypothesis(req.params.id, body(req))));
  // calendar (W4)
  app.get('/api/calendar', (req, res) => {
    const from = typeof req.query.from === 'string' && Number.isFinite(Date.parse(req.query.from)) ? new Date(req.query.from).toISOString() : new Date(Date.now() - 86400e3).toISOString();
    const to = typeof req.query.to === 'string' && Number.isFinite(Date.parse(req.query.to)) ? new Date(req.query.to).toISOString() : new Date(Date.now() + 90 * 86400e3).toISOString();
    if (Date.parse(to) - Date.parse(from) > 400 * 86400e3 || to <= from) return res.status(400).json({ error: 'from/to must span (0, 400] days' });
    res.json({ from, to, entries: listEntries(from, to, { includeClosed: req.query.include_closed === '1' }), note: 'Provider end dates keep the provider\'s meaning; resolution can be later and is not inferred.' });
  });
  app.post('/api/calendar', (req, res) => send(res, createEntry(body(req)), true));
  app.patch('/api/calendar/:id', (req, res) => send(res, updateEntry(req.params.id, body(req))));
  // coverage (W5) and observation targets (W2)
  app.get('/api/coverage', (req, res) => { const w = Number(req.query.window ?? 24); if (!Number.isFinite(w) || w < 1 || w > 24 * 30) return res.status(400).json({ error: 'window must be 1–720 hours' }); res.json(coverageReport(w)); });
  app.get('/api/observation-targets', (_req, res) => res.json(observationTargets()));
  app.put('/api/observation-targets/pins', (req, res) => { const r = setPinnedTargets(body(req).pinned); if (!r.ok) return res.status(400).json({ error: r.error }); res.json(observationTargets()); });
}
