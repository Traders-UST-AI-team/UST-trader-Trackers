// W3 — research hypotheses: the user's testable interpretations. Workflow status (draft/active/closed) and the manual assessment
// (insufficient/strengthened/weakened/unchanged) are separate from claim assessments. Evidence relationships are always set by the
// user; a changed source or a newly reviewed claim produces a "review needed" cue, never an automatic change of belief.
// Every assessment is an append-only decision naming its author, time, rationale and the exact evidence versions reviewed.
import { db, tx } from '../db.ts';
import type { HypothesisAssessment, HypothesisEvidenceView, HypothesisStatus, HypothesisView } from '../../shared/research.ts';
import { audit, captureVersion, isRef, latestVersion, newId, resolveRef, text } from './refs.ts';
import { RELATIONSHIPS, type Result } from './claims.ts';
import { listTasks } from './dossiers.ts';

type Row = Record<string, any>;
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });
const STATUSES: HypothesisStatus[] = ['draft', 'active', 'closed'];
const ASSESS: HypothesisAssessment[] = ['insufficient', 'strengthened', 'weakened', 'unchanged'];
const CLAIM_REF = /^claim:(cl_[a-z0-9]+)$/;

function fieldsOf(input: Record<string, unknown>, cur?: Row): { ok: true; v: Record<string, unknown> } | { ok: false; error: string } {
  const v: Record<string, unknown> = {};
  const req: [string, number][] = [['title', 200], ['statement', 2000], ['scope', 500], ['invalidation_conditions', 2000]];
  const opt: [string, number][] = [['rationale', 4000], ['alternative', 2000]];
  for (const [k, max] of req) {
    if (input[k] === undefined && cur) continue;
    const t = text(input[k], k.replace('_', ' '), max);
    if (typeof t !== 'string') return { ok: false, error: `${k.replace('_', ' ')} is required${k === 'invalidation_conditions' ? ' — state what would weaken or invalidate it' : ''}` };
    v[k] = t;
  }
  for (const [k, max] of opt) {
    if (input[k] === undefined) continue;
    const t = text(input[k], k, max, false);
    if (t && typeof t === 'object') return { ok: false, error: t.error };
    v[k] = t ?? (k === 'rationale' ? '' : null);
  }
  if (input.targets !== undefined) {
    if (!Array.isArray(input.targets) || input.targets.length > 20 || !input.targets.every((t) => typeof t === 'string' && t.length <= 200)) return { ok: false, error: 'targets must be up to 20 short identifiers' };
    v.targets = JSON.stringify(input.targets);
  }
  if (input.next_check_at !== undefined) {
    const n = input.next_check_at;
    if (n !== null && n !== '' && !(typeof n === 'string' && Number.isFinite(Date.parse(n)))) return { ok: false, error: 'next_check_at must be an ISO timestamp' };
    v.next_check_at = n ? new Date(n as string).toISOString() : null;
  }
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status as HypothesisStatus)) return { ok: false, error: `status must be one of ${STATUSES.join(', ')}` };
    v.status = input.status;
  }
  return { ok: true, v };
}

