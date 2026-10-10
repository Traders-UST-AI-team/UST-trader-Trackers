import { useEffect, useState } from 'react';
import type { CoverageReport } from '../../../shared/research';
import { api } from '../../api';
import { absTime, ago } from '../../format';

const dur = (s: number | null) => (s === null ? '—' : s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

export function Coverage({ versionKey, now }: { versionKey: string; now: number }) {
  const [w, setW] = useState(24);
  const [d, setD] = useState<CoverageReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.coverage(w).then(setD).catch((e) => setErr((e as Error).message)); }, [versionKey, w]);
  if (err) return <div className="banner">{err}</div>;
  if (!d) return <p className="muted">Loading coverage…</p>;
  return (
    <div className="coverage">
      {d.all_relevant_down && <div className="banner">Every news/official/maritime source is failing or stale.</div>}
      <ul className="notes small">{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      <div className="rangebar" role="group" aria-label="Window">{[24, 72, 168].map((x) => <button key={x} className={w === x ? 'on' : ''} onClick={() => setW(x)}>{x < 48 ? `${x} h` : `${x / 24} d`}</button>)}</div>
      <section className="panel"><h3>Sources</h3>
        <div className="tablewrap"><table className="mini-table">
          <thead><tr><th>Source</th><th>State</th><th>Scheduled success</th><th className="num">Manual</th><th className="num">Partial</th><th>Newest data</th><th>Languages / scope</th></tr></thead>
          <tbody>{d.sources.map((s) => (
            <tr key={s.source_id}>
              <td><b>{s.name}</b><div className="small muted">{s.kind}</div></td>
              <td><span className={`chip ${s.status === 'ok' ? 'link' : 'warn'}`}>{s.status}</span>{s.breaker_open_until && <div className="small">paused until {absTime(s.breaker_open_until)}</div>}</td>
              <td className="small" title="completed successful scheduled attempts ÷ completed scheduled attempts in the window">{s.attempts.rate === null ? <span className="muted">{s.status === 'disabled' ? 'excluded (disabled)' : 'no attempts recorded'}</span> : <>{Math.round(100 * s.attempts.rate)} % <span className="muted">({s.attempts.scheduled_ok}/{s.attempts.scheduled_total})</span></>}</td>
              <td className="num small">{s.attempts.manual}</td><td className="num small">{s.attempts.partial}</td>
              <td className="small">{s.newest_data_at ? <>{ago(s.newest_data_at, now)} <span className="muted">{s.assessment}</span></> : <span className="muted">none stored</span>}</td>
              <td className="small muted">{s.languages.join(', ')}{s.scope ? ` · ${s.scope}` : ''}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      <section className="panel"><h3>Known gaps and channels</h3>
        <ul className="small">{d.telegram.map((t) => <li key={t.channel}>Telegram @{t.channel}{!t.enabled && ' (disabled)'}: {t.open_gaps ? <span className="chip warn">{t.open_gaps} open gap(s)</span> : 'no open gap'}; lag median {dur(t.lag_median_s)} (n={t.lag_n}){t.last_error && <span className="chip warn">{t.last_error.slice(0, 60)}</span>}</li>)}
          {d.wallet_gaps.map((g, i) => <li key={i}>Wallet data {g.target.slice(0, 24)}…: missing {absTime(g.from)} → {absTime(g.to)}</li>)}
          {d.wallet_gaps.length === 0 && <li className="muted">No open wallet-data gaps.</li>}</ul>
      </section>
      <section className="panel"><h3>Publication → first collection</h3>
        <table className="mini-table small"><thead><tr><th>Cohort</th><th className="num">n</th><th className="num">Median</th><th className="num">P90</th></tr></thead>
          <tbody>{d.lag_cohorts.map((c) => <tr key={c.cohort} title={c.note}><td>{c.cohort}</td><td className="num">{c.n}</td><td className="num">{dur(c.median_s)}</td><td className="num">{dur(c.p90_s)}</td></tr>)}</tbody></table>
      </section>
      <section className="panel"><h3>Source-set changes</h3>
        {d.source_set_changes.length === 0 ? <p className="small muted">None recorded since telemetry started.</p> : <ul className="small">{d.source_set_changes.map((c, i) => <li key={i}>{absTime(c.at)} — {c.kind}: {c.detail}</li>)}</ul>}
        <p className="small muted">Volume comparisons across these changes are not like-for-like.</p>
      </section>
    </div>
  );
}
