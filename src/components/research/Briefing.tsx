import { useEffect, useState } from 'react';
import type { Briefing as BriefingData, SavedBriefingRow } from '../../../shared/briefing';
import { api, type BriefingWindowChoice } from '../../api';
import { absTime } from '../../format';
import { ErrorChip, attempt } from './common';
import { useResource } from '../../read';

const WINDOWS: { label: string; w: BriefingWindowChoice }[] = [
  { label: '24 h', w: { hours: 24 } }, { label: '48 h', w: { hours: 48 } }, { label: '7 days', w: { hours: 168 } }, { label: 'Since last saved', w: { since: 'last' } },
];
const when = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

/** One bracketed citation that scrolls to its entry in the Sources list (the URL hash is reserved for navigation). */
function Cite({ n }: { n: number | null }) {
  if (n === null) return null;
  return <button className="cite" onClick={() => document.getElementById(`brief-cite-${n}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })} aria-label={`Source ${n}`}>[{n}]</button>;
}

export function Briefing({ versionKey, onOpenEvent, onOpenMarket }: { versionKey: string; onOpenEvent: (id: string) => void; onOpenMarket: (id: string) => void }) {
  const [win, setWin] = useState(0);
  const [viewing, setViewing] = useState<SavedBriefingRow | null>(null);
  const [note, setNote] = useState('');
  const [writeErr, setWriteErr] = useState<string | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);
  useEffect(() => { api.briefingAuto().then((a) => setAuto(a.enabled)).catch(() => setAuto(null)); }, []);

  // One versioned read. Which briefing is shown (a window, or a saved snapshot) is part of its key,
  // so switching between them re-reads and an older response cannot land on top of a newer one.
  const briefing = useResource<BriefingData>(
    [versionKey, win, viewing?.id ?? null],
    () => (viewing ? api.savedBriefing(viewing.id) : api.briefing(WINDOWS[win].w)),
    { label: 'Briefing' },
  );
  // The saved list is optional: it stays silent, and its absence is not an error worth interrupting for.
  const savedList = useResource<SavedBriefingRow[]>(versionKey, () => api.savedBriefings(), { label: 'Saved briefings', quiet: true });

  const data = briefing.data;
  const saved = savedList.data ?? [];
  const loading = briefing.state === 'loading';
  const err = briefing.error ?? writeErr;
  const loadSaved = savedList.reload;
  const load = briefing.reload;

  // Selecting a saved snapshot only chooses it; the read above fetches it.
  const openSaved = (s: SavedBriefingRow) => { setViewing(s); setWriteErr(null); };
  const showWindow = () => { setViewing(null); briefing.reload(); };
  const save = () => attempt(() => api.saveBriefing(WINDOWS[win].w, note), setWriteErr).then((r) => { if (r) { setNote(''); loadSaved(); } });
  const mdUrl = viewing ? api.savedBriefingMarkdownUrl(viewing.id) : api.briefingMarkdownUrl(WINDOWS[win].w);
  const b = data;

  return (
    <section className="briefing" aria-label="Change briefing">
      <div className="briefing-bar noprint">
        <div>
          <h2>Change briefing</h2>
          <p className="small muted">What changed in the window, built by fixed rules from stored data. Every line is cited. Items and price moves are listed together because they overlap in time — coincident, not causal.</p>
        </div>
        <div className="briefing-actions">
          <div className="seg" role="radiogroup" aria-label="Window">
            {WINDOWS.map((x, i) => <button key={x.label} role="radio" aria-checked={win === i && !viewing} className={win === i && !viewing ? 'on' : ''} onClick={() => { setViewing(null); setWin(i); }}>{x.label}</button>)}
          </div>
          <button onClick={load} disabled={loading} title="Rebuild from the latest stored data">Rebuild</button>
          <a className="btnlink" href={mdUrl} download>Download Markdown</a>
          <button onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>
      <ErrorChip e={err} />
      {loading && !b && <p className="muted" role="status">Building briefing…</p>}
      {b && (
        <article className="briefing-doc">
          <header>
            <h3>{when(b.window.from)} → {when(b.window.to)}</h3>
            <p className="small muted">{b.window.hours} h · window by {b.window.basis} · generated {absTime(b.generated_at)} · {b.version}{viewing ? ` · saved snapshot${viewing.note ? `: ${viewing.note}` : ''}` : ''}</p>
            {b.seed_mode && <p className="banner seed small"><b>DEMO SEED — not live.</b> Built from a saved sample.</p>}
            {viewing && <p className="small"><button onClick={showWindow}>Back to a fresh briefing</button></p>}
          </header>

          <h4>Summary</h4>
          <ul>{b.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>

          <h4>What happened</h4>
          {b.stories.length === 0 && <p className="muted">No new relevant items in this window.</p>}
          {b.stories.map((s, i) => (
            <div className="bstory" key={i}>
              <h5>{s.title} <Cite n={s.items[0].n} /></h5>
              <p className="small muted">
                {s.single_outlet ? `single outlet · ${s.items_total} item${s.items_total === 1 ? '' : 's'}` : `${s.items_total} items · ${s.independence_groups} independence group${s.independence_groups === 1 ? '' : 's'}`}
                {s.state_only ? ' · state-affiliated outlets only' : ''} · first published {when(s.first_published_at)}
              </p>
              <ul className="small">
                {s.items.map((it) => (
                  <li key={it.n}>
                    <b>{it.outlet}</b> <span className="chip">{it.tier}</span>{it.affiliation && !/^Headline discovery/.test(it.affiliation) && <span className="chip warn" title={it.affiliation}>{it.affiliation.length > 32 ? `${it.affiliation.slice(0, 30)}…` : it.affiliation}</span>}
                    {' '}{it.published_at.slice(11, 16)} UTC{it.untranslated && <span className="chip warn" title="Shown in its original language; not translated here">{it.language} · original, not translated</span>}
                    <Cite n={it.n} /> <button className="linkbtn noprint" onClick={() => onOpenEvent(it.event_id)}>open in Monitor</button>
                  </li>
                ))}
                {s.items_total > s.items.length && <li className="muted">…and {s.items_total - s.items.length} more item(s) in this group, not listed.</li>}
              </ul>
              {s.touches.length > 0 && <p className="small">Touches <span className="muted">(keyword/entity match, not evidence of impact)</span>: {s.touches.map((t, k) => <span key={t.n}>{k > 0 && '; '}{t.question} <Cite n={t.n} /></span>)}</p>}
            </div>
          ))}
          {b.stories_omitted > 0 && <p className="small muted">{b.stories_omitted} further story group(s) not shown. Open Feed to read them.</p>}
          {b.late_collected > 0 && <p className="small muted">{b.late_collected} item(s) were first collected in this window but published earlier; they are not listed.</p>}

          <h4>Contracts that moved <span className="muted small">(coincident, not causal)</span></h4>
          {b.contracts.length === 0 && <p className="muted">None of the {b.contracts_checked} contracts checked met the criteria.</p>}
          <ul>
            {b.contracts.map((k) => (
              <li key={k.condition_id}>
                <b>{k.question}</b> <span className="chip">{k.venue}</span><Cite n={k.n} /> — {k.reasons.join('; ')}
                {k.price_pct !== null && <span className="muted small"> · price {k.price_pct.toFixed(1)}%{k.quote_basis ? ` (${k.quote_basis.replace('_', ' ')})` : ''}</span>}
                {k.change_from_t && k.change_to_t && <span className="muted small"> · measured {when(new Date(k.change_from_t * 1000).toISOString())} → {when(new Date(k.change_to_t * 1000).toISOString())}</span>}
                {' '}<button className="linkbtn noprint" onClick={() => onOpenMarket(k.condition_id)}>open chart</button>
                {k.items.length > 0 && <div className="small muted">Items touching it in this window: {k.items.map((i, j) => <span key={i.n}>{j > 0 && '; '}{i.outlet} {i.published_at.slice(11, 16)} UTC <Cite n={i.n} /></span>)}</div>}
              </li>
            ))}
          </ul>
          {b.contracts_not_computable.map((n) => <p key={n.reason} className="small muted">∅ Not computable for {n.count} contract(s): {n.reason}.</p>)}

          {b.sensors.length > 0 && <><h4>Pinned sensors</h4><ul className="small">{b.sensors.map((s) => <li key={s.n}>{s.title}: <b>{s.value}</b>{s.observed_at ? <span className="muted"> (observed {when(s.observed_at)})</span> : null}{s.change ? ` — ${s.change}` : s.reason ? <span className="muted"> — {s.reason}</span> : null} <Cite n={s.n} /></li>)}</ul></>}
          {b.alerts.length > 0 && <><h4>Alerts opened</h4><ul className="small">{b.alerts.map((a) => <li key={a.n}><span className="chip">{a.severity}</span> {a.title} — {a.open ? 'still open' : 'recovered'} <span className="muted">· rule {a.rule_id} ({a.definition_version})</span> <Cite n={a.n} /></li>)}</ul></>}
          {b.large_trades.length > 0 && <><h4>Large single trades <span className="muted small">(pilot markets; a wallet address is not a person)</span></h4><ul className="small">{b.large_trades.map((t) => <li key={t.n}>{t.side} {t.outcome} {Math.round(t.notional_usdc).toLocaleString('en-US')} USDC on {t.question} <span className="muted">· {when(t.at)} · {t.criteria.join('; ')}</span> <Cite n={t.n} /></li>)}</ul></>}
          {b.research.length > 0 && <><h4>Research changes and checks</h4><ul className="small">{b.research.map((r, i) => <li key={i}>{r.text} <Cite n={r.n} /></li>)}</ul></>}
          {b.upcoming.length > 0 && <><h4>Next 7 days</h4><ul className="small">{b.upcoming.map((u) => <li key={u.n}>{u.title} — {u.precision === 'date' ? `${u.when.slice(0, 10)} (date only)` : when(u.when)} <span className="muted">· {u.basis}</span> <Cite n={u.n} /></li>)}</ul></>}

          <h4>What this briefing cannot tell you</h4>
          <ul className="small">{b.limits.map((l, i) => <li key={i}>{l}</li>)}</ul>

          <h4>Sources</h4>
          <ol className="small bsources">
            {b.citations.map((c) => (
              <li key={c.n} id={`brief-cite-${c.n}`}>
                {c.label}{c.outlet ? ` — ${c.outlet}` : ''}{c.tier ? ` (${c.tier})` : ''}{c.published_at ? `, ${c.published_at.slice(0, 16).replace('T', ' ')}` : ''}
                {c.url ? <> — <a href={c.url} target="_blank" rel="noreferrer">original ↗</a></> : c.ref ? <span className="muted"> — in tracker: {c.ref}</span> : null}
              </li>
            ))}
          </ol>
        </article>
      )}

      <div className="briefing-save noprint">
        <h4>Save a snapshot</h4>
        <p className="small muted">A saved briefing is frozen with its citations, so you can compare it with tomorrow's. “Since last saved” starts where the newest snapshot ended.</p>
        {auto !== null && <label className="small check"><input type="checkbox" checked={auto} onChange={(e) => api.setBriefingAuto(e.target.checked).then((a) => { setAuto(a.enabled); loadSaved(); }).catch((x: Error) => setWriteErr(x.message))} /> Save the last 24 h automatically once each morning (after 07:00, while this server is running)</label>}
        <div className="row2">
          <input placeholder="Optional note (what you checked)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          <button onClick={save} disabled={!!viewing}>Save this briefing</button>
        </div>
        {saved.length > 0 && (
          <details className="small"><summary>{saved.length} saved snapshot{saved.length === 1 ? '' : 's'}</summary>
            <ul>{saved.map((s) => <li key={s.id}><button className="linkbtn" onClick={() => openSaved(s)}>{when(s.window_from)} → {when(s.window_to)}</button> <span className="muted">saved {absTime(s.saved_at)}{s.note ? ` · ${s.note}` : ''}</span> <a href={api.savedBriefingMarkdownUrl(s.id)} download>.md</a></li>)}</ul>
          </details>
        )}
      </div>
    </section>
  );
}
