import { useEffect, useState } from 'react';
import { useResource } from '../read';
import type { SourcesResponse, TgChannelView } from '../../shared/types';
import { api } from '../api';
import { absTime, ago } from '../format';
import { AFFECTS, STATE_LABEL, STATE_ORDER, reasonFor, sourceState, type SourceState } from '../sourcestate';

const KIND: Record<string, string> = { prediction_market: 'Prediction markets', sensor: 'Sensors', social: 'Telegram', official: 'Official', maritime: 'Maritime', news: 'News', analysis: 'Analysis', wallet: 'Wallet activity (Polymarket public data)' };
const ORDER = ['prediction_market', 'wallet', 'sensor', 'social', 'official', 'maritime', 'news', 'analysis'];
const FRESH: Record<string, string> = { current: 'current', delayed: 'delayed (normal for this provider)', quiet: 'quiet (no recent items)', old: 'OLD', unknown: 'unknown' };
const dur = (s: number | null) => (s === null ? '—' : s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

function ConfigEditor({ id, interval, budget, bounds, unit, overridden, readOnly, onSaved }: { id: string; interval: number; budget: number; bounds: { interval: [number, number]; budget: [number, number] }; unit: string; overridden: boolean; readOnly: boolean; onSaved: () => void }) {
  const [iv, setIv] = useState(String(interval));
  const [bd, setBd] = useState(String(budget));
  const [err, setErr] = useState<string | null>(null);
  const dirty = iv !== String(interval) || bd !== String(budget);
  useEffect(() => { setIv(String(interval)); setBd(String(budget)); }, [interval, budget]);
  const save = async (body: Parameters<typeof api.setSourceConfig>[1]) => {
    try { await api.setSourceConfig(id, body); setErr(null); onSaved(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="cfg">
      <label title={`Allowed ${bounds.interval[0]}–${bounds.interval[1]} min`}>every <input type="number" value={iv} min={bounds.interval[0]} max={bounds.interval[1]} disabled={readOnly} onChange={(e) => setIv(e.target.value)} /> min</label>
      <label title={`Allowed ${bounds.budget[0]}–${bounds.budget[1]} (${unit})`}>budget <input type="number" value={bd} min={bounds.budget[0]} max={bounds.budget[1]} disabled={readOnly} onChange={(e) => setBd(e.target.value)} /></label>
      {!readOnly && dirty && <button onClick={() => save({ interval_min: Number(iv), request_budget: Number(bd) })}>Save</button>}
      {!readOnly && overridden && !dirty && <button className="linkbtn small" onClick={() => save({ reset: true })}>reset</button>}
      {err && <span className="chip warn" title={err}>{err.slice(0, 90)}</span>}
    </div>
  );
}

function ChannelRow({ c, now }: { c: TgChannelView; now: number }) {
  return (
    <tr>
      <td><b>@{c.channel}</b>{c.title && <div className="muted small">{c.title}</div>}{!c.enabled && <span className="chip">disabled</span>}</td>
      <td className="num">{c.posts}</td>
      <td title={absTime(c.last_attempt_at)}>{ago(c.last_attempt_at, now)}{c.last_error && <div className="chip warn" title={c.last_error}>failed: {c.last_error.slice(0, 50)}</div>}{c.breaker_open_until && <div className="small muted">paused until {absTime(c.breaker_open_until)}</div>}</td>
      <td title={absTime(c.next_attempt_at)}>{c.enabled ? ago(c.next_attempt_at, now) : '—'}</td>
      <td className="small">{c.last_run ? <>latest {c.last_run.pages_latest} · gap {c.last_run.pages_gap} · history {c.last_run.pages_history} pages; {c.last_run.inserted} new</> : '—'}</td>
      <td className="small">{c.open_gaps.length === 0 ? <span className="muted">none open{c.resolved_gaps_7d ? ` · ${c.resolved_gaps_7d} recovered (7 d)` : ''}</span> : c.open_gaps.map((g) => <div key={g.id} className="chip warn" title={`opened ${absTime(g.opened_at)}; ${g.pages_used} recovery pages so far`}>missing after #{g.low_id} and before #{g.high_id}; {g.recovered_posts} recovered</div>)}</td>
      <td className="small" title={c.lag.note}>{c.lag.n ? <>median {dur(c.lag.median_s)} · P90 {dur(c.lag.p90_s)} <span className="muted">(n={c.lag.n}, 24 h)</span></> : <span className="muted">no new posts in 24 h</span>}</td>
    </tr>
  );
}

type Row = SourcesResponse['sources'][number];

/** One source as a line; the cadence editor and details open under it. */
function SourceRow({ r, now, readOnly, onSaved, attention = false }: { r: Row; now: number; readOnly: boolean; onSaved: () => void; attention?: boolean }) {
  const [open, setOpen] = useState(false);
  const { health: h, config: c } = r;
  const st = sourceState(h);
  return (
    <li className={`sv-item ${open ? 'open' : ''}`}>
      <button className="sv-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <i className={`sv-dot ${st}`} aria-hidden />
        <span className="n" title={h.name}>{h.name}</span>
        {attention
          ? <span className="why">{STATE_LABEL[st]} · {reasonFor(h, st)}</span>
          : <span className="why">{st === 'ok' ? '' : STATE_LABEL[st]}</span>}
        <span className="age" title={`Newest data: ${absTime(h.freshness.newest_at)}\n${h.freshness.note}`}>{h.freshness.newest_at ? `data ${ago(h.freshness.newest_at, now)}` : 'no data yet'}</span>
        <span className="age" title={`Last successful check: ${absTime(h.last_success_at)}`}>{h.status === 'blocked' ? '' : `checked ${ago(h.last_success_at, now)}`}</span>
      </button>
      {open && <div className="sv-detail">
        {attention && <p className="small muted">Affects {AFFECTS[h.kind] ?? 'its items'}. A failed source keeps its previous data on screen.</p>}
        {h.error && !attention && <p className="small warn-text">{h.error}</p>}
        <p className="small muted">
          Newest data {h.freshness.newest_at ? `${absTime(h.freshness.newest_at)} (${FRESH[h.freshness.assessment]})` : 'none stored'}
          {' · '}next attempt {h.status === 'blocked' ? '—' : h.next_attempt_at ? ago(h.next_attempt_at, now) : 'next cycle'}
          {h.breaker_open_until && ` · paused until ${absTime(h.breaker_open_until)}`}
          {c.last_run && <> · last run {c.last_run.requests}/{c.last_run.budget} requests{c.last_run.exhausted ? ' (budget hit — partial)' : ''}</>}
        </p>
        {h.status !== 'blocked' && <ConfigEditor id={h.source_id} interval={c.interval_min} budget={c.request_budget} bounds={c.bounds} unit={c.bounds.budgetUnit} overridden={c.overridden} readOnly={readOnly} onSaved={onSaved} />}
      </div>}
    </li>
  );
}

export function SourcesView({ now, versionKey }: { now: number; versionKey: string }) {
  const [chanDraft, setChanDraft] = useState<{ channel: string; enabled: boolean }[] | null>(null);
  const [newCh, setNewCh] = useState('');
  const [chErr, setChErr] = useState<string | null>(null);
  const [showBehind, setShowBehind] = useState(false);
  // One versioned read, with its own staleness rule and failure state; the poll just re-reads it.
  const { data: d, error: err, reload: load } = useResource<SourcesResponse>(versionKey, () => api.sources(), { label: 'Sources' });
  useEffect(() => { const id = setInterval(load, 30_000); return () => clearInterval(id); }, [load]);
  if (err) return <main className="sourcesview"><div className="banner" role="alert">{err}</div></main>;
  if (!d) return <main className="sourcesview"><p className="muted">Loading sources…</p></main>;
  const ro = d.seed_mode;
  const chans = chanDraft ?? d.telegram.channels.map((c) => ({ channel: c.channel, enabled: c.enabled }));
  const saveChans = async (next: { channel: string; enabled: boolean }[]) => {
    try { await api.setTgChannels(next); setChanDraft(null); setChErr(null); setNewCh(''); load(); } catch (e) { setChErr((e as Error).message); }
  };

  const tgFailing = d.telegram.channels.filter((c) => c.enabled && (c.last_error || c.breaker_open_until));
  const byState = new Map<SourceState, Row[]>();
  for (const r of d.sources) { const st = sourceState(r.health); (byState.get(st) ?? byState.set(st, []).get(st)!).push(r); }
  const count = (st: SourceState) => byState.get(st)?.length ?? 0;
  const serious = [...(byState.get('failing') ?? []), ...(byState.get('old') ?? [])];
  const behind = byState.get('behind') ?? [];
  // Many collectors late at once is one problem (the collector stopped or the machine slept), not many.
  const behindAsOne = behind.length > 5;
  const attention = behindAsOne ? serious : [...serious, ...behind];
  const connected = d.sources.length - count('off');
  const okCount = count('ok');
  const live = d.sources.filter((r) => sourceState(r.health) !== 'off');

  return (
    <main className="sourcesview sv">
      <div className="sv-head">
        <h1>Sources</h1>
        <p className={`sv-verdict ${serious.length || tgFailing.length ? 'bad' : behind.length ? 'meh' : 'good'}`}>
          {serious.length + tgFailing.length === 0 && behind.length === 0
            ? `All ${connected} connected sources are collecting normally.`
            : <>{okCount} of {connected} connected sources OK{STATE_ORDER.filter((st) => st !== 'ok' && st !== 'off' && count(st)).map((st) => <span key={st}> · <i className={`sv-dot ${st}`} aria-hidden /> {count(st)} {STATE_LABEL[st].toLowerCase()}</span>)}{tgFailing.length > 0 && <span> · Telegram channel failing</span>}</>}
        </p>
        {ro && <p className="small muted">Seed mode: settings are read-only and nothing is fetched.</p>}
      </div>

      {(attention.length > 0 || behindAsOne || tgFailing.length > 0) && <section className="sv-sec">
        <h4>Needs attention</h4>
        <ul className="sv-list">
          {attention.map((r) => <SourceRow key={r.health.source_id} r={r} now={now} readOnly={ro} onSaved={load} attention />)}
          {tgFailing.map((c) => <li key={c.channel} className="sv-item"><div className="sv-row static"><i className="sv-dot failing" aria-hidden /><span className="n">Telegram @{c.channel}</span><span className="why">Failing · {c.last_error ?? 'paused after repeated failures'}</span></div></li>)}
          {behindAsOne && <li className="sv-item">
            <button className="sv-row" aria-expanded={showBehind} onClick={() => setShowBehind(!showBehind)}>
              <i className="sv-dot behind" aria-hidden /><span className="n">{behind.length} sources behind schedule</span>
              <span className="why">no successful check within their cycle — usually the collector was paused or this machine slept; it catches up on the next cycle or with Refresh</span>
            </button>
            {showBehind && <ul className="sv-list nested">{behind.map((r) => <SourceRow key={r.health.source_id} r={r} now={now} readOnly={ro} onSaved={load} />)}</ul>}
          </li>}
        </ul>
      </section>}

      <section className="sv-sec">
        <h4>All sources</h4>
        {ORDER.filter((k) => live.some((r) => r.health.kind === k)).map((k) => {
          const rows = live.filter((r) => r.health.kind === k).sort((a, b) => STATE_ORDER.indexOf(sourceState(a.health)) - STATE_ORDER.indexOf(sourceState(b.health)));
          const ok = rows.filter((r) => sourceState(r.health) === 'ok').length;
          return (
            <div key={k} className="sv-group">
              <h5>{KIND[k]} <span className="muted">{ok === rows.length ? `${rows.length} OK` : `${ok} of ${rows.length} OK`}</span></h5>
              <ul className="sv-list">{rows.map((r) => <SourceRow key={r.health.source_id} r={r} now={now} readOnly={ro} onSaved={load} />)}</ul>
              {k === 'social' && <details className="sv-tg">
                <summary>Telegram channels ({d.telegram.channels.length}) · every {d.telegram.interval_min} min · ≤ {d.telegram.pages_per_channel} pages per channel{d.telegram.busy ? ' · running now' : ''}</summary>
                <p className="muted small">{d.telegram.note}</p>
                <div className="tablewrap"><table className="mini-table">
                  <thead><tr><th>Channel</th><th>Posts</th><th>Last attempt</th><th>Next</th><th>Last run</th><th>Coverage gaps</th><th>Collection lag</th></tr></thead>
                  <tbody>{d.telegram.channels.map((c) => <ChannelRow key={c.channel} c={c} now={now} />)}</tbody>
                </table></div>
                {!ro && (
                  <div className="chanedit">
                    <b className="small">Allowlist</b>
                    {chans.map((c, i) => (
                      <label key={c.channel} className="small"><input type="checkbox" checked={c.enabled} onChange={(e) => setChanDraft(chans.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} /> @{c.channel}
                        <button className="linkbtn" onClick={() => setChanDraft(chans.filter((_, j) => j !== i))} aria-label={`Remove ${c.channel}`}>remove</button></label>
                    ))}
                    <input placeholder="public channel username" value={newCh} onChange={(e) => setNewCh(e.target.value.replace(/^@|^https?:\/\/t\.me\/(s\/)?/g, ''))} />
                    <button onClick={() => newCh && setChanDraft([...chans, { channel: newCh, enabled: true }])} disabled={!newCh}>Add</button>
                    {chanDraft && <button onClick={() => saveChans(chanDraft)}>Save allowlist</button>}
                    {chanDraft && <button className="linkbtn small" onClick={() => setChanDraft(null)}>cancel</button>}
                    {chErr && <span className="chip warn">{chErr}</span>}
                    <span className="muted small">Public channels only (t.me/s preview). Removing a channel keeps its stored posts.</span>
                  </div>
                )}
              </details>}
            </div>
          );
        })}
        {count('off') > 0 && <details className="sv-off">
          <summary>Not connected ({count('off')})</summary>
          <ul className="sv-list">{byState.get('off')!.map((r) => <SourceRow key={r.health.source_id} r={r} now={now} readOnly={ro} onSaved={load} attention />)}</ul>
        </details>}
      </section>

      <details className="sv-help">
        <summary>How to read this page</summary>
        <p className="small muted">Collection (did the fetch run?), data age (how old is the newest observation, judged by each provider's own rhythm) and the next attempt are separate. "Data old" means the fetch works but the provider has published nothing new for longer than usual; polling faster cannot make a delayed provider real-time. Budgets cap requests per run for automatic and manual refreshes alike. Click a source to change its cadence and budget.</p>
      </details>
    </main>
  );
}
