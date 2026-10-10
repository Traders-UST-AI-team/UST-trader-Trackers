import { SourceReader } from './SourceReader';
import { LocalDateTimeInput } from '../LocalDateTimeInput';
import { validLocalDateTime, useDraft } from '../../workspace';
import { navigateContext, useHashContext } from '../../navigation';
import { EvidencePicker } from './EvidencePicker';
import { ActionButton } from '../ActionButton';
import { useEffect, useState } from 'react';
import type { ClaimView, DossierDetail, DossierSummary, TimelineItem } from '../../../shared/research';
import { api } from '../../api';
import { useResource } from '../../read';
import { absTime, ago } from '../../format';
import { ErrorChip, SourceLine, Versions, attempt } from './common';

const ASSESS_HELP: Record<string, string> = {
  insufficient: 'default — not enough reviewed evidence', supported: 'reviewed: supporting evidence outweighs', contradicted: 'reviewed: contradicting evidence outweighs', contested: 'reviewed: credible evidence on both sides',
};

function ClaimForm({ item, quote, onDone }: { item: TimelineItem; quote?: string; onDone: () => void }) {
  const [f, setF] = useDraft(`claim-new-${item.source_ref}`, { quote: quote ?? '', actor: '', action: '', place: '', stated_time: '', attribution: '' });
  useEffect(() => { if (quote) setF((f) => ({ ...f, quote })); }, [quote]);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="claimform">
      <textarea placeholder="Exact excerpt from the item (the claim stays anchored to it)" value={f.quote} onChange={set('quote')} rows={2} />
      <div className="row2">
        <input placeholder="actor (as stated)" value={f.actor} onChange={set('actor')} />
        <input placeholder="action (as stated)" value={f.action} onChange={set('action')} />
        <input placeholder="place (as stated)" value={f.place} onChange={set('place')} />
        <input placeholder="time (as stated)" value={f.stated_time} onChange={set('stated_time')} />
        <input placeholder="attribution (who says it)" value={f.attribution} onChange={set('attribution')} />
      </div>
      <ActionButton disabled={!f.quote.trim()} onClick={async () => { if (await attempt(() => api.createClaim({ source_ref: item.source_ref, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim())) }), setErr)) { setF({ quote: '', actor: '', action: '', place: '', stated_time: '', attribution: '' }); onDone(); } }}>Record claim</ActionButton>
      <span className="muted small">Empty fields are recorded as unknown.</span> <ErrorChip e={err} />
    </div>
  );
}

