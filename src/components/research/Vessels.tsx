import { useEffect, useState } from 'react';
import type { VesselView } from '../../../shared/maritime';
import { api } from '../../api';
import { absTime } from '../../format';
import { ErrorChip, attempt } from './common';

type Directory = Awaited<ReturnType<typeof api.maritimeSources>>;
const ACCESS: Record<string, string> = {
  public_reference: 'public browsing only', free_authenticated: 'free, needs a server-side key', contributor_access: 'requires contributing a feed', paid_api: 'paid API (credits/subscription)',
  aggregate_official: 'official aggregate statistics', open_source_tool: 'open-source tool', incident_reports: 'incident reports (not positions)',
};

function VesselCard({ v, onChanged }: { v: VesselView; onChanged: () => void }) {
  const [id, setId] = useState({ kind: 'mmsi', value: '', source_url: '', source_note: '' });
  const [at, setAt] = useState({ attr: 'ship_type_reported', value: '', source_url: '' });
  const [rv, setRv] = useState<Record<string, { reviewer: string; note: string }>>({});
  const [err, setErr] = useState<string | null>(null);
  return (
    <article className="panel vessel">
      <h3>{v.display_name} {v.current.imo ? <span className="chip link">IMO {v.current.imo}</span> : <span className="chip">IMO unknown</span>}{v.current.mmsi && <span className="chip">MMSI {v.current.mmsi}</span>}</h3>
      <p className="small muted">{v.position.reason}</p>
      <h4 className="small">Identity history</h4>
      <ul className="small">{v.identifiers.map((i, k) => <li key={k}><b>{i.kind}</b> {i.value} <span className="muted">{i.valid_from ? `from ${i.valid_from.slice(0, 10)} ` : ''}{i.valid_to ? `until ${i.valid_to.slice(0, 10)}` : '(current)'} · recorded {absTime(i.recorded_at)}</span> <a href={i.source_url} target="_blank" rel="noreferrer">source ↗</a>{i.source_note && <span className="muted"> — {i.source_note}</span>}</li>)}</ul>
      <div className="row2">
        <select value={id.kind} onChange={(e) => setId({ ...id, kind: e.target.value })} aria-label="Identifier kind"><option>imo</option><option>mmsi</option><option>name</option><option>callsign</option><option>flag</option></select>
        <input placeholder="value" value={id.value} onChange={(e) => setId({ ...id, value: e.target.value })} />
        <input placeholder="source URL (required)" value={id.source_url} onChange={(e) => setId({ ...id, source_url: e.target.value })} />
        <button onClick={() => attempt(() => api.addVesselIdentifier(v.id, id), setErr).then((r) => { if (r) { setId({ ...id, value: '' }); onChanged(); } })}>Add identifier</button>
      </div>
      <h4 className="small">Source-reported attributes <span className="muted">(not reviewed company relationships)</span></h4>
      <ul className="small">{v.attributes.map((a, k) => <li key={k}><b>{a.attr.replace(/_/g, ' ')}</b>: {a.value} <a href={a.source_url} target="_blank" rel="noreferrer">source ↗</a>{a.as_of && <span className="muted"> as of {a.as_of}</span>}</li>)}{v.attributes.length === 0 && <li className="muted">none recorded</li>}</ul>
      <div className="row2">
        <select value={at.attr} onChange={(e) => setAt({ ...at, attr: e.target.value })} aria-label="Attribute"><option value="ship_type_reported">ship type (reported)</option><option value="cargo_reported">cargo (reported)</option><option value="owner_reported">owner (reported)</option><option value="operator_reported">operator (reported)</option><option value="dwt_reported">DWT (reported)</option></select>
        <input placeholder="value" value={at.value} onChange={(e) => setAt({ ...at, value: e.target.value })} />
        <input placeholder="source URL (required)" value={at.source_url} onChange={(e) => setAt({ ...at, source_url: e.target.value })} />
        <button onClick={() => attempt(() => api.addVesselAttribute(v.id, at), setErr).then((r) => { if (r) { setAt({ ...at, value: '' }); onChanged(); } })}>Add</button>
      </div>
      <h4 className="small">News mentions <span className="muted">(IMO/MMSI in text → proposed; name only → unresolved until reviewed)</span></h4>
      <ul className="small">{v.mentions.map((m) => (
        <li key={m.id}><span className={`chip ${m.status === 'accepted' ? 'link' : m.status === 'rejected' ? '' : 'warn'}`}>{m.status}</span> <span className="muted">{m.basis.replace(/_/g, ' ')}</span> “…{m.evidence}…”
          {m.reviewer && <span className="muted"> — {m.reviewer}{m.note ? `: ${m.note}` : ''}</span>}
          {(m.status === 'proposed' || m.status === 'unresolved') && (
            <span className="row2"><input placeholder="reviewer" value={rv[m.id]?.reviewer ?? ''} onChange={(e) => setRv({ ...rv, [m.id]: { reviewer: e.target.value, note: rv[m.id]?.note ?? '' } })} />
              <input placeholder="note / identifying evidence" value={rv[m.id]?.note ?? ''} onChange={(e) => setRv({ ...rv, [m.id]: { reviewer: rv[m.id]?.reviewer ?? '', note: e.target.value } })} />
              <button onClick={() => attempt(() => api.reviewMention(m.id, { status: 'accepted', ...rv[m.id] }), setErr).then(onChanged)}>accept</button>
              <button onClick={() => attempt(() => api.reviewMention(m.id, { status: 'rejected', ...rv[m.id] }), setErr).then(onChanged)}>reject</button></span>
          )}</li>
      ))}{v.mentions.length === 0 && <li className="muted">none found in the last 30 days of collected items</li>}</ul>
      <ErrorChip e={err} />
    </article>
  );
}

