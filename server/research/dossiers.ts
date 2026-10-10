// W1 — event dossiers: user-reviewed groupings of source items (not the automatic story clusters, not verified incidents).
// Attach/detach is idempotent and audited; suggestions are pending until accepted and always state their reason; the timeline
// keeps publication, collection and captured-revision times apart; tasks need a note or evidence to be closed.
import { db } from '../db.ts';
import type { Disagreement, DossierDetail, DossierState, DossierSummary, ItemRelationship, Suggestion, TaskView, TimelineItem } from '../../shared/research.ts';
import { audit, auditOf, captureVersion, isRef, latestVersion, newId, resolveRef, text, versionById, versionsOf } from './refs.ts';
import { listClaims, type Result } from './claims.ts';

type Row = Record<string, any>;
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });
const STATES: DossierState[] = ['open', 'active', 'closed'];
const RELS: ItemRelationship[] = ['report', 'update', 'correction', 'context'];

const summary = (r: Row): DossierSummary => ({
  id: r.id, title: r.title, description: r.description, workflow_state: r.workflow_state, created_at: r.created_at, updated_at: r.updated_at, version: r.version,
  items: (db.prepare('SELECT COUNT(*) c FROM dossier_items WHERE dossier_id = ? AND detached_at IS NULL').get(r.id) as { c: number }).c,
  open_tasks: (db.prepare("SELECT COUNT(*) c FROM research_tasks WHERE dossier_id = ? AND status = 'open'").get(r.id) as { c: number }).c,
  claims: (db.prepare('SELECT COUNT(*) c FROM claims WHERE source_ref IN (SELECT source_ref FROM dossier_items WHERE dossier_id = ? AND detached_at IS NULL)').get(r.id) as { c: number }).c,
});
export const listDossiers = (): DossierSummary[] => (db.prepare('SELECT * FROM research_dossiers ORDER BY updated_at DESC').all() as Row[]).map(summary);
const getRow = (id: string) => db.prepare('SELECT * FROM research_dossiers WHERE id = ?').get(id) as Row | undefined;

export function createDossier(input: Record<string, unknown>): Result<DossierDetail> {
  const title = text(input.title, 'title', 200), desc = text(input.description, 'description', 4000, false);
  if (typeof title !== 'string') return fail(400, 'title is required (your own working title; the publisher\'s headline is never overwritten)');
  if (desc && typeof desc === 'object') return fail(400, desc.error);
  if (input.from_ref !== undefined && !isRef(input.from_ref)) return fail(400, 'from_ref must be a feed key');
  if (input.from_ref && !resolveRef(input.from_ref)) return fail(404, 'source item is not available in this tracker');
  const id = newId('ds'), now = new Date().toISOString();
  db.prepare('INSERT INTO research_dossiers (id, title, description, created_at, updated_at) VALUES (?,?,?,?,?)').run(id, title, (desc as string | null) ?? '', now, now);
  audit('dossier', id, 'create', undefined, { title, description: desc });
  if (input.from_ref) attachItem(id, { source_ref: input.from_ref, relationship: 'report', rationale: 'dossier created from this item' });
  return { ok: true, value: dossierDetail(id)! };
}