function ClaimCard({ c, items, onChanged }: { c: ClaimView; items: TimelineItem[]; onChanged: () => void }) {
  const [evRef, setEvRef] = useDraft(`claim-${c.id}-evidence`, ''); const [rel, setRel] = useDraft(`claim-${c.id}-relation`, 'supporting'); const [why, setWhy] = useDraft(`claim-${c.id}-why`, '');
  const [rv, setRv] = useDraft(`claim-${c.id}-review`, { workflow_state: c.workflow_state, assessment: c.assessment, reviewer: '', rationale: '', expected_version: c.version });
  useEffect(() => { if (!rv.rationale) setRv((r) => ({ ...r, workflow_state: c.workflow_state, assessment: c.assessment, expected_version: c.version })); }, [c.version]);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="claimcard">
      <blockquote dir="auto">“{c.quote}”</blockquote>
      <div className="small"><SourceLine s={c.source} fallback={c.source_ref} /></div>
      <dl className="kv small">
        {(['actor', 'action', 'place', 'stated_time', 'attribution'] as const).map((k) => <div key={k}><dt>{k.replace('_', ' ')}</dt><dd>{c[k] ?? <span className="muted">unknown</span>}</dd></div>)}
      </dl>
      <div className="small">
        <span className={`chip ${c.assessment === 'insufficient' ? '' : 'link'}`} title={ASSESS_HELP[c.assessment]}>{c.assessment}</span>
        <span className="chip">{c.workflow_state.replace('_', ' ')}</span>
        {c.reviewer && <span className="muted"> by {c.reviewer} {ago(c.reviewed_at)}</span>}
        <span className="muted"> · origin groups: {c.origin_groups.supporting} supporting, {c.origin_groups.contradicting} contradicting, {c.origin_groups.unclear} unclear</span>
      </div>
      {c.review_needed && <div className="chip warn">{c.review_needed}</div>}
      <ul className="small evlist">{c.evidence.map((e) => (
        <li key={e.id}><span className={`chip ${e.relationship === 'contradicting' ? 'warn' : ''}`}>{e.relationship}</span> <SourceLine s={e.source} fallback={e.source_ref} /> <span className="muted">origin {e.origin_group}</span>{e.newer_version && <span className="chip warn">changed since linked</span>}
          <div className="muted">{e.rationale}</div><ActionButton className="linkbtn" onClick={() => attempt(() => api.removeClaimEvidence(c.id, e.source_ref), setErr).then(onChanged)}>remove</ActionButton></li>
      ))}</ul>
      <div className="row2">
        <select value={evRef} onChange={(e) => setEvRef(e.target.value)} aria-label="Evidence item"><option value="">add evidence from this dossier…</option>{items.map((i) => <option key={i.source_ref} value={i.source_ref}>{i.source?.source_name}: {i.source?.title.slice(0, 60)}</option>)}</select>
        <select value={rel} onChange={(e) => setRel(e.target.value)} aria-label="Relationship"><option>supporting</option><option>contradicting</option><option>unclear</option></select>
        <input placeholder="rationale (required)" value={why} onChange={(e) => setWhy(e.target.value)} />
        <ActionButton disabled={!evRef || !why.trim()} onClick={() => attempt(() => api.addClaimEvidence(c.id, { source_ref: evRef, relationship: rel, rationale: why }), setErr).then((r) => { if (r) { setEvRef(''); setWhy(''); onChanged(); } })}>Link</ActionButton>
      </div>
      {rv.expected_version !== c.version && <p className="context-notice small">This claim changed. Compare the current claim before merging. <button onClick={() => setRv({ ...rv, expected_version: c.version })}>Use latest claim version, keep review draft</button></p>}
      <details className="small"><summary>Review</summary>
        <div className="row2">
          <select value={rv.workflow_state} onChange={(e) => setRv({ ...rv, workflow_state: e.target.value as typeof rv.workflow_state })}><option value="unreviewed">unreviewed</option><option value="in_review">in review</option><option value="reviewed">reviewed</option></select>
          <select value={rv.assessment} onChange={(e) => setRv({ ...rv, assessment: e.target.value as typeof rv.assessment })}>{Object.keys(ASSESS_HELP).map((a) => <option key={a} value={a}>{a}</option>)}</select>
          <input placeholder="reviewer" value={rv.reviewer} onChange={(e) => setRv({ ...rv, reviewer: e.target.value })} />
          <input placeholder="rationale (required)" value={rv.rationale} onChange={(e) => setRv({ ...rv, rationale: e.target.value })} />
          <ActionButton disabled={!rv.reviewer.trim() || !rv.rationale.trim()} onClick={() => attempt(() => api.reviewClaim(c.id, rv), setErr).then((r) => { if (r) { setRv({ ...rv, rationale: '', expected_version: r.version }); onChanged(); } })}>Record review</ActionButton>
        </div>
        <p className="muted">An assessment is an evidence judgment by a named reviewer, not a guarantee of truth. Several outlets retelling one upstream report count as one origin.</p>
        {c.history.length > 0 && <ol>{c.history.map((h, i) => <li key={i}>{absTime(h.at)} — {h.reviewer}: {h.prev_assessment} → <b>{h.new_assessment}</b> ({h.new_state}); “{h.rationale}”; evidence versions {h.evidence_versions.join(', ') || 'none'}</li>)}</ol>}
      </details>
      <ErrorChip e={err} />
    </div>
  );
}