export function Vessels({ versionKey }: { versionKey: string }) {
  const [dir, setDir] = useState<Directory | null>(null);
  const [list, setList] = useState<VesselView[]>([]);
  const [f, setF] = useState({ name: '', imo: '', mmsi: '', source_url: '' });
  const [err, setErr] = useState<string | null>(null);
  const [scan, setScan] = useState<string | null>(null);
  const load = () => api.vessels().then(setList).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); api.maritimeSources().then(setDir).catch(() => { /* directory is optional */ }); }, [versionKey]);
  return (
    <div className="vessels">
      <section className="panel">
        <h3>Vessel watchlist <span className="muted small">— identity records; IMO preferred, MMSI can change, names are not unique</span></h3>
        <div className="row2">
          <input placeholder="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input placeholder="IMO (optional, 7 digits)" value={f.imo} onChange={(e) => setF({ ...f, imo: e.target.value })} />
          <input placeholder="MMSI (optional, 9 digits)" value={f.mmsi} onChange={(e) => setF({ ...f, mmsi: e.target.value })} />
          <input placeholder="source URL (required)" value={f.source_url} onChange={(e) => setF({ ...f, source_url: e.target.value })} />
          <button onClick={() => attempt(() => api.createVessel(Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()))), setErr).then((r) => { if (r) { setF({ name: '', imo: '', mmsi: '', source_url: '' }); load(); } })}>Add vessel</button>
          <button onClick={() => attempt(() => api.scanMentions(), setErr).then((r) => { if (r) { setScan(`${r.proposed} proposed, ${r.unresolved} unresolved`); load(); } })}>Scan recent news</button>
          {scan && <span className="small muted">{scan}</span>}
        </div>
        <ErrorChip e={err} />
        {list.length === 0 && <p className="small muted">No vessels recorded. Identifiers are never invented — each needs the source you took it from.</p>}
      </section>
      {list.map((v) => <VesselCard key={`${v.id}-${v.version}-${v.mentions.length}`} v={v} onChanged={load} />)}
      {dir && (
        <section className="panel">
          <h3>Maritime sources directory <span className="muted small">researched {dir.researched_at}</span></h3>
          <p className="small muted">{dir._readme}</p>
          <div className="tablewrap"><table className="mini-table small">
            <thead><tr><th>Resource</th><th>Access</th><th>Data</th><th>Decision in this tracker</th><th>Limits</th></tr></thead>
            <tbody>{dir.sources.map((s) => (
              <tr key={s.id}><td><a href={s.url} target="_blank" rel="noreferrer"><b>{s.name}</b> ↗</a>{s.docs.map((d, i) => <div key={i}><a href={d} target="_blank" rel="noreferrer" className="muted">docs ↗</a></div>)}</td>
                <td><span className="chip">{ACCESS[s.access] ?? s.access}</span></td><td>{s.data}</td><td>{s.decision}</td><td className="muted">{s.limits}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