export function createHypothesis(input: Record<string, unknown>): Result<HypothesisView> {
  const f = fieldsOf(input);
  if (!f.ok) return fail(400, f.error);
  const id = newId('hy'), now = new Date().toISOString(), v = f.v;
  db.prepare(`INSERT INTO research_hypotheses (id, title, statement, scope, targets, rationale, invalidation_conditions, alternative, status, next_check_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, v.title as string, v.statement as string, v.scope as string, (v.targets as string) ?? '[]', (v.rationale as string) ?? '', v.invalidation_conditions as string,
    (v.alternative as string | null) ?? null, (v.status as string) ?? 'draft', (v.next_check_at as string | null) ?? null, now, now);
  audit('hypothesis', id, 'create', undefined, v);
  return { ok: true, value: hypothesisView(id)! };
}

export function updateHypothesis(id: string, input: Record<string, unknown>): Result<HypothesisView> {
  const cur = db.prepare('SELECT * FROM research_hypotheses WHERE id = ?').get(id) as Row | undefined;
  if (!cur) return fail(404, 'unknown hypothesis');
  if (input.expected_version !== cur.version) return fail(409, `edit conflict: the hypothesis is at version ${cur.version}, your edit was based on ${String(input.expected_version)} — reload and merge`);
  if (input.assessment !== undefined) return fail(400, 'the assessment changes only through a review (POST …/reviews), which records rationale and evidence versions');
  const f = fieldsOf(input, cur);
  if (!f.ok) return fail(400, f.error);
  const keys = Object.keys(f.v);
  if (!keys.length) return fail(400, 'nothing to update');
  db.prepare(`UPDATE research_hypotheses SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ?, version = version + 1 WHERE id = ?`).run(...(keys.map((k) => f.v[k]) as (string | null)[]), new Date().toISOString(), id);
  audit('hypothesis', id, 'update', Object.fromEntries(keys.map((k) => [k, cur[k]])), f.v);
  return { ok: true, value: hypothesisView(id)! };
}

export function addHypothesisEvidence(id: string, input: Record<string, unknown>): Result<HypothesisView> {
  if (!db.prepare('SELECT 1 FROM research_hypotheses WHERE id = ?').get(id)) return fail(404, 'unknown hypothesis');
  const ref = input.ref;
  const claimM = typeof ref === 'string' ? CLAIM_REF.exec(ref) : null;
  if (!isRef(ref) && !claimM) return fail(400, 'ref must be a feed key or claim:<id>');
  if (!RELATIONSHIPS.includes(input.relationship as never)) return fail(400, `relationship must be one of ${RELATIONSHIPS.join(', ')} (set by you; matching never classifies support)`);
  const rationale = text(input.rationale, 'rationale', 2000), reviewer = text(input.reviewer ?? 'me', 'reviewer', 100);
  if (typeof rationale !== 'string') return fail(400, 'a rationale is required');
  if (typeof reviewer !== 'string') return fail(400, 'reviewer is required');
  let versionId: number | null = null;
  if (claimM) { if (!db.prepare('SELECT 1 FROM claims WHERE id = ?').get(claimM[1])) return fail(404, 'unknown claim'); }
  else { const v = captureVersion(ref as string); if (!v || v.kind === 'unavailable') return fail(404, 'source item is not available'); versionId = v.id; }
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO hypothesis_evidence (hypothesis_id, ref, version_id, relationship, rationale, reviewer, reviewed_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(hypothesis_id, ref) DO UPDATE SET version_id = excluded.version_id, relationship = excluded.relationship, rationale = excluded.rationale, reviewer = excluded.reviewer, reviewed_at = excluded.reviewed_at, removed_at = NULL`)
    .run(id, ref as string, versionId, input.relationship as string, rationale, reviewer, now);
  db.prepare('UPDATE research_hypotheses SET updated_at = ? WHERE id = ?').run(now, id);
  audit('hypothesis', id, 'evidence', undefined, { ref, relationship: input.relationship, version_id: versionId, rationale }, reviewer);
  return { ok: true, value: hypothesisView(id)! };
}

export function removeHypothesisEvidence(id: string, ref: string): Result<HypothesisView> {
  const r = db.prepare('UPDATE hypothesis_evidence SET removed_at = ? WHERE hypothesis_id = ? AND ref = ? AND removed_at IS NULL').run(new Date().toISOString(), id, ref);
  if (!Number(r.changes)) return fail(404, 'no such evidence link');
  audit('hypothesis', id, 'evidence_remove', { ref }, undefined);
  return { ok: true, value: hypothesisView(id)! };
}