function Detail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [d, setD] = useState<DossierDetail | null>(null);
  const [order, setOrder] = useState<'published' | 'collected'>('published');
  const [err, setErr] = useState<string | null>(null);
  const [claimFor, setClaimFor] = useDraft<string | null>(`dossier-${id}-claimFor`, null);
  const [attachRef, setAttachRef] = useDraft(`dossier-${id}-attachRef`, '');
  const [q, setQ] = useDraft(`dossier-${id}-q`, ''); const [note, setNote] = useDraft<Record<string, string>>(`dossier-${id}-note`, {});
  const [due, setDue] = useDraft(`dossier-${id}-task-due`, '');
  const [taskEvidence, setTaskEvidence] = useDraft<Record<string, string>>(`dossier-${id}-task-evidence`, {});
  const [quoteDraft, setQuoteDraft] = useState<{ ref: string; text: string } | null>(null);
  const [edit, setEdit] = useDraft<{ title: string; description: string; expected_version: number } | null>(`dossier-${id}-edit`, null);
  const load = () => api.dossier(id, order).then(setD).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, [id, order]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <p className="muted">{err ?? 'Loading dossier…'}</p>;
  const reload = () => { load(); onChanged(); };
  const x = d.dossier;
  return (
    <div className="dossier">
      {edit && edit.expected_version !== x.version && <p className="context-notice small">Dossier metadata changed. Your draft is preserved. <button onClick={() => setEdit({ ...edit, expected_version: x.version })}>Use latest dossier version, keep draft</button></p>}
      {edit ? (
        <div className="row2">
          <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} aria-label="Title" />
          <input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} aria-label="Description" placeholder="description" />
          <ActionButton onClick={() => attempt(() => api.updateDossier(id, edit), setErr).then((r) => { if (r) { setEdit(null); reload(); } })}>Save</ActionButton>
          <ActionButton className="linkbtn" onClick={() => setEdit(null)}>cancel</ActionButton>
        </div>
      ) : (
        <h3>{x.title} <ActionButton className="linkbtn small" onClick={() => setEdit({ title: x.title, description: x.description, expected_version: x.version })}>edit</ActionButton>
          <select className="small" value={x.workflow_state} onChange={(e) => attempt(() => api.updateDossier(id, { workflow_state: e.target.value, expected_version: x.version }), setErr).then(reload)} aria-label="State"><option>open</option><option>active</option><option>closed</option></select></h3>
      )}
      <p className="small muted">Drafts saved in this browser. <button className="linkbtn" onClick={() => navigateContext({ dossier: id }, 'dashboard')}>Return to chart</button></p>
      {x.description && <p className="small">{x.description}</p>}
      <p className="muted small">Your working grouping — not an automatic story cluster and not a verified incident. Headlines stay as published.</p>
      <ErrorChip e={err} />

      <h4>Timeline <span className="seg small"><ActionButton className={order === 'published' ? 'on' : ''} onClick={() => setOrder('published')}>by publication</ActionButton><ActionButton className={order === 'collected' ? 'on' : ''} onClick={() => setOrder('collected')}>entered our system</ActionButton></span></h4>
      <details className="small add-evidence"><summary>Attach a source item</summary><EvidencePicker value={attachRef} onChange={setAttachRef} /><ActionButton disabled={!attachRef} onClick={() => attempt(() => api.attach(id, { source_ref: attachRef, relationship: 'report' }), setErr).then((r) => { if (r) { setAttachRef(''); reload(); } })}>Attach source</ActionButton></details>
      {d.timeline.length === 0 && <p className="empty">No sources attached. Choose an item above or open a source from the dashboard.</p>}
      <ol className="timeline">{d.timeline.map((t) => (
        <li key={t.source_ref}>
          <div><span className="chip">{t.relationship}</span>{t.basis === 'accepted_suggestion' && <span className="chip">accepted suggestion</span>} <b dir="auto">{t.source?.title ?? t.attached_version?.title ?? t.source_ref}</b></div>
          <SourceLine s={t.source} fallback={t.source_ref} /> <Versions versions={t.versions} />{t.changed_since_attach && <span className="chip warn">changed since attached</span>}
          <SourceReader source={t.source} versions={t.versions} onQuote={(text) => { setQuoteDraft({ ref: t.source_ref, text }); setClaimFor(t.source_ref); }} />
          {t.rationale && <div className="small muted">{t.rationale}</div>}
          <div className="small"><ActionButton className="linkbtn" onClick={() => setClaimFor(claimFor === t.source_ref ? null : t.source_ref)}>record a claim</ActionButton> · <ActionButton className="linkbtn" onClick={() => attempt(() => api.detach(id, t.source_ref), setErr).then(reload)}>detach</ActionButton></div>
          {claimFor === t.source_ref && <ClaimForm item={t} quote={quoteDraft?.ref === t.source_ref ? quoteDraft.text : undefined} onDone={() => { setClaimFor(null); reload(); }} />}
        </li>
      ))}</ol>

      {d.suggestions.length > 0 && (
        <details className="small"><summary><b>{d.suggestions.length} suggested item(s)</b> — pending until you attach them</summary>
          <ul>{d.suggestions.map((s) => <li key={s.source_ref}><b>{s.source_name}</b> {s.title} <span className="muted">— {s.reason}</span> <ActionButton className="linkbtn" onClick={() => attempt(() => api.attach(id, { source_ref: s.source_ref, basis: 'accepted_suggestion' }), setErr).then(reload)}>attach</ActionButton></li>)}</ul>
        </details>
      )}

      {d.disagreements.length > 0 && (
        <><h4>Differences between attributed statements <span className="muted small">(to review — not a verdict)</span></h4>
          {d.disagreements.map((g) => <div key={g.field} className="small"><b>{g.field.replace('_', ' ')}</b>: {g.values.map((v, i) => <span key={i} className="chip">{v.value} — {v.claims.map((c) => c.attribution ?? c.source_name).join(', ')}</span>)}</div>)}</>
      )}

      <h4>Claims ({d.claims.length})</h4>
      {d.claims.length === 0 ? <p className="small muted">No claims recorded. Use “record a claim” on an item to quote an attributed statement.</p> : d.claims.map((c) => <ClaimCard key={c.id} c={c} items={d.timeline} onChanged={reload} />)}

      <h4>Checklist</h4>
      <ul className="tasks small">{d.tasks.map((t) => (
        <li key={t.id} className={t.status}>
          <b>{t.question}</b> <span className="chip">{t.status}</span>{t.due_at && <span className="muted"> due {absTime(t.due_at)}</span>}{t.resolution_note && <div className="muted">{t.resolution_note}</div>}{t.evidence_refs.length > 0 && <div className="muted">Evidence: {t.evidence_refs.map((ref) => d.timeline.find((item) => item.source_ref === ref)?.source?.title ?? ref).join('; ')}</div>}
          {t.status === 'open' ? (
            <span className="row2"><input placeholder="resolution note" value={note[t.id] ?? ''} onChange={(e) => setNote({ ...note, [t.id]: e.target.value })} />
              <select aria-label={`Resolution evidence for ${t.question}`} value={taskEvidence[t.id] ?? ''} onChange={(e) => setTaskEvidence({ ...taskEvidence, [t.id]: e.target.value })}><option value="">Optional resolution evidence…</option>{d.timeline.map((item) => <option key={item.source_ref} value={item.source_ref}>{item.source?.title ?? item.source_ref}</option>)}</select>
              <ActionButton disabled={!note[t.id]?.trim() && !taskEvidence[t.id]} onClick={() => attempt(() => api.updateTask(t.id, { expected_version: t.version, status: 'resolved', resolution_note: note[t.id] || null, evidence_refs: taskEvidence[t.id] ? [taskEvidence[t.id]] : [] }), setErr).then(reload)}>resolve</ActionButton>
              <ActionButton disabled={!note[t.id]?.trim()} className="linkbtn" onClick={() => attempt(() => api.updateTask(t.id, { expected_version: t.version, status: 'dismissed', resolution_note: note[t.id] }), setErr).then(reload)}>dismiss</ActionButton></span>
          ) : <ActionButton className="linkbtn" onClick={() => attempt(() => api.updateTask(t.id, { expected_version: t.version, status: 'open' }), setErr).then(reload)}>reopen</ActionButton>}
        </li>
      ))}</ul>
      <div className="row2"><input placeholder="new question to check" value={q} onChange={(e) => setQ(e.target.value)} /><LocalDateTimeInput label="Checklist due time" value={due} onChange={setDue} /><ActionButton disabled={!q.trim() || (!!due && !validLocalDateTime(due))} onClick={() => attempt(() => api.createTask({ dossier_id: id, question: q, due_at: due ? new Date(due).toISOString() : null }), setErr).then((r) => { if (r) { setQ(''); setDue(''); reload(); } })}>Add</ActionButton></div>

      <details className="small"><summary>Audit history ({d.audit.length})</summary><ol>{d.audit.map((a, i) => <li key={i}>{absTime(a.at)} — {a.actor} {a.action} {a.after ? <code>{JSON.stringify(a.after).slice(0, 140)}</code> : null}</li>)}</ol></details>
    </div>
  );
}

