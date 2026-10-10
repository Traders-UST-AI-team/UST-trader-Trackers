// H1 — claim-level evidence and review. A claim is an attributed statement inside ONE source item, anchored to its exact text in a
// captured version. Workflow state (unreviewed → in_review → reviewed) and assessment (insufficient | supported | contradicted |
// contested) are separate. Nothing is assessed automatically: similarity and outlet counts never set a status; every non-default
// assessment names its reviewer, rationale and the evidence versions it rests on. Retellings of one upstream report form one
// evidence-origin group and are shown as such.
import { db, tx } from '../db.ts';
import { CLAIM_RULE_VERSION, type ClaimAssessment, type ClaimEvidenceView, type ClaimView, type ClaimWorkflow, type EvidenceRelationship } from '../../shared/research.ts';
import { audit, captureVersion, isRef, latestVersion, newId, resolveRef, text, versionById } from './refs.ts';

type Row = Record<string, any>;
export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });
const WORKFLOWS: ClaimWorkflow[] = ['unreviewed', 'in_review', 'reviewed'];
const ASSESSMENTS: ClaimAssessment[] = ['insufficient', 'supported', 'contradicted', 'contested'];
export const RELATIONSHIPS: EvidenceRelationship[] = ['supporting', 'contradicting', 'unclear'];
const PRECISIONS = ['instant', 'date', 'month', 'unknown'];

export function createClaim(input: Record<string, unknown>): Result<ClaimView> {
  if (!isRef(input.source_ref)) return fail(400, 'source_ref must be a feed key (web:<source>:<id> or telegram:<channel>:<post>)');
  const ver = captureVersion(input.source_ref);
  if (!ver || ver.kind === 'unavailable') return fail(404, 'source item is not available in this tracker');
  const quote = text(input.quote, 'quote', 600);
  if (typeof quote !== 'string') return fail(400, (quote as { error: string } | null)?.error ?? 'quote is required');
  const src = resolveRef(input.source_ref)!;
  const hay = `${src.title}\n${src.text}`;
  const at = hay.indexOf(quote);
  if (at < 0) return fail(400, 'quote must be an exact excerpt of the source item (title or text) so the claim stays anchored to what was published');
  const fields: Record<string, string | null> = {};
  for (const [k, max] of [['actor', 200], ['action', 300], ['place', 200], ['stated_time', 100], ['attribution', 300]] as const) {
    const v = text(input[k], k, max, false);
    if (v && typeof v === 'object') return fail(400, v.error);
    fields[k] = v as string | null; // null = explicitly unknown
  }
  const prec = input.stated_time_precision ?? (fields.stated_time ? 'unknown' : null);
  if (prec !== null && !PRECISIONS.includes(prec as string)) return fail(400, `stated_time_precision must be one of ${PRECISIONS.join(', ')}`);
  const id = newId('cl'), now = new Date().toISOString();
  db.prepare(`INSERT INTO claims (id, source_ref, version_id, quote, quote_start, quote_end, actor, action, place, stated_time, stated_time_precision, attribution, rule_version, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'me', ?)`).run(id, input.source_ref, ver.id, quote, at, at + quote.length, fields.actor, fields.action, fields.place, fields.stated_time, prec as string | null, fields.attribution, CLAIM_RULE_VERSION, now);
  audit('claim', id, 'create', undefined, { source_ref: input.source_ref, version_id: ver.id, quote });
  return { ok: true, value: claimView(id)! };
}