/** Record a manual assessment. With no evidence attached only "insufficient" can be recorded. */
export function reviewHypothesis(id: string, input: Record<string, unknown>): Result<HypothesisView> {
  const cur = db.prepare('SELECT * FROM research_hypotheses WHERE id = ?').get(id) as Row | undefined;
  if (!cur) return fail(404, 'unknown hypothesis');
  if (input.expected_version !== cur.version) return fail(409, `edit conflict: the hypothesis is at version ${cur.version}`);
  const next = input.assessment as HypothesisAssessment;
  if (!ASSESS.includes(next)) return fail(400, `assessment must be one of ${ASSESS.join(', ')}`);
  const rationale = text(input.rationale, 'rationale', 4000), author = text(input.author ?? 'me', 'author', 100);
  if (typeof rationale !== 'string') return fail(400, 'a rationale is required for every review');
  if (typeof author !== 'string') return fail(400, 'author is required');
  const ev = db.prepare('SELECT ref, version_id FROM hypothesis_evidence WHERE hypothesis_id = ? AND removed_at IS NULL').all(id) as Row[];
  if (next !== 'insufficient' && ev.length === 0) return fail(400, 'no evidence is attached — only "insufficient" can be recorded');
  const schedule = fieldsOf({ next_check_at: input.next_check_at }, cur);
  if (!schedule.ok) return fail(400, schedule.error);
  const nextCheck = input.next_check_at === undefined ? cur.next_check_at : schedule.v.next_check_at;
  const now = new Date().toISOString();
  tx(() => {
    db.prepare('INSERT INTO research_decisions (hypothesis_id, at, author, prev_assessment, new_assessment, rationale, evidence_versions) VALUES (?,?,?,?,?,?,?)')
      .run(id, now, author, cur.assessment, next, rationale, JSON.stringify(ev.map((e) => ({ ref: e.ref, version_id: e.version_id }))));
    db.prepare('UPDATE research_hypotheses SET assessment = ?, next_check_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(next, nextCheck as string | null, now, id);
  });
  audit('hypothesis', id, 'review', { assessment: cur.assessment, next_check_at: cur.next_check_at }, { assessment: next, rationale, next_check_at: nextCheck }, author);
  return { ok: true, value: hypothesisView(id)! };
}

export function hypothesisView(id: string, now = Date.now()): HypothesisView | null {
  const h = db.prepare('SELECT * FROM research_hypotheses WHERE id = ?').get(id) as Row | undefined;
  if (!h) return null;
  const decisions = (db.prepare('SELECT * FROM research_decisions WHERE hypothesis_id = ? ORDER BY id').all(id) as Row[])
    .map((d) => ({ at: d.at, author: d.author, prev_assessment: d.prev_assessment, new_assessment: d.new_assessment, rationale: d.rationale, evidence_versions: JSON.parse(d.evidence_versions) }));
  const lastReview = decisions.at(-1)?.at ?? null;
  const evidence: HypothesisEvidenceView[] = (db.prepare('SELECT * FROM hypothesis_evidence WHERE hypothesis_id = ? AND removed_at IS NULL ORDER BY reviewed_at').all(id) as Row[]).map((e) => {
    const cm = CLAIM_REF.exec(e.ref);
    const claim = cm ? db.prepare('SELECT id, quote, assessment, reviewed_at FROM claims WHERE id = ?').get(cm[1]) as Row | undefined : undefined;
    const latest = cm ? null : latestVersion(e.ref);
    return { ref: e.ref, version_id: e.version_id, relationship: e.relationship, rationale: e.rationale, reviewer: e.reviewer, reviewed_at: e.reviewed_at,
      source: cm ? null : resolveRef(e.ref), claim: claim ? { id: claim.id, quote: claim.quote, assessment: claim.assessment } : null,
      newer_version: latest && e.version_id !== null && latest.id > e.version_id ? latest : null };
  });
  const cues: string[] = [];
  for (const e of evidence) if (e.newer_version) cues.push(`${e.source?.source_name ?? e.ref}: source ${e.newer_version.kind.replace('_', ' ')} after it was linked`);
  for (const e of evidence) if (e.claim && lastReview) {
    const rv = db.prepare('SELECT reviewed_at FROM claims WHERE id = ?').get(e.claim.id) as Row;
    if (rv?.reviewed_at && rv.reviewed_at > lastReview) cues.push(`claim "${e.claim.quote.slice(0, 50)}" was re-assessed (${e.claim.assessment}) after your last review`);
  }
  if (h.status === 'active' && h.next_check_at && Date.parse(h.next_check_at) <= now) cues.push(`next check was due ${h.next_check_at}`);
  return {
    id, title: h.title, statement: h.statement, scope: h.scope, targets: JSON.parse(h.targets), rationale: h.rationale, invalidation_conditions: h.invalidation_conditions, alternative: h.alternative,
    status: h.status, assessment: h.assessment, next_check_at: h.next_check_at, created_at: h.created_at, updated_at: h.updated_at, version: h.version,
    evidence, review_needed: cues, decisions, tasks: listTasks({ hypothesis_id: id }),
  };
}

export const listHypotheses = (): HypothesisView[] =>
  (db.prepare("SELECT id FROM research_hypotheses ORDER BY status = 'closed', COALESCE(next_check_at, '9999'), updated_at DESC").all() as Row[]).map((r) => hypothesisView(r.id)!);
