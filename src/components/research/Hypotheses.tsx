import { EvidencePicker } from './EvidencePicker';
import { ActionButton } from '../ActionButton';
import { useEffect, useState } from 'react';
import type { HypothesisView } from '../../../shared/research';
import { api } from '../../api';
import { absTime } from '../../format';
import { LocalDateTimeInput } from '../LocalDateTimeInput';
import { localDateTime, validLocalDateTime, useDraft } from '../../workspace';
import { navigateContext, useHashContext } from '../../navigation';
import { ErrorChip, SourceLine, attempt } from './common';
import { useResource } from '../../read';

const EMPTY = { title: '', statement: '', scope: '', invalidation_conditions: '', rationale: '', alternative: '', next_check_at: '' };
const editing = (h: HypothesisView) => ({ title: h.title, statement: h.statement, scope: h.scope, invalidation_conditions: h.invalidation_conditions, alternative: h.alternative ?? '', next_check_at: localDateTime(h.next_check_at), expected_version: h.version });
const reviewing = (h: HypothesisView) => ({ assessment: h.assessment as string, rationale: '', next_check_at: localDateTime(h.next_check_at), schedule: 'keep', expected_version: h.version });
function HypothesisCard({ h, onChanged }: { h: HypothesisView; onChanged: () => void }) {
  const [edit, setEdit] = useDraft(`hypothesis-${h.id}-editing`, false);
  const [draft, setDraft] = useDraft(`hypothesis-${h.id}-edit`, editing(h));
  const [ref, setRef] = useDraft(`hypothesis-${h.id}-evidence`, '');
  const [rel, setRel] = useDraft(`hypothesis-${h.id}-relationship`, 'supporting');
  const [why, setWhy] = useDraft(`hypothesis-${h.id}-evidence-rationale`, '');
  const [rv, setRv] = useDraft(`hypothesis-${h.id}-review`, reviewing(h));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!rv.rationale) setRv((r) => ({ ...r, assessment: h.assessment, expected_version: h.version, next_check_at: r.schedule === 'keep' ? localDateTime(h.next_check_at) : r.next_check_at })); }, [h.version]);
  const stale = (edit && draft.expected_version !== h.version) || (rv.rationale && rv.expected_version !== h.version);
  return <article className="panel hypo">
    <h3>{h.title} <span className="chip">{h.status}</span><span className="chip">{h.assessment}</span></h3>
    <p className="small muted">Drafts saved in this browser. Reviews record your judgment and exact evidence versions.</p>
    {stale && <p className="context-notice small">This record changed while you were working. Your draft is preserved; compare with the current text below before merging. <button onClick={() => { setDraft({ ...draft, expected_version: h.version }); setRv({ ...rv, expected_version: h.version }); }}>Use latest version, keep my draft</button></p>}
    <ActionButton className="linkbtn small" onClick={() => { if (!edit) setDraft(editing(h)); setEdit(!edit); }}>{edit ? 'Cancel edit' : 'Edit hypothesis'}</ActionButton>
    {edit && <div className="hypoform">
      {(['title', 'statement', 'scope', 'invalidation_conditions', 'alternative'] as const).map((field) => <label key={field} className="small">{field.replaceAll('_', ' ')}<textarea rows={field === 'title' || field === 'scope' ? 1 : 2} value={draft[field]} onChange={(e) => setDraft({ ...draft, [field]: e.target.value })} /></label>)}
      <LocalDateTimeInput label="Edit next check" value={draft.next_check_at} onChange={(value) => setDraft({ ...draft, next_check_at: value })} />
      <ActionButton disabled={(!!draft.next_check_at && !validLocalDateTime(draft.next_check_at)) || !draft.title.trim() || !draft.statement.trim() || !draft.scope.trim() || !draft.invalidation_conditions.trim()} onClick={() => attempt(() => api.updateHypothesis(h.id, { ...draft, next_check_at: draft.next_check_at ? new Date(draft.next_check_at).toISOString() : null, alternative: draft.alternative || null }), setErr).then((r) => { if (r) { setEdit(false); setDraft(editing(r)); onChanged(); } })}>Save hypothesis</ActionButton>
    </div>}
    <p dir="auto">{h.statement}</p>
    <dl className="kv small"><div><dt>Scope</dt><dd>{h.scope}</dd></div><div><dt>Would weaken / invalidate it</dt><dd>{h.invalidation_conditions}</dd></div>{h.alternative && <div><dt>Alternative explanation</dt><dd>{h.alternative}</dd></div>}<div><dt>Next check</dt><dd>{h.next_check_at ? absTime(h.next_check_at) : 'not scheduled'}</dd></div></dl>
    {h.review_needed.length > 0 && <ul className="small warnlist">{h.review_needed.map((c, i) => <li key={i}>Review needed: {c}</li>)}</ul>}
    <h4>Evidence ({h.evidence.length})</h4>
    <ul className="small evlist">{h.evidence.map((e) => <li key={e.ref}><span className={`chip ${e.relationship === 'contradicting' ? 'warn' : ''}`}>{e.relationship}</span>{e.claim ? <>Claim “{e.claim.quote}” <span className="chip">{e.claim.assessment}</span></> : <SourceLine s={e.source} fallback={e.ref} />}{e.newer_version && <span className="chip warn">source changed since linked</span>}<div className="muted">{e.rationale} — {e.reviewer}, {absTime(e.reviewed_at)}</div><ActionButton className="linkbtn" onClick={() => attempt(() => api.removeHypothesisEvidence(h.id, e.ref), setErr).then((r) => r && onChanged())}>remove</ActionButton></li>)}</ul>
    <details className="add-evidence" open={!!ref || !!why}><summary>Add or reassess evidence</summary><div className="hypoform">
      <EvidencePicker value={ref} onChange={setRef} claims /><select value={rel} onChange={(e) => setRel(e.target.value)} aria-label="Relationship"><option>supporting</option><option>contradicting</option><option>unclear</option></select>
      <input placeholder="evidence rationale (required)" value={why} onChange={(e) => setWhy(e.target.value)} />
      <ActionButton disabled={!ref || !why.trim()} onClick={() => attempt(() => api.addHypothesisEvidence(h.id, { ref, relationship: rel, rationale: why }), setErr).then((r) => { if (r) { setRef(''); setWhy(''); onChanged(); } })}>Link</ActionButton>
    </div></details>
    <h4>Record review &amp; next check</h4><div className="hypoform">
      <select value={rv.assessment} onChange={(e) => setRv({ ...rv, assessment: e.target.value })} aria-label="Assessment"><option>insufficient</option><option>strengthened</option><option>weakened</option><option>unchanged</option></select>
      <textarea placeholder="review rationale (required)" value={rv.rationale} onChange={(e) => setRv({ ...rv, rationale: e.target.value })} />
      <select aria-label="After this review" value={rv.schedule} onChange={(e) => setRv({ ...rv, schedule: e.target.value })}><option value="keep">Keep current next check</option><option value="set">Schedule next check</option><option value="clear">Clear next check</option></select>
      {rv.schedule === 'set' && <LocalDateTimeInput label="Review next check" value={rv.next_check_at} onChange={(value) => setRv({ ...rv, next_check_at: value })} />}
      <ActionButton disabled={!rv.rationale.trim() || (rv.schedule === 'set' && !validLocalDateTime(rv.next_check_at))} onClick={() => attempt(() => api.reviewHypothesis(h.id, { assessment: rv.assessment, rationale: rv.rationale, expected_version: rv.rationale ? rv.expected_version : h.version, ...(rv.schedule === 'keep' ? {} : { next_check_at: rv.schedule === 'clear' ? null : new Date(rv.next_check_at).toISOString() }) }), setErr).then((r) => { if (r) { setRv(reviewing(r)); onChanged(); } })}>Record review</ActionButton>
      <select value={h.status} onChange={(e) => attempt(() => api.updateHypothesis(h.id, { status: e.target.value, expected_version: h.version }), setErr).then((r) => r && onChanged())} aria-label="Status"><option>draft</option><option>active</option><option>closed</option></select>
    </div><ErrorChip e={err} />
    {h.decisions.length > 0 && <details className="small"><summary>Review history ({h.decisions.length})</summary><ol>{h.decisions.map((d, i) => <li key={i}>{absTime(d.at)} — {d.author}: {d.prev_assessment} → <b>{d.new_assessment}</b>; “{d.rationale}”; evidence {d.evidence_versions.map((v) => `${v.ref}${v.version_id ? ` @v${v.version_id}` : ''}`).join('; ')}</li>)}</ol></details>}
  </article>;
}

