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

const STORIES_SHOWN = 6;
const LIST_SHOWN = 5;

/** One bracketed citation that opens the Sources section and scrolls to its entry (the URL hash is reserved for navigation). */
function Cite({ n }: { n: number | null }) {
  if (n === null) return null;
  const go = () => {
    const box = document.getElementById('brief-sources') as HTMLDetailsElement | null;
    if (box) box.open = true;
    requestAnimationFrame(() => document.getElementById(`brief-cite-${n}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };
  return <button className="cite" onClick={go} aria-label={`Source ${n}`}>[{n}]</button>;
}

/** A list that shows its first few rows and the rest on request. */
function Some<T>({ rows, shown = LIST_SHOWN, render }: { rows: T[]; shown?: number; render: (r: T, i: number) => React.ReactNode }) {
  const [all, setAll] = useState(false);
  return <>
    <ul className="bl-rows">{(all ? rows : rows.slice(0, shown)).map(render)}</ul>
    {rows.length > shown && <button className="quiet-button" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}
  </>;
}

function Story({ s, onOpenEvent }: { s: BriefingData['stories'][number]; onOpenEvent: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`bl-story ${open ? 'open' : ''}`}>
      <button className="bl-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="t">{s.title}</span>
        <span className="m">{s.single_outlet ? 'single outlet' : `${s.independence_groups} independent`} · {s.items_total} item{s.items_total === 1 ? '' : 's'}{s.state_only ? ' · state media only' : ''} · first {s.first_published_at.slice(11, 16)} UTC</span>
        {s.touches.length > 0 && <span className="m touch" title="Keyword/entity match, not evidence of impact">Touches {s.touches[0].question}{s.touches.length > 1 ? ` +${s.touches.length - 1}` : ''}</span>}
      </button>
      {open && <div className="bl-body">
        <ul>
          {s.items.map((it) => (
            <li key={it.n}>
              <span className="o">{it.outlet}</span><span className="muted">{it.tier}{it.affiliation && !/^Headline discovery/.test(it.affiliation) ? ` · ${it.affiliation.length > 40 ? `${it.affiliation.slice(0, 38)}…` : it.affiliation}` : ''}</span>
              <span className="muted">{it.published_at.slice(11, 16)} UTC{it.untranslated ? ` · ${it.language}, not translated` : ''}</span>
              <Cite n={it.n} /><button className="linkbtn noprint" onClick={() => onOpenEvent(it.event_id)}>Monitor</button>
            </li>
          ))}
          {s.items_total > s.items.length && <li className="muted">…and {s.items_total - s.items.length} more in this group.</li>}
        </ul>
        {s.touches.length > 0 && <p className="small muted">Touches (keyword/entity match, not evidence of impact): {s.touches.map((t, k) => <span key={t.n}>{k > 0 && '; '}{t.question} <Cite n={t.n} /></span>)}</p>}
      </div>}
    </li>
  );
}

export function Briefing({ versionKey, onOpenEvent, onOpenMarket }: { versionKey: string; onOpenEvent: (id: string) => void; onOpenMarket: (id: string) => void }) {
  const [win, setWin] = useState(0);
  const [viewing, setViewing] = useState<SavedBriefingRow | null>(null);
  const [note, setNote] = useState('');
  const [writeErr, setWriteErr] = useState<string | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);
  const [allStories, setAllStories] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.briefingAuto().then((a) => setAuto(a.enabled)).catch(() => setAuto(null)); }, []);
  // Printing a briefing prints all of it, including the folded sections.
  useEffect(() => {
    const open = () => { setAllStories(true); document.querySelectorAll<HTMLDetailsElement>('.briefing-doc details').forEach((d) => { d.open = true; }); };
    window.addEventListener('beforeprint', open);
    return () => window.removeEventListener('beforeprint', open);
  }, []);

  // One versioned read. Which briefing is shown (a window, or a saved snapshot) is part of its key,
  // so switching between them re-reads and an older response cannot land on top of a newer one.
  const briefing = useResource<BriefingData>(
    [versionKey, win, viewing?.id ?? null],
    () => (viewing ? api.savedBriefing(viewing.id) : api.briefing(WINDOWS[win].w)),
    { label: 'Briefing' },
  );
  // The saved list is optional: it stays silent, and its absence is not an error worth interrupting for.
  const savedList = useResource<SavedBriefingRow[]>(versionKey, () => api.savedBriefings(), { label: 'Saved briefings', quiet: true });

  const b = briefing.data;
  const saved = savedList.data ?? [];
  const loading = briefing.state === 'loading';
  const err = briefing.error ?? writeErr;
  const openSaved = (s: SavedBriefingRow) => { setViewing(s); setWriteErr(null); };
  const showWindow = () => { setViewing(null); briefing.reload(); };
  const save = () => attempt(() => api.saveBriefing(WINDOWS[win].w, note), setWriteErr).then((r) => { if (r) { setNote(''); setSaving(false); savedList.reload(); } });
  const mdUrl = viewing ? api.savedBriefingMarkdownUrl(viewing.id) : api.briefingMarkdownUrl(WINDOWS[win].w);
  const confirmed = b ? b.stories.filter((s) => s.independence_groups >= 2).length : 0;

  return (
    <section className="briefing" aria-label="Change briefing">
      <div className="bl-bar noprint">
        <div className="seg" role="radiogroup" aria-label="Window">
          {WINDOWS.map((x, i) => <button key={x.label} role="radio" aria-checked={win === i && !viewing} className={win === i && !viewing ? 'on' : ''} onClick={() => { setViewing(null); setWin(i); }}>{x.label}</button>)}
        </div>
        <div className="bl-actions">
          <button className="quiet-button" onClick={briefing.reload} disabled={loading} title="Rebuild from the latest stored data">Rebuild</button>
          <a className="quiet-button" href={mdUrl} download>Markdown ↓</a>
          <button className="quiet-button" onClick={() => window.print()}>Print</button>
          <button className="quiet-button" onClick={() => setSaving((v) => !v)} disabled={!!viewing}>Save snapshot</button>
          {saved.length > 0 && <details className="bl-saved"><summary>Saved ({saved.length})</summary>
            <ul>{saved.map((s) => <li key={s.id}><button className="linkbtn" onClick={() => openSaved(s)}>{when(s.window_from)} → {when(s.window_to)}</button> <span className="muted">{s.note}</span> <a href={api.savedBriefingMarkdownUrl(s.id)} download>.md</a></li>)}</ul>
          </details>}
        </div>
      </div>
      {saving && <div className="bl-saveform noprint">
        <input placeholder="Optional note (what you checked)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        <button className="source-link" onClick={save}>Save</button>
        {auto !== null && <label className="small check"><input type="checkbox" checked={auto} onChange={(e) => api.setBriefingAuto(e.target.checked).then((a) => { setAuto(a.enabled); savedList.reload(); }).catch((x: Error) => setWriteErr(x.message))} /> also save the last 24 h every morning after 07:00</label>}
        <p className="small muted">A saved briefing is frozen with its citations, so you can compare it with tomorrow's. “Since last saved” starts where the newest snapshot ended.</p>
      </div>}
      <ErrorChip e={err} />
      {loading && !b && <p className="muted" role="status">Building briefing…</p>}
      {b && (
        <article className="briefing-doc">
          <header className="bl-title">
            <h2>{when(b.window.from)} → {when(b.window.to)}</h2>
            <p className="small muted">Built by fixed rules from stored data; every line is cited. Items and price moves overlap in time — coincident, not causal.{viewing ? ` Saved snapshot${viewing.note ? `: ${viewing.note}` : ''}.` : ''}</p>
            {b.seed_mode && <p className="banner seed small"><b>DEMO SEED — not live.</b> Built from a saved sample.</p>}
            {viewing && <button className="quiet-button" onClick={showWindow}>← Back to a fresh briefing</button>}
          </header>

          <div className="bl-stats">
            <div><b>{confirmed}</b><span>stories from 2+ independent outlets</span><small>of {b.stories.length + b.stories_omitted} story groups</small></div>
            <div><b>{b.contracts.length}</b><span>linked contracts moved</span><small>of {b.contracts_checked} checked</small></div>
            <div><b>{b.alerts.length}</b><span>alerts opened</span></div>
            <div><b>{b.upcoming.length}</b><span>contract dates in 7 days</span></div>
          </div>

          <h4>What happened</h4>
          {b.stories.length === 0 ? <p className="muted">No new relevant items in this window.</p> : <>
            <ol className="bl-stories">{(allStories ? b.stories : b.stories.slice(0, STORIES_SHOWN)).map((s, i) => <Story key={i} s={s} onOpenEvent={onOpenEvent} />)}</ol>
            {b.stories.length > STORIES_SHOWN && <button className="quiet-button" onClick={() => setAllStories((v) => !v)}>{allStories ? 'Show fewer' : `Show all ${b.stories.length}`}</button>}
            {b.stories_omitted > 0 && <p className="small muted">{b.stories_omitted} smaller story groups are not in the briefing; the Feed has them.</p>}
          </>}

          {b.contracts.length > 0 && <>
            <h4>Contracts that moved <span className="muted small">coincident, not causal</span></h4>
            <Some rows={b.contracts} render={(k) => (
              <li key={k.condition_id} className="bl-contract" title={`${k.reasons.join('; ')}${k.change_from_t && k.change_to_t ? `\nmeasured ${when(new Date(k.change_from_t * 1000).toISOString())} → ${when(new Date(k.change_to_t * 1000).toISOString())}` : ''}`}>
                <button className="linkbtn noprint-link" onClick={() => onOpenMarket(k.condition_id)}>{k.question}</button><Cite n={k.n} />
                <span className="p">{k.price_pct === null ? '—' : `${k.price_pct.toFixed(1)}%`}</span>
                <span className={`mk-mv ${(k.change_24h_pp ?? 0) > 0 ? 'up' : (k.change_24h_pp ?? 0) < 0 ? 'down' : ''}`}>{k.change_24h_pp === null ? (k.hourly ? 'hourly' : '—') : `${k.change_24h_pp > 0 ? '▲' : k.change_24h_pp < 0 ? '▼' : '–'} ${Math.abs(k.change_24h_pp).toFixed(1)}`}</span>
              </li>
            )} />
            {b.contracts_not_computable.map((n) => <p key={n.reason} className="small muted">No 24h figure for {n.count} contract(s): {n.reason}.</p>)}
          </>}

          {b.upcoming.length > 0 && <><h4>Next 7 days</h4><Some rows={b.upcoming} render={(u) => <li key={u.n}><span className="w">{u.precision === 'date' ? u.when.slice(5, 10) : when(u.when).slice(5)}</span><span className="t">{u.title}</span><Cite n={u.n} /></li>} /></>}
          {b.alerts.length > 0 && <><h4>Alerts opened</h4><Some rows={b.alerts} render={(a) => <li key={a.n}><span className="w">{a.severity}</span><span className="t">{a.title}</span><span className="muted small">{a.open ? 'still open' : 'recovered'}</span><Cite n={a.n} /></li>} /></>}
          {b.sensors.length > 0 && <><h4>Pinned sensors</h4><Some rows={b.sensors} render={(s) => <li key={s.n}><span className="t">{s.title}</span><b>{s.value}</b><span className="muted small">{s.change ?? s.reason ?? ''}</span><Cite n={s.n} /></li>} /></>}
          {b.large_trades.length > 0 && <><h4>Large single trades <span className="muted small">pilot markets; an address is not a person</span></h4><Some rows={b.large_trades} render={(t) => <li key={t.n} title={t.criteria.join('; ')}><span className="w">{t.side} {t.outcome}</span><b>{Math.round(t.notional_usdc).toLocaleString('en-US')} USDC</b><span className="t">{t.question}</span><Cite n={t.n} /></li>} /></>}
          {b.research.length > 0 && <><h4>Research changes and checks</h4><Some rows={b.research} render={(r, i) => <li key={i}><span className="t">{r.text}</span><Cite n={r.n} /></li>} /></>}

          <details className="bl-sources" id="brief-sources">
            <summary>What this briefing cannot tell you · {b.citations.length} sources</summary>
            <ul className="small">{b.limits.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <p className="small muted">{b.window.hours} h · window by {b.window.basis} · generated {absTime(b.generated_at)} · {b.version}</p>
            <ol className="small bsources">
              {b.citations.map((c) => (
                <li key={c.n} id={`brief-cite-${c.n}`}>
                  {c.label}{c.outlet ? ` — ${c.outlet}` : ''}{c.tier ? ` (${c.tier})` : ''}{c.published_at ? `, ${c.published_at.slice(0, 16).replace('T', ' ')}` : ''}
                  {c.url ? <> — <a href={c.url} target="_blank" rel="noreferrer">original ↗</a></> : c.ref ? <span className="muted"> — in tracker: {c.ref}</span> : null}
                </li>
              ))}
            </ol>
          </details>
        </article>
      )}
    </section>
  );
}