export function addClaimEvidence(claimId: string, input: Record<string, unknown>): Result<ClaimView> {
  const c = db.prepare('SELECT id FROM claims WHERE id = ?').get(claimId);
  if (!c) return fail(404, 'unknown claim');
  if (!isRef(input.source_ref)) return fail(400, 'source_ref must be a feed key');
  if (!RELATIONSHIPS.includes(input.relationship as EvidenceRelationship)) return fail(400, `relationship must be one of ${RELATIONSHIPS.join(', ')}`);
  const rationale = text(input.rationale, 'rationale', 1000);
  if (typeof rationale !== 'string') return fail(400, 'a rationale is required for every evidence link');
  const ver = captureVersion(input.source_ref);
  if (!ver || ver.kind === 'unavailable') return fail(404, 'evidence source item is not available in this tracker');
  const src = resolveRef(input.source_ref)!;
  const ref: string = input.source_ref, rel = input.relationship as string;
  const existing = db.prepare('SELECT id FROM claim_evidence WHERE claim_id = ? AND source_ref = ? AND removed_at IS NULL').get(claimId, ref) as Row | undefined;
  if (existing) { // idempotent: re-adding updates the relationship/rationale on the current version (audited)
    db.prepare('UPDATE claim_evidence SET relationship = ?, rationale = ?, version_id = ? WHERE id = ?').run(rel, rationale, ver.id, existing.id);
    audit('claim', claimId, 'evidence_update', undefined, { source_ref: ref, relationship: rel, version_id: ver.id });
  } else {
    db.prepare(`INSERT INTO claim_evidence (id, claim_id, source_ref, version_id, relationship, rationale, origin_group, added_by, added_at) VALUES (?,?,?,?,?,?,?, 'me', ?)`)
      .run(newId('ce'), claimId, ref, ver.id, rel, rationale, src.origin_group, new Date().toISOString());
    audit('claim', claimId, 'evidence_add', undefined, { source_ref: ref, relationship: rel, version_id: ver.id, origin_group: src.origin_group });
  }
  return { ok: true, value: claimView(claimId)! };
}

export function removeClaimEvidence(claimId: string, ref: string): Result<ClaimView> {
  const r = db.prepare('UPDATE claim_evidence SET removed_at = ? WHERE claim_id = ? AND source_ref = ? AND removed_at IS NULL').run(new Date().toISOString(), claimId, ref);
  if (!Number(r.changes)) return fail(404, 'no such evidence link');
  audit('claim', claimId, 'evidence_remove', { source_ref: ref }, undefined);
  return { ok: true, value: claimView(claimId)! };
}

/** Review transition. Rules (claim-review-1.0): a reviewer and rationale are always required; a non-default assessment requires
 *  workflow 'reviewed' and matching evidence — supported ≥ 1 supporting, contradicted ≥ 1 contradicting, contested both. */