export function Hypotheses({ versionKey }: { versionKey: string }) {
  const context = useHashContext();
  // One versioned read (it owns staleness and the read failure); writes report separately.
  const { data, error: readErr, reload: load } = useResource<HypothesisView[]>(versionKey, () => api.hypotheses(), { label: 'Hypotheses' });
  const list = data ?? [];
  const [f, setF] = useDraft('new-hypothesis', EMPTY); const [open, setOpen] = useDraft('new-hypothesis-open', false);
  const [q, setQ] = useDraft('hypothesis-search', ''); const [filter, setFilter] = useDraft('hypothesis-filter', 'all');
  // A write failing and a read failing are different events; they used to share one variable.
  const [writeErr, setWriteErr] = useState<string | null>(null);
  const err = readErr ?? writeErr;
  const choose = (id: string) => navigateContext({ tab: 'hypotheses', hypothesis: id }, 'research');
  const selected = list.find((h) => h.id === context.hypothesis) ?? (!context.hypothesis ? list[0] : null);
  useEffect(() => { if (!context.hypothesis && list[0]) navigateContext({ hypothesis: list[0].id }, undefined, true); }, [list, context.hypothesis]);
  const due = list.filter((h) => h.status !== 'closed' && h.next_check_at && Date.parse(h.next_check_at) <= Date.now() + 7 * 86400e3);
  const shown = list.filter((h) => `${h.title} ${h.statement} ${h.scope}`.toLowerCase().includes(q.toLowerCase()) && (filter === 'all' || (filter === 'active' ? h.status === 'active' : filter === 'overdue' ? h.status !== 'closed' && !!h.next_check_at && Date.parse(h.next_check_at) <= Date.now() : h.review_needed.some((cue) => !cue.startsWith('next check was due')))));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return <div className="hypotheses">
    {due.length > 0 && <div className="panel small"><b>Next checks (7 days)</b>: {due.map((h) => <button className="chipbtn" key={h.id} onClick={() => choose(h.id)}>{h.title} — {absTime(h.next_check_at)}</button>)}</div>}
    <ActionButton onClick={() => setOpen(!open)}>{open ? 'Close form' : 'New hypothesis'}</ActionButton>
    {open && <div className="panel hypoform"><input placeholder="title" value={f.title} onChange={set('title')} /><textarea placeholder="statement (testable)" value={f.statement} onChange={set('statement')} /><input placeholder="scope (place / topic / period)" value={f.scope} onChange={set('scope')} /><textarea placeholder="what would weaken or invalidate it (required)" value={f.invalidation_conditions} onChange={set('invalidation_conditions')} /><input placeholder="alternative explanation (optional)" value={f.alternative} onChange={set('alternative')} /><LocalDateTimeInput label="New hypothesis next check" value={f.next_check_at} onChange={(value) => setF({ ...f, next_check_at: value })} /><ActionButton disabled={(!!f.next_check_at && !validLocalDateTime(f.next_check_at)) || !f.title.trim() || !f.statement.trim() || !f.scope.trim() || !f.invalidation_conditions.trim()} onClick={() => attempt(() => api.createHypothesis({ ...f, next_check_at: f.next_check_at ? new Date(f.next_check_at).toISOString() : null, alternative: f.alternative || null }), setWriteErr).then((r) => { if (r) { setF(EMPTY); setOpen(false); choose(r.id); load(); } })}>Create</ActionButton></div>}
    <ErrorChip e={err} /><div className="research-split"><aside className="panel"><input type="search" aria-label="Search hypotheses" placeholder="Search hypotheses…" value={q} onChange={(e) => setQ(e.target.value)} /><select aria-label="Hypothesis queue" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All hypotheses</option><option value="active">Active</option><option value="overdue">Overdue</option><option value="changed">Evidence changed</option></select><ul className="dossierlist">{shown.map((h) => <li key={h.id}><button className={selected?.id === h.id ? 'on' : ''} onClick={() => choose(h.id)}><b>{h.title}</b><span className="small">{h.status} · {h.assessment} · {h.review_needed.length} review cues</span></button></li>)}</ul>{!shown.length && <p className="muted">No matching hypotheses.</p>}</aside><section>{selected ? <HypothesisCard key={selected.id} h={selected} onChanged={load} /> : <p className="muted">{context.hypothesis ? 'This hypothesis is unavailable.' : 'Create a hypothesis to start.'}</p>}</section></div>
  </div>;
}
