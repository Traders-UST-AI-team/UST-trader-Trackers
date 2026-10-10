import { useEffect, useState } from 'react';
import type { SourcesResponse, TgChannelView } from '../../shared/types';
import { api } from '../api';
import { absTime, ago } from '../format';

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

export function SourcesView({ now, versionKey }: { now: number; versionKey: string }) {
  const [d, setD] = useState<SourcesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [chanDraft, setChanDraft] = useState<{ channel: string; enabled: boolean }[] | null>(null);
  const [newCh, setNewCh] = useState('');
  const [chErr, setChErr] = useState<string | null>(null);
  const load = () => api.sources().then((x) => { setD(x); setErr(null); }).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, [versionKey]);
  useEffect(() => { const id = setInterval(load, 30_000); return () => clearInterval(id); }, []);
  if (err) return <main className="sourcesview"><div className="banner">{err}</div></main>;
  if (!d) return <main className="sourcesview"><p className="muted">Loading sources…</p></main>;
  const ro = d.seed_mode;
  const chans = chanDraft ?? d.telegram.channels.map((c) => ({ channel: c.channel, enabled: c.enabled }));
  const saveChans = async (next: { channel: string; enabled: boolean }[]) => {
    try { await api.setTgChannels(next); setChanDraft(null); setChErr(null); setNewCh(''); load(); } catch (e) { setChErr((e as Error).message); }
  };
  return (
    <main className="sourcesview">
      <p className="muted small">Collection (did the fetch run?), data age (how old is the newest observation, judged by each provider's own rhythm) and the next attempt are separate. Polling faster cannot make a delayed provider real-time. Budgets cap requests per run for automatic and manual refreshes alike.{ro && ' Seed mode: settings are read-only and nothing is fetched.'}</p>
      <section className="panel">
        <h3>Telegram channels <span className="muted small">— own scheduler · every {d.telegram.interval_min} min · ≤ {d.telegram.pages_per_channel} pages per channel per run{d.telegram.busy ? ' · running now' : ''}</span></h3>
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
      </section>
      {ORDER.filter((k) => d.sources.some((s) => s.health.kind === k)).map((k) => (
        <section key={k} className="panel">
          <h3>{KIND[k]}</h3>
          <div className="tablewrap"><table className="mini-table srctable">
            <thead><tr><th>Source</th><th>Collection</th><th>Newest data</th><th>Next attempt</th><th>Cadence &amp; budget</th><th>Last run</th></tr></thead>
            <tbody>{d.sources.filter((s) => s.health.kind === k).map(({ health: h, config: c }) => (
              <tr key={h.source_id}>
                <td><b>{h.name}</b></td>
                <td><span className={`chip ${h.status === 'ok' && !h.stale ? 'link' : 'warn'}`}>{h.status === 'blocked' ? 'not connected' : h.status === 'never' ? 'pending' : h.status === 'error' ? 'failed' : h.stale ? 'stale' : 'ok'}</span> <span className="small" title={absTime(h.last_success_at)}>{ago(h.last_success_at, now)}</span>
                  {h.error && <div className="small muted" title={h.error}>{h.error.slice(0, 110)}</div>}
                  {h.breaker_open_until && <div className="small">paused until {absTime(h.breaker_open_until)} after {h.consecutive_failures} failures</div>}</td>
                <td className="small" title={h.freshness.note}>{h.freshness.newest_at ? <>{ago(h.freshness.newest_at, now)} <span className={h.freshness.assessment === 'old' ? 'chip warn' : 'muted'}>{FRESH[h.freshness.assessment]}</span></> : <span className="muted">none stored</span>}</td>
                <td className="small" title={absTime(h.next_attempt_at)}>{h.status === 'blocked' ? '—' : h.next_attempt_at ? ago(h.next_attempt_at, now) : 'next cycle'}</td>
                <td>{h.status === 'blocked' ? <span className="muted small">disabled</span> : <ConfigEditor id={h.source_id} interval={c.interval_min} budget={c.request_budget} bounds={c.bounds} unit={c.bounds.budgetUnit} overridden={c.overridden} readOnly={ro} onSaved={load} />}</td>
                <td className="small">{c.last_run ? <span title={absTime(c.last_run.at)}>{c.last_run.requests} / {c.last_run.budget} req{c.last_run.exhausted && <span className="chip warn">budget hit — partial</span>}</span> : <span className="muted">—</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      ))}
    </main>
  );
}