/** Edits carry the version they were based on; a stale version is a conflict, never a silent overwrite. */
export function updateDossier(id: string, input: Record<string, unknown>): Result<DossierDetail> {
  const cur = getRow(id);
  if (!cur) return fail(404, 'unknown dossier');
  if (input.expected_version !== cur.version) return fail(409, `edit conflict: the dossier is at version ${cur.version}, your edit was based on ${String(input.expected_version)}`);
  const next = { title: cur.title, description: cur.description, workflow_state: cur.workflow_state };
  if (input.title !== undefined) { const t = text(input.title, 'title', 200); if (typeof t !== 'string') return fail(400, 'title is required'); next.title = t; }
  if (input.description !== undefined) { const d = text(input.description, 'description', 4000, false); if (d && typeof d === 'object') return fail(400, d.error); next.description = (d as string | null) ?? ''; }
  if (input.workflow_state !== undefined) { if (!STATES.includes(input.workflow_state as DossierState)) return fail(400, `workflow_state must be one of ${STATES.join(', ')}`); next.workflow_state = input.workflow_state; }
  db.prepare('UPDATE research_dossiers SET title = ?, description = ?, workflow_state = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(next.title, next.description, next.workflow_state, new Date().toISOString(), id);
  audit('dossier', id, 'update', { title: cur.title, description: cur.description, workflow_state: cur.workflow_state }, next);
  return { ok: true, value: dossierDetail(id)! };
}

export function attachItem(dossierId: string, input: Record<string, unknown>): Result<DossierDetail> {
  if (!getRow(dossierId)) return fail(404, 'unknown dossier');
  if (!isRef(input.source_ref)) return fail(400, 'source_ref must be a feed key');
  const rel = (input.relationship ?? 'report') as ItemRelationship;
  if (!RELS.includes(rel)) return fail(400, `relationship must be one of ${RELS.join(', ')}`);
  const rationale = text(input.rationale, 'rationale', 1000, false);
  if (rationale && typeof rationale === 'object') return fail(400, rationale.error);
  const basis = input.basis === 'accepted_suggestion' ? 'accepted_suggestion' : 'manual';
  const ref = input.source_ref;
  const existing = db.prepare('SELECT * FROM dossier_items WHERE dossier_id = ? AND source_ref = ?').get(dossierId, ref) as Row | undefined;
  if (existing && !existing.detached_at) return { ok: true, value: dossierDetail(dossierId)! }; // idempotent
  const ver = captureVersion(ref);
  if (!ver || ver.kind === 'unavailable') return fail(404, 'source item is not available in this tracker');
  const now = new Date().toISOString();
  if (existing) db.prepare('UPDATE dossier_items SET detached_at = NULL, relationship = ?, attached_version_id = ?, basis = ?, rationale = ?, attached_at = ? WHERE dossier_id = ? AND source_ref = ?').run(rel, ver.id, basis, (rationale as string | null) ?? '', now, dossierId, ref);
  else db.prepare('INSERT INTO dossier_items (dossier_id, source_ref, relationship, attached_version_id, basis, rationale, attached_at) VALUES (?,?,?,?,?,?,?)').run(dossierId, ref, rel, ver.id, basis, (rationale as string | null) ?? '', now);
  db.prepare('UPDATE research_dossiers SET updated_at = ? WHERE id = ?').run(now, dossierId);
  audit('dossier', dossierId, existing ? 'reattach' : 'attach', undefined, { source_ref: ref, relationship: rel, basis, version_id: ver.id });
  return { ok: true, value: dossierDetail(dossierId)! };
}

export function detachItem(dossierId: string, ref: string): Result<DossierDetail> {
  const r = db.prepare('UPDATE dossier_items SET detached_at = ? WHERE dossier_id = ? AND source_ref = ? AND detached_at IS NULL').run(new Date().toISOString(), dossierId, ref);
  if (!Number(r.changes)) return fail(404, 'item is not attached to this dossier');
  audit('dossier', dossierId, 'detach', { source_ref: ref }, undefined);
  return { ok: true, value: dossierDetail(dossierId)! };
}

/** Candidates from the existing story clusters and Telegram similarity matches of attached items. Shared countries or topics
 *  alone never produce a suggestion, and nothing is attached until the user accepts it. */
export function suggestions(dossierId: string): Suggestion[] {
  const attached = db.prepare('SELECT source_ref, detached_at FROM dossier_items WHERE dossier_id = ?').all(dossierId) as Row[];
  const known = new Set(attached.map((a) => a.source_ref));
  const out = new Map<string, Suggestion>();
  const add = (ref: string, reason: string) => {
    if (known.has(ref) || out.has(ref)) return;
    const s = resolveRef(ref);
    if (s) out.set(ref, { source_ref: ref, title: s.title, source_name: s.source_name, published_at: s.published_at, time_precision: s.time_precision, reason });
  };
  for (const a of attached.filter((x) => !x.detached_at)) {
    const s = resolveRef(a.source_ref);
    if (!s) continue;
    if (s.event_id) {
      const story = db.prepare('SELECT story_id FROM stories WHERE event_id = ?').get(s.event_id) as Row | undefined;
      if (story) for (const r of db.prepare('SELECT e.source_id, e.external_id FROM stories st JOIN events e ON e.id = st.event_id WHERE st.story_id = ? AND e.id != ?').all(story.story_id, s.event_id) as Row[])
        add(`web:${r.source_id}:${r.external_id}`, `same automatic story cluster as "${s.title.slice(0, 60)}" (headline/entity similarity — not confirmation that it is the same incident)`);
      for (const r of db.prepare('SELECT channel, post_id, strength, similarity FROM tg_matches WHERE event_id = ?').all(s.event_id) as Row[])
        add(`telegram:${r.channel}:${r.post_id}`, `Telegram post with similar wording to "${s.title.slice(0, 60)}" (${r.strength}, similarity ${Number(r.similarity).toFixed(2)})`);
    } else {
      const [, ch, pid] = a.source_ref.split(':');
      for (const r of db.prepare('SELECT e.source_id, e.external_id, m.strength FROM tg_matches m JOIN events e ON e.id = m.event_id WHERE m.channel = ? AND m.post_id = ?').all(ch, Number(pid)) as Row[])
        add(`web:${r.source_id}:${r.external_id}`, `news item with similar wording to the attached Telegram post (${r.strength})`);
    }
  }
  return [...out.values()].sort((a, b) => b.published_at.localeCompare(a.published_at)).slice(0, 25);
}

export function timeline(dossierId: string, order: 'published' | 'collected' = 'published'): TimelineItem[] {
  const items = (db.prepare('SELECT * FROM dossier_items WHERE dossier_id = ? AND detached_at IS NULL').all(dossierId) as Row[]).map((r): TimelineItem => {
    const latest = latestVersion(r.source_ref);
    return { source_ref: r.source_ref, relationship: r.relationship, basis: r.basis, rationale: r.rationale, attached_at: r.attached_at, attached_version: versionById(r.attached_version_id),
      source: resolveRef(r.source_ref), versions: versionsOf(r.source_ref), changed_since_attach: !!latest && latest.id > r.attached_version_id };
  });
  const key = (i: TimelineItem) => (order === 'collected' ? i.source?.collected_at ?? i.attached_version?.collected_at : i.source?.published_at ?? i.attached_version?.published_at) ?? '';
  return items.sort((a, b) => key(a).localeCompare(key(b)));
}

/** Attributed statements side by side where claims in this dossier state different values. A difference is something to review,
 *  never a verdict. */
export function disagreements(claims: ReturnType<typeof listClaims>): Disagreement[] {
  const out: Disagreement[] = [];
  for (const field of ['place', 'stated_time', 'actor', 'action'] as const) {
    const m = new Map<string, Disagreement['values'][number]>();
    for (const c of claims) {
      const v = c[field];
      if (!v) continue;
      const k = v.trim().toLowerCase();
      const e = m.get(k) ?? { value: v, claims: [] };
      e.claims.push({ id: c.id, source_name: c.source?.source_name ?? c.source_ref, attribution: c.attribution });
      m.set(k, e);
    }
    if (m.size > 1) out.push({ field, values: [...m.values()] });
  }
  return out;
}

export function dossierDetail(id: string, order: 'published' | 'collected' = 'published'): DossierDetail | null {
  const r = getRow(id);
  if (!r) return null;
  const tl = timeline(id, order);
  const claims = listClaims({ source_refs: tl.map((t) => t.source_ref) });
  return { dossier: summary(r), timeline: tl, suggestions: suggestions(id), tasks: listTasks({ dossier_id: id }), claims, disagreements: disagreements(claims), audit: auditOf('dossier', id) };
}

// ── tasks (shared by dossiers and hypotheses) ──
const taskView = (r: Row): TaskView => ({ id: r.id, dossier_id: r.dossier_id, hypothesis_id: r.hypothesis_id, question: r.question, status: r.status, due_at: r.due_at, resolution_note: r.resolution_note,
  evidence_refs: JSON.parse(r.evidence_refs), created_at: r.created_at, updated_at: r.updated_at, resolved_at: r.resolved_at, version: r.version });
export function listTasks(f: { dossier_id?: string; hypothesis_id?: string; status?: string } = {}): TaskView[] {
  const w: string[] = [], a: string[] = [];
  if (f.dossier_id) { w.push('dossier_id = ?'); a.push(f.dossier_id); }
  if (f.hypothesis_id) { w.push('hypothesis_id = ?'); a.push(f.hypothesis_id); }
  if (f.status) { w.push('status = ?'); a.push(f.status); }
  return (db.prepare(`SELECT * FROM research_tasks ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY status = 'open' DESC, COALESCE(due_at, '9999') , created_at LIMIT 200`).all(...a) as Row[]).map(taskView);
}
const isoOrNull = (v: unknown): string | null | 'bad' => (v === undefined || v === null || v === '' ? null : typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : 'bad');

export function createTask(input: Record<string, unknown>): Result<TaskView> {
  const q = text(input.question, 'question', 500);
  if (typeof q !== 'string') return fail(400, 'question is required');
  const d = typeof input.dossier_id === 'string' ? input.dossier_id : null, h = typeof input.hypothesis_id === 'string' ? input.hypothesis_id : null;
  if (!!d === !!h) return fail(400, 'a task belongs to exactly one dossier or hypothesis');
  if (d && !getRow(d)) return fail(404, 'unknown dossier');
  if (h && !db.prepare('SELECT 1 FROM research_hypotheses WHERE id = ?').get(h)) return fail(404, 'unknown hypothesis');
  const due = isoOrNull(input.due_at);
  if (due === 'bad') return fail(400, 'due_at must be an ISO timestamp');
  const id = newId('tk'), now = new Date().toISOString();
  db.prepare('INSERT INTO research_tasks (id, dossier_id, hypothesis_id, question, due_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(id, d, h, q, due, now, now);
  audit('task', id, 'create', undefined, { question: q, dossier_id: d, hypothesis_id: h, due_at: due });
  return { ok: true, value: taskView(db.prepare('SELECT * FROM research_tasks WHERE id = ?').get(id) as Row) };
}

/** Resolving or dismissing requires a note or at least one evidence reference; reopening is always possible. */
export function updateTask(id: string, input: Record<string, unknown>): Result<TaskView> {
  const cur = db.prepare('SELECT * FROM research_tasks WHERE id = ?').get(id) as Row | undefined;
  if (!cur) return fail(404, 'unknown task');
  if (input.expected_version !== cur.version) return fail(409, `edit conflict: the task is at version ${cur.version}`);
  const status = (input.status ?? cur.status) as string;
  if (!['open', 'resolved', 'dismissed'].includes(status)) return fail(400, 'status must be open, resolved or dismissed');
  const note = input.resolution_note === undefined ? cur.resolution_note : text(input.resolution_note, 'resolution_note', 2000, false);
  if (note && typeof note === 'object') return fail(400, note.error);
  const refs = input.evidence_refs === undefined ? JSON.parse(cur.evidence_refs) as string[] : input.evidence_refs;
  if (!Array.isArray(refs) || refs.length > 20 || !refs.every((r) => isRef(r) || (typeof r === 'string' && /^claim:cl_[a-z0-9]+$/.test(r)))) return fail(400, 'evidence_refs must be up to 20 feed keys or claim references');
  if (status !== 'open' && !note && refs.length === 0) return fail(400, 'closing a task needs a resolution note or linked evidence');
  const due = input.due_at === undefined ? cur.due_at : isoOrNull(input.due_at);
  if (due === 'bad') return fail(400, 'due_at must be an ISO timestamp');
  const now = new Date().toISOString();
  db.prepare('UPDATE research_tasks SET status = ?, resolution_note = ?, evidence_refs = ?, due_at = ?, resolved_at = ?, updated_at = ?, version = version + 1 WHERE id = ?')
    .run(status, (note as string | null) ?? null, JSON.stringify(refs), due, status === 'open' ? null : cur.resolved_at ?? now, now, id);
  audit('task', id, status === cur.status ? 'update' : status === 'open' ? 'reopen' : status, { status: cur.status, resolution_note: cur.resolution_note }, { status, resolution_note: note, evidence_refs: refs });
  return { ok: true, value: taskView(db.prepare('SELECT * FROM research_tasks WHERE id = ?').get(id) as Row) };
}
