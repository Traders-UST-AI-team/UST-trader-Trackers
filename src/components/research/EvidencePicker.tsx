import { useEffect, useState } from 'react';
import type { FeedItem } from '../../../shared/types';
import type { DossierSummary, DossierDetail } from '../../../shared/research';
import { api } from '../../api';

let lookup: { at: number; promise: Promise<[Awaited<ReturnType<typeof api.feed>>, DossierSummary[]]> } | null = null;
function recentLookup() {
  if (!lookup || Date.now() - lookup.at > 15000) {
    const promise = Promise.all([api.feed('limit=100&kind=all'), api.dossiers()]);
    lookup = { at: Date.now(), promise }; promise.catch(() => { if (lookup?.promise === promise) lookup = null; });
  }
  return lookup.promise;
}
/** Search stored feed records by title/text; dossier claims remain manually selected. */
export function EvidencePicker({ value, onChange, claims = false }: { value: string; onChange: (value: string) => void; claims?: boolean }) {
  const [items, setItems] = useState<FeedItem[]>([]); const [dossiers, setDossiers] = useState<DossierSummary[]>([]);
  const [dossier, setDossier] = useState(''); const [q, setQ] = useState(''); const [detail, setDetail] = useState<DossierDetail | null>(null);
  const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  useEffect(() => { let live = true; recentLookup().then(([f, d]) => { if (live) { setDossiers(d); } }).catch((e) => { if (live) setError(e.message); }); return () => { live = false; }; }, []);
  useEffect(() => {
    let live = true; setDetail(null); setError(null); setLoading(true);
    const timer = setTimeout(() => {
      const request = dossier ? api.dossier(dossier).then((d) => { if (live) setDetail(d); }) : (q ? api.feed(`kind=all&limit=100&q=${encodeURIComponent(q)}`).then((f) => { if (live) setItems(f.items); }) : recentLookup().then(([f]) => { if (live) setItems(f.items); }));
      request.catch((e) => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [dossier, q]);
  const options = new Map((dossier ? [] : items).map((i) => [i.key, `${i.source_name}: ${i.title}`]));
  for (const t of detail?.timeline ?? []) options.set(t.source_ref, `${t.source?.source_name ?? 'Source'}: ${t.source?.title ?? t.source_ref}`);
  if (claims) for (const c of detail?.claims ?? []) options.set(`claim:${c.id}`, `Claim: ${c.quote}`);
  const shown = [...options].filter(([, label]) => !dossier || label.toLowerCase().includes(q.toLowerCase()));
  return <div className="evidencepicker"><input type="search" aria-label="Search evidence" placeholder="Search evidence by title or text…" value={q} onChange={(e) => setQ(e.target.value)} /><select aria-label="Evidence dossier" value={dossier} onFocus={() => api.dossiers().then(setDossiers).catch((e) => setError(e.message))} onChange={(e) => setDossier(e.target.value)}><option value="">Stored feed items</option>{dossiers.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select><select aria-label="Evidence reference" disabled={loading} value={value} onChange={(e) => onChange(e.target.value)}><option value="">{loading ? 'Searching…' : `Choose a source${claims ? ' or claim' : ''}…`}</option>{value && !shown.some(([key]) => key === value) && <option value={value}>{options.get(value) ?? value}</option>}{shown.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><span className="small muted">{shown.length} results{!dossier ? ' (up to 100; narrow your search for older items)' : ''}</span><details className="small"><summary>Use a reference key</summary><input aria-label="Manual evidence reference" placeholder="web:… / telegram:… / claim:…" value={value} onChange={(e) => onChange(e.target.value.trim())} /></details>{error && <span role="alert" className="chip warn">{error}</span>}</div>;
}
