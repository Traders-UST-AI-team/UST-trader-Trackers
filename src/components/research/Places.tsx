import { useState } from 'react';
import type { ObservationTarget } from '../../../shared/research';
import { api } from '../../api';
import { absTimeP, agoP } from '../../format';
import { ErrorChip, attempt } from './common';
import { useResource } from '../../read';

const pct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)} %`);

export function Places({ versionKey, now }: { versionKey: string; now: number }) {
  const [writeErr, setWriteErr] = useState<string | null>(null);
  const { data: t, error: readErr, replace } = useResource<ObservationTarget[]>(versionKey, () => api.targets(), { label: 'Places' });
  const err = readErr ?? writeErr;
  if (!t) return <p className="muted" role={err ? 'alert' : undefined}>{err ?? 'Loading…'}</p>;
  const pinned = t.filter((x) => x.pinned).map((x) => x.id);
  const toggle = (id: string) => attempt(() => api.setPins(pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id]), setWriteErr).then((r) => r && replace(r));
  return (
    <div className="places">
      <p className="small muted">Built only from data the tracker has: IMF PortWatch daily aggregates (delayed, revised — never live), reviewed reference assets and attributed reports. No operating status, closure or congestion is inferred.</p>
      <ErrorChip e={err} />
      <div className="placegrid">{t.map((x) => (
        <article key={x.id} className="panel place">
          <header><h3>{x.name} <span className="chip">{x.kind}</span></h3><button className={`pinbtn ${x.pinned ? 'on' : ''}`} onClick={() => toggle(x.id)}>{x.pinned ? '★ Pinned' : '☆ Pin'}</button></header>
          {x.series.map((s) => (
            <div key={s.id} className="small placeseries" title={s.definition}>
              <b>{s.title}</b>
              <div>{s.latest ? <>latest <b>{s.latest.v.toLocaleString()}</b> {s.unit} ({s.latest.t.slice(0, 10)}) vs previous {s.previous ? `${s.previous.v.toLocaleString()} (${s.previous.t.slice(0, 10)})` : '—'} → <b>{pct(s.change_pct)}</b></> : <span className="muted">no observations</span>}</div>
              <div className="muted">{s.change_basis} · <span className={s.status === 'stale' ? 'chip warn' : ''}>{s.status}</span> · {s.expected_lag} · {s.provider}</div>
              {s.baseline_28d && <div className="muted">vs trailing 28-day mean: {s.baseline_28d.pct === null ? `${s.baseline_28d.status}${s.baseline_28d.reason ? ` — ${s.baseline_28d.reason}` : ''}` : <b>{pct(s.baseline_28d.pct)}</b>}</div>}
            </div>
          ))}
          <div className="small"><b>Vessels:</b> <span className="muted">{x.vessels.reason}</span></div>
          <h4 className="small">Reports mentioning it (14 days)</h4>
          {x.reports.length === 0 ? <p className="small muted">No items observed within current coverage.</p> : <ul className="small">{x.reports.map((r) => <li key={r.source_ref}><span className="muted" title={absTimeP(r.published_at, r.time_precision as 'instant' | 'date')}>{agoP(r.published_at, r.time_precision as 'instant' | 'date', now)}</span> {r.source_name}: {r.title}</li>)}</ul>}
          <ul className="small muted notes">{x.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </article>
      ))}</div>
    </div>
  );
}
