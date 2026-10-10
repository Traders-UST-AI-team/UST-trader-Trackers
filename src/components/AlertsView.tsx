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
  return (
    <article className={`alertitem ${a.acked_at ? 'acked' : ''}`}>
      <div className="meta">
        <span className={`chip sev-${a.severity}`} title="How much attention this asks for — not a direction">{a.severity}</span>
        <b>{a.title}</b>
        {a.recovered_at && a.rule_id !== 'large_trade' && a.rule_id !== 'watched_wallet_trade' ? <span className="chip">back to normal {ago(a.recovered_at, now)}</span> : !a.recovered_at && <span className="chip warn">ongoing</span>}
        {a.occurrences > 1 && <span className="chip" title="Repeated within the rule's cooldown window; kept as one alert">×{a.occurrences}</span>}
        {a.revised && <span className="chip" title="The input history was revised after the alert opened; the value shown is the latest">revised</span>}
        <span className="muted small grow" title={`opened ${absTime(a.opened_at)}\nlast seen ${absTime(a.last_seen_at)}`}>{ago(a.opened_at, now)}</span>
      </div>
      <div className="small">{onOpen ? <button className="linkbtn" onClick={onOpen}>{a.target_label}</button> : <span>{a.target_label}</span>}</div>
      <p className="small">{a.detail}</p>
      {!a.acked_at && <button className="linkbtn small" onClick={onAck}>Acknowledge</button>}
    </article>
  );
}

export function AlertsView({ now, versionKey, onOpenMarket }: { now: number; versionKey: string; onOpenMarket: (id: string) => void }) {
  const [showAcked, setShowAcked] = useState(false);
  const { data: d, error: err, replace } = useResource<AlertsResponse>(versionKey, () => api.alerts(), { label: 'Alerts' });
  if (err) return <main className="alertsview"><div className="banner" role="alert">{err}</div></main>;
  if (!d) return <main className="alertsview"><p className="muted">Loading alerts…</p></main>;
  const items = d.items.filter((a) => showAcked || !a.acked_at);
  return (
    <main className="alertsview">
      {d.notes.map((n, i) => <p key={i} className="small muted">{n}</p>)}
      <div className="row2">
        <b>{d.unacked} unacknowledged</b>
        <label className="small"><input type="checkbox" checked={showAcked} onChange={(e) => setShowAcked(e.target.checked)} /> show acknowledged</label>
        {d.unacked > 0 && <button className="linkbtn small grow" onClick={() => api.ackAllAlerts().then(replace)}>Acknowledge all</button>}
      </div>
      <div className="alertlist">
        {items.length === 0 && <p className="muted small">{d.enabled ? 'No alerts. Rules open an alert only on a change from normal to abnormal, so a quiet list is expected most of the time.' : 'Disabled in seed mode.'}</p>}
        {items.map((a) => <AlertRow key={a.id} a={a} now={now} onAck={() => api.ackAlert(a.id).then(replace)} onOpen={a.target_kind === 'market' ? () => onOpenMarket(a.target_id) : undefined} />)}
      </div>
      <section className="panel">
        <h3>Rules <span className="muted small">definition {d.definition_version}</span></h3>
        <div className="tablewrap"><table className="mini-table">
          <thead><tr><th>Rule</th><th>Fires</th><th>Threshold</th><th>Cooldown</th></tr></thead>
          <tbody>{d.rules.map((r) => <RuleRow key={r.id} r={r} readOnly={d.seed_mode} onSaved={replace} />)}</tbody>
        </table></div>
      </section>
    </main>
  );
}
