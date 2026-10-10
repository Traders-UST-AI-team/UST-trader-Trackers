import { useEffect, useState } from 'react';
import { useResource } from '../read';
import type { AlertItem, AlertRuleView, AlertsResponse } from '../../shared/types';
import { api } from '../api';
import { absTime, ago } from '../format';

function RuleRow({ r, readOnly, onSaved }: { r: AlertRuleView; readOnly: boolean; onSaved: (x: AlertsResponse) => void }) {
  const [thr, setThr] = useState(String(r.threshold));
  const [cd, setCd] = useState(String(r.cooldown_min));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setThr(String(r.threshold)); setCd(String(r.cooldown_min)); }, [r.threshold, r.cooldown_min]);
  const save = (patch: Parameters<typeof api.setAlertRule>[1]) => api.setAlertRule(r.id, patch).then((x) => { setErr(null); onSaved(x); }).catch((e) => setErr((e as Error).message));
  const dirty = thr !== String(r.threshold) || cd !== String(r.cooldown_min);
  return (
    <tr>
      <td><label><input type="checkbox" checked={r.enabled} disabled={readOnly} onChange={(e) => save({ enabled: e.target.checked })} /> <b>{r.title}</b></label><div className="small muted">{r.description}</div></td>
      <td className="small">{r.kind === 'level' ? 'opens on normal → abnormal; re-arms after normal' : 'new rows only; grouped per window'}</td>
      <td><div className="cfg">{r.bounds[0] === r.bounds[1] ? <span className="muted">—</span> : <label>≥ <input type="number" value={thr} min={r.bounds[0]} max={r.bounds[1]} disabled={readOnly} onChange={(e) => setThr(e.target.value)} /> {r.unit}</label>}</div></td>
      <td><div className="cfg"><label><input type="number" value={cd} min={5} max={10080} disabled={readOnly} onChange={(e) => setCd(e.target.value)} /> min</label>
        {dirty && !readOnly && <button onClick={() => save({ threshold: Number(thr), cooldown_min: Number(cd) })}>Save</button>}{err && <span className="chip warn">{err}</span>}</div></td>
    </tr>
  );
}

function AlertRow({ a, now, onAck, onOpen }: { a: AlertItem; now: number; onAck: () => void; onOpen?: () => void }) {
  const event = a.rule_id === 'large_trade' || a.rule_id === 'watched_wallet_trade';
  const state = event ? null : a.recovered_at ? `back to normal ${ago(a.recovered_at, now)}` : 'ongoing';
  return (
    <li className={`al-item ${a.acked_at ? 'acked' : ''}`}>
      <i className={`al-sev ${a.severity}`} title={`${a.severity} — how much attention this asks for, not a direction`} />
      <div className="al-main">
        <div className="al-line">
          <b>{a.title}</b>
          {onOpen ? <button className="linkbtn al-target" onClick={onOpen}>{a.target_label}</button> : <span className="al-target">{a.target_label}</span>}
        </div>
        <p className="al-detail">{a.detail}</p>
      </div>
      <div className="al-side">
        <time title={`opened ${absTime(a.opened_at)}\nlast seen ${absTime(a.last_seen_at)}`}>{ago(a.opened_at, now)}</time>
        {state && <span className={state === 'ongoing' ? 'al-on' : 'muted'}>{state}</span>}
        {a.occurrences > 1 && <span className="muted" title="Repeated within the rule's cooldown window; kept as one alert">×{a.occurrences}</span>}
        {a.revised && <span className="muted" title="The input history was revised after the alert opened; the value shown is the latest">revised</span>}
        {!a.acked_at && <button className="quiet-button" onClick={onAck} title="Acknowledge">✓ Ack</button>}
      </div>
    </li>
  );
}

export function AlertsView({ now, versionKey, onOpenMarket }: { now: number; versionKey: string; onOpenMarket: (id: string) => void }) {
  const [showAcked, setShowAcked] = useState(false);
  const { data: d, error: err, replace } = useResource<AlertsResponse>(versionKey, () => api.alerts(), { label: 'Alerts' });
  if (err) return <main className="alertsview"><div className="banner" role="alert">{err}</div></main>;
  if (!d) return <main className="alertsview"><p className="muted">Loading alerts…</p></main>;
  // Ongoing conditions first; then everything else newest first.
  const items = d.items.filter((a) => showAcked || !a.acked_at)
    .sort((x, y) => Number(!!x.recovered_at || x.rule_id === 'large_trade') - Number(!!y.recovered_at || y.rule_id === 'large_trade') || y.opened_at.localeCompare(x.opened_at));
  return (
    <main className="alertsview al">
      <div className="sv-head">
        <h1>Alerts</h1>
        <div className="al-bar">
          <span className={d.unacked ? 'al-count' : 'muted'}>{d.unacked ? `${d.unacked} unacknowledged` : 'Nothing unacknowledged'}</span>
          {d.unacked > 0 && <button className="quiet-button" onClick={() => api.ackAllAlerts().then(replace)}>Acknowledge all</button>}
          <label className="small check"><input type="checkbox" checked={showAcked} onChange={(e) => setShowAcked(e.target.checked)} /> show acknowledged</label>
        </div>
      </div>
      <ul className="al-list">
        {items.length === 0 && <li className="muted small al-empty">{d.enabled ? 'No alerts. Rules open an alert only on a change from normal to abnormal, so a quiet list is expected most of the time.' : 'Disabled in seed mode.'}</li>}
        {items.map((a) => <AlertRow key={a.id} a={a} now={now} onAck={() => api.ackAlert(a.id).then(replace)} onOpen={a.target_kind === 'market' ? () => onOpenMarket(a.target_id) : undefined} />)}
      </ul>
      <details className="sv-help">
        <summary>Rules ({d.rules.filter((r) => r.enabled).length} of {d.rules.length} on) · definition {d.definition_version}</summary>
        {d.notes.map((n, i) => <p key={i} className="small muted">{n}</p>)}
        <div className="tablewrap"><table className="mini-table">
          <thead><tr><th>Rule</th><th>Fires</th><th>Threshold</th><th>Cooldown</th></tr></thead>
          <tbody>{d.rules.map((r) => <RuleRow key={r.id} r={r} readOnly={d.seed_mode} onSaved={replace} />)}</tbody>
        </table></div>
      </details>
    </main>
  );
}