export function Dossiers({ initial, versionKey }: { initial: string | null; versionKey: string }) {
  const context = useHashContext();
  const [search, setSearch] = useDraft('dossier-search', '');
  const [state, setState] = useDraft('dossier-state', 'all');
  const [sel, setSel] = useState<string | null>(initial);
  const [title, setTitle] = useDraft('new-dossier-title', '');
  const [writeErr, setWriteErr] = useState<string | null>(null);
  const { data, error: readErr, reload: load } = useResource<DossierSummary[]>(versionKey, () => api.dossiers(), { label: 'Dossiers' });
  const list = data ?? [];
  const err = readErr ?? writeErr;
  // Selecting the first dossier is a consequence of what was read, not part of reading it.
  useEffect(() => {
    if (data && data.length > 0 && !sel) { setSel(data[0].id); navigateContext({ dossier: data[0].id }, undefined, true); }
  }, [data, sel]);
  useEffect(() => { setSel(context.dossier ?? initial ?? list[0]?.id ?? null); }, [context.dossier, initial]);
  const choose = (id: string) => { setSel(id); navigateContext({ dossier: id, tab: 'dossiers' }, 'research'); };
  const shown = list.filter((d) => d.title.toLowerCase().includes(search.toLowerCase()) && (state === 'all' || d.workflow_state === state));
  return (
    <div className="research-split">
      <aside className="panel">
        <div className="row2"><input placeholder="new dossier title" value={title} onChange={(e) => setTitle(e.target.value)} /><ActionButton disabled={!title.trim()} onClick={() => attempt(() => api.createDossier({ title }), setWriteErr).then((r) => { if (r) { setTitle(''); choose(r.dossier.id); load(); } })}>Create</ActionButton></div>
        <ErrorChip e={err} />
        <input type="search" aria-label="Search dossiers" placeholder="Search dossiers…" value={search} onChange={(e) => setSearch(e.target.value)} /><select aria-label="Dossier filter" value={state} onChange={(e) => setState(e.target.value)}><option value="all">All dossiers</option><option>open</option><option>active</option><option>closed</option></select>
        <ul className="dossierlist">{shown.map((d) => (
          <li key={d.id}><ActionButton className={sel === d.id ? 'on' : ''} onClick={() => choose(d.id)}><b>{d.title}</b><span className="small muted">{d.workflow_state} · {d.items} items · {d.claims} claims · {d.open_tasks} open tasks · {ago(d.updated_at)}</span></ActionButton></li>
        ))}</ul>
        {list.length === 0 && <p className="small muted">No dossiers yet. Create one here, or from an event's detail panel on the dashboard.</p>}
      </aside>
      <section className="panel">{sel ? <Detail key={sel} id={sel} onChanged={load} /> : <p className="muted">Select or create a dossier.</p>}</section>
    </div>
  );
}