export function reviewClaim(claimId: string, input: Record<string, unknown>): Result<ClaimView> {
  const c = db.prepare('SELECT * FROM claims WHERE id = ?').get(claimId) as Row | undefined;
  if (!c) return fail(404, 'unknown claim');
  if (input.expected_version !== c.version) return fail(409, `edit conflict: the claim is at version ${c.version}, your edit was based on ${String(input.expected_version)} — reload and retry`);
  const reviewer = text(input.reviewer, 'reviewer', 100), rationale = text(input.rationale, 'rationale', 2000);
  if (typeof reviewer !== 'string') return fail(400, 'reviewer is required');
  if (typeof rationale !== 'string') return fail(400, 'a rationale is required for every review');
  const state = (input.workflow_state ?? c.workflow_state) as ClaimWorkflow, assessment = (input.assessment ?? c.assessment) as ClaimAssessment;
  if (!WORKFLOWS.includes(state)) return fail(400, `workflow_state must be one of ${WORKFLOWS.join(', ')}`);
  if (!ASSESSMENTS.includes(assessment)) return fail(400, `assessment must be one of ${ASSESSMENTS.join(', ')}`);
  const ev = db.prepare('SELECT relationship, version_id FROM claim_evidence WHERE claim_id = ? AND removed_at IS NULL').all(claimId) as Row[];
  const has = (r: string) => ev.some((e) => e.relationship === r);
  if (assessment !== 'insufficient' && state !== 'reviewed') return fail(400, 'a non-default assessment is only recorded with workflow_state "reviewed"');
  if (assessment === 'supported' && !has('supporting')) return fail(400, '"supported" needs at least one supporting evidence link');
  if (assessment === 'contradicted' && !has('contradicting')) return fail(400, '"contradicted" needs at least one contradicting evidence link');
  if (assessment === 'contested' && !(has('supporting') && has('contradicting'))) return fail(400, '"contested" needs both supporting and contradicting evidence');
  const now = new Date().toISOString();
  tx(() => {
    db.prepare('UPDATE claims SET workflow_state = ?, assessment = ?, reviewer = ?, reviewed_at = ?, rule_version = ?, version = version + 1 WHERE id = ?').run(state, assessment, reviewer, now, CLAIM_RULE_VERSION, claimId);
    db.prepare(`INSERT INTO claim_reviews (claim_id, at, reviewer, prev_state, new_state, prev_assessment, new_assessment, rationale, evidence_versions, rule_version) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(claimId, now, reviewer, c.workflow_state, state, c.assessment, assessment, rationale, JSON.stringify(ev.map((e) => e.version_id)), CLAIM_RULE_VERSION);
  });
  audit('claim', claimId, 'review', { workflow_state: c.workflow_state, assessment: c.assessment }, { workflow_state: state, assessment, reviewer, rationale }, reviewer);
  return { ok: true, value: claimView(claimId)! };
}

export function claimView(id: string): ClaimView | null {
  const c = db.prepare('SELECT * FROM claims WHERE id = ?').get(id) as Row | undefined;
  if (!c) return null;
  const evidence: ClaimEvidenceView[] = (db.prepare('SELECT * FROM claim_evidence WHERE claim_id = ? AND removed_at IS NULL ORDER BY added_at').all(id) as Row[]).map((e) => {
    const latest = latestVersion(e.source_ref);
    return { id: e.id, source_ref: e.source_ref, version_id: e.version_id, relationship: e.relationship, rationale: e.rationale, origin_group: e.origin_group, added_by: e.added_by, added_at: e.added_at,
      source: resolveRef(e.source_ref), version: versionById(e.version_id), newer_version: latest && latest.id > e.version_id ? latest : null };
  });
  const groups = (r: EvidenceRelationship) => new Set(evidence.filter((e) => e.relationship === r).map((e) => e.origin_group)).size;
  const latestOwn = latestVersion(c.source_ref);
  const changed = evidence.filter((e) => e.newer_version);
  const reviewNeeded = c.workflow_state === 'reviewed' && (changed.length || (latestOwn && latestOwn.id > c.version_id))
    ? `${changed.length ? `${changed.length} evidence item(s)` : 'the source item'} changed after it was reviewed (${[...changed.map((e) => e.newer_version!.kind), ...(latestOwn && latestOwn.id > c.version_id ? [latestOwn.kind] : [])].join(', ')}) — the assessment is not changed automatically`
    : null;
  return {
    id, source_ref: c.source_ref, version_id: c.version_id, quote: c.quote, actor: c.actor, action: c.action, place: c.place, stated_time: c.stated_time, stated_time_precision: c.stated_time_precision,
    attribution: c.attribution, workflow_state: c.workflow_state, assessment: c.assessment, rule_version: c.rule_version, reviewer: c.reviewer, reviewed_at: c.reviewed_at, created_at: c.created_at,
    version: c.version, source: resolveRef(c.source_ref), evidence, origin_groups: { supporting: groups('supporting'), contradicting: groups('contradicting'), unclear: groups('unclear') }, review_needed: reviewNeeded,
    history: (db.prepare('SELECT * FROM claim_reviews WHERE claim_id = ? ORDER BY id').all(id) as Row[]).map((h) => ({ at: h.at, reviewer: h.reviewer, prev_state: h.prev_state, new_state: h.new_state, prev_assessment: h.prev_assessment, new_assessment: h.new_assessment, rationale: h.rationale, evidence_versions: JSON.parse(h.evidence_versions) })),
  };
}

export function listClaims(opts: { source_refs?: string[]; limit?: number } = {}): ClaimView[] {
  const ids = opts.source_refs
    ? opts.source_refs.length ? (db.prepare(`SELECT id FROM claims WHERE source_ref IN (${opts.source_refs.map(() => '?').join(',')}) ORDER BY created_at`).all(...opts.source_refs) as Row[]) : []
    : (db.prepare('SELECT id FROM claims ORDER BY created_at DESC LIMIT ?').all(Math.min(200, opts.limit ?? 100)) as Row[]);
  return ids.map((r) => claimView(r.id)!).filter(Boolean);
}
